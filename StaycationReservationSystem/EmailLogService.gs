/**
 * EmailLogService.gs
 * Append-only ledger for Sheet 2: Email Logs (Columns A-J).
 */

var EmailLogService = (function () {
  function logEmailAttempt(params, ss) {
    var sheet = Config.getSheetOrThrow(Config.SHEETS.EMAIL_LOGS, ss);
    var settings = Config.getSettings(ss);
    var tz = settings.timezone || Config.DEFAULT_TIMEZONE;
    var logId = Utils.generateUuid('ELOG');

    var dateAttempted = params.dateAttempted || Utils.formatTimestamp(new Date(), tz);
    var dateSent = params.emailStatus === Config.EMAIL_STATUS.SENT
      ? (params.dateSent || Utils.formatTimestamp(new Date(), tz))
      : '';

    var safeError = Utils.sanitizeSheetCell(
      Utils.redactSensitiveText(params.errorMessage || '', 500)
    );

    var row = [
      logId,
      Utils.sanitizeSheetCell(params.reservationId || ''),
      Utils.sanitizeSheetCell(params.referenceNumber || ''),
      Utils.sanitizeSheetCell(params.recipientEmail || ''),
      Utils.sanitizeSheetCell(params.emailSubject || ''),
      params.emailStatus || Config.EMAIL_STATUS.FAILED,
      dateAttempted,
      dateSent,
      safeError,
      Utils.sanitizeSheetCell(params.administrator || '')
    ];

    sheet.appendRow(row);
    return {
      logId: logId,
      dateAttempted: dateAttempted,
      dateSent: dateSent
    };
  }

  function hasSentRecord(reservationId, ss) {
    var targetId = Utils.normalizeText(reservationId);
    if (!targetId) {
      return false;
    }
    var sheet = Config.getSheetOrThrow(Config.SHEETS.EMAIL_LOGS, ss);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return false;
    }
    var values = sheet.getRange(2, 1, lastRow - 1, Config.EMAIL_LOG_COLS.EMAIL_STATUS).getDisplayValues();
    var resCol = Config.EMAIL_LOG_COLS.RESERVATION_ID - 1;
    var statusCol = Config.EMAIL_LOG_COLS.EMAIL_STATUS - 1;
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][resCol] || '').trim() === targetId &&
          String(values[i][statusCol] || '').trim() === Config.EMAIL_STATUS.SENT) {
        return true;
      }
    }
    return false;
  }

  function getEmailLogs(limit, reservationId, ss) {
    var sheet = Config.getSheetOrThrow(Config.SHEETS.EMAIL_LOGS, ss);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return [];
    }

    var values = sheet.getRange(2, 1, lastRow - 1, Config.EMAIL_LOG_HEADERS.length).getDisplayValues();
    var C = Config.EMAIL_LOG_COLS;
    var out = [];

    for (var i = values.length - 1; i >= 0; i--) {
      var r = values[i];
      var resId = String(r[C.RESERVATION_ID - 1] || '').trim();
      if (reservationId && resId !== reservationId) {
        continue;
      }
      out.push({
        logId: r[C.LOG_ID - 1],
        reservationId: resId,
        referenceNumber: r[C.REFERENCE_NUMBER - 1],
        recipientEmail: r[C.RECIPIENT_EMAIL - 1],
        emailSubject: r[C.EMAIL_SUBJECT - 1],
        emailStatus: r[C.EMAIL_STATUS - 1],
        dateAttempted: r[C.DATE_ATTEMPTED - 1],
        dateSent: r[C.DATE_SENT - 1],
        errorMessage: r[C.ERROR_MESSAGE - 1],
        administrator: r[C.ADMINISTRATOR - 1]
      });
      if (limit && out.length >= limit) {
        break;
      }
    }
    return out;
  }

  return Object.freeze({
    logEmailAttempt: logEmailAttempt,
    hasSentRecord: hasSentRecord,
    getEmailLogs: getEmailLogs
  });
})();
