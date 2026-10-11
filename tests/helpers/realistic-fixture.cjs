'use strict';
// FABRICATED DATA ONLY (this repository is public). Roadmap 4.7: a generator that reproduces the real
// store's SHAPE (not its content) so performance and UI work can be tested at realistic scale:
//   12 clients in 3 families, 144 sessions in the observed signature mix (family trio/duo rows, one
//   high-frequency single, weekly Tue/Thu/Mon slots, a batch-entry updatedAt cluster, structured notes,
//   10 future scheduled rows, one zero-duration cancelled row), 1,652 historical rows, and 107 events
//   seeded through the repository's own commands (payments arrive in lumps).
// Every name, address and amount is invented. Deterministic: the same seed gives the same JSON.
const { activate, command } = require('./harness.cjs');
const { MODULES } = require('./money-fixture.cjs');

const SHAPE = { clients: 12, families: 3, sessions: 144, historical: 1652, events: 107, future: 10, batchDay: '2026-06-04', batchRows: 78 };
const DAY = 86400000;

/** Small seeded PRNG (mulberry32) so fixtures are reproducible across runs and machines. */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const iso = d => new Date(d).toISOString().slice(0, 10);
const addDays = (date, n) => iso(Date.parse(date) + n * DAY);
const dow = date => new Date(date + 'T12:00:00Z').getUTCDay();
/** First date on or after `from` that falls on weekday `wd` (0 = Sunday). */
const nextDow = (from, wd) => addDays(from, (wd - dow(from) + 7) % 7);

const NAMES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Mu'];
const ADDRESSES = { A: '100 Example Street, Faketown, NY 00000', B: '200 Sample Avenue, Mocksville, CT 00000', C: '300 Placeholder Road, Mocksville, CT 00000' };

function clients() {
  // Family A = c2, c7, c8 (the trio); Family B = c5, c6; Family C = c9, c12. c3 inactive, c6 paused.
  const family = { c2: 'A', c7: 'A', c8: 'A', c5: 'B', c6: 'B', c9: 'C', c12: 'C' };
  const rates = { c1: 80, c2: 100, c3: 60, c4: 75, c5: 90, c6: 90, c7: 100, c8: 100, c9: 70, c10: 250, c11: 85, c12: 65 };
  return NAMES.map((last, i) => {
    const id = 'c' + (i + 1), fam = family[id];
    const c = { id, firstName: 'Client', lastName: last, rate: rates[id], status: 'active', defaultDuration: 1, address: fam ? ADDRESSES[fam] : `${400 + i * 10} Fabricated Lane, Faketown, NY 00000` };
    if (fam) c.familyGroup = 'Family Test-' + fam;
    if (id === 'c3') c.status = 'inactive';
    if (id === 'c6') c.status = 'paused';
    if (id === 'c1') c.subjects = 'Algebra';
    return c;
  });
}

/**
 * 144 sessions dated 2026-01-02 .. today+14 in the observed mix. Signature = clients + duration + amount + type.
 * Rows are generated per signature in date order, then the last `future` are scheduled.
 */
