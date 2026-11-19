/**
 * FormHandler.gs
 * Handles incoming guest submissions from the public Google Form via an
 * installable onFormSubmit trigger.
 *
 * Business Rule Enforcement:
 * - Performs full server-side validation regardless of Google Forms client validation.
 * - Reads native typed cell Date objects from e.range when available to prevent
 *   locale DD/MM/YYYY vs MM/DD/YYYY transpositions.
 * - Uses CacheService (6-hour TTL) for trigger replay deduplication (zero ScriptProperties bloat).
 * - Uses LockService to prevent duplicate reference numbers during simultaneous submissions.
 * - Stores valid reservations with Approval Status = PENDING and Email Status = NOT_SENT.
 * - NEVER sends an endorsement email upon submission.
 */

var FormHandler = (function () {
  var REPLAY_CACHE_TTL_SECONDS = 21600; // 6 hours (Apps Script max)

  function firstValue(val) {
    if (Array.isArray(val)) {
      return val.length > 0 ? val[0] : '';
    }
    return val === null || val === undefined ? '' : val;
  }

  function findNamedField(namedValues, candidates) {
    var keys = Object.keys(namedValues || {});
    for (var c = 0; c < candidates.length; c++) {
      var target = candidates[c].toLowerCase();
      for (var k = 0; k < keys.length; k++) {
        if (keys[k].trim().toLowerCase() === target) {
          return firstValue(namedValues[keys[k]]);
        }
      }
    }
    return '';
  }

  function buildPayloadFromMap(map) {
    var F = Config.FORM_CONFIG.FIELDS;
    return {
      guestName: findNamedField(map, [F.FULL_NAME, 'Guest Name', 'Name']),
      emailAddress: findNamedField(map, [F.EMAIL_ADDRESS, 'Email']),
      contactNumber: findNamedField(map, [F.CONTACT_NUMBER, 'Phone', 'Mobile Number']),
      checkInDate: findNamedField(map, [F.CHECK_IN_DATE, 'Check-In Date']),
      checkOutDate: findNamedField(map, [F.CHECK_OUT_DATE, 'Check-Out Date']),
      numberOfGuests: findNamedField(map, [F.NUMBER_OF_GUESTS, 'Guests']),
      numberOfRooms: findNamedField(map, [F.NUMBER_OF_ROOMS, 'Rooms']),
      companionGuests: findNamedField(map, [F.COMPANION_GUESTS, 'Companion Guests', 'Other Guest Names', 'Guest Names', 'List of Guests']),
      validIdFileIds: findNamedField(map, [F.VALID_ID_UPLOAD, 'Upload Valid ID', 'Upload Valid ID(s)', 'Valid ID', 'Valid ID(s)', 'Government ID', 'ID Upload', 'Upload ID']),
      specialRequests: findNamedField(map, [F.SPECIAL_REQUESTS, 'Requests']),
      agreedToHouseRules: findNamedField(map, [F.AGREEMENT, 'House Rules'])
    };
  }

  function extractPayloadFromEvent(e, allowSyntheticPayload) {
    if (!e) {
      return { payload: null, formResponseId: null };
    }

    // 1. Direct normalized payload (allowed only for direct API/test calls, not production triggers)
    if (allowSyntheticPayload !== false && e.payload && typeof e.payload === 'object') {
      return {
        payload: e.payload,
        formResponseId: e.formResponseId || null,
        submittedAt: e.submittedAt || null
      };
    }

    // 2. Google Sheets installable onFormSubmit trigger with e.range (preferred: preserves native Date objects!)
    if (e.range && typeof e.range.getSheet === 'function' && typeof e.range.getValues === 'function') {
      try {
        var sheet = e.range.getSheet();
        var rowValues = e.range.getValues()[0];
        var numCols = rowValues.length;
        var headerValues = sheet.getRange(1, 1, 1, numCols).getValues()[0];
        var byHeader = {};
        for (var col = 0; col < numCols; col++) {
          var headerTitle = String(headerValues[col] || '').trim();
          if (headerTitle) {
            byHeader[headerTitle] = rowValues[col];
          }
        }
        var payloadFromRange = buildPayloadFromMap(byHeader);
        var tsCell = findNamedField(byHeader, ['Timestamp']);
        var submittedAtDate = tsCell instanceof Date
          ? tsCell
          : (tsCell ? new Date(tsCell) : null);
        var respIdFromRange = e.formResponseId || (
          'ROW_' + sheet.getName() + '_' + e.range.getRow() + '_' +
          (submittedAtDate && !isNaN(submittedAtDate.getTime()) ? submittedAtDate.getTime() : '') + '_' +
          Utils.normalizeEmail(payloadFromRange.emailAddress)
        );
        return {
          formResponseId: respIdFromRange,
          submittedAt: submittedAtDate,
          payload: payloadFromRange
        };
      } catch (rangeErr) {
        Logger.log('Note: Could not read typed values from e.range; falling back to e.namedValues: ' + rangeErr);
      }
    }

    // 3. Google Sheets installable onFormSubmit trigger (e.namedValues fallback)
    if (e.namedValues && typeof e.namedValues === 'object') {
      var nv = e.namedValues;
      var payloadFromNv = buildPayloadFromMap(nv);
      var tsRaw = findNamedField(nv, ['Timestamp']);
      var respId = e.formResponseId || (tsRaw ? ('NV_' + String(tsRaw).trim() + '_' + Utils.normalizeEmail(payloadFromNv.emailAddress)) : null);

      return {
        formResponseId: respId,
        submittedAt: tsRaw ? new Date(tsRaw) : null,
        payload: payloadFromNv
      };
    }

    // 4. Google Forms installable onFormSubmit trigger (e.response)
    if (e.response && typeof e.response.getItemResponses === 'function') {
      var itemResponses = e.response.getItemResponses();
      var byTitle = {};
      for (var i = 0; i < itemResponses.length; i++) {
        var title = itemResponses[i].getItem().getTitle();
        byTitle[title] = itemResponses[i].getResponse();
      }
      return {
        formResponseId: typeof e.response.getId === 'function' ? e.response.getId() : null,
        submittedAt: typeof e.response.getTimestamp === 'function' ? e.response.getTimestamp() : null,
        payload: buildPayloadFromMap(byTitle)
      };
    }

    return { payload: null, formResponseId: null };
  }

  function getReplayCache() {
    try {
      if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
        return CacheService.getScriptCache();
      }
    } catch (e) {
      Logger.log('Note: CacheService unavailable: ' + e);
    }
    return null;
  }

  function handleFormSubmit(e, ss, options) {
    var opts = options || {};
    var spreadsheet = Config.getActiveSpreadsheetOrThrow(ss);
    var settings = Config.getSettings(spreadsheet);
    var tz = settings.timezone || Config.DEFAULT_TIMEZONE;
    var now = opts.now || new Date();

    var extracted = extractPayloadFromEvent(e, opts.allowSyntheticPayload !== false);
    if (!extracted.payload) {
      ActivityLogService.logActivity({
        reservationId: 'SYSTEM',
        referenceNumber: 'N/A',
        administrator: 'SYSTEM/FORM_SUBMIT',
        action: Config.ACTIVITY_ACTIONS.VALIDATION_FAILED,
        previousValue: '',
        newValue: 'REJECTED_PAYLOAD',
        remarks: 'Form submission event did not contain recognizable guest fields.'
      }, spreadsheet);
      return Utils.fail(
        Config.ERROR_CODES.VALIDATION_FAILED,
        'Form submission payload was empty or malformed.'
      );
    }

    // Server-side validation (never rely solely on Google Forms client validation)
    var validation = ValidationService.validateFormSubmission(extracted.payload, {
      timezone: tz,
      now: now,
      todayDateString: opts.todayDateString,
      enforceNotInPast: opts.enforceNotInPast !== false
    });

    if (!validation.valid) {
      ActivityLogService.logActivity({
        reservationId: 'SYSTEM',
        referenceNumber: 'N/A',
        administrator: 'SYSTEM/FORM_SUBMIT',
        action: Config.ACTIVITY_ACTIONS.VALIDATION_FAILED,
        previousValue: '',
        newValue: 'INVALID_SUBMISSION',
        remarks: 'Server-side validation rejected submission (' +
          (validation.sanitized.emailAddress || 'no-email') + '): ' + validation.errors.join(' | ')
      }, spreadsheet);
      return Utils.fail(
        Config.ERROR_CODES.VALIDATION_FAILED,
        'Guest reservation submission failed server-side validation.',
        validation.errors
      );
    }

    var sanitized = validation.sanitized;

    return Utils.withScriptLock(function () {
      var cache = getReplayCache();

      // Exact trigger replay guard via expiring ScriptCache (avoids ScriptProperties bloat)
      if (extracted.formResponseId && cache) {
        var replayKey = Config.PROPERTY_PREFIXES.PROCESSED_FORM_RESPONSE + extracted.formResponseId;
        var existingRef = cache.get(replayKey);
        if (existingRef) {
          ActivityLogService.logActivity({
            reservationId: 'SYSTEM',
            referenceNumber: existingRef,
            administrator: 'SYSTEM/FORM_SUBMIT',
            action: Config.ACTIVITY_ACTIONS.DUPLICATE_SUBMISSION_BLOCKED,
            previousValue: existingRef,
            newValue: 'REPLAY_IGNORED',
            remarks: 'Duplicate trigger replay ignored for Form Response ID ' + extracted.formResponseId
          }, spreadsheet);
          return Utils.fail(
            Config.ERROR_CODES.DUPLICATE_SUBMISSION,
            'Duplicate form submission replay ignored (already recorded as ' + existingRef + ').'
          );
        }
      }

      // Active reservation duplicate check
      var duplicate = ReservationService.findDuplicateMatch(sanitized, spreadsheet);
      var adminRemarks = '';

      if (duplicate && duplicate.type === 'EXACT') {
        ActivityLogService.logActivity({
          reservationId: duplicate.existing.reservationId,
          referenceNumber: duplicate.existing.referenceNumber,
          administrator: 'SYSTEM/FORM_SUBMIT',
          action: Config.ACTIVITY_ACTIONS.DUPLICATE_SUBMISSION_BLOCKED,
          previousValue: duplicate.existing.approvalStatus,
          newValue: 'DUPLICATE_BLOCKED',
          remarks: 'Exact duplicate submission blocked for ' + sanitized.emailAddress +
            ' (' + sanitized.checkInDate + ' to ' + sanitized.checkOutDate + '). Original record preserved.'
        }, spreadsheet);
        return Utils.fail(
          Config.ERROR_CODES.DUPLICATE_SUBMISSION,
          'Duplicate reservation submission detected. Existing reference: ' + duplicate.existing.referenceNumber,
          ['Identical active reservation already exists (' + duplicate.existing.referenceNumber + ').'],
          { existingReferenceNumber: duplicate.existing.referenceNumber }
        );
      }

      if (duplicate && duplicate.type === 'OVERLAPPING') {
        adminRemarks = '[FLAG: Potential duplicate of ' + duplicate.existing.referenceNumber + ' (same email & overlapping dates)]';
      }

      var submissionTime = extracted.submittedAt && !isNaN(new Date(extracted.submittedAt).getTime())
        ? new Date(extracted.submittedAt)
        : now;

      var referenceNumber = ReferenceGenerator.generateNextInLock(submissionTime, spreadsheet, tz);

      var created = ReservationService.createReservation(sanitized, referenceNumber, {
        timezone: tz,
        submittedAt: submissionTime,
        adminRemarks: adminRemarks
      }, spreadsheet);

      // Ensure uploaded guest Valid ID files remain PRIVATE in Drive
      var uploadedIds = Utils.extractDriveFileIds(sanitized.validIdFileIds);
      for (var idIdx = 0; idIdx < uploadedIds.length; idIdx++) {
        try {
          SecurityService.enforcePrivateFilePermissions(uploadedIds[idIdx]);
        } catch (idPrivErr) {
          Logger.log('Note: Could not enforce PRIVATE sharing on uploaded ID "' + uploadedIds[idIdx] + '": ' + idPrivErr);
        }
      }

      if (extracted.formResponseId && cache) {
        cache.put(
          Config.PROPERTY_PREFIXES.PROCESSED_FORM_RESPONSE + extracted.formResponseId,
          referenceNumber,
          REPLAY_CACHE_TTL_SECONDS
        );
      }

      ActivityLogService.logActivity({
        reservationId: created.reservation.reservationId,
        referenceNumber: referenceNumber,
        administrator: 'SYSTEM/FORM_SUBMIT',
        action: Config.ACTIVITY_ACTIONS.RESERVATION_CREATED,
        previousValue: '',
        newValue: Config.APPROVAL_STATUS.PENDING + ' / ' + Config.EMAIL_STATUS.NOT_SENT,
        remarks: 'New guest reservation submitted for ' + sanitized.guestName +
          ' (' + sanitized.checkInDate + ' to ' + sanitized.checkOutDate + '). Awaiting manual review.'
      }, spreadsheet);

      if (duplicate && duplicate.type === 'OVERLAPPING') {
        ActivityLogService.logActivity({
          reservationId: created.reservation.reservationId,
          referenceNumber: referenceNumber,
          administrator: 'SYSTEM/FORM_SUBMIT',
          action: Config.ACTIVITY_ACTIONS.DUPLICATE_SUBMISSION_FLAGGED,
          previousValue: duplicate.existing.referenceNumber,
          newValue: referenceNumber,
          remarks: adminRemarks
        }, spreadsheet);
      }

      // IMPORTANT BUSINESS RULE: Never send an endorsement email upon submission.
      return Utils.ok('Reservation received and saved as PENDING.', created.reservation);
    });
  }

  return Object.freeze({
    extractPayloadFromEvent: extractPayloadFromEvent,
    handleFormSubmit: handleFormSubmit
  });
})();
