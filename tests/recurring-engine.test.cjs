'use strict';
// Weekly recurring slots, slice 2: the PURE planner (protected/js/recurring.js). It is inert: nothing in the
// app calls it yet. FABRICATED DATA ONLY: this repository is public. Today is 2026-09-19, a Saturday.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readSource, root } = require('./helpers/harness.cjs');
const { analyzeSource } = require('./slice1/static-guard.cjs');
const { TODAY, SLOT, ADDRESS, engine, slot, clients, applyPlan, tzReport } = require('./helpers/recurring-scenarios.cjs');

const R = engine();
const copy = x => JSON.parse(JSON.stringify(x));
const freeze = x => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
/** Inputs are deep-frozen on every call: any write to an argument throws, so every test also proves purity. */
const plan = (c, s, today = TODAY, ...rest) => copy(R.materializeRecurring(freeze(copy(c)), freeze(copy(s)), today, ...rest));
const NOTHING = { create: [], removeIds: [], clients: [], skipped: [], gaps: [] };
const id = (date, slotId = SLOT) => 'rec:' + slotId + ':' + date;
const TUESDAYS = ['2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13'];
const edit = (rows, date, fields, slotId = SLOT) => rows.map(s => (s.id === id(date, slotId) ? { ...s, ...fields } : s));
/** State after the first pass has been written. */
function planned(slots = [slot()], overrides) {
  const first = plan(clients(slots, overrides), []);
  return { first, ...applyPlan(first, clients(slots, overrides), []) };
}

test('Tuesday 16:00 weekly slot: exactly four rows, deterministic ids, saveSession-shaped records, watermark at the window end', () => {
  const out = plan(clients(), []);
  assert.deepEqual(out.create.map(s => [s.id, s.date]), TUESDAYS.map(d => [id(d), d]));
  assert.deepEqual(out.create[0], {
    id: 'rec:slot-tue:2026-09-22', date: '2026-09-22', time: '16:00', clientIds: ['c1'], type: 'in-person', duration: 1, amount: 100,
    paid: false, payment: 'unpaid', paymentDate: null, status: 'scheduled', mileage: 0, mileageDetails: '', mileageCalculated: false, mileageManual: false,
    address: ADDRESS, notes: '', recurring: { slotId: SLOT, date: '2026-09-22', stamp: '16:00|1|100|in-person|c1|' + ADDRESS } });
  assert.deepEqual(Object.keys(out.create[0]), ['id', 'date', 'time', 'clientIds', 'type', 'duration', 'amount', 'paid', 'payment', 'paymentDate', 'status',
    'mileage', 'mileageDetails', 'mileageCalculated', 'mileageManual', 'address', 'notes', 'recurring'], 'same field order as saveSession; the writer adds the timestamps');
  assert.deepEqual(out.clients, [{ id: 'c1', slots: [slot({ through: '2026-10-16' })] }]);
  assert.deepEqual([out.removeIds, out.skipped, out.gaps], [[], [], []]);
  out.create.forEach(s => assert.equal(R.isPristine(s), true));
  // A slot that starts beyond the window plans nothing and leaves no mark.
  assert.deepEqual(plan(clients([slot({ anchor: '2026-10-20' })]), []), NOTHING);
  // A custom horizon: 7 days reaches 09-25, so one row.
  assert.deepEqual(plan(clients(), [], TODAY, 7).create.map(s => s.date), ['2026-09-22']);
});

test('idempotent: feeding the plan back in plans nothing; quiet days plan nothing; the next Tuesday entering the window plans one row', () => {
  const state = planned();
  assert.deepEqual(plan(state.clients, state.sessions), NOTHING);
  for (const quietDay of ['2026-09-20', '2026-09-21', '2026-09-22']) assert.deepEqual(plan(state.clients, state.sessions, quietDay), NOTHING, quietDay);
  const next = plan(state.clients, state.sessions, '2026-09-23'); // window now ends on Tuesday 10-20
  assert.deepEqual(next.create.map(s => s.id), [id('2026-10-20')]);
  assert.deepEqual(next.clients, [{ id: 'c1', slots: [slot({ through: '2026-10-20' })] }]);
  assert.deepEqual([next.removeIds, next.skipped, next.gaps], [[], [], []]);
});

test('crash between writes: rows present but watermark still null gives no create, only the mark', () => {
  const state = planned();
  assert.deepEqual(plan(clients(), state.sessions), { ...NOTHING, clients: [{ id: 'c1', slots: [slot({ through: '2026-10-16' })] }] });
});

