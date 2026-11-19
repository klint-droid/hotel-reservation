/**
 * ReferenceGenerator.gs
 * Generates unique, sequential, concurrency-safe reservation reference numbers:
 *   STAY-YYYYMMDD-XXXX  (e.g., STAY-20261119-0001)
 *
 * Uses LockService and cross-checks ScriptProperties daily counters against
 * existing reference numbers in the Reservations sheet so numbering self-heals
 * even if ScriptProperties are cleared.
 */

var ReferenceGenerator = (function () {
  function formatReferenceNumber(dateYyyyMmDd, sequenceNumber) {
    return 'STAY-' + dateYyyyMmDd + '-' + Utils.pad4(sequenceNumber);
  }

  function getMaxSheetSequenceForDate(dateYyyyMmDd, ss) {
    var sheet = Config.getSheetOrThrow(Config.SHEETS.RESERVATIONS, ss);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return 0;
    }

    var prefix = 'STAY-' + dateYyyyMmDd + '-';
    var values = sheet.getRange(2, Config.RESERVATION_COLS.REFERENCE_NUMBER, lastRow - 1, 1).getDisplayValues();
    var maxSeq = 0;

    for (var i = 0; i < values.length; i++) {
      var ref = String(values[i][0] || '').trim();
      if (ref.indexOf(prefix) === 0) {
        var suffix = ref.substring(prefix.length);
        var parsed = parseInt(suffix, 10);
        if (!isNaN(parsed) && parsed > maxSeq) {
          maxSeq = parsed;
        }
      }
    }
    return maxSeq;
  }

  /**
   * Generates the next unique reference number.
   * Caller MUST already hold the ScriptLock when calling generateNextInLock().
   */
  function generateNextInLock(submissionDate, ss, timezone) {
    var settings = Config.getSettings(ss);
    var tz = timezone || settings.timezone || Config.DEFAULT_TIMEZONE;
    var refDate = submissionDate || new Date();
    var datePart = Utilities.formatDate(refDate, tz, 'yyyyMMdd');

    var props = PropertiesService.getScriptProperties();
    var propKey = Config.PROPERTY_PREFIXES.REF_COUNTER + datePart;
    var storedCounter = parseInt(props.getProperty(propKey) || '0', 10);
    if (isNaN(storedCounter) || storedCounter < 0) {
      storedCounter = 0;
    }

    var sheetMax = getMaxSheetSequenceForDate(datePart, ss);
    var nextSeq = Math.max(storedCounter, sheetMax) + 1;

    props.setProperty(propKey, String(nextSeq));
    pruneOldCounters(props, refDate, tz);
    return formatReferenceNumber(datePart, nextSeq);
  }

  /**
   * Prunes daily REF_SEQ_YYYYMMDD keys older than 7 days to prevent
   * unbounded ScriptProperties growth.
   */
  function pruneOldCounters(props, refDate, tz) {
    try {
      var cutoffDate = new Date(refDate.getTime() - 7 * 24 * 60 * 60 * 1000);
      var cutoffPart = Utilities.formatDate(cutoffDate, tz, 'yyyyMMdd');
      var allProps = props.getProperties() || {};
      var prefix = Config.PROPERTY_PREFIXES.REF_COUNTER;
      var keys = Object.keys(allProps);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf(prefix) === 0) {
          var suffix = keys[i].substring(prefix.length);
          if (/^\d{8}$/.test(suffix) && suffix < cutoffPart) {
            props.deleteProperty(keys[i]);
          }
        }
      }
    } catch (pruneErr) {
      Logger.log('Note: Failed to prune old reference counters: ' + pruneErr);
    }
  }

  /**
   * Acquires ScriptLock and generates the next unique STAY-YYYYMMDD-XXXX reference.
   */
  function generateUniqueReferenceNumber(submissionDate, ss, timezone) {
    return Utils.withScriptLock(function () {
      return generateNextInLock(submissionDate, ss, timezone);
    });
  }

  return Object.freeze({
    formatReferenceNumber: formatReferenceNumber,
    getMaxSheetSequenceForDate: getMaxSheetSequenceForDate,
    generateNextInLock: generateNextInLock,
    generateUniqueReferenceNumber: generateUniqueReferenceNumber
  });
})();
