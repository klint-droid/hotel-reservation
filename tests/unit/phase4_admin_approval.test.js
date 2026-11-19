'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGasMockRuntime } = require('../helpers/gasMockRuntime');

function setupPhase4Env() {
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
    'DashboardService.gs',
    'Code.gs'
  ]);
  env.ctx.runFullSetup();
  return env;
}

function submitSample(env, email = 'juan@example.com', name = 'Juan Dela Cruz') {
  return env.ctx.FormHandler.handleFormSubmit({
    payload: {
      guestName: name,
      emailAddress: email,
      contactNumber: '09171234567',
      checkInDate: '2026-12-20',
      checkOutDate: '2026-12-22',
      numberOfGuests: 3,
      numberOfRooms: '1',
      specialRequests: 'Quiet room',
      agreedToHouseRules: true
    }
  }, null, { todayDateString: '2026-11-19', now: new Date('2026-11-19T02:00:00Z') });
}

test('Phase 4: Custom STAYCATION MANAGEMENT menu registers all 9 required items', () => {
  const env = setupPhase4Env();
  env.ctx.onOpen();

  assert.equal(env.uiEvents.menus.length, 1);
  const menu = env.uiEvents.menus[0];
  assert.equal(menu.title, 'STAYCATION MANAGEMENT');
  const labels = menu.items.filter((i) => i.type === 'item').map((i) => i.label);
  assert.deepEqual(labels, [
    'Dashboard',
    'View Selected Reservation',
    'Approve Reservation',
    'Reject Reservation',
    'Generate Endorsement PDF',
    'Send Endorsement Email',
    'View Email Logs',
    'Refresh Dashboard',
    'System Settings'
  ]);
});

test('Phase 4: Approve pending reservation records timestamp, admin, hash, logs activity, and sends ZERO emails', () => {
  const env = setupPhase4Env();
  const created = submitSample(env);
  const resId = created.data.reservationId;

  const approved = env.ctx.ApprovalService.approveReservation(resId, 'Verified via phone');
  assert.equal(approved.ok, true);
  assert.equal(approved.data.approvalStatus, 'APPROVED');
  assert.equal(approved.data.approvedBy, 'admin@staycation.test');
  assert.ok(approved.data.approvedAt);
  assert.equal(approved.data.emailStatus, 'NOT_SENT');
  assert.equal(env.sentEmails.length, 0, 'Approval MUST NOT auto-send email');

  // Integrity hash recorded
  const integrity = env.ctx.SecurityService.verifyEndorsedIntegrity(approved.data, false);
  assert.equal(integrity.valid, true);

  // Approving already-approved reservation fails cleanly
  const dupApprove = env.ctx.ApprovalService.approveReservation(resId, '');
  assert.equal(dupApprove.ok, false);
  assert.equal(dupApprove.code, 'ERR_INVALID_STATE');
});

test('Phase 4: Reject pending reservation requires reason, blocks subsequent approval, sends ZERO emails', () => {
  const env = setupPhase4Env();
  const created = submitSample(env, 'reject@example.com', 'Ana Reyes');
  const resId = created.data.reservationId;

  // Missing reason rejected
  const noReason = env.ctx.ApprovalService.rejectReservation(resId, '   ');
  assert.equal(noReason.ok, false);
  assert.equal(noReason.code, 'ERR_VALIDATION_FAILED');

  // Valid rejection
  const rej = env.ctx.ApprovalService.rejectReservation(resId, 'Dates fully booked');
  assert.equal(rej.ok, true);
  assert.equal(rej.data.approvalStatus, 'REJECTED');
  assert.match(rej.data.adminRemarks, /Dates fully booked/);
  assert.equal(env.sentEmails.length, 0);

  // Attempting to approve rejected reservation blocked
  const approveAfterReject = env.ctx.ApprovalService.approveReservation(resId, '');
  assert.equal(approveAfterReject.ok, false);
  assert.equal(approveAfterReject.code, 'ERR_INVALID_STATE');
});

test('Phase 4: Editing endorsed fields on an APPROVED reservation revokes approval and invalidates PDF', () => {
  const env = setupPhase4Env();
  const created = submitSample(env, 'edit@example.com', 'Pedro Cruz');
  const resId = created.data.reservationId;

  env.ctx.ApprovalService.approveReservation(resId, '');
  // Simulate an existing PDF linked to the approved reservation
  const dummyPdf = env.driveFolders.values().next().value.createFile(
    env.ctx.Utilities.newBlob('%PDF', 'application/pdf', 'ENDORSEMENT_STAY-20261119-0001_PEDRO-CRUZ.pdf')
  );
  env.ctx.ReservationService.updateReservationFields(resId, {
    pdfFileId: dummyPdf.getId(),
    pdfFileUrl: dummyPdf.getUrl()
  });

  // Simulate manual edit to Number of Guests (col H = 8) on row 2
  const sheet = env.spreadsheet.getSheetByName('Reservations');
  sheet.getRange(2, 8).setValue(6);
  const editRes = env.ctx.onSpreadsheetEditTrigger({ range: sheet.getRange(2, 8) });
  assert.equal(editRes.ok, true);
  assert.equal(editRes.data.affected, 1);

  const after = env.ctx.ReservationService.getReservationById(resId).reservation;
  assert.equal(after.approvalStatus, 'PENDING', 'Approval must be revoked back to PENDING');
  assert.equal(after.pdfFileId, '', 'PDF File ID must be cleared');
  assert.equal(after.pdfFileUrl, '', 'PDF File URL must be cleared');
  assert.equal(after.approvedBy, '', 'Approved By must be cleared');
  assert.match(dummyPdf.getName(), /^\[SUPERSEDED\]/);

  const logs = env.ctx.ActivityLogService.getRecentActivities(10, resId);
  assert.ok(logs.some((l) => l.action === 'APPROVAL_REVOKED'));
  assert.ok(logs.some((l) => l.action === 'PDF_INVALIDATED'));
});

test('Phase 4: Dialogs render cleanly and unauthorized users are blocked from menu actions', () => {
  const env = setupPhase4Env();
  submitSample(env);
  const sheet = env.spreadsheet.getSheetByName('Reservations');
  sheet.setActiveSelection(2, 1);

  env.ctx.menuShowDashboard();
  env.ctx.menuViewSelectedReservation();
  env.ctx.menuApproveReservation();
  env.ctx.menuRejectReservation();
  env.ctx.menuOpenSystemSettings();
  assert.equal(env.uiEvents.dialogs.length, 5);

  // Unauthorized user cannot approve via menu or server API
  env.state.activeUserEmail = 'unauthorized@guest.test';
  const apiRes = env.ctx.apiApproveReservation(
    env.ctx.ReservationService.getAllReservations()[0].reservation.reservationId,
    ''
  );
  assert.equal(apiRes.ok, false);
  assert.equal(apiRes.code, 'ERR_UNAUTHORIZED');
});