test('a row deleted (or skipped) by hand never comes back while the watermark covers it', () => {
  const state = planned(), without = state.sessions.filter(s => s.id !== id('2026-09-29'));
  assert.deepEqual(plan(state.clients, without), NOTHING);
  assert.deepEqual(plan(state.clients, []), NOTHING, 'even with every row deleted');
});

test('every 2 weeks: alternate Tuesdays only, counted from the anchor', () => {
  assert.deepEqual(plan(clients([slot({ every: 2 })]), []).create.map(s => s.date), ['2026-09-22', '2026-10-06']);
  assert.deepEqual(plan(clients([slot({ every: 2, anchor: '2026-09-08' })]), []).create.map(s => s.date), ['2026-09-22', '2026-10-06']);
  assert.deepEqual(plan(clients([slot({ every: 2, anchor: '2026-09-15' })]), []).create.map(s => s.date), ['2026-09-29', '2026-10-13']);
});

test('paused owner: nothing created, untouched future rows removed, watermark back to today; notes, moved and locked rows stay', () => {
  const state = planned();
  let rows = edit(state.sessions, '2026-09-29', { date: '2026-09-30' });                 // moved by hand (recurring.date stays 09-29)
  rows = edit(rows, '2026-10-06', { notes: 'Fabricated note: bring the workbook' });
  rows = edit(rows, '2026-10-13', { status: 'cancelled' });                                // finalized, so locked
  for (const status of ['paused', 'inactive']) {
    const paused = state.clients.map(c => (c.id === 'c1' ? { ...c, status } : c));
    const out = plan(paused, rows);
    assert.deepEqual(out, { ...NOTHING, removeIds: [id('2026-09-22')], clients: [{ id: 'c1', slots: [slot({ through: TODAY })] }] }, status);
    // Today's own row is never removed, even untouched.
    assert.deepEqual(plan(paused, rows, '2026-09-22').removeIds, []);
    // Un-pausing refills only what is missing; the rows he touched keep their ids and are left alone.
    const after = applyPlan(out, paused, rows), active = after.clients.map(c => (c.id === 'c1' ? { ...c, status: 'active' } : c));
    const refill = plan(active, after.sessions);
    assert.deepEqual(refill.create.map(s => s.id), [id('2026-09-22')]);
    assert.deepEqual(refill.clients, [{ id: 'c1', slots: [slot({ through: '2026-10-16' })] }]);
    assert.deepEqual(refill.removeIds, []);
  }
  // A deleted slot orphans its untouched future rows the same way.
  const orphaned = plan(clients([]), rows);
  assert.deepEqual(orphaned, { ...NOTHING, removeIds: [id('2026-09-22')] });
});

test('rate change 100 to 110: untouched future rows are replaced under the same id; anything he touched is left alone', () => {
  const THU = 'slot-thu', slots = [slot(), slot({ id: THU, anchor: '2026-09-24' })], state = planned(slots);
  assert.equal(state.sessions.length, 8);
  let rows = edit(state.sessions, '2026-09-29', { amount: 95 });                          // hand-edited amount
  rows = edit(rows, '2026-10-06', { notes: 'Fabricated note' });
  rows = edit(rows, '2026-10-13', { mileage: 12 });
  rows = edit(rows, '2026-10-01', { paid: true, payment: 'paid', paymentDate: '2026-09-18' }, THU);
  rows = edit(rows, '2026-10-08', { payment: 'waived' }, THU);
  const raised = state.clients.map(c => (c.id === 'c1' ? { ...c, rate: 110 } : c));
  const out = plan(raised, rows), untouched = [id('2026-09-22'), id('2026-09-24', THU), id('2026-10-15', THU)];
  assert.deepEqual(out.removeIds, untouched, 'only rows nobody touched are replaced');
  assert.deepEqual(out.create.map(s => [s.id, s.amount, s.recurring.stamp.split('|')[2]]), untouched.map(rowId => [rowId, 110, '110']));
  assert.deepEqual([out.clients, out.skipped, out.gaps], [[], [], []]);
  const after = applyPlan(out, raised, rows);
  assert.deepEqual(plan(after.clients, after.sessions), NOTHING);
  assert.equal(after.sessions.find(s => s.id === id('2026-09-29')).amount, 95);
  // An address change on the owner replaces untouched rows too; today's row is never replaced.
  const moved = state.clients.map(c => (c.id === 'c1' ? { ...c, address: '400 Invented Lane, Faketown, NY 00000' } : c));
  assert.deepEqual(plan(moved, state.sessions).create.map(s => s.address), Array(8).fill('400 Invented Lane, Faketown, NY 00000'));
  assert.deepEqual(plan(raised, state.sessions, '2026-09-22').removeIds.includes(id('2026-09-22')), false);
});

