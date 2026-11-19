/**
 * EmailService.gs
 * Handles pre-send validation, hotel-styled HTML + plain-text email rendering,
 * PDF attachment, locked idempotent Gmail delivery, and failure logging.
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
  function renderEndorsementEmail(reservation, settings) {
    var tz = (settings && settings.timezone) || Config.DEFAULT_TIMEZONE;
    var stayName = settings.staycationName;
    var checkInDisplay = Utils.formatDisplayDate(reservation.checkInDate, tz);
    var checkOutDisplay = Utils.formatDisplayDate(reservation.checkOutDate, tz);
    var checkInTime = settings.checkInTime || '2:00 PM';
    var checkOutTime = settings.checkOutTime || '12:00 PM';
    var fbPage = Config.isUnconfiguredValue(settings.staycationFacebookPage)
      ? ''
      : settings.staycationFacebookPage;

    var subject = 'Your Staycation Reservation Has Been Approved \u2013 ' + reservation.referenceNumber;

    var plainLines = [
      'Dear ' + reservation.guestName + ',',
      '',
      'Good day!',
      '',
      'We are pleased to inform you that your staycation reservation has been reviewed and approved.',
      'Please find your Reservation Endorsement Certificate attached to this email.',
      '',
      'Here are your reservation details:',
      'Reservation Reference: ' + reservation.referenceNumber,
      'Check-in: ' + checkInDisplay + ' (' + checkInTime + ')',
      'Check-out: ' + checkOutDisplay + ' (' + checkOutTime + ')',
      'Number of Guests: ' + reservation.numberOfGuests,
      'Number of Rooms: ' + (reservation.numberOfRooms || 'Not Applicable'),
      '',
      'Kindly present your endorsement certificate upon arrival for verification.',
      'If you have any questions or concerns, please contact us through our official contact details.',
      '',
      'Contact Information:',
      'Contact Number: ' + settings.staycationContactNumber,
      'Email: ' + settings.staycationEmailAddress
    ];
    if (fbPage) {
      plainLines.push('Facebook Page: ' + fbPage);
    }
    plainLines.push('');
    plainLines.push('Thank you for choosing ' + stayName + '!');
    plainLines.push('');
    plainLines.push('Best regards,');
    plainLines.push(stayName + ' Management');

    var e = Utils.escapeHtml;
    var B = Config.BRAND_COLORS;

    var fbHtmlRow = fbPage
      ? '<tr><td style="padding:3px 0;color:#5C636A;">Facebook Page:</td><td style="padding:3px 0 3px 10px;color:#2B2D2F;">' + e(fbPage) + '</td></tr>'
      : '';

    var htmlBody = [
      '<!DOCTYPE html>',
      '<html lang="en"><head><meta charset="utf-8"></head>',
      '<body style="margin:0;padding:0;background-color:' + B.WARM_BEIGE + ';font-family:Arial,Helvetica,sans-serif;color:' + B.CHARCOAL + ';">',
      '  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:' + B.WARM_BEIGE + ';padding:24px 12px;">',
      '    <tr><td align="center">',
      '      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background-color:' + B.WHITE + ';border-radius:8px;overflow:hidden;border:1px solid #DFD8CC;">',
      '        <tr>',
      '          <td style="background-color:' + B.DARK_GREEN + ';padding:26px 28px;text-align:center;border-bottom:4px solid ' + B.GOLD + ';">',
      '            <div style="font-family:Georgia,serif;font-size:22px;font-weight:bold;color:' + B.WHITE + ';letter-spacing:0.6px;">' + e(stayName) + '</div>',
      '            <div style="font-size:12px;color:' + B.GOLD + ';letter-spacing:2px;margin-top:6px;text-transform:uppercase;font-weight:bold;">Reservation Confirmation &amp; Endorsement</div>',
      '          </td>',
      '        </tr>',
      '        <tr>',
      '          <td style="padding:28px 30px;font-size:14px;line-height:1.6;color:' + B.CHARCOAL + ';">',
      '            <p style="margin:0 0 12px 0;">Dear <strong>' + e(reservation.guestName) + '</strong>,</p>',
      '            <p style="margin:0 0 14px 0;">Good day!</p>',
      '            <p style="margin:0 0 10px 0;">We are pleased to inform you that your staycation reservation has been reviewed and approved.</p>',
      '            <p style="margin:0 0 18px 0;">Please find your <strong>Reservation Endorsement Certificate</strong> attached to this email.</p>',
      '            <div style="background-color:' + B.WARM_BEIGE + ';border:1px solid ' + B.GOLD + ';border-radius:6px;padding:16px 20px;margin:18px 0;">',
      '              <div style="font-family:Georgia,serif;font-size:15px;font-weight:bold;color:' + B.DARK_GREEN + ';margin-bottom:10px;">Here are your reservation details:</div>',
      '              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:13px;">',
      '                <tr><td style="padding:5px 0;color:#5C636A;width:170px;font-weight:bold;">Reservation Reference:</td><td style="padding:5px 0;color:' + B.DARK_GREEN + ';font-weight:bold;">' + e(reservation.referenceNumber) + '</td></tr>',
      '                <tr><td style="padding:5px 0;color:#5C636A;font-weight:bold;">Check-in:</td><td style="padding:5px 0;">' + e(checkInDisplay) + ' (' + e(checkInTime) + ')</td></tr>',
      '                <tr><td style="padding:5px 0;color:#5C636A;font-weight:bold;">Check-out:</td><td style="padding:5px 0;">' + e(checkOutDisplay) + ' (' + e(checkOutTime) + ')</td></tr>',
      '                <tr><td style="padding:5px 0;color:#5C636A;font-weight:bold;">Number of Guests:</td><td style="padding:5px 0;">' + e(String(reservation.numberOfGuests)) + '</td></tr>',
      '                <tr><td style="padding:5px 0;color:#5C636A;font-weight:bold;">Number of Rooms:</td><td style="padding:5px 0;">' + e(reservation.numberOfRooms || 'Not Applicable') + '</td></tr>',
      '              </table>',
      '            </div>',
      '            <p style="margin:0 0 10px 0;">Kindly present your endorsement certificate upon arrival for verification.</p>',
      '            <p style="margin:0 0 18px 0;">If you have any questions or concerns, please contact us through our official contact details.</p>',
      '            <div style="border-top:1px solid #E5DFD5;padding-top:14px;margin-top:16px;font-size:13px;">',
      '              <div style="font-weight:bold;color:' + B.DARK_GREEN + ';margin-bottom:6px;">Official Contact Information</div>',
      '              <table role="presentation" cellspacing="0" cellpadding="0" style="font-size:13px;">',
      '                <tr><td style="padding:3px 0;color:#5C636A;">Contact Number:</td><td style="padding:3px 0 3px 10px;color:#2B2D2F;">' + e(settings.staycationContactNumber) + '</td></tr>',
      '                <tr><td style="padding:3px 0;color:#5C636A;">Email:</td><td style="padding:3px 0 3px 10px;color:#2B2D2F;">' + e(settings.staycationEmailAddress) + '</td></tr>',
      fbHtmlRow,
      '              </table>',
      '            </div>',
      '            <p style="margin:18px 0 10px 0;">Thank you for choosing <strong>' + e(stayName) + '</strong>!</p>',
      '            <p style="margin:0;">Best regards,<br><strong>' + e(stayName) + ' Management</strong></p>',
      '          </td>',
      '        </tr>',
      '      </table>',
      '    </td></tr>',
      '  </table>',
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

    var rendered = renderEndorsementEmail(res, settings);
    return Utils.ok('Email preview ready.', {
      reservationId: res.reservationId,
      referenceNumber: res.referenceNumber,
      guestName: res.guestName,
      recipientEmail: res.emailAddress,
      subject: rendered.subject,
      htmlBody: rendered.htmlBody,
      pdfFileName: check.data.pdfFile.getName(),
      // Always use canonical DriveApp URL (never trust manually editable sheet column R)
      pdfFileUrl: check.data.pdfFile.getUrl(),
      isRetryAfterFailure: isRetry,
      lastError: res.lastError || '',
      remainingQuota: check.data.remainingQuota
    });
  }

  function resolveMailOptions(rendered, pdfBlob, settings) {
    var safeSenderName = String(settings.staycationName || '')
      .replace(/[\r\n]+/g, ' ')
      .trim();

    var opts = {
      htmlBody: rendered.htmlBody,
      attachments: [pdfBlob],
      name: safeSenderName
    };

    if (!Config.isUnconfiguredValue(settings.staycationEmailAddress)) {
      var stayEmail = Utils.normalizeEmail(settings.staycationEmailAddress);
      opts.replyTo = stayEmail;
      try {
        var aliases = GmailApp.getAliases() || [];
        for (var i = 0; i < aliases.length; i++) {
          if (Utils.normalizeEmail(aliases[i]) === stayEmail) {
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
      var rendered = renderEndorsementEmail(res, settings);
      var attemptedAt = Utils.formatTimestamp(new Date(), tz);
      var emailDispatched = false;

      try {
        var pdfBlob = pdfFile.getBlob();
        var mailOptions = resolveMailOptions(rendered, pdfBlob, settings);

        // Execute Gmail send — Email Status MUST NOT become SENT until this returns without error
        GmailApp.sendEmail(res.emailAddress, rendered.subject, rendered.plainBody, mailOptions);
        emailDispatched = true;
      } catch (sendErr) {
        var rawErrMsg = sendErr && sendErr.message ? sendErr.message : String(sendErr);
        var safeErrMsg = Utils.redactSensitiveText(rawErrMsg, 450);
        var isQuotaErr = /too many times|quota|limit/i.test(rawErrMsg);
        var errCode = isQuotaErr ? Config.ERROR_CODES.QUOTA_EXCEEDED : Config.ERROR_CODES.EMAIL_SEND_FAILED;

        // Preserve original reservation data; mark FAILED and log the error
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
            recipientEmail: res.emailAddress,
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
          'Failed to send endorsement email to ' + res.emailAddress + ': ' + safeErrMsg,
          [safeErrMsg],
          { emailLogId: failLogId }
        );
      }

      // Post-dispatch recording: Gmail ALREADY accepted the email.
      // Isolate each state/log write so a downstream logging error NEVER rolls back SENT to FAILED!
      var sentAt = Utils.formatTimestamp(new Date(), tz);
      var logId = '';
      var warnings = [];

      try {
        var logEntry = EmailLogService.logEmailAttempt({
          reservationId: res.reservationId,
          referenceNumber: res.referenceNumber,
          recipientEmail: res.emailAddress,
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
          remarks: 'Endorsement email delivered to ' + res.emailAddress + ' with attachment ' + pdfFile.getName() +
            (logId ? (' (Log: ' + logId + ')') : '')
        }, spreadsheet);
      } catch (postActErr) {
        warnings.push('Activity Logs write warning: ' + postActErr.message);
        Logger.log('Warning: Email delivered, but Activity Logs write failed: ' + postActErr);
      }

      return Utils.ok(
        'Endorsement email sent successfully to ' + res.emailAddress + '!' +
          (warnings.length > 0 ? (' (Note: ' + warnings.join('; ') + ')') : ''),
        {
          emailDispatched: emailDispatched,
          reservation: updatedReservation,
          emailLogId: logId,
          sentAt: sentAt,
          attachmentName: pdfFile.getName(),
          warnings: warnings
        }
      );
    });
  }

  return Object.freeze({
    renderEndorsementEmail: renderEndorsementEmail,
    validateReadyToSend: validateReadyToSend,
    getEmailPreview: getEmailPreview,
    sendEndorsementEmail: sendEndorsementEmail
  });
})();
