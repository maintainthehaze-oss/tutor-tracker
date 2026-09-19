'use strict';
// Append-only status / payment / correction events (shipped 2026-09-15). Fabricated data only.
// The stored original of a locked session must never change; the read view and the reports overlay
// the events in order and the LAST one wins.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { activate, command, loadApp } = require('./helpers/harness.cjs');
const { MODULES, rawFixture, newSession } = require('./helpers/money-fixture.cjs');

const copy = x => JSON.parse(JSON.stringify(x));
async function setup() {
  const env = await activate(MODULES, rawFixture());
  const repo = env.App.repository;
  await command(repo, 'session.save', { record: newSession('locked', { clientIds: ['c1'], date: '2026-03-02', amount: 100, status: 'completed' }) });
  await command(repo, 'session.save', { record: newSession('open', { clientIds: ['c1'], date: '2026-11-02', amount: 100, status: 'scheduled' }) });
  return { ...env, repo };
}
const row = (repo, id) => repo.read().sessions.find(s => s.id === id);
const stored = (repo, id) => JSON.stringify(repo.snapshot().working.sessions.find(s => s.id === id));
async function refused(repo, name, payload, pattern) {
  const before = JSON.stringify(repo.snapshot());
  await assert.rejects(command(repo, name, payload), pattern);
  assert.equal(JSON.stringify(repo.snapshot()), before, name + ' changed the store while refusing');
}

test('status events: only pre-activation scheduled rows, valid outcomes, no duplicates, last one wins', async () => {
  const { repo } = await setup(), archive = JSON.stringify(repo.snapshot().archive), original = stored(repo, 'a6');
  await refused(repo, 'session.status', { ids: ['a1'], status: 'cancelled' }, /Only pre-activation scheduled/);   // archived but completed
  await refused(repo, 'session.status', { ids: ['locked'], status: 'cancelled' }, /Only pre-activation scheduled/); // finalized, not archived
  await refused(repo, 'session.status', { ids: ['open'], status: 'completed' }, /Only pre-activation scheduled/);   // editable row
  await refused(repo, 'session.status', { ids: ['a6'], status: 'scheduled' }, /Invalid session status/);
  await refused(repo, 'session.status', { ids: ['a6'], status: 'made-up' }, /Invalid session status/);
  await refused(repo, 'session.status', { ids: ['a6', 'a1'], status: 'completed' }, /Only pre-activation scheduled/); // all-or-nothing
  await command(repo, 'session.status', { ids: ['a6'], status: 'no-show' });
  assert.equal(row(repo, 'a6').status, 'no-show'); assert.equal(row(repo, 'a6').statusEvent, true);
  await refused(repo, 'session.status', { ids: ['a6'], status: 'no-show' }, /already no-show/);
  await command(repo, 'session.status', { ids: ['a6'], status: 'completed' });
  assert.equal(row(repo, 'a6').status, 'completed');
  assert.equal(stored(repo, 'a6'), original, 'status event edited the stored original');
  assert.equal(JSON.parse(original).status, 'scheduled');
  assert.equal(JSON.stringify(repo.snapshot().archive), archive);
  assert.deepEqual(copy(repo.snapshot().events).map(e => [e.type, e.sessionId, e.status]), [['status', 'a6', 'no-show'], ['status', 'a6', 'completed']]);
});

test('a paid session cannot be un-completed by a status event; payment needs a completed row', async () => {
  const { repo } = await setup();
  await refused(repo, 'session.payment', { ids: ['a6'], date: '2026-02-20' }, /Complete the session/);
  await command(repo, 'session.status', { ids: ['a6'], status: 'completed' });
  await command(repo, 'session.payment', { ids: ['a6'], date: '2026-02-20' });
  assert.equal(row(repo, 'a6').paid, true); assert.equal(row(repo, 'a6').paymentDate, '2026-02-20');
  await refused(repo, 'session.status', { ids: ['a6'], status: 'cancelled' }, /paid session cannot be changed/);
  await refused(repo, 'session.payment', { ids: ['a6'], date: '2026-02-21' }, /already recorded/);
});

