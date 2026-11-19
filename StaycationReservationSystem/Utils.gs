/**
 * Utils.gs
 * Pure helper utilities shared across all Staycation Reservation modules:
 * - UUID generation
 * - Timezone-safe calendar date parsing and formatting
 * - Filename and spreadsheet formula-injection sanitization
 * - HTML escaping
 * - Deterministic SHA-256 integrity hashing of endorsed fields
 * - ScriptLock concurrency wrapper
 * - Standardized ServiceResult and AppError builders
 */

var Utils = (function () {
  function createAppError(code, message, details) {
    var err = new Error(message || 'An unexpected application error occurred.');
    err.name = 'StaycationAppError';
    err.code = code || Config.ERROR_CODES.INTERNAL_ERROR;
    err.details = details || null;
    return err;
  }

  function ok(message, data, code) {
    return {
      ok: true,
      code: code || 'OK',
      message: message || 'Success',
      data: data === undefined ? null : data,
      errors: []
    };
  }

  function fail(code, message, errors, data) {
    return {
      ok: false,
      code: code || Config.ERROR_CODES.INTERNAL_ERROR,
      message: message || 'Operation failed.',
      data: data === undefined ? null : data,
      errors: Array.isArray(errors) ? errors : (message ? [message] : [])
    };
  }

  function errorToResult(err, fallbackMessage) {
    if (!err) {
      return fail(Config.ERROR_CODES.INTERNAL_ERROR, fallbackMessage || 'Unknown error.');
    }
    var code = err.code || Config.ERROR_CODES.INTERNAL_ERROR;
    var msg = err.message || fallbackMessage || String(err);
    var errors = Array.isArray(err.details) ? err.details : [msg];
    return fail(code, msg, errors);
  }

  function generateUuid(prefix) {
    var raw = Utilities.getUuid();
    return prefix ? (prefix + '-' + raw) : raw;
  }

  function pad2(n) {
    return n < 10 ? ('0' + n) : String(n);
  }

  function pad4(n) {
    var s = String(n);
    while (s.length < 4) {
      s = '0' + s;
    }
    return s;
  }

  function isRealCalendarDate(year, month, day) {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
      return false;
    }
    if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
      return false;
    }
    var probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    return (
      probe.getUTCFullYear() === year &&
      probe.getUTCMonth() === month - 1 &&
      probe.getUTCDate() === day
    );
  }

  /**
   * Parses a Date object or date string into a canonical 'YYYY-MM-DD' string
   * in the configured timezone, returning null if invalid.
   */
  function parseCalendarDate(value, timezone) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    var tz = timezone || Config.DEFAULT_TIMEZONE;

    if (Object.prototype.toString.call(value) === '[object Date]') {
      if (isNaN(value.getTime())) {
        return null;
      }
      return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
    }

    var str = String(value).trim();
    if (!str) {
      return null;
    }

    // YYYY-MM-DD (or ISO string starting with YYYY-MM-DD)
    var isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(str);
    if (isoMatch) {
      var y = parseInt(isoMatch[1], 10);
      var m = parseInt(isoMatch[2], 10);
      var d = parseInt(isoMatch[3], 10);
      if (!isRealCalendarDate(y, m, d)) {
        return null;
      }
      return y + '-' + pad2(m) + '-' + pad2(d);
    }

    // MM/DD/YYYY (common Google Forms / Sheets US locale format)
    var usMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str);
    if (usMatch) {
      var um = parseInt(usMatch[1], 10);
      var ud = parseInt(usMatch[2], 10);
      var uy = parseInt(usMatch[3], 10);
      if (!isRealCalendarDate(uy, um, ud)) {
        return null;
      }
      return uy + '-' + pad2(um) + '-' + pad2(ud);
    }

    // Fallback: Date.parse for human-readable dates like "November 19, 2026"
    var parsed = new Date(str);
    if (isNaN(parsed.getTime())) {
      return null;
    }
    return Utilities.formatDate(parsed, tz, 'yyyy-MM-dd');
  }

  function getTodayDateString(nowDate, timezone) {
    var tz = timezone || Config.DEFAULT_TIMEZONE;
    var ref = nowDate || new Date();
    return Utilities.formatDate(ref, tz, 'yyyy-MM-dd');
  }

  function formatTimestamp(dateObj, timezone) {
    if (!dateObj) {
      return '';
    }
    var tz = timezone || Config.DEFAULT_TIMEZONE;
    var d = Object.prototype.toString.call(dateObj) === '[object Date]'
      ? dateObj
      : new Date(dateObj);
    if (isNaN(d.getTime())) {
      return String(dateObj);
    }
    return Utilities.formatDate(d, tz, 'yyyy-MM-dd HH:mm:ss');
  }

  function formatDisplayDate(isoDateString, timezone) {
    var canonical = parseCalendarDate(isoDateString, timezone);
    if (!canonical) {
      return String(isoDateString || '');
    }
    var parts = canonical.split('-');
    var anchor = new Date(Date.UTC(
      parseInt(parts[0], 10),
      parseInt(parts[1], 10) - 1,
      parseInt(parts[2], 10),
      12, 0, 0
    ));
    return Utilities.formatDate(anchor, 'UTC', 'MMMM d, yyyy');
  }

  function normalizeEmail(email) {
    if (email === null || email === undefined) {
      return '';
    }
    return String(email).trim().toLowerCase();
  }

  function normalizePhone(phone) {
    if (phone === null || phone === undefined) {
      return '';
    }
    return String(phone).trim().replace(/\s+/g, ' ');
  }

  function normalizeText(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).replace(/\r\n/g, '\n').trim();
  }

  /**
   * Neutralizes Google Sheets formula injection (DDE / =IMPORTXML / etc.)
   * while preserving legitimate display values.
   */
  function sanitizeSheetCell(value) {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value !== 'string') {
      return value;
    }
    var cleaned = value.trim();
    if (!cleaned) {
      return '';
    }
    var firstChar = cleaned.charAt(0);
    if (firstChar === '=' || firstChar === '+' || firstChar === '-' || firstChar === '@' || firstChar === '\t' || firstChar === '\r') {
      return "'" + cleaned;
    }
    return cleaned;
  }

  /**
   * Removes leading text-escape apostrophe ONLY when escaping a formula-triggering
   * character (=, +, -, @, tab, CR) so legitimate strings starting with "'" stay intact.
   */
  function stripLeadingQuote(value) {
    if (value === null || value === undefined) {
      return '';
    }
    var str = String(value);
    if (str.length >= 2 && str.charAt(0) === "'") {
      var next = str.charAt(1);
      if (next === '=' || next === '+' || next === '-' || next === '@' || next === '\t' || next === '\r') {
        return str.substring(1);
      }
    }
    return str;
  }

  /**
   * Redacts credentials, bearer tokens, and URL query strings before writing to logs or Last Error.
   */
  function redactSensitiveText(value, maxLen) {
    if (value === null || value === undefined) {
      return '';
    }
    var limit = maxLen || 500;
    var text = String(value)
      .replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, '$1[REDACTED]')
      .replace(/(password|token|secret|api[_-]?key|authorization)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
      .replace(/(https?:\/\/[^\s?]+)\?[^\s)]+/gi, '$1?[REDACTED]')
      .trim();
    if (text.length > limit) {
      text = text.substring(0, limit - 3) + '...';
    }
    return text;
  }

  function isValidGoogleDriveUrl(url) {
    if (!url || typeof url !== 'string') {
      return false;
    }
    return /^https:\/\/(drive|docs)\.google\.com\//i.test(url.trim());
  }

  /**
   * Sanitizes a guest name or identifier for safe, clean PDF filenames.
   * Example: "Juan Dela Cruz" -> "JUAN-DELA-CRUZ"
   */
  function sanitizeFilenameSegment(text, maxLength) {
    var limit = maxLength || Config.LIMITS.MAX_FILENAME_NAME_LENGTH;
    var normalized = String(text || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');

    if (!normalized) {
      normalized = 'UNKNOWN';
    }
    if (normalized.length > limit) {
      normalized = normalized.substring(0, limit).replace(/-+$/, '');
    }
    return normalized || 'UNKNOWN';
  }

  /**
   * Escapes special characters for safe HTML interpolation (XSS defense).
   */
  function escapeHtml(text) {
    if (text === null || text === undefined) {
      return '';
    }
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Escapes regex special characters for matching literal placeholder strings.
   */
  function escapeRegexPattern(text) {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Escapes replacement string tokens for Google Docs Body.replaceText (Java regex semantics:
   * backslashes become \\ and dollar signs become \$).
   */
  function escapeRegexReplacement(text) {
    return String(text === null || text === undefined ? '' : text)
      .replace(/\\/g, '\\\\')
      .replace(/\$/g, '\\$$');
  }

  /**
   * Computes a deterministic SHA-256 hex fingerprint over all endorsed
   * reservation details so post-approval manual edits are reliably detected.
   */
  function computeEndorsedHash(reservation, timezone) {
    var tz = timezone || Config.DEFAULT_TIMEZONE;
    var canonicalPayload = JSON.stringify({
      guestName: normalizeText(reservation.guestName),
      emailAddress: normalizeEmail(reservation.emailAddress),
      contactNumber: normalizePhone(reservation.contactNumber),
      checkInDate: parseCalendarDate(reservation.checkInDate, tz) || normalizeText(reservation.checkInDate),
      checkOutDate: parseCalendarDate(reservation.checkOutDate, tz) || normalizeText(reservation.checkOutDate),
      numberOfGuests: String(reservation.numberOfGuests === null || reservation.numberOfGuests === undefined ? '' : reservation.numberOfGuests).trim(),
      numberOfRooms: normalizeText(reservation.numberOfRooms || 'Not Applicable')
    });

    var digestBytes = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      canonicalPayload,
      Utilities.Charset.UTF_8
    );

    var hex = '';
    for (var i = 0; i < digestBytes.length; i++) {
      var byteVal = digestBytes[i];
      if (byteVal < 0) {
        byteVal += 256;
      }
      var part = byteVal.toString(16);
      hex += part.length === 1 ? ('0' + part) : part;
    }
    return hex;
  }

  /**
   * Executes a critical section while holding the Apps Script ScriptLock.
   */
  function withScriptLock(fn, timeoutMs) {
    var waitMs = timeoutMs || Config.LIMITS.LOCK_TIMEOUT_MS;
    var lock = LockService.getScriptLock();
    var acquired = false;
    try {
      acquired = lock.tryLock(waitMs);
      if (!acquired) {
        throw createAppError(
          Config.ERROR_CODES.LOCK_TIMEOUT,
          'The system is currently processing another operation. Please try again in a few seconds.'
        );
      }
      return fn();
    } finally {
      if (acquired) {
        try {
          lock.releaseLock();
        } catch (releaseErr) {
          Logger.log('Warning: Failed to release script lock: ' + releaseErr);
        }
      }
    }
  }

  /**
   * Extracts a Google Drive File ID from either a raw ID or a Drive URL.
   */
  function extractDriveFileId(input) {
    if (Config.isUnconfiguredValue(input)) {
      return null;
    }
    var str = String(input).trim();
    var patterns = [
      /\/d\/([a-zA-Z0-9_-]{8,})/,
      /[?&]id=([a-zA-Z0-9_-]{8,})/,
      /\/folders\/([a-zA-Z0-9_-]{8,})/
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = patterns[i].exec(str);
      if (m && m[1]) {
        return m[1];
      }
    }
    if (/^[a-zA-Z0-9_-]{8,}$/.test(str)) {
      return str;
    }
    return null;
  }

  /**
   * Serializes an object to JSON safe for embedding inside HTML <script> tags
   * (prevents </script> breakout and HTML injection).
   */
  function toSafeScriptJson(obj) {
    return JSON.stringify(obj === undefined ? null : obj)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  return Object.freeze({
    createAppError: createAppError,
    ok: ok,
    fail: fail,
    errorToResult: errorToResult,
    generateUuid: generateUuid,
    pad2: pad2,
    pad4: pad4,
    isRealCalendarDate: isRealCalendarDate,
    parseCalendarDate: parseCalendarDate,
    getTodayDateString: getTodayDateString,
    formatTimestamp: formatTimestamp,
    formatDisplayDate: formatDisplayDate,
    normalizeEmail: normalizeEmail,
    normalizePhone: normalizePhone,
    normalizeText: normalizeText,
    sanitizeSheetCell: sanitizeSheetCell,
    stripLeadingQuote: stripLeadingQuote,
    redactSensitiveText: redactSensitiveText,
    isValidGoogleDriveUrl: isValidGoogleDriveUrl,
    sanitizeFilenameSegment: sanitizeFilenameSegment,
    escapeHtml: escapeHtml,
    escapeRegexPattern: escapeRegexPattern,
    escapeRegexReplacement: escapeRegexReplacement,
    computeEndorsedHash: computeEndorsedHash,
    withScriptLock: withScriptLock,
    extractDriveFileId: extractDriveFileId,
    toSafeScriptJson: toSafeScriptJson
  });
})();
