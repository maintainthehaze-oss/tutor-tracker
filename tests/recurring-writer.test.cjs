'use strict';
// Weekly recurring slots, slice E1: the ONE writer `recurring.apply` (protected/js/repository.js) and the
// chokepoint guard (design: docs/handoffs/2026-10-11-slice-e-design.md §2). FABRICATED DATA ONLY: this
// repository is public. Today is 2026-09-19, a Saturday; the Tuesday slot plans 09-22, 09-29, 10-06, 10-13.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { activate, readSource, root } = require('./helpers/harness.cjs');
const { rawFixture } = require('./helpers/money-fixture.cjs');
const { TODAY, SLOT, slot } = require('./helpers/recurring-scenarios.cjs');

const MODULES = ['app-core', 'record-policy', 'repository', 'report-model', 'dashboard', 'sessions', 'reports', 'recurring'];
const copy = x => JSON.parse(JSON.stringify(x));
const TUESDAYS = ['2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13'];
const rid = date => 'rec:' + SLOT + ':' + date;

async function boot(stored) {
  const data = rawFixture();
  data.clients[0].slots = [slot()];                                      // c1 owns a Tuesday 16:00 weekly slot
  const env = await activate(MODULES, data, stored ? { stored } : {});
  const { App } = env;
  const state = () => { App.refreshReadViews(); return copy({ clients: App.state.clients, sessions: App.state.sessions }); };
  const plan = (today = TODAY) => copy(App.recurring.materializeRecurring(state().clients, state().sessions, today));
  const apply = payload => App.repository.execute('recurring.apply', payload, App.repository.revision);
  const refused = async (payload, re) => {
    const before = JSON.stringify(env.disk()), r = App.repository.revision;
    await assert.rejects(() => apply(payload), re);
    assert.equal(JSON.stringify(env.disk()), before, 'a refused call writes nothing');
    assert.equal(App.repository.revision, r);
  };
  const stamp = () => { const d = env.disk(); return { keys: Object.keys(d).sort(), schema: d.schema, events: d.events.length, types: [...new Set(d.events.map(e => e.type))].sort() }; };
  return { ...env, App, state, plan, apply, refused, stamp };
}

test('one pass = one revision: four generated rows, watermark on the client, envelope shape unchanged, reopens and verifies', async () => {
  const env = await boot(), { App, state, plan, apply, stamp } = env;
  const before = stamp(), r0 = App.repository.revision, first = plan();
  assert.deepEqual(first.create.map(s => s.id), TUESDAYS.map(rid));
  await apply(first);
  assert.equal(App.repository.revision, r0 + 1, 'exactly one revision');
  const rows = state().sessions.filter(s => s.recurring);
  assert.deepEqual(rows.map(s => [s.id, s.date, s.status, s.amount, s.time]).sort(), TUESDAYS.map(d => [rid(d), d, 'scheduled', 100, '16:00']).sort());
  assert.equal(state().clients.find(c => c.id === 'c1').slots[0].through, '2026-10-16', 'watermark = window end');
  assert.deepEqual(stamp(), before, 'no new envelope key, schema or event type');
  assert.equal(env.disk().finalized[rid('2026-09-22')], undefined, 'scheduled rows are not finalized');
  // Feeding the state back in plans nothing, and an empty plan is refused without a write.
  const again = plan();
  assert.deepEqual([again.create, again.removeIds, again.clients], [[], [], []]);
  await env.refused(again, /Nothing to apply/);
  // Simulated reload from the stored envelope: it verifies and the rows are there.
  const reopened = await boot(env.disk());
  assert.equal(reopened.App.repository.revision, r0 + 1);
  assert.equal(reopened.state().sessions.filter(s => s.recurring).length, 4);
  assert.equal(reopened.state().clients.find(c => c.id === 'c1').slots[0].through, '2026-10-16');
});

