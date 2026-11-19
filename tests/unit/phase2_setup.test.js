'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGasMockRuntime } = require('../helpers/gasMockRuntime');

test('Phase 2: SetupService.runFullSetup creates all 4 sheets with exact schemas, conditional formatting, protections, Form, private Folder, Template, and triggers', () => {
  const env = createGasMockRuntime({
    activeUserEmail: 'owner@staycation.test',
    effectiveUserEmail: 'owner@staycation.test'
  });
  env.loadGasFiles(['Config.gs', 'Utils.gs', 'Setup.gs']);

  const res = env.ctx.runFullSetup();
  assert.equal(res.ok, true);

  const ss = env.spreadsheet;
  assert.equal(ss.getSpreadsheetTimeZone(), 'Asia/Manila');

  // Verify 4 admin sheets + hidden raw Form Responses sheet
  const reservations = ss.getSheetByName('Reservations');
  const emailLogs = ss.getSheetByName('Email Logs');
  const settings = ss.getSheetByName('Settings');
  const activityLogs = ss.getSheetByName('Activity Logs');
  const rawForm = ss.getSheetByName('Form Responses 1');

  assert.ok(reservations, 'Reservations sheet must exist');
  assert.ok(emailLogs, 'Email Logs sheet must exist');
  assert.ok(settings, 'Settings sheet must exist');
  assert.ok(activityLogs, 'Activity Logs sheet must exist');
  assert.ok(rawForm, 'Raw Form Responses sheet must exist');
  assert.equal(rawForm.isSheetHidden(), true, 'Raw form sheet should be hidden');
  assert.equal(ss.getSheetByName('Sheet1'), null, 'Default empty Sheet1 should be removed');

  // Exact headers
  assert.deepEqual(
    reservations.getRange(1, 1, 1, 22).getValues()[0],
    Array.from(env.ctx.Config.RESERVATION_HEADERS)
  );
  assert.deepEqual(
    emailLogs.getRange(1, 1, 1, 10).getValues()[0],
    Array.from(env.ctx.Config.EMAIL_LOG_HEADERS)
  );
  assert.deepEqual(
    activityLogs.getRange(1, 1, 1, 9).getValues()[0],
    Array.from(env.ctx.Config.ACTIVITY_LOG_HEADERS)
  );

  // Frozen headers, filters, conditional formatting, protections
  assert.equal(reservations.getFrozenRows(), 1);
  assert.ok(reservations.getFilter());
  assert.equal(reservations.getConditionalFormatRules().length, 6);
  assert.equal(reservations.getProtections().length, 12);

  // Form configuration
  const form = env.formsRegistry.get(res.data.registrationForm.formId);
  assert.equal(form._title, 'Staycation Reservation Registration');
  assert.equal(form._requireLogin, false);
  assert.equal(form._items.length, 10);
  assert.equal(form._items[0].title, 'Full Name');
  assert.equal(form._items[0].required, true);
  assert.equal(form._items[6].title, 'Number of Rooms');
  assert.equal(form._items[6].required, false);
  assert.equal(form._items[7].title, 'Companion / Other Guest Names');
  assert.equal(form._items[7].required, false);
  assert.equal(form._items[9].title, 'Agreement to House Rules');
  assert.equal(form._items[9].required, true);

  // Private Drive Folder & Docs Template created & stored in Settings
  const folder = env.driveFolders.get(res.data.outputFolder.folderId);
  assert.equal(folder.getSharingAccess(), 'PRIVATE');
  assert.equal(folder.getSharingPermission(), 'NONE');

  const templateDoc = env.docsRegistry.get(res.data.templateDoc.templateId);
  const templateText = templateDoc.getBody().getText();
  assert.match(templateText, /RESERVATION CONFIRMATION/);
  assert.match(templateText, /ENDORSEMENT/);
  assert.match(templateText, /\{\{GUEST_NAME\}\}/);
  assert.match(templateText, /\{\{REFERENCE_NUMBER\}\}/);
  assert.match(templateText, /\{\{STAYCATION_NAME\}\}/);

  const loadedSettings = env.ctx.Config.getSettings();
  assert.equal(loadedSettings.driveOutputFolderId, folder.getId());
  assert.equal(loadedSettings.docsTemplateId, templateDoc.getId());
  assert.deepEqual(Array.from(loadedSettings.administratorEmails), ['owner@staycation.test']);

  // Triggers installed cleanly (and idempotent on second run)
  assert.equal(env.triggers.length, 2);
  env.ctx.SetupService.installTriggers();
  assert.equal(env.triggers.length, 2);
});
