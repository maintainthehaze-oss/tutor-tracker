'use strict';
// Audit 6a: NEW amounts on unlocked sessions are stored in whole cents. Nothing already stored or
// locked is ever re-rounded, validation is unchanged, and totals still sum the stored values.
// Fabricated data only. The forms are exercised through the real sessions.js code with a fake DOM.
const test = require('node:test');
const assert = require('node:assert/strict');
const { command, readSource } = require('./helpers/harness.cjs');
const { formApp } = require('./helpers/session-form.cjs');
const { newSession } = require('./helpers/money-fixture.cjs');

const copy = x => JSON.parse(JSON.stringify(x));

test('roundCents / newAmount: cents for new money, pass-through for an unchanged stored amount', async () => {
  const { App } = await formApp();
  for (const [input, expected] of [[62.5 * 0.83, 51.88], [51.875, 51.88], [51.87499999999999, 51.88], [1.005, 1.01], [33.335, 33.34],
    [12.345, 12.35], [33.333333, 33.33], [66.666666, 66.67], [0, 0], [100, 100], [0.004, 0], [0.005, 0.01], ['75.50', 75.5], ['abc', 0]])
    assert.equal(App.roundCents(input), expected, String(input));
  assert.equal(App.newAmount(51.875, 51.875), 51.875, 'unchanged stored amount must pass through');
  assert.equal(App.newAmount('51.875', '51.875'), 51.875);
  assert.equal(App.newAmount(51.875, null), 51.88, 'no stored row: this is new money');
  assert.equal(App.newAmount(51.875, undefined), 51.88);
  assert.equal(App.newAmount(51.879, 51.875), 51.88);
  assert.equal(App.newAmount(60, 51.875), 60);
});

test('new session: $62.50 x 0.83 h saves 51.88, in the working record and in the locked evidence', async () => {
  const f = await formApp();
  f.App.openSessionForm();
  f.chooseClients(['c4']);                                   // Client Delta, fabricated rate 62.50
  f.fill({ date: '2026-04-01', duration: '0.83', amount: '', payment: 'unpaid', status: 'completed' });
  assert.equal(await f.App.saveSession(), true, JSON.stringify(f.toasts));
  const saved = f.disk().working.sessions.at(-1);
  assert.equal(saved.amount, 51.88); assert.equal(saved.duration, 0.83); assert.deepEqual(saved.clientIds, ['c4']);
  assert.equal(f.disk().finalized[saved.id].record.amount, 51.88);
  // Two such rows now read and total the same way: 103.76, not 103.75.
  f.App.openSessionForm(); f.chooseClients(['c4']);
  f.fill({ date: '2026-04-02', duration: '0.83', amount: '', payment: 'unpaid', status: 'completed' });
  assert.equal(await f.App.saveSession(), true);
  const april = f.App.sessionTotals(f.App.state.sessions.filter(s => s.date.startsWith('2026-04')));
  assert.equal(Math.round(april.totalAmt * 1000) / 1000, 103.76);
});

test('a typed amount with more than two decimals is stored in cents; shared sessions use the average rate', async () => {
  const f = await formApp();
  f.App.openSessionForm(); f.chooseClients(['c4']);
  f.fill({ date: '2026-04-03', duration: '1', amount: '33.335', payment: 'unpaid', status: 'scheduled' });
  assert.equal(await f.App.saveSession(), true);
  assert.equal(f.disk().working.sessions.at(-1).amount, 33.34);
  f.App.openSessionForm(); f.chooseClients(['c2', 'c4']);    // (60 + 62.5) / 2 x 0.83 = 50.8375
  f.fill({ date: '2026-04-04', duration: '0.83', amount: '', payment: 'unpaid', status: 'scheduled' });
  assert.equal(await f.App.saveSession(), true);
  assert.equal(f.disk().working.sessions.at(-1).amount, 50.84);
});

