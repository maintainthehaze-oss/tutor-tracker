'use strict';
// Roadmap Slice F: optional `inPersonMinutes` on a Hybrid session. The remote part needs no travel leg, so
// mileage-by-day only routes hybrid rows with minutes > 0 (unset = legacy hybrid, still routed). Uneven
// sibling hours stay two rows (form helper text). Fabricated data only. NOT observed live.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, readSource } = require('./helpers/harness.cjs');
const { bootUi } = require('./helpers/ui-app.cjs');
const { formApp } = require('./helpers/session-form.cjs');

const copy = x => JSON.parse(JSON.stringify(x));
const TODAY = '2026-03-10';
const lastSaved = ui => ui.disk().working.sessions.at(-1);

test('isDriveStop (pure): hybrid with 0 minutes in person is not a stop; >0 or unset still is; online never', () => {
  const { isDriveStop } = loadApp(['app-core', 'sessions']);
  assert.equal(isDriveStop({ type: 'hybrid', inPersonMinutes: 0, status: 'completed' }), false);
  assert.equal(isDriveStop({ type: 'hybrid', inPersonMinutes: 90, status: 'completed' }), true);
  assert.equal(isDriveStop({ type: 'hybrid', status: 'completed' }), true, 'legacy hybrid rows (no minutes) keep their leg');
  assert.equal(isDriveStop({ type: 'in-person', inPersonMinutes: 0, status: 'completed' }), true, 'minutes mean nothing outside hybrid');
  assert.equal(isDriveStop({ type: 'online', status: 'completed' }), false);
  assert.equal(isDriveStop({ type: 'hybrid', inPersonMinutes: '', status: 'completed' }), true, 'only a real number 0 drops the leg (imported "" does not)');
  assert.equal(isDriveStop({ type: 'hybrid', inPersonMinutes: 90, status: 'cancelled' }), false);
});

test('validateCorrection: minutes are null or whole non-negative integers', () => {
  const { recordPolicy } = loadApp(['app-core', 'record-policy']);
  assert.doesNotThrow(() => recordPolicy.validateCorrection({ inPersonMinutes: 120 }));
  assert.doesNotThrow(() => recordPolicy.validateCorrection({ inPersonMinutes: 0 }));
  assert.doesNotThrow(() => recordPolicy.validateCorrection({ inPersonMinutes: null }), 'null clears it when the type leaves hybrid');
  assert.throws(() => recordPolicy.validateCorrection({ inPersonMinutes: -5 }), /Invalid minutes in person/);
  assert.throws(() => recordPolicy.validateCorrection({ inPersonMinutes: 12.5 }), /Invalid minutes in person/);
  assert.throws(() => recordPolicy.validateCorrection({ inPersonMinutes: '90' }), /Invalid minutes in person/);
});

test('flow: the field shows for Hybrid only, saves whole minutes on a hybrid row and null on everything else', async () => {
  const ui = await bootUi();
  await ui.click('add-session');
  assert.equal(ui.field('session-in-person-group').hidden, true, 'hidden for the default In Person');
  await ui.click('toggle-session-client', { 'data-id': 'c1' });
  await ui.change('session-type', 'hybrid');
  assert.equal(ui.field('session-in-person-group').hidden, false, 'shown once Hybrid is picked');
  ui.field('session-in-person-minutes').value = '90.4';
  ui.field('session-amount').value = '100';
  await ui.click('save-session');
  await ui.waitFor(() => lastSaved(ui).date === TODAY, 'the hybrid session to save');
  assert.equal(lastSaved(ui).type, 'hybrid');
  assert.equal(lastSaved(ui).inPersonMinutes, 90, 'stored as whole minutes');
  // In-person session: minutes typed earlier are ignored, the row stores null.
  await ui.click('add-session');
  assert.equal(ui.field('session-in-person-minutes').value, '', 'a fresh form starts blank');
  await ui.click('toggle-session-client', { 'data-id': 'c1' });
  await ui.change('session-type', 'in-person');                                    // the fake DOM's form.reset() is a no-op
  ui.field('session-in-person-minutes').value = '45';
  ui.field('session-amount').value = '100';
  await ui.click('save-session');
  await ui.waitFor(() => ui.disk().working.sessions.length === 10, 'the in-person session to save');
  assert.equal(lastSaved(ui).type, 'in-person');
  assert.equal(lastSaved(ui).inPersonMinutes, null);
});

