'use strict';
// Audit fix 3: tap-to-pick client list, smart default status, duration chips.
// Pure logic is tested directly; the flow is driven through the real ui.js click/change delegation and the
// real sessions.js form code with a fake DOM and a fake clock. Fabricated data only. NOT observed live.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, readSource, command } = require('./helpers/harness.cjs');
const { bootUi } = require('./helpers/ui-app.cjs');
const { rawFixture } = require('./helpers/money-fixture.cjs');

const copy = x => JSON.parse(JSON.stringify(x));
const TODAY = '2026-03-10';                       // bootUi's fake clock starts at 2026-03-10 12:00 local
const lastSaved = ui => ui.disk().working.sessions.at(-1);

test('clientPickerRows (pure): active clients plus the edited session\'s own, selected first, then recent, then A-Z', () => {
  const { clientPickerRows } = loadApp(['app-core', 'sessions']);
  const clients = [
    { id: 1, firstName: 'Client', lastName: 'Zeta', rate: 50, status: 'active' },
    { id: '2', firstName: 'Client', lastName: 'Alpha', rate: 60, status: 'active' },
    { id: 3, firstName: 'Client', lastName: 'Retired', rate: 70, status: 'inactive' },
    { id: 4, firstName: 'Client', lastName: 'Mid', rate: 80 },                       // no status = active
    { id: 5, firstName: 'Client', lastName: 'Recent', rate: 90, status: 'active' },
  ];
  const sessions = [{ clientIds: [5], date: '2026-03-01' }, { clientIds: [1, 5], date: '2026-02-01' }, { clientIds: ['3'], date: '2026-03-05' }];
  const names = rows => copy(rows).map(r => r.name.replace('Client ', '') + (r.selected ? '*' : '') + (r.inactive ? ' (inactive)' : ''));
  assert.deepEqual(names(clientPickerRows(clients, sessions, [])), ['Recent', 'Zeta', 'Alpha', 'Mid']);
  assert.deepEqual(names(clientPickerRows(clients, sessions, ['2'])), ['Alpha*', 'Recent', 'Zeta', 'Mid']);
  assert.deepEqual(names(clientPickerRows(clients, sessions, [3, 1])), ['Retired* (inactive)', 'Zeta*', 'Recent', 'Alpha', 'Mid'],
    'a session being edited still lists its own inactive client');
  assert.deepEqual(copy(clientPickerRows(clients, sessions, []))[0], { id: 5, name: 'Client Recent', rate: 90, selected: false, inactive: false, last: '2026-03-01' });
  assert.deepEqual(copy(clientPickerRows([], [], ['9'])), []);
  assert.deepEqual(copy(clientPickerRows(undefined, undefined, undefined)), []);
});

test('defaultStatusForDate and chipHours (pure)', () => {
  const { defaultStatusForDate, chipHours, DURATION_CHIPS } = loadApp(['app-core', 'sessions']);
  for (const [date, expected] of [[TODAY, 'completed'], ['2026-03-09', 'completed'], ['2020-01-01', 'completed'], ['2026-03-11', 'scheduled'],
    ['2027-01-01', 'scheduled'], ['', 'completed'], [null, 'completed'], ['next week', 'completed']])
    assert.equal(defaultStatusForDate(date, TODAY), expected, String(date));
  assert.deepEqual(copy(DURATION_CHIPS), [30, 45, 60, 90, 120]);
  assert.deepEqual(copy(DURATION_CHIPS).map(m => chipHours(m)), [0.5, 0.75, 1, 1.5, 2]);
  assert.deepEqual(['45', 45].map(m => chipHours(m)), [0.75, 0.75]);
  for (const bad of [0, 15, 61, -30, 'abc', null, undefined]) assert.equal(chipHours(bad), null, String(bad));
});

