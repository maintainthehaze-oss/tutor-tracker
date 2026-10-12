'use strict';
// Slice A (2026-10-11): "Log a week" grid + "Repeat last week".
// Part 1: repository command session.saveMany (ONE revision for N new rows, all-or-nothing, insert-only).
// Part 2: the pure signature / week-planning model in protected/js/signatures.js.
// Fabricated data only; this repo is public. Unit-level evidence, not what a person sees on screen.
const test = require('node:test');
const assert = require('node:assert/strict');
const { activate, loadApp, command, readSource } = require('./helpers/harness.cjs');
const { MODULES, rawFixture, newSession } = require('./helpers/money-fixture.cjs');

const copy = x => JSON.parse(JSON.stringify(x));
const six = () => [
  newSession('w1', { clientIds: ['c1'], date: '2026-03-02', amount: 100, status: 'completed' }),
  newSession('w2', { clientIds: ['c1', 'c2'], date: '2026-03-03', duration: 1.5, amount: 150, status: 'completed' }),
  newSession('w3', { clientIds: ['c3'], date: '2026-03-04', amount: 80, status: 'completed' }),
  newSession('w4', { clientIds: ['c4'], date: '2026-03-05', duration: 0.83, amount: 51.88, status: 'completed' }),
  newSession('w5', { clientIds: ['c2'], date: '2026-03-12', amount: 60, status: 'scheduled' }),
  newSession('w6', { clientIds: ['c3'], date: '2026-03-13', duration: 2, amount: 160, status: 'scheduled' }),
];

async function repo() {
  const { App, disk } = await activate(MODULES, rawFixture());
  return { App, repo: App.repository, disk };
}

test('saveMany: six new rows land in ONE revision, completed ones finalized, scheduled ones not', async () => {
  const { repo: r, disk } = await repo();
  const before = r.revision, count = disk().working.sessions.length;
  assert.equal(await command(r, 'session.saveMany', { records: six() }), true);
  assert.equal(r.revision, before + 1, 'exactly one revision for the whole batch');
  const stored = disk();
  assert.equal(stored.working.sessions.length, count + 6);
  for (const id of ['w1', 'w2', 'w3', 'w4']) assert(Object.hasOwn(stored.finalized, id), id + ' finalized');
  for (const id of ['w5', 'w6']) assert(!Object.hasOwn(stored.finalized, id), id + ' stays editable');
  const w2 = stored.working.sessions.find(s => s.id === 'w2');
  assert.deepEqual([w2.companyAmount, w2.companySplit, w2.amount, w2.duration], [0, 0, 150, 1.5]);
  assert.equal(r.isProtectedSession('w1'), true);
  assert.equal(r.isProtectedSession('w5'), false);
  assert.equal(stored.events.length, disk().events.length, 'no events written');
});

for (const [name, mutate, message] of [
  ['an invalid record (no clients)', rows => { rows[3].clientIds = []; }, /Session clients required/],
  ['an invalid record (bad status)', rows => { rows[5].status = 'done'; }, /Invalid session status/],
  ['an invalid record (zero duration)', rows => { rows[0].duration = 0; }, /Invalid duration or amount/],
  ['an existing id (insert-only)', rows => { rows[2].id = 'a1'; }, /Session already exists: a1/],
  ['a locked existing id (insert-only)', rows => { rows[2].id = 'n1'; }, /Session already exists: n1/],
  ['a duplicate id inside the batch', rows => { rows[4].id = 'w1'; }, /Duplicate session in batch: w1/],
  ['a record without an id', rows => { delete rows[1].id; }, /Invalid record identity/],
  ['a non-object record', rows => { rows[0] = 'w1'; }, /Record required/],
]) test('saveMany is all-or-nothing: ' + name + ' writes nothing', async () => {
  const { App, repo: r, disk } = await repo();
  await command(r, 'session.save', { record: newSession('n1', { clientIds: ['c1'], date: '2026-03-01', amount: 100, status: 'completed' }) });
  const before = copy(disk()), revision = r.revision;
  const rows = six(); mutate(rows);
  await assert.rejects(command(r, 'session.saveMany', { records: rows }), message);
  assert.equal(r.revision, revision, 'revision unchanged');
  assert.deepEqual(disk(), before, 'store byte-identical');
  assert.equal(App.repository.read().sessions.some(s => String(s.id).startsWith('w')), false);
});