test('an existing sub-cent LOCKED record still loads, verifies and displays as before, and is never re-rounded', async () => {
  const f = await formApp(), archive = JSON.stringify(f.disk().archive), before = JSON.stringify(f.working('a8'));
  assert.equal(f.working('a8').amount, 51.875);
  assert.equal(f.App.state.sessions.find(s => s.id === 'a8').amount, 51.875);
  assert.equal(f.App.formatCurrency(51.875), '$51.88');
  // Owner opens the locked row and only changes the note: the correction must not carry an amount.
  f.App.openSessionForm('a8');
  assert.equal(f.field('session-amount').value, 51.875);
  f.chooseClients(['c4']); f.fill({ notes: 'fabricated note' });
  assert.equal(await f.App.saveSession(), true, JSON.stringify(f.toasts));
  assert.deepEqual(copy(f.disk().events).map(e => [e.type, e.sessionId, e.fields]), [['correction', 'a8', { notes: 'fabricated note' }]]);
  assert.equal(JSON.stringify(f.working('a8')), before); assert.equal(JSON.stringify(f.disk().archive), archive);
  // The store, sub-cent value and all, reopens and passes every integrity check.
  const again = f.App.Repository.create({ read: async () => f.disk(), compareAndSwap: async () => true });
  assert.equal(await again.open(), true);
  assert.equal(again.read().sessions.find(s => s.id === 'a8').amount, 51.875);
  // Totals still sum the stored value, not a rounded one.
  assert.equal(f.App.sessionTotals(f.App.state.sessions.filter(s => s.id === 'a8')).totalAmt, 51.875);
});

test('an existing sub-cent UNLOCKED record is not re-rounded by a re-save; only a newly typed amount is', async () => {
  const f = await formApp();
  // Simulates a scheduled row written before this fix (validation accepts it, then and now).
  await command(f.App.repository, 'session.save', { record: newSession('old-style', { clientIds: ['c2'], date: '2026-10-01', amount: 10.005, status: 'scheduled' }) });
  f.App.refreshReadViews();
  f.App.openSessionForm('old-style'); f.chooseClients(['c2']); f.fill({ notes: 'only the note changed' });
  assert.equal(await f.App.saveSession(), true, JSON.stringify(f.toasts));
  assert.equal(f.working('old-style').amount, 10.005); assert.equal(f.working('old-style').notes, 'only the note changed');
  f.App.openSessionForm('old-style'); f.chooseClients(['c2']); f.fill({ amount: '12.345' });
  assert.equal(await f.App.saveSession(), true);
  assert.equal(f.working('old-style').amount, 12.35);
});

test('inline amount edit on an unlocked row stores cents; duration is untouched; locked rows still refuse', async () => {
  const f = await formApp();
  await command(f.App.repository, 'session.save', { record: newSession('inline', { clientIds: ['c2'], date: '2026-10-02', amount: 60, status: 'scheduled' }) });
  f.App.refreshReadViews();
  assert.equal(await f.inline('inline', 'amount', '20.555'), true);
  assert.equal(f.working('inline').amount, 20.56);
  assert.equal(await f.inline('inline', 'duration', '0.83'), true);
  assert.equal(f.working('inline').duration, 0.83);
  const before = JSON.stringify(f.disk());
  assert.equal(await f.inline('a8', 'amount', '51.88'), false);
  assert.equal(JSON.stringify(f.disk()), before, 'inline edit changed a locked row');
});

test('validation is unchanged: the repository still accepts a sub-cent amount (no one-way door)', async () => {
  const f = await formApp();
  await command(f.App.repository, 'session.save', { record: newSession('direct', { clientIds: ['c1'], date: '2026-10-03', amount: 0.125, status: 'scheduled' }) });
  assert.equal(f.working('direct').amount, 0.125);
  const source = readSource('js/repository.js');
  assert.ok(source.includes("!Number.isFinite(Number(record.amount)) || Number(record.amount) < 0) throw Error('Invalid duration or amount');"));
});

test('mutation: without the rounding line the 51.88 pin goes red', async () => {
  const source = readSource('js/sessions.js'), anchor = 'amount = newAmount(amount, storedRow ? storedRow.amount : null);';
  assert.equal(source.split(anchor).length, 2, 'mutation anchor moved');
  const f = await formApp({ sources: { sessions: source.replace(anchor, '') } });
  f.App.openSessionForm(); f.chooseClients(['c4']);
  f.fill({ date: '2026-04-01', duration: '0.83', amount: '', payment: 'unpaid', status: 'completed' });
  assert.equal(await f.App.saveSession(), true);
  assert.equal(f.disk().working.sessions.at(-1).amount, 51.875, 'mutant should store the unrounded product');
});
