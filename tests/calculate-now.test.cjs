'use strict';
// Mileage "Calculate now" (2026-11-09): an offline planner over the owner's own earlier legs, OpenRouteService
// only for a leg shape history cannot answer, and a review list before any write. Replaces the whole-history
// "Calculate mileage by day" rewrite. FABRICATED DATA ONLY (addresses, names, miles). Unit-tested, NOT observed live.
const test = require('node:test');
const assert = require('node:assert/strict');
const { activate, command, stubUi, recordingDocument, readSource } = require('./helpers/harness.cjs');

const MODULES = ['app-core', 'record-policy', 'repository', 'report-model', 'dashboard', 'sessions', 'session-table', 'session-form', 'mileage'];
const HOME = '1 Fixture Way, Faketown, NY 00000';
const A = '100 Example Street, Faketown, NY 00000', B = '200 Sample Avenue, Mocksville, CT 00000', C = '300 Placeholder Road, Mocksville, CT 00000';
const LONE = 'Leg 1 of 1 + return home (driving route, day order)';
const L1of2 = 'Leg 1 of 2 (driving route, day order)', L2of2 = 'Leg 2 of 2 + return home (driving route, day order)';
const shape = (from, to, last) => from + '|' + to + '|' + (last ? 'home' : 'on');

const clients = () => [
  { id: 'c1', firstName: 'Client', lastName: 'Alpha', rate: 100, status: 'active', address: A },
  { id: 'c2', firstName: 'Client', lastName: 'Beta', rate: 60, status: 'active', address: B },
  { id: 'c3', firstName: 'Client', lastName: 'Gamma', rate: 80, status: 'active', address: C },
  { id: 'c4', firstName: 'Client', lastName: 'Delta', rate: 70, status: 'active' },           // no address on file
];
let seq = 0;
const day = (month, d) => '2026-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0');
/** One pre-activation (locked) in-person session. */
const row = (clientIds, date, time, mileage, details, extra = {}) => ({ id: 'r' + (++seq), clientIds, date, time, type: 'in-person', duration: 1, amount: 100,
  status: 'completed', paid: false, payment: 'unpaid', mileage, mileageDetails: details, mileageManual: false, mileageCalculated: details !== '', ...extra });
/** n lone days for one client in one month, at `miles`, labelled `details` (default: the correct lone-day label). */
const lone = (client, month, n, miles, details = LONE) => Array.from({ length: n }, (_, i) => row([client], day(month, 1 + i), '16:00', miles, details));

/** Deterministic ORS stand-in: geocode = a per-address index, directions = miles from `table` (missing pair = no route). */
function orsMock(table, status) {
  const calls = { geocode: 0, route: 0 }, coords = new Map();
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  const fetch = async (url, options) => {
    if (status) return { ok: false, status };
    if (url.includes('/geocode/search')) {
      calls.geocode++;
      const text = new URL(url).searchParams.get('text');
      if (!coords.has(text)) coords.set(text, coords.size + 1);
      return ok({ features: [{ geometry: { coordinates: [coords.get(text), 0] } }] });
    }
    calls.route++;
    const [[a], [b]] = JSON.parse(options.body).coordinates;
    const name = (i) => [...coords.entries()].find(([, v]) => v === i)[0];
    const miles = table[name(a) + '|' + name(b)];
    return miles == null ? { ok: false, status: 404 } : ok({ routes: [{ summary: { distance: miles * 1609.34 } }] });
  };
  return { fetch, calls };
}

