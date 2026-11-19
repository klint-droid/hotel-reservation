/**
 * Code.gs
 * Thin Google Apps Script entrypoint router for Google Sheets menus,
 * installable triggers, and HTML modal dialog server callbacks.
 *
 * All business logic resides in dedicated service modules.
 */

/**
 * Simple onOpen trigger: renders the STAYCATION MANAGEMENT custom menu.
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu(Config.MENU_TITLE)
    .addItem('Dashboard', 'menuShowDashboard')
    .addItem('View Selected Reservation', 'menuViewSelectedReservation')
    .addSeparator()
    .addItem('Approve Reservation', 'menuApproveReservation')
    .addItem('Reject Reservation', 'menuRejectReservation')
    .addSeparator()
    .addItem('Generate Endorsement PDF', 'menuGenerateEndorsementPdf')
    .addItem('Send Endorsement Email', 'menuSendEndorsementEmail')
    .addSeparator()
    .addItem('View Email Logs', 'menuViewEmailLogs')
    .addItem('Refresh Dashboard', 'menuRefreshDashboard')
    .addItem('System Settings', 'menuOpenSystemSettings')
    .addToUi();
}

/**
 * Installable onFormSubmit trigger entrypoint.
 * Disallows synthetic e.payload injection from external trigger contexts.
 */
function onFormSubmitTrigger(e) {
  try {
    return FormHandler.handleFormSubmit(e, null, { allowSyntheticPayload: false });
  } catch (err) {
    Logger.log('onFormSubmitTrigger error: ' + err);
    return Utils.errorToResult(err, 'Failed to process guest reservation submission.');
  }
}

/**
 * Installable onEdit trigger entrypoint (detects edits to endorsed fields on APPROVED rows).
 */
function onSpreadsheetEditTrigger(e) {
  try {
    return ApprovalService.handleReservationEdit(e);
  } catch (err) {
    Logger.log('onSpreadsheetEditTrigger error: ' + err);
    return Utils.errorToResult(err, 'Failed during reservation edit integrity check.');
  }
}

/**
 * Helper resolving dialog HTML templates cleanly for both clasp pushes (dialogs/Name)
 * and manual web-editor copies (Name).
 */
function loadDialogTemplate_(dialogName) {
  try {
    return HtmlService.createTemplateFromFile('dialogs/' + dialogName);
  } catch (e) {
    return HtmlService.createTemplateFromFile(dialogName);
  }
}

function showErrorAlert_(title, message) {
  SpreadsheetApp.getUi().alert(title || 'Action Blocked', message || 'An error occurred.', SpreadsheetApp.getUi().ButtonSet.OK);
}

/* ============================================================================
 * MENU HANDLERS
 * ========================================================================== */

function menuShowDashboard() {
  try {
    SecurityService.assertAuthorizedAdmin('VIEW_DASHBOARD');
    var metrics = DashboardService.getDashboardMetrics();
    var tpl = loadDialogTemplate_('ReservationDetails');
    tpl.modeJson = Utils.toSafeScriptJson('DASHBOARD');
    tpl.initialDataJson = Utils.toSafeScriptJson(metrics);
    var html = tpl.evaluate().setWidth(760).setHeight(600);
    SpreadsheetApp.getUi().showModalDialog(html, 'Staycation Management Dashboard');
  } catch (err) {
    showErrorAlert_('Dashboard Error', err.message);
  }
}

function menuViewSelectedReservation() {
  try {
    SecurityService.assertAuthorizedAdmin('VIEW_RESERVATION');
    var selected = ReservationService.getSelectedReservation();
    var settings = Config.getSettings();
    var validation = ValidationService.validateReservationRecord(selected.reservation, {
      timezone: settings.timezone,
      enforceNotInPast: false
    });
    var integrity = selected.reservation.approvalStatus === Config.APPROVAL_STATUS.APPROVED
      ? SecurityService.verifyEndorsedIntegrity(selected.reservation, false, settings.timezone)
      : { valid: true };

    var tpl = loadDialogTemplate_('ReservationDetails');
    tpl.modeJson = Utils.toSafeScriptJson('RESERVATION');
    tpl.initialDataJson = Utils.toSafeScriptJson({
      reservation: selected.reservation,
      validation: validation,
      integrity: integrity,
      staycationName: settings.staycationName
    });
    var html = tpl.evaluate().setWidth(720).setHeight(620);
    SpreadsheetApp.getUi().showModalDialog(html, 'Reservation Details – ' + selected.reservation.referenceNumber);
  } catch (err) {
    showErrorAlert_('Cannot View Reservation', err.message);
  }
}

