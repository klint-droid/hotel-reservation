'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGasMockRuntime } = require('../helpers/gasMockRuntime');

function setupPortalEnv() {
  const env = createGasMockRuntime({
    activeUserEmail: 'owner@staycation.test',
    effectiveUserEmail: 'owner@staycation.test',
    remainingDailyQuota: 100
  });
  env.loadGasFiles();
  env.ctx.runFullSetup();
  env.ctx.Config.saveSettings({
    STAYCATION_NAME: 'Casa Verde Staycation',
    STAYCATION_CONTACT_NUMBER: '+63 917 555 0199',
    STAYCATION_EMAIL_ADDRESS: 'owner@staycation.test',
    STAYCATION_FACEBOOK_PAGE: 'https://facebook.com/casaverde',
    CHECK_IN_TIME: '2:00 PM',
    CHECK_OUT_TIME: '12:00 PM'
  });
  return env;
}

function submitBooking(env, overrides = {}) {
  return env.ctx.FormHandler.handleFormSubmit({
    payload: Object.assign({
      guestName: 'Juan Dela Cruz',
      emailAddress: 'juan@guest.test',
      contactNumber: '0917 123 4567',
      checkInDate: '2026-12-20',
      checkOutDate: '2026-12-22',
      numberOfGuests: 4,
      numberOfRooms: '2',
      specialRequests: 'Early check-in',
      agreedToHouseRules: true
    }, overrides)
  }, null, { todayDateString: '2026-11-19', now: new Date('2026-11-19T02:00:00Z') }).data;
}

test('Admin Portal: doGet renders portal for authorized admin and blocks unauthorized users', () => {
  const env = setupPortalEnv();
  submitBooking(env);

  const output = env.ctx.doGet();
  const html = output.getContent();
  assert.match(html, /Staycation Admin Portal/);
  assert.match(html, /Casa Verde Staycation/);
  assert.match(html, /STAY-20261119-0001/);

  // Unauthorized account sees Access Restricted page and zero guest data
  env.state.activeUserEmail = 'intruder@external.test';
  const deniedHtml = env.ctx.doGet().getContent();
  assert.match(deniedHtml, /Access Restricted/);
  assert.doesNotMatch(deniedHtml, /Juan Dela Cruz/);
  assert.doesNotMatch(deniedHtml, /STAY-20261119-0001/);
});

test('Admin Portal: 1-Click apiApproveAndEndorse runs Approve -> Generate PDF -> Send Email automatically', () => {
  const env = setupPortalEnv();
  const booking = submitBooking(env);
  assert.equal(env.sentEmails.length, 0, 'Guest submission must never auto-email');

  const res = env.ctx.apiApproveAndEndorse(booking.reservationId, 'Verified via Admin Portal');
  assert.equal(res.ok, true, res.message);
  assert.equal(res.data.steps.approved, true);
  assert.equal(res.data.steps.pdfGenerated, true);
  assert.equal(res.data.steps.emailSent, true);
  assert.equal(env.sentEmails.length, 1);
  assert.equal(env.sentEmails[0].recipient, 'juan@guest.test');
  assert.equal(env.sentEmails[0].options.attachments[0].getName(), 'ENDORSEMENT_STAY-20261119-0001_JUAN-DELA-CRUZ.pdf');

  const updated = env.ctx.ReservationService.getReservationById(booking.reservationId).reservation;
  assert.equal(updated.approvalStatus, 'APPROVED');
  assert.equal(updated.emailStatus, 'SENT');
  assert.ok(updated.pdfFileId);
  assert.ok(updated.emailSentAt);

  // Clicking again is strictly blocked
  const repeat = env.ctx.apiApproveAndEndorse(booking.reservationId, '');
  assert.equal(repeat.ok, false);
  assert.equal(env.sentEmails.length, 1);
});

test('Admin Portal: Partial failure during 1-Click Approve preserves APPROVED + PDF and recovers via apiCompleteApprovedEndorsement', () => {
  const env = setupPortalEnv();
  const booking = submitBooking(env, { emailAddress: 'recover@guest.test', guestName: 'Recovery Guest' });

  // Simulate transient Gmail outage on Step 3
  env.state.gmailFailNext = new Error('Transient Gmail 503');
  const firstAttempt = env.ctx.apiApproveAndEndorse(booking.reservationId, 'Verified');
  assert.equal(firstAttempt.ok, false);
  assert.equal(firstAttempt.data.steps.approved, true);
  assert.equal(firstAttempt.data.steps.pdfGenerated, true);
  assert.equal(firstAttempt.data.steps.emailSent, false);

  const midState = env.ctx.ReservationService.getReservationById(booking.reservationId).reservation;
  assert.equal(midState.approvalStatus, 'APPROVED');
  assert.equal(midState.emailStatus, 'FAILED');
  assert.ok(midState.pdfFileId);

  // 1-Click recovery sends email using the already-generated PDF
  const recovery = env.ctx.apiCompleteApprovedEndorsement(booking.reservationId, true);
  assert.equal(recovery.ok, true, recovery.message);
  assert.equal(env.sentEmails.length, 1);
  assert.equal(env.ctx.ReservationService.getReservationById(booking.reservationId).reservation.emailStatus, 'SENT');
});
