'use strict';
// FABRICATED DATA ONLY (this repository is public): "Client Alpha", "Family Test-1", invented rates and addresses.
// Shared by tests/recurring-engine.test.cjs and by the child processes it starts under other time zones.
// Run directly (node recurring-scenarios.cjs) it prints { offsets, report } as JSON for the parent to compare.
const { loadApp } = require('./harness.cjs');

const TODAY = '2026-09-19'; // a Saturday
const SLOT = 'slot-tue';
const ADDRESS = '100 Example Street, Faketown, NY 00000';

const engine = () => loadApp(['app-core', 'sessions', 'recurring']).recurring;
const slot = fields => ({ id: SLOT, anchor: '2026-09-22', every: 1, time: '16:00', duration: 1, type: 'in-person', with: [], through: null, ...fields });
/** c1 owns the slots. c2 is the sibling (same family, same address). c3 is unrelated. */
const clients = (slots = [slot()], overrides = {}) => [
  { id: 'c1', firstName: 'Client', lastName: 'Alpha', rate: 100, status: 'active', familyGroup: 'Family Test-1', address: ADDRESS, slots, ...overrides.c1 },
  { id: 'c2', firstName: 'Client', lastName: 'Beta', rate: 60, status: 'active', familyGroup: 'Family Test-1', address: ADDRESS, ...overrides.c2 },
  { id: 'c3', firstName: 'Client', lastName: 'Gamma', rate: 80, status: 'active', familyGroup: 'Family Test-2', address: '200 Sample Avenue, Mocksville, CT 00000', ...overrides.c3 },
];

/** What the slice-3 writer will do with a plan: drop removeIds, add create, replace the marked slots. */
function applyPlan(plan, clientRows, sessionRows) {
  const gone = new Set(plan.removeIds.map(String)), marks = new Map(plan.clients.map(m => [String(m.id), m.slots]));
  return {
    sessions: JSON.parse(JSON.stringify([...sessionRows.filter(s => !gone.has(String(s.id))), ...plan.create])),
    clients: JSON.parse(JSON.stringify(clientRows.map(c => (marks.has(String(c.id)) ? { ...c, slots: marks.get(String(c.id)) } : c)))),
  };
}

/** Inputs whose output must not depend on the machine's time zone, including windows that span DST changes
 *  (US: 2026-11-01 and 2027-03-14; New Zealand: 2026-09-27 and 2027-04-04). */
function tzReport() {
  const R = engine(), plan = (c, s, today) => JSON.parse(JSON.stringify(R.materializeRecurring(c, s, today)));
  const first = plan(clients(), [], TODAY), applied = applyPlan(first, clients(), []);
  return {
    base: first,
    fedBack: plan(applied.clients, applied.sessions, TODAY),
    biweekly: plan(clients([slot({ every: 2 })]), [], TODAY),
    gaps: plan(clients([slot({ anchor: '2026-08-04', through: '2026-08-25' })]), [], TODAY),
    paused: plan(applyPlan(first, clients([slot()], { c1: { status: 'paused' } }), []).clients, applied.sessions, TODAY),
    spansUsFallBack: plan(clients(), [], '2026-10-20'),
    spansUsSpringForward: plan(clients(), [], '2027-03-01'),
    spansNzFallBack: plan(clients(), [], '2027-03-20'),
    dayNums: ['2026-09-19', '2026-11-01', '2027-03-14', '2027-04-04'].map(R.dayNum),
  };
}

module.exports = { TODAY, SLOT, ADDRESS, engine, slot, clients, applyPlan, tzReport };

if (require.main === module) {
  process.stdout.write(JSON.stringify({ offsets: [new Date(2026, 0, 15, 12).getTimezoneOffset(), new Date(2026, 6, 15, 12).getTimezoneOffset()], report: tzReport() }));
}
