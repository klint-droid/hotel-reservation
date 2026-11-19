'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGasMockRuntime } = require('../helpers/gasMockRuntime');

function setupPhase5Env() {
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
    'FormHandler.gs',
    'ApprovalService.gs',
    'DocumentService.gs',
    'PdfService.gs'
  ]);
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

function createApprovedBooking(env, guestName = 'Juan Dela Cruz') {
  const sub = env.ctx.FormHandler.handleFormSubmit({
    payload: {
      guestName,
      emailAddress: 'juan@example.com',
      contactNumber: '09171234567',
      checkInDate: '2026-12-24',
      checkOutDate: '2026-12-26',
      numberOfGuests: 5,
      numberOfRooms: '2',
      specialRequests: 'Extra pillows',
      agreedToHouseRules: true
    }
  }, null, { todayDateString: '2026-11-19', now: new Date('2026-11-19T02:00:00Z') });
  env.ctx.ApprovalService.approveReservation(sub.data.reservationId, 'Approved');
  return sub.data;
}

test('Phase 5: Generates private endorsement PDF with exact sanitized filename, full placeholder replacement, and temp doc cleanup', () => {
  const env = setupPhase5Env();
  const booking = createApprovedBooking(env, 'Juan Dela Cruz');

  const pdfRes = env.ctx.PdfService.generateEndorsementPdf(booking.reservationId);
  assert.equal(pdfRes.ok, true, pdfRes.message);
  assert.equal(pdfRes.data.fileName, 'ENDORSEMENT_STAY-20261119-0001_JUAN-DELA-CRUZ.pdf');

  // Verify Drive file is PRIVATE and contains replaced guest details (zero unresolved {{...}})
  const file = env.driveFiles.get(pdfRes.data.pdfFileId);
  assert.ok(file);
  assert.equal(file.getSharingAccess(), 'PRIVATE');
  assert.equal(file.getSharingPermission(), 'NONE');
  const content = file.getBlob().getDataAsString();
  assert.match(content, /Villa Verde Sanctuary/);
  assert.match(content, /Juan Dela Cruz/);
  assert.match(content, /STAY-20261119-0001/);
  assert.match(content, /December 24, 2026/);
  assert.match(content, /December 26, 2026/);
  assert.match(content, /\+63 917 888 9900/);
  assert.doesNotMatch(content, /\{\{[^}]+\}\}/, 'Zero unresolved placeholders may remain');

  // Temporary Google Doc copy must be trashed
  const tempDocs = Array.from(env.driveFiles.values()).filter((f) => f.getName().startsWith('TEMP_ENDORSEMENT_'));
  assert.equal(tempDocs.length, 1);
  assert.equal(tempDocs[0].isTrashed(), true);

  // Sheet updated with PDF ID & URL
  const updated = env.ctx.ReservationService.getReservationById(booking.reservationId).reservation;
  assert.equal(updated.pdfFileId, pdfRes.data.pdfFileId);
  assert.equal(updated.pdfFileUrl, pdfRes.data.pdfFileUrl);
  assert.equal(updated.lastError, '');
});

test('Phase 5: Blocks PDF generation for PENDING, REJECTED, missing template, missing folder, missing placeholders, and post-approval tampering', () => {
  const env = setupPhase5Env();

  // 1. PENDING booking blocked
  const pending = env.ctx.FormHandler.handleFormSubmit({
    payload: {
      guestName: 'Pending Guest',
      emailAddress: 'pending@example.com',
      contactNumber: '09170000001',
      checkInDate: '2026-12-24',
      checkOutDate: '2026-12-25',
      numberOfGuests: 2,
      numberOfRooms: '1',
      specialRequests: '',
      agreedToHouseRules: true
    }
  }, null, { todayDateString: '2026-11-19', now: new Date('2026-11-19T02:00:00Z') }).data;
  const rPending = env.ctx.PdfService.generateEndorsementPdf(pending.reservationId);
  assert.equal(rPending.ok, false);
  assert.equal(rPending.code, 'ERR_INVALID_STATE');

  // 2. REJECTED booking blocked
  env.ctx.ApprovalService.rejectReservation(pending.reservationId, 'No availability');
  const rRejected = env.ctx.PdfService.generateEndorsementPdf(pending.reservationId);
  assert.equal(rRejected.ok, false);
  assert.equal(rRejected.code, 'ERR_INVALID_STATE');

  // 3. Missing template handled cleanly & preserves reservation data
  const approved = createApprovedBooking(env, 'Error Test Guest');
  const originalSettings = env.ctx.Config.getSettings();
  env.ctx.Config.saveSettings({ DOCS_TEMPLATE_ID: 'NON_EXISTENT_TEMPLATE_12345' });
  const rMissingTpl = env.ctx.PdfService.generateEndorsementPdf(approved.reservationId);
  assert.equal(rMissingTpl.ok, false);
  assert.equal(rMissingTpl.code, 'ERR_MISSING_TEMPLATE');
  assert.ok(env.ctx.ReservationService.getReservationById(approved.reservationId), 'Reservation preserved on error');

  // 4. Missing output folder handled cleanly
  env.ctx.Config.saveSettings({
    DOCS_TEMPLATE_ID: originalSettings.docsTemplateId,
    DRIVE_OUTPUT_FOLDER_ID: 'NON_EXISTENT_FOLDER_12345'
  });
  const rMissingFolder = env.ctx.PdfService.generateEndorsementPdf(approved.reservationId);
  assert.equal(rMissingFolder.ok, false);
  assert.equal(rMissingFolder.code, 'ERR_MISSING_FOLDER');

  // 5. Template missing required placeholders blocked
  const badDoc = env.ctx.DocumentApp.create('Broken Template');
  badDoc.getBody().appendParagraph('Only static text without guest fields');
  badDoc.saveAndClose();
  env.ctx.Config.saveSettings({
    DOCS_TEMPLATE_ID: badDoc.getId(),
    DRIVE_OUTPUT_FOLDER_ID: originalSettings.driveOutputFolderId
  });
  const rBadTpl = env.ctx.PdfService.generateEndorsementPdf(approved.reservationId);
  assert.equal(rBadTpl.ok, false);
  assert.equal(rBadTpl.code, 'ERR_UNRESOLVED_PLACEHOLDERS');

  // 6. Silent manual edit bypassing onEdit is caught by SHA-256 hash check -> revokes approval
  env.ctx.Config.saveSettings({ DOCS_TEMPLATE_ID: originalSettings.docsTemplateId });
  const sheet = env.spreadsheet.getSheetByName('Reservations');
  const rec = env.ctx.ReservationService.getReservationById(approved.reservationId);
  sheet.getRange(rec.rowIndex, 3).setValue('Tampered Guest Name');
  const rTamper = env.ctx.PdfService.generateEndorsementPdf(approved.reservationId);
  assert.equal(rTamper.ok, false);
  assert.equal(rTamper.code, 'ERR_INTEGRITY_MISMATCH');
  assert.equal(
    env.ctx.ReservationService.getReservationById(approved.reservationId).reservation.approvalStatus,
    'PENDING'
  );
});