/** The real modules over fabricated rows, a recording DOM for the review list, and the mocked ORS. */
async function scenario(sessions, options = {}) {
  const ors = orsMock(options.miles || {}, options.orsStatus);
  const document = recordingDocument();
  const data = { syntheticOnly: true, clients: clients(), sessions, expenses: [], taxPayments: [], historical: [], receipts: {}, settings: { mileageRate: 0.5 } };
  const { App, disk } = await activate(MODULES, data, { globals: { document, fetch: ors.fetch, setTimeout: (fn) => { fn(); return 0; } } });
  await command(App.repository, 'settings.update', { patch: { businessAddress: HOME, orsApiKey: 'synthetic-key-only' } });
  App.refreshReadViews();
  const toasts = stubUi(App);
  const opened = [], confirms = [];
  App.openModal = (id) => opened.push(id);
  App.showConfirm = (title, message, cb) => { confirms.push(message); App.state.confirmCallback = cb; };
  const list = document.getElementById('calc-now-list');
  const days = () => [...new Set(App.state.sessions.map((s) => s.date))].sort().map((d) => App.mileage.dayShapes(d, HOME));
  return { App, disk, toasts, ors, opened, confirms, list, days, plan: () => App.mileage.planCalculateNow() };
}
// Values born inside the vm context carry that realm's prototypes: clone before deepEqual (as the other suites do).
const copy = (x) => JSON.parse(JSON.stringify(x));
const brief = (list) => copy(list).map((p) => [p.id, p.old, p.miles, p.reason, p.source, p.label]);

test('consensus: 2+ agreeing rows with the right label make a shape known; a tie, one row, or rows whose label does not fit their day never do', async () => {
  seq = 0;
  const sessions = [
    ...lone('c1', 1, 3, 12.9),                       // home -> A -> home: 3 agree
    ...lone('c2', 2, 2, 8.0), ...lone('c2', 3, 2, 9.0), // home -> B -> home: 2 vs 2, a tie
    ...lone('c3', 4, 1, 20.0),                       // home -> C -> home: one row only
    ...lone('c1', 5, 4, 30.0, L1of2),                // lone Alpha days wearing a two-stop label: stale, must not vote (4 > 3)
  ];
  const s = await scenario(sessions);
  const known = s.App.mileage.shapeConsensus(s.days());
  assert.equal(known.get(shape(HOME, A, true)), 12.9, 'the three correct rows win; the four mislabelled rows do not vote');
  assert.equal(known.has(shape(HOME, B, true)), false, 'a tie is unknown');
  assert.equal(known.has(shape(HOME, C, true)), false, 'a single row is unknown');
  assert.equal(known.size, 1);
});

test('detection: blank, an older tool label, and a jump over 10% are proposed from history; 10% or less is left alone with no flag', async () => {
  seq = 0;
  const sessions = [...lone('c1', 1, 5, 12.9),
    row(['c1'], day(2, 1), '16:00', 0, ''),                                   // blank
    row(['c1'], day(2, 2), '16:00', 25.8, 'Driving route, round trip: ' + A), // the 2026-09-15 round-trip tool's label
    row(['c1'], day(2, 3), '16:00', 19.2, LONE),                              // jump (+49%)
    row(['c1'], day(2, 4), '16:00', 13.9, LONE),                              // +7.8%: left alone
    row(['c1'], day(2, 5), '16:00', 14.1, LONE),                              // +9.3%: left alone
    row(['c1'], day(2, 6), '16:00', 14.3, LONE),                              // +10.9%: jump
    row(['c1'], day(2, 7), '16:00', 11.7, LONE),                              // -9.3%: left alone
  ];
  const s = await scenario(sessions);
  const plan = s.plan();
  assert.deepEqual(brief(plan.proposals), [
    ['r6', 0, 12.9, 'blank', 'history', LONE], ['r7', 25.8, 12.9, 'stale', 'history', LONE],
    ['r8', 19.2, 12.9, 'jump', 'history', LONE], ['r11', 14.3, 12.9, 'jump', 'history', LONE]]);
  assert.deepEqual(copy([plan.lookups, plan.skipped]), [[], []]);
  const feb4 = s.days().find((d) => d.date === day(2, 4));
  assert.equal(s.App.mileage.rowIssue(feb4.stops[0], new Map([[shape(HOME, A, true), 12.9]])), null, '13.9 on a correct label: no issue');
});

