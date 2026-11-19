/**
 * DashboardService.gs
 * Computes live reservation KPIs, Gmail quota status, and Workspace health checks
 * for the Google Sheets administrator dashboard and Settings modal.
 */

var DashboardService = (function () {
  function runWorkspaceHealthCheck(ss) {
    var spreadsheet = Config.getActiveSpreadsheetOrThrow(ss);
    var settings = Config.getSettings(spreadsheet);
    var checks = [];

    // 1. Required sheets present
    var requiredSheets = [
      Config.SHEETS.RESERVATIONS,
      Config.SHEETS.EMAIL_LOGS,
      Config.SHEETS.SETTINGS,
      Config.SHEETS.ACTIVITY_LOGS
    ];
    var missingSheets = [];
    for (var s = 0; s < requiredSheets.length; s++) {
      if (!spreadsheet.getSheetByName(requiredSheets[s])) {
        missingSheets.push(requiredSheets[s]);
      }
    }
    checks.push({
      id: 'sheets',
      label: 'Core Management Sheets',
      ok: missingSheets.length === 0,
      detail: missingSheets.length === 0
        ? 'All 4 sheets present (Reservations, Email Logs, Settings, Activity Logs).'
        : 'Missing: ' + missingSheets.join(', ')
    });

    // 2. Branding configured
    var brandingOk = !Config.isUnconfiguredValue(settings.staycationName) &&
      !Config.isUnconfiguredValue(settings.staycationContactNumber) &&
      !Config.isUnconfiguredValue(settings.staycationEmailAddress);
    checks.push({
      id: 'branding',
      label: 'Staycation Branding & Contact',
      ok: brandingOk,
      detail: brandingOk
        ? settings.staycationName + ' (' + settings.staycationEmailAddress + ')'
        : 'Configure Staycation Name, Contact Number, and Email Address in System Settings.'
    });

    // 3. Administrators configured
    var adminsOk = settings.administratorEmails.length > 0;
    checks.push({
      id: 'admins',
      label: 'Authorized Administrators',
      ok: adminsOk,
      detail: adminsOk
        ? settings.administratorEmails.join(', ')
        : 'No authorized administrator email configured.'
    });

    // 4. Google Docs Template accessible
    var templateOk = false;
    var templateDetail = 'Google Docs Template ID is not configured.';
    var templateId = Utils.extractDriveFileId(settings.docsTemplateId);
    if (templateId) {
      try {
        var docFile = DriveApp.getFileById(templateId);
        var googleDocsMime = (typeof MimeType !== 'undefined' && MimeType.GOOGLE_DOCS)
          ? MimeType.GOOGLE_DOCS
          : 'application/vnd.google-apps.document';
        var isGoogleDoc = docFile.getMimeType() === googleDocsMime;
        templateOk = !docFile.isTrashed() && isGoogleDoc;
        templateDetail = templateOk
          ? ('Accessible: ' + docFile.getName())
          : (docFile.isTrashed() ? 'Template file is in Trash.' : 'Configured file is not a Google Docs document.');
      } catch (e1) {
        templateDetail = 'Template ID "' + templateId + '" cannot be opened: ' + e1.message;
      }
    }
    checks.push({
      id: 'template',
      label: 'Google Docs Endorsement Template',
      ok: templateOk,
      detail: templateDetail
    });

    // 5. Private Drive Output Folder accessible
    var folderOk = false;
    var folderDetail = 'Drive Output Folder ID is not configured.';
    var folderId = Utils.extractDriveFileId(settings.driveOutputFolderId);
    if (folderId) {
      try {
        var folder = DriveApp.getFolderById(folderId);
        var isPrivate = folder.getSharingAccess() === DriveApp.Access.PRIVATE;
        folderOk = !folder.isTrashed() && isPrivate;
        folderDetail = folderOk
          ? ('Private folder accessible: ' + folder.getName())
          : (folder.isTrashed() ? 'Folder is in Trash.' : 'Security Warning: Folder sharing is not PRIVATE.');
      } catch (e2) {
        folderDetail = 'Folder ID "' + folderId + '" cannot be opened: ' + e2.message;
      }
    }
    checks.push({
      id: 'folder',
      label: 'Private Drive Output Folder',
      ok: folderOk,
      detail: folderDetail
    });

    // 6. Installable triggers installed
    var hasSubmitTrigger = false;
    var hasEditTrigger = false;
    try {
      var triggers = ScriptApp.getProjectTriggers();
      for (var t = 0; t < triggers.length; t++) {
        var fn = triggers[t].getHandlerFunction();
        if (fn === 'onFormSubmitTrigger') hasSubmitTrigger = true;
        if (fn === 'onSpreadsheetEditTrigger') hasEditTrigger = true;
      }
    } catch (e3) {
      Logger.log('Could not inspect triggers: ' + e3);
    }
    checks.push({
      id: 'triggers',
      label: 'Installable Triggers',
      ok: hasSubmitTrigger && hasEditTrigger,
      detail: (hasSubmitTrigger && hasEditTrigger)
        ? 'onFormSubmitTrigger & onSpreadsheetEditTrigger active.'
        : 'Missing trigger(s). Run Setup -> installSystemTriggers().'
    });

    // 7. Gmail remaining daily quota
    var quota = 0;
    try {
      quota = MailApp.getRemainingDailyQuota();
    } catch (e4) {
      quota = -1;
    }
    checks.push({
      id: 'quota',
      label: 'Daily Gmail Quota Remaining',
      ok: quota > 0,
      detail: quota >= 0 ? (quota + ' email(s) remaining today.') : 'Quota unavailable.'
    });

    var allHealthy = true;
    for (var c = 0; c < checks.length; c++) {
      if (!checks[c].ok) {
        allHealthy = false;
        break;
      }
    }

    return {
      healthy: allHealthy,
      remainingDailyQuota: quota,
      checks: checks
    };
  }

  function getDashboardMetrics(ss) {
    var spreadsheet = Config.getActiveSpreadsheetOrThrow(ss);
    var settings = Config.getSettings(spreadsheet);
    var tz = settings.timezone || Config.DEFAULT_TIMEZONE;
    var today = Utils.getTodayDateString(new Date(), tz);
    var all = ReservationService.getAllReservations(spreadsheet);

    var counts = {
      total: all.length,
      pending: 0,
      approved: 0,
      rejected: 0,
      emailNotSent: 0,
      emailSent: 0,
      emailFailed: 0,
      pdfReady: 0,
      awaitingPdf: 0,
      readyToEmail: 0,
      upcomingApproved: 0
    };

    var pendingList = [];

    for (var i = 0; i < all.length; i++) {
      var r = all[i].reservation;
      if (r.approvalStatus === Config.APPROVAL_STATUS.PENDING) {
        counts.pending++;
        pendingList.push({
          reservationId: r.reservationId,
          referenceNumber: r.referenceNumber,
          guestName: r.guestName,
          checkInDate: r.checkInDate,
          checkOutDate: r.checkOutDate,
          numberOfGuests: r.numberOfGuests,
          submittedAt: r.submittedAt
        });
      } else if (r.approvalStatus === Config.APPROVAL_STATUS.APPROVED) {
        counts.approved++;
        if (r.checkInDate && r.checkInDate >= today) {
          counts.upcomingApproved++;
        }
        if (r.pdfFileId) {
          counts.pdfReady++;
          if (r.emailStatus === Config.EMAIL_STATUS.NOT_SENT) {
            counts.readyToEmail++;
          }
        } else {
          counts.awaitingPdf++;
        }
      } else if (r.approvalStatus === Config.APPROVAL_STATUS.REJECTED) {
        counts.rejected++;
      }

      if (r.emailStatus === Config.EMAIL_STATUS.SENT) {
        counts.emailSent++;
      } else if (r.emailStatus === Config.EMAIL_STATUS.FAILED) {
        counts.emailFailed++;
      } else {
        counts.emailNotSent++;
      }
    }

    var health = runWorkspaceHealthCheck(spreadsheet);

    return {
      staycationName: Config.isUnconfiguredValue(settings.staycationName)
        ? Config.APP_NAME
        : settings.staycationName,
      timezone: tz,
      generatedAt: Utils.formatTimestamp(new Date(), tz),
      counts: counts,
      pendingReservations: pendingList.slice(0, 10),
      health: health
    };
  }

  function refreshDashboardFormatting(ss) {
    var spreadsheet = Config.getActiveSpreadsheetOrThrow(ss);
    SecurityService.assertAuthorizedAdmin('REFRESH_DASHBOARD', spreadsheet);
    SetupService.initializeSpreadsheet(spreadsheet);
    var metrics = getDashboardMetrics(spreadsheet);
    return Utils.ok('Dashboard formatting, validations, and metrics refreshed.', metrics);
  }

  return Object.freeze({
    runWorkspaceHealthCheck: runWorkspaceHealthCheck,
    getDashboardMetrics: getDashboardMetrics,
    refreshDashboardFormatting: refreshDashboardFormatting
  });
})();
