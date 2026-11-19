/**
 * Setup.gs
 * Idempotent Google Workspace bootstrapper for the Staycation Reservation &
 * Endorsement Automation System.
 *
 * Run `runFullSetup()` once from the Google Apps Script editor (authorized as the
 * primary administrator) to initialize:
 *   1. All 4 Google Sheets (Reservations, Email Logs, Settings, Activity Logs)
 *      with formatting, dropdowns, conditional colors, filters, and protections
 *   2. Private Google Drive Output Folder for generated PDFs
 *   3. Professional Hotel-Style Master Google Docs Endorsement Template
 *   4. Public Google Form linked to the Spreadsheet (with hidden raw intake sheet)
 *   5. Installable onFormSubmit and onEdit triggers
 */

var SetupService = (function () {
  function getOrCreateSheet(ss, name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
    }
    return sheet;
  }

  function styleHeaderRow(sheet, headers) {
    var range = sheet.getRange(1, 1, 1, headers.length);
    range.setValues([headers]);
    range.setFontWeight('bold');
    range.setFontColor(Config.BRAND_COLORS.WHITE);
    range.setBackground(Config.BRAND_COLORS.DARK_GREEN);
    range.setHorizontalAlignment('center');
    range.setVerticalAlignment('middle');
    sheet.setFrozenRows(1);
    if (!sheet.getFilter()) {
      var filterRows = Math.max(sheet.getLastRow(), 1);
      sheet.getRange(1, 1, filterRows, headers.length).createFilter();
    }
  }

  function buildStatusConditionalRules(sheet, colIndex, startRow, numRows, statuses) {
    var range = sheet.getRange(startRow, colIndex, numRows, 1);
    var rules = [];
    for (var i = 0; i < statuses.length; i++) {
      var statusKey = statuses[i];
      var palette = Config.STATUS_COLORS[statusKey];
      if (!palette) {
        continue;
      }
      var rule = SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo(statusKey)
        .setBackground(palette.bg)
        .setFontColor(palette.fg)
        .setBold(true)
        .setRanges([range])
        .build();
      rules.push(rule);
    }
    return rules;
  }

  function applyProtection(target, description, warningOnly) {
    try {
      var protection = target.protect();
      protection.setDescription(description);
      protection.setWarningOnly(Boolean(warningOnly));
      return protection;
    } catch (err) {
      Logger.log('Warning: Could not apply protection "' + description + '": ' + err);
      return null;
    }
  }

  function setupReservationsSheet(ss) {
    var sheet = getOrCreateSheet(ss, Config.SHEETS.RESERVATIONS);
    styleHeaderRow(sheet, Config.RESERVATION_HEADERS);

    var maxRows = Math.max(sheet.getMaxRows(), 2);
    var dataRows = maxRows - 1;
    var C = Config.RESERVATION_COLS;

    // Column widths tailored for administrator readability
    var widths = {};
    widths[C.RESERVATION_ID] = 170;
    widths[C.REFERENCE_NUMBER] = 180;
    widths[C.GUEST_NAME] = 190;
    widths[C.EMAIL_ADDRESS] = 220;
    widths[C.CONTACT_NUMBER] = 150;
    widths[C.CHECK_IN_DATE] = 120;
    widths[C.CHECK_OUT_DATE] = 120;
    widths[C.NUMBER_OF_GUESTS] = 130;
    widths[C.NUMBER_OF_ROOMS] = 130;
    widths[C.SPECIAL_REQUESTS] = 240;
    widths[C.APPROVAL_STATUS] = 140;
    widths[C.ADMIN_REMARKS] = 240;
    widths[C.EMAIL_STATUS] = 130;
    widths[C.SUBMITTED_AT] = 165;
    widths[C.APPROVED_AT] = 165;
    widths[C.APPROVED_BY] = 200;
    widths[C.PDF_FILE_ID] = 180;
    widths[C.PDF_FILE_URL] = 220;
    widths[C.EMAIL_SENT_AT] = 165;
    widths[C.LAST_ERROR] = 260;
    widths[C.COMPANION_GUESTS] = 220;
    widths[C.VALID_ID_FILE_IDS] = 220;

    var colKeys = Object.keys(widths);
    for (var i = 0; i < colKeys.length; i++) {
      var colNum = parseInt(colKeys[i], 10);
      sheet.setColumnWidth(colNum, widths[colNum]);
    }

    // Consistent data & plain-text formatting (prevents leading-zero phone loss & timezone date drift)
    sheet.getRange(2, C.RESERVATION_ID, dataRows, 1).setNumberFormat('@');
    sheet.getRange(2, C.REFERENCE_NUMBER, dataRows, 1).setNumberFormat('@');
    sheet.getRange(2, C.CONTACT_NUMBER, dataRows, 1).setNumberFormat('@');
    sheet.getRange(2, C.CHECK_IN_DATE, dataRows, 1).setNumberFormat('@');
    sheet.getRange(2, C.CHECK_OUT_DATE, dataRows, 1).setNumberFormat('@');
    sheet.getRange(2, C.NUMBER_OF_GUESTS, dataRows, 1).setNumberFormat('0');
    sheet.getRange(2, C.NUMBER_OF_ROOMS, dataRows, 1).setNumberFormat('@');
    sheet.getRange(2, C.SUBMITTED_AT, dataRows, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange(2, C.APPROVED_AT, dataRows, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange(2, C.PDF_FILE_ID, dataRows, 1).setNumberFormat('@');
    sheet.getRange(2, C.EMAIL_SENT_AT, dataRows, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange(2, C.VALID_ID_FILE_IDS, dataRows, 1).setNumberFormat('@');

    sheet.getRange(2, C.SPECIAL_REQUESTS, dataRows, 1).setWrap(true);
    sheet.getRange(2, C.ADMIN_REMARKS, dataRows, 1).setWrap(true);
    sheet.getRange(2, C.LAST_ERROR, dataRows, 1).setWrap(true);
    sheet.getRange(2, C.COMPANION_GUESTS, dataRows, 1).setWrap(true);

    // Dropdown validations
    var approvalValidation = SpreadsheetApp.newDataValidation()
      .requireValueInList([
        Config.APPROVAL_STATUS.PENDING,
        Config.APPROVAL_STATUS.APPROVED,
        Config.APPROVAL_STATUS.REJECTED
      ], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(2, C.APPROVAL_STATUS, dataRows, 1).setDataValidation(approvalValidation);

    var emailValidation = SpreadsheetApp.newDataValidation()
      .requireValueInList([
        Config.EMAIL_STATUS.NOT_SENT,
        Config.EMAIL_STATUS.SENT,
        Config.EMAIL_STATUS.FAILED
      ], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(2, C.EMAIL_STATUS, dataRows, 1).setDataValidation(emailValidation);

    var roomsValidation = SpreadsheetApp.newDataValidation()
      .requireValueInList(Config.FORM_CONFIG.ROOM_OPTIONS.slice(), true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, C.NUMBER_OF_ROOMS, dataRows, 1).setDataValidation(roomsValidation);

    // Conditional formatting colors for Approval Status & Email Status
    var rules = [];
    rules = rules.concat(
      buildStatusConditionalRules(sheet, C.APPROVAL_STATUS, 2, dataRows, [
        Config.APPROVAL_STATUS.PENDING,
        Config.APPROVAL_STATUS.APPROVED,
        Config.APPROVAL_STATUS.REJECTED
      ])
    );
    rules = rules.concat(
      buildStatusConditionalRules(sheet, C.EMAIL_STATUS, 2, dataRows, [
        Config.EMAIL_STATUS.NOT_SENT,
        Config.EMAIL_STATUS.SENT,
        Config.EMAIL_STATUS.FAILED
      ])
    );
    sheet.setConditionalFormatRules(rules);

    // Protect system-managed columns (warningOnly=true for sheet owner safety while alerting manual edits;
    // backend SecurityService + ApprovalService still enforce strict server-side integrity!)
    var existingProtections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE) || [];
    if (existingProtections.length === 0) {
      for (var p = 0; p < Config.PROTECTED_RESERVATION_COLUMNS.length; p++) {
        var protectedCol = Config.PROTECTED_RESERVATION_COLUMNS[p];
        var colHeader = Config.RESERVATION_HEADERS[protectedCol - 1];
        applyProtection(
          sheet.getRange(1, protectedCol, maxRows, 1),
          'System-managed column: ' + colHeader + ' (use STAYCATION MANAGEMENT menu)',
          true
        );
      }
    }

    return sheet;
  }

  function setupEmailLogsSheet(ss) {
    var sheet = getOrCreateSheet(ss, Config.SHEETS.EMAIL_LOGS);
    styleHeaderRow(sheet, Config.EMAIL_LOG_HEADERS);

    var maxRows = Math.max(sheet.getMaxRows(), 2);
    var dataRows = maxRows - 1;
    var C = Config.EMAIL_LOG_COLS;

    var widths = [170, 170, 180, 220, 280, 120, 165, 165, 280, 200];
    for (var i = 0; i < widths.length; i++) {
      sheet.setColumnWidth(i + 1, widths[i]);
    }

    sheet.getRange(2, C.DATE_ATTEMPTED, dataRows, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange(2, C.DATE_SENT, dataRows, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange(2, C.ERROR_MESSAGE, dataRows, 1).setWrap(true);

    var rules = buildStatusConditionalRules(sheet, C.EMAIL_STATUS, 2, dataRows, [
      Config.EMAIL_STATUS.SENT,
      Config.EMAIL_STATUS.FAILED
    ]);
    sheet.setConditionalFormatRules(rules);

    var existingProtections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET) || [];
    if (existingProtections.length === 0) {
      applyProtection(sheet, 'Email Logs (Append-only audit ledger)', true);
    }

    return sheet;
  }

  function setupSettingsSheet(ss) {
    var sheet = getOrCreateSheet(ss, Config.SHEETS.SETTINGS);
    styleHeaderRow(sheet, Config.SETTINGS_HEADERS);

    var widths = [230, 340, 440, 90];
    for (var i = 0; i < widths.length; i++) {
      sheet.setColumnWidth(i + 1, widths[i]);
    }

    var existingKeys = {};
    if (sheet.getLastRow() >= 2) {
      var vals = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
      for (var r = 0; r < vals.length; r++) {
        var key = String(vals[r][0] || '').trim();
        if (key) {
          existingKeys[key] = r + 2;
        }
      }
    }

    var ownerEmail = '';
    try {
      ownerEmail = Utils.normalizeEmail(Session.getEffectiveUser().getEmail());
    } catch (e) {
      ownerEmail = '';
    }

    for (var d = 0; d < Config.DEFAULT_SETTINGS_ROWS.length; d++) {
      var defRow = Config.DEFAULT_SETTINGS_ROWS[d].slice();
      if (defRow[0] === Config.SETTINGS_KEYS.ADMINISTRATOR_EMAIL && ownerEmail) {
        defRow[1] = ownerEmail;
      }
      if (!existingKeys[defRow[0]]) {
        var targetRow = sheet.getLastRow() + 1;
        sheet.getRange(targetRow, Config.SETTINGS_COLS.VALUE).setNumberFormat('@');
        sheet.getRange(targetRow, 1, 1, 4).setValues([defRow]);
      }
    }

    // Ensure column B is plain text and column C wraps cleanly (bounded to sheet maxRows)
    var maxDataRows = Math.max(sheet.getMaxRows() - 1, 1);
    var totalRows = Math.min(Math.max(sheet.getLastRow() - 1, Config.DEFAULT_SETTINGS_ROWS.length), maxDataRows);
    sheet.getRange(2, Config.SETTINGS_COLS.VALUE, totalRows, 1).setNumberFormat('@');
    sheet.getRange(2, Config.SETTINGS_COLS.DESCRIPTION, totalRows, 1).setWrap(true);

    // Hard-protect the Settings sheet to prevent unauthorized privilege escalation via Settings edits
    var existingProtections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET) || [];
    if (existingProtections.length === 0) {
      applyProtection(sheet, 'System Settings (Authorized Administrators Only)', false);
    }

    // Bootstrap authoritative admin allowlist in ScriptProperties ONLY if not already initialized
    var props = PropertiesService.getScriptProperties();
    var existingProp = props.getProperty(Config.PROPERTY_PREFIXES.AUTHORIZED_ADMINS);
    if (!existingProp || String(existingProp).trim() === '') {
      var settings = Config.getSettings(ss);
      if (settings.administratorEmails.length > 0) {
        props.setProperty(
          Config.PROPERTY_PREFIXES.AUTHORIZED_ADMINS,
          settings.administratorEmails.join(',')
        );
      }
    }

    return sheet;
  }

  function setupActivityLogsSheet(ss) {
    var sheet = getOrCreateSheet(ss, Config.SHEETS.ACTIVITY_LOGS);
    styleHeaderRow(sheet, Config.ACTIVITY_LOG_HEADERS);

    var maxRows = Math.max(sheet.getMaxRows(), 2);
    var dataRows = maxRows - 1;
    var C = Config.ACTIVITY_LOG_COLS;

    var widths = [170, 170, 180, 200, 220, 180, 180, 165, 320];
    for (var i = 0; i < widths.length; i++) {
      sheet.setColumnWidth(i + 1, widths[i]);
    }

    sheet.getRange(2, C.TIMESTAMP, dataRows, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange(2, C.REMARKS, dataRows, 1).setWrap(true);

    var existingProtections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET) || [];
    if (existingProtections.length === 0) {
      applyProtection(sheet, 'Activity Logs (Append-only audit trail)', true);
    }

    return sheet;
  }

  function initializeSpreadsheet(ss) {
    var spreadsheet = Config.getActiveSpreadsheetOrThrow(ss);
    spreadsheet.setSpreadsheetTimeZone(Config.DEFAULT_TIMEZONE);

    setupReservationsSheet(spreadsheet);
    setupEmailLogsSheet(spreadsheet);
    setupSettingsSheet(spreadsheet);
    setupActivityLogsSheet(spreadsheet);

    if (typeof SecurityService !== 'undefined' && SecurityService.getOrCreateIntegritySheet) {
      SecurityService.getOrCreateIntegritySheet(spreadsheet);
    }

    // Remove blank default Sheet1 if unused
    var defaultSheet = spreadsheet.getSheetByName('Sheet1');
    if (defaultSheet && defaultSheet.getLastRow() === 0 && spreadsheet.getSheets().length > 1) {
      spreadsheet.deleteSheet(defaultSheet);
    }

    return Utils.ok('Spreadsheet initialized with all 4 Staycation management sheets.', {
      spreadsheetId: spreadsheet.getId(),
      spreadsheetUrl: spreadsheet.getUrl(),
      timezone: spreadsheet.getSpreadsheetTimeZone(),
      sheets: [
        Config.SHEETS.RESERVATIONS,
        Config.SHEETS.EMAIL_LOGS,
        Config.SHEETS.SETTINGS,
        Config.SHEETS.ACTIVITY_LOGS
      ]
    });
  }

  /**
   * Synchronizes all script-creatable fields on a Google Form (both new and existing).
   * Adds any missing fields without duplicating or removing existing questions.
   * Also checks whether a manual "Valid ID Upload" File Upload item is present.
   */
  function syncFormFields_(form) {
    var F = Config.FORM_CONFIG;
    var existingItems = form.getItems ? form.getItems() : [];
    var existingTitles = {};
    var hasValidIdUpload = false;

    for (var i = 0; i < existingItems.length; i++) {
      var title = String(existingItems[i].getTitle() || '').trim().toLowerCase();
      if (title) {
        existingTitles[title] = true;
        if (title.indexOf('valid id') !== -1 || title.indexOf('upload id') !== -1 || title.indexOf('government id') !== -1) {
          hasValidIdUpload = true;
        }
      }
    }

    var addedFields = [];

    function hasField(fieldTitle) {
      return Boolean(existingTitles[String(fieldTitle || '').trim().toLowerCase()]);
    }

    if (!hasField(F.FIELDS.FULL_NAME)) {
      form.addTextItem()
        .setTitle(F.FIELDS.FULL_NAME)
        .setHelpText('Enter your complete first and last name.')
        .setRequired(true);
      addedFields.push(F.FIELDS.FULL_NAME);
    }

    if (!hasField(F.FIELDS.EMAIL_ADDRESS)) {
      var emailValidation = FormApp.createTextValidation()
        .requireTextIsEmail()
        .setHelpText('Please enter a valid email address (e.g., name@example.com).')
        .build();
      form.addTextItem()
        .setTitle(F.FIELDS.EMAIL_ADDRESS)
        .setHelpText('Your Reservation Endorsement Certificate will be sent here after approval.')
        .setValidation(emailValidation)
        .setRequired(true);
      addedFields.push(F.FIELDS.EMAIL_ADDRESS);
    }

    if (!hasField(F.FIELDS.CONTACT_NUMBER)) {
      var phoneValidation = FormApp.createTextValidation()
        .requireTextMatchesPattern('^[+]?[0-9][0-9\\s\\-()]{6,19}$')
        .setHelpText('Please enter a valid mobile or telephone number (e.g., 0917 123 4567 or +63 917 123 4567).')
        .build();
      form.addTextItem()
        .setTitle(F.FIELDS.CONTACT_NUMBER)
        .setValidation(phoneValidation)
        .setRequired(true);
      addedFields.push(F.FIELDS.CONTACT_NUMBER);
    }

    if (!hasField(F.FIELDS.CHECK_IN_DATE)) {
      form.addDateItem()
        .setTitle(F.FIELDS.CHECK_IN_DATE)
        .setHelpText('Must be today or a future date.')
        .setRequired(true);
      addedFields.push(F.FIELDS.CHECK_IN_DATE);
    }

    if (!hasField(F.FIELDS.CHECK_OUT_DATE)) {
      form.addDateItem()
        .setTitle(F.FIELDS.CHECK_OUT_DATE)
        .setHelpText('Must be later than your Check-in Date.')
        .setRequired(true);
      addedFields.push(F.FIELDS.CHECK_OUT_DATE);
    }

    if (!hasField(F.FIELDS.NUMBER_OF_GUESTS)) {
      var guestsValidation = FormApp.createTextValidation()
        .requireTextMatchesPattern('^[1-9][0-9]*$')
        .setHelpText('Please enter a whole number greater than 0.')
        .build();
      form.addTextItem()
        .setTitle(F.FIELDS.NUMBER_OF_GUESTS)
        .setValidation(guestsValidation)
        .setRequired(true);
      addedFields.push(F.FIELDS.NUMBER_OF_GUESTS);
    }

    if (!hasField(F.FIELDS.NUMBER_OF_ROOMS)) {
      form.addListItem()
        .setTitle(F.FIELDS.NUMBER_OF_ROOMS)
        .setHelpText('Select the number of rooms if applicable.')
        .setChoiceValues(F.ROOM_OPTIONS.slice())
        .setRequired(false);
      addedFields.push(F.FIELDS.NUMBER_OF_ROOMS);
    }

    if (!hasField(F.FIELDS.COMPANION_GUESTS)) {
      form.addParagraphTextItem()
        .setTitle(F.FIELDS.COMPANION_GUESTS)
        .setHelpText('List the full names of all other guests staying with you (one name per line), if applicable.')
        .setRequired(false);
      addedFields.push(F.FIELDS.COMPANION_GUESTS);
    }

    if (!hasField(F.FIELDS.SPECIAL_REQUESTS)) {
      form.addParagraphTextItem()
        .setTitle(F.FIELDS.SPECIAL_REQUESTS)
        .setHelpText('Optional notes, arrival preferences, or special requests.')
        .setRequired(false);
      addedFields.push(F.FIELDS.SPECIAL_REQUESTS);
    }

    if (!hasField(F.FIELDS.AGREEMENT)) {
      form.addCheckboxItem()
        .setTitle(F.FIELDS.AGREEMENT)
        .setChoiceValues([F.AGREEMENT_LABEL])
        .setRequired(true);
      addedFields.push(F.FIELDS.AGREEMENT);
    }

    return {
      addedFields: addedFields,
      hasValidIdUpload: hasValidIdUpload
    };
  }

  function createRegistrationForm(ss) {
    var spreadsheet = Config.getActiveSpreadsheetOrThrow(ss);
    var props = PropertiesService.getScriptProperties();
    var existingFormId = props.getProperty(Config.PROPERTY_PREFIXES.FORM_ID);

    if (existingFormId) {
      try {
        var existingForm = FormApp.openById(existingFormId);
        var syncResult = syncFormFields_(existingForm);
        return Utils.ok('Existing Staycation Registration Form synchronized.', {
          formId: existingForm.getId(),
          publishedUrl: existingForm.getPublishedUrl(),
          editUrl: existingForm.getEditUrl(),
          created: false,
          addedFields: syncResult.addedFields,
          hasValidIdUpload: syncResult.hasValidIdUpload
        });
      } catch (e) {
        Logger.log('Previously linked form not accessible; creating a new form.');
      }
    }

    var F = Config.FORM_CONFIG;
    var form = FormApp.create(F.TITLE);
    form.setDescription(F.DESCRIPTION);
    try {
      form.setRequireLogin(false);
    } catch (loginErr) {
      // Deprecated / unsupported on consumer @gmail.com accounts; public access is default there
      Logger.log('Note: form.setRequireLogin(false) skipped on this account type: ' + loginErr);
    }
    form.setCollectEmail(false);
    form.setConfirmationMessage(
      'Thank you! Your staycation reservation request has been received and is pending manual administrator review. ' +
      'You will receive an endorsement email once your reservation has been verified and approved.'
    );

    var createdSync = syncFormFields_(form);

    // Snapshot existing sheet names before linking so we hide the newly created response sheet regardless of suffix
    var existingNames = {};
    var sheetsBefore = spreadsheet.getSheets();
    for (var b = 0; b < sheetsBefore.length; b++) {
      existingNames[sheetsBefore[b].getName()] = true;
    }

    // Link form responses to the Admin Spreadsheet
    form.setDestination(FormApp.DestinationType.SPREADSHEET, spreadsheet.getId());
    SpreadsheetApp.flush();
    props.setProperty(Config.PROPERTY_PREFIXES.FORM_ID, form.getId());

    // Hide & hard-protect raw response intake sheet so Reservations remains the clean admin workspace
    var sheetsAfter = spreadsheet.getSheets();
    var rawSheet = null;
    for (var a = 0; a < sheetsAfter.length; a++) {
      if (!existingNames[sheetsAfter[a].getName()]) {
        rawSheet = sheetsAfter[a];
        break;
      }
    }
    if (!rawSheet) {
      rawSheet = spreadsheet.getSheetByName(Config.SHEETS.RAW_FORM_RESPONSES);
    }
    if (rawSheet) {
      rawSheet.hideSheet();
      applyProtection(rawSheet, 'Raw Google Form Responses (Hidden Audit Buffer)', false);
    }

    return Utils.ok('Public Staycation Registration Form created and linked.', {
      formId: form.getId(),
      publishedUrl: form.getPublishedUrl(),
      editUrl: form.getEditUrl(),
      created: true,
      addedFields: createdSync.addedFields,
      hasValidIdUpload: createdSync.hasValidIdUpload
    });
  }

  function createPrivateOutputFolder(ss) {
    var spreadsheet = Config.getActiveSpreadsheetOrThrow(ss);
    var settings = Config.getSettings(spreadsheet);
    var existingId = Utils.extractDriveFileId(settings.driveOutputFolderId);

    if (existingId) {
      try {
        var existingFolder = DriveApp.getFolderById(existingId);
        existingFolder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
        return Utils.ok('Existing private Drive output folder verified.', {
          folderId: existingFolder.getId(),
          folderUrl: existingFolder.getUrl(),
          created: false
        });
      } catch (e) {
        Logger.log('Configured output folder inaccessible; creating new private folder.');
      }
    }

    var folder = DriveApp.createFolder('Staycation Endorsement PDFs');
    folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);

    var updates = {};
    updates[Config.SETTINGS_KEYS.DRIVE_OUTPUT_FOLDER_ID] = folder.getId();
    Config.saveSettings(updates, spreadsheet);

    return Utils.ok('Private Google Drive output folder created.', {
      folderId: folder.getId(),
      folderUrl: folder.getUrl(),
      created: true
    });
  }

  /**
   * Creates a professionally styled hotel-theme Master Google Docs Endorsement Template
   * using Dark Green, Warm Beige, White, and Gold with all required placeholders.
   */
  function createEndorsementTemplateDoc(ss) {
    var spreadsheet = Config.getActiveSpreadsheetOrThrow(ss);
    var settings = Config.getSettings(spreadsheet);
    var existingId = Utils.extractDriveFileId(settings.docsTemplateId);

    if (existingId) {
      try {
        var existingDoc = DocumentApp.openById(existingId);
        return Utils.ok('Existing Google Docs endorsement template verified.', {
          templateId: existingDoc.getId(),
          templateUrl: existingDoc.getUrl(),
          created: false
        });
      } catch (e) {
        Logger.log('Configured template ID inaccessible; creating starter template.');
      }
    }

    var B = Config.BRAND_COLORS;
    var P = Config.PLACEHOLDERS;
    var doc = DocumentApp.create('Staycation Reservation Endorsement Template');
    var body = doc.getBody();
    body.clear();
    body.setMarginTop(48);
    body.setMarginBottom(48);
    body.setMarginLeft(54);
    body.setMarginRight(54);

    // Logo placeholder at the top (replaced with image if STAYCATION_LOGO_URL is set, or cleared cleanly)
    var logoPara = body.appendParagraph(P.STAYCATION_LOGO);
    logoPara.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    logoPara.setSpacingAfter(6);

    // Staycation Name Header Banner
    var brandPara = body.appendParagraph(P.STAYCATION_NAME);
    brandPara.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    brandPara.setSpacingAfter(4);
    brandPara.editAsText().setFontFamily('Georgia').setFontSize(18).setBold(true).setForegroundColor(B.DARK_GREEN);

    var titlePara = body.appendParagraph('RESERVATION CONFIRMATION');
    titlePara.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    titlePara.setSpacingAfter(2);
    titlePara.editAsText().setFontFamily('Georgia').setFontSize(22).setBold(true).setForegroundColor(B.DARK_GREEN);

    var subPara = body.appendParagraph('ENDORSEMENT');
    subPara.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    subPara.setSpacingAfter(12);
    subPara.editAsText().setFontFamily('Arial').setFontSize(12).setBold(true).setForegroundColor(B.GOLD);

    body.appendHorizontalRule();

    // Confirmation statement
    var intro1 = body.appendParagraph('This is to confirm that the reservation of:');
    intro1.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    intro1.setSpacingBefore(14);
    intro1.setSpacingAfter(6);
    intro1.editAsText().setFontFamily('Arial').setFontSize(11).setForegroundColor(B.CHARCOAL);

    var guestHighlight = body.appendParagraph(P.GUEST_NAME);
    guestHighlight.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    guestHighlight.setSpacingAfter(6);
    guestHighlight.editAsText().setFontFamily('Georgia').setFontSize(18).setBold(true).setForegroundColor(B.DARK_GREEN);

    var intro2 = body.appendParagraph('has been reviewed and approved.');
    intro2.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    intro2.setSpacingAfter(16);
    intro2.editAsText().setFontFamily('Arial').setFontSize(11).setForegroundColor(B.CHARCOAL);

    // Reservation Details Section
    var detailsHeading = body.appendParagraph('Reservation Details');
    detailsHeading.setSpacingBefore(6);
    detailsHeading.setSpacingAfter(6);
    detailsHeading.editAsText().setFontFamily('Georgia').setFontSize(13).setBold(true).setForegroundColor(B.DARK_GREEN);

    var detailRows = [
      ['Reservation Reference:', P.REFERENCE_NUMBER],
      ['Unit / Property:', P.UNIT_LOCATION],
      ['Primary Guest Name:', P.GUEST_NAME],
      ['Companion Guests:', P.COMPANION_GUESTS],
      ['Check-in Date:', P.CHECK_IN_DATE],
      ['Check-in Time:', P.CHECK_IN_TIME],
      ['Check-out Date:', P.CHECK_OUT_DATE],
      ['Check-out Time:', P.CHECK_OUT_TIME],
      ['Number of Guests:', P.NUMBER_OF_GUESTS],
      ['Number of Rooms:', P.NUMBER_OF_ROOMS]
    ];
    var table = body.appendTable(detailRows);
    table.setBorderColor(B.GOLD);
    table.setBorderWidth(1);
    for (var r = 0; r < detailRows.length; r++) {
      var row = table.getRow(r);
      var labelCell = row.getCell(0);
      var valueCell = row.getCell(1);
      labelCell.setBackgroundColor(B.WARM_BEIGE);
      valueCell.setBackgroundColor(B.WHITE);
      labelCell.setPaddingTop(6).setPaddingBottom(6).setPaddingLeft(10).setPaddingRight(10);
      valueCell.setPaddingTop(6).setPaddingBottom(6).setPaddingLeft(10).setPaddingRight(10);
      labelCell.editAsText().setFontFamily('Arial').setFontSize(10).setBold(true).setForegroundColor(B.DARK_GREEN);
      valueCell.editAsText().setFontFamily('Arial').setFontSize(10).setBold(false).setForegroundColor(B.CHARCOAL);
    }

    // Reminders Section
    var remindersHeading = body.appendParagraph('Reminders');
    remindersHeading.setSpacingBefore(16);
    remindersHeading.setSpacingAfter(6);
    remindersHeading.editAsText().setFontFamily('Georgia').setFontSize(13).setBold(true).setForegroundColor(B.DARK_GREEN);

    var reminders = [
      'Please present this endorsement upon arrival.',
      'Follow the designated check-in and check-out times.',
      'Inform the administrator in advance of any changes.',
      'Observe the staycation house rules.'
    ];
    for (var m = 0; m < reminders.length; m++) {
      var item = body.appendListItem(reminders[m]);
      item.editAsText().setFontFamily('Arial').setFontSize(10).setForegroundColor(B.CHARCOAL);
    }

    // Contact Information Section
    var contactHeading = body.appendParagraph('Contact Information');
    contactHeading.setSpacingBefore(16);
    contactHeading.setSpacingAfter(6);
    contactHeading.editAsText().setFontFamily('Georgia').setFontSize(13).setBold(true).setForegroundColor(B.DARK_GREEN);

    var contactLines = [
      'Contact Number: ' + P.CONTACT_NUMBER,
      'Email: ' + P.STAYCATION_EMAIL,
      'Facebook Page: ' + P.FACEBOOK_PAGE
    ];
    for (var c = 0; c < contactLines.length; c++) {
      var cp = body.appendParagraph(contactLines[c]);
      cp.setSpacingAfter(2);
      cp.editAsText().setFontFamily('Arial').setFontSize(10).setForegroundColor(B.CHARCOAL);
    }

    body.appendHorizontalRule();

    var closing = body.appendParagraph('Thank you for choosing ' + P.STAYCATION_NAME + '!');
    closing.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    closing.setSpacingBefore(12);
    closing.editAsText().setFontFamily('Georgia').setFontSize(12).setBold(true).setForegroundColor(B.DARK_GREEN);

    doc.saveAndClose();

    // Ensure template remains private
    try {
      var file = DriveApp.getFileById(doc.getId());
      file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    } catch (shareErr) {
      Logger.log('Warning: Could not set template sharing to PRIVATE: ' + shareErr);
    }

    var updates = {};
    updates[Config.SETTINGS_KEYS.DOCS_TEMPLATE_ID] = doc.getId();
    Config.saveSettings(updates, spreadsheet);

    return Utils.ok('Hotel-style Google Docs endorsement template created.', {
      templateId: doc.getId(),
      templateUrl: doc.getUrl(),
      created: true
    });
  }

  function installTriggers(ss) {
    var spreadsheet = Config.getActiveSpreadsheetOrThrow(ss);
    var existing = ScriptApp.getProjectTriggers();
    for (var i = 0; i < existing.length; i++) {
      var fn = existing[i].getHandlerFunction();
      if (fn === 'onFormSubmitTrigger' || fn === 'onSpreadsheetEditTrigger') {
        ScriptApp.deleteTrigger(existing[i]);
      }
    }

    ScriptApp.newTrigger('onFormSubmitTrigger')
      .forSpreadsheet(spreadsheet)
      .onFormSubmit()
      .create();

    ScriptApp.newTrigger('onSpreadsheetEditTrigger')
      .forSpreadsheet(spreadsheet)
      .onEdit()
      .create();

    return Utils.ok('Installable form-submit and spreadsheet-edit triggers installed.', {
      triggers: ['onFormSubmitTrigger', 'onSpreadsheetEditTrigger']
    });
  }

  function runFullSetup(ss) {
    var spreadsheet = Config.getActiveSpreadsheetOrThrow(ss);
    var sheetRes = initializeSpreadsheet(spreadsheet);
    var folderRes = createPrivateOutputFolder(spreadsheet);
    var templateRes = createEndorsementTemplateDoc(spreadsheet);
    var formRes = createRegistrationForm(spreadsheet);
    var triggerRes = installTriggers(spreadsheet);

    var addedFields = (formRes.data && formRes.data.addedFields) || [];
    var hasValidId = Boolean(formRes.data && formRes.data.hasValidIdUpload);

    Logger.log('=== Staycation Setup / Upgrade Summary ===');
    Logger.log('Spreadsheet: ' + sheetRes.data.spreadsheetUrl);
    Logger.log('Google Form (Public): ' + formRes.data.publishedUrl);
    Logger.log('Google Form (Edit): ' + formRes.data.editUrl);
    Logger.log('Form Fields Added: ' + (addedFields.length > 0 ? addedFields.join(', ') : 'All script-managed fields already up to date'));
    if (!hasValidId) {
      Logger.log('ACTION NEEDED (10 sec): Open the Form Edit URL above -> "+" -> File upload -> Title it "Valid ID Upload" (Google Apps Script cannot create File Upload questions via API).');
    } else {
      Logger.log('Valid ID Upload field: Detected on form.');
    }
    Logger.log('Endorsement Template Doc: ' + templateRes.data.templateUrl);
    Logger.log('Private PDF Folder: ' + folderRes.data.folderUrl);

    if (typeof ActivityLogService !== 'undefined' && ActivityLogService.logActivity) {
      ActivityLogService.logActivity({
        reservationId: 'SYSTEM',
        referenceNumber: 'N/A',
        administrator: (typeof SecurityService !== 'undefined' ? SecurityService.getCurrentAdminEmail() : '') || 'SYSTEM_SETUP',
        action: Config.ACTIVITY_ACTIONS.SYSTEM_SETUP,
        previousValue: '',
        newValue: 'SYNCED',
        remarks: 'Setup synced all 4 sheets, private output folder, Docs template, Form (added: ' +
          (addedFields.length ? addedFields.join(', ') : 'none') + '), and triggers.'
      }, spreadsheet);
    }

    return Utils.ok('Staycation Reservation System setup & sync complete.', {
      spreadsheet: sheetRes.data,
      outputFolder: folderRes.data,
      templateDoc: templateRes.data,
      registrationForm: formRes.data,
      triggers: triggerRes.data,
      manualFormStep: hasValidId
        ? ''
        : 'Open the Google Form editor -> "+" -> File upload -> title it "Valid ID Upload" (Allow Image & PDF, max 5 files).'
    });
  }

  /**
   * Alias to runFullSetup() — safely upgrades existing sheets, settings, form fields,
   * folder permissions, and installable triggers in one step without losing data.
   */
  function upgradeExistingWorkspace(ss) {
    return runFullSetup(ss);
  }

  return Object.freeze({
    initializeSpreadsheet: initializeSpreadsheet,
    createRegistrationForm: createRegistrationForm,
    createPrivateOutputFolder: createPrivateOutputFolder,
    createEndorsementTemplateDoc: createEndorsementTemplateDoc,
    installTriggers: installTriggers,
    runFullSetup: runFullSetup,
    upgradeExistingWorkspace: upgradeExistingWorkspace
  });
})();

/**
 * Top-level Apps Script setup entrypoints selectable from the GAS Editor Run menu.
 */
function runFullSetup() {
  return SetupService.runFullSetup();
}

function initializeSpreadsheet() {
  return SetupService.initializeSpreadsheet();
}

function installSystemTriggers() {
  return SetupService.installTriggers();
}

function upgradeExistingWorkspace() {
  return SetupService.upgradeExistingWorkspace();
}