test('corrections: locked rows only, validated fields, original and finalization evidence untouched', async () => {
  const { repo } = await setup(), original = stored(repo, 'locked'), finalized = JSON.stringify(repo.snapshot().finalized.locked);
  await refused(repo, 'session.correct', { id: 'open', fields: { amount: 1 } }, /Editable session/);
  for (const [fields, pattern] of [[{}, /Nothing to correct/], [{ id: 'other' }, /cannot be corrected/], [{ companyAmount: 5 }, /cannot be corrected/],
    [{ status: 'scheduled' }, /cannot go back to scheduled/], [{ amount: -1 }, /Invalid amount/], [{ amount: 'abc' }, /Invalid amount/],
    [{ duration: 0 }, /Invalid duration/], [{ date: '03/02/2026' }, /Session date required/], [{ clientIds: [] }, /Session clients required/],
    [{ paid: 'yes' }, /Invalid paid flag/], [{ payment: 'later' }, /Invalid payment status/], [{ paymentDate: 'soon' }, /Invalid payment date/]])
    await refused(repo, 'session.correct', { id: 'locked', fields }, pattern);
  await command(repo, 'session.correct', { id: 'locked', fields: { amount: 90, notes: 'first fix' } });
  await command(repo, 'session.correct', { id: 'locked', fields: { amount: 95 } });
  const view = row(repo, 'locked');
  assert.equal(view.amount, 95, 'the LAST correction must win'); assert.equal(view.notes, 'first fix'); assert.equal(view.corrected, true);
  assert.equal(stored(repo, 'locked'), original, 'correction edited the stored record');
  assert.equal(JSON.parse(original).amount, 100);
  assert.equal(JSON.stringify(repo.snapshot().finalized.locked), finalized, 'correction edited finalization evidence');
  // Archived rows take corrections too, and direct writes to either kind of locked row still refuse.
  await command(repo, 'session.correct', { id: 'a1', fields: { mileage: 12 } });
  assert.equal(row(repo, 'a1').mileage, 12);
  for (const id of ['locked', 'a1']) {
    await refused(repo, 'session.save', { record: { id, amount: 1 } }, /Read-only/);
    await refused(repo, 'session.update', { ids: [id], patch: { amount: 1 } }, /Read-only/);
    await refused(repo, 'session.delete', { ids: [id] }, /Read-only/);
  }
});

test('payment, un-pay correction and a second payment replay in order', async () => {
  const { repo } = await setup();
  await command(repo, 'session.payment', { ids: ['locked'], date: '2026-03-05' });
  await command(repo, 'session.correct', { id: 'locked', fields: { paid: false, payment: 'unpaid', paymentDate: null } });
  assert.equal(row(repo, 'locked').paid, false); assert.equal(row(repo, 'locked').paymentDate, null);
  await command(repo, 'session.payment', { ids: ['locked'], date: '2026-04-01' });
  assert.equal(row(repo, 'locked').paid, true); assert.equal(row(repo, 'locked').paymentDate, '2026-04-01');
  await command(repo, 'session.correct', { id: 'locked', fields: { status: 'cancelled', paid: false, payment: 'unpaid', paymentDate: null } });
  assert.equal(row(repo, 'locked').status, 'cancelled');
  assert.deepEqual(copy(repo.snapshot().events).map(e => e.type), ['payment', 'correction', 'payment', 'correction']);
});

test('correctMany is all-or-nothing in one revision', async () => {
  const { repo } = await setup(), revision = repo.revision;
  await refused(repo, 'session.correctMany', { items: [] }, /Corrections required/);
  await refused(repo, 'session.correctMany', { items: [{ id: 'a1', fields: { mileage: 5 } }, { id: 'open', fields: { mileage: 5 } }] }, /Editable session/);
  await refused(repo, 'session.correctMany', { items: [{ id: 'a1', fields: { mileage: 5 } }, { id: 'a2', fields: { mileage: -5 } }] }, /Invalid mileage/);
  await command(repo, 'session.correctMany', { items: [{ id: 'a1', fields: { mileage: 5 } }, { id: 'a2', fields: { mileage: 7 } }] });
  assert.equal(repo.revision, revision + 1); assert.equal(repo.snapshot().events.length, 2);
  assert.equal(row(repo, 'a1').mileage, 5); assert.equal(row(repo, 'a2').mileage, 7);
});

