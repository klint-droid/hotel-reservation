'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGasMockRuntime } = require('../helpers/gasMockRuntime');

function setupPhase3Env() {
  const env = createGasMockRuntime({
    activeUserEmail: 'admin@staycation.test',
    effectiveUserEmail: 'admin@staycation.test'
  });
  env.loadGasFiles([
    'Config.gs',
    'Utils.gs',
    'Setup.gs',
    'SecurityService.gs',
    'ActivityLogService.gs',
    'ValidationService.gs',
    'ReferenceGenerator.gs',
    'ReservationService.gs',
    'FormHandler.gs'
  ]);
  env.ctx.SetupService.initializeSpreadsheet();
  return env;
}

function validEvent(overrides = {}) {
  return {
    namedValues: Object.assign({
      'Timestamp': ['2026-11-19 10:00:00'],
      'Full Name': ['Maria Santos'],
      'Email Address': ['Maria.Santos@Example.com'],
      'Contact Number': ['0917 555 1234'],
      'Check-in Date': ['2026-12-10'],
      'Check-out Date': ['2026-12-12'],
      'Number of Guests': ['4'],
      'Number of Rooms': ['2'],
      'Special Requests': ['Early check-in if available'],
      'Agreement to House Rules': ['I have read and agree to the Staycation House Rules.']
    }, overrides)
  };
}

test('Phase 3: Valid guest registration creates PENDING / NOT_SENT record with STAY-YYYYMMDD-XXXX and sends ZERO emails', () => {
  const env = setupPhase3Env();
  const res = env.ctx.FormHandler.handleFormSubmit(validEvent(), null, {
    todayDateString: '2026-11-19',
    now: new Date('2026-11-19T02:00:00Z')
  });

  assert.equal(res.ok, true);
  assert.equal(res.data.referenceNumber, 'STAY-20261119-0001');
  assert.equal(res.data.approvalStatus, 'PENDING');
  assert.equal(res.data.emailStatus, 'NOT_SENT');
  assert.equal(res.data.emailAddress, 'maria.santos@example.com');
  assert.equal(res.data.contactNumber, '0917 555 1234');
  assert.equal(res.data.numberOfGuests, 4);
  assert.match(res.data.reservationId, /^RES-/);

  // CRITICAL: No email sent on submission!
  assert.equal(env.sentEmails.length, 0);

  // Activity Log recorded
  const logs = env.ctx.ActivityLogService.getRecentActivities(10);
  assert.equal(logs[0].action, 'RESERVATION_CREATED');
  assert.equal(logs[0].referenceNumber, 'STAY-20261119-0001');
});

test('Phase 3: Server-side validation rejects missing fields, bad email, bad phone, past check-in, check-out <= check-in, zero guests, unchecked agreement', () => {
  const env = setupPhase3Env();
  const opts = { todayDateString: '2026-11-19', now: new Date('2026-11-19T02:00:00Z') };

  const invalidCases = [
    { name: 'missing full name', overrides: { 'Full Name': [''] }, expectMatch: /Full Name/i },
    { name: 'invalid email', overrides: { 'Email Address': ['not-an-email'] }, expectMatch: /Email Address/i },
    { name: 'invalid phone', overrides: { 'Contact Number': ['abc-12'] }, expectMatch: /Contact Number/i },
    { name: 'past check-in date', overrides: { 'Check-in Date': ['2026-11-18'] }, expectMatch: /cannot be in the past/i },
    { name: 'check-out before check-in', overrides: { 'Check-in Date': ['2026-12-10'], 'Check-out Date': ['2026-12-09'] }, expectMatch: /must be later/i },
    { name: 'check-out equal to check-in', overrides: { 'Check-in Date': ['2026-12-10'], 'Check-out Date': ['2026-12-10'] }, expectMatch: /must be later/i },
    { name: 'zero guests', overrides: { 'Number of Guests': ['0'] }, expectMatch: /greater than zero/i },
    { name: 'unchecked agreement', overrides: { 'Agreement to House Rules': [''] }, expectMatch: /House Rules/i }
  ];

  for (const tc of invalidCases) {
    const res = env.ctx.FormHandler.handleFormSubmit(validEvent(tc.overrides), null, opts);
    assert.equal(res.ok, false, `Expected failure for ${tc.name}`);
    assert.equal(res.code, 'ERR_VALIDATION_FAILED', `Expected ERR_VALIDATION_FAILED for ${tc.name}`);
    assert.match(res.errors.join(' '), tc.expectMatch, `Expected error message match for ${tc.name}`);
  }

  // Reservations sheet remains empty; zero emails sent
  assert.equal(env.ctx.ReservationService.getAllReservations().length, 0);
  assert.equal(env.sentEmails.length, 0);
});

