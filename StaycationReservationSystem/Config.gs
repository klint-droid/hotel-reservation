/**
 * Config.gs
 * Centralized configuration, schema constants, status enums, validation bounds,
 * and Settings sheet accessors for the Staycation Reservation & Endorsement System.
 *
 * All other modules MUST reference these constants rather than hardcoding
 * sheet names, column indices, status strings, or placeholders.
 */

var Config = (function () {
  var APP_NAME = 'Staycation Reservation & Endorsement System';
  var APP_VERSION = '1.0.0-mvp';
  var DEFAULT_TIMEZONE = 'Asia/Manila';
  var MENU_TITLE = 'STAYCATION MANAGEMENT';

  var SHEETS = Object.freeze({
    RESERVATIONS: 'Reservations',
    EMAIL_LOGS: 'Email Logs',
    SETTINGS: 'Settings',
    ACTIVITY_LOGS: 'Activity Logs',
    RAW_FORM_RESPONSES: 'Form Responses 1',
    SYSTEM_INTEGRITY: '_SystemIntegrity'
  });

  // Exact 1-based column indices for Sheet 1: Reservations (Columns A-T)
  var RESERVATION_COLS = Object.freeze({
    RESERVATION_ID: 1,    // A
    REFERENCE_NUMBER: 2,  // B
    GUEST_NAME: 3,        // C
    EMAIL_ADDRESS: 4,     // D
    CONTACT_NUMBER: 5,    // E
    CHECK_IN_DATE: 6,     // F
    CHECK_OUT_DATE: 7,    // G
    NUMBER_OF_GUESTS: 8,  // H
    NUMBER_OF_ROOMS: 9,   // I
    SPECIAL_REQUESTS: 10, // J
    APPROVAL_STATUS: 11,  // K
    ADMIN_REMARKS: 12,    // L
    EMAIL_STATUS: 13,     // M
    SUBMITTED_AT: 14,     // N
    APPROVED_AT: 15,      // O
    APPROVED_BY: 16,      // P
    PDF_FILE_ID: 17,      // Q
    PDF_FILE_URL: 18,     // R
    EMAIL_SENT_AT: 19,    // S
    LAST_ERROR: 20        // T
  });

  var RESERVATION_HEADERS = Object.freeze([
    'Reservation ID',
    'Reference Number',
    'Guest Name',
    'Email Address',
    'Contact Number',
    'Check-in Date',
    'Check-out Date',
    'Number of Guests',
    'Number of Rooms',
    'Special Requests',
    'Approval Status',
    'Admin Remarks',
    'Email Status',
    'Submitted At',
    'Approved At',
    'Approved By',
    'PDF File ID',
    'PDF File URL',
    'Email Sent At',
    'Last Error'
  ]);

  // Columns whose values appear on the endorsement certificate / affect endorsed details.
  // Modifying any of these on an APPROVED row triggers approval revocation & PDF invalidation.
  var ENDORSED_COLUMNS = Object.freeze([
    RESERVATION_COLS.GUEST_NAME,
    RESERVATION_COLS.EMAIL_ADDRESS,
    RESERVATION_COLS.CONTACT_NUMBER,
    RESERVATION_COLS.CHECK_IN_DATE,
    RESERVATION_COLS.CHECK_OUT_DATE,
    RESERVATION_COLS.NUMBER_OF_GUESTS,
    RESERVATION_COLS.NUMBER_OF_ROOMS
  ]);

  // System-managed columns protected from manual spreadsheet editing.
  var PROTECTED_RESERVATION_COLUMNS = Object.freeze([
    RESERVATION_COLS.RESERVATION_ID,
    RESERVATION_COLS.REFERENCE_NUMBER,
    RESERVATION_COLS.APPROVAL_STATUS,
    RESERVATION_COLS.EMAIL_STATUS,
    RESERVATION_COLS.SUBMITTED_AT,
    RESERVATION_COLS.APPROVED_AT,
    RESERVATION_COLS.APPROVED_BY,
    RESERVATION_COLS.PDF_FILE_ID,
    RESERVATION_COLS.PDF_FILE_URL,
    RESERVATION_COLS.EMAIL_SENT_AT,
    RESERVATION_COLS.LAST_ERROR
  ]);

  // Exact 1-based column indices for Sheet 2: Email Logs (Columns A-J)
  var EMAIL_LOG_COLS = Object.freeze({
    LOG_ID: 1,           // A
    RESERVATION_ID: 2,   // B
    REFERENCE_NUMBER: 3, // C
    RECIPIENT_EMAIL: 4,  // D
    EMAIL_SUBJECT: 5,    // E
    EMAIL_STATUS: 6,     // F
    DATE_ATTEMPTED: 7,   // G
    DATE_SENT: 8,        // H
    ERROR_MESSAGE: 9,    // I
    ADMINISTRATOR: 10    // J
  });

  var EMAIL_LOG_HEADERS = Object.freeze([
    'Log ID',
    'Reservation ID',
    'Reference Number',
    'Recipient Email',
    'Email Subject',
    'Email Status',
    'Date Attempted',
    'Date Sent',
    'Error Message',
    'Administrator'
  ]);

  // Exact 1-based column indices for Sheet 3: Settings (Columns A-D)
  var SETTINGS_COLS = Object.freeze({
    KEY: 1,         // A
    VALUE: 2,       // B
    DESCRIPTION: 3, // C
    REQUIRED: 4     // D
  });

  var SETTINGS_HEADERS = Object.freeze([
    'Setting Key',
    'Setting Value',
    'Description',
    'Required'
  ]);

  // Exact 1-based column indices for Sheet 4: Activity Logs (Columns A-I)
  var ACTIVITY_LOG_COLS = Object.freeze({
    ACTIVITY_ID: 1,      // A
    RESERVATION_ID: 2,   // B
    REFERENCE_NUMBER: 3, // C
    ADMINISTRATOR: 4,    // D
    ACTION: 5,           // E
    PREVIOUS_VALUE: 6,   // F
    NEW_VALUE: 7,        // G
    TIMESTAMP: 8,        // H
    REMARKS: 9           // I
  });

  var ACTIVITY_LOG_HEADERS = Object.freeze([
    'Activity ID',
    'Reservation ID',
    'Reference Number',
    'Administrator',
    'Action',
    'Previous Value',
    'New Value',
    'Timestamp',
    'Remarks'
  ]);

  var APPROVAL_STATUS = Object.freeze({
    PENDING: 'PENDING',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED'
  });

  var EMAIL_STATUS = Object.freeze({
    NOT_SENT: 'NOT_SENT',
    SENT: 'SENT',
    FAILED: 'FAILED'
  });

  var ACTIVITY_ACTIONS = Object.freeze({
    RESERVATION_CREATED: 'RESERVATION_CREATED',
    RESERVATION_APPROVED: 'RESERVATION_APPROVED',
    RESERVATION_REJECTED: 'RESERVATION_REJECTED',
    APPROVAL_REVOKED: 'APPROVAL_REVOKED',
    PDF_GENERATED: 'PDF_GENERATED',
    PDF_INVALIDATED: 'PDF_INVALIDATED',
    PDF_GENERATION_FAILED: 'PDF_GENERATION_FAILED',
    ENDORSEMENT_EMAIL_SENT: 'ENDORSEMENT_EMAIL_SENT',
    ENDORSEMENT_EMAIL_FAILED: 'ENDORSEMENT_EMAIL_FAILED',
    POST_SEND_EDIT_WARNING: 'POST_SEND_EDIT_WARNING',
    DUPLICATE_SUBMISSION_BLOCKED: 'DUPLICATE_SUBMISSION_BLOCKED',
    DUPLICATE_SUBMISSION_FLAGGED: 'DUPLICATE_SUBMISSION_FLAGGED',
    VALIDATION_FAILED: 'VALIDATION_FAILED',
    SETTINGS_UPDATED: 'SETTINGS_UPDATED',
    UNAUTHORIZED_ACCESS: 'UNAUTHORIZED_ACCESS',
    SYSTEM_SETUP: 'SYSTEM_SETUP'
  });

  var SETTINGS_KEYS = Object.freeze({
    STAYCATION_NAME: 'STAYCATION_NAME',
    STAYCATION_LOGO_URL: 'STAYCATION_LOGO_URL',
    STAYCATION_CONTACT_NUMBER: 'STAYCATION_CONTACT_NUMBER',
    STAYCATION_EMAIL_ADDRESS: 'STAYCATION_EMAIL_ADDRESS',
    STAYCATION_FACEBOOK_PAGE: 'STAYCATION_FACEBOOK_PAGE',
    CHECK_IN_TIME: 'CHECK_IN_TIME',
    CHECK_OUT_TIME: 'CHECK_OUT_TIME',
    DOCS_TEMPLATE_ID: 'DOCS_TEMPLATE_ID',
    DRIVE_OUTPUT_FOLDER_ID: 'DRIVE_OUTPUT_FOLDER_ID',
    ADMINISTRATOR_EMAIL: 'ADMINISTRATOR_EMAIL',
    TIMEZONE: 'TIMEZONE'
  });

  var DEFAULT_SETTINGS_ROWS = Object.freeze([
    [
      SETTINGS_KEYS.STAYCATION_NAME,
      '[CONFIGURE: Staycation Name]',
      'Official name of your staycation property displayed on certificates and emails.',
      'YES'
    ],
    [
      SETTINGS_KEYS.STAYCATION_LOGO_URL,
      '[CONFIGURE: Drive File ID or HTTPS Logo URL]',
      'Optional logo Google Drive File ID or direct HTTPS PNG/JPG URL for the endorsement header.',
      'NO'
    ],
    [
      SETTINGS_KEYS.STAYCATION_CONTACT_NUMBER,
      '[CONFIGURE: Contact Number]',
      'Official staycation contact phone number shown on certificates and emails.',
      'YES'
    ],
    [
      SETTINGS_KEYS.STAYCATION_EMAIL_ADDRESS,
      '[CONFIGURE: Staycation Email]',
      'Official staycation email address used for contact info, reply-to, and verified alias sending.',
      'YES'
    ],
    [
      SETTINGS_KEYS.STAYCATION_FACEBOOK_PAGE,
      '[CONFIGURE: Facebook Page URL or Handle]',
      'Official Facebook page link or handle displayed on endorsement certificates.',
      'NO'
    ],
    [
      SETTINGS_KEYS.CHECK_IN_TIME,
      '2:00 PM',
      'Standard guest check-in time displayed on the endorsement certificate.',
      'YES'
    ],
    [
      SETTINGS_KEYS.CHECK_OUT_TIME,
      '12:00 PM',
      'Standard guest check-out time displayed on the endorsement certificate.',
      'YES'
    ],
    [
      SETTINGS_KEYS.DOCS_TEMPLATE_ID,
      '[CONFIGURE: Google Docs Template ID]',
      'Google Docs ID of the master Reservation Endorsement template.',
      'YES'
    ],
    [
      SETTINGS_KEYS.DRIVE_OUTPUT_FOLDER_ID,
      '[CONFIGURE: Drive Output Folder ID]',
      'Private Google Drive Folder ID where generated endorsement PDFs are stored.',
      'YES'
    ],
    [
      SETTINGS_KEYS.ADMINISTRATOR_EMAIL,
      '[CONFIGURE: Admin Email(s), comma-separated]',
      'Authorized administrator Google account email(s), comma-separated.',
      'YES'
    ],
    [
      SETTINGS_KEYS.TIMEZONE,
      DEFAULT_TIMEZONE,
      'IANA timezone used for timestamps, dates, and reference numbers (default: Asia/Manila).',
      'YES'
    ]
  ]);

  var FORM_CONFIG = Object.freeze({
    TITLE: 'Staycation Reservation Registration',
    DESCRIPTION: [
      'Thank you for choosing our staycation!',
      'Please complete this form with accurate information. Your reservation details will be reviewed by our administrator before confirmation.',
      'You will receive an endorsement email once your reservation has been verified and approved.'
    ].join('\n'),
    FIELDS: Object.freeze({
      FULL_NAME: 'Full Name',
      EMAIL_ADDRESS: 'Email Address',
      CONTACT_NUMBER: 'Contact Number',
      CHECK_IN_DATE: 'Check-in Date',
      CHECK_OUT_DATE: 'Check-out Date',
      NUMBER_OF_GUESTS: 'Number of Guests',
      NUMBER_OF_ROOMS: 'Number of Rooms',
      SPECIAL_REQUESTS: 'Special Requests',
      AGREEMENT: 'Agreement to House Rules'
    }),
    ROOM_OPTIONS: Object.freeze(['1', '2', '3', '4', '5+', 'Not Applicable']),
    AGREEMENT_LABEL: 'I have read and agree to the Staycation House Rules.'
  });

  var STATUS_COLORS = Object.freeze({
    PENDING: { bg: '#FFF3CD', fg: '#856404' },
    APPROVED: { bg: '#D4EDDA', fg: '#155724' },
    REJECTED: { bg: '#F8D7DA', fg: '#721C24' },
    NOT_SENT: { bg: '#E2E3E5', fg: '#383D41' },
    SENT: { bg: '#D4EDDA', fg: '#155724' },
    FAILED: { bg: '#F8D7DA', fg: '#721C24' }
  });

  var BRAND_COLORS = Object.freeze({
    DARK_GREEN: '#1B4332',
    WARM_BEIGE: '#F5EFE6',
    WHITE: '#FFFFFF',
    GOLD: '#C5A059',
    CHARCOAL: '#2B2D2F',
    MUTED_TEXT: '#5C636A'
  });

  var PLACEHOLDERS = Object.freeze({
    STAYCATION_NAME: '{{STAYCATION_NAME}}',
    STAYCATION_LOGO: '{{STAYCATION_LOGO}}',
    GUEST_NAME: '{{GUEST_NAME}}',
    REFERENCE_NUMBER: '{{REFERENCE_NUMBER}}',
    CHECK_IN_DATE: '{{CHECK_IN_DATE}}',
    CHECK_IN_TIME: '{{CHECK_IN_TIME}}',
    CHECK_OUT_DATE: '{{CHECK_OUT_DATE}}',
    CHECK_OUT_TIME: '{{CHECK_OUT_TIME}}',
    NUMBER_OF_GUESTS: '{{NUMBER_OF_GUESTS}}',
    NUMBER_OF_ROOMS: '{{NUMBER_OF_ROOMS}}',
    CONTACT_NUMBER: '{{CONTACT_NUMBER}}',
    STAYCATION_EMAIL: '{{STAYCATION_EMAIL}}',
    FACEBOOK_PAGE: '{{FACEBOOK_PAGE}}'
  });

  var PROPERTY_PREFIXES = Object.freeze({
    REF_COUNTER: 'REF_SEQ_',
    APPROVAL_HASH: 'APPR_HASH_',
    PDF_HASH: 'PDF_HASH_',
    PROCESSED_FORM_RESPONSE: 'FORM_RESP_',
    AUTHORIZED_ADMINS: 'AUTHORIZED_ADMINS_CSV',
    ALLOW_OWNER_EFFECTIVE_FALLBACK: 'ALLOW_OWNER_EFFECTIVE_FALLBACK',
    FORM_ID: 'LINKED_FORM_ID'
  });

  var LIMITS = Object.freeze({
    LOCK_TIMEOUT_MS: 30000,
    MIN_NAME_LENGTH: 2,
    MAX_NAME_LENGTH: 120,
    MAX_SPECIAL_REQUESTS_LENGTH: 1000,
    MAX_REMARKS_LENGTH: 1000,
    MIN_GUESTS: 1,
    MAX_GUESTS: 100,
    MAX_FILENAME_NAME_LENGTH: 60
  });

  var ERROR_CODES = Object.freeze({
    UNAUTHORIZED: 'ERR_UNAUTHORIZED',
    VALIDATION_FAILED: 'ERR_VALIDATION_FAILED',
    NOT_FOUND: 'ERR_NOT_FOUND',
    INVALID_STATE: 'ERR_INVALID_STATE',
    INTEGRITY_MISMATCH: 'ERR_INTEGRITY_MISMATCH',
    DUPLICATE_SUBMISSION: 'ERR_DUPLICATE_SUBMISSION',
    DUPLICATE_EMAIL: 'ERR_DUPLICATE_EMAIL',
    MISSING_SPREADSHEET: 'ERR_MISSING_SPREADSHEET',
    MISSING_TEMPLATE: 'ERR_MISSING_TEMPLATE',
    MISSING_FOLDER: 'ERR_MISSING_FOLDER',
    UNRESOLVED_PLACEHOLDERS: 'ERR_UNRESOLVED_PLACEHOLDERS',
    PDF_GENERATION_FAILED: 'ERR_PDF_GENERATION_FAILED',
    PDF_MISSING: 'ERR_PDF_MISSING',
    EMAIL_SEND_FAILED: 'ERR_EMAIL_SEND_FAILED',
    QUOTA_EXCEEDED: 'ERR_QUOTA_EXCEEDED',
    LOCK_TIMEOUT: 'ERR_LOCK_TIMEOUT',
    INTERNAL_ERROR: 'ERR_INTERNAL_ERROR'
  });

  function isUnconfiguredValue(value) {
    if (value === null || value === undefined) {
      return true;
    }
    var trimmed = String(value).trim();
    if (!trimmed) {
      return true;
    }
    return /^\[CONFIGURE:.*\]$/i.test(trimmed) || /^REPLACE_WITH_/i.test(trimmed);
  }

  function getActiveSpreadsheetOrThrow(ss) {
    var spreadsheet = ss || SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) {
      throw Utils.createAppError(
        ERROR_CODES.MISSING_SPREADSHEET,
        'Active Staycation Management Spreadsheet could not be found.'
      );
    }
    return spreadsheet;
  }

  function getSheetOrThrow(sheetName, ss) {
    var spreadsheet = getActiveSpreadsheetOrThrow(ss);
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      throw Utils.createAppError(
        ERROR_CODES.MISSING_SPREADSHEET,
        'Required sheet "' + sheetName + '" is missing. Run Setup -> initializeSpreadsheet() first.'
      );
    }
    return sheet;
  }

  function parseAdminEmails(rawCsv) {
    if (isUnconfiguredValue(rawCsv)) {
      return [];
    }
    var parts = String(rawCsv).split(/[,;\n]+/);
    var result = [];
    var seen = {};
    for (var i = 0; i < parts.length; i++) {
      var email = String(parts[i]).trim().toLowerCase();
      if (email && !seen[email]) {
        seen[email] = true;
        result.push(email);
      }
    }
    return result;
  }

  function getSettings(ss) {
    var rawMap = {};
    for (var d = 0; d < DEFAULT_SETTINGS_ROWS.length; d++) {
      rawMap[DEFAULT_SETTINGS_ROWS[d][0]] = DEFAULT_SETTINGS_ROWS[d][1];
    }

    var spreadsheet = ss || SpreadsheetApp.getActiveSpreadsheet();
    if (spreadsheet) {
      var sheet = spreadsheet.getSheetByName(SHEETS.SETTINGS);
      if (sheet && sheet.getLastRow() >= 2) {
        var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
        for (var i = 0; i < values.length; i++) {
          var key = String(values[i][0] || '').trim();
          var val = values[i][1];
          if (key) {
            rawMap[key] = val === null || val === undefined
              ? ''
              : Utils.stripLeadingQuote(String(val).trim());
          }
        }
      }
    }

    var tz = rawMap[SETTINGS_KEYS.TIMEZONE];
    if (isUnconfiguredValue(tz)) {
      tz = DEFAULT_TIMEZONE;
    }

    return {
      raw: rawMap,
      staycationName: rawMap[SETTINGS_KEYS.STAYCATION_NAME] || '',
      staycationLogoUrl: rawMap[SETTINGS_KEYS.STAYCATION_LOGO_URL] || '',
      staycationContactNumber: rawMap[SETTINGS_KEYS.STAYCATION_CONTACT_NUMBER] || '',
      staycationEmailAddress: rawMap[SETTINGS_KEYS.STAYCATION_EMAIL_ADDRESS] || '',
      staycationFacebookPage: rawMap[SETTINGS_KEYS.STAYCATION_FACEBOOK_PAGE] || '',
      checkInTime: rawMap[SETTINGS_KEYS.CHECK_IN_TIME] || '2:00 PM',
      checkOutTime: rawMap[SETTINGS_KEYS.CHECK_OUT_TIME] || '12:00 PM',
      docsTemplateId: rawMap[SETTINGS_KEYS.DOCS_TEMPLATE_ID] || '',
      driveOutputFolderId: rawMap[SETTINGS_KEYS.DRIVE_OUTPUT_FOLDER_ID] || '',
      administratorEmailRaw: rawMap[SETTINGS_KEYS.ADMINISTRATOR_EMAIL] || '',
      administratorEmails: parseAdminEmails(rawMap[SETTINGS_KEYS.ADMINISTRATOR_EMAIL]),
      timezone: tz
    };
  }

  function saveSettings(updates, ss) {
    var sheet = getSheetOrThrow(SHEETS.SETTINGS, ss);
    var lastRow = sheet.getLastRow();
    var existingKeyToRow = {};

    if (lastRow >= 2) {
      var keys = sheet.getRange(2, SETTINGS_COLS.KEY, lastRow - 1, 1).getValues();
      for (var i = 0; i < keys.length; i++) {
        var k = String(keys[i][0] || '').trim();
        if (k) {
          existingKeyToRow[k] = i + 2;
        }
      }
    }

    var validKeySet = {};
    for (var j = 0; j < DEFAULT_SETTINGS_ROWS.length; j++) {
      validKeySet[DEFAULT_SETTINGS_ROWS[j][0]] = DEFAULT_SETTINGS_ROWS[j];
    }

    var changedKeys = [];
    var updateKeys = Object.keys(updates || {});
    for (var u = 0; u < updateKeys.length; u++) {
      var key = updateKeys[u];
      if (!validKeySet[key]) {
        continue;
      }
      var newValue = updates[key] === null || updates[key] === undefined
        ? ''
        : String(updates[key]).trim();
      var safeVal = Utils.sanitizeSheetCell(newValue);

      if (existingKeyToRow[key]) {
        var cell = sheet.getRange(existingKeyToRow[key], SETTINGS_COLS.VALUE);
        cell.setNumberFormat('@');
        cell.setValue(safeVal);
      } else {
        var meta = validKeySet[key];
        sheet.appendRow([key, safeVal, meta[2], meta[3]]);
      }
      changedKeys.push(key);
    }

    // Mirror authorized administrator allowlist into ScriptProperties (authoritative store)
    if (updates && Object.prototype.hasOwnProperty.call(updates, SETTINGS_KEYS.ADMINISTRATOR_EMAIL)) {
      var admins = parseAdminEmails(updates[SETTINGS_KEYS.ADMINISTRATOR_EMAIL]);
      PropertiesService.getScriptProperties().setProperty(
        PROPERTY_PREFIXES.AUTHORIZED_ADMINS,
        admins.join(',')
      );
    }

    // Keep spreadsheet timezone synchronized when TIMEZONE setting is updated
    if (updates && Object.prototype.hasOwnProperty.call(updates, SETTINGS_KEYS.TIMEZONE)) {
      var newTz = String(updates[SETTINGS_KEYS.TIMEZONE] || '').trim();
      if (newTz && !isUnconfiguredValue(newTz)) {
        try {
          getActiveSpreadsheetOrThrow(ss).setSpreadsheetTimeZone(newTz);
        } catch (tzErr) {
          Logger.log('Warning: Could not synchronize spreadsheet timezone: ' + tzErr);
        }
      }
    }

    return {
      changedKeys: changedKeys,
      settings: getSettings(ss)
    };
  }

  return Object.freeze({
    APP_NAME: APP_NAME,
    APP_VERSION: APP_VERSION,
    DEFAULT_TIMEZONE: DEFAULT_TIMEZONE,
    MENU_TITLE: MENU_TITLE,
    SHEETS: SHEETS,
    RESERVATION_COLS: RESERVATION_COLS,
    RESERVATION_HEADERS: RESERVATION_HEADERS,
    ENDORSED_COLUMNS: ENDORSED_COLUMNS,
    PROTECTED_RESERVATION_COLUMNS: PROTECTED_RESERVATION_COLUMNS,
    EMAIL_LOG_COLS: EMAIL_LOG_COLS,
    EMAIL_LOG_HEADERS: EMAIL_LOG_HEADERS,
    SETTINGS_COLS: SETTINGS_COLS,
    SETTINGS_HEADERS: SETTINGS_HEADERS,
    ACTIVITY_LOG_COLS: ACTIVITY_LOG_COLS,
    ACTIVITY_LOG_HEADERS: ACTIVITY_LOG_HEADERS,
    APPROVAL_STATUS: APPROVAL_STATUS,
    EMAIL_STATUS: EMAIL_STATUS,
    ACTIVITY_ACTIONS: ACTIVITY_ACTIONS,
    SETTINGS_KEYS: SETTINGS_KEYS,
    DEFAULT_SETTINGS_ROWS: DEFAULT_SETTINGS_ROWS,
    FORM_CONFIG: FORM_CONFIG,
    STATUS_COLORS: STATUS_COLORS,
    BRAND_COLORS: BRAND_COLORS,
    PLACEHOLDERS: PLACEHOLDERS,
    PROPERTY_PREFIXES: PROPERTY_PREFIXES,
    LIMITS: LIMITS,
    ERROR_CODES: ERROR_CODES,
    isUnconfiguredValue: isUnconfiguredValue,
    getActiveSpreadsheetOrThrow: getActiveSpreadsheetOrThrow,
    getSheetOrThrow: getSheetOrThrow,
    parseAdminEmails: parseAdminEmails,
    getSettings: getSettings,
    saveSettings: saveSettings
  });
})();