function sessions(random, today) {
  const rows = [], start = '2026-01-02';
  let n = 0;
  const push = (clientIds, date, duration, amount, extra = {}) => {
    n += 1;
    rows.push({ id: 's' + n, clientIds, date, time: extra.time || '16:00', duration, amount, companyAmount: 0, companySplit: 0,
      type: extra.type || 'in-person', status: 'completed', paid: false, payment: 'unpaid', paymentDate: null, mileage: extra.mileage ?? 0, notes: extra.notes || '' });
  };
  const weekly = (ids, wd, count, from, duration, amount, extra) => { let d = nextDow(from, wd); for (let i = 0; i < count; i++, d = addDays(d, 7)) push(ids, d, duration, amount, extra); };
  // Family A: 14 trio rows (2 h, $300), 12 duo rows (1.5 h, $150), 14 singles across c2/c7/c8.
  weekly(['c2', 'c7', 'c8'], 6, 14, start, 2, 300, { mileage: 12 });
  weekly(['c2', 'c8'], 3, 12, addDays(start, 7), 1.5, 150, { mileage: 12 });
  weekly(['c2'], 2, 6, addDays(start, 14), 1, 100, { mileage: 12 });
  weekly(['c7'], 4, 4, addDays(start, 21), 1, 100, { mileage: 12 });
  weekly(['c8'], 2, 4, addDays(start, 70), 1, 100, { mileage: 12 });
  // c10: 38 rows at 1-2 day gaps (1 h, $250). The highest-frequency single client.
  let d = addDays(start, 3);
  for (let i = 0; i < 38; i++, d = addDays(d, 1 + Math.round(random()))) push(['c10'], d, 1, 250, { mileage: 6, type: i % 9 === 0 ? 'online' : 'in-person' });
  // Weekly slots: c11 Tuesdays (5), c12 Mondays (3), c5 Wednesdays (12), c6 Wednesdays (6), c9 Fridays (10).
  weekly(['c11'], 2, 5, '2026-08-25', 1, 85, { mileage: 9 });
  weekly(['c12'], 1, 3, '2026-09-14', 1, 65, { mileage: 9 });
  weekly(['c5'], 3, 12, '2026-03-04', 1.5, 135, { mileage: 15 });
  weekly(['c6'], 3, 6, '2026-04-01', 1, 90, { mileage: 15 });
  weekly(['c9'], 5, 10, '2026-02-06', 1, 70, { mileage: 9 });
  // Scattered singles and the structured-note rows (hybrid / uneven / no charge).
  weekly(['c1'], 1, 16, '2026-01-05', 1, 80, { mileage: 5, type: 'online' });
  weekly(['c4'], 4, 10, '2026-05-07', 2, 150, { mileage: 7 });
  push(['c1'], '2026-03-21', 2.5, 200, { type: 'hybrid', notes: '120 min in person, 30 min remote', mileage: 5 });
  push(['c5', 'c6'], '2026-03-28', 3, 270, { notes: '2 h with one sibling, 1 h with the other', mileage: 15 });
  push(['c3'], '2026-02-14', 1, 0, { notes: 'no charge' });
  push(['c3'], '2026-01-02', 0, 0, { notes: 'cancelled' });
  rows[rows.length - 1].status = 'cancelled';
  if (rows.length !== SHAPE.sessions) throw new Error('signature mix drifted: ' + rows.length + ' rows');
  rows.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1);
  // Future rows are scheduled; the next 10 sessions after today become "entered ahead" rows (observed 2026-09-30).
  const future = rows.filter(r => r.date > today);
  future.forEach((r, i) => { r.status = 'scheduled'; r.date = addDays(today, 1 + (i % 14)); });
  rows.filter(r => r.date <= today && r.status === 'completed').forEach((r, i) => {
    // Lump payments: about 60% of past rows were paid in a stack; the rest are still owed.
    if (random() < 0.6) { r.paid = true; r.payment = 'paid'; r.paymentDate = r.date < '2026-06-01' ? '2026-06-04' : '2026-09-17'; }
    // Batch entry: 78 rows last touched on one day; the rest lag their date by 100+ days.
    r.updatedAt = i < SHAPE.batchRows ? SHAPE.batchDay + 'T21:00:00.000Z' : addDays(r.date, 100 + Math.floor(random() * 40)) + 'T20:00:00.000Z';
  });
  while (rows.filter(r => r.status === 'scheduled').length < SHAPE.future) {
    const r = rows.filter(r => r.status === 'completed' && !r.paid).pop();
    r.status = 'scheduled'; r.date = addDays(today, 1 + rows.filter(x => x.status === 'scheduled').length); delete r.updatedAt;
  }
  return rows;
}

/** 1,652 pre-2026 rows in the archived-history shape (historical.js reads only date and status). */
function historical(random) {
  const rows = [], amounts = ['80.00', '100.00', '150.00', '250.00', '300.00'];
  let d = '2023-01-03';
  for (let i = 1; i <= SHAPE.historical; i++) {
    const status = random() < 0.06 ? 'cancelled' : 'completed', amount = amounts[Math.floor(random() * amounts.length)];
    rows.push({ id: 'hist-' + i, date: d, status, amount, companyAmount: (Number(amount) * 0.2).toFixed(2) });
    if (random() < 0.55) d = addDays(d, 1);
    if (d >= '2025-12-31') d = '2023-01-03';
  }
  rows.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return rows;
}

