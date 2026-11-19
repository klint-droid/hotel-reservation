'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createGasMockRuntime, GAS_ROOT } = require('../helpers/gasMockRuntime');

function bootstrapFullWorkspace(options = {}) {
  const env = createGasMockRuntime(Object.assign({
    activeUserEmail: 'manager@staycation.test',
    effectiveUserEmail: 'manager@staycation.test',
    gmailAliases: [],
    remainingDailyQuota: 100
  }, options));

  if (options.reverseLoadOrder) {
    const files = fs.readdirSync(GAS_ROOT).filter((f) => f.endsWith('.gs')).sort().reverse();
    env.loadGasFiles(files);
  } else {
    env.loadGasFiles();
  }

  const setup = env.ctx.runFullSetup();
  assert.equal(setup.ok, true);

  env.ctx.Config.saveSettings({
    STAYCATION_NAME: 'Casa Solis Retreat',
    STAYCATION_CONTACT_NUMBER: '+63 917 222 3344',
    STAYCATION_EMAIL_ADDRESS: 'concierge@casasolis.test',
    STAYCATION_FACEBOOK_PAGE: 'facebook.com/casasolisretreat',
    CHECK_IN_TIME: '2:00 PM',
    CHECK_OUT_TIME: '12:00 PM'
  });

  return env;
}

test('E2E: Complete happy path from public Form submission -> Admin Review -> Approve -> Generate PDF -> Preview -> Send Email -> Logs & Idempotency', () => {
  const env = bootstrapFullWorkspace();
  const opts = { todayDateString: '2026-11-19', now: new Date('2026-11-19T03:00:00Z') };

  // 1. Guest submits public form (with special characters and leading-zero PH number)
  const submit = env.ctx.FormHandler.handleFormSubmit({
    formResponseId: 'RESP_001',
    namedValues: {
      'Timestamp': ['2026-11-19 11:00:00'],
      'Full Name': ['Elena D. Mendoza'],
      'Email Address': ['Elena.Mendoza@GuestMail.test'],
      'Contact Number': ['0917-888-7766'],
      'Check-in Date': ['2026-12-28'],
      'Check-out Date': ['2026-12-30'],
      'Number of Guests': ['6'],
      'Number of Rooms': ['3'],
      'Special Requests': ['Near pool area; baby crib requested'],
      'Agreement to House Rules': ['I have read and agree to the Staycation House Rules.']
    }
  }, null, opts);

  assert.equal(submit.ok, true);
  assert.equal(submit.data.referenceNumber, 'STAY-20261119-0001');
  assert.equal(submit.data.approvalStatus, 'PENDING');
  assert.equal(submit.data.emailStatus, 'NOT_SENT');
  assert.equal(env.sentEmails.length, 0, 'Must never email on guest form submission');

  // 2. Exact trigger replay ignored idempotently
  const replay = env.ctx.FormHandler.handleFormSubmit({
    formResponseId: 'RESP_001',
    namedValues: {
      'Timestamp': ['2026-11-19 11:00:00'],
      'Full Name': ['Elena D. Mendoza'],
      'Email Address': ['Elena.Mendoza@GuestMail.test'],
      'Contact Number': ['0917-888-7766'],
      'Check-in Date': ['2026-12-28'],
      'Check-out Date': ['2026-12-30'],
      'Number of Guests': ['6'],
      'Number of Rooms': ['3'],
      'Special Requests': ['Near pool area; baby crib requested'],
      'Agreement to House Rules': ['I have read and agree to the Staycation House Rules.']
    }
  }, null, opts);
  assert.equal(replay.ok, false);
  assert.equal(replay.code, 'ERR_DUPLICATE_SUBMISSION');

  // 3. Admin selects row 2 and views details + dashboard
  const resSheet = env.spreadsheet.getSheetByName('Reservations');
  resSheet.setActiveSelection(2, 2);
  env.ctx.menuViewSelectedReservation();
  env.ctx.menuShowDashboard();
  assert.equal(env.uiEvents.dialogs.length, 2);

  // 4. Admin approves via server callback (zero emails sent!)
  const approve = env.ctx.apiApproveReservation(submit.data.reservationId, 'Deposit verified');
  assert.equal(approve.ok, true);
  assert.equal(approve.data.approvalStatus, 'APPROVED');
  assert.equal(env.sentEmails.length, 0, 'Must never email automatically on approval');

  // 5. Admin generates Endorsement PDF
  const pdf = env.ctx.apiGenerateEndorsementPdf(submit.data.reservationId);
  assert.equal(pdf.ok, true);
  assert.equal(pdf.data.fileName, 'ENDORSEMENT_STAY-20261119-0001_ELENA-D-MENDOZA.pdf');
  assert.equal(env.driveFiles.get(pdf.data.pdfFileId).getSharingAccess(), 'PRIVATE');

  // 6. Admin opens Send Endorsement Email preview dialog
  env.ctx.menuSendEndorsementEmail();
  assert.equal(env.uiEvents.dialogs.length, 3);
  assert.equal(env.uiEvents.dialogs[2].title, 'Send Reservation Endorsement?');

  // 7. Admin confirms Send Email
  const send = env.ctx.apiSendEndorsementEmail(submit.data.reservationId, false);
  assert.equal(send.ok, true);
  assert.equal(env.sentEmails.length, 1);
  // Because concierge@casasolis.test is not in gmailAliases, it uses replyTo + display name gracefully
  assert.equal(env.sentEmails[0].options.from, undefined);
  assert.equal(env.sentEmails[0].options.replyTo, 'concierge@casasolis.test');
  assert.equal(env.sentEmails[0].options.name, 'Casa Solis Retreat');
  assert.equal(env.sentEmails[0].options.attachments[0].getName(), 'ENDORSEMENT_STAY-20261119-0001_ELENA-D-MENDOZA.pdf');

  // 8. Verify Dashboard KPIs & Logs
  const dash = env.ctx.apiGetDashboardData();
  assert.equal(dash.ok, true);
  assert.equal(dash.data.counts.total, 1);
  assert.equal(dash.data.counts.approved, 1);
  assert.equal(dash.data.counts.emailSent, 1);
  assert.equal(dash.data.health.healthy, true);

  // 9. Duplicate send strictly blocked
  const dupSend = env.ctx.apiSendEndorsementEmail(submit.data.reservationId, true);
  assert.equal(dupSend.ok, false);
  assert.equal(dupSend.code, 'ERR_DUPLICATE_EMAIL');
  assert.equal(env.sentEmails.length, 1);
});