test('manual rows and root-app "(real route)" rows are never proposed, even far off the known value, but still shape the day', async () => {
  seq = 0;
  const sessions = [...lone('c1', 1, 3, 12.9),
    row(['c1'], day(2, 1), '16:00', 50, '', { mileageManual: true }), row(['c2'], day(2, 1), '18:00', 0, ''),
    row(['c1'], day(2, 2), '16:00', 11.0, 'Leg 1 of 2 (real route)'), row(['c2'], day(2, 2), '18:00', 0, ''),
    row(['c1'], day(2, 3), '16:00', 50, LONE, { mileageManual: true }),      // typed over an auto value: 4x the known, still final
  ];
  const s = await scenario(sessions);
  const plan = s.plan();
  assert.deepEqual(copy(plan.proposals), []);
  assert.deepEqual(copy(plan.lookups.map((x) => [x.session.id, x.from, x.address, x.last, x.reason])),
    [['r5', A, B, true, 'blank'], ['r7', A, B, true, 'blank']], 'the Beta stops come after the untouchable Alpha stop, so their leg starts at A');
  assert.deepEqual([...plan.addresses].sort(), [A, B, HOME].sort(), 'the disclosure counts the lookup legs only');
});

test('known shape: Calculate now opens the review straight away with no confirm and no OpenRouteService call', async () => {
  seq = 0;
  const s = await scenario([...lone('c1', 1, 3, 12.9), row(['c1'], day(2, 1), '16:00', 0, ''), row(['c1'], day(2, 2), '16:00', 19.2, LONE)]);
  assert.equal(await s.App.calculateNow(), true);
  assert.deepEqual([s.confirms, s.opened, s.ors.calls], [[], ['modal-calc-now'], { geocode: 0, route: 0 }]);
  assert.match(s.list.innerHTML, /Alpha/);
  assert.match(s.list.innerHTML, /0\.0 &rarr; <strong>12\.9<\/strong>/);
  assert.match(s.list.innerHTML, /calc-tag-blank[^<]*>Blank</);
  assert.match(s.list.innerHTML, /calc-tag-jump[^<]*>Jump</);
  assert.equal((s.list.innerHTML.match(/<input type="checkbox" checked data-id="r\d+"/g) || []).length, 2, 'every row ticked by default');
  assert.doesNotMatch(s.list.innerHTML, /on\w+=|<script/, 'no inline handlers (CSP)');
});

test('unknown shape: confirm names the address count, ORS routes only the legs needed, rows are tagged "New route"', async () => {
  seq = 0;
  const s = await scenario([...lone('c1', 1, 3, 12.9), row(['c1'], day(2, 1), '16:00', 0, ''), row(['c2'], day(2, 1), '18:00', 0, ''), row(['c1'], day(2, 2), '16:00', 0, '')],
    { miles: { [HOME + '|' + A]: 10.0, [A + '|' + B]: 5.0, [B + '|' + HOME]: 9.0 } });
  const rev = s.App.repository.revision;
  assert.equal(await s.App.calculateNow(), true);
  assert.equal(s.confirms.length, 1);
  assert.match(s.confirms[0], /^2 sessions have a leg your earlier sessions have never driven/);
  assert.match(s.confirms[0], /Up to 3 addresses go to OpenRouteService; 1 other change is answered from your own history, offline\./);
  assert.deepEqual(s.opened, [], 'nothing opens before the confirm');
  await s.App.state.confirmCallback();
  assert.deepEqual(s.ors.calls, { geocode: 3, route: 3 }, 'home->A, A->B, B->home; nothing for the lone Alpha day');
  assert.deepEqual(s.opened, ['modal-calc-now']);
  assert.match(s.list.innerHTML, /calc-tag-new[^<]*>New route, check it</);
  // The lone Alpha day (known shape) rides along, answered offline.
  assert.match(s.list.innerHTML, /0\.0 &rarr; <strong>12\.9<\/strong>/);
  assert.match(s.list.innerHTML, /0\.0 &rarr; <strong>10\.0<\/strong>/);
  assert.match(s.list.innerHTML, /0\.0 &rarr; <strong>14\.0<\/strong>/);
  assert.equal(s.App.repository.revision, rev, 'nothing written until Save selected');
});

