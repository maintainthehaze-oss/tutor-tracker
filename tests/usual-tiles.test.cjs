'use strict';
// Slice C (2026-10-11): "Usual" quick-pick tiles on the session form.
// Pure ranking in protected/js/signatures.js (usualTiles / usualWeekdays), the label in session-form.js, and the
// Add -> tap tile -> Save flow driven through the real ui.js click delegation with a fake DOM and a fake clock.
// Fabricated data only; this repo is public. Unit-level evidence, not what a person sees on screen.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, readSource } = require('./helpers/harness.cjs');
const { bootUi } = require('./helpers/ui-app.cjs');
const { rawFixture } = require('./helpers/money-fixture.cjs');

const copy = x => JSON.parse(JSON.stringify(x));
const MODEL = ['app-core', 'sessions', 'session-form', 'signatures'];
const TODAY = '2026-03-10';                       // bootUi's fake clock starts at 2026-03-10 12:00 local; 90 days back = 2025-12-10
const lastSaved = ui => ui.disk().working.sessions.at(-1);

const CLIENTS = [
  { id: 'c1', firstName: 'Client', lastName: 'Alpha', rate: 100, status: 'active' },
  { id: 'c2', firstName: 'Client', lastName: 'Beta', rate: 60, status: 'active' },
  { id: 3, firstName: 'Client', lastName: 'Gamma', rate: 80, status: 'inactive' },
];
const row = (id, clientIds, date, extra = {}) => ({ id, clientIds, date, time: '16:00', duration: 1, amount: 100, type: 'in-person', status: 'completed', ...extra });
const SESSIONS = [
  row(1, ['c1'], '2026-02-01'), row(2, ['c1'], '2026-02-08'),                                                     // X: Alpha 1h $100, twice in the window
  row(3, ['c2'], '2025-01-06', { amount: 60 }), row(4, ['c2'], '2025-02-03', { amount: 60 }), row(5, ['c2'], '2025-03-03', { amount: 60 }),
  row(6, ['c2'], '2025-04-07', { amount: 60 }), row(7, ['c2'], '2025-05-05', { amount: 60 }),                     // Y: Beta 1h $60, five times, all before the window
  row(8, ['c2', 'c1'], '2026-03-03', { duration: 2, amount: 300 }),                                               // Z: Alpha+Beta 2h $300, once, in the window (a Tuesday)
  row(9, [3], '2026-02-02'), row(10, [3], '2026-02-09'), row(11, [3], '2026-02-16'),                              // W: Gamma, inactive -> never a tile
  row(12, ['c1'], '2025-06-01'),                                                                                  // X again, before the window: merges into X all-time, not a new tile
  row(13, ['c1'], '2026-03-05', { status: 'cancelled' }), row(14, ['c1'], '2026-03-06', { status: 'no-show' }),  // not what he usually does
];

test('usualWeekdays (pure): days with at least half the busiest day, Mon..Sun; none when more than three qualify', () => {
  const { weekPlan } = loadApp(MODEL);
  const w = (...a) => copy(weekPlan.usualWeekdays(...a));
  assert.deepEqual(w([0, 2, 0, 1, 0, 0, 0]), ['Tue', 'Thu']);
  assert.deepEqual(w([0, 4, 0, 1, 0, 0, 0]), ['Tue'], 'Thu once against Tue four times is noise');
  assert.deepEqual(w([3, 0, 0, 0, 0, 0, 3]), ['Mon', 'Sun']);
  assert.deepEqual(w([1, 1, 1, 1, 0, 0, 0]), [], 'four days = no pattern worth stating');
  assert.deepEqual(w([0, 0, 0, 0, 0, 0, 0]), []);
  assert.deepEqual(w(undefined), []);
});

test('usualTiles (pure): window frequency first, then all time; inactive members excluded; no duplicates', () => {
  const { usualTiles } = loadApp(MODEL);
  const tiles = copy(usualTiles(SESSIONS, CLIENTS, TODAY));
  assert.deepEqual(tiles.map(t => [t.key, t.duration, t.amount, t.count]), [['c1', 1, 100, 2], ['c1+c2', 2, 300, 1], ['c2', 1, 60, 5]]);
  assert.deepEqual(tiles[1], { key: 'c1+c2', clientIds: ['c1', 'c2'], duration: 2, amount: 300, type: 'in-person', time: '16:00', count: 1, lastDate: '2026-03-03', weekdays: ['Tue'] });
  assert.equal(tiles.some(t => t.clientIds.includes('3')), false, 'Gamma is inactive: not pickable, so never a tile');
  assert.deepEqual(copy(usualTiles(SESSIONS, CLIENTS, undefined)).map(t => t.key), ['c2', 'c1', 'c1+c2'], 'no date = all-time ranking only');
  assert.deepEqual(copy(usualTiles([], CLIENTS, TODAY)), []);
  assert.deepEqual(copy(usualTiles(undefined, undefined, TODAY)), []);
});

test('usualTiles (pure): at most five tiles, amounts in whole cents', () => {
  const { usualTiles } = loadApp(MODEL);
  const clients = [1, 2, 3, 4, 5, 6, 7].map(i => ({ id: 'k' + i, firstName: 'Client', lastName: 'K' + i, rate: 50 }));
  const sessions = clients.map((c, i) => row(100 + i, [c.id], '2026-03-0' + (i + 1), { amount: 51.875 }));
  const tiles = copy(usualTiles(sessions, clients, TODAY));
  assert.equal(tiles.length, 5);
  assert.deepEqual(tiles.map(t => t.key), ['k7', 'k6', 'k5', 'k4', 'k3'], 'equal counts: most recent first');
  assert.ok(tiles.every(t => t.amount === 51.88));
  assert.equal(copy(usualTiles(sessions, clients, TODAY, 2)).length, 2);
});