function expenses(random) {
  const cats = ['supplies', 'software', 'mileage', 'other'];
  return Array.from({ length: 20 }, (_, i) => ({ id: 'exp-' + (i + 1), date: addDays('2026-01-10', i * 13), category: cats[i % cats.length], amount: Number((10 + random() * 90).toFixed(2)) }));
}

/** Raw (pre-activation) fixture in the shape `activateSynthetic` accepts. */
function generate({ seed = 1, today = '2026-10-11', receiptBytes = 0 } = {}) {
  const random = rng(seed);
  const exp = expenses(random);
  // The real store carries ~3.7 MB of receipt images (plan §4.2). Off by default so the suite stays fast;
  // pass receiptBytes (total) to pad fabricated base64 receipts across the expenses for latency work.
  const receipts = {};
  if (receiptBytes > 0) { const blob = 'data:image/png;base64,' + 'QUJD'.repeat(Math.ceil(receiptBytes / exp.length / 4)); exp.forEach(e => { receipts[e.id] = blob; }); }
  return {
    syntheticOnly: true,
    clients: clients(),
    sessions: sessions(random, today),
    expenses: exp,
    taxPayments: [1, 2, 3, 4].map(q => ({ id: 'tax-' + q, year: 2026, date: `2026-0${q * 2 + 1}-15`, amount: 400 })),
    historical: historical(random),
    receipts,
    settings: { mileageRate: 0.7, defaultSplit: 0 },
  };
}

/**
 * 107 events through the repository's own commands: 10 payments on one day (a family paying a stack),
 * the rest spread; status events on past scheduled rows; a few corrections. Returns the event count.
 */
async function seedEvents(repo, data, { today = '2026-10-11' } = {}) {
  const unpaid = data.sessions.filter(r => r.status === 'completed' && !r.paid && r.amount > 0).map(r => r.id);
  let n = 0;
  const pay = async (ids, date, method) => { await command(repo, 'session.payment', { ids, date, method }); n += ids.length; };
  await pay(unpaid.slice(0, 10), '2026-09-17', 'Zelle');            // the lump
  const rest = unpaid.slice(10);
  for (let i = 0; i < rest.length && n < 80; i += 10) await pay(rest.slice(i, i + 10), addDays('2026-07-01', i), (i / 10) % 2 ? 'Venmo' : undefined);
  const paidBefore = n;
  // Turn the 10 scheduled rows into 5 completed + 2 no-shows + 1 cancelled via status events (they are archived).
  const scheduled = data.sessions.filter(r => r.status === 'scheduled').map(r => r.id);
  await command(repo, 'session.status', { ids: scheduled.slice(0, 5), status: 'completed' }); n += 5;
  await command(repo, 'session.status', { ids: scheduled.slice(5, 7), status: 'no-show' }); n += 2;
  await command(repo, 'session.status', { ids: scheduled.slice(7, 8), status: 'cancelled' }); n += 1;
  // Corrections on locked rows (one "Fill missing mileage" batch) until the target count is reached.
  const targets = data.sessions.filter(r => r.status === 'completed').map(r => r.id);
  const items = Array.from({ length: SHAPE.events - n }, (_, i) => ({ id: targets[i % targets.length], fields: { mileage: 10 + (i % 5) } }));
  await command(repo, 'session.correctMany', { items }); n += items.length;
  return { events: n, payments: paidBefore };
}

/** Activated app on the realistic fixture with events seeded. */
async function buildRealistic(options = {}) {
  const data = generate(options);
  const { App, disk, context, run } = await activate(options.modules || MODULES, data, options);
  const seeded = await seedEvents(App.repository, data, options);
  if (App.refreshReadViews) App.refreshReadViews();
  return { App, repo: App.repository, disk, context, run, data, seeded };
}

module.exports = { SHAPE, generate, seedEvents, buildRealistic };