test('siblings: rates 100 and 60 for 1.5 h bill 120.00 for both; with the sibling paused it is one client at 150.00', () => {
  const shared = [slot({ duration: 1.5, with: ['c2'] })], both = plan(clients(shared), []);
  assert.deepEqual(both.create.map(s => [s.clientIds, s.amount]), TUESDAYS.map(() => [['c1', 'c2'], 120]));
  const alone = plan(clients(shared, { c2: { status: 'paused' } }), []);
  assert.deepEqual(alone.create.map(s => [s.clientIds, s.amount]), TUESDAYS.map(() => [['c1'], 150]));
  // Pausing the sibling later: the untouched rows follow (same ids, one client, new amount).
  const state = applyPlan(both, clients(shared), []), later = plan(state.clients.map(c => (c.id === 'c2' ? { ...c, status: 'paused' } : c)), state.sessions);
  assert.deepEqual(later.removeIds, TUESDAYS.map(d => id(d)));
  assert.deepEqual(later.create.map(s => [s.id, s.clientIds, s.amount]), TUESDAYS.map(d => [id(d), ['c1'], 150]));
  // Duplicates, the owner listed again and unknown ids in `with` are ignored; whole cents; a zero rate is left out of the average.
  assert.deepEqual(plan(clients([slot({ with: ['c2', 'c2', 'c1', 'nobody'] })]), []).create[0].clientIds, ['c1', 'c2']);
  assert.equal(plan(clients([slot({ duration: 0.83 })], { c1: { rate: 62.5 } }), []).create[0].amount, 51.88);
  assert.equal(plan(clients([slot({ with: ['c2'] })], { c2: { rate: 0 } }), []).create[0].amount, 100);
});

test('double-income guard: a hand-entered session for the same client that day is reported, not doubled', () => {
  const hand = { id: 'hand-1', clientIds: ['c1'], date: '2026-10-13', time: '10:00', duration: 1, amount: 100, status: 'scheduled', paid: false, payment: 'unpaid' };
  const out = plan(clients(), [hand]);
  assert.deepEqual(out.create.map(s => s.date), ['2026-09-22', '2026-09-29', '2026-10-06']);
  assert.deepEqual(out.skipped, [{ clientId: 'c1', slotId: SLOT, date: '2026-10-13', reason: 'client already has a session that day' }]);
  assert.deepEqual(out.clients, [{ id: 'c1', slots: [slot({ through: '2026-10-16' })] }]);
  const after = applyPlan(out, clients(), [hand]);
  assert.deepEqual(plan(after.clients, after.sessions), NOTHING, 'reported once; the date never fills in later');
  // A sibling-only session that day also blocks a shared slot; an unrelated client does not.
  assert.deepEqual(plan(clients([slot({ with: ['c2'] })]), [{ ...hand, clientIds: ['c2'] }]).skipped.map(x => x.date), ['2026-10-13']);
  assert.deepEqual(plan(clients(), [{ ...hand, clientIds: ['c3'] }]).skipped, []);
  // Rows of a DIFFERENT live slot are not a clash (two slots on one day; siblings sharing rows).
  const twoSlots = [slot(), slot({ id: 'slot-tue-late', time: '18:00' })], twice = plan(clients(twoSlots), []);
  assert.equal(twice.create.length, 8); assert.deepEqual(twice.skipped, []);
  const afterTwice = applyPlan(twice, clients(twoSlots), []);
  assert.deepEqual(plan(afterTwice.clients, afterTwice.sessions), NOTHING);
  // ...but a kept (hand-edited) row of a slot that no longer exists is an ordinary session, so it does block.
  const leftover = { ...twice.create.find(s => s.id === id('2026-10-13', 'slot-tue-late')), notes: 'Fabricated note' };
  assert.deepEqual(plan(clients(), [leftover]).skipped.map(x => x.date), ['2026-10-13']);
});

test('gaps: occurrences that passed while nothing was planning are reported and never back-filled', () => {
  const away = [slot({ anchor: '2026-08-04', through: '2026-08-25' })], out = plan(clients(away), []);
  assert.deepEqual(out.gaps, ['2026-09-01', '2026-09-08', '2026-09-15'].map(date => ({ clientId: 'c1', slotId: SLOT, date })));
  assert.deepEqual(out.create.map(s => s.date), TUESDAYS, 'nothing dated before today is ever created');
  assert.deepEqual(out.clients, [{ id: 'c1', slots: [slot({ anchor: '2026-08-04', through: '2026-10-16' })] }]);
  const after = applyPlan(out, clients(away), []);
  assert.deepEqual(plan(after.clients, after.sessions), NOTHING, 'a gap is reported once');
  // No gap when the watermark reaches yesterday, when no occurrence fell in between, or when nothing was ever planned.
  for (const through of ['2026-09-18', '2026-09-17', '2026-09-15', null]) assert.deepEqual(plan(clients([slot({ anchor: '2026-08-04', through })]), []).gaps, [], String(through));
  assert.deepEqual(plan(clients([slot({ every: 2, anchor: '2026-08-04', through: '2026-08-25' })]), []).gaps.map(g => g.date), ['2026-09-01', '2026-09-15']);
});

