'use strict';
// FABRICATED DATA ONLY (this repository is public). Every name, address, rate and amount below is
// invented for the tests: "Client Alpha", "Family Test-1", round or deliberately awkward numbers.
const { activate, command } = require('./harness.cjs');

const MODULES = ['app-core', 'record-policy', 'repository', 'report-model', 'dashboard', 'sessions', 'reports'];

/** Pre-activation ("archived") records. `historical` stays empty so every code path sees the same rows. */
function rawFixture() {
  return {
    syntheticOnly: true,
    clients: [
      { id: 'c1', firstName: 'Client', lastName: 'Alpha', rate: 100, status: 'active', familyGroup: 'Family Test-1', address: '100 Example Street, Faketown, NY 00000' },
      { id: 'c2', firstName: 'Client', lastName: 'Beta', rate: 60, status: 'active', familyGroup: 'Family Test-1', address: '100 Example Street, Faketown, NY 00000' },
      { id: 'c3', firstName: 'Client', lastName: 'Gamma', rate: 80, status: 'active', familyGroup: 'Family Test-2', address: '200 Sample Avenue, Mocksville, CT 00000' },
      { id: 'c4', firstName: 'Client', lastName: 'Delta', rate: 62.5, status: 'active', address: '300 Placeholder Road, Mocksville, CT 00000' },
    ],
    sessions: [
      { id: 'a1', clientIds: ['c1'], date: '2026-02-03', duration: 1, amount: 100, companyAmount: 20, companySplit: 20, status: 'completed', paid: true, payment: 'paid', paymentDate: '2026-02-10', mileage: 10 },
      { id: 'a2', clientIds: ['c1', 'c2'], date: '2026-02-05', duration: 1.5, amount: 150, companyAmount: 0, companySplit: 0, status: 'completed', paid: false, payment: 'unpaid', mileage: 0 },
      { id: 'a3', clientIds: ['c3'], date: '2026-02-07', duration: 1, amount: 80, companyAmount: 0, companySplit: 0, status: 'completed', paid: false, payment: 'waived', mileage: 4 },
      { id: 'a4', clientIds: ['c3'], date: '2026-02-08', duration: 1, amount: 70, companyAmount: 0, companySplit: 0, status: 'cancelled', paid: false, payment: 'unpaid', mileage: 0 },
      { id: 'a5', clientIds: ['c3'], date: '2026-12-01', duration: 2, amount: 200, companyAmount: 0, companySplit: 0, status: 'scheduled', paid: false, payment: 'unpaid', mileage: 0 },
      { id: 'a6', clientIds: ['c2'], date: '2026-02-09', duration: 1, amount: 60, companyAmount: 0, companySplit: 0, status: 'scheduled', paid: false, payment: 'unpaid', mileage: 0 },
      { id: 'a7', clientIds: ['c3'], date: '2026-12-02', duration: 5, amount: 500, companyAmount: 0, companySplit: 0, status: 'scheduled', paid: false, payment: 'waived', mileage: 0 },
      // Sub-cent amount stored before cents rounding existed (62.50 x 0.83 h). Must keep loading and verifying.
      { id: 'a8', clientIds: ['c4'], date: '2026-02-11', duration: 0.83, amount: 51.875, companyAmount: 0, companySplit: 0, status: 'completed', paid: false, payment: 'unpaid', mileage: 0 },
    ],
    expenses: [{ id: 'e1', date: '2026-02-12', category: 'supplies', amount: 10 }],
    taxPayments: [],
    historical: [],
    receipts: {},
    settings: { mileageRate: 0.5 },
  };
}

const newSession = (id, fields) => ({ id, time: '16:00', type: 'in-person', duration: 1, paid: false, payment: 'unpaid', paymentDate: null, mileage: 0, notes: '', ...fields });

/**
 * Activate the fixture, add post-activation sessions (they finalize and lock), then record events:
 *   a6  status event -> completed, then a payment event dated the NEXT tax year (cash basis)
 *   n1  two corrections to the same field (last one must win: 90 then 95)
 *   n2  saved as paid, then corrected back to unpaid
 */
async function build(options) {
  const { App, disk } = await activate(MODULES, rawFixture(), options);
  const repo = App.repository;
  await command(repo, 'session.save', { record: newSession('n1', { clientIds: ['c1'], date: '2026-03-02', amount: 100, status: 'completed', mileage: 6 }) });
  await command(repo, 'session.save', { record: newSession('n2', { clientIds: ['c4'], date: '2026-03-03', duration: 2, amount: 125, status: 'completed', paid: true, payment: 'paid', paymentDate: '2026-03-04' }) });
  await command(repo, 'session.save', { record: newSession('n3', { clientIds: ['c2'], date: '2026-11-15', amount: 45.5, status: 'scheduled' }) });
  await command(repo, 'session.status', { ids: ['a6'], status: 'completed' });
  await command(repo, 'session.payment', { ids: ['a6'], date: '2027-01-05' });
  await command(repo, 'session.correct', { id: 'n1', fields: { amount: 90 } });
  await command(repo, 'session.correct', { id: 'n1', fields: { amount: 95 } });
  await command(repo, 'session.correct', { id: 'n2', fields: { paid: false, payment: 'unpaid', paymentDate: null } });
  App.refreshReadViews();
  return { App, repo, disk };
}

// Hand-calculated from the fixture above (effective values after events):
//   realized  a1 100 + a2 150 + a3 0 (waived) + a6 60 + a8 51.875 + n1 95 + n2 125
const EXPECTED = Object.freeze({
  sessionCount: 7, gross: 581.875, companySplit: 20, yourCut: 561.875, hours: 8.33, miles: 20,
  outstanding: 421.875, outstandingCount: 4,      // a2 150 + a8 51.875 + n1 95 + n2 125
  projected: 245.5, scheduledCount: 3,            // a5 200 + a7 0 (waived) + n3 45.5
  taxGross2026: 100, taxGross2027: 60,            // cash basis: a1 received 2026, a6 received 2027
});

module.exports = { MODULES, rawFixture, newSession, build, EXPECTED };
