/**
 * ActivityLogService.gs
 * Append-only audit trail writer and reader for Sheet 4: Activity Logs.
 * Never logs credentials, tokens, or raw sensitive payloads.
 */

var ActivityLogService = (function () {
  function sanitizeLogText(value, maxLen) {
    return Utils.sanitizeSheetCell(Utils.redactSensitiveText(value, maxLen || 500));
  }

  function logActivity(params, ss) {
    var sheet = Config.getSheetOrThrow(Config.SHEETS.ACTIVITY_LOGS, ss);
    var settings = Config.getSettings(ss);
    var tz = settings.timezone || Config.DEFAULT_TIMEZONE;
    var activityId = Utils.generateUuid('ACT');
    var timestamp = Utils.formatTimestamp(params.timestamp || new Date(), tz);

    var row = [
      activityId,
      sanitizeLogText(params.reservationId || 'SYSTEM', 100),
      sanitizeLogText(params.referenceNumber || 'N/A', 60),
      sanitizeLogText(params.administrator || 'SYSTEM', 160),
      sanitizeLogText(params.action || 'UNKNOWN_ACTION', 80),
      sanitizeLogText(params.previousValue || '', 250),
      sanitizeLogText(params.newValue || '', 250),
      timestamp,
      sanitizeLogText(params.remarks || '', 500)
    ];

    sheet.appendRow(row);
    return {
      activityId: activityId,
      timestamp: timestamp
    };
  }

  function getRecentActivities(limit, reservationId, ss) {
    var sheet = Config.getSheetOrThrow(Config.SHEETS.ACTIVITY_LOGS, ss);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return [];
    }

    var values = sheet.getRange(2, 1, lastRow - 1, Config.ACTIVITY_LOG_HEADERS.length).getDisplayValues();
    var C = Config.ACTIVITY_LOG_COLS;
    var results = [];

    for (var i = values.length - 1; i >= 0; i--) {
      var r = values[i];
      var resId = String(r[C.RESERVATION_ID - 1] || '').trim();
      if (reservationId && resId !== reservationId) {
        continue;
      }
      results.push({
        activityId: r[C.ACTIVITY_ID - 1],
        reservationId: resId,
        referenceNumber: r[C.REFERENCE_NUMBER - 1],
        administrator: r[C.ADMINISTRATOR - 1],
        action: r[C.ACTION - 1],
        previousValue: r[C.PREVIOUS_VALUE - 1],
        newValue: r[C.NEW_VALUE - 1],
        timestamp: r[C.TIMESTAMP - 1],
        remarks: r[C.REMARKS - 1]
      });
      if (limit && results.length >= limit) {
        break;
      }
    }
    return results;
  }

  return Object.freeze({
    logActivity: logActivity,
    getRecentActivities: getRecentActivities
  });
})();
