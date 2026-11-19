/**
 * EmailService.gs
 * Handles pre-send validation, PMO/Concierge Guest Endorsement HTML + plain-text
 * rendering with inline uploaded Guest Valid ID photos directly below "Thank you.",
 * attaching both the generated Endorsement PDF and original Guest ID file(s),
 * CC'ing the guest, locked idempotent Gmail delivery, and failure logging.
 *
 * Enforced Business Rules:
 * - Only triggered explicitly by an authorized administrator.
 * - Requires Approval Status = APPROVED, valid PDF file matching bound PDF File ID,
 *   valid integrity hashes, valid recipient email, and NOT previously sent
 *   (cross-checked against Reservations, _SystemIntegrity Sent-Lock, AND Email Logs).
 * - Marks SENT only AFTER GmailApp.sendEmail() succeeds without throwing.
 * - Post-send logging failures NEVER overwrite SENT back to FAILED (prevents duplicate sends).
 * - Never performs automatic retries; explicit admin retry is supported after FAILED.
 */

var EmailService = (function () {
  function parseGuestList(reservation) {
    var guests = [];
    if (reservation.guestName) {
      guests.push(Utils.normalizeText(reservation.guestName));
    }
    if (reservation.companionGuests) {
      var parts = String(reservation.companionGuests).split(/[\n,;]+/);
      for (var i = 0; i < parts.length; i++) {
        var name = Utils.normalizeText(parts[i]);
        if (name && guests.indexOf(name) === -1) {
          guests.push(name);
        }
      }
    }
    return guests;
  }

  function resolveRecipients(reservation, settings) {
    var guestEmail = Utils.normalizeEmail(reservation.emailAddress);
    var pmoEmails = (settings && settings.pmoConciergeEmails) || [];

    if (pmoEmails.length > 0) {
      var ccEmail = pmoEmails.indexOf(guestEmail) === -1 ? guestEmail : '';
      return {
        to: pmoEmails.join(', '),
        cc: ccEmail,
        isPmoRecipient: true
      };
    }

    return {
      to: guestEmail,
      cc: '',
      isPmoRecipient: false
    };
  }

  /**
   * Loads uploaded guest Valid ID files from Google Drive for inline display & attachment.
   */
  function collectGuestIdFiles(reservation) {
    var fileIds = Utils.extractDriveFileIds(reservation.validIdFileIds);
    var results = [];

    for (var i = 0; i < fileIds.length; i++) {
      var fid = fileIds[i];
      try {
        var file = DriveApp.getFileById(fid);
        if (file.isTrashed()) {
          Logger.log('Note: Uploaded ID file "' + fid + '" is trashed; skipping.');
          continue;
        }
        var blob = file.getBlob();
        var mimeType = String(blob.getContentType() || file.getMimeType() || '').toLowerCase();
        var isImage = /^image\/(jpeg|jpg|png|gif|webp)$/i.test(mimeType);
        results.push({
          fileId: fid,
          fileName: file.getName(),
          fileUrl: file.getUrl(),
          mimeType: mimeType,
          isImage: isImage,
          cid: isImage ? ('guest_id_' + results.length) : '',
          blob: blob
        });
      } catch (err) {
        Logger.log('Warning: Could not load uploaded Guest ID "' + fid + '": ' + Utils.redactSensitiveText(err.message, 200));
      }
    }

    return results;
  }

  function renderEndorsementEmail(reservation, settings, idFiles, options) {
    var opts = options || {};
    var tz = (settings && settings.timezone) || Config.DEFAULT_TIMEZONE;
    var stayName = settings.staycationName;
    var unitLocation = Config.isUnconfiguredValue(settings.unitLocation)
      ? stayName
      : settings.unitLocation;

    var checkInShort = Utils.formatShortDate(reservation.checkInDate, tz);
    var checkOutShort = Utils.formatShortDate(reservation.checkOutDate, tz);
    var checkInDisplay = Utils.formatDisplayDate(reservation.checkInDate, tz);
    var checkOutDisplay = Utils.formatDisplayDate(reservation.checkOutDate, tz);
    var checkInTime = settings.checkInTime || '2:00 PM';
    var checkOutTime = settings.checkOutTime || '12:00 PM';
    var fbPage = Config.isUnconfiguredValue(settings.staycationFacebookPage)
      ? ''
      : settings.staycationFacebookPage;

    var guests = parseGuestList(reservation);
    var uploadedIds = Array.isArray(idFiles) ? idFiles : [];

    var subject = 'Guest Endorsement \u2013 ' + unitLocation +
      ' (' + checkInShort + ' \u2013 ' + checkOutShort + ') \u2013 ' + reservation.referenceNumber;

    // Plain-text fallback
    var plainLines = [
      'Dear PMO/Concierge,',
      '',
      'This is to confirm that I am allowing the following guests to stay at ' + unitLocation +
        ' from ' + checkInShort + ' (' + checkInTime + ') to ' + checkOutShort + ' (' + checkOutTime + ').',
      '',
      'Guest(s):'
    ];
    for (var g = 0; g < guests.length; g++) {
      plainLines.push('- ' + guests[g]);
    }
    plainLines.push('');
    plainLines.push('Reservation Reference: ' + reservation.referenceNumber);
    plainLines.push('Stay Dates: ' + checkInDisplay + ' (' + checkInTime + ') to ' + checkOutDisplay + ' (' + checkOutTime + ')');
    plainLines.push('Number of Guests: ' + reservation.numberOfGuests);
    plainLines.push('Number of Rooms: ' + (reservation.numberOfRooms || 'Not Applicable'));
    plainLines.push('');
    plainLines.push('They will present their ids upon arrival for verification. Kindly assist them with check-in and grant access to the unit during their stay.');
    plainLines.push('');
    plainLines.push('If you require anything further, please let me know.');
    plainLines.push('');
    plainLines.push('Thank you.');
    plainLines.push('');
    if (uploadedIds.length > 0) {
      plainLines.push('Attached Guest ID(s): ' + uploadedIds.map(function (f) { return f.fileName; }).join(', '));
      plainLines.push('');
    }
    plainLines.push('---');
    plainLines.push(stayName);
    plainLines.push('Contact Number: ' + settings.staycationContactNumber);
    plainLines.push('Email: ' + settings.staycationEmailAddress);
    if (fbPage) {
      plainLines.push('Facebook Page: ' + fbPage);
    }

    // Clean HTML matching the PMO/Concierge endorsement letter format with inline ID image(s) directly below "Thank you."
    var e = Utils.escapeHtml;
    var guestListHtml = '';
    for (var gi = 0; gi < guests.length; gi++) {
      guestListHtml += '<li style="margin:2px 0;"><strong>' + e(guests[gi]) + '</strong></li>';
    }

    var inlineIdBlocks = [];
    for (var k = 0; k < uploadedIds.length; k++) {
      var idItem = uploadedIds[k];
      if (idItem.isImage && idItem.cid) {
        var imgSrc = 'cid:' + idItem.cid;
        if (opts.useDataUriForPreview && idItem.blob && idItem.blob.getBytes) {
          try {
            var b64 = Utilities.base64Encode(idItem.blob.getBytes());
            imgSrc = 'data:' + idItem.mimeType + ';base64,' + b64;
          } catch (b64Err) {
            imgSrc = 'cid:' + idItem.cid;
          }
        }
        inlineIdBlocks.push(
          '<div style="margin:14px 0 10px 0;">' +
          '<img src="' + imgSrc + '" alt="' + e(idItem.fileName || 'Guest Valid ID') + '" ' +
          'style="display:block;max-width:540px;width:100%;height:auto;border:1px solid #D9D9D9;border-radius:4px;">' +
          '</div>'
        );
      } else {
        inlineIdBlocks.push(
          '<p style="margin:10px 0;font-size:13px;color:#444444;"><em>Attached Valid ID Document: ' +
          e(idItem.fileName) + '</em></p>'
        );
      }
    }

    var footerContacts = [
      '<strong>' + e(stayName) + '</strong>',
      'Contact: ' + e(settings.staycationContactNumber) + ' &bull; Email: ' + e(settings.staycationEmailAddress)
    ];
    if (fbPage) {
      footerContacts.push('Facebook: ' + e(fbPage));
    }

    var htmlBody = [
      '<!DOCTYPE html>',
      '<html lang="en"><head><meta charset="utf-8"></head>',
      '<body style="margin:0;padding:16px;background-color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#222222;">',
      '  <div style="max-width:640px;margin:0 auto;">',
      '    <p style="margin:0 0 14px 0;">Dear PMO/Concierge,</p>',
      '    <p style="margin:0 0 14px 0;">This is to confirm that I am allowing the following guests to stay at <strong>' +
        e(unitLocation) + '</strong> from <strong>' + e(checkInShort) + ' (' + e(checkInTime) + ')</strong> to <strong>' +
        e(checkOutShort) + ' (' + e(checkOutTime) + ')</strong>.</p>',
      '    <div style="margin:0 0 14px 0;">',
      '      <div style="font-weight:bold;margin-bottom:4px;">Guest(s):</div>',
      '      <ul style="margin:0;padding-left:20px;">' + guestListHtml + '</ul>',
      '      <div style="margin-top:6px;font-size:12.5px;color:#555555;">' +
        'Reservation Reference: <strong>' + e(reservation.referenceNumber) + '</strong> &bull; ' +
        'Stay Dates: ' + e(checkInDisplay) + ' to ' + e(checkOutDisplay) + ' &bull; ' +
        'Guests: ' + e(String(reservation.numberOfGuests)) +
      '</div>',
      '    </div>',
      '    <p style="margin:0 0 14px 0;">They will present their ids upon arrival for verification. Kindly assist them with check-in and grant access to the unit during their stay.</p>',
      '    <p style="margin:0 0 14px 0;">If you require anything further, please let me know.</p>',
      '    <p style="margin:0 0 12px 0;">Thank you.</p>',
      inlineIdBlocks.join('\n'),
      '    <div style="margin-top:20px;padding-top:12px;border-top:1px solid #E5E5E5;font-size:12px;color:#666666;">',
      '      ' + footerContacts.join('<br>'),
      '    </div>',
      '  </div>',
      '</body></html>'
    ].join('\n');

    return {
      subject: subject,
      plainBody: plainLines.join('\n'),
      htmlBody: htmlBody
    };
  }

  function validateReadyToSend(reservation, settings, options, ss) {
    var opts = options || {};
    var tz = (settings && settings.timezone) || Config.DEFAULT_TIMEZONE;

    if (!reservation) {
      return Utils.fail(Config.ERROR_CODES.NOT_FOUND, 'Reservation does not exist.');
    }

    // 1. Strict tamper-resistant duplicate prevention (sheet status + _SystemIntegrity lock + Email Logs)
    var alreadySentOnSheet = reservation.emailStatus === Config.EMAIL_STATUS.SENT;
    var alreadySentLocked = SecurityService.isSentLocked(reservation.reservationId, ss);
    var alreadyInEmailLogs = false;
    try {
      alreadyInEmailLogs = EmailLogService.hasSentRecord(reservation.reservationId, ss);
    } catch (logCheckErr) {
      Logger.log('Warning: Could not cross-check Email Logs for prior SENT record: ' + logCheckErr);
    }

    if (alreadySentOnSheet || alreadySentLocked || alreadyInEmailLogs) {
      return Utils.fail(
        Config.ERROR_CODES.DUPLICATE_EMAIL,
        'Endorsement email for ' + reservation.referenceNumber + ' has already been SENT. Duplicate sending is blocked.'
      );
    }

    if (reservation.emailStatus === Config.EMAIL_STATUS.FAILED && !opts.allowFailedRetry) {
      return Utils.fail(
        Config.ERROR_CODES.INVALID_STATE,
        'Previous email attempt for ' + reservation.referenceNumber + ' FAILED. Explicit administrator retry confirmation is required.'
      );
    }

    if (reservation.emailStatus !== Config.EMAIL_STATUS.NOT_SENT && reservation.emailStatus !== Config.EMAIL_STATUS.FAILED) {
      return Utils.fail(
        Config.ERROR_CODES.INVALID_STATE,
        'Unexpected Email Status "' + reservation.emailStatus + '". Expected NOT_SENT.'
      );
    }

    // 2. Approval state
    if (reservation.approvalStatus !== Config.APPROVAL_STATUS.APPROVED) {
      return Utils.fail(
        Config.ERROR_CODES.INVALID_STATE,
        'Only APPROVED reservations can be emailed. Current Approval Status: ' + reservation.approvalStatus
      );
    }

    // 3. Guest details & email validation
    var recCheck = ValidationService.validateReservationRecord(reservation, {
      timezone: tz,
      enforceNotInPast: false
    });
    if (!recCheck.valid) {
      return Utils.fail(
        Config.ERROR_CODES.VALIDATION_FAILED,
        'Reservation ' + reservation.referenceNumber + ' has invalid guest data.',
        recCheck.errors
      );
    }

    // 4. PDF must be generated first before checking PDF hash / Drive file
    if (!reservation.pdfFileId) {
      return Utils.fail(
        Config.ERROR_CODES.PDF_MISSING,
        'No Endorsement PDF has been generated yet for ' + reservation.referenceNumber + '. Click "Generate Endorsement PDF" first.'
      );
    }

    // 5. Endorsed data & bound PDF File ID integrity check
    var integrity = SecurityService.verifyEndorsedIntegrity(reservation, true, tz, ss);
    if (!integrity.valid) {
      return Utils.fail(
        Config.ERROR_CODES.INTEGRITY_MISMATCH,
        integrity.message,
        [integrity.message],
        { integrityReason: integrity.reason }
      );
    }

    // 6. Branding settings validation
    var brandingErrors = DocumentService.validateBrandingSettings(settings);
    if (brandingErrors.length > 0) {
      return Utils.fail(
        Config.ERROR_CODES.VALIDATION_FAILED,
        'Staycation contact/branding settings are incomplete.',
        brandingErrors
      );
    }

    // 7. PDF Drive file exists and is accessible
    var pdfFile;
    try {
      pdfFile = DriveApp.getFileById(reservation.pdfFileId);
      if (pdfFile.isTrashed()) {
        throw new Error('PDF file is in Trash.');
      }
    } catch (pdfErr) {
      return Utils.fail(
        Config.ERROR_CODES.PDF_MISSING,
        'Endorsement PDF file ("' + reservation.pdfFileId + '") is missing or inaccessible: ' + pdfErr.message
      );
    }

    // 8. Gmail daily quota pre-check (never fabricate a bogus positive number on error)
    var remainingQuota = -1;
    try {
      remainingQuota = MailApp.getRemainingDailyQuota();
    } catch (qErr) {
      Logger.log('Warning: MailApp.getRemainingDailyQuota() unavailable: ' + qErr);
      remainingQuota = -1;
    }
    if (remainingQuota === 0) {
      return Utils.fail(
        Config.ERROR_CODES.QUOTA_EXCEEDED,
        'Daily Gmail sending quota has been exceeded (0 emails remaining today). Please try again after the quota resets.'
      );
    }

    return Utils.ok('Reservation is ready to send.', {
      pdfFile: pdfFile,
      remainingQuota: remainingQuota
    });
  }

  function getEmailPreview(reservationId, ss) {
    var spreadsheet = Config.getActiveSpreadsheetOrThrow(ss);
    var settings = Config.getSettings(spreadsheet);
    var found = ReservationService.getReservationById(reservationId, spreadsheet);
    if (!found) {
      return Utils.fail(Config.ERROR_CODES.NOT_FOUND, 'Reservation "' + reservationId + '" could not be found.');
    }

    var res = found.reservation;
    var isRetry = res.emailStatus === Config.EMAIL_STATUS.FAILED;
    var check = validateReadyToSend(res, settings, { allowFailedRetry: isRetry }, spreadsheet);
    if (!check.ok) {
      return check;
    }

    var idFiles = collectGuestIdFiles(res);
    var rendered = renderEndorsementEmail(res, settings, idFiles, { useDataUriForPreview: true });
    var recipients = resolveRecipients(res, settings);

    var attachmentNames = [check.data.pdfFile.getName()];
    for (var i = 0; i < idFiles.length; i++) {
      attachmentNames.push(idFiles[i].fileName);
    }

    return Utils.ok('Email preview ready.', {
      reservationId: res.reservationId,
      referenceNumber: res.referenceNumber,
      guestName: res.guestName,
      recipientEmail: recipients.to,
      ccEmail: recipients.cc,
      isPmoRecipient: recipients.isPmoRecipient,
      subject: rendered.subject,
      htmlBody: rendered.htmlBody,
      pdfFileName: check.data.pdfFile.getName(),
      attachmentNames: attachmentNames,
      idFileCount: idFiles.length,
      // Always use canonical DriveApp URL (never trust manually editable sheet column R)
      pdfFileUrl: check.data.pdfFile.getUrl(),
      isRetryAfterFailure: isRetry,
      lastError: res.lastError || '',
      remainingQuota: check.data.remainingQuota
    });
  }

  function resolveMailOptions(rendered, pdfBlob, idFiles, recipients, settings) {
    var safeSenderName = String(settings.staycationName || '')
      .replace(/[\r\n]+/g, ' ')
      .trim();

    var attachments = [pdfBlob];
    var inlineImages = {};
    var hasInlineImages = false;

    var list = Array.isArray(idFiles) ? idFiles : [];
    for (var i = 0; i < list.length; i++) {
      attachments.push(list[i].blob.copyBlob());
      if (list[i].isImage && list[i].cid) {
        inlineImages[list[i].cid] = list[i].blob.copyBlob();
        hasInlineImages = true;
      }
    }

    var opts = {
      htmlBody: rendered.htmlBody,
      attachments: attachments,
      name: safeSenderName
    };

    if (hasInlineImages) {
      opts.inlineImages = inlineImages;
    }

    if (recipients && recipients.cc) {
      opts.cc = recipients.cc;
    }

    if (!Config.isUnconfiguredValue(settings.staycationEmailAddress)) {
      var stayEmail = Utils.normalizeEmail(settings.staycationEmailAddress);
      opts.replyTo = stayEmail;
      try {
        var aliases = GmailApp.getAliases() || [];
        for (var j = 0; j < aliases.length; j++) {
          if (Utils.normalizeEmail(aliases[j]) === stayEmail) {
            opts.from = stayEmail;
            break;
          }
        }
      } catch (aliasErr) {
        Logger.log('Note: Could not query Gmail aliases; using default account with replyTo: ' + aliasErr);
      }
    }

    return opts;
  }

  function sendEndorsementEmail(reservationId, options, ss) {
    var spreadsheet = Config.getActiveSpreadsheetOrThrow(ss);
    var adminEmail = SecurityService.assertAuthorizedAdmin('SEND_EMAIL', spreadsheet);
    var settings = Config.getSettings(spreadsheet);
    var tz = settings.timezone || Config.DEFAULT_TIMEZONE;
    var opts = options || {};

    return Utils.withScriptLock(function () {
      // Re-read inside lock for strict idempotency
      var found = ReservationService.getReservationById(reservationId, spreadsheet);
      if (!found) {
        return Utils.fail(Config.ERROR_CODES.NOT_FOUND, 'Reservation "' + reservationId + '" could not be found.');
      }

      var res = found.reservation;
      var check = validateReadyToSend(res, settings, {
        allowFailedRetry: Boolean(opts.allowFailedRetry)
      }, spreadsheet);

      if (!check.ok) {
        if (check.code === Config.ERROR_CODES.INTEGRITY_MISMATCH &&
            check.data &&
            (check.data.integrityReason === 'MODIFIED_AFTER_APPROVAL' ||
             check.data.integrityReason === 'MISSING_APPROVAL_HASH')) {
          ApprovalService.revokeApprovalAndInvalidatePdf(
            res.reservationId,
            check.message,
            adminEmail,
            spreadsheet
          );
        }
        return check;
      }

      var pdfFile = check.data.pdfFile;
      var idFiles = collectGuestIdFiles(res);
      var recipients = resolveRecipients(res, settings);
      var rendered = renderEndorsementEmail(res, settings, idFiles, { useDataUriForPreview: false });
      var attemptedAt = Utils.formatTimestamp(new Date(), tz);
      var emailDispatched = false;
      var recipientLogLabel = recipients.cc
        ? (recipients.to + ' (CC: ' + recipients.cc + ')')
        : recipients.to;

      try {
        var pdfBlob = pdfFile.getBlob();
        var mailOptions = resolveMailOptions(rendered, pdfBlob, idFiles, recipients, settings);

        // Execute Gmail send — Email Status MUST NOT become SENT until this returns without error
        GmailApp.sendEmail(recipients.to, rendered.subject, rendered.plainBody, mailOptions);
        emailDispatched = true;
      } catch (sendErr) {
        var rawErrMsg = sendErr && sendErr.message ? sendErr.message : String(sendErr);
        var safeErrMsg = Utils.redactSensitiveText(rawErrMsg, 450);
        var isQuotaErr = /too many times|quota|limit/i.test(rawErrMsg);
        var errCode = isQuotaErr ? Config.ERROR_CODES.QUOTA_EXCEEDED : Config.ERROR_CODES.EMAIL_SEND_FAILED;

        try {
          ReservationService.updateReservationFields(res.reservationId, {
            emailStatus: Config.EMAIL_STATUS.FAILED,
            lastError: 'Email send failed: ' + safeErrMsg
          }, spreadsheet);
        } catch (sheetErr) {
          Logger.log('Warning: Failed to update FAILED status on Reservations sheet: ' + sheetErr);
        }

        var failLogId = '';
        try {
          var failLog = EmailLogService.logEmailAttempt({
            reservationId: res.reservationId,
            referenceNumber: res.referenceNumber,
            recipientEmail: recipientLogLabel,
            emailSubject: rendered.subject,
            emailStatus: Config.EMAIL_STATUS.FAILED,
            dateAttempted: attemptedAt,
            dateSent: '',
            errorMessage: safeErrMsg,
            administrator: adminEmail
          }, spreadsheet);
          failLogId = failLog.logId;
        } catch (emailLogErr) {
          Logger.log('Warning: Failed to record FAILED attempt in Email Logs: ' + emailLogErr);
        }

        try {
          ActivityLogService.logActivity({
            reservationId: res.reservationId,
            referenceNumber: res.referenceNumber,
            administrator: adminEmail,
            action: Config.ACTIVITY_ACTIONS.ENDORSEMENT_EMAIL_FAILED,
            previousValue: res.emailStatus,
            newValue: Config.EMAIL_STATUS.FAILED,
            remarks: 'Delivery failed (' + (failLogId || 'no-log-id') + '): ' + safeErrMsg
          }, spreadsheet);
        } catch (actErr) {
          Logger.log('Warning: Failed to record ENDORSEMENT_EMAIL_FAILED in Activity Logs: ' + actErr);
        }

        return Utils.fail(
          errCode,
          'Failed to send endorsement email to ' + recipientLogLabel + ': ' + safeErrMsg,
          [safeErrMsg],
          { emailLogId: failLogId }
        );
      }

      // Post-dispatch recording: Gmail ALREADY accepted the email.
      var sentAt = Utils.formatTimestamp(new Date(), tz);
      var logId = '';
      var warnings = [];

      try {
        var logEntry = EmailLogService.logEmailAttempt({
          reservationId: res.reservationId,
          referenceNumber: res.referenceNumber,
          recipientEmail: recipientLogLabel,
          emailSubject: rendered.subject,
          emailStatus: Config.EMAIL_STATUS.SENT,
          dateAttempted: attemptedAt,
          dateSent: sentAt,
          errorMessage: '',
          administrator: adminEmail
        }, spreadsheet);
        logId = logEntry.logId;
      } catch (postEmailLogErr) {
        warnings.push('Email Logs write warning: ' + postEmailLogErr.message);
        Logger.log('Warning: Email delivered, but Email Logs write failed: ' + postEmailLogErr);
      }

      try {
        SecurityService.recordSentLock(res.reservationId, logId, spreadsheet);
      } catch (lockErr) {
        warnings.push('Sent lock warning: ' + lockErr.message);
        Logger.log('Warning: Email delivered, but Sent-Lock record failed: ' + lockErr);
      }

      var updatedReservation = res;
      try {
        var updated = ReservationService.updateReservationFields(res.reservationId, {
          emailStatus: Config.EMAIL_STATUS.SENT,
          emailSentAt: sentAt,
          lastError: warnings.length > 0 ? ('Delivered with logging warning: ' + warnings.join('; ')) : ''
        }, spreadsheet);
        updatedReservation = updated.reservation;
      } catch (statusErr) {
        warnings.push('Reservations status update warning: ' + statusErr.message);
        Logger.log('Warning: Email delivered, but Reservations update failed: ' + statusErr);
      }

      try {
        ActivityLogService.logActivity({
          reservationId: res.reservationId,
          referenceNumber: res.referenceNumber,
          administrator: adminEmail,
          action: Config.ACTIVITY_ACTIONS.ENDORSEMENT_EMAIL_SENT,
          previousValue: res.emailStatus,
          newValue: Config.EMAIL_STATUS.SENT,
          remarks: 'Endorsement email delivered to ' + recipientLogLabel +
            ' with attachment ' + pdfFile.getName() +
            (idFiles.length > 0 ? (' + ' + idFiles.length + ' guest ID file(s)') : '') +
            (logId ? (' (Log: ' + logId + ')') : '')
        }, spreadsheet);
      } catch (postActErr) {
        warnings.push('Activity Logs write warning: ' + postActErr.message);
        Logger.log('Warning: Email delivered, but Activity Logs write failed: ' + postActErr);
      }

      return Utils.ok(
        'Endorsement email sent successfully to ' + recipientLogLabel + '!' +
          (warnings.length > 0 ? (' (Note: ' + warnings.join('; ') + ')') : ''),
        {
          emailDispatched: emailDispatched,
          reservation: updatedReservation,
          emailLogId: logId,
          sentAt: sentAt,
          to: recipients.to,
          cc: recipients.cc,
          attachmentName: pdfFile.getName(),
          idFileCount: idFiles.length,
          warnings: warnings
        }
      );
    });
  }

  return Object.freeze({
    resolveRecipients: resolveRecipients,
    collectGuestIdFiles: collectGuestIdFiles,
    renderEndorsementEmail: renderEndorsementEmail,
    validateReadyToSend: validateReadyToSend,
    getEmailPreview: getEmailPreview,
    sendEndorsementEmail: sendEndorsementEmail
  });
})();
