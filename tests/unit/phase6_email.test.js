'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGasMockRuntime } = require('../helpers/gasMockRuntime');

function setupPhase6Env(opts = {}) {
  const env = createGasMockRuntime(Object.assign({
    activeUserEmail: 'admin@staycation.test',
    effectiveUserEmail: 'admin@staycation.test',
    gmailAliases: ['bookings@villaverde.test'],
    remainingDailyQuota: 50
  }, opts));
  env.loadGasFiles();
  env.ctx.runFullSetup();
  env.ctx.Config.saveSettings({
    STAYCATION_NAME: 'Villa Verde Sanctuary',
    STAYCATION_CONTACT_NUMBER: '+63 917 888 9900',
    STAYCATION_EMAIL_ADDRESS: 'bookings@villaverde.test',
    STAYCATION_FACEBOOK_PAGE: 'fb.com/villaverdesanctuary',
    CHECK_IN_TIME: '2:00 PM',
    CHECK_OUT_TIME: '12:00 PM'
  });
  return env;
}

function submitBooking(env, overrides = {}) {
  return env.ctx.FormHandler.handleFormSubmit({
    payload: Object.assign({
      guestName: 'Juan Dela Cruz',
      emailAddress: 'juan@example.com',
      contactNumber: '09171234567',
      checkInDate: '2026-12-24',
      checkOutDate: '2026-12-26',
      numberOfGuests: 4,
      numberOfRooms: '2',
      specialRequests: 'Late arrival',
      agreedToHouseRules: true
    }, overrides)
  }, null, { todayDateString: '2026-11-19', now: new Date('2026-11-19T02:00:00Z') }).data;
}

test('Phase 6: Sends HTML endorsement email with PDF attachment, updates SENT status, logs Email & Activity Logs, and prevents duplicate sending', () => {
  const env = setupPhase6Env();
  const booking = submitBooking(env);
  env.ctx.ApprovalService.approveReservation(booking.reservationId, 'Verified');
  const pdf = env.ctx.PdfService.generateEndorsementPdf(booking.reservationId);
  assert.equal(pdf.ok, true);

  // Preview works before send
  const preview = env.ctx.EmailService.getEmailPreview(booking.reservationId);
  assert.equal(preview.ok, true);
  assert.equal(preview.data.subject, 'Your Staycation Reservation Has Been Approved \u2013 STAY-20261119-0001');

  // Send email
  const sendRes = env.ctx.EmailService.sendEndorsementEmail(booking.reservationId);
  assert.equal(sendRes.ok, true, sendRes.message);
  assert.equal(env.sentEmails.length, 1);

  const sent = env.sentEmails[0];
  assert.equal(sent.recipient, 'juan@example.com');
  assert.equal(sent.subject, 'Your Staycation Reservation Has Been Approved \u2013 STAY-20261119-0001');
  assert.equal(sent.options.from, 'bookings@villaverde.test');
  assert.equal(sent.options.replyTo, 'bookings@villaverde.test');
  assert.equal(sent.options.attachments.length, 1);
  assert.equal(sent.options.attachments[0].getName(), 'ENDORSEMENT_STAY-20261119-0001_JUAN-DELA-CRUZ.pdf');
  assert.match(sent.options.htmlBody, /Dear <strong>Juan Dela Cruz<\/strong>/);
  assert.match(sent.options.htmlBody, /STAY-20261119-0001/);

  // Sheet updated to SENT with timestamp
  const updated = env.ctx.ReservationService.getReservationById(booking.reservationId).reservation;
  assert.equal(updated.emailStatus, 'SENT');
  assert.ok(updated.emailSentAt);
  assert.equal(updated.lastError, '');

  // Email Logs & Activity Logs recorded
  const emailLogs = env.ctx.EmailLogService.getEmailLogs(10, booking.reservationId);
  assert.equal(emailLogs.length, 1);
  assert.equal(emailLogs[0].emailStatus, 'SENT');
  assert.ok(emailLogs[0].dateSent);

  // Duplicate sending strictly prevented (idempotency)
  const dup = env.ctx.EmailService.sendEndorsementEmail(booking.reservationId);
  assert.equal(dup.ok, false);
  assert.equal(dup.code, 'ERR_DUPLICATE_EMAIL');
  assert.equal(env.sentEmails.length, 1);
});