test('usualTileLabel (pure): names, duration, amount, type, usual days', () => {
  const { usualTileLabel, usualTiles } = loadApp(MODEL);
  const byId = {}; CLIENTS.forEach(c => { byId[String(c.id)] = c; });
  const tiles = usualTiles(SESSIONS, CLIENTS, TODAY);
  assert.equal(usualTileLabel(tiles[1], byId), 'Client Alpha + Client Beta · 2h · $300.00 · in-person · Tue');
  assert.equal(usualTileLabel({ clientIds: ['c2'], duration: 0.75, amount: 45, type: 'online', weekdays: [] }, byId), 'Client Beta · 45m · $45.00 · online');
});

/** The money fixture plus three Tuesday family sessions, so one combo is clearly "usual". */
function fixtureWithUsual() {
  const data = rawFixture();
  ['2026-02-17', '2026-02-24', '2026-03-03'].forEach((date, i) => data.sessions.push({
    id: 'u' + i, clientIds: ['c1', 'c2'], date, time: '16:00', type: 'in-person', duration: 2, amount: 300, companyAmount: 0, companySplit: 0,
    status: 'completed', paid: false, payment: 'unpaid', mileage: 0 }));
  return data;
}

test('flow: Add -> tap a Usual tile -> Save is 3 clicks and stores the tile\'s clients, duration, type, amount and time', async () => {
  const ui = await bootUi({ data: fixtureWithUsual() });
  await ui.click('add-session');                                                    // 1
  assert.equal(ui.field('session-usual-group').hidden, false, 'tiles shown on a new session');
  const html = ui.field('session-usual').innerHTML;
  assert.match(html, /^<button type="button" class="usual-tile" data-action="pick-usual" data-index="0" aria-pressed="false" title="3 sessions on file">Client Alpha \+ Client Beta · 2h · \$300\.00 · in-person · Tue<\/button>/);
  assert.ok((html.match(/data-action="pick-usual"/g) || []).length <= 5);
  await ui.click('pick-usual', { 'data-index': '0' });                             // 2
  assert.equal(ui.field('session-duration').value, 2);
  assert.equal(ui.field('session-amount').value, 300);
  assert.equal(ui.field('session-time').value, '16:00');
  assert.equal(ui.field('session-type').value, 'in-person');
  assert.match(ui.field('session-clients').innerHTML, /data-id="c1" aria-pressed="true"/);
  assert.match(ui.field('session-clients').innerHTML, /data-id="c2" aria-pressed="true"/);
  assert.equal(ui.field('session-date').value, TODAY, 'the date is the form\'s, not the tile\'s');
  await ui.click('save-session');                                                   // 3
  await ui.waitFor(() => lastSaved(ui).date === TODAY, 'the session to save');
  const saved = lastSaved(ui);
  assert.deepEqual(saved.clientIds, ['c1', 'c2']);
  assert.deepEqual([saved.duration, saved.amount, saved.time, saved.type, saved.status, saved.paid, saved.mileage], [2, 300, '16:00', 'in-person', 'completed', false, 0]);
});

test('flow: tiles are hidden while editing, and a tile picked on a bad index changes nothing', async () => {
  const ui = await bootUi({ data: fixtureWithUsual() });
  await ui.click('edit-session', { 'data-id': 'a6' });
  assert.equal(ui.field('session-usual-group').hidden, true);
  assert.equal(ui.field('session-usual').innerHTML, '');
  await ui.click('pick-usual', { 'data-index': '0' });
  assert.equal(ui.field('session-amount').value, 60, 'editing a6: untouched');
  await ui.click('close-modal');
  await ui.click('add-session');
  assert.equal(ui.field('session-usual-group').hidden, false);
  const before = [ui.field('session-amount').value, ui.field('session-duration').value, ui.field('session-clients').innerHTML];  // the fake DOM's form.reset() is a no-op
  await ui.click('pick-usual', { 'data-index': '99' });
  assert.deepEqual([ui.field('session-amount').value, ui.field('session-duration').value, ui.field('session-clients').innerHTML], before, 'no such tile: untouched');
});

test('flow: no usual sessions yet -> the group stays hidden; "Repeat last" still works alongside the tiles', async () => {
  const empty = rawFixture(); empty.sessions = [];
  const ui = await bootUi({ data: empty });
  await ui.click('add-session');
  assert.equal(ui.field('session-usual-group').hidden, true);
  const ui2 = await bootUi({ data: fixtureWithUsual() });
  await ui2.click('add-session');
  await ui2.click('toggle-session-client', { 'data-id': 'c1' });
  assert.equal(ui2.field('repeat-last-banner').hidden, false, 'Repeat last stays');
});

test('source: one click case in ui.js, the Usual group sits above the client picker, signatures.js stays pure', () => {
  assert.equal(readSource('js/ui.js').split("case 'pick-usual':").length, 2);
  const html = readSource('index.html');
  assert.ok(html.indexOf('id="session-usual-group"') > 0 && html.indexOf('id="session-usual-group"') < html.indexOf('id="session-clients"'));
  const source = readSource('js/signatures.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const banned of ['App.state', 'document.', 'localStorage', 'runCommand', 'showToast']) assert.equal(source.includes(banned), false, banned);
});