test('a fatal ORS error aborts with a toast and writes nothing; a day with no route is skipped and counted', async () => {
  seq = 0;
  const rows = () => [row(['c1'], day(2, 1), '16:00', 0, ''), row(['c2'], day(2, 1), '18:00', 0, ''), row(['c3'], day(2, 2), '16:00', 0, '')];
  const bad = await scenario(rows(), { orsStatus: 401 });
  const rev = bad.App.repository.revision;
  await bad.App.calculateNow(); await bad.App.state.confirmCallback();
  assert.deepEqual(bad.toasts.at(-1), ['error', 'OpenRouteService rejected the API key. Check it in Settings.']);
  assert.deepEqual([bad.opened, bad.App.repository.revision], [[], rev]);
  seq = 0;
  const partial = await scenario(rows(), { miles: { [HOME + '|' + C]: 7.0, [C + '|' + HOME]: 7.0 } }); // no route for the Alpha/Beta day
  await partial.App.calculateNow(); await partial.App.state.confirmCallback();
  assert.deepEqual(partial.opened, ['modal-calc-now']);
  assert.match(partial.list.innerHTML, /Gamma/);
  assert.doesNotMatch(partial.list.innerHTML, /Alpha|Beta/);
  assert.match(partial.App.$('calc-now-note').textContent, /^1 day skipped \(Feb 1, 2026\)/);
});

test('days without a reliable order (2+ stops, a blank time) or with a missing address propose nothing and are counted only when something there needs work', async () => {
  seq = 0;
  const sessions = [...lone('c1', 1, 3, 12.9),
    row(['c1'], day(2, 1), '', 0, ''), row(['c2'], day(2, 1), '16:00', 8.0, LONE),          // blank time + a blank row: skipped
    row(['c4'], day(2, 2), '16:00', 0, ''), row(['c1'], day(2, 2), '18:00', 0, ''),         // Delta has no address: skipped
    row(['c1'], day(2, 3), '', 10.0, L1of2), row(['c2'], day(2, 3), '16:00', 9.0, L2of2),   // blank time but both labels fit a 2-stop day: left alone, not counted
    row(['c1'], day(2, 4), '', 0, ''),                                                       // lone row with a blank time: order is trivial, proposed
  ];
  const s = await scenario(sessions);
  const plan = s.plan();
  assert.deepEqual(copy(plan.skipped), [day(2, 1), day(2, 2)]);
  assert.deepEqual(brief(plan.proposals), [['r10', 0, 12.9, 'blank', 'history', LONE]]);
  assert.deepEqual(copy(plan.lookups), []);
  // Only skipped days: the toast says so and nothing opens.
  seq = 0;
  const only = await scenario([...lone('c1', 1, 3, 12.9), row(['c1'], day(2, 1), '', 0, ''), row(['c2'], day(2, 1), '16:00', 8.0, LONE)]);
  assert.equal(await only.App.calculateNow(), false);
  assert.deepEqual(only.toasts.at(-1), ['warning', 'Nothing to calculate: every routed session matches its day. 1 day skipped: a session there has no time or no address, so its legs cannot be placed.']);
  assert.deepEqual(only.opened, []);
});

test('a cancelled partner changes the day: "Leg 2 of 2" becomes a lone stop, relabelled and valued from the lone-day history', async () => {
  seq = 0;
  const s = await scenario([...lone('c1', 1, 3, 12.9),
    row(['c2'], day(2, 1), '15:00', 0, '', { status: 'cancelled' }), row(['c1'], day(2, 1), '16:00', 20.0, L2of2)]);
  assert.deepEqual(brief(s.plan().proposals), [['r5', 20.0, 12.9, 'stale', 'history', LONE]]);
  // Nothing to do when every row already matches its day.
  seq = 0;
  const clean = await scenario(lone('c1', 1, 3, 12.9));
  assert.equal(await clean.App.calculateNow(), false);
  assert.deepEqual(clean.toasts.at(-1), ['info', 'Nothing to calculate: every routed session matches its day.']);
});