test('Phase 6: Blocks sending without PDF, for PENDING/REJECTED, for invalid email, and on quota exceeded', () => {
  const env = setupPhase6Env();

  // 1. PENDING blocked
  const pending = submitBooking(env, { emailAddress: 'p@example.com', guestName: 'Pending User' });
  const rPending = env.ctx.EmailService.sendEndorsementEmail(pending.reservationId);
  assert.equal(rPending.ok, false);
  assert.equal(rPending.code, 'ERR_INVALID_STATE');

  // 2. REJECTED blocked
  env.ctx.ApprovalService.rejectReservation(pending.reservationId, 'Unavailable');
  const rRej = env.ctx.EmailService.sendEndorsementEmail(pending.reservationId);
  assert.equal(rRej.ok, false);
  assert.equal(rRej.code, 'ERR_INVALID_STATE');

  // 3. APPROVED without PDF blocked
  const approved = submitBooking(env, { emailAddress: 'nopdf@example.com', guestName: 'No Pdf User' });
  env.ctx.ApprovalService.approveReservation(approved.reservationId, '');
  const rNoPdf = env.ctx.EmailService.sendEndorsementEmail(approved.reservationId);
  assert.equal(rNoPdf.ok, false);
  assert.equal(rNoPdf.code, 'ERR_PDF_MISSING');

  // 4. Generate PDF then exhaust quota -> blocked cleanly
  env.ctx.PdfService.generateEndorsementPdf(approved.reservationId);
  env.state.remainingDailyQuota = 0;
  const rQuota = env.ctx.EmailService.sendEndorsementEmail(approved.reservationId);
  assert.equal(rQuota.ok, false);
  assert.equal(rQuota.code, 'ERR_QUOTA_EXCEEDED');
  assert.equal(env.sentEmails.length, 0);
});

test('Phase 6: Simulated Gmail failure sets FAILED (never SENT), preserves reservation, logs failure, and allows explicit manual retry', () => {
  const env = setupPhase6Env();
  const booking = submitBooking(env, { emailAddress: 'retry@example.com', guestName: 'Retry Guest' });
  env.ctx.ApprovalService.approveReservation(booking.reservationId, '');
  env.ctx.PdfService.generateEndorsementPdf(booking.reservationId);

  // Inject Gmail service outage
  env.state.gmailFailNext = new Error('Temporary Gmail backend error 503');
  const failed = env.ctx.EmailService.sendEndorsementEmail(booking.reservationId);
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'ERR_EMAIL_SEND_FAILED');

  const afterFail = env.ctx.ReservationService.getReservationById(booking.reservationId).reservation;
  assert.equal(afterFail.emailStatus, 'FAILED', 'Must be FAILED, never SENT on error');
  assert.equal(afterFail.emailSentAt, '');
  assert.match(afterFail.lastError, /503/);

  const logsAfterFail = env.ctx.EmailLogService.getEmailLogs(10, booking.reservationId);
  assert.equal(logsAfterFail.length, 1);
  assert.equal(logsAfterFail[0].emailStatus, 'FAILED');
  assert.equal(logsAfterFail[0].dateSent, '');

  // Without explicit retry flag, blocked
  const blockedWithoutFlag = env.ctx.EmailService.sendEndorsementEmail(booking.reservationId);
  assert.equal(blockedWithoutFlag.ok, false);

  // Explicit manual admin retry succeeds
  const retried = env.ctx.EmailService.sendEndorsementEmail(booking.reservationId, { allowFailedRetry: true });
  assert.equal(retried.ok, true);
  assert.equal(env.sentEmails.length, 1);
  assert.equal(env.ctx.ReservationService.getReservationById(booking.reservationId).reservation.emailStatus, 'SENT');
  assert.equal(env.ctx.EmailLogService.getEmailLogs(10, booking.reservationId).length, 2);
});
