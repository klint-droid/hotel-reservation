/**
 * ApprovalService.gs
 * Manages administrator approval, rejection, and post-approval edit invalidation.
 *
 * Enforced Business Rules:
 * - Only PENDING reservations can be approved or rejected.
 * - Approval NEVER automatically sends an email.
 * - Rejection NEVER automatically sends an email in the MVP.
 * - Editing any endorsed reservation detail on an APPROVED row revokes approval
 *   (APPROVED -> PENDING) and invalidates any existing generated PDF.
 */

var ApprovalService = (function () {
  function approveReservation(reservationId, remarks, ss) {
    var spreadsheet = Config.getActiveSpreadsheetOrThrow(ss);
    var adminEmail = SecurityService.assertAuthorizedAdmin('APPROVE_RESERVATION', spreadsheet);
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
      if (res.approvalStatus === Config.APPROVAL_STATUS.APPROVED) {
        return Utils.fail(
          Config.ERROR_CODES.INVALID_STATE,
          'Reservation ' + res.referenceNumber + ' is already APPROVED.'
        );
      }
      if (res.approvalStatus === Config.APPROVAL_STATUS.REJECTED) {
        return Utils.fail(
          Config.ERROR_CODES.INVALID_STATE,
          'Reservation ' + res.referenceNumber + ' has been REJECTED and cannot be approved.'
        );
      }
      if (res.approvalStatus !== Config.APPROVAL_STATUS.PENDING) {
        return Utils.fail(
          Config.ERROR_CODES.INVALID_STATE,
          'Only PENDING reservations can be approved. Current status: ' + (res.approvalStatus || 'EMPTY')
        );
      }

      // Re-validate stored guest details before approving (never trust raw sheet values)
      var validation = ValidationService.validateReservationRecord(res, {
        timezone: tz,
        enforceNotInPast: false
      });
      if (!validation.valid) {
        return Utils.fail(
          Config.ERROR_CODES.VALIDATION_FAILED,
          'Cannot approve reservation ' + res.referenceNumber + ' due to invalid guest data.',
          validation.errors
        );
      }

      var approvedAt = Utils.formatTimestamp(new Date(), tz);
      var newRemarks = Utils.normalizeText(remarks);
      var combinedRemarks = res.adminRemarks;
      if (newRemarks) {
        combinedRemarks = combinedRemarks
          ? (combinedRemarks + ' | ' + newRemarks)
          : newRemarks;
      }

      var updated = ReservationService.updateReservationFields(res.reservationId, {
        approvalStatus: Config.APPROVAL_STATUS.APPROVED,
        approvedAt: approvedAt,
        approvedBy: adminEmail,
        adminRemarks: combinedRemarks,
        lastError: ''
      }, spreadsheet);

      // Persist endorsed-field SHA-256 hash so any subsequent manual sheet edits are detected
      var hash = Utils.computeEndorsedHash(updated.reservation, tz);
      SecurityService.recordApprovalHash(res.reservationId, hash);

      ActivityLogService.logActivity({
        reservationId: res.reservationId,
        referenceNumber: res.referenceNumber,
        administrator: adminEmail,
        action: Config.ACTIVITY_ACTIONS.RESERVATION_APPROVED,
        previousValue: Config.APPROVAL_STATUS.PENDING,
        newValue: Config.APPROVAL_STATUS.APPROVED,
        remarks: newRemarks || 'Reservation verified and approved by administrator. No email auto-sent.'
      }, spreadsheet);

      // IMPORTANT: Never send an endorsement email automatically upon approval.
      return Utils.ok(
        'Reservation ' + res.referenceNumber + ' has been APPROVED. Generate the endorsement PDF when ready.',
        updated.reservation
      );
    });
  }

  function rejectReservation(reservationId, reason, ss) {
    var spreadsheet = Config.getActiveSpreadsheetOrThrow(ss);
    var adminEmail = SecurityService.assertAuthorizedAdmin('REJECT_RESERVATION', spreadsheet);
    var cleanedReason = Utils.normalizeText(reason);

    if (!cleanedReason) {
      return Utils.fail(
        Config.ERROR_CODES.VALIDATION_FAILED,
        'A rejection reason is required when rejecting a reservation.'
      );
    }
    if (cleanedReason.length > Config.LIMITS.MAX_REMARKS_LENGTH) {
      return Utils.fail(
        Config.ERROR_CODES.VALIDATION_FAILED,
        'Rejection reason must not exceed ' + Config.LIMITS.MAX_REMARKS_LENGTH + ' characters.'
      );
    }

    return Utils.withScriptLock(function () {
      var found = ReservationService.getReservationById(reservationId, spreadsheet);
      if (!found) {
        return Utils.fail(
          Config.ERROR_CODES.NOT_FOUND,
          'Reservation "' + reservationId + '" could not be found.'
        );
      }

      var res = found.reservation;
      if (res.approvalStatus === Config.APPROVAL_STATUS.REJECTED) {
        return Utils.fail(
          Config.ERROR_CODES.INVALID_STATE,
          'Reservation ' + res.referenceNumber + ' is already REJECTED.'
        );
      }
      if (res.approvalStatus !== Config.APPROVAL_STATUS.PENDING) {
        return Utils.fail(
          Config.ERROR_CODES.INVALID_STATE,
          'Only PENDING reservations can be rejected. Current status: ' + res.approvalStatus
        );
      }

      var combinedRemarks = res.adminRemarks
        ? (res.adminRemarks + ' | Rejected: ' + cleanedReason)
        : ('Rejected: ' + cleanedReason);

      var updated = ReservationService.updateReservationFields(res.reservationId, {
        approvalStatus: Config.APPROVAL_STATUS.REJECTED,
        adminRemarks: combinedRemarks,
        approvedAt: '',
        approvedBy: '',
        pdfFileId: '',
        pdfFileUrl: '',
        lastError: ''
      }, spreadsheet);

      SecurityService.clearIntegrityHashes(res.reservationId);

      ActivityLogService.logActivity({
        reservationId: res.reservationId,
        referenceNumber: res.referenceNumber,
        administrator: adminEmail,
        action: Config.ACTIVITY_ACTIONS.RESERVATION_REJECTED,
        previousValue: Config.APPROVAL_STATUS.PENDING,
        newValue: Config.APPROVAL_STATUS.REJECTED,
        remarks: cleanedReason
      }, spreadsheet);

      // MVP rule: Do not automatically send a rejection email.
      return Utils.ok(
        'Reservation ' + res.referenceNumber + ' has been REJECTED.',
        updated.reservation
      );
    });
  }

  /**
   * Revokes approval (APPROVED -> PENDING) and invalidates any generated PDF
   * when endorsed guest or reservation details are modified after approval.
   */
  function revokeApprovalAndInvalidatePdf(reservationId, reason, actor, ss) {
    var spreadsheet = Config.getActiveSpreadsheetOrThrow(ss);
    var found = ReservationService.getReservationById(reservationId, spreadsheet);
    if (!found) {
      return null;
    }

    var res = found.reservation;
    var oldPdfId = res.pdfFileId;
    var actingUser = actor || SecurityService.getCurrentAdminEmail() || 'SYSTEM/INTEGRITY_CHECK';

    // Preserve audit history in Drive while clearly marking the old PDF superseded
    if (oldPdfId) {
      try {
        var oldFile = DriveApp.getFileById(oldPdfId);
        var currentName = oldFile.getName();
        if (currentName.indexOf('[SUPERSEDED]') !== 0) {
          oldFile.setName('[SUPERSEDED] ' + currentName);
        }
      } catch (driveErr) {
        Logger.log('Note: Could not rename superseded PDF "' + oldPdfId + '": ' + driveErr);
      }
    }

    var updated = ReservationService.updateReservationFields(res.reservationId, {
      approvalStatus: Config.APPROVAL_STATUS.PENDING,
      approvedAt: '',
      approvedBy: '',
      pdfFileId: '',
      pdfFileUrl: '',
      lastError: reason || 'Endorsed reservation details changed; re-approval and PDF regeneration required.'
    }, spreadsheet);

    SecurityService.clearIntegrityHashes(res.reservationId);

    ActivityLogService.logActivity({
      reservationId: res.reservationId,
      referenceNumber: res.referenceNumber,
      administrator: actingUser,
      action: Config.ACTIVITY_ACTIONS.APPROVAL_REVOKED,
      previousValue: Config.APPROVAL_STATUS.APPROVED,
      newValue: Config.APPROVAL_STATUS.PENDING,
      remarks: reason || 'Endorsed details edited after approval; re-approval required.'
    }, spreadsheet);

    if (oldPdfId) {
      ActivityLogService.logActivity({
        reservationId: res.reservationId,
        referenceNumber: res.referenceNumber,
        administrator: actingUser,
        action: Config.ACTIVITY_ACTIONS.PDF_INVALIDATED,
        previousValue: oldPdfId,
        newValue: '',
        remarks: 'Previously generated PDF invalidated because endorsed reservation details were modified.'
      }, spreadsheet);
    }

    return updated.reservation;
  }

  /**
   * Installable onEdit handler detecting manual changes to endorsed fields
   * (Guest Name, Email, Contact, Check-in, Check-out, Guests, Rooms) on APPROVED rows.
   */
  function handleReservationEdit(e, ss) {
    if (!e || !e.range) {
      return Utils.ok('No edit range provided.', { affected: 0 });
    }

    var range = e.range;
    var sheet = range.getSheet();
    if (!sheet || sheet.getName() !== Config.SHEETS.RESERVATIONS) {
      return Utils.ok('Edit occurred outside Reservations sheet.', { affected: 0 });
    }

    var startRow = range.getRow();
    var endRow = range.getLastRow();
    var startCol = range.getColumn();
    var endCol = range.getLastColumn();

    if (endRow < 2) {
      return Utils.ok('Header edit ignored.', { affected: 0 });
    }

    var touchedEndorsedColumn = false;
    for (var c = startCol; c <= endCol; c++) {
      if (ReservationService.isEndorsedColumn(c)) {
        touchedEndorsedColumn = true;
        break;
      }
    }
    if (!touchedEndorsedColumn) {
      return Utils.ok('Edited column does not affect endorsed details.', { affected: 0 });
    }

    var spreadsheet = ss || sheet.getParent();
    var actor = SecurityService.getCurrentAdminEmail() || 'SHEET_EDITOR';
    var revokedRefs = [];

    var lastDataRow = sheet.getLastRow();
    var firstDataRow = Math.max(startRow, 2);
    var boundedEndRow = Math.min(endRow, lastDataRow);
    if (boundedEndRow < firstDataRow) {
      return Utils.ok('No data rows affected.', { affected: 0 });
    }

    // Batch-read affected Reservation IDs once (O(N)) and execute revocations under ScriptLock
    var idValues = sheet.getRange(firstDataRow, Config.RESERVATION_COLS.RESERVATION_ID, boundedEndRow - firstDataRow + 1, 1).getValues();
    var targetIds = [];
    for (var idx = 0; idx < idValues.length; idx++) {
      var idVal = Utils.normalizeText(idValues[idx][0]);
      if (idVal) {
        targetIds.push({ reservationId: idVal, rowNum: firstDataRow + idx });
      }
    }
    if (targetIds.length === 0) {
      return Utils.ok('No valid Reservation IDs in edited range.', { affected: 0 });
    }

    return Utils.withScriptLock(function () {
      var all = ReservationService.getAllReservations(spreadsheet);
      var byId = {};
      for (var k = 0; k < all.length; k++) {
        byId[all[k].reservation.reservationId] = all[k].reservation;
      }

      for (var t = 0; t < targetIds.length; t++) {
        var res = byId[targetIds[t].reservationId];
        if (!res || res.approvalStatus !== Config.APPROVAL_STATUS.APPROVED) {
          continue;
        }

        if (res.emailStatus === Config.EMAIL_STATUS.SENT) {
          ActivityLogService.logActivity({
            reservationId: res.reservationId,
            referenceNumber: res.referenceNumber,
            administrator: actor,
            action: Config.ACTIVITY_ACTIONS.POST_SEND_EDIT_WARNING,
            previousValue: 'SENT',
            newValue: 'EDITED_POST_SEND',
            remarks: 'Warning: Endorsed fields were edited on row ' + targetIds[t].rowNum + ' after endorsement email had already been SENT.'
          }, spreadsheet);
          continue;
        }

        revokeApprovalAndInvalidatePdf(
          res.reservationId,
          'Endorsed reservation detail edited in spreadsheet; approval revoked and PDF invalidated. Please re-approve.',
          actor,
          spreadsheet
        );
        revokedRefs.push(res.referenceNumber);
      }

      return Utils.ok('Edit integrity check completed.', {
        affected: revokedRefs.length,
        revokedReferences: revokedRefs
      });
    });
  }

  /**
   * 1-Click Endorsement Pipeline (explicitly triggered after admin confirmation):
   *   1. Approve PENDING reservation (ApprovalService.approveReservation)
   *   2. Generate private Endorsement PDF (PdfService.generateEndorsementPdf)
   *   3. Deliver HTML Endorsement Email + PDF attachment (EmailService.sendEndorsementEmail)
   *
   * Never runs automatically on guest form submission. Preserves partial progress
   * cleanly if Step 2 or Step 3 fails so the administrator can recover in 1 click.
   */
  function approveAndEndorseReservation(reservationId, remarks, ss) {
    var spreadsheet = Config.getActiveSpreadsheetOrThrow(ss);
    SecurityService.assertAuthorizedAdmin('APPROVE_AND_ENDORSE', spreadsheet);

    var steps = {
      approved: false,
      pdfGenerated: false,
      emailSent: false
    };

    // Step 1: Approve PENDING reservation
    var approveRes = approveReservation(reservationId, remarks, spreadsheet);
    if (!approveRes.ok) {
      return Utils.fail(
        approveRes.code,
        'Approval failed: ' + approveRes.message,
        approveRes.errors,
        { steps: steps }
      );
    }
    steps.approved = true;

    // Step 2: Generate private Endorsement PDF
    var pdfRes = PdfService.generateEndorsementPdf(reservationId, spreadsheet);
    if (!pdfRes.ok) {
      return Utils.fail(
        pdfRes.code,
        'Reservation was APPROVED, but PDF generation failed: ' + pdfRes.message,
        pdfRes.errors,
        {
          steps: steps,
          reservation: ReservationService.getReservationById(reservationId, spreadsheet).reservation
        }
      );
    }
    steps.pdfGenerated = true;

    // Step 3: Send Endorsement Email with PDF attachment
    var emailRes = EmailService.sendEndorsementEmail(reservationId, { allowFailedRetry: false }, spreadsheet);
    if (!emailRes.ok) {
      return Utils.fail(
        emailRes.code,
        'Reservation was APPROVED and PDF was generated, but email sending failed: ' + emailRes.message,
        emailRes.errors,
        {
          steps: steps,
          pdf: pdfRes.data,
          reservation: ReservationService.getReservationById(reservationId, spreadsheet).reservation
        }
      );
    }
    steps.emailSent = true;

    return Utils.ok(
      'Reservation ' + approveRes.data.referenceNumber + ' approved, PDF generated, and endorsement email sent to ' +
      approveRes.data.emailAddress + '!',
      {
        steps: steps,
        reservation: emailRes.data.reservation,
        pdf: pdfRes.data,
        email: {
          emailLogId: emailRes.data.emailLogId,
          sentAt: emailRes.data.sentAt,
          attachmentName: emailRes.data.attachmentName
        }
      }
    );
  }

  /**
   * 1-Click Recovery/Completion for an already APPROVED reservation:
   * generates PDF (if missing) and sends the endorsement email.
   */
  function completeApprovedEndorsement(reservationId, allowFailedRetry, ss) {
    var spreadsheet = Config.getActiveSpreadsheetOrThrow(ss);
    SecurityService.assertAuthorizedAdmin('COMPLETE_ENDORSEMENT', spreadsheet);

    var found = ReservationService.getReservationById(reservationId, spreadsheet);
    if (!found) {
      return Utils.fail(Config.ERROR_CODES.NOT_FOUND, 'Reservation "' + reservationId + '" was not found.');
    }
    var res = found.reservation;
    if (res.approvalStatus !== Config.APPROVAL_STATUS.APPROVED) {
      return Utils.fail(
        Config.ERROR_CODES.INVALID_STATE,
        'Reservation must be APPROVED first. Current status: ' + res.approvalStatus
      );
    }

    var pdfData = null;
    if (!res.pdfFileId) {
      var pdfRes = PdfService.generateEndorsementPdf(reservationId, spreadsheet);
      if (!pdfRes.ok) {
        return pdfRes;
      }
      pdfData = pdfRes.data;
    }

    var emailRes = EmailService.sendEndorsementEmail(
      reservationId,
      { allowFailedRetry: Boolean(allowFailedRetry) },
      spreadsheet
    );
    if (!emailRes.ok) {
      return emailRes;
    }

    return Utils.ok(emailRes.message, {
      reservation: emailRes.data.reservation,
      pdf: pdfData,
      email: {
        emailLogId: emailRes.data.emailLogId,
        sentAt: emailRes.data.sentAt,
        attachmentName: emailRes.data.attachmentName
      }
    });
  }

  return Object.freeze({
    approveReservation: approveReservation,
    rejectReservation: rejectReservation,
    approveAndEndorseReservation: approveAndEndorseReservation,
    completeApprovedEndorsement: completeApprovedEndorsement,
    revokeApprovalAndInvalidatePdf: revokeApprovalAndInvalidatePdf,
    handleReservationEdit: handleReservationEdit
  });
})();