function menuApproveReservation() {
  try {
    SecurityService.assertAuthorizedAdmin('APPROVE_RESERVATION');
    var selected = ReservationService.getSelectedReservation();
    var res = selected.reservation;

    if (res.approvalStatus !== Config.APPROVAL_STATUS.PENDING) {
      showErrorAlert_(
        'Cannot Approve Reservation',
        'Only PENDING reservations can be approved. Reservation ' + res.referenceNumber + ' is currently ' + res.approvalStatus + '.'
      );
      return;
    }

    var tpl = loadDialogTemplate_('ConfirmationDialog');
    tpl.payloadJson = Utils.toSafeScriptJson({
      action: 'APPROVE',
      title: 'Approve Staycation Reservation?',
      confirmLabel: 'APPROVE RESERVATION',
      reservation: res,
      warningNote: 'Approving this reservation records your verification only. No email will be sent automatically.'
    });
    var html = tpl.evaluate().setWidth(520).setHeight(430);
    SpreadsheetApp.getUi().showModalDialog(html, 'Approve Reservation?');
  } catch (err) {
    showErrorAlert_('Approval Error', err.message);
  }
}

function menuRejectReservation() {
  try {
    SecurityService.assertAuthorizedAdmin('REJECT_RESERVATION');
    var selected = ReservationService.getSelectedReservation();
    var res = selected.reservation;

    if (res.approvalStatus !== Config.APPROVAL_STATUS.PENDING) {
      showErrorAlert_(
        'Cannot Reject Reservation',
        'Only PENDING reservations can be rejected. Reservation ' + res.referenceNumber + ' is currently ' + res.approvalStatus + '.'
      );
      return;
    }

    var tpl = loadDialogTemplate_('ConfirmationDialog');
    tpl.payloadJson = Utils.toSafeScriptJson({
      action: 'REJECT',
      title: 'Reject Staycation Reservation?',
      confirmLabel: 'REJECT RESERVATION',
      requireReason: true,
      reservation: res,
      warningNote: 'Rejected reservations cannot be endorsed or emailed. No rejection email is sent automatically.'
    });
    var html = tpl.evaluate().setWidth(520).setHeight(470);
    SpreadsheetApp.getUi().showModalDialog(html, 'Reject Reservation?');
  } catch (err) {
    showErrorAlert_('Rejection Error', err.message);
  }
}

