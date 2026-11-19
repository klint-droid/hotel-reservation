/**
 * ValidationService.gs
 * Server-side data validation for incoming Google Form submissions,
 * stored reservation rows (never trusting raw spreadsheet edits), and system settings.
 */

var ValidationService = (function () {
  var EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  var PHONE_CHAR_REGEX = /^[+]?[0-9][0-9\s\-()]{6,22}$/;

  function validateEmailAddress(email) {
    var normalized = Utils.normalizeEmail(email);
    if (!normalized) {
      return { valid: false, error: 'Email Address is required.' };
    }
    if (normalized.length > 254 || normalized.indexOf('..') !== -1 || !EMAIL_REGEX.test(normalized)) {
      return { valid: false, error: 'Email Address has an invalid format.' };
    }
    return { valid: true, value: normalized };
  }

  function validateContactNumber(phone) {
    var normalized = Utils.normalizePhone(phone);
    if (!normalized) {
      return { valid: false, error: 'Contact Number is required.' };
    }
    var digitsOnly = normalized.replace(/\D/g, '');
    if (!PHONE_CHAR_REGEX.test(normalized) || digitsOnly.length < 7 || digitsOnly.length > 15) {
      return {
        valid: false,
        error: 'Contact Number must be a valid phone number containing 7 to 15 digits.'
      };
    }
    return { valid: true, value: normalized };
  }

  function validateGuestName(name) {
    var cleaned = Utils.normalizeText(name);
    if (!cleaned) {
      return { valid: false, error: 'Full Name is required.' };
    }
    if (cleaned.length < Config.LIMITS.MIN_NAME_LENGTH) {
      return { valid: false, error: 'Full Name must be at least ' + Config.LIMITS.MIN_NAME_LENGTH + ' characters.' };
    }
    if (cleaned.length > Config.LIMITS.MAX_NAME_LENGTH) {
      return { valid: false, error: 'Full Name must not exceed ' + Config.LIMITS.MAX_NAME_LENGTH + ' characters.' };
    }
    return { valid: true, value: cleaned };
  }

  function validateDateRange(checkInInput, checkOutInput, options) {
    var opts = options || {};
    var tz = opts.timezone || Config.DEFAULT_TIMEZONE;
    var enforceNotInPast = opts.enforceNotInPast !== false;
    var errors = [];

    var checkIn = Utils.parseCalendarDate(checkInInput, tz);
    var checkOut = Utils.parseCalendarDate(checkOutInput, tz);

    if (!checkIn) {
      errors.push('Check-in Date is required and must be a valid calendar date.');
    }
    if (!checkOut) {
      errors.push('Check-out Date is required and must be a valid calendar date.');
    }

    if (checkIn && enforceNotInPast) {
      var todayStr = opts.todayDateString || Utils.getTodayDateString(opts.now || new Date(), tz);
      if (checkIn < todayStr) {
        errors.push('Check-in Date (' + checkIn + ') cannot be in the past (today is ' + todayStr + ').');
      }
    }

    if (checkIn && checkOut && checkOut <= checkIn) {
      errors.push('Check-out Date (' + checkOut + ') must be later than Check-in Date (' + checkIn + ').');
    }

    return {
      valid: errors.length === 0,
      errors: errors,
      checkInDate: checkIn,
      checkOutDate: checkOut
    };
  }

  function validateNumberOfGuests(rawGuests) {
    if (rawGuests === null || rawGuests === undefined || String(rawGuests).trim() === '') {
      return { valid: false, error: 'Number of Guests is required.' };
    }
    var str = String(rawGuests).trim();
    if (!/^-?\d+$/.test(str)) {
      return { valid: false, error: 'Number of Guests must be a whole number.' };
    }
    var count = parseInt(str, 10);
    if (count < Config.LIMITS.MIN_GUESTS) {
      return { valid: false, error: 'Number of Guests must be greater than zero.' };
    }
    if (count > Config.LIMITS.MAX_GUESTS) {
      return { valid: false, error: 'Number of Guests exceeds maximum allowed (' + Config.LIMITS.MAX_GUESTS + ').' };
    }
    return { valid: true, value: count };
  }

  function validateAgreement(rawAgreement) {
    if (rawAgreement === true) {
      return { valid: true, value: true };
    }
    if (typeof rawAgreement === 'string') {
      var cleaned = rawAgreement.trim().toLowerCase();
      if (cleaned && cleaned !== 'false' && cleaned !== 'no' && cleaned !== '0') {
        return { valid: true, value: true };
      }
    }
    if (Array.isArray(rawAgreement) && rawAgreement.length > 0 && String(rawAgreement[0]).trim() !== '') {
      return { valid: true, value: true };
    }
    return { valid: false, error: 'Agreement to House Rules must be checked.' };
  }

  /**
   * Full server-side validation for incoming guest Google Form submissions.
   */
  function validateFormSubmission(payload, options) {
    var opts = options || {};
    var tz = opts.timezone || Config.DEFAULT_TIMEZONE;
    var errors = [];
    var data = payload || {};

    var nameRes = validateGuestName(data.guestName);
    if (!nameRes.valid) errors.push(nameRes.error);

    var emailRes = validateEmailAddress(data.emailAddress);
    if (!emailRes.valid) errors.push(emailRes.error);

    var phoneRes = validateContactNumber(data.contactNumber);
    if (!phoneRes.valid) errors.push(phoneRes.error);

    var dateRes = validateDateRange(data.checkInDate, data.checkOutDate, {
      timezone: tz,
      now: opts.now,
      todayDateString: opts.todayDateString,
      enforceNotInPast: opts.enforceNotInPast !== false
    });
    if (!dateRes.valid) {
      errors = errors.concat(dateRes.errors);
    }

    var guestsRes = validateNumberOfGuests(data.numberOfGuests);
    if (!guestsRes.valid) errors.push(guestsRes.error);

    var rooms = Utils.normalizeText(data.numberOfRooms);
    if (!rooms) {
      rooms = 'Not Applicable';
    } else if (rooms.length > 50) {
      errors.push('Number of Rooms must not exceed 50 characters.');
    }

    var specialRequests = Utils.normalizeText(data.specialRequests);
    if (specialRequests.length > Config.LIMITS.MAX_SPECIAL_REQUESTS_LENGTH) {
      errors.push('Special Requests must not exceed ' + Config.LIMITS.MAX_SPECIAL_REQUESTS_LENGTH + ' characters.');
    }

    var agreeRes = validateAgreement(data.agreedToHouseRules);
    if (!agreeRes.valid) errors.push(agreeRes.error);

    return {
      valid: errors.length === 0,
      errors: errors,
      sanitized: {
        guestName: nameRes.valid ? nameRes.value : Utils.normalizeText(data.guestName),
        emailAddress: emailRes.valid ? emailRes.value : Utils.normalizeEmail(data.emailAddress),
        contactNumber: phoneRes.valid ? phoneRes.value : Utils.normalizePhone(data.contactNumber),
        checkInDate: dateRes.checkInDate || '',
        checkOutDate: dateRes.checkOutDate || '',
        numberOfGuests: guestsRes.valid ? guestsRes.value : 0,
        numberOfRooms: rooms,
        specialRequests: specialRequests,
        agreedToHouseRules: agreeRes.valid
      }
    };
  }

  /**
   * Re-validates an existing reservation record read from Google Sheets before
   * approval, PDF generation, or email sending (never trusting raw spreadsheet edits).
   */
  function validateReservationRecord(reservation, options) {
    var opts = options || {};
    var errors = [];
    if (!reservation) {
      return { valid: false, errors: ['Reservation record is missing.'] };
    }

    if (!Utils.normalizeText(reservation.reservationId)) {
      errors.push('Reservation ID is missing.');
    }
    if (!/^STAY-\d{8}-\d{4,}$/.test(Utils.normalizeText(reservation.referenceNumber))) {
      errors.push('Reference Number has an invalid format (expected STAY-YYYYMMDD-XXXX).');
    }

    var nameRes = validateGuestName(reservation.guestName);
    if (!nameRes.valid) errors.push(nameRes.error);

    var emailRes = validateEmailAddress(reservation.emailAddress);
    if (!emailRes.valid) errors.push(emailRes.error);

    var phoneRes = validateContactNumber(reservation.contactNumber);
    if (!phoneRes.valid) errors.push(phoneRes.error);

    var dateRes = validateDateRange(reservation.checkInDate, reservation.checkOutDate, {
      timezone: opts.timezone || Config.DEFAULT_TIMEZONE,
      now: opts.now,
      todayDateString: opts.todayDateString,
      enforceNotInPast: Boolean(opts.enforceNotInPast)
    });
    if (!dateRes.valid) {
      errors = errors.concat(dateRes.errors);
    }

    var guestsRes = validateNumberOfGuests(reservation.numberOfGuests);
    if (!guestsRes.valid) errors.push(guestsRes.error);

    var rooms = Utils.normalizeText(reservation.numberOfRooms);
    if (rooms.length > 50) {
      errors.push('Number of Rooms must not exceed 50 characters.');
    }

    var specialRequests = Utils.normalizeText(reservation.specialRequests);
    if (specialRequests.length > Config.LIMITS.MAX_SPECIAL_REQUESTS_LENGTH) {
      errors.push('Special Requests must not exceed ' + Config.LIMITS.MAX_SPECIAL_REQUESTS_LENGTH + ' characters.');
    }

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  function validateSettingsUpdate(updates, currentAdminEmail) {
    var errors = [];
    var map = updates || {};
    var K = Config.SETTINGS_KEYS;

    var requiredTextKeys = [
      { key: K.STAYCATION_NAME, label: 'Staycation Name' },
      { key: K.STAYCATION_CONTACT_NUMBER, label: 'Staycation Contact Number' },
      { key: K.CHECK_IN_TIME, label: 'Check-in Time' },
      { key: K.CHECK_OUT_TIME, label: 'Check-out Time' },
      { key: K.DOCS_TEMPLATE_ID, label: 'Google Docs Template ID' },
      { key: K.DRIVE_OUTPUT_FOLDER_ID, label: 'Drive Output Folder ID' }
    ];
    for (var r = 0; r < requiredTextKeys.length; r++) {
      var rk = requiredTextKeys[r];
      if (Object.prototype.hasOwnProperty.call(map, rk.key)) {
        if (Config.isUnconfiguredValue(map[rk.key])) {
          errors.push(rk.label + ' cannot be blank or unconfigured.');
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(map, K.STAYCATION_EMAIL_ADDRESS)) {
      var stayEmail = String(map[K.STAYCATION_EMAIL_ADDRESS] || '').trim();
      if (Config.isUnconfiguredValue(stayEmail)) {
        errors.push('Staycation Email Address is required.');
      } else {
        var check = validateEmailAddress(stayEmail);
        if (!check.valid) errors.push('Staycation Email Address: ' + check.error);
      }
    }

    if (Object.prototype.hasOwnProperty.call(map, K.STAYCATION_LOGO_URL)) {
      var logoVal = String(map[K.STAYCATION_LOGO_URL] || '').trim();
      if (logoVal && !Config.isUnconfiguredValue(logoVal)) {
        var isDriveId = Boolean(Utils.extractDriveFileId(logoVal));
        var isHttps = /^https:\/\/[^\s]+$/i.test(logoVal);
        if (!isDriveId && !isHttps) {
          errors.push('Staycation Logo URL must be a valid Google Drive File ID/URL or HTTPS image URL.');
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(map, K.ADMINISTRATOR_EMAIL)) {
      var admins = Config.parseAdminEmails(map[K.ADMINISTRATOR_EMAIL]);
      if (admins.length === 0) {
        errors.push('Administrator Email must contain at least one valid email address.');
      } else {
        for (var i = 0; i < admins.length; i++) {
          if (!validateEmailAddress(admins[i]).valid) {
            errors.push('Invalid Administrator Email: ' + admins[i]);
          }
        }
        var currentNormalized = Utils.normalizeEmail(currentAdminEmail);
        if (currentNormalized && admins.indexOf(currentNormalized) === -1) {
          errors.push('Cannot remove your own active administrator email ("' + currentNormalized + '") to prevent self-lockout.');
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(map, K.TIMEZONE)) {
      var tz = String(map[K.TIMEZONE] || '').trim();
      if (!tz || !/^[A-Za-z_]+\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)?$/.test(tz)) {
        errors.push('Timezone must be a valid IANA identifier (e.g., Asia/Manila).');
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  return Object.freeze({
    validateEmailAddress: validateEmailAddress,
    validateContactNumber: validateContactNumber,
    validateGuestName: validateGuestName,
    validateDateRange: validateDateRange,
    validateNumberOfGuests: validateNumberOfGuests,
    validateAgreement: validateAgreement,
    validateFormSubmission: validateFormSubmission,
    validateReservationRecord: validateReservationRecord,
    validateSettingsUpdate: validateSettingsUpdate
  });
})();