test('a day with 11 rows at the usual value and 2 inflated ones resolves to the usual value and flags the 2', async () => {
  seq = 0;
  const s = await scenario([...lone('c1', 1, 11, 12.9), ...lone('c1', 2, 2, 19.2)]);
  assert.deepEqual(brief(s.plan().proposals), [['r12', 19.2, 12.9, 'jump', 'history', LONE], ['r13', 19.2, 12.9, 'jump', 'history', LONE]]);
});

test('Save selected writes ticked rows only: unlocked rows update in place, locked rows take one correctMany; Cancel writes nothing', async () => {
  seq = 0;
  const s = await scenario([...lone('c1', 1, 3, 12.9), row(['c1'], day(2, 1), '16:00', 0, ''), row(['c1'], day(2, 2), '16:00', 19.2, LONE)]);
  const repo = s.App.repository;
  await command(repo, 'session.save', { record: { ...row(['c1'], day(3, 1), '16:00', 0, ''), id: 'open1', status: 'scheduled' } });  // stays unlocked
  s.App.refreshReadViews();
  // Open, then cancel: no write.
  assert.equal(await s.App.calculateNow(), true);
  const before = repo.revision, events = s.disk().events.length;
  s.App.closeModal('modal-calc-now');
  assert.equal(repo.revision, before);
  // Open again; the owner unticks the jump row.
  await s.App.calculateNow();
  const ids = [...s.list.innerHTML.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['r4', 'r5', 'open1']);
  s.list.querySelectorAll = () => ids.map((id) => ({ checked: id !== 'r5', getAttribute: () => id }));
  assert.equal(await s.App.saveCalculateNow(), true);
  assert.deepEqual(s.toasts.at(-1), ['success', 'Mileage set on 2 sessions. 1 left as it was.']);
  const disk = s.disk();
  assert.equal(repo.revision, before + 2, 'one session.update + one session.correctMany');
  assert.deepEqual(disk.events.slice(events).map((e) => [e.type, e.sessionId, e.fields]),
    [['correction', 'r4', { mileage: 12.9, mileageCalculated: true, mileageManual: false, mileageDetails: LONE }]]);
  const open = disk.working.sessions.find((x) => x.id === 'open1');
  assert.deepEqual([open.mileage, open.mileageDetails, open.mileageManual, open.mileageCalculated], [12.9, LONE, false, true]);
  assert.equal(disk.working.sessions.find((x) => x.id === 'r5').mileage, 19.2, 'the unticked locked row keeps its original');
  assert.equal(s.disk().events.some((e) => e.sessionId === 'r5'), false, 'and gains no correction');
  // Second run: the saved rows now match, only the unticked jump remains.
  assert.deepEqual(brief(s.plan().proposals), [['r5', 19.2, 12.9, 'jump', 'history', LONE]]);
});

test('static: review modal markup, Settings hint, tag styles, and the pin button points at the new flow', () => {
  const html = readSource('index.html'), css = readSource('styles.css'), js = readSource('js/mileage.js');
  assert.match(html, /<div class="modal-overlay" id="modal-calc-now" role="dialog"[^>]*hidden>/);
  assert.match(html, /<div id="calc-now-list"><\/div>/);
  assert.match(html, /data-action="calc-now-save">Save selected</);
  assert.ok(html.indexOf('data-action="calc-now">Calculate now') > html.indexOf('id="modal-settings"'), 'Settings button uses the same action');
  assert.match(html, /Checks every day offline against the legs you have already driven/);
  for (const tag of ['blank', 'jump', 'new']) assert.match(css, new RegExp('\\.calc-tag-' + tag + ' \\{[^}]*color: var\\(--color-'), tag + ' tag has its own colour');
  assert.match(js, /press "Calculate now" on the Sessions tab after saving/, 'the pin button no longer sends the owner to the retired tool');
  assert.doesNotMatch(js, /settings\.update|routeTable|localStorage/, 'the planner persists nothing outside the session rows');
});