test('malformed slots are reported and never planned; they ride along untouched when a sibling slot moves', () => {
  const bad = { id: 'slot-bad', anchor: '2026-02-31', every: 1, time: '16:00', duration: 1, type: 'in-person', with: [], through: null };
  const out = plan(clients([bad, slot()]), []);
  assert.deepEqual(out.skipped, [{ clientId: 'c1', slotId: 'slot-bad', date: null, reason: 'first session is not a valid date' }]);
  assert.deepEqual(out.create.map(s => s.id), TUESDAYS.map(d => id(d)));
  assert.deepEqual(out.clients, [{ id: 'c1', slots: [bad, slot({ through: '2026-10-16' })] }], 'a mark must carry the complete slots array');
  const reasons = fields => plan(clients([{ ...slot(), ...fields }]), []).skipped.map(x => x.reason);
  assert.deepEqual([{ id: '' }, { every: 3 }, { time: '4pm' }, { time: '24:00' }, { duration: 0 }, { duration: '1' }, { type: 'zoom' }, { with: 'c2' }, { through: 'soon' }].map(f => reasons(f)[0]),
    ['slot has no id', 'repeat must be weekly or every 2 weeks', 'time is not HH:MM', 'time is not HH:MM', 'duration must be more than 0', 'duration must be more than 0',
      'unknown session type', 'also-attending list is not a list of clients', 'planned-through date is not a valid date']);
  assert.deepEqual(plan(clients([null, 'text', []]), []).skipped.map(x => x.reason), Array(3).fill('slot is not an object'));
  // The same slot id twice (even on two clients) would collide on row ids: the second one is refused.
  const twice = plan(clients([slot()], { c3: { slots: [slot()] } }), []);
  assert.equal(twice.create.length, 4); assert.deepEqual(twice.skipped, [{ clientId: 'c3', slotId: SLOT, date: null, reason: 'slot id is used twice' }]);
  // Clients without slots, and nonsense arguments, plan nothing; a bad `today` or horizon is refused loudly.
  assert.deepEqual(plan(clients([]), []), NOTHING); assert.deepEqual(copy(R.materializeRecurring(null, undefined, TODAY)), NOTHING);
  for (const args of [[[], [], '09/19/2026'], [[], [], '2026-02-31'], [[], [], undefined], [[], [], TODAY, 0], [[], [], TODAY, 1.5]]) assert.throws(() => R.materializeRecurring(...args), /Recurring plan needs today/);
});

test('helpers: dayNum / isoOf / weekdayOf are whole-day UTC math; stampOf and isPristine read a row', () => {
  assert.equal(R.dayNum('1970-01-01'), 0); assert.equal(R.dayNum(TODAY), 20715); assert.equal(R.isoOf(20715), TODAY);
  assert.deepEqual(['2026-09-19', '2026-09-22', '2026-09-20'].map(d => R.weekdayOf(R.dayNum(d))), [6, 2, 0]);
  for (const bad of ['2026-02-31', '2026-13-01', '2026-9-19', '', null, 20715]) assert.ok(Number.isNaN(R.dayNum(bad)), String(bad));
  assert.equal(R.dayNum('2026-11-02') - R.dayNum('2026-11-01'), 1); assert.equal(R.dayNum('2027-03-15') - R.dayNum('2027-03-14'), 1);
  const row = plan(clients(), []).create[0];
  assert.equal(R.stampOf(row), row.recurring.stamp);
  assert.equal(R.stampOf({ ...row, amount: '100', duration: '1' }), row.recurring.stamp, 'numbers are compared as numbers');
  for (const [label, touched] of Object.entries({ completed: { status: 'completed' }, moved: { date: '2026-09-23' }, 'new time': { time: '17:00' }, 'new amount': { amount: 90 },
    notes: { notes: 'x' }, miles: { mileage: 3 }, paid: { paid: true }, waived: { payment: 'waived' }, 'other id': { id: 'copy-of-row' }, 'no recurring': { recurring: null } }))
    assert.equal(R.isPristine({ ...row, ...touched }), false, label);
  assert.equal(R.isPristine({ ...row, createdAt: '2026-09-19T12:00:00.000Z', updatedAt: '2026-09-19T12:00:00.000Z', companyAmount: 0, companySplit: 0 }), true, 'what the writer adds does not count as an edit');
});

