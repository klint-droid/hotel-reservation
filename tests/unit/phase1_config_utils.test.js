'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGasMockRuntime } = require('../helpers/gasMockRuntime');

test('Phase 1: Config defines exact frozen schema headers and constants', () => {
  const env = createGasMockRuntime();
  env.loadGasFiles(['Config.gs', 'Utils.gs']);

  const { Config } = env.ctx;
  assert.equal(Config.DEFAULT_TIMEZONE, 'Asia/Manila');
  assert.equal(Config.MENU_TITLE, 'STAYCATION MANAGEMENT');
  assert.equal(Config.RESERVATION_HEADERS.length, 20);
  assert.equal(Config.RESERVATION_HEADERS[0], 'Reservation ID');
  assert.equal(Config.RESERVATION_HEADERS[19], 'Last Error');
  assert.equal(Config.EMAIL_LOG_HEADERS.length, 10);
  assert.equal(Config.ACTIVITY_LOG_HEADERS.length, 9);
  assert.equal(Config.DEFAULT_SETTINGS_ROWS.length, 11);

  assert.equal(Config.isUnconfiguredValue('[CONFIGURE: Staycation Name]'), true);
  assert.equal(Config.isUnconfiguredValue(''), true);
  assert.equal(Config.isUnconfiguredValue('Casa Verde Staycation'), false);
});

test('Phase 1: Utils handles dates, filename sanitization, formula injection, HTML escape, and regex escape', () => {
  const env = createGasMockRuntime();
  env.loadGasFiles(['Config.gs', 'Utils.gs']);

  const { Utils } = env.ctx;

  // Calendar dates
  assert.equal(Utils.parseCalendarDate('2026-11-19'), '2026-11-19');
  assert.equal(Utils.parseCalendarDate('11/19/2026'), '2026-11-19');
  assert.equal(Utils.parseCalendarDate('2026-02-30'), null);
  assert.equal(Utils.parseCalendarDate('not-a-date'), null);
  assert.equal(Utils.formatDisplayDate('2026-11-19'), 'November 19, 2026');

  // Filename segment sanitization (matches spec example)
  assert.equal(Utils.sanitizeFilenameSegment('Juan Dela Cruz'), 'JUAN-DELA-CRUZ');
  assert.equal(Utils.sanitizeFilenameSegment('María Peña / O\'Connor!!'), 'MARIA-PENA-O-CONNOR');

  // Formula injection protection
  assert.equal(Utils.sanitizeSheetCell('=IMPORTXML("http://evil")'), "'=IMPORTXML(\"http://evil\")");
  assert.equal(Utils.sanitizeSheetCell('+639171234567'), "'+639171234567");
  assert.equal(Utils.sanitizeSheetCell('Juan Dela Cruz'), 'Juan Dela Cruz');

  // HTML escaping
  assert.equal(Utils.escapeHtml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');

  // Java regex replacement escaping for Google Docs replaceText
  assert.equal(Utils.escapeRegexReplacement('Price $100 \\ tax'), 'Price \\$100 \\\\ tax');

  // Endorsed hash determinism & sensitivity
  const base = {
    guestName: 'Juan Dela Cruz',
    emailAddress: 'Juan@Example.com',
    contactNumber: '+63 917 123 4567',
    checkInDate: '2026-12-01',
    checkOutDate: '2026-12-03',
    numberOfGuests: 4,
    numberOfRooms: '2'
  };
  const h1 = Utils.computeEndorsedHash(base);
  const h2 = Utils.computeEndorsedHash(Object.assign({}, base, { emailAddress: ' juan@example.com ' }));
  const h3 = Utils.computeEndorsedHash(Object.assign({}, base, { numberOfGuests: 5 }));
  assert.equal(h1.length, 64);
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
});

test('Phase 1: Utils.withScriptLock enforces exclusivity and releases lock on error', () => {
  const env = createGasMockRuntime();
  env.loadGasFiles(['Config.gs', 'Utils.gs']);

  const { Utils, Config } = env.ctx;

  assert.throws(
    () => Utils.withScriptLock(() => { throw new Error('boom'); }),
    /boom/
  );
  // Lock must be released in finally
  assert.equal(env.state.lockHeld, false);

  env.state.lockForceFail = true;
  assert.throws(
    () => Utils.withScriptLock(() => 'ok'),
    (err) => err.code === Config.ERROR_CODES.LOCK_TIMEOUT
  );
});
