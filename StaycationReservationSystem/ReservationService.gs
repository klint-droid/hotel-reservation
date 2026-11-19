/**
 * ReservationService.gs
 * Data access layer for Sheet 1: Reservations.
 * Always identifies reservations by immutable Reservation ID (never row index).
 */

var ReservationService = (function () {
  function isEndorsedColumn(colIndex) {
    return Config.ENDORSED_COLUMNS.indexOf(colIndex) !== -1;
  }

  function rowToReservation(rowValues, timezone) {
    var C = Config.RESERVATION_COLS;
    var tz = timezone || Config.DEFAULT_TIMEZONE;

    var rawCheckIn = rowValues[C.CHECK_IN_DATE - 1];
    var rawCheckOut = rowValues[C.CHECK_OUT_DATE - 1];
    var parsedCheckIn = Utils.parseCalendarDate(rawCheckIn, tz);
    var parsedCheckOut = Utils.parseCalendarDate(rawCheckOut, tz);

    var rawGuests = rowValues[C.NUMBER_OF_GUESTS - 1];
    var guestsNum = rawGuests === '' || rawGuests === null || rawGuests === undefined
      ? ''
      : Number(rawGuests);

    return {
      reservationId: Utils.normalizeText(rowValues[C.RESERVATION_ID - 1]),
      referenceNumber: Utils.normalizeText(rowValues[C.REFERENCE_NUMBER - 1]),
      guestName: Utils.stripLeadingQuote(Utils.normalizeText(rowValues[C.GUEST_NAME - 1])),
      emailAddress: Utils.normalizeEmail(rowValues[C.EMAIL_ADDRESS - 1]),
      contactNumber: Utils.stripLeadingQuote(Utils.normalizePhone(rowValues[C.CONTACT_NUMBER - 1])),
      checkInDate: parsedCheckIn || Utils.normalizeText(rawCheckIn),
      checkOutDate: parsedCheckOut || Utils.normalizeText(rawCheckOut),
      numberOfGuests: isNaN(guestsNum) ? Utils.normalizeText(rawGuests) : guestsNum,
      numberOfRooms: Utils.stripLeadingQuote(Utils.normalizeText(rowValues[C.NUMBER_OF_ROOMS - 1])) || 'Not Applicable',
      specialRequests: Utils.stripLeadingQuote(Utils.normalizeText(rowValues[C.SPECIAL_REQUESTS - 1])),
      approvalStatus: Utils.normalizeText(rowValues[C.APPROVAL_STATUS - 1]),
      adminRemarks: Utils.stripLeadingQuote(Utils.normalizeText(rowValues[C.ADMIN_REMARKS - 1])),
      emailStatus: Utils.normalizeText(rowValues[C.EMAIL_STATUS - 1]),
      submittedAt: rowValues[C.SUBMITTED_AT - 1] instanceof Date
        ? Utils.formatTimestamp(rowValues[C.SUBMITTED_AT - 1], tz)
        : Utils.normalizeText(rowValues[C.SUBMITTED_AT - 1]),
      approvedAt: rowValues[C.APPROVED_AT - 1] instanceof Date
        ? Utils.formatTimestamp(rowValues[C.APPROVED_AT - 1], tz)
        : Utils.normalizeText(rowValues[C.APPROVED_AT - 1]),
      approvedBy: Utils.normalizeEmail(rowValues[C.APPROVED_BY - 1]),
      pdfFileId: Utils.normalizeText(rowValues[C.PDF_FILE_ID - 1]),
      pdfFileUrl: Utils.normalizeText(rowValues[C.PDF_FILE_URL - 1]),
      emailSentAt: rowValues[C.EMAIL_SENT_AT - 1] instanceof Date
        ? Utils.formatTimestamp(rowValues[C.EMAIL_SENT_AT - 1], tz)
        : Utils.normalizeText(rowValues[C.EMAIL_SENT_AT - 1]),
      lastError: Utils.stripLeadingQuote(Utils.normalizeText(rowValues[C.LAST_ERROR - 1])),
      companionGuests: Utils.stripLeadingQuote(Utils.normalizeText(rowValues[C.COMPANION_GUESTS - 1])),
      validIdFileIds: Utils.stripLeadingQuote(Utils.normalizeText(rowValues[C.VALID_ID_FILE_IDS - 1]))
    };
  }

  function reservationToRow(res) {
    return [
      res.reservationId || '',
      res.referenceNumber || '',
      Utils.sanitizeSheetCell(res.guestName || ''),
      Utils.sanitizeSheetCell(res.emailAddress || ''),
      Utils.sanitizeSheetCell(res.contactNumber || ''),
      res.checkInDate || '',
      res.checkOutDate || '',
      res.numberOfGuests === '' || res.numberOfGuests === undefined ? '' : Number(res.numberOfGuests),
      Utils.sanitizeSheetCell(res.numberOfRooms || 'Not Applicable'),
      Utils.sanitizeSheetCell(res.specialRequests || ''),
      res.approvalStatus || Config.APPROVAL_STATUS.PENDING,
      Utils.sanitizeSheetCell(res.adminRemarks || ''),
      res.emailStatus || Config.EMAIL_STATUS.NOT_SENT,
      res.submittedAt || '',
      res.approvedAt || '',
      res.approvedBy || '',
      res.pdfFileId || '',
      res.pdfFileUrl || '',
      res.emailSentAt || '',
      Utils.sanitizeSheetCell(res.lastError || ''),
      Utils.sanitizeSheetCell(res.companionGuests || ''),
      Utils.sanitizeSheetCell(res.validIdFileIds || '')
    ];
  }

  function getAllReservations(ss) {
    var sheet = Config.getSheetOrThrow(Config.SHEETS.RESERVATIONS, ss);
    var settings = Config.getSettings(ss);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return [];
    }

    var values = sheet.getRange(2, 1, lastRow - 1, Config.RESERVATION_HEADERS.length).getValues();
    var records = [];
    for (var i = 0; i < values.length; i++) {
      var resId = Utils.normalizeText(values[i][Config.RESERVATION_COLS.RESERVATION_ID - 1]);
      if (!resId) {
        continue;
      }
      records.push({
        rowIndex: i + 2,
        reservation: rowToReservation(values[i], settings.timezone)
      });
    }
    return records;
  }

  function getReservationById(reservationId, ss) {
    var targetId = Utils.normalizeText(reservationId);
    if (!targetId) {
      return null;
    }
    var all = getAllReservations(ss);
    for (var i = 0; i < all.length; i++) {
      if (all[i].reservation.reservationId === targetId) {
        return all[i];
      }
    }
    return null;
  }

  function getReservationByReference(referenceNumber, ss) {
    var targetRef = Utils.normalizeText(referenceNumber).toUpperCase();
    if (!targetRef) {
      return null;
    }
    var all = getAllReservations(ss);
    for (var i = 0; i < all.length; i++) {
      if (all[i].reservation.referenceNumber.toUpperCase() === targetRef) {
        return all[i];
      }
    }
    return null;
  }

  function getSelectedReservation(ss) {
    var spreadsheet = Config.getActiveSpreadsheetOrThrow(ss);
    var activeSheet = spreadsheet.getActiveSheet();
    if (!activeSheet || activeSheet.getName() !== Config.SHEETS.RESERVATIONS) {
      throw Utils.createAppError(
        Config.ERROR_CODES.NOT_FOUND,
        'Please switch to the "' + Config.SHEETS.RESERVATIONS + '" sheet and select a reservation row first.'
      );
    }

    var activeRange = activeSheet.getActiveRange();
    if (!activeRange) {
      throw Utils.createAppError(
        Config.ERROR_CODES.NOT_FOUND,
        'No cell is currently selected. Please click on a reservation row first.'
      );
    }

    var rowIndex = activeRange.getRow();
    if (rowIndex < 2 || rowIndex > activeSheet.getLastRow()) {
      throw Utils.createAppError(
        Config.ERROR_CODES.NOT_FOUND,
        'Please select a valid reservation data row (row 2 or below).'
      );
    }

    var resId = Utils.normalizeText(
      activeSheet.getRange(rowIndex, Config.RESERVATION_COLS.RESERVATION_ID).getValue()
    );
    if (!resId) {
      throw Utils.createAppError(
        Config.ERROR_CODES.NOT_FOUND,
        'The selected row does not contain a valid Reservation ID.'
      );
    }

    var found = getReservationById(resId, spreadsheet);
    if (!found) {
      throw Utils.createAppError(
        Config.ERROR_CODES.NOT_FOUND,
        'Selected Reservation ID "' + resId + '" could not be resolved in the Reservations sheet.'
      );
    }
    return found;
  }

  /**
   * Detects exact duplicate or overlapping active (PENDING / APPROVED) reservations.
   */
  function findDuplicateMatch(sanitizedData, ss) {
    var all = getAllReservations(ss);
    var email = Utils.normalizeEmail(sanitizedData.emailAddress);
    var nameLower = Utils.normalizeText(sanitizedData.guestName).toLowerCase();
    var checkIn = sanitizedData.checkInDate;
    var checkOut = sanitizedData.checkOutDate;
    var guests = Number(sanitizedData.numberOfGuests);
    var rooms = Utils.normalizeText(sanitizedData.numberOfRooms || 'Not Applicable').toLowerCase();

    var overlappingCandidate = null;

    for (var i = 0; i < all.length; i++) {
      var existing = all[i].reservation;
      if (existing.approvalStatus === Config.APPROVAL_STATUS.REJECTED) {
        continue;
      }
      if (Utils.normalizeEmail(existing.emailAddress) !== email) {
        continue;
      }

      var sameDates = existing.checkInDate === checkIn && existing.checkOutDate === checkOut;
      var sameName = Utils.normalizeText(existing.guestName).toLowerCase() === nameLower;
      var sameGuests = Number(existing.numberOfGuests) === guests;
      var sameRooms = Utils.normalizeText(existing.numberOfRooms || 'Not Applicable').toLowerCase() === rooms;

      if (sameDates && sameName && sameGuests && sameRooms) {
        return { type: 'EXACT', existing: existing };
      }

      // Overlap check: [checkIn, checkOut) intersects [existing.checkInDate, existing.checkOutDate)
      if (!overlappingCandidate && existing.checkInDate && existing.checkOutDate) {
        if (checkIn < existing.checkOutDate && checkOut > existing.checkInDate) {
          overlappingCandidate = existing;
        }
      }
    }

    if (overlappingCandidate) {
      return { type: 'OVERLAPPING', existing: overlappingCandidate };
    }
    return null;
  }

  function createReservation(validatedData, referenceNumber, options, ss) {
    var sheet = Config.getSheetOrThrow(Config.SHEETS.RESERVATIONS, ss);
    var settings = Config.getSettings(ss);
    var opts = options || {};
    var tz = opts.timezone || settings.timezone || Config.DEFAULT_TIMEZONE;
    var now = opts.submittedAt || new Date();

    var reservation = {
      reservationId: Utils.generateUuid('RES'),
      referenceNumber: referenceNumber,
      guestName: validatedData.guestName,
      emailAddress: validatedData.emailAddress,
      contactNumber: validatedData.contactNumber,
      checkInDate: validatedData.checkInDate,
      checkOutDate: validatedData.checkOutDate,
      numberOfGuests: Number(validatedData.numberOfGuests),
      numberOfRooms: validatedData.numberOfRooms || 'Not Applicable',
      specialRequests: validatedData.specialRequests || '',
      approvalStatus: Config.APPROVAL_STATUS.PENDING,
      adminRemarks: opts.adminRemarks || '',
      emailStatus: Config.EMAIL_STATUS.NOT_SENT,
      submittedAt: Utils.formatTimestamp(now, tz),
      approvedAt: '',
      approvedBy: '',
      pdfFileId: '',
      pdfFileUrl: '',
      emailSentAt: '',
      lastError: '',
      companionGuests: validatedData.companionGuests || '',
      validIdFileIds: validatedData.validIdFileIds || ''
    };

    var nextRow = Math.max(sheet.getLastRow() + 1, 2);
    var C = Config.RESERVATION_COLS;

    // Enforce plain-text formats prior to writing so phone numbers, IDs, and YYYY-MM-DD dates are never coerced
    sheet.getRange(nextRow, C.RESERVATION_ID).setNumberFormat('@');
    sheet.getRange(nextRow, C.REFERENCE_NUMBER).setNumberFormat('@');
    sheet.getRange(nextRow, C.CONTACT_NUMBER).setNumberFormat('@');
    sheet.getRange(nextRow, C.NUMBER_OF_ROOMS).setNumberFormat('@');
    sheet.getRange(nextRow, C.CHECK_IN_DATE).setNumberFormat('@');
    sheet.getRange(nextRow, C.CHECK_OUT_DATE).setNumberFormat('@');
    sheet.getRange(nextRow, C.VALID_ID_FILE_IDS).setNumberFormat('@');

    sheet.getRange(nextRow, 1, 1, Config.RESERVATION_HEADERS.length)
      .setValues([reservationToRow(reservation)]);

    return {
      rowIndex: nextRow,
      reservation: reservation
    };
  }

  function updateReservationFields(reservationId, patch, ss) {
    var sheet = Config.getSheetOrThrow(Config.SHEETS.RESERVATIONS, ss);
    var found = getReservationById(reservationId, ss);
    if (!found) {
      throw Utils.createAppError(
        Config.ERROR_CODES.NOT_FOUND,
        'Reservation ID "' + reservationId + '" was not found.'
      );
    }

    var merged = Object.assign({}, found.reservation, patch || {});
    // Unconditionally preserve immutable primary key and reference number
    merged.reservationId = found.reservation.reservationId;
    merged.referenceNumber = found.reservation.referenceNumber;

    var rowIdx = found.rowIndex;
    var C = Config.RESERVATION_COLS;
    sheet.getRange(rowIdx, C.CONTACT_NUMBER).setNumberFormat('@');
    sheet.getRange(rowIdx, C.CHECK_IN_DATE).setNumberFormat('@');
    sheet.getRange(rowIdx, C.CHECK_OUT_DATE).setNumberFormat('@');
    sheet.getRange(rowIdx, C.PDF_FILE_ID).setNumberFormat('@');
    sheet.getRange(rowIdx, C.VALID_ID_FILE_IDS).setNumberFormat('@');
    sheet.getRange(rowIdx, 1, 1, Config.RESERVATION_HEADERS.length)
      .setValues([reservationToRow(merged)]);

    return {
      rowIndex: rowIdx,
      reservation: merged
    };
  }

  return Object.freeze({
    isEndorsedColumn: isEndorsedColumn,
    rowToReservation: rowToReservation,
    reservationToRow: reservationToRow,
    getAllReservations: getAllReservations,
    getReservationById: getReservationById,
    getReservationByReference: getReservationByReference,
    getSelectedReservation: getSelectedReservation,
    findDuplicateMatch: findDuplicateMatch,
    createReservation: createReservation,
    updateReservationFields: updateReservationFields
  });
})();
