/**
 * SecurityService.gs
 * Administrator identity verification, fail-closed authorization, Drive file
 * privacy enforcement, post-approval endorsed-data SHA-256 integrity checks,
 * bound PDF File ID verification, and immutable Sent-Lock tracking.
 *
 * Security Model:
 * - Authoritative admin allowlist is stored in ScriptProperties (`AUTHORIZED_ADMINS_CSV`),
 *   bootstrapped from `Settings` ONLY when unset/empty — never unioned with editable cells
 *   so non-admin sheet edits cannot escalate privileges and admin removals take effect cleanly.
 * - Per-reservation integrity records (Approval Hash, PDF Hash, Bound PDF File ID, Sent Lock)
 *   are stored in a hidden, hard-protected `_SystemIntegrity` sheet so they scale well beyond
 *   Apps Script's 500 KB ScriptProperties quota while preventing PDF swapping or column M tampering.
 * - Account Limitation Note:
 *   On Google Workspace accounts (same domain), Session.getActiveUser().getEmail() reliably
 *   identifies the executing administrator. On consumer @gmail.com accounts, Google restricts
 *   getActiveUser().getEmail() for non-owner editors. This service fails closed when identity
 *   cannot be verified rather than trusting any client-supplied email string.
 */

var SecurityService = (function () {
  var INTEGRITY_HEADERS = Object.freeze([
    'Reservation ID',
    'Approval Hash',
    'PDF Hash',
    'Bound PDF File ID',
    'Sent Locked',
    'Sent Log ID',
    'Updated At'
  ]);

  function getOrCreateIntegritySheet(ss) {
    var spreadsheet = Config.getActiveSpreadsheetOrThrow(ss);
    var sheet = spreadsheet.getSheetByName(Config.SHEETS.SYSTEM_INTEGRITY);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(Config.SHEETS.SYSTEM_INTEGRITY);
      sheet.getRange(1, 1, 1, INTEGRITY_HEADERS.length).setValues([INTEGRITY_HEADERS]);
      sheet.setFrozenRows(1);
      sheet.hideSheet();
      try {
        var prot = sheet.protect();
        prot.setDescription('System Integrity Store (Do not edit manually)');
        prot.setWarningOnly(false);
      } catch (protErr) {
        Logger.log('Note: Could not apply hard protection on _SystemIntegrity: ' + protErr);
      }
    }
    return sheet;
  }

  function findIntegrityRow(reservationId, ss) {
    var sheet = getOrCreateIntegritySheet(ss);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { sheet: sheet, rowIndex: -1, record: null };
    }
    var values = sheet.getRange(2, 1, lastRow - 1, INTEGRITY_HEADERS.length).getDisplayValues();
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][0] || '').trim() === reservationId) {
        return {
          sheet: sheet,
          rowIndex: i + 2,
          record: {
            reservationId: values[i][0],
            approvalHash: values[i][1] || '',
            pdfHash: values[i][2] || '',
            boundPdfFileId: values[i][3] || '',
            sentLocked: values[i][4] === 'TRUE',
            sentLogId: values[i][5] || '',
            updatedAt: values[i][6] || ''
          }
        };
      }
    }
    return { sheet: sheet, rowIndex: -1, record: null };
  }

  function upsertIntegrityRecord(reservationId, patch, ss) {
    var found = findIntegrityRow(reservationId, ss);
    var existing = found.record || {
      reservationId: reservationId,
      approvalHash: '',
      pdfHash: '',
      boundPdfFileId: '',
      sentLocked: false,
      sentLogId: '',
      updatedAt: ''
    };
    var merged = Object.assign({}, existing, patch || {});
    merged.updatedAt = Utils.formatTimestamp(new Date(), Config.DEFAULT_TIMEZONE);

    var row = [
      merged.reservationId,
      merged.approvalHash || '',
      merged.pdfHash || '',
      merged.boundPdfFileId || '',
      merged.sentLocked ? 'TRUE' : 'FALSE',
      merged.sentLogId || '',
      merged.updatedAt
    ];

    if (found.rowIndex >= 2) {
      found.sheet.getRange(found.rowIndex, 1, 1, INTEGRITY_HEADERS.length).setValues([row]);
    } else {
      found.sheet.appendRow(row);
    }
    return merged;
  }

  /**
   * Returns the authoritative list of administrator emails.
   * Uses ScriptProperties.AUTHORIZED_ADMINS_CSV as the single authoritative store
   * once initialized (bootstrapping from Settings ONLY if ScriptProperties is unset).
   */
  function getAuthorizedAdmins(ss) {
    var props = PropertiesService.getScriptProperties();
    var propCsv = props.getProperty(Config.PROPERTY_PREFIXES.AUTHORIZED_ADMINS);

    if (propCsv !== null && propCsv !== undefined && String(propCsv).trim() !== '') {
      return Config.parseAdminEmails(propCsv);
    }

    // Bootstrap once from Settings if ScriptProperties has not been initialized yet
    var settings = Config.getSettings(ss);
    var fromSettings = settings.administratorEmails || [];
    if (fromSettings.length > 0) {
      props.setProperty(Config.PROPERTY_PREFIXES.AUTHORIZED_ADMINS, fromSettings.join(','));
    }
    return fromSettings;
  }

  function resolveExecutingUser() {
    var activeEmail = '';
    var effectiveEmail = '';

    try {
      activeEmail = Utils.normalizeEmail(Session.getActiveUser().getEmail());
    } catch (e1) {
      activeEmail = '';
    }

    try {
      effectiveEmail = Utils.normalizeEmail(Session.getEffectiveUser().getEmail());
    } catch (e2) {
      effectiveEmail = '';
    }

    if (activeEmail) {
      return { email: activeEmail, source: 'ACTIVE_USER' };
    }

    var allowFallback = PropertiesService.getScriptProperties()
      .getProperty(Config.PROPERTY_PREFIXES.ALLOW_OWNER_EFFECTIVE_FALLBACK);
    if (allowFallback === 'true' && effectiveEmail) {
      return { email: effectiveEmail, source: 'EFFECTIVE_USER_OWNER_FALLBACK' };
    }

    return { email: '', source: 'UNAVAILABLE' };
  }

  function getCurrentAdminEmail() {
    return resolveExecutingUser().email;
  }

  function isAuthorizedAdmin(ss) {
    var identity = resolveExecutingUser();
    if (!identity.email) {
      return false;
    }
    var admins = getAuthorizedAdmins(ss);
    return admins.indexOf(identity.email) !== -1;
  }

  function assertAuthorizedAdmin(actionName, ss) {
    var action = actionName || 'ADMIN_OPERATION';
    var identity = resolveExecutingUser();
    var admins = getAuthorizedAdmins(ss);

    if (admins.length === 0) {
      throw Utils.createAppError(
        Config.ERROR_CODES.UNAUTHORIZED,
        'No authorized administrator emails are configured. Set ADMINISTRATOR_EMAIL during setup first.'
      );
    }

    if (!identity.email) {
      logUnauthorizedAttempt('UNIDENTIFIED_USER', action, 'Unable to verify executing Google account identity.', ss);
      throw Utils.createAppError(
        Config.ERROR_CODES.UNAUTHORIZED,
        'Administrator identity could not be verified by Google Apps Script. ' +
        'Ensure you are signed into an authorized Google Workspace account (or configure single-owner fallback per DEPLOYMENT_GUIDE.md).'
      );
    }

    if (admins.indexOf(identity.email) === -1) {
      logUnauthorizedAttempt(identity.email, action, 'Account is not in the authorized administrator allowlist.', ss);
      throw Utils.createAppError(
        Config.ERROR_CODES.UNAUTHORIZED,
        'Access denied: "' + identity.email + '" is not authorized to perform "' + action + '".'
      );
    }

    return identity.email;
  }

  function logUnauthorizedAttempt(actor, actionName, reason, ss) {
    try {
      if (typeof ActivityLogService !== 'undefined' && ActivityLogService.logActivity) {
        ActivityLogService.logActivity({
          reservationId: 'SYSTEM',
          referenceNumber: 'N/A',
          administrator: actor,
          action: Config.ACTIVITY_ACTIONS.UNAUTHORIZED_ACCESS,
          previousValue: '',
          newValue: actionName,
          remarks: reason
        }, ss);
      }
    } catch (err) {
      Logger.log('Failed to log unauthorized attempt: ' + err);
    }
  }

  function enforcePrivateFilePermissions(fileId) {
    var file = DriveApp.getFileById(fileId);
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    var access = file.getSharingAccess();
    if (access !== DriveApp.Access.PRIVATE) {
      throw Utils.createAppError(
        Config.ERROR_CODES.PDF_GENERATION_FAILED,
        'Security check failed: generated PDF file could not be locked to PRIVATE access.'
      );
    }
    return file;
  }

  function recordApprovalHash(reservationId, hash, ss) {
    return upsertIntegrityRecord(reservationId, {
      approvalHash: String(hash || '')
    }, ss);
  }

  function getApprovalHash(reservationId, ss) {
    var found = findIntegrityRow(reservationId, ss);
    return found.record ? found.record.approvalHash : '';
  }

  /**
   * Binds BOTH the endorsed data hash AND the exact generated PDF Drive File ID
   * so column Q cannot be swapped with another guest's PDF.
   */
  function recordPdfHash(reservationId, hash, pdfFileId, ss) {
    return upsertIntegrityRecord(reservationId, {
      pdfHash: String(hash || ''),
      boundPdfFileId: String(pdfFileId || '')
    }, ss);
  }

  function getPdfIntegrity(reservationId, ss) {
    var found = findIntegrityRow(reservationId, ss);
    if (!found.record) {
      return { pdfHash: '', boundPdfFileId: '' };
    }
    return {
      pdfHash: found.record.pdfHash,
      boundPdfFileId: found.record.boundPdfFileId
    };
  }

  function recordSentLock(reservationId, emailLogId, ss) {
    return upsertIntegrityRecord(reservationId, {
      sentLocked: true,
      sentLogId: String(emailLogId || '')
    }, ss);
  }

  function isSentLocked(reservationId, ss) {
    var found = findIntegrityRow(reservationId, ss);
    return Boolean(found.record && found.record.sentLocked);
  }

  function clearIntegrityHashes(reservationId, ss) {
    var found = findIntegrityRow(reservationId, ss);
    if (!found.record) {
      return;
    }
    // Preserve sentLocked if already sent; clear approval & PDF hashes
    upsertIntegrityRecord(reservationId, {
      approvalHash: '',
      pdfHash: '',
      boundPdfFileId: ''
    }, ss);
  }

  function clearPdfHash(reservationId, ss) {
    var found = findIntegrityRow(reservationId, ss);
    if (!found.record) {
      return;
    }
    upsertIntegrityRecord(reservationId, {
      pdfHash: '',
      boundPdfFileId: ''
    }, ss);
  }

  /**
   * Verifies that endorsed guest/reservation fields in Google Sheets have NOT been
   * manually modified since approval, AND (when requirePdfHash is true) that the
   * exact PDF File ID matches the PDF generated for this reservation.
   */
  function verifyEndorsedIntegrity(reservation, requirePdfHash, timezone, ss) {
    var currentHash = Utils.computeEndorsedHash(reservation, timezone);
    var found = findIntegrityRow(reservation.reservationId, ss);
    var rec = found.record;

    if (!rec || !rec.approvalHash) {
      return {
        valid: false,
        reason: 'MISSING_APPROVAL_HASH',
        message: 'Reservation approval signature is missing. It may have been edited manually outside the official approval workflow. Please re-approve.'
      };
    }

    if (rec.approvalHash !== currentHash) {
      return {
        valid: false,
        reason: 'MODIFIED_AFTER_APPROVAL',
        message: 'Endorsed reservation details were modified after approval. The existing PDF is invalidated and re-approval is required.'
      };
    }

    if (requirePdfHash) {
      if (!rec.pdfHash || rec.pdfHash !== currentHash) {
        return {
          valid: false,
          reason: 'PDF_OUT_OF_SYNC',
          message: 'The generated PDF does not match the current approved reservation details. Please regenerate the endorsement PDF.'
        };
      }
      if (!rec.boundPdfFileId || rec.boundPdfFileId !== Utils.normalizeText(reservation.pdfFileId)) {
        return {
          valid: false,
          reason: 'PDF_ID_MISMATCH',
          message: 'The PDF File ID on this row does not match the endorsement PDF generated by the system. Please regenerate the endorsement PDF.'
        };
      }
    }

    return {
      valid: true,
      currentHash: currentHash
    };
  }

  return Object.freeze({
    getOrCreateIntegritySheet: getOrCreateIntegritySheet,
    getAuthorizedAdmins: getAuthorizedAdmins,
    resolveExecutingUser: resolveExecutingUser,
    getCurrentAdminEmail: getCurrentAdminEmail,
    isAuthorizedAdmin: isAuthorizedAdmin,
    assertAuthorizedAdmin: assertAuthorizedAdmin,
    enforcePrivateFilePermissions: enforcePrivateFilePermissions,
    recordApprovalHash: recordApprovalHash,
    getApprovalHash: getApprovalHash,
    recordPdfHash: recordPdfHash,
    getPdfIntegrity: getPdfIntegrity,
    recordSentLock: recordSentLock,
    isSentLocked: isSentLocked,
    clearIntegrityHashes: clearIntegrityHashes,
    clearPdfHash: clearPdfHash,
    verifyEndorsedIntegrity: verifyEndorsedIntegrity
  });
})();