test('flow: Add -> tap client -> Repeat last -> Save is 4 actions and saves as Completed', async () => {
  const ui = await bootUi();
  await ui.click('add-session');                                                    // 1
  assert.equal(ui.field('session-status').value, 'completed', 'today defaults to Completed');
  assert.equal(ui.field('session-date').value, TODAY);
  assert.match(ui.field('session-clients').innerHTML, /data-action="toggle-session-client" data-id="c1" aria-pressed="false"/);
  assert.doesNotMatch(ui.field('session-clients').innerHTML, /<option|<select/);
  await ui.click('toggle-session-client', { 'data-id': 'c1' });                     // 2
  assert.equal(ui.field('repeat-last-banner').hidden, false);
  await ui.click('repeat-last-session');                                            // 3  (last c1 session in the fixture: a2, 1.5 h, $150)
  await ui.click('save-session');                                                   // 4
  await ui.waitFor(() => lastSaved(ui).date === TODAY, 'the session to save');
  const saved = lastSaved(ui);
  assert.equal(saved.status, 'completed'); assert.deepEqual(saved.clientIds, ['c1']);
  assert.equal(saved.duration, 1.5); assert.equal(saved.amount, 150); assert.equal(saved.paid, false);
  assert.ok(ui.disk().finalized[saved.id], 'a completed session locks on save, as before');
});

test('flow: siblings are two taps (no Ctrl), stored in tap order with each client\'s own id type', async () => {
  const data = rawFixture();
  data.clients.push({ id: 501, firstName: 'Client', lastName: 'Epsilon', rate: 40, status: 'active', familyGroup: 'Family Test-1' });
  const ui = await bootUi({ data });
  await ui.click('add-session');
  await ui.click('toggle-session-client', { 'data-id': '501' });
  await ui.click('toggle-session-client', { 'data-id': 'c2' });
  assert.deepEqual(copy(ui.App.getSelectedSessionClientIds()), ['501', 'c2']);
  assert.equal(ui.field('session-amount').placeholder, '$50.00 (auto)', 'average of 40 and 60 for 1 h');
  await ui.click('toggle-session-client', { 'data-id': 'c2' });                     // tap again = off
  await ui.click('toggle-session-client', { 'data-id': 'c2' });
  await ui.click('save-session');
  await ui.waitFor(() => lastSaved(ui).date === TODAY, 'the session to save');
  assert.deepEqual(lastSaved(ui).clientIds, [501, 'c2'], 'numeric client id stays a number; string id stays a string');
  assert.equal(lastSaved(ui).amount, 50);
});

test('flow: a future date flips the default to Scheduled, back again for today, and a hand-picked status sticks', async () => {
  const ui = await bootUi();
  await ui.click('add-session');
  await ui.change('session-date', '2026-04-01');
  assert.equal(ui.field('session-status').value, 'scheduled');
  await ui.change('session-date', '2026-03-09');
  assert.equal(ui.field('session-status').value, 'completed');
  await ui.change('session-status', 'no-show');                                     // owner overrides
  await ui.change('session-date', '2026-04-02');
  assert.equal(ui.field('session-status').value, 'no-show', 'override survives a date change');
  // A fresh form starts following the date again; a prefilled future date opens as Scheduled.
  ui.App.openSessionForm(undefined, '2026-05-05');
  assert.equal(ui.field('session-status').value, 'scheduled');
  await ui.click('toggle-session-client', { 'data-id': 'c3' });
  await ui.click('save-session');
  await ui.waitFor(() => lastSaved(ui).date === '2026-05-05', 'the session to save');
  assert.equal(lastSaved(ui).status, 'scheduled'); assert.equal(ui.disk().finalized[lastSaved(ui).id], undefined, 'scheduled sessions stay editable');
});

test('flow: editing never auto-changes status, even when the date moves', async () => {
  const ui = await bootUi();
  await ui.click('edit-session', { 'data-id': 'a5' });                              // archived, scheduled, future
  assert.equal(ui.field('session-status').value, 'scheduled');
  await ui.change('session-date', '2026-01-01');
  assert.equal(ui.field('session-status').value, 'scheduled', 'an existing session keeps its status');
});

