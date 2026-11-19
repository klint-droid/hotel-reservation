/**
 * PdfService.gs
 * Generates personalized Reservation Endorsement Certificate PDFs from the
 * Master Google Docs template, verifies the Google Drive output folder is PRIVATE,
 * enforces non-public permissions on generated PDFs, binds the PDF File ID to the
 * reservation integrity record, records Drive references in Google Sheets, and
 * cleans up temporary Google Docs and orphaned PDFs on failure.
 */

var PdfService = (function () {
  /**
   * Builds sanitized PDF filename matching specification:
   *   ENDORSEMENT_REFERENCE-NUMBER_GUEST-NAME.pdf
   * Example:
   *   ENDORSEMENT_STAY-20261119-0001_JUAN-DELA-CRUZ.pdf
   */
  function buildPdfFilename(referenceNumber, guestName) {
    var safeRef = Utils.sanitizeFilenameSegment(referenceNumber, 40);
    var safeGuest = Utils.sanitizeFilenameSegment(guestName, Config.LIMITS.MAX_FILENAME_NAME_LENGTH);
    return 'ENDORSEMENT_' + safeRef + '_' + safeGuest + '.pdf';
  }

  function resolveOutputFolder(settings) {
    var folderId = Utils.extractDriveFileId(settings.driveOutputFolderId);
    if (!folderId) {
      throw Utils.createAppError(
        Config.ERROR_CODES.MISSING_FOLDER,
        'Google Drive Output Folder ID is not configured in the Settings sheet.'
      );
    }

    var folder;
    try {
      folder = DriveApp.getFolderById(folderId);
      if (folder.isTrashed()) {
        throw new Error('Folder is in Trash.');
      }
    } catch (err) {
      throw Utils.createAppError(
        Config.ERROR_CODES.MISSING_FOLDER,
        'Google Drive Output Folder ("' + folderId + '") could not be accessed: ' + err.message
      );
    }

    // Security check: Ensure the output folder is strictly PRIVATE before storing guest PII PDFs
    if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE) {
      throw Utils.createAppError(
        Config.ERROR_CODES.PDF_GENERATION_FAILED,
        'Security check failed: Drive Output Folder "' + folder.getName() +
        '" is not set to PRIVATE access. Restrict folder sharing to authorized administrators before generating PDFs.'
      );
    }

    return folder;
  }

  function generateEndorsementPdf(reservationId, ss) {
    var spreadsheet = Config.getActiveSpreadsheetOrThrow(ss);
    var adminEmail = SecurityService.assertAuthorizedAdmin('GENERATE_PDF', spreadsheet);
    var settings = Config.getSettings(spreadsheet);
    var tz = settings.timezone || Config.DEFAULT_TIMEZONE;

    return Utils.withScriptLock(function () {
      var found = ReservationService.getReservationById(reservationId, spreadsheet);
      if (!found) {
        return Utils.fail(
          Config.ERROR_CODES.NOT_FOUND,
          'Reservation "' + reservationId + '" could not be found.'
        );
      }

      var res = found.reservation;

      // Only APPROVED reservations can generate endorsement PDFs
      if (res.approvalStatus !== Config.APPROVAL_STATUS.APPROVED) {
        return Utils.fail(
          Config.ERROR_CODES.INVALID_STATE,
          'Endorsement PDF can only be generated for APPROVED reservations. Current status: ' + res.approvalStatus
        );
      }

      if (res.emailStatus === Config.EMAIL_STATUS.SENT || SecurityService.isSentLocked(res.reservationId, spreadsheet)) {
        return Utils.fail(
          Config.ERROR_CODES.INVALID_STATE,
          'Reservation ' + res.referenceNumber + ' has already been emailed (Email Status: SENT). Regenerating the PDF is blocked in MVP.'
        );
      }

      // Re-validate stored guest data
      var validation = ValidationService.validateReservationRecord(res, {
        timezone: tz,
        enforceNotInPast: false
      });
      if (!validation.valid) {
        return Utils.fail(
          Config.ERROR_CODES.VALIDATION_FAILED,
          'Reservation ' + res.referenceNumber + ' has invalid guest data and cannot generate a PDF.',
          validation.errors
        );
      }

      // Enforce post-approval endorsed data integrity (catches manual sheet edits even if onEdit was bypassed)
      var integrity = SecurityService.verifyEndorsedIntegrity(res, false, tz, spreadsheet);
      if (!integrity.valid) {
        ApprovalService.revokeApprovalAndInvalidatePdf(
          res.reservationId,
          integrity.message,
          adminEmail,
          spreadsheet
        );
        return Utils.fail(
          Config.ERROR_CODES.INTEGRITY_MISMATCH,
          integrity.message
        );
      }

      var tempFile = null;
      var pdfFile = null;
      var committed = false;

      try {
        var outputFolder = resolveOutputFolder(settings);
        var docCopy = DocumentService.createPopulatedDocCopy(res, settings, outputFolder);
        tempFile = docCopy.tempFile;

        var pdfFilename = buildPdfFilename(res.referenceNumber, res.guestName);
        var pdfBlob = tempFile.getAs('application/pdf');
        pdfBlob.setName(pdfFilename);

        pdfFile = outputFolder.createFile(pdfBlob);
        // Security requirement: PDFs MUST remain private to authorized administrators
        SecurityService.enforcePrivateFilePermissions(pdfFile.getId());

        var pdfId = pdfFile.getId();
        var pdfUrl = pdfFile.getUrl();

        ReservationService.updateReservationFields(res.reservationId, {
          pdfFileId: pdfId,
          pdfFileUrl: pdfUrl,
          lastError: ''
        }, spreadsheet);

        // Bind both endorsed hash AND exact PDF File ID to defeat column Q swapping
        SecurityService.recordPdfHash(res.reservationId, integrity.currentHash, pdfId, spreadsheet);
        committed = true;

        // Mark previous PDF superseded if regenerating before sending
        if (res.pdfFileId && res.pdfFileId !== pdfId) {
          try {
            var previousFile = DriveApp.getFileById(res.pdfFileId);
            if (previousFile.getName().indexOf('[SUPERSEDED]') !== 0) {
              previousFile.setName('[SUPERSEDED] ' + previousFile.getName());
            }
          } catch (prevErr) {
            Logger.log('Note: Previous PDF "' + res.pdfFileId + '" could not be marked superseded: ' + prevErr);
          }
        }

        try {
          ActivityLogService.logActivity({
            reservationId: res.reservationId,
            referenceNumber: res.referenceNumber,
            administrator: adminEmail,
            action: Config.ACTIVITY_ACTIONS.PDF_GENERATED,
            previousValue: res.pdfFileId || '',
            newValue: pdfId,
            remarks: 'Generated private endorsement PDF: ' + pdfFilename
          }, spreadsheet);
        } catch (logErr) {
          Logger.log('Warning: Failed to log PDF_GENERATED activity: ' + logErr);
        }

        return Utils.ok('Endorsement PDF generated successfully.', {
          reservationId: res.reservationId,
          referenceNumber: res.referenceNumber,
          fileName: pdfFilename,
          pdfFileId: pdfId,
          pdfFileUrl: pdfUrl
        });
      } catch (err) {
        var rawMsg = err && err.message ? err.message : String(err);
        var safeMsg = Utils.redactSensitiveText(rawMsg, 450);

        // Clean up orphaned/uncommitted PDF so PII does not leak on failure
        if (pdfFile && !committed) {
          try {
            pdfFile.setTrashed(true);
          } catch (orphanErr) {
            Logger.log('Warning: Failed to trash orphaned PDF: ' + orphanErr);
          }
        }

        // Preserve original reservation record; safely record Last Error & Activity Log
        try {
          ReservationService.updateReservationFields(res.reservationId, {
            lastError: 'PDF generation failed: ' + safeMsg
          }, spreadsheet);
        } catch (updateErr) {
          Logger.log('Warning: Could not record Last Error after PDF failure: ' + updateErr);
        }

        try {
          ActivityLogService.logActivity({
            reservationId: res.reservationId,
            referenceNumber: res.referenceNumber,
            administrator: adminEmail,
            action: Config.ACTIVITY_ACTIONS.PDF_GENERATION_FAILED,
            previousValue: res.pdfFileId || '',
            newValue: 'FAILED',
            remarks: safeMsg
          }, spreadsheet);
        } catch (actErr) {
          Logger.log('Warning: Could not log PDF_GENERATION_FAILED activity: ' + actErr);
        }

        return Utils.errorToResult(err, 'Failed to generate endorsement PDF.');
      } finally {
        if (tempFile) {
          try {
            tempFile.setTrashed(true);
          } catch (trashErr) {
            Logger.log('Warning: Failed to trash temporary Google Doc: ' + trashErr);
          }
        }
      }
    });
  }

  return Object.freeze({
    buildPdfFilename: buildPdfFilename,
    resolveOutputFolder: resolveOutputFolder,
    generateEndorsementPdf: generateEndorsementPdf
  });
})();