test('saveMany refuses an empty batch, a stale revision and maintenance mode', async () => {
  const { repo: r, disk } = await repo();
  const before = copy(disk());
  for (const payload of [{}, { records: [] }, { records: 'w1' }]) await assert.rejects(command(r, 'session.saveMany', payload), /Sessions required/);
  await assert.rejects(r.execute('session.saveMany', { records: six() }, r.revision - 1), /Stale action/);
  await command(r, 'maintenance.set', { enabled: true });
  await assert.rejects(command(r, 'session.saveMany', { records: six() }), /Maintenance mode/);
  await command(r, 'maintenance.set', { enabled: false });
  assert.deepEqual(disk().working, before.working);
});

test('saveMany: the caller cannot alter the proposal after calling (clone before queue)', async () => {
  const { repo: r, disk } = await repo();
  const rows = six();
  const pending = command(r, 'session.saveMany', { records: rows });
  rows[0].amount = 999999; rows.push(newSession('w7', { clientIds: ['c1'], date: '2026-03-06', amount: 1, status: 'completed' }));
  await pending;
  const stored = disk().working.sessions;
  assert.equal(stored.find(s => s.id === 'w1').amount, 100);
  assert.equal(stored.some(s => s.id === 'w7'), false);
});

test('repository source: saveMany is one added case; the default branch anchor is untouched', () => {
  const source = readSource('js/repository.js');
  assert.equal(source.split("case 'session.saveMany': {").length, 2);
  assert.equal(source.split("default: throw Error('Unavailable command: '+name);").length, 2);
});

/* ---------------------------------------------------------------- pure model ---------------------------------------------------------------- */

const MODEL = ['app-core', 'sessions', 'session-form', 'signatures'];
const CLIENTS = [
  { id: 'c1', firstName: 'Client', lastName: 'Alpha', rate: 100, status: 'active' },
  { id: 'c2', firstName: 'Client', lastName: 'Beta', rate: 60, status: 'active' },
  { id: 3, firstName: 'Client', lastName: 'Gamma', rate: 80, status: 'active', address: '200 Sample Avenue' },
  { id: 'c4', firstName: 'Client', lastName: 'Retired', rate: 50, status: 'inactive' },
];
// Week of Mon 2026-03-02 .. Sun 2026-03-08 is "last week" relative to the grid week Mon 2026-03-09.
const SESSIONS = [
  { id: 1, clientIds: ['c1', 'c2'], date: '2026-03-03', time: '16:00', duration: 2, amount: 300, type: 'in-person', status: 'completed' },  // Tue
  { id: 2, clientIds: ['c2', 'c1'], date: '2026-02-24', time: '16:00', duration: 2, amount: 300, type: 'in-person', status: 'completed' },  // Tue
  { id: 3, clientIds: ['c1', 'c2'], date: '2026-02-26', time: '17:00', duration: 2, amount: 300, type: 'in-person', status: 'completed' },  // Thu
  { id: 4, clientIds: [3], date: '2026-03-04', time: '10:00', duration: 1, amount: 80, type: 'online', status: 'completed' },               // Wed
  { id: 5, clientIds: [3], date: '2026-03-06', time: '10:00', duration: 1, amount: 80, type: 'online', status: 'cancelled' },               // Fri: not usual
  { id: 6, clientIds: ['c1'], date: '2026-03-07', time: '', duration: 1, amount: 100, type: 'in-person', status: 'scheduled' },             // Sat
  { id: 7, clientIds: ['c4'], date: '2025-12-01', time: '', duration: 1, amount: 50, type: 'in-person', status: 'completed' },               // old, inactive
  { id: 8, clientIds: ['ghost'], date: '2026-03-05', duration: 1, amount: 10, status: 'completed' },                                         // unknown client
  { id: 9, clientIds: [3], date: '2026-03-11', time: '10:00', duration: 1, amount: 80, type: 'online', status: 'scheduled' },               // next Wed: already logged
];

test('sessionSignatures: groups by (clients, duration, amount, type), most frequent first, with weekday spread and usual time', () => {
  const { sessionSignatures } = loadApp(MODEL);
  const sigs = copy(sessionSignatures(SESSIONS, CLIENTS));
  assert.deepEqual(sigs.map(s => [s.key, s.count, s.lastDate]), [['c1+c2', 3, '2026-03-03'], ['3', 2, '2026-03-11'], ['c1', 1, '2026-03-07'], ['c4', 1, '2025-12-01']]);
  assert.deepEqual(sigs[0], { key: 'c1+c2', clientIds: ['c1', 'c2'], duration: 2, amount: 300, type: 'in-person', time: '16:00', count: 3, lastDate: '2026-03-03', weekdays: [0, 2, 0, 1, 0, 0, 0] });
  assert.deepEqual(copy(sessionSignatures(SESSIONS, CLIENTS, '2026-03-01')).map(s => s.key), ['3', 'c1', 'c1+c2'], 'since window: Gamma twice, then Alpha (03-07) before the trio (03-03): most recent wins a tie');
  assert.deepEqual(copy(sessionSignatures([], CLIENTS)), []);
  assert.deepEqual(copy(sessionSignatures(undefined, undefined)), []);
});

