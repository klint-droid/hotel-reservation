'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGasMockRuntime } = require('../helpers/gasMockRuntime');

test('PMO Endorsement: Sends Dear PMO/Concierge email to PMO with Guest CC, inline uploaded ID photo(s) below Thank you., plus ID & PDF attachments', () => {
  const env = createGasMockRuntime({
    activeUserEmail: 'owner@staycation.test',
    effectiveUserEmail: 'owner@staycation.test',
    remainingDailyQuota: 100
  });
  env.loadGasFiles();
  env.ctx.runFullSetup();

  env.ctx.Config.saveSettings({
    STAYCATION_NAME: 'Novotel Tower Staycation',
    UNIT_LOCATION: 'Unit 3702, Novotel Tower',
    PMO_CONCIERGE_EMAIL: 'pmo@novoteltower.test',
    STAYCATION_CONTACT_NUMBER: '+63 917 555 0199',
    STAYCATION_EMAIL_ADDRESS: 'owner@staycation.test',
    CHECK_IN_TIME: '2:00 PM',
    CHECK_OUT_TIME: '12:00 PM'
  });

  // Simulate 2 uploaded guest Valid ID files saved in Drive by Google Forms File Upload
  const folder = env.driveFolders.get(env.ctx.Config.getSettings().driveOutputFolderId);
  const idPhoto = folder.createFile(
    env.ctx.Utilities.newBlob('FAKE_JPG_IMAGE_BYTES', 'image/jpeg', 'drivers-license.jpg')
  );
  const idPdf = folder.createFile(
    env.ctx.Utilities.newBlob('%PDF-1.4 PASSPORT', 'application/pdf', 'passport.pdf')
  );

  // Guest submits Google Form with Companion Guests + Valid ID Upload Drive URLs
  const sub = env.ctx.FormHandler.handleFormSubmit({
    namedValues: {
      'Timestamp': ['2026-11-19 10:00:00'],
      'Full Name': ['Juan Dela Cruz'],
      'Email Address': ['juan@guest.test'],
      'Contact Number': ['0917 123 4567'],
      'Check-in Date': ['2026-11-20'],
      'Check-out Date': ['2026-11-21'],
      'Number of Guests': ['2'],
      'Number of Rooms': ['1'],
      'Companion / Other Guest Names': ['Maria Dela Cruz'],
      'Valid ID Upload': [
        `https://drive.google.com/open?id=${idPhoto.getId()}, https://drive.google.com/file/d/${idPdf.getId()}/view`
      ],
      'Special Requests': [''],
      'Agreement to House Rules': ['I have read and agree to the Staycation House Rules.']
    }
  }, null, { todayDateString: '2026-11-19', now: new Date('2026-11-19T02:00:00Z') });

  assert.equal(sub.ok, true, sub.message);
  assert.equal(sub.data.companionGuests, 'Maria Dela Cruz');
  assert.equal(sub.data.validIdFileIds, `${idPhoto.getId()}, ${idPdf.getId()}`);

  // Run 1-Click Approve & Endorse
  const res = env.ctx.apiApproveAndEndorse(sub.data.reservationId, 'IDs verified');
  assert.equal(res.ok, true, res.message);
  assert.equal(env.sentEmails.length, 1);

  const sent = env.sentEmails[0];
  // Sent TO PMO/Concierge and CC'd to Guest
  assert.equal(sent.recipient, 'pmo@novoteltower.test');
  assert.equal(sent.options.cc, 'juan@guest.test');
  assert.match(sent.subject, /Unit 3702, Novotel Tower/);
  assert.match(sent.subject, /Nov 20/);
  assert.match(sent.subject, /Nov 21/);

  // Exact wording matching screenshot + inline CID image below "Thank you."
  const html = sent.options.htmlBody;
  assert.match(html, /Dear PMO\/Concierge,/);
  assert.match(html, /allowing the following guests to stay at <strong>Unit 3702, Novotel Tower<\/strong> from <strong>Nov 20 \(2:00 PM\)<\/strong> to <strong>Nov 21 \(12:00 PM\)<\/strong>/);
  assert.match(html, /Juan Dela Cruz/);
  assert.match(html, /Maria Dela Cruz/);
  assert.match(html, /They will present their ids upon arrival for verification\. Kindly assist them with check-in and grant access to the unit during their stay\./);
  assert.match(html, /If you require anything further, please let me know\./);
  assert.match(html, /Thank you\./);
  assert.match(html, /<img src="cid:guest_id_0"/);
  assert.ok(html.indexOf('<img src="cid:guest_id_0"') > html.indexOf('Thank you.'), 'Inline ID image must appear below Thank you.');

  // Inline image blob + 3 attachments (Endorsement PDF + JPG ID + PDF ID)
  assert.ok(sent.options.inlineImages && sent.options.inlineImages.guest_id_0);
  assert.equal(sent.options.attachments.length, 3);
  const attachNames = sent.options.attachments.map((a) => a.getName());
  assert.ok(attachNames.includes('ENDORSEMENT_STAY-20261119-0001_JUAN-DELA-CRUZ.pdf'));
  assert.ok(attachNames.includes('drivers-license.jpg'));
  assert.ok(attachNames.includes('passport.pdf'));

  // Re-running runFullSetup() on an existing workspace syncs missing form fields safely without duplicates
  const form = env.formsRegistry.get(env.scriptPropertiesStore.get('LINKED_FORM_ID'));
  // Simulate an older Form missing Companion / Other Guest Names
  form._items = form._items.filter((it) => it.title !== 'Companion / Other Guest Names');
  const beforeCount = form._items.length;

  const synced = env.ctx.runFullSetup();
  assert.equal(synced.ok, true);
  assert.equal(synced.data.registrationForm.created, false);
  assert.deepEqual(Array.from(synced.data.registrationForm.addedFields), ['Companion / Other Guest Names']);
  assert.equal(form._items.length, beforeCount + 1);
  assert.equal(env.triggers.length, 2, 'Triggers must remain deduplicated');

  // Existing settings must NOT be overwritten when re-running runFullSetup()
  assert.equal(env.ctx.Config.getSettings().unitLocation, 'Unit 3702, Novotel Tower');
  assert.equal(env.ctx.Config.getSettings().pmoConciergeEmails[0], 'pmo@novoteltower.test');
});