test('E2E: Post-approval edit invalidation -> re-approval -> new PDF -> successful email delivery', () => {
  const env = bootstrapFullWorkspace();
  const opts = { todayDateString: '2026-11-19', now: new Date('2026-11-19T03:00:00Z') };

  const sub = env.ctx.FormHandler.handleFormSubmit({
    payload: {
      guestName: 'Carlos Rivera',
      emailAddress: 'carlos@guest.test',
      contactNumber: '+63 918 333 4455',
      checkInDate: '2026-12-20',
      checkOutDate: '2026-12-22',
      numberOfGuests: 2,
      numberOfRooms: '1',
      specialRequests: '',
      agreedToHouseRules: true
    }
  }, null, opts).data;

  env.ctx.ApprovalService.approveReservation(sub.reservationId, '');
  const pdf1 = env.ctx.PdfService.generateEndorsementPdf(sub.reservationId);
  assert.equal(pdf1.ok, true);

  // Guest requests change to Check-out Date (col G = 7) after PDF was generated
  const sheet = env.spreadsheet.getSheetByName('Reservations');
  sheet.getRange(2, 7).setValue('2026-12-23');
  env.ctx.onSpreadsheetEditTrigger({ range: sheet.getRange(2, 7) });

  // Email sending MUST now be blocked until re-approved and PDF regenerated
  const sendBlocked = env.ctx.EmailService.sendEndorsementEmail(sub.reservationId);
  assert.equal(sendBlocked.ok, false);

  // Re-approve, regenerate PDF, then send email -> succeeds with updated date
  assert.equal(env.ctx.ApprovalService.approveReservation(sub.reservationId, 'Re-approved after date extension').ok, true);
  const pdf2 = env.ctx.PdfService.generateEndorsementPdf(sub.reservationId);
  assert.equal(pdf2.ok, true);
  assert.notEqual(pdf2.data.pdfFileId, pdf1.data.pdfFileId);
  assert.match(env.driveFiles.get(pdf2.data.pdfFileId).getBlob().getDataAsString(), /December 23, 2026/);

  const sendOk = env.ctx.EmailService.sendEndorsementEmail(sub.reservationId);
  assert.equal(sendOk.ok, true);
  assert.match(env.sentEmails[0].options.htmlBody, /December 23, 2026/);
});