test('weekPlan calendar helpers: Monday-first weeks, time-zone free', () => {
  const { weekPlan: W } = loadApp(MODEL);
  assert.equal(W.weekStart('2026-03-11'), '2026-03-09');
  assert.equal(W.weekStart('2026-03-09'), '2026-03-09');
  assert.equal(W.weekStart('2026-03-08'), '2026-03-02', 'Sunday belongs to the week that started the Monday before');
  assert.deepEqual(copy(W.weekDates('2026-03-09')), ['2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14', '2026-03-15']);
  assert.deepEqual(['2026-03-09', '2026-03-15', '2026-12-31'].map(W.weekdayOf), [0, 6, 3]);
  assert.deepEqual(['2026-03-09', '2026-03-15'].map(d => W.isoOf(W.dayNum(d))), ['2026-03-09', '2026-03-15']);
  assert.deepEqual(copy(W.WEEKDAY_LABELS), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.equal(W.signatureKey(['c2', 'c1', 'c2']), 'c1+c2');
  assert.equal(W.signatureKey([3, '3']), '3');
});

test('weekRows: active singles in the given order, then combos seen in the window, then extra keys; prefill from the usual signature or rate x duration', () => {
  const { weekPlan: W } = loadApp(MODEL);
  const active = CLIENTS.filter(c => c.status === 'active');
  const rows = copy(W.weekRows(SESSIONS, active, CLIENTS, '2026-01-10', ['c1+c4', 'c1+ghost', 'c2'], 1));
  assert.deepEqual(rows.map(r => [r.key, r.combo, r.label]), [
    ['c1', false, 'Client Alpha'], ['c2', false, 'Client Beta'], ['3', false, 'Client Gamma'], ['c1+c2', true, 'Client Alpha + Client Beta'], ['c1+c4', true, 'Client Alpha + Client Retired']]);
  assert.deepEqual(rows[3].prefill, { duration: 2, amount: 300, type: 'in-person', time: '16:00' }, 'combo prefill = usual signature');
  assert.deepEqual(rows[2].prefill, { duration: 1, amount: 80, type: 'online', time: '10:00' });
  assert.deepEqual(rows[1].prefill, { duration: 1, amount: 60, type: 'in-person', time: '' }, 'no signature: rate x default duration');
  assert.deepEqual(rows[4].prefill, { duration: 1, amount: 75, type: 'in-person', time: '' }, 'extra combo with no history: average rate (100+50)/2 x 1 h');
  assert.equal(rows[0].usual.key, 'c1');
  const narrow = copy(W.weekRows(SESSIONS, active, CLIENTS, '2026-03-04', [], 1.5));
  assert.deepEqual(narrow.map(r => r.key), ['c1', 'c2', '3'], 'combo outside the window is not a row');
  assert.deepEqual(narrow[0].prefill, { duration: 1, amount: 100, type: 'in-person', time: '' }, 'single still finds its all-time usual');
  assert.equal(W.rateAmount(['c1', 'c2'], { c1: CLIENTS[0], c2: CLIENTS[1] }, 0.83), 66.4, '80 x 0.83 = 66.4 in cents');
  assert.equal(W.rateAmount(['c1'], { c1: { rate: 62.5 } }, 0.83), 51.88);
});

test('loggedOn and cellState: logged beats ticked, a ticked combo blocks its members that day', () => {
  const { weekPlan: W } = loadApp(MODEL);
  assert.equal(W.loggedOn(SESSIONS, '2026-03-11', ['3']), true);
  assert.equal(W.loggedOn(SESSIONS, '2026-03-11', [3]), true, 'id type does not matter');
  assert.equal(W.loggedOn(SESSIONS, '2026-03-11', ['c1']), false);
  assert.equal(W.loggedOn(SESSIONS, '2026-03-03', ['c2']), true, 'a member of a shared session counts');
  const rows = { c1: { key: 'c1', clientIds: ['c1'] }, c2: { key: 'c2', clientIds: ['c2'] }, g: { key: '3', clientIds: ['3'] }, trio: { key: 'c1+c2', clientIds: ['c1', 'c2'] } };
  const ticks = [{ key: 'c1+c2', clientIds: ['c1', 'c2'], date: '2026-03-10' }];
  assert.equal(W.cellState(rows.trio, '2026-03-10', SESSIONS, ticks), 'ticked');
  assert.equal(W.cellState(rows.c1, '2026-03-10', SESSIONS, ticks), 'blocked');
  assert.equal(W.cellState(rows.c2, '2026-03-10', SESSIONS, ticks), 'blocked');
  assert.equal(W.cellState(rows.g, '2026-03-10', SESSIONS, ticks), 'open');
  assert.equal(W.cellState(rows.g, '2026-03-11', SESSIONS, ticks), 'logged');
  assert.equal(W.cellState(rows.trio, '2026-03-10', SESSIONS, [{ key: 'c1', clientIds: ['c1'], date: '2026-03-10' }]), 'blocked', 'a ticked single blocks the combo');
  assert.equal(W.cellState(rows.c1, '2026-03-10', SESSIONS, []), 'open');
});

test('repeatLastWeek: copies last week forward 7 days, one tick per client set and weekday, skipping cancelled and already-logged targets', () => {
  const { weekPlan: W } = loadApp(MODEL);
  const dates = W.weekDates('2026-03-09');
  const ticks = copy(W.repeatLastWeek(SESSIONS, dates, CLIENTS));
  assert.deepEqual(ticks, [
    { key: 'c1+c2', clientIds: ['c1', 'c2'], date: '2026-03-10', duration: 2, amount: 300, type: 'in-person', time: '16:00' },
    { key: 'c1', clientIds: ['c1'], date: '2026-03-14', duration: 1, amount: 100, type: 'in-person', time: '' },
  ], 'Wed Gamma skipped (already logged next Wed), Fri Gamma skipped (cancelled), unknown client row ignored');
});

test('repeatLastWeek: a scheduled row last week still repeats; two rows for one set on one day give one cell', () => {
  const { weekPlan: W } = loadApp(MODEL);
  const sessions = SESSIONS;
  const ticks = copy(W.repeatLastWeek(sessions, W.weekDates('2026-03-09'), CLIENTS));
  assert.deepEqual(ticks.map(t => t.key + '@' + t.date), ['c1+c2@2026-03-10', 'c1@2026-03-14']);
  const twice = sessions.concat([{ id: 10, clientIds: ['c1', 'c2'], date: '2026-03-03', time: '18:00', duration: 1, amount: 150, type: 'online', status: 'completed' }]);
  assert.deepEqual(copy(W.repeatLastWeek(twice, W.weekDates('2026-03-09'), CLIENTS)).filter(t => t.date === '2026-03-10').length, 1, 'two sessions same set same day -> one cell (the earlier one)');
  assert.deepEqual(copy(W.repeatLastWeek([], W.weekDates('2026-03-09'), CLIENTS)), []);
});

test('buildRecords: the exact session.save shape, cents, status from the date, mileage 0, address of the first client, own id types kept', () => {
  const { weekPlan: W } = loadApp(MODEL);
  let n = 0;
  const ticks = [
    { key: 'c1+c2', clientIds: ['c1', 'c2'], date: '2026-03-10', duration: 2, amount: 300, type: 'in-person', time: '16:00' },
    { key: '3', clientIds: ['3'], date: '2026-03-12', duration: 0.83, amount: 66.404, type: 'online', time: '' },
  ];
  const records = copy(W.buildRecords(ticks, CLIENTS, '2026-03-11', () => 'id-' + (++n), '2026-03-11T12:00:00.000Z'));
  assert.deepEqual(records[0], { id: 'id-1', date: '2026-03-10', time: '16:00', clientIds: ['c1', 'c2'], type: 'in-person', duration: 2, amount: 300,
    paid: false, payment: 'unpaid', paymentDate: null, status: 'completed', mileage: 0, mileageDetails: '', mileageCalculated: false, mileageManual: false,
    address: '', notes: '', recurring: null, createdAt: '2026-03-11T12:00:00.000Z', updatedAt: '2026-03-11T12:00:00.000Z' });
  assert.deepEqual([records[1].status, records[1].amount, records[1].clientIds, records[1].address], ['scheduled', 66.4, [3], '200 Sample Avenue'], 'future = scheduled; numeric client id kept as a number');
});

test('signatures.js is pure: no App.state, no DOM, no storage, no commands', () => {
  const source = readSource('js/signatures.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const banned of ['App.state', 'document.', 'localStorage', 'indexedDB', 'runCommand', 'repository', 'innerHTML', 'fetch(']) assert.equal(source.includes(banned), false, banned);
});