test('Phase 3: Duplicate exact submission is blocked while overlapping different booking is flagged as PENDING', () => {
  const env = setupPhase3Env();
  const opts = { todayDateString: '2026-11-19', now: new Date('2026-11-19T02:00:00Z') };

  const first = env.ctx.FormHandler.handleFormSubmit(validEvent(), null, opts);
  assert.equal(first.ok, true);

  // Exact duplicate (new timestamp, same guest/email/dates/guests/rooms)
  const dup = env.ctx.FormHandler.handleFormSubmit(validEvent({ 'Timestamp': ['2026-11-19 10:05:00'] }), null, opts);
  assert.equal(dup.ok, false);
  assert.equal(dup.code, 'ERR_DUPLICATE_SUBMISSION');
  assert.equal(env.ctx.ReservationService.getAllReservations().length, 1);

  // Overlapping dates, same email, different guest count / rooms -> accepted & flagged for admin review
  const overlap = env.ctx.FormHandler.handleFormSubmit(validEvent({
    'Timestamp': ['2026-11-19 10:10:00'],
    'Number of Guests': ['2'],
    'Number of Rooms': ['1']
  }), null, opts);
  assert.equal(overlap.ok, true);
  assert.equal(overlap.data.referenceNumber, 'STAY-20261119-0002');
  assert.match(overlap.data.adminRemarks, /Potential duplicate of STAY-20261119-0001/);
});

test('Phase 3: Simultaneous submissions generate sequential unique reference numbers and self-heal if ScriptProperties are cleared', () => {
  const env = setupPhase3Env();
  const opts = { todayDateString: '2026-11-19', now: new Date('2026-11-19T02:00:00Z') };

  const refs = new Set();
  for (let i = 1; i <= 5; i++) {
    const res = env.ctx.FormHandler.handleFormSubmit(validEvent({
      'Timestamp': [`2026-11-19 11:00:0${i}`],
      'Full Name': [`Guest ${i}`],
      'Email Address': [`guest${i}@example.com`]
    }), null, opts);
    assert.equal(res.ok, true);
    refs.add(res.data.referenceNumber);
  }
  assert.equal(refs.size, 5);
  assert.ok(refs.has('STAY-20261119-0005'));

  // Simulate cleared ScriptProperties: next submission MUST self-heal from sheet max -> 0006
  env.scriptPropertiesStore.delete('REF_SEQ_20261119');
  const afterClear = env.ctx.FormHandler.handleFormSubmit(validEvent({
    'Timestamp': ['2026-11-19 12:00:00'],
    'Full Name': ['Guest 6'],
    'Email Address': ['guest6@example.com']
  }), null, opts);
  assert.equal(afterClear.ok, true);
  assert.equal(afterClear.data.referenceNumber, 'STAY-20261119-0006');
});

test('Phase 3: SecurityService enforces fail-closed admin authorization and logs unauthorized attempts', () => {
  const env = setupPhase3Env();

  // Authorized admin passes
  assert.equal(env.ctx.SecurityService.assertAuthorizedAdmin('TEST_ACTION'), 'admin@staycation.test');

  // Unauthorized user blocked
  env.state.activeUserEmail = 'intruder@external.test';
  assert.throws(
    () => env.ctx.SecurityService.assertAuthorizedAdmin('APPROVE_RESERVATION'),
    (err) => err.code === 'ERR_UNAUTHORIZED'
  );

  // Blank active user (consumer Gmail limitation) fails closed by default
  env.state.activeUserEmail = '';
  assert.throws(
    () => env.ctx.SecurityService.assertAuthorizedAdmin('APPROVE_RESERVATION'),
    (err) => err.code === 'ERR_UNAUTHORIZED'
  );

  // Explicit single-owner fallback permits effective owner ONLY when opted in
  env.scriptPropertiesStore.set('ALLOW_OWNER_EFFECTIVE_FALLBACK', 'true');
  assert.equal(env.ctx.SecurityService.assertAuthorizedAdmin('APPROVE_RESERVATION'), 'admin@staycation.test');

  const logs = env.ctx.ActivityLogService.getRecentActivities(10);
  assert.ok(logs.some((l) => l.action === 'UNAUTHORIZED_ACCESS'));
});