test('flow: editing a LOCKED row to hybrid records minutes as a correction; a no-edit save records nothing', async () => {
  const ui = await bootUi();
  const events = ui.disk().events.length;
  await ui.click('edit-session', { 'data-id': 'a1' });                              // archived + locked, in-person
  assert.equal(ui.field('session-in-person-group').hidden, true);
  await ui.change('session-type', 'hybrid');
  ui.field('session-in-person-minutes').value = '60';
  await ui.click('save-session');
  await ui.waitFor(() => ui.disk().events.length === events + 1, 'the correction to save');
  assert.deepEqual(copy(ui.disk().events.at(-1).fields), { type: 'hybrid', inPersonMinutes: 60 });
  // Reopen: the correction shows, and saving it untouched is "No changes".
  await ui.click('edit-session', { 'data-id': 'a1' });
  assert.equal(ui.field('session-type').value, 'hybrid');
  assert.equal(String(ui.field('session-in-person-minutes').value), '60');
  await ui.click('save-session');
  await ui.settle();
  assert.equal(ui.disk().events.length, events + 1, 'no spurious minutes correction on a no-edit save');
  // The table notes the split after the client names.
  ui.App.renderSessions();
  assert.match(ui.field('sessions-tbody').innerHTML, /Hybrid · 60 min in person/);
});

test('form pin button: a hybrid session with 0 minutes in person refuses to route (no travel)', async () => {
  const app = await formApp();
  app.App.openSessionForm();
  app.chooseClients(['c1']);
  app.fill({ type: 'hybrid', 'in-person-minutes': '0', date: TODAY });
  assert.equal(await app.App.calcFormMileage(), false);
  assert.deepEqual(app.toasts.at(-1), ['warning', 'Hybrid with 0 minutes in person: no travel, so no mileage.']);
});

test('static: the field is wired (markup hidden by default with the two-rows note, change handler, correctable field)', () => {
  const html = readSource('index.html');
  assert.match(html, /<div class="form-group" id="session-in-person-group" hidden>/);
  assert.match(html, /id="session-in-person-minutes"[^>]*min="0"/);
  assert.match(html, /Uneven sibling hours stay two sessions\./);
  assert.match(readSource('js/ui.js'), /target\.id === 'session-type'\) \{ App\.syncInPersonGroup\(\)/);
  assert.match(readSource('js/record-policy.js'), /'paymentDate','inPersonMinutes'\]/);
});

test('review fix: switching a row to a no-travel type in THIS edit clears its stale miles; already-no-travel rows are left alone', async () => {
  const ui = await bootUi();
  // Unlocked row: save in-person with 12 mi, then edit to Hybrid / 0 minutes.
  await ui.click('add-session');
  await ui.click('toggle-session-client', { 'data-id': 'c1' });
  ui.field('session-amount').value = '100';
  ui.field('session-mileage').value = '12';
  ui.field('session-status').value = 'scheduled';                                  // stays unlocked
  await ui.click('save-session');
  await ui.waitFor(() => lastSaved(ui).date === TODAY, 'the row to save');
  const row = lastSaved(ui);
  assert.equal(row.mileage, 12);
  await ui.click('edit-session', { 'data-id': row.id });
  await ui.change('session-type', 'hybrid');
  ui.field('session-in-person-minutes').value = '0';
  await ui.click('save-session');
  await ui.waitFor(() => ui.disk().working.sessions.find(s => s.id === row.id).mileage === 0, 'the stale miles to clear');
  const edited = ui.disk().working.sessions.find(s => s.id === row.id);
  assert.equal(edited.inPersonMinutes, 0); assert.equal(edited.mileageManual, false); assert.equal(edited.mileageDetails, '');
  // Locked row a1 (in-person, 10 mi): switching to Online records a correction that zeroes the miles.
  const events = ui.disk().events.length;
  await ui.click('edit-session', { 'data-id': 'a1' });
  await ui.change('session-type', 'online');
  await ui.click('save-session');
  await ui.waitFor(() => ui.disk().events.length === events + 1, 'the correction to save');
  assert.deepEqual(copy(ui.disk().events.at(-1).fields), { type: 'online', mileage: 0, mileageManual: false });
  // Re-saving the now-online row untouched is "No changes": its miles were already cleared, nothing new to write.
  await ui.click('edit-session', { 'data-id': 'a1' });
  await ui.click('save-session');
  await ui.settle();
  assert.equal(ui.disk().events.length, events + 1);
  // An old unlocked in-person row never gains the key on a no-edit save.
  await ui.click('add-session');
  await ui.click('toggle-session-client', { 'data-id': 'c1' });
  await ui.change('session-type', 'in-person');
  ui.field('session-amount').value = '50'; ui.field('session-status').value = 'scheduled';
  await ui.click('save-session');
  await ui.waitFor(() => lastSaved(ui).amount === 50, 'the plain row to save');
  const plain = lastSaved(ui);
  assert.equal(plain.inPersonMinutes, null, 'the form writes null on a new row');
});