test('reports and tax honour events on archived and finalized rows', async () => {
  const { App, repo } = await setup();
  const gross = () => { App.refreshReadViews(); const m = App.reportModel.metrics({}); assert.equal(App.computeMetrics({}).gross, m.gross); return m.gross; };
  const base = gross();                                                   // a1 100 + a2 150 + a8 51.875 + locked 100 (a3 waived)
  assert.equal(base, 401.875);
  await command(repo, 'session.status', { ids: ['a6'], status: 'completed' });
  assert.equal(gross(), base + 60);
  await command(repo, 'session.correct', { id: 'locked', fields: { amount: 40 } });
  assert.equal(gross(), base + 60 - 60);
  await command(repo, 'session.correct', { id: 'a2', fields: { status: 'no-show' } });
  assert.equal(gross(), base - 150);
  assert.equal(App.getTaxData(2026).grossIncome, 100);
  await command(repo, 'session.payment', { ids: ['locked'], date: '2027-01-02' });
  App.refreshReadViews();
  assert.equal(App.getTaxData(2026).grossIncome, 100, 'money received next year is not this year income');
  assert.equal(App.getTaxData(2027).grossIncome, 40, 'cash basis uses the corrected amount in the year it was received');
});

test('a store with events reopens and verifies; a forged or malformed event log fails closed', async () => {
  const { App, repo, disk } = await setup();
  await command(repo, 'session.status', { ids: ['a6'], status: 'completed' });
  await command(repo, 'session.payment', { ids: ['a6'], date: '2026-02-20' });
  await command(repo, 'session.correct', { id: 'locked', fields: { amount: 95 } });
  const saved = disk(), reopen = value => App.Repository.create({ read: async () => copy(value), compareAndSwap: async () => true });
  const again = reopen(saved); assert.equal(await again.open(), true);
  assert.equal(JSON.stringify(again.read()), JSON.stringify(repo.read()));
  const stamp = new Date(0).toISOString();
  // A forger who can recompute the integrity hash must still be stopped by validation.
  const reseal = e => { const body = copy(e); delete body.integrity; e.integrity = createHash('sha256').update(App.Repository.canonical(body)).digest('hex'); return e; };
  assert.equal(reseal(copy(saved)).integrity, saved.integrity, 'test reseal must match the real seal');
  for (const [label, [forge, pattern]] of Object.entries({
    'status event on a finalized row': [e => e.events.push({ id: 'x1', sessionId: 'locked', type: 'status', status: 'cancelled', recordedAt: stamp }), /Invalid status event/],
    'status event with an invalid outcome': [e => e.events.push({ id: 'x2', sessionId: 'a5', type: 'status', status: 'scheduled', recordedAt: stamp }), /Invalid status event/],
    'correction of a forbidden field': [e => e.events.push({ id: 'x3', sessionId: 'locked', type: 'correction', fields: { companyAmount: 1 }, recordedAt: stamp }), /cannot be corrected/],
    'correction on an editable row': [e => e.events.push({ id: 'x4', sessionId: 'open', type: 'correction', fields: { amount: 1 }, recordedAt: stamp }), /Invalid correction event/],
    'payment on an editable row': [e => e.events.push({ id: 'x5', sessionId: 'open', type: 'payment', date: '2026-11-02', recordedAt: stamp }), /Invalid payment event/],
    'unknown event type': [e => e.events.push({ id: 'x6', sessionId: 'locked', type: 'refund', recordedAt: stamp }), /Unknown event type/],
  })) {
    const forged = copy(saved); forge(forged);
    await assert.rejects(reopen(reseal(forged)).open(), pattern, label);
  }
  // Without the hash, dropping or editing an event is caught by the seal itself.
  for (const forge of [e => e.events.pop(), e => { e.events[2].fields.amount = 1; }]) {
    const forged = copy(saved); forge(forged);
    await assert.rejects(reopen(forged).open(), /integrity mismatch/);
  }
});

test('applyEvents is pure overlay logic: ignores other sessions, keeps the input order, flags the view', () => {
  const App = loadApp(['app-core', 'record-policy']), P = App.recordPolicy;
  const events = [
    { sessionId: 'other', type: 'correction', fields: { amount: 1 } },
    { sessionId: 's', type: 'correction', fields: { amount: 80 } },
    { sessionId: 's', type: 'payment', date: '2026-05-01' },
    { sessionId: 's', type: 'correction', fields: { amount: 90, paid: false, payment: 'unpaid', paymentDate: null } },
  ];
  const view = P.applyEvents({ id: 's', amount: 70, status: 'completed', paid: false }, events);
  assert.deepEqual(copy(view), { id: 's', amount: 90, status: 'completed', paid: false, corrected: true, payment: 'unpaid', paymentDate: null });
  assert.deepEqual(copy(P.applyEvents({ id: 'untouched', amount: 5 }, events)), { id: 'untouched', amount: 5 });
  assert.deepEqual(copy(P.applyEvents({ id: 7, amount: 5 }, [{ sessionId: '7', type: 'status', status: 'completed' }])), { id: 7, amount: 5, status: 'completed', statusEvent: true });
});
