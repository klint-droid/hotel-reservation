'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createGasMockRuntime, GAS_ROOT } = require('../helpers/gasMockRuntime');

function setupSecureWorkspace(opts = {}) {
  const env = createGasMockRuntime(Object.assign({
    activeUserEmail: 'owner@staycation.test',
    effectiveUserEmail: 'owner@staycation.test',
    remainingDailyQuota: 100
  }, opts));
  env.loadGasFiles();
  env.ctx.runFullSetup();
  env.ctx.Config.saveSettings({
    STAYCATION_NAME: 'Villa Verde Sanctuary',
    STAYCATION_CONTACT_NUMBER: '+63 917 888 9900',
    STAYCATION_EMAIL_ADDRESS: 'bookings@villaverde.test',
    STAYCATION_FACEBOOK_PAGE: '@villaverde',
    CHECK_IN_TIME: '2:00 PM',
    CHECK_OUT_TIME: '12:00 PM'
  });
  return env;
}

function addBooking(env, overrides = {}) {
  return env.ctx.FormHandler.handleFormSubmit({
    payload: Object.assign({
      guestName: 'Maria Clara',
      emailAddress: 'maria@guest.test',
      contactNumber: '+63 917 111 2222',
      checkInDate: '2026-12-20',
      checkOutDate: '2026-12-22',
      numberOfGuests: 2,
      numberOfRooms: '1',
      specialRequests: '',
      agreedToHouseRules: true
    }, overrides)
  }, null, { todayDateString: '2026-11-19', now: new Date('2026-11-19T02:00:00Z') }).data;
}

test('AUDIT [HIGH-1]: appsscript.json declares all required runtime OAuth scopes', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(GAS_ROOT, 'appsscript.json'), 'utf8'));
  const scopes = manifest.oauthScopes || [];
  assert.ok(scopes.includes('https://mail.google.com/'), 'Must include GmailApp scope');
  assert.ok(scopes.includes('https://www.googleapis.com/auth/script.send_mail'), 'Must include MailApp quota scope');
  assert.ok(scopes.includes('https://www.googleapis.com/auth/script.external_request'), 'Must include UrlFetchApp scope');
  assert.ok(scopes.includes('https://www.googleapis.com/auth/spreadsheets'));
  assert.ok(scopes.includes('https://www.googleapis.com/auth/forms'));
  assert.ok(scopes.includes('https://www.googleapis.com/auth/documents'));
  assert.ok(scopes.includes('https://www.googleapis.com/auth/drive'));
  assert.ok(scopes.includes('https://www.googleapis.com/auth/userinfo.email'));
});

test('AUDIT [HIGH-3 & MEDIUM-9]: Unprotected Settings edits cannot escalate privileges, admin removal revokes access, and self-lockout is blocked', () => {
  const env = setupSecureWorkspace();

  // Verify Settings sheet is hard-protected (warningOnly = false)
  const settingsSheet = env.spreadsheet.getSheetByName('Settings');
  const protections = settingsSheet.getProtections();
  assert.ok(protections.length >= 1);
  assert.equal(protections[0].isWarningOnly(), false);

  // Attacker manually writes their email directly into Settings sheet cell (row 11 col B)
  settingsSheet.getRange(11, 2).setValue('owner@staycation.test, attacker@evil.test');
  env.state.activeUserEmail = 'attacker@evil.test';
  assert.throws(
    () => env.ctx.SecurityService.assertAuthorizedAdmin('APPROVE_RESERVATION'),
    (err) => err.code === 'ERR_UNAUTHORIZED',
    'Direct Settings sheet edit MUST NOT grant admin access'
  );

  // Owner adds co-admin via authorized apiSaveSettings, then removes co-admin -> access revoked cleanly
  env.state.activeUserEmail = 'owner@staycation.test';
  const addCo = env.ctx.apiSaveSettings({
    ADMINISTRATOR_EMAIL: 'owner@staycation.test, staff@staycation.test'
  });
  assert.equal(addCo.ok, true);

  env.state.activeUserEmail = 'staff@staycation.test';
  assert.equal(env.ctx.SecurityService.assertAuthorizedAdmin('VIEW_DASHBOARD'), 'staff@staycation.test');

  env.state.activeUserEmail = 'owner@staycation.test';
  const revokeCo = env.ctx.apiSaveSettings({
    ADMINISTRATOR_EMAIL: 'owner@staycation.test'
  });
  assert.equal(revokeCo.ok, true);

  env.state.activeUserEmail = 'staff@staycation.test';
  assert.throws(
    () => env.ctx.SecurityService.assertAuthorizedAdmin('VIEW_DASHBOARD'),
    (err) => err.code === 'ERR_UNAUTHORIZED',
    'Removed admin must lose access immediately'
  );

  // Owner cannot accidentally remove themselves (self-lockout protection)
  env.state.activeUserEmail = 'owner@staycation.test';
  const selfRemove = env.ctx.apiSaveSettings({
    ADMINISTRATOR_EMAIL: 'other@staycation.test'
  });
  assert.equal(selfRemove.ok, false);
  assert.match(selfRemove.errors.join(' '), /self-lockout/i);
});