function menuGenerateEndorsementPdf() {
  try {
    SecurityService.assertAuthorizedAdmin('GENERATE_PDF');
    var selected = ReservationService.getSelectedReservation();
    var result = PdfService.generateEndorsementPdf(selected.reservation.reservationId);
    if (!result.ok) {
      showErrorAlert_('PDF Generation Failed', result.message + (result.errors && result.errors.length ? '\n\n' + result.errors.join('\n') : ''));
      return;
    }
    SpreadsheetApp.getUi().alert(
      'Endorsement PDF Generated',
      'PDF created successfully:\n\n' +
      'File Name: ' + result.data.fileName + '\n' +
      'Reference: ' + result.data.referenceNumber + '\n' +
      'Drive URL (Private - Admin Only): ' + result.data.pdfFileUrl + '\n\n' +
      'Review the PDF, then select "Send Endorsement Email" when ready to deliver.',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (err) {
    showErrorAlert_('PDF Generation Error', err.message);
  }
}

function menuSendEndorsementEmail() {
  try {
    SecurityService.assertAuthorizedAdmin('SEND_EMAIL');
    var selected = ReservationService.getSelectedReservation();
    var preview = EmailService.getEmailPreview(selected.reservation.reservationId);
    if (!preview.ok) {
      showErrorAlert_(
        'Cannot Send Endorsement Email',
        preview.message + (preview.errors && preview.errors.length ? '\n\n- ' + preview.errors.join('\n- ') : '')
      );
      return;
    }

    var tpl = loadDialogTemplate_('EmailPreview');
    tpl.previewJson = Utils.toSafeScriptJson(preview.data);
    var html = tpl.evaluate().setWidth(740).setHeight(650);
    SpreadsheetApp.getUi().showModalDialog(html, 'Send Reservation Endorsement?');
  } catch (err) {
    showErrorAlert_('Email Preview Error', err.message);
  }
}

function menuViewEmailLogs() {
  try {
    SecurityService.assertAuthorizedAdmin('VIEW_EMAIL_LOGS');
    var ss = Config.getActiveSpreadsheetOrThrow();
    var sheet = Config.getSheetOrThrow(Config.SHEETS.EMAIL_LOGS, ss);
    sheet.activate();
  } catch (err) {
    showErrorAlert_('Email Logs Error', err.message);
  }
}

function menuRefreshDashboard() {
  try {
    var result = DashboardService.refreshDashboardFormatting();
    if (!result.ok) {
      showErrorAlert_('Refresh Failed', result.message);
      return;
    }
    SpreadsheetApp.getUi().alert(
      'Dashboard Refreshed',
      'Formatting, validations, and metrics updated.\n\n' +
      'Total: ' + result.data.counts.total +
      ' | Pending: ' + result.data.counts.pending +
      ' | Approved: ' + result.data.counts.approved +
      ' | Sent: ' + result.data.counts.emailSent,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (err) {
    showErrorAlert_('Refresh Error', err.message);
  }
}

function menuOpenSystemSettings() {
  try {
    SecurityService.assertAuthorizedAdmin('OPEN_SETTINGS');
    var settings = Config.getSettings();
    var health = DashboardService.runWorkspaceHealthCheck();
    var tpl = loadDialogTemplate_('SettingsDialog');
    tpl.settingsJson = Utils.toSafeScriptJson({
      raw: settings.raw,
      health: health
    });
    var html = tpl.evaluate().setWidth(720).setHeight(640);
    SpreadsheetApp.getUi().showModalDialog(html, 'System Settings & Workspace Health');
  } catch (err) {
    showErrorAlert_('Settings Error', err.message);
  }
}

/* ============================================================================
 * CLIENT-SERVER CALLBACK APIS FOR HTML DIALOGS (google.script.run)
 * ========================================================================== */

function apiApproveReservation(reservationId, remarks) {
  try {
    return ApprovalService.approveReservation(reservationId, remarks);
  } catch (err) {
    return Utils.errorToResult(err, 'Failed to approve reservation.');
  }
}

function apiRejectReservation(reservationId, reason) {
  try {
    return ApprovalService.rejectReservation(reservationId, reason);
  } catch (err) {
    return Utils.errorToResult(err, 'Failed to reject reservation.');
  }
}

function apiGenerateEndorsementPdf(reservationId) {
  try {
    return PdfService.generateEndorsementPdf(reservationId);
  } catch (err) {
    return Utils.errorToResult(err, 'Failed to generate endorsement PDF.');
  }
}

function apiGetEmailPreview(reservationId) {
  try {
    SecurityService.assertAuthorizedAdmin('PREVIEW_EMAIL');
    return EmailService.getEmailPreview(reservationId);
  } catch (err) {
    return Utils.errorToResult(err, 'Failed to prepare email preview.');
  }
}

function apiSendEndorsementEmail(reservationId, allowFailedRetry) {
  try {
    return EmailService.sendEndorsementEmail(reservationId, {
      allowFailedRetry: Boolean(allowFailedRetry)
    });
  } catch (err) {
    return Utils.errorToResult(err, 'Failed to send endorsement email.');
  }
}

function apiSaveSettings(updates) {
  try {
    var adminEmail = SecurityService.assertAuthorizedAdmin('SAVE_SETTINGS');
    var check = ValidationService.validateSettingsUpdate(updates, adminEmail);
    if (!check.valid) {
      return Utils.fail(Config.ERROR_CODES.VALIDATION_FAILED, 'Settings validation failed.', check.errors);
    }
    var saved = Config.saveSettings(updates);
    ActivityLogService.logActivity({
      reservationId: 'SYSTEM',
      referenceNumber: 'N/A',
      administrator: adminEmail,
      action: Config.ACTIVITY_ACTIONS.SETTINGS_UPDATED,
      previousValue: '',
      newValue: saved.changedKeys.join(', '),
      remarks: 'Updated system configuration via System Settings dialog.'
    });
    var health = DashboardService.runWorkspaceHealthCheck();
    return Utils.ok('Settings saved successfully.', {
      changedKeys: saved.changedKeys,
      health: health
    });
  } catch (err) {
    return Utils.errorToResult(err, 'Failed to save system settings.');
  }
}

/**
 * Google Apps Script Web App entrypoint for the private Admin Portal.
 * Enforces fail-closed administrator authorization before rendering any guest data.
 */
function doGet() {
  try {
    var adminEmail = SecurityService.assertAuthorizedAdmin('OPEN_WEB_PORTAL');
    var tpl = loadDialogTemplate_('AdminPortal');
    tpl.bootstrapJson = Utils.toSafeScriptJson(buildPortalPayload_(adminEmail));
    return tpl.evaluate()
      .setTitle('Staycation Admin Portal')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  } catch (err) {
    var safeMsg = Utils.escapeHtml(err && err.message ? err.message : 'Access denied.');
    var html = [
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Access Denied</title>',
      '<style>body{font-family:Arial,sans-serif;background:#F5EFE6;color:#2B2D2F;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;}',
      '.box{background:#fff;border:1px solid #DFD8CC;border-top:4px solid #B02A37;border-radius:10px;padding:28px 32px;max-width:480px;box-shadow:0 6px 24px rgba(0,0,0,.08);}',
      'h1{margin:0 0 10px;font-family:Georgia,serif;color:#B02A37;font-size:22px;}p{margin:0 0 10px;line-height:1.5;font-size:14px;}</style></head>',
      '<body><div class="box"><h1>Access Restricted</h1><p>' + safeMsg + '</p>',
      '<p style="color:#5C636A;font-size:12px;">Sign in with an authorized Staycation Administrator Google account.</p></div></body></html>'
    ].join('');
    return HtmlService.createHtmlOutput(html).setTitle('Access Restricted');
  }
}

function buildPortalPayload_(adminEmail) {
  var ss = Config.getActiveSpreadsheetOrThrow();
  var settings = Config.getSettings(ss);
  var metrics = DashboardService.getDashboardMetrics(ss);
  var allRecords = ReservationService.getAllReservations(ss);

  // Return newest reservations first for admin workflow ergonomics
  var reservations = [];
  for (var i = allRecords.length - 1; i >= 0; i--) {
    var rec = Object.assign({}, allRecords[i].reservation);
    // Validate PDF URL server-side before returning to the portal UI
    if (rec.pdfFileUrl && !Utils.isValidGoogleDriveUrl(rec.pdfFileUrl)) {
      rec.pdfFileUrl = '';
    }
    reservations.push(rec);
  }

  var emailLogs = [];
  try {
    emailLogs = EmailLogService.getEmailLogs(200, null, ss);
  } catch (e1) {
    Logger.log('Note: Could not read Email Logs for portal: ' + e1);
  }

  var activityLogs = [];
  try {
    activityLogs = ActivityLogService.getRecentActivities(200, null, ss);
  } catch (e2) {
    Logger.log('Note: Could not read Activity Logs for portal: ' + e2);
  }

  var formUrl = '';
  try {
    var formId = PropertiesService.getScriptProperties().getProperty(Config.PROPERTY_PREFIXES.FORM_ID);
    if (formId) {
      formUrl = FormApp.openById(formId).getPublishedUrl();
    }
  } catch (e3) {
    formUrl = '';
  }

  return {
    adminEmail: adminEmail,
    staycationName: Config.isUnconfiguredValue(settings.staycationName)
      ? Config.APP_NAME
      : settings.staycationName,
    timezone: settings.timezone,
    spreadsheetUrl: ss.getUrl(),
    publicFormUrl: formUrl,
    metrics: metrics,
    reservations: reservations,
    emailLogs: emailLogs,
    activityLogs: activityLogs,
    settingsRaw: settings.raw
  };
}

function apiGetPortalBootstrap() {
  try {
    var adminEmail = SecurityService.assertAuthorizedAdmin('VIEW_WEB_PORTAL');
    return Utils.ok('Portal data refreshed.', buildPortalPayload_(adminEmail));
  } catch (err) {
    return Utils.errorToResult(err, 'Failed to load admin portal data.');
  }
}

function apiApproveAndEndorse(reservationId, remarks) {
  try {
    return ApprovalService.approveAndEndorseReservation(reservationId, remarks);
  } catch (err) {
    return Utils.errorToResult(err, 'Failed to complete 1-click approve and endorsement.');
  }
}

function apiCompleteApprovedEndorsement(reservationId, allowFailedRetry) {
  try {
    return ApprovalService.completeApprovedEndorsement(reservationId, allowFailedRetry);
  } catch (err) {
    return Utils.errorToResult(err, 'Failed to generate PDF and send endorsement email.');
  }
}

function apiGetDashboardData() {
  try {
    SecurityService.assertAuthorizedAdmin('VIEW_DASHBOARD');
    return Utils.ok('Dashboard data loaded.', DashboardService.getDashboardMetrics());
  } catch (err) {
    return Utils.errorToResult(err, 'Failed to load dashboard data.');
  }
}

function apiOpenConfirmationForReservation(reservationId, actionType) {
  try {
    SecurityService.assertAuthorizedAdmin('OPEN_CONFIRM_DIALOG');
    var found = ReservationService.getReservationById(reservationId);
    if (!found) {
      return Utils.fail(Config.ERROR_CODES.NOT_FOUND, 'Reservation not found.');
    }
    var tpl = loadDialogTemplate_('ConfirmationDialog');
    if (actionType === 'APPROVE') {
      if (found.reservation.approvalStatus !== Config.APPROVAL_STATUS.PENDING) {
        return Utils.fail(
          Config.ERROR_CODES.INVALID_STATE,
          'Only PENDING reservations can be approved. Current status: ' + found.reservation.approvalStatus
        );
      }
      tpl.payloadJson = Utils.toSafeScriptJson({
        action: 'APPROVE',
        title: 'Approve Staycation Reservation?',
        confirmLabel: 'APPROVE RESERVATION',
        reservation: found.reservation,
        warningNote: 'Approving this reservation records your verification only. No email will be sent automatically.'
      });
      SpreadsheetApp.getUi().showModalDialog(tpl.evaluate().setWidth(520).setHeight(430), 'Approve Reservation?');
    } else if (actionType === 'REJECT') {
      if (found.reservation.approvalStatus !== Config.APPROVAL_STATUS.PENDING) {
        return Utils.fail(
          Config.ERROR_CODES.INVALID_STATE,
          'Only PENDING reservations can be rejected. Current status: ' + found.reservation.approvalStatus
        );
      }
      tpl.payloadJson = Utils.toSafeScriptJson({
        action: 'REJECT',
        title: 'Reject Staycation Reservation?',
        confirmLabel: 'REJECT RESERVATION',
        requireReason: true,
        reservation: found.reservation,
        warningNote: 'Rejected reservations cannot be endorsed or emailed.'
      });
      SpreadsheetApp.getUi().showModalDialog(tpl.evaluate().setWidth(520).setHeight(470), 'Reject Reservation?');
    } else if (actionType === 'SEND_EMAIL') {
      var preview = EmailService.getEmailPreview(reservationId);
      if (!preview.ok) {
        return preview;
      }
      var previewTpl = loadDialogTemplate_('EmailPreview');
      previewTpl.previewJson = Utils.toSafeScriptJson(preview.data);
      SpreadsheetApp.getUi().showModalDialog(previewTpl.evaluate().setWidth(740).setHeight(650), 'Send Reservation Endorsement?');
    }
    return Utils.ok('Dialog opened.');
  } catch (err) {
    return Utils.errorToResult(err, 'Failed to open dialog.');
  }
}
