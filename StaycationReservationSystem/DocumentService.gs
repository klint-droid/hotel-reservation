/**
 * DocumentService.gs
 * Clones the Master Google Docs Endorsement Template, enforces PRIVATE access
 * on the temporary working copy, inserts an optional staycation logo across
 * Header/Body/Footer without wiping sibling text, performs single-pass literal
 * placeholder substitution via native DocumentApp Text tree traversal (immune to
 * regex $/\ mangling, formatting loss, and guest {{...}} placeholder injection),
 * and verifies zero template placeholders remain unresolved.
 */

var DocumentService = (function () {
  var MAX_LOGO_BYTES = 5 * 1024 * 1024; // 5 MB safety limit
  var PLACEHOLDER_REGEX = /\{\{[A-Za-z0-9_\s-]+\}\}/g;

  function getRequiredTemplateTokens() {
    return [
      Config.PLACEHOLDERS.GUEST_NAME,
      Config.PLACEHOLDERS.REFERENCE_NUMBER,
      Config.PLACEHOLDERS.CHECK_IN_DATE,
      Config.PLACEHOLDERS.CHECK_OUT_DATE,
      Config.PLACEHOLDERS.NUMBER_OF_GUESTS
    ];
  }

  function validateBrandingSettings(settings) {
    var errors = [];
    if (Config.isUnconfiguredValue(settings.staycationName)) {
      errors.push('Staycation Name is not configured in Settings.');
    }
    if (Config.isUnconfiguredValue(settings.staycationContactNumber)) {
      errors.push('Staycation Contact Number is not configured in Settings.');
    }
    if (Config.isUnconfiguredValue(settings.staycationEmailAddress)) {
      errors.push('Staycation Email Address is not configured in Settings.');
    }
    return errors;
  }

  function buildPlaceholderMap(reservation, settings) {
    var P = Config.PLACEHOLDERS;
    var tz = (settings && settings.timezone) || Config.DEFAULT_TIMEZONE;
    var fb = Config.isUnconfiguredValue(settings.staycationFacebookPage)
      ? 'N/A'
      : settings.staycationFacebookPage;

    var unitLoc = Config.isUnconfiguredValue(settings.unitLocation)
      ? settings.staycationName
      : settings.unitLocation;
    var allGuestLines = [reservation.guestName];
    if (reservation.companionGuests) {
      var extra = String(reservation.companionGuests).split(/[\n,;]+/);
      for (var g = 0; g < extra.length; g++) {
        var gn = String(extra[g] || '').trim();
        if (gn) allGuestLines.push(gn);
      }
    }

    var map = {};
    map[P.STAYCATION_NAME] = settings.staycationName;
    map[P.UNIT_LOCATION] = unitLoc;
    map[P.GUEST_NAME] = reservation.guestName;
    map[P.COMPANION_GUESTS] = reservation.companionGuests || 'None';
    map[P.ALL_GUESTS] = allGuestLines.join(', ');
    map[P.REFERENCE_NUMBER] = reservation.referenceNumber;
    map[P.CHECK_IN_DATE] = Utils.formatDisplayDate(reservation.checkInDate, tz);
    map[P.CHECK_IN_TIME] = settings.checkInTime || '2:00 PM';
    map[P.CHECK_OUT_DATE] = Utils.formatDisplayDate(reservation.checkOutDate, tz);
    map[P.CHECK_OUT_TIME] = settings.checkOutTime || '12:00 PM';
    map[P.NUMBER_OF_GUESTS] = String(reservation.numberOfGuests);
    map[P.NUMBER_OF_ROOMS] = reservation.numberOfRooms || 'Not Applicable';
    map[P.CONTACT_NUMBER] = settings.staycationContactNumber;
    map[P.STAYCATION_EMAIL] = settings.staycationEmailAddress;
    map[P.FACEBOOK_PAGE] = fb;
    map['{{GUEST_CONTACT_NUMBER}}'] = reservation.contactNumber || '';
    map['{{STAYCATION_CONTACT_NUMBER}}'] = settings.staycationContactNumber;
    return map;
  }

  function getCombinedDocText(doc) {
    var parts = [];
    if (doc.getHeader && doc.getHeader()) {
      parts.push(doc.getHeader().getText());
    }
    parts.push(doc.getBody().getText());
    if (doc.getFooter && doc.getFooter()) {
      parts.push(doc.getFooter().getText());
    }
    return parts.join('\n');
  }

  function findMissingRequiredPlaceholders(docText) {
    var required = getRequiredTemplateTokens();
    var missing = [];
    for (var i = 0; i < required.length; i++) {
      if (docText.indexOf(required[i]) === -1) {
        missing.push(required[i]);
      }
    }
    return missing;
  }

  function findUnresolvedPlaceholders(docText) {
    var matches = String(docText || '').match(/\{\{[A-Za-z0-9_\s-]+\}\}/g);
    if (!matches) {
      return [];
    }
    var unique = [];
    var seen = {};
    for (var i = 0; i < matches.length; i++) {
      if (!seen[matches[i]]) {
        seen[matches[i]] = true;
        unique.push(matches[i]);
      }
    }
    return unique;
  }

  function isValidImageBlob(blob) {
    if (!blob) {
      return false;
    }
    var contentType = String(blob.getContentType() || '').toLowerCase();
    if (!/^image\/(png|jpeg|jpg|gif|webp)$/i.test(contentType)) {
      return false;
    }
    var bytes = blob.getBytes ? blob.getBytes() : [];
    if (bytes.length > MAX_LOGO_BYTES) {
      return false;
    }
    return true;
  }

  function fetchLogoBlob(logoConfig) {
    if (Config.isUnconfiguredValue(logoConfig)) {
      return null;
    }
    var trimmed = String(logoConfig).trim();
    var driveId = Utils.extractDriveFileId(trimmed);
    if (driveId) {
      try {
        var file = DriveApp.getFileById(driveId);
        if (!file.isTrashed()) {
          var driveBlob = file.getBlob();
          if (isValidImageBlob(driveBlob)) {
            return driveBlob;
          }
          Logger.log('Warning: Drive logo file "' + driveId + '" is not a valid image or exceeds 5 MB.');
        }
      } catch (e1) {
        Logger.log('Warning: Could not load logo from Drive ID "' + driveId + '": ' + Utils.redactSensitiveText(e1.message, 200));
      }
    }
    if (/^https:\/\//i.test(trimmed)) {
      var safeLogUrl = Utils.redactSensitiveText(trimmed, 200);
      try {
        var resp = UrlFetchApp.fetch(trimmed, { muteHttpExceptions: true });
        if (resp.getResponseCode() >= 200 && resp.getResponseCode() < 300) {
          var netBlob = resp.getBlob();
          if (isValidImageBlob(netBlob)) {
            return netBlob;
          }
          Logger.log('Warning: HTTPS logo "' + safeLogUrl + '" is not a supported image or exceeds 5 MB.');
        }
      } catch (e2) {
        Logger.log('Warning: Could not fetch HTTPS logo "' + safeLogUrl + '": ' + Utils.redactSensitiveText(e2.message, 200));
      }
    }
    return null;
  }

  /**
   * Safely replaces a character span [start, endInclusive] inside a Google Docs Text element
   * while preserving run formatting and avoiding Google Docs' full-text deleteText exception.
   */
  function replaceSpanInTextElement(textEl, start, endInclusive, replacement) {
    var current = textEl.getText();
    var rep = String(replacement === null || replacement === undefined ? '' : replacement);
    if (rep.length > 0) {
      textEl.insertText(start, rep);
      textEl.deleteText(start + rep.length, endInclusive + rep.length);
    } else if (start === 0 && endInclusive >= current.length - 1) {
      textEl.setText('');
    } else {
      textEl.deleteText(start, endInclusive);
    }
  }

  function processTextElement(textEl, placeholderMap, logoBlob, unresolvedOut) {
    var text = textEl.getText();
    if (!text || text.indexOf('{{') === -1) {
      return;
    }

    var matches = [];
    var regex = new RegExp(PLACEHOLDER_REGEX.source, 'g');
    var m;
    while ((m = regex.exec(text)) !== null) {
      matches.push({
        token: m[0],
        start: m.index,
        end: m.index + m[0].length - 1
      });
    }
    if (matches.length === 0) {
      return;
    }

    var logoToken = Config.PLACEHOLDERS.STAYCATION_LOGO;
    var logoMatched = false;

    // Replace right-to-left so earlier match offsets stay exact and guest text is never re-scanned
    for (var i = matches.length - 1; i >= 0; i--) {
      var item = matches[i];
      if (item.token === logoToken) {
        replaceSpanInTextElement(textEl, item.start, item.end, '');
        logoMatched = true;
      } else if (Object.prototype.hasOwnProperty.call(placeholderMap, item.token)) {
        replaceSpanInTextElement(textEl, item.start, item.end, placeholderMap[item.token]);
      } else {
        if (unresolvedOut.indexOf(item.token) === -1) {
          unresolvedOut.push(item.token);
        }
      }
    }

    if (logoMatched && logoBlob) {
      try {
        var parentPara = textEl.getParent && textEl.getParent();
        if (parentPara && typeof parentPara.appendInlineImage === 'function') {
          var img = parentPara.appendInlineImage(logoBlob.copyBlob());
          var maxWidth = 150;
          var origW = img.getWidth();
          var origH = img.getHeight();
          if (origW > maxWidth && origW > 0 && origH > 0) {
            img.setWidth(maxWidth);
            img.setHeight(Math.round((origH * maxWidth) / origW));
          }
        }
      } catch (imgErr) {
        Logger.log('Warning: Failed to insert inline logo image: ' + imgErr);
      }
    }
  }

  function walkElementAndReplace(element, placeholderMap, logoBlob, unresolvedOut) {
    if (!element) {
      return;
    }
    var textType = (typeof DocumentApp !== 'undefined' && DocumentApp.ElementType)
      ? DocumentApp.ElementType.TEXT
      : 'TEXT';

    if (typeof element.getType === 'function' && element.getType() === textType) {
      processTextElement(element.asText(), placeholderMap, logoBlob, unresolvedOut);
      return;
    }

    if (typeof element.getNumChildren === 'function') {
      var count = element.getNumChildren();
      for (var i = 0; i < count; i++) {
        walkElementAndReplace(element.getChild(i), placeholderMap, logoBlob, unresolvedOut);
      }
    }
  }

  function createPopulatedDocCopy(reservation, settings, outputFolder) {
    var brandingErrors = validateBrandingSettings(settings);
    if (brandingErrors.length > 0) {
      throw Utils.createAppError(
        Config.ERROR_CODES.VALIDATION_FAILED,
        'Staycation settings must be configured before generating endorsement PDFs.',
        brandingErrors
      );
    }

    var templateId = Utils.extractDriveFileId(settings.docsTemplateId);
    if (!templateId) {
      throw Utils.createAppError(
        Config.ERROR_CODES.MISSING_TEMPLATE,
        'Google Docs Template ID is not configured in the Settings sheet.'
      );
    }

    var templateFile;
    try {
      templateFile = DriveApp.getFileById(templateId);
      if (templateFile.isTrashed()) {
        throw new Error('Template file is in Trash.');
      }
      var googleDocsMime = (typeof MimeType !== 'undefined' && MimeType.GOOGLE_DOCS)
        ? MimeType.GOOGLE_DOCS
        : 'application/vnd.google-apps.document';
      if (templateFile.getMimeType() !== googleDocsMime) {
        throw new Error('Configured template file is not a Google Docs document (MIME: ' + templateFile.getMimeType() + ').');
      }
    } catch (err) {
      throw Utils.createAppError(
        Config.ERROR_CODES.MISSING_TEMPLATE,
        'Google Docs Endorsement Template ("' + templateId + '") could not be accessed: ' + err.message
      );
    }

    var tempName = 'TEMP_ENDORSEMENT_' + reservation.referenceNumber + '_' + Date.now();
    var tempFile = templateFile.makeCopy(tempName, outputFolder);
    var tempDocId = tempFile.getId();

    try {
      // Immediately lock temporary working doc to PRIVATE
      tempFile.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);

      var doc = DocumentApp.openById(tempDocId);
      var initialText = getCombinedDocText(doc);
      var missingTokens = findMissingRequiredPlaceholders(initialText);
      if (missingTokens.length > 0) {
        throw Utils.createAppError(
          Config.ERROR_CODES.UNRESOLVED_PLACEHOLDERS,
          'The Google Docs endorsement template is missing required placeholder(s): ' + missingTokens.join(', '),
          missingTokens
        );
      }

      var placeholderMap = buildPlaceholderMap(reservation, settings);
      var logoBlob = fetchLogoBlob(settings.staycationLogoUrl);
      var unresolved = [];

      var sections = [
        doc.getHeader && doc.getHeader(),
        doc.getBody(),
        doc.getFooter && doc.getFooter()
      ];

      for (var s = 0; s < sections.length; s++) {
        if (sections[s]) {
          walkElementAndReplace(sections[s], placeholderMap, logoBlob, unresolved);
        }
      }

      if (unresolved.length > 0) {
        throw Utils.createAppError(
          Config.ERROR_CODES.UNRESOLVED_PLACEHOLDERS,
          'Unresolved placeholder(s) found in the template: ' + unresolved.join(', '),
          unresolved
        );
      }

      doc.saveAndClose();
      return {
        tempDocId: tempDocId,
        tempFile: tempFile,
        placeholderMap: placeholderMap
      };
    } catch (docErr) {
      try {
        tempFile.setTrashed(true);
      } catch (cleanupErr) {
        Logger.log('Warning: Could not clean up failed temp doc "' + tempDocId + '": ' + cleanupErr);
      }
      throw docErr;
    }
  }

  return Object.freeze({
    getRequiredTemplateTokens: getRequiredTemplateTokens,
    validateBrandingSettings: validateBrandingSettings,
    buildPlaceholderMap: buildPlaceholderMap,
    findMissingRequiredPlaceholders: findMissingRequiredPlaceholders,
    findUnresolvedPlaceholders: findUnresolvedPlaceholders,
    createPopulatedDocCopy: createPopulatedDocCopy
  });
})();