test('AUDIT [HIGH-4]: EmailPreview ignores spoofed javascript: URL in Reservations column R and uses DriveApp canonical URL', () => {
  const env = setupSecureWorkspace();
  const booking = addBooking(env);
  env.ctx.ApprovalService.approveReservation(booking.reservationId, '');
  env.ctx.PdfService.generateEndorsementPdf(booking.reservationId);

  // Tamper column R (PDF File URL = col 18) with a javascript: XSS URI
  const sheet = env.spreadsheet.getSheetByName('Reservations');
  sheet.getRange(2, 18).setValue('javascript:google.script.run.apiSaveSettings({})');

  const preview = env.ctx.EmailService.getEmailPreview(booking.reservationId);
  assert.equal(preview.ok, true);
  assert.match(preview.data.pdfFileUrl, /^https:\/\/drive\.google\.com\//, 'Must use DriveApp canonical URL');
});

test('AUDIT [HIGH-5]: Swapping another guest PDF File ID or reverting Email Status from SENT to NOT_SENT are both blocked', () => {
  const env = setupSecureWorkspace();
  const guestA = addBooking(env, { guestName: 'Guest A', emailAddress: 'a@guest.test' });
  const guestB = addBooking(env, { guestName: 'Guest B', emailAddress: 'b@guest.test', checkInDate: '2026-12-25', checkOutDate: '2026-12-27' });

  env.ctx.ApprovalService.approveReservation(guestA.reservationId, '');
  env.ctx.ApprovalService.approveReservation(guestB.reservationId, '');
  const pdfA = env.ctx.PdfService.generateEndorsementPdf(guestA.reservationId);
  env.ctx.PdfService.generateEndorsementPdf(guestB.reservationId);

  // Swap Guest A's PDF File ID into Guest B's row (col 17 = Q)
  const sheet = env.spreadsheet.getSheetByName('Reservations');
  sheet.getRange(3, 17).setValue(pdfA.data.pdfFileId);

  const sendSwapped = env.ctx.EmailService.sendEndorsementEmail(guestB.reservationId);
  assert.equal(sendSwapped.ok, false);
  assert.equal(sendSwapped.code, 'ERR_INTEGRITY_MISMATCH', 'Swapped PDF File ID must be blocked');
  assert.equal(env.sentEmails.length, 0);

  // Send Guest A cleanly, then tamper Guest A column M (Email Status = col 13) back to NOT_SENT
  assert.equal(env.ctx.EmailService.sendEndorsementEmail(guestA.reservationId).ok, true);
  sheet.getRange(2, 13).setValue('NOT_SENT');

  const resendTampered = env.ctx.EmailService.sendEndorsementEmail(guestA.reservationId);
  assert.equal(resendTampered.ok, false);
  assert.equal(resendTampered.code, 'ERR_DUPLICATE_EMAIL', 'Sent-Lock + Email Logs must defeat manual column M reset');
  assert.equal(env.sentEmails.length, 1);
});

test('AUDIT [HIGH-6]: Post-send logging failure NEVER rolls back Email Status from SENT to FAILED', () => {
  const env = setupSecureWorkspace();
  const booking = addBooking(env);
  env.ctx.ApprovalService.approveReservation(booking.reservationId, '');
  env.ctx.PdfService.generateEndorsementPdf(booking.reservationId);

  // Delete Email Logs sheet right before sending so EmailLogService throws AFTER Gmail succeeds
  const emailLogsSheet = env.spreadsheet.getSheetByName('Email Logs');
  env.spreadsheet.deleteSheet(emailLogsSheet);

  const sendRes = env.ctx.EmailService.sendEndorsementEmail(booking.reservationId);
  assert.equal(sendRes.ok, true, 'Must still return ok once Gmail dispatched the email');
  assert.equal(env.sentEmails.length, 1);

  const after = env.ctx.ReservationService.getReservationById(booking.reservationId).reservation;
  assert.equal(after.emailStatus, 'SENT', 'Email Status MUST remain SENT even if logging threw');
  assert.equal(env.ctx.SecurityService.isSentLocked(booking.reservationId), true);
});

test('AUDIT [MEDIUM-1 & MEDIUM-3]: Settings round-trip preserves +/@ without stray quotes, guest {{...}} injection is harmless, and Header logo works', () => {
  const env = setupSecureWorkspace();

  // Verify +63 and @handle read cleanly without leading apostrophe
  const settings = env.ctx.Config.getSettings();
  assert.equal(settings.staycationContactNumber, '+63 917 888 9900');
  assert.equal(settings.staycationFacebookPage, '@villaverde');
  // Legitimate leading apostrophe on non-formula text stays intact
  assert.equal(env.ctx.Utils.stripLeadingQuote("'O'Connor"), "'O'Connor");

  // Put logo token in Header as well
  const tplDoc = env.docsRegistry.get(settings.docsTemplateId);
  tplDoc.addHeader().appendParagraph('Header {{STAYCATION_LOGO}} Endorsement');

  // Guest submits name containing {{CHECK_IN_DATE}}, {{UNKNOWN_TAG}}, $, and \
  const tricky = addBooking(env, {
    guestName: 'Ana {{CHECK_IN_DATE}} {{UNKNOWN_TAG}} $100 \\ VIP',
    emailAddress: 'tricky@guest.test'
  });
  env.ctx.ApprovalService.approveReservation(tricky.reservationId, '');
  const pdf = env.ctx.PdfService.generateEndorsementPdf(tricky.reservationId);
  assert.equal(pdf.ok, true, pdf.message);

  const pdfText = env.driveFiles.get(pdf.data.pdfFileId).getBlob().getDataAsString();
  assert.ok(
    pdfText.includes('Ana {{CHECK_IN_DATE}} {{UNKNOWN_TAG}} $100 \\ VIP'),
    'Guest text must appear verbatim without regex backslashes or placeholder expansion'
  );
  assert.ok(pdfText.includes('Header  Endorsement'), 'Header sibling text around logo placeholder must be preserved');
});

test('AUDIT [MEDIUM-6 & MEDIUM-8 & LOW-1]: Non-private output folder blocked, e.range native Date parsed cleanly, and error secrets redacted', () => {
  const env = setupSecureWorkspace();

  // 1. Native Date values via e.range (immune to DD/MM/YYYY vs MM/DD/YYYY locale drift)
  const rawSheet = env.spreadsheet.getSheetByName('Form Responses 1');
  rawSheet.appendRow([
    new Date('2026-11-19T04:00:00Z'),
    'Locale Safe Guest',
    'locale@guest.test',
    '0917 444 5555',
    new Date('2026-12-05T00:00:00+08:00'),
    new Date('2026-12-08T00:00:00+08:00'),
    3,
    '1',
    'None',
    'I have read and agree to the Staycation House Rules.'
  ]);
  const lastRow = rawSheet.getLastRow();
  const rangeEvent = { range: rawSheet.getRange(lastRow, 1, 1, 10) };
  const fromRange = env.ctx.onFormSubmitTrigger(rangeEvent);
  assert.equal(fromRange.ok, true);
  assert.equal(fromRange.data.checkInDate, '2026-12-05');
  assert.equal(fromRange.data.checkOutDate, '2026-12-08');

  // 2. Synthetic e.payload blocked on production trigger entrypoint
  const synthAttempt = env.ctx.onFormSubmitTrigger({ payload: { guestName: 'Fake' } });
  assert.equal(synthAttempt.ok, false);

  // 3. Non-private Drive folder blocked during PDF generation
  env.ctx.ApprovalService.approveReservation(fromRange.data.reservationId, '');
  const folder = env.driveFolders.get(env.ctx.Config.getSettings().driveOutputFolderId);
  folder.setSharing('ANYONE_WITH_LINK', 'VIEW');
  const nonPrivPdf = env.ctx.PdfService.generateEndorsementPdf(fromRange.data.reservationId);
  assert.equal(nonPrivPdf.ok, false);
  assert.match(nonPrivPdf.message, /not set to PRIVATE/i);

  // Restore private folder, generate PDF, then verify secret redaction on Gmail failure
  folder.setSharing('PRIVATE', 'NONE');
  assert.equal(env.ctx.PdfService.generateEndorsementPdf(fromRange.data.reservationId).ok, true);
  env.state.gmailFailNext = new Error('Auth error Bearer secret_abc123 https://api.example.com/hook?api_key=XYZ999');
  const failed = env.ctx.EmailService.sendEndorsementEmail(fromRange.data.reservationId);
  assert.equal(failed.ok, false);
  const after = env.ctx.ReservationService.getReservationById(fromRange.data.reservationId).reservation;
  assert.doesNotMatch(after.lastError, /secret_abc123/);
  assert.doesNotMatch(after.lastError, /XYZ999/);
  assert.match(after.lastError, /\[REDACTED\]/);
});
