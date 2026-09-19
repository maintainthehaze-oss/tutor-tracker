'use strict';
// Money pins. Fabricated data only (see helpers/money-fixture.cjs).
// Each pin is MUTATION-VERIFIED in this file: the named one-line change to the real source is applied to
// a disposable in-memory copy and the pin must go red. A green suite alone proves nothing about a pin.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSource, recordingDocument } = require('./helpers/harness.cjs');
const { build, EXPECTED } = require('./helpers/money-fixture.cjs');

const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, label + ': ' + actual + ' !== ' + expected);

/** Pin 1: absolute realized figures from App.computeMetrics (drives the Owed pill and panels). */
function pinComputeMetrics(App) {
  const m = App.computeMetrics({});
  assert.equal(m.sessionCount, EXPECTED.sessionCount);
  assert.equal(m.gross, EXPECTED.gross);
  assert.equal(m.companySplit, EXPECTED.companySplit);
  assert.equal(m.yourCut, EXPECTED.yourCut);
  assert.equal(m.miles, EXPECTED.miles);
  near(m.hours, EXPECTED.hours, 'hours');
  assert.equal(m.outstanding, EXPECTED.outstanding);
  assert.equal(m.outstandingCount, EXPECTED.outstandingCount);
  const owed = App.computeOwedByFamily();
  assert.equal(owed.total, EXPECTED.outstanding);
  assert.equal(owed.count, EXPECTED.outstandingCount);
}

/** Pin 2 (audit finding 4d): the three same-number code paths agree, overall, per month and per family. */
function pinPathsAgree(App) {
  for (const filter of [{}, { year: '2026' }, { month: '2026-02' }, { month: '2026-03' }, { month: '2026-07' }]) {
    const core = App.computeMetrics(filter), model = App.reportModel.metrics(filter);
    const rows = App.state.sessions.filter(s => (!filter.year || (s.date || '').slice(0, 4) === filter.year) && (!filter.month || (s.date || '').slice(0, 7) === filter.month));
    const totals = App.sessionTotals(rows), label = JSON.stringify(filter);
    for (const field of ['sessionCount', 'gross', 'companySplit', 'yourCut', 'miles', 'hours', 'outstanding', 'outstandingCount'])
      assert.equal(model[field], core[field], 'reportModel vs computeMetrics ' + field + ' ' + label);
    assert.equal(totals.totalAmt, core.gross, 'Sessions Totals amount vs computeMetrics ' + label);
    assert.equal(totals.totalDur, core.hours, 'Sessions Totals hours vs computeMetrics ' + label);
    assert.equal(totals.totalMiles, core.miles, 'Sessions Totals miles vs computeMetrics ' + label);
    const groups = m => Object.fromEntries(m.groups.map(g => [g.key, [g.gross, g.companySplit, g.outstanding, g.sessions]]));
    assert.deepEqual(groups(model), groups(core), 'family rollups ' + label);
  }
  assert.equal(App.reportModel.metrics({}).gross, EXPECTED.gross);
}

/** Pin 3: projected = scheduled rows only, waived = 0; Sessions Totals and the header pill agree. */
function pinProjected(App, document) {
  const totals = App.sessionTotals(App.state.sessions);
  assert.equal(totals.projectedAmt, EXPECTED.projected);
  assert.equal(totals.scheduled.length, EXPECTED.scheduledCount);
  App.updateHeaderStats();
  assert.equal(document.getElementById('header-projected').textContent, App.formatCurrency(EXPECTED.projected));
  assert.equal(document.getElementById('header-owed').textContent, App.formatCurrency(EXPECTED.outstanding));
}

/** Pin 4: Schedule C gross receipts are CASH BASIS: only paid sessions, in the year the money arrived. */
function pinCashBasis(App) {
  assert.equal(App.getTaxData(2026).grossIncome, EXPECTED.taxGross2026);
  assert.equal(App.getTaxData(2027).grossIncome, EXPECTED.taxGross2027);
  assert.equal(App.getTaxData(2026).companyTotal, EXPECTED.companySplit);
}

/** Pin 5: a waived fee is never revenue, but the session still counts for hours and miles. */
function pinWaived(App) {
  const waived = App.state.sessions.find(s => s.id === 'a3');
  assert.equal(waived.payment, 'waived');
  assert.equal(App.revenueAmount(waived), 0);
  assert.equal(App.revenueSplit(waived), 0);
  const month = App.computeMetrics({ month: '2026-02', clientId: 'c3' });
  assert.equal(month.sessionCount, 1); assert.equal(month.gross, 0); assert.equal(month.hours, 1); assert.equal(month.miles, 4);
  assert.equal(month.outstanding, 0);
}

async function runAllPins(sources) {
  const document = recordingDocument();
  const { App } = await build({ sources, globals: { document } });
  pinComputeMetrics(App); pinPathsAgree(App); pinProjected(App, document); pinCashBasis(App); pinWaived(App);
}

test('money pins hold on the live source: computeMetrics == reportModel == Sessions Totals; projected; cash basis; waived', () => runAllPins());

/** Replace exactly one occurrence of `anchor` in a module; fail loudly if the source moved. */
function mutant(module, anchor, replacement) {
  const source = readSource('js/' + module + '.js');
  assert.equal(source.split(anchor).length, 2, 'mutation anchor missing or duplicated in ' + module + '.js: ' + anchor);
  return { [module]: source.replace(anchor, replacement) };
}

for (const [name, sources] of Object.entries({
  '(a) revenueAmount ignores the waived rule': () => mutant('app-core',
    'function revenueAmount(s) { return isWaived(s) ? 0 : num(s.amount); }', 'function revenueAmount(s) { return num(s.amount); }'),
  '(b) tax gross receipts drop the paid === true test': () => mutant('reports',
    "s.status === 'completed' && s.paid === true &&", "s.status === 'completed' &&"),
  '(c) events applied in reverse order': () => mutant('record-policy',
    '(events || []).forEach(ev => {', '(events || []).slice().reverse().forEach(ev => {'),
  '(d1) report model stops zeroing waived fees': () => mutant('report-model',
    "const waived=version!=='captured-v1'&&s.payment==='waived';", 'const waived=false;'),
  '(d2) Sessions Totals sums raw amounts': () => mutant('sessions',
    'const totalAmt = completed.reduce((sum, s) => sum + App.revenueAmount(s), 0);', 'const totalAmt = completed.reduce((sum, s) => sum + num(s.amount), 0);'),
  '(d3) computeMetrics counts cancelled sessions': () => mutant('app-core',
    "let rows = sessions.filter((s) => s.status === 'completed' && s.date);", 'let rows = sessions.filter((s) => s.date);'),
  '(d4) header Projected pill sums raw amounts': () => mutant('dashboard',
    'const projected = scheduled.reduce((sum, s) => sum + App.revenueAmount(s), 0);', 'const projected = scheduled.reduce((sum, s) => sum + App.num(s.amount), 0);'),
})) test('mutation ' + name + ' turns the money pins red', async () => {
  await assert.rejects(runAllPins(sources()), error => error instanceof assert.AssertionError, 'pins stayed green under mutation');
});