test('time zones and DST: identical output under America/New_York and Pacific/Auckland; only Tuesdays, 7 days apart', () => {
  const child = path.join(__dirname, 'helpers', 'recurring-scenarios.cjs');
  const run = TZ => {
    const result = spawnSync(process.execPath, [child], { env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.equal(result.status, 0, TZ + ' child failed: ' + result.stderr);
    return JSON.parse(result.stdout);
  };
  const newYork = run('America/New_York'), auckland = run('Pacific/Auckland');
  // The children really ran in those zones (January and July offsets, minutes behind UTC).
  assert.deepEqual(newYork.offsets, [300, 240]); assert.deepEqual(auckland.offsets, [-780, -720]);
  assert.deepEqual(auckland.report, newYork.report);
  assert.deepEqual(newYork.report, copy(tzReport()), 'and the same as this process');
  const report = newYork.report;
  assert.deepEqual(report.base.create.map(s => s.date), TUESDAYS);
  assert.deepEqual(report.spansUsFallBack.create.map(s => s.date), ['2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10']);
  assert.deepEqual(report.spansUsSpringForward.create.map(s => s.date), ['2027-03-02', '2027-03-09', '2027-03-16', '2027-03-23']);
  assert.deepEqual(report.spansNzFallBack.create.map(s => s.date), ['2027-03-23', '2027-03-30', '2027-04-06', '2027-04-13']);
  for (const key of ['base', 'spansUsFallBack', 'spansUsSpringForward', 'spansNzFallBack']) {
    const noons = report[key].create.map(s => new Date(s.date + 'T12:00:00Z'));
    noons.forEach(d => assert.equal(d.getUTCDay(), 2, key + ': ' + d.toISOString() + ' is not a Tuesday'));
    noons.slice(1).forEach((d, i) => assert.equal(d - noons[i], 7 * 864e5, key));
    report[key].create.forEach(s => assert.equal(s.time, '16:00', 'wall-clock time never shifts'));
  }
});

test('inert and clock-free: nothing in protected/js calls the planner; it touches no clock, DOM, storage or repository', () => {
  const dir = path.join(root, 'js'), source = readSource('js/recurring.js'), html = readSource('index.html');
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'recurring.js'))
    assert.doesNotMatch(fs.readFileSync(path.join(dir, file), 'utf8'), /materializeRecurring|App\.recurring|\brecurring\.js/, file + ' must not use the planner yet');
  assert.equal(source.split('materializeRecurring(').length - 1, 1, 'recurring.js may define the planner but not call it');
  assert.equal((html.match(/recurring/g) || []).length, 1, 'index.html only carries the script tag');
  const order = ['js/sessions.js', 'js/recurring.js', 'js/expenses.js'].map(src => html.indexOf('<script src="' + src + '" defer></script>'));
  assert.ok(order[0] > 0 && order[0] < order[1] && order[1] < order[2], 'recurring.js loads right after sessions.js');
  assert.doesNotMatch(source, /new Date\(\s*\)|Date\.now|\.get(Date|Day|Month|FullYear|Hours|TimezoneOffset)\(|\.set(Date|Hours|Month|FullYear)\(|todayISO/, 'the planner never reads the clock or does local-date arithmetic');
  assert.doesNotMatch(source, /App\.repository|runCommand|\.execute\(|localStorage|sessionStorage|indexedDB|document\.|addEventListener|fetch\(|App\.state/);
  // The static writer guard passes as-is, and still passes when the planner is fed the live read views (as slice 3 will do).
  assert.deepEqual(analyzeSource(source, 'recurring.js'), []);
  const wired = source.replace('  App.recurring = Object.freeze(', '  materializeRecurring(App.state.clients, App.state.sessions, App.todayISO());\n  App.recurring = Object.freeze(');
  assert.notEqual(wired, source); assert.deepEqual(analyzeSource(wired, 'recurring.js'), []);
  // The guard itself is awake: a planner that wrote to a slot would be caught in that wiring.
  const writes = wired.replace('if (isActive(owner)) live.set(slot.id, { slot, owner });', 'slot.through = today; if (isActive(owner)) live.set(slot.id, { slot, owner });');
  assert.notEqual(writes, wired); assert.ok(analyzeSource(writes, 'recurring.js').length > 0);
});