test('flow: duration chips 30/45/60/90/120 write decimal hours into the existing field and are stored as such', async () => {
  const ui = await bootUi();
  await ui.click('add-session');
  for (const [minutes, hours] of [['30', 0.5], ['45', 0.75], ['60', 1], ['90', 1.5], ['120', 2]]) {
    await ui.click('set-session-duration', { 'data-minutes': minutes });
    assert.equal(ui.field('session-duration').value, hours);
  }
  await ui.click('set-session-duration', { 'data-minutes': '77' });                 // not a chip: ignored
  assert.equal(ui.field('session-duration').value, 2);
  await ui.click('set-session-duration', { 'data-minutes': '45' });
  await ui.click('toggle-session-client', { 'data-id': 'c3' });                     // fabricated rate 80
  assert.equal(ui.field('session-amount').placeholder, '$60.00 (auto)');
  await ui.click('save-session');
  await ui.waitFor(() => lastSaved(ui).date === TODAY, 'the session to save');
  assert.equal(lastSaved(ui).duration, 0.75); assert.equal(lastSaved(ui).amount, 60);
});

test('invariant: editing a LOCKED row still lists that session\'s inactive client, and re-saving records no client change', async () => {
  const ui = await bootUi();
  await command(ui.App.repository, 'client.retire', { id: 'c3' });
  ui.App.refreshReadViews();
  await ui.click('add-session');
  assert.doesNotMatch(ui.field('session-clients').innerHTML, /Client Gamma/, 'a retired client is not offered for NEW sessions');
  await ui.click('edit-session', { 'data-id': 'a3' });                              // archived + locked, client c3 now inactive
  assert.match(ui.field('session-clients').innerHTML, /data-id="c3" aria-pressed="true"[^]*Client Gamma <em class="client-pick-inactive">\(inactive\)<\/em>/);
  assert.deepEqual(copy(ui.App.getSelectedSessionClientIds()), ['c3']);
  const events = ui.disk().events.length;
  ui.field('session-notes').value = 'fabricated note';
  await ui.click('save-session');
  await ui.waitFor(() => ui.disk().events.length === events + 1, 'the correction to save');
  assert.deepEqual(copy(ui.disk().events.at(-1).fields), { notes: 'fabricated note' });
  // Multi-client locked row: stored order [c1, c2] is kept, so an untouched picker never looks like a change.
  await ui.click('edit-session', { 'data-id': 'a2' });
  assert.deepEqual(copy(ui.App.getSelectedSessionClientIds()), ['c1', 'c2']);
  ui.field('session-notes').value = 'second fabricated note';
  await ui.click('save-session');
  await ui.waitFor(() => ui.disk().events.length === events + 2, 'the second correction to save');
  assert.deepEqual(copy(ui.disk().events.at(-1).fields), { notes: 'second fabricated note' });
});

test('validation: saving with no client picked is refused and nothing is written', async () => {
  const ui = await bootUi(), before = JSON.stringify(ui.disk());
  await ui.click('add-session');
  await ui.click('save-session');
  assert.equal(JSON.stringify(ui.disk()), before);
});

test('static: the multi-select and its Ctrl/Cmd hint are gone; chips and handlers are wired', () => {
  const html = readSource('index.html'), ui = readSource('js/ui.js'), sessions = readSource('js/sessions.js');
  assert.doesNotMatch(html, /<select id="session-clients"|Hold Ctrl/);
  assert.match(html, /<div id="session-clients" class="client-picker" role="group" aria-labelledby="session-clients-label"/);
  assert.deepEqual([...html.matchAll(/data-action="set-session-duration" data-minutes="(\d+)"/g)].map(m => Number(m[1])), [30, 45, 60, 90, 120]);
  assert.equal((html.match(/class="duration-chip"/g) || []).length, 5);
  assert.ok([...html.matchAll(/<button type="(\w+)" class="duration-chip"/g)].every(m => m[1] === 'button'), 'chips must not submit the form');
  for (const needle of ["case 'toggle-session-client': App.toggleSessionClient(target); break;", "case 'set-session-duration':",
    "if (target.id === 'session-date') { App.applySmartStatus(); return; }", "if (target.id === 'session-status') { App.markStatusTouched(); return; }"])
    assert.ok(ui.includes(needle), needle);
  assert.doesNotMatch(sessions, /selectedOptions|\.options\b/, 'no code may still read the old <select>');
  assert.doesNotMatch(sessions, /\$\('session-status'\)\.value = 'scheduled'/, 'the hard-coded Scheduled default is gone');
});
