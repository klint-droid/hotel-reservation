/**
 * LiveSmokeTests.gs
 * Optional live Google Workspace verification script.
 *
 * IMPORTANT:
 * - Kept outside StaycationReservationSystem/ so it is NOT pushed to production by default.
 * - Copy into a staging Apps Script project ONLY when running live end-to-end tests
 *   with an authorized Google account and a real test recipient email you own.
 */

function runLiveWorkspaceSmokeTest(testRecipientEmail) {
  if (!testRecipientEmail || String(testRecipientEmail).indexOf('@') === -1) {
    throw new Error('Pass a valid testRecipientEmail that you control (e.g., your own test inbox).');
  }

  Logger.log('=== Starting Live Google Workspace Smoke Test ===');

  // 1. Verify workspace health
  var health = DashboardService.runWorkspaceHealthCheck();
  Logger.log('Workspace Health: ' + JSON.stringify(health));
  if (!health.healthy) {
    throw new Error('Workspace health check failed. Fix Settings/Triggers before running live smoke test.');
  }

  // 2. Simulate guest submission 10 days from now
  var now = new Date();
  var checkIn = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
  var checkOut = new Date(now.getTime() + 12 * 24 * 60 * 60 * 1000);
  var settings = Config.getSettings();
  var tz = settings.timezone || Config.DEFAULT_TIMEZONE;

  var subResult = FormHandler.handleFormSubmit({
    payload: {
      guestName: 'Live Smoke Test Guest',
      emailAddress: testRecipientEmail,
      contactNumber: '0917 000 0000',
      checkInDate: Utilities.formatDate(checkIn, tz, 'yyyy-MM-dd'),
      checkOutDate: Utilities.formatDate(checkOut, tz, 'yyyy-MM-dd'),
      numberOfGuests: 2,
      numberOfRooms: '1',
      specialRequests: 'Automated live verification test — safe to archive.',
      agreedToHouseRules: true
    }
  });
  Logger.log('1. Submission Result: ' + JSON.stringify(subResult));
  if (!subResult.ok) {
    throw new Error('Live submission test failed: ' + subResult.message);
  }
  var resId = subResult.data.reservationId;

  // 3. Approve reservation (verify NO email sent automatically)
  var approveResult = ApprovalService.approveReservation(resId, 'Live smoke test approval');
  Logger.log('2. Approval Result: ' + JSON.stringify(approveResult));
  if (!approveResult.ok) {
    throw new Error('Live approval test failed: ' + approveResult.message);
  }

  // 4. Generate Endorsement PDF in private Drive folder
  var pdfResult = PdfService.generateEndorsementPdf(resId);
  Logger.log('3. PDF Result: ' + JSON.stringify(pdfResult));
  if (!pdfResult.ok) {
    throw new Error('Live PDF test failed: ' + pdfResult.message);
  }

  // 5. Send Endorsement Email via real GmailApp
  var emailResult = EmailService.sendEndorsementEmail(resId);
  Logger.log('4. Email Result: ' + JSON.stringify(emailResult));
  if (!emailResult.ok) {
    throw new Error('Live email test failed: ' + emailResult.message);
  }

  // 6. Verify duplicate send is strictly blocked
  var dupResult = EmailService.sendEndorsementEmail(resId);
  Logger.log('5. Duplicate Prevention Check: ' + JSON.stringify(dupResult));
  if (dupResult.ok || dupResult.code !== Config.ERROR_CODES.DUPLICATE_EMAIL) {
    throw new Error('Duplicate prevention FAILED during live smoke test!');
  }

  Logger.log('=== Live Google Workspace Smoke Test PASSED ===');
  return {
    ok: true,
    referenceNumber: subResult.data.referenceNumber,
    pdfFileUrl: pdfResult.data.pdfFileUrl,
    emailLogId: emailResult.data.emailLogId
  };
}