test('E2E Security: Defends against XSS in HTML emails/dialogs, formula injection in Sheets, and regex $ / \\ injection in Google Docs', () => {
  const env = bootstrapFullWorkspace();
  const opts = { todayDateString: '2026-11-19', now: new Date('2026-11-19T03:00:00Z') };

  const maliciousName = '=HYPERLINK("http://evil") <script>alert(1)</script> $1 \\';
  const sub = env.ctx.FormHandler.handleFormSubmit({
    payload: {
      guestName: maliciousName,
      emailAddress: 'security@guest.test',
      contactNumber: '+63 917 111 2222',
      checkInDate: '2026-12-20',
      checkOutDate: '2026-12-21',
      numberOfGuests: 2,
      numberOfRooms: '1',
      specialRequests: '</script><img src=x onerror=alert(2)>',
      agreedToHouseRules: true
    }
  }, null, opts);
  assert.equal(sub.ok, true);

  // Confirm raw cell sanitization neutralized leading '=' on write (verified via Utils)
  assert.equal(env.ctx.Utils.sanitizeSheetCell(maliciousName).startsWith("'="), true);

  // Approve, generate PDF (tests regex $1 and \ replacement safety), and send email
  assert.equal(env.ctx.ApprovalService.approveReservation(sub.data.reservationId, '').ok, true);
  const pdf = env.ctx.PdfService.generateEndorsementPdf(sub.data.reservationId);
  assert.equal(pdf.ok, true);
  const pdfContent = env.driveFiles.get(pdf.data.pdfFileId).getBlob().getDataAsString();
  assert.ok(pdfContent.includes('$1 \\'), 'Dollar signs and backslashes must survive Google Docs replaceText intact');
  assert.doesNotMatch(pdfContent, /\{\{[^}]+\}\}/);

  const send = env.ctx.EmailService.sendEndorsementEmail(sub.data.reservationId);
  assert.equal(send.ok, true);
  assert.doesNotMatch(env.sentEmails[0].options.htmlBody, /<script>/i, 'HTML email must escape script tags');
  assert.match(env.sentEmails[0].options.htmlBody, /&lt;script&gt;/);

  // Verify dialog JSON serialization escapes </script> cleanly
  const sheet = env.spreadsheet.getSheetByName('Reservations');
  sheet.setActiveSelection(2, 1);
  env.ctx.menuViewSelectedReservation();
  const dialogHtml = env.uiEvents.dialogs[env.uiEvents.dialogs.length - 1].html;
  assert.doesNotMatch(dialogHtml, /<\/script><img/i, 'Dialog script JSON must neutralize </script> breakout');
});

test('E2E: Reverse file load order proves zero Google Apps Script TDZ / initialization-order dependencies', () => {
  const env = bootstrapFullWorkspace({ reverseLoadOrder: true });
  const sub = env.ctx.FormHandler.handleFormSubmit({
    payload: {
      guestName: 'Load Order Guest',
      emailAddress: 'order@guest.test',
      contactNumber: '09171110000',
      checkInDate: '2026-12-29',
      checkOutDate: '2026-12-31',
      numberOfGuests: 2,
      numberOfRooms: '1',
      specialRequests: '',
      agreedToHouseRules: true
    }
  }, null, { todayDateString: '2026-11-19', now: new Date('2026-11-19T03:00:00Z') });

  assert.equal(sub.ok, true);
  assert.equal(env.ctx.ApprovalService.approveReservation(sub.data.reservationId, '').ok, true);
  assert.equal(env.ctx.PdfService.generateEndorsementPdf(sub.data.reservationId).ok, true);
  assert.equal(env.ctx.EmailService.sendEndorsementEmail(sub.data.reservationId).ok, true);
});

test('E2E: Inline logo insertion from Drive file works cleanly without breaking PDF generation', () => {
  const env = bootstrapFullWorkspace();
  const folderId = env.ctx.Config.getSettings().driveOutputFolderId;
  const folder = env.driveFolders.get(folderId);
  const logoFile = folder.createFile(env.ctx.Utilities.newBlob('PNG_LOGO', 'image/png', 'staycation-logo.png'));
  env.ctx.Config.saveSettings({ STAYCATION_LOGO_URL: logoFile.getId() });

  const sub = env.ctx.FormHandler.handleFormSubmit({
    payload: {
      guestName: 'Logo Test Guest',
      emailAddress: 'logo@guest.test',
      contactNumber: '09172223333',
      checkInDate: '2026-12-27',
      checkOutDate: '2026-12-28',
      numberOfGuests: 2,
      numberOfRooms: '1',
      specialRequests: '',
      agreedToHouseRules: true
    }
  }, null, { todayDateString: '2026-11-19', now: new Date('2026-11-19T03:00:00Z') });

  env.ctx.ApprovalService.approveReservation(sub.data.reservationId, '');
  const pdf = env.ctx.PdfService.generateEndorsementPdf(sub.data.reservationId);
  assert.equal(pdf.ok, true);
  assert.doesNotMatch(env.driveFiles.get(pdf.data.pdfFileId).getBlob().getDataAsString(), /\{\{STAYCATION_LOGO\}\}/);
});