test('refusals are all-or-nothing: existing id, duplicate in batch, non-scheduled or non-generated create, remove of a hand-entered or locked row', async () => {
  const env = await boot(), { App, plan, apply, refused, state } = env;
  const first = plan(); await apply(first);
  // A hand-entered, unlocked, scheduled row (the fixture's own scheduled rows are archived, hence read-only).
  await App.repository.execute('session.save', { record: { id: 'hand1', clientIds: ['c3'], date: '2026-10-27', time: '10:00', duration: 1, amount: 80, status: 'scheduled', paid: false, payment: 'unpaid', mileage: 0, recurring: null } }, App.repository.revision);
  const fresh = { ...first.create[0], id: rid('2026-10-20'), date: '2026-10-20', recurring: { ...first.create[0].recurring, date: '2026-10-20' } };
  await refused({ create: [first.create[0]] }, /Generated session already exists/);
  await refused({ create: [{ ...first.create[0], id: 'a6' }] }, /already exists/);                       // a hand-entered id
  await refused({ create: [fresh, fresh] }, /Duplicate generated session/);
  await refused({ create: [{ ...fresh, status: 'completed' }] }, /must be scheduled/);
  await refused({ create: [{ ...fresh, recurring: null }] }, /must be scheduled/);
  await refused({ create: [{ ...fresh, clientIds: [] }] }, /./);                                           // validateNewSession still bites
  await refused({ removeIds: ['hand1'], create: [fresh] }, /Only generated scheduled sessions can be removed/); // the valid create does not land
  await refused({ removeIds: ['a1'] }, /Read-only sessions block/);                                        // locked row
  // A generated row he touched (notes, miles, paid, waived) is not the writer's to remove, whatever the planner says.
  for (const patch of [{ notes: 'moved to the library' }, { mileage: 12 }, { paid: true, payment: 'paid', paymentDate: '2026-09-22' }, { payment: 'waived' }]) {
    const touched = rid('2026-10-13');
    await App.repository.execute('session.update', { ids: [touched], patch }, App.repository.revision);
    await refused({ removeIds: [touched] }, /Edited generated sessions stay/);
    await App.repository.execute('session.update', { ids: [touched], patch: { notes: '', mileage: 0, paid: false, payment: 'unpaid', paymentDate: null } }, App.repository.revision);
  }
  await refused({ removeIds: ['nope'] }, /Record no longer exists/);
  await refused({ clients: [{ id: 'c1' }] }, /Slots required/);
  await refused({ clients: [{ id: 'zz', slots: [] }] }, /Record no longer exists/);
  assert.equal(state().sessions.filter(s => s.recurring).length, 4);
});

test('replace under the same id in one call (rate change), and a marked-only pass; a removed generated row never comes back', async () => {
  const env = await boot(), { App, plan, apply, state } = env;
  await apply(plan());
  await App.repository.execute('client.save', { record: { id: 'c1', rate: 110 } }, App.repository.revision);
  const second = plan();
  assert.deepEqual(second.removeIds.sort(), TUESDAYS.map(rid).sort(), 'stamp mismatch replaces every pristine future row');
  assert.deepEqual(second.create.map(s => [s.id, s.amount]).sort(), TUESDAYS.map(d => [rid(d), 110]).sort());
  const r = App.repository.revision; await apply(second);
  assert.equal(App.repository.revision, r + 1);
  assert.deepEqual(state().sessions.filter(s => s.recurring).map(s => s.amount), [110, 110, 110, 110]);
  // He deletes one by hand (the week group's Skip): the watermark keeps it gone.
  await App.repository.execute('session.delete', { ids: [rid('2026-09-29')] }, App.repository.revision);
  const third = plan();
  assert.deepEqual([third.create, third.removeIds], [[], []]);
  // Mark-only call (e.g. a paused owner resetting the watermark) is a valid single-revision write.
  const r2 = App.repository.revision;
  await apply({ clients: [{ id: 'c1', slots: [{ ...state().clients[0].slots[0], through: TODAY }] }] });
  assert.equal(App.repository.revision, r2 + 1);
  assert.equal(state().clients[0].slots[0].through, TODAY);
});

test('chokepoint guard: one writer, one planner, no other file forges generated ids or watermarks; the writer case composes existing primitives only', () => {
  const dir = path.join(root, 'js'), repository = readSource('js/repository.js');
  const others = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'repository.js').map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')]);
  // The writer name may appear outside repository.js only in recurring.js (the wrapper), at most once.
  for (const [f, src] of others) {
    const uses = (src.match(/recurring\.apply/g) || []).length;
    assert.ok(f === 'recurring.js' ? uses <= 1 : uses === 0, f + ' must not call the writer');
  }
  // Only recurring.js plans, and only recurring.js can forge a generated id or set a watermark.
  for (const [f, src] of others) {
    if (f === 'recurring.js') continue;
    assert.doesNotMatch(src, /materializeRecurring|'rec:'|"rec:"/, f + ' must not plan or forge generated ids');
    assert.doesNotMatch(src, /through\s*:(?!\s*null\b)/, f + ' may only ever write through: null');
  }
  // repository.js: the case sits inside the switch, the mutation anchor is intact, and the case body touches no
  // events, finalized entries, hashing or sealing: it composes select / assertEditableSessions / mergeRecord /
  // validateNewSession / finalize / index only.
  assert.equal(repository.split("default: throw Error('Unavailable command: '+name);").length, 2, 'mutation anchor');
  const start = repository.indexOf("case 'recurring.apply': {"), end = repository.indexOf("case 'client.save': {");
  assert.ok(start > 0 && end > start);
  const body = repository.slice(start, end);
  assert.doesNotMatch(body, /draft\.events|finalized|seal\(|hash\(|validateTransition|validateEnvelope|P\.applyEvents/);
  for (const helper of ['select(', 'assertEditableSessions(', 'mergeRecord(', 'validateNewSession(', 'finalize(', 'index(']) assert.ok(body.includes(helper), helper);
  assert.match(body, /s\.status!=='scheduled' \|\| !s\.recurring/, 'remove guard');
  assert.match(body, /rec\.status!=='scheduled' \|\| !rec\.recurring/, 'create guard');
});
