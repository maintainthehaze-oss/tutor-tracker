'use strict';
// "This week" group in the Sessions tab (roadmap Slice B, 2026-10-11). FABRICATED DATA ONLY: this repository is public.
// The group model and its markup are pure functions (this-week.js). The taps run through the real ui.js click
// delegation with a fake DOM, a fake clock (2026-09-19, a Saturday) and an in-memory repository.
// Ported from the Dashboard strip tests of 2026-09-19 (commit 1d9eacc, strip removed 2026-09-29).
// No browser: this is unit-tested + static evidence, NOT observed live.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSource, command } = require('./helpers/harness.cjs');
const { bootUi } = require('./helpers/ui-app.cjs');
const { newSession } = require('./helpers/money-fixture.cjs');
const { analyzeSource } = require('./slice1/static-guard.cjs');

const TODAY = '2026-09-19';
const PAID_TITLE = 'Marked paid: un-pay with the pencil first';
const KEY = 'tutoring-last-seen';
const copy = x => JSON.parse(JSON.stringify(x));

function fixture(extraArchived = []) {
  const archived = (id, fields) => ({ id, clientIds: ['c3'], time: '15:00', duration: 1, amount: 80, companyAmount: 0, companySplit: 0, paid: false, payment: 'unpaid', mileage: 0, ...fields });
  return {
    syntheticOnly: true,
    clients: [
      { id: 'c1', firstName: 'Client', lastName: 'Alpha', rate: 100, status: 'active', familyGroup: 'Family Test-1', address: '100 Example Street, Faketown, NY 00000' },
      { id: 'c2', firstName: 'Client', lastName: 'Beta', rate: 60, status: 'active', familyGroup: 'Family Test-1', address: '100 Example Street, Faketown, NY 00000' },
      { id: 'c3', firstName: 'Client', lastName: 'Gamma', rate: 80, status: 'active', familyGroup: 'Family Test-2', address: '200 Sample Avenue, Mocksville, CT 00000' },
    ],
    // Pre-activation rows are locked from the start (archived).
    sessions: [
      archived('arch-paid', { date: '2026-09-15', status: 'completed', paid: true, payment: 'paid', paymentDate: '2026-09-15' }),
      archived('arch-sched', { date: '2026-09-24', status: 'scheduled' }),
      ...extraArchived.map(([id, fields]) => archived(id, fields)),
    ],
    expenses: [], taxPayments: [], historical: [], receipts: {}, settings: { mileageRate: 0.5 },
  };
}

/** Boot the real UI on the fake clock, then add post-activation rows through the repository. */
async function boot(options = {}) {
  const timers = [];
  const ui = await bootUi({ startAt: TODAY + 'T12:00:00', data: options.data || fixture(), storage: options.storage, stored: options.stored,
    globals: { setTimeout: (fn, ms) => { timers.push(ms); return timers.length; } } });
  const repo = ui.App.repository, save = (id, fields) => command(repo, 'session.save', { record: newSession(id, fields) });
  if (!options.stored) {
    await save('w-early', { clientIds: ['c3'], date: '2026-09-16', time: '09:30', amount: 80, status: 'completed' });
    await save('w-locked', { clientIds: ['c1'], date: '2026-09-16', amount: 100, status: 'completed' });                  // finalized, unpaid
    await save('w-paid', { clientIds: ['c2'], date: '2026-09-17', amount: 60, status: 'completed', paid: true, payment: 'paid', paymentDate: '2026-09-17' });
    await save('w-today', { clientIds: ['c1', 'c2'], date: TODAY, duration: 1.5, amount: 120, status: 'scheduled' });
    await save('w-today-2', { clientIds: ['c3'], date: TODAY, time: '18:00', amount: 80, status: 'scheduled' });
    await save('w-today-3', { clientIds: ['c3'], date: TODAY, time: '19:00', amount: 80, status: 'scheduled' });
    await save('w-prepaid', { clientIds: ['c3'], date: '2026-09-23', amount: 80, status: 'scheduled', paid: true, payment: 'paid', paymentDate: '2026-09-18' });
    // Stored WITHOUT a `paid` field, as older rows are. The read view adds paid:false, so only a re-save of the
    // STORED copy is byte-identical (that is what the Undo mutation check leans on).
    const { paid, ...olderShape } = newSession('w-future', { clientIds: ['c2'], date: '2026-09-22', amount: 60, status: 'scheduled' });
    await command(repo, 'session.save', { record: olderShape });
    // Window edges: today-7 and today+7 are in; today-8 and today+8 are out.
    await save('edge-in-first', { clientIds: ['c1'], date: '2026-09-12', amount: 100, status: 'completed' });
    await save('edge-in-last', { clientIds: ['c1'], date: '2026-09-26', amount: 100, status: 'scheduled' });
    await save('edge-out-before', { clientIds: ['c1'], date: '2026-09-11', amount: 100, status: 'completed' });
    await save('edge-out-after', { clientIds: ['c1'], date: '2026-09-27', amount: 100, status: 'scheduled' });
  }
  await ui.settle();

  // Toasts: ui.js builds each one with document.createElement; keep them and their button listeners.
  const toasts = [];
  ui.document.createElement = () => {
    const parts = new Map();
    const toast = { className: '', innerHTML: '', parentNode: null, classList: { add() {}, remove() {} },
      querySelector(selector) {
        if (!parts.has(selector)) { const listeners = {}; parts.set(selector, { listeners, addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); } }); }
        return parts.get(selector);
      },
      async press(selector) {
        assert.ok(toast.innerHTML.includes('class="' + selector.slice(1) + '"'), 'toast has no ' + selector + ': ' + toast.innerHTML);
        for (const listener of parts.get(selector).listeners.click) await listener();
        await ui.settle();
      } };
    toasts.push(toast);
    return toast;
  };
  const snapshot = () => repo.snapshot();
  return { ...ui, repo, toasts, timers, snapshot, save,
    stored: id => JSON.stringify(snapshot().working.sessions.find(s => s.id === id)),
    finalized: id => JSON.stringify(snapshot().finalized[id]),
    view: id => ui.App.state.sessions.find(s => s.id === id),
    events: () => copy(snapshot().events).map(e => [e.type, e.sessionId, e.fields || e.status]),
    owed: () => ui.App.computeOwedByFamily().total,
    errors: () => toasts.filter(t => /toast-(error|warning)/.test(t.className)).map(t => t.innerHTML),
    lifetimes: () => timers.filter(ms => ms === 3000 || ms === 8000),
    pending: () => copy(ui.App.thisWeek.pending()),
    html() { ui.App.renderThisWeek(); return ui.field('this-week-body').innerHTML; },
    tap: (action, id, status) => ui.click(action, { 'data-id': id, ...(status ? { 'data-status': status } : {}) }) };
}

const rowHtml = (html, id) => { const m = html.match(new RegExp('<li class="tw-row" data-id="' + id + '">.*?</li>')); assert.ok(m, 'no row for ' + id); return m[0]; };
const chips = row => [...row.matchAll(/<button type="button" class="duration-chip tw-chip( selected)?" data-action="([a-z-]+)"(?: data-status="([a-z-]+)")? data-id="[^"]+"(?: aria-pressed="(true|false)")?( disabled title="([^"]*)")?[^>]*>([^<]+)<\/button>/g)]
  .map(m => ({ lit: !!m[1], action: m[2], status: m[3], pressed: m[4], disabled: !!m[5], title: m[6], label: m[7] }));
const noticeHtml = html => { const m = html.match(/<section class="tw-notice"[^>]*>.*?<\/section>/); return m ? m[0] : ''; };

test('thisWeekDays (pure): 15 days around today, window edges, row modes, time order, exclusions', async () => {
  const ui = await boot(), App = ui.App;
  const days = copy(App.thisWeekDays(App.state.sessions, App.state.clients, TODAY));
  const rows = days.flatMap(d => d.rows), ids = rows.map(r => r.id);
  // Window edge: rows dated 09-11 (today-8) and 09-27 (today+8) are absent; 09-12 and 09-26 are present.
  assert.ok(!ids.includes('edge-out-before') && !ids.includes('edge-out-after'), 'a row outside today-7..today+7 leaked into the group: ' + ids);
  assert.ok(ids.includes('edge-in-first') && ids.includes('edge-in-last'), 'a row on the edge of the window is missing');
  assert.equal(days.length, 15);
  assert.deepEqual([days[0].date, days[7].date, days[14].date], ['2026-09-12', TODAY, '2026-09-26']);
  assert.deepEqual(days.filter(d => d.isToday).map(d => d.date), [TODAY]);
  assert.deepEqual(Object.fromEntries(rows.map(r => [r.id, r.mode])), {
    'edge-in-first': 'correct', 'arch-paid': 'paid', 'w-early': 'correct', 'w-locked': 'correct', 'w-paid': 'paid',
    'w-today': 'status', 'w-today-2': 'status', 'w-today-3': 'status', 'w-future': 'skip', 'w-prepaid': 'paid', 'arch-sched': 'correct', 'edge-in-last': 'skip' });
  assert.deepEqual(days.find(d => d.date === '2026-09-16').rows.map(r => r.id), ['w-early', 'w-locked'], 'rows within a day are in time order');
  const today = rows.find(r => r.id === 'w-today');
  assert.deepEqual([today.names, today.duration, today.amount, today.status], ['Client Alpha, Client Beta', 1.5, 120, 'scheduled']);
  assert.deepEqual(rows.filter(r => r.canMarkPaid).map(r => r.id), ['edge-in-first', 'w-early', 'w-locked']);
  // Rows drawn in the notice are excluded from their day.
  const excluded = copy(App.thisWeekDays(App.state.sessions, App.state.clients, TODAY, null, new Set(['w-locked']))).flatMap(d => d.rows).map(r => r.id);
  assert.ok(!excluded.includes('w-locked') && excluded.includes('w-early'));
  // Lock state is injectable, and the date steps never drift across a DST change (US: 2026-03-08 and 2026-11-01).
  assert.equal(App.thisWeekDays([{ id: 'x', date: TODAY, clientIds: [] }], [], TODAY, () => false)[7].rows[0].mode, 'status');
  for (const middle of ['2026-03-08', '2026-11-01']) {
    const dates = App.thisWeekDays([], [], middle).map(d => d.date), expected = [];
    for (let i = -7; i <= 7; i++) expected.push(new Date(Date.parse(middle + 'T00:00:00Z') + i * 864e5).toISOString().slice(0, 10));
    assert.deepEqual(copy(dates), expected);
  }
});

test('markup: chips per row state, paid rows disabled, today highlighted, names escaped, empty state, badge count', async () => {
  const ui = await boot(), html = ui.html();
  // Locked, completed, unpaid (dated 09-16): three chips, Completed lit, plus Mark paid.
  assert.deepEqual(chips(rowHtml(html, 'w-locked')).map(c => [c.label, c.action, c.status, c.lit, c.pressed, c.disabled]), [
    ['Completed', 'this-week-status', 'completed', true, 'true', false], ['No-show', 'this-week-status', 'no-show', false, 'false', false], ['Cancelled', 'this-week-status', 'cancelled', false, 'false', false]]);
  assert.match(rowHtml(html, 'w-locked'), /data-action="mark-paid" data-id="w-locked"/);
  // Unlocked future row: only Skip.
  assert.deepEqual(chips(rowHtml(html, 'w-future')).map(c => [c.label, c.action]), [['Skip', 'this-week-skip']]);
  assert.equal((rowHtml(html, 'w-future').match(/<button/g) || []).length, 1);
  // Unlocked row dated today: the three outcomes through session.update, none lit.
  assert.deepEqual(chips(rowHtml(html, 'w-today')).map(c => [c.label, c.action, c.lit]), [['Completed', 'quick-complete', false], ['No-show', 'quick-noshow', false], ['Cancelled', 'quick-cancel', false]]);
  // Paid rows (finalized, archived, and a prepaid future one): every chip disabled with the reason; no Mark paid.
  for (const id of ['w-paid', 'arch-paid', 'w-prepaid']) {
    const row = rowHtml(html, id), found = chips(row);
    assert.equal(found.length, 3, id);
    assert.deepEqual(found.map(c => [c.disabled, c.title]), Array(3).fill([true, PAID_TITLE]), id + ' must render its chips disabled');
    assert.equal((row.match(/<button/g) || []).length, 3, id + ' has a button that is not a disabled chip');
  }
  assert.deepEqual(chips(rowHtml(html, 'w-paid')).filter(c => c.lit).map(c => c.label), ['Completed']);
  assert.ok(!html.includes('edge-out-before') && !html.includes('edge-out-after'));
  assert.match(html, new RegExp('<section class="tw-day tw-today" data-date="' + TODAY + '">'));
  assert.equal((html.match(/tw-today/g) || []).length, 1, 'exactly one today section');
  assert.match(html, new RegExp('data-action="this-week-add" data-date="' + TODAY + '"'));
  assert.ok(!html.includes('data-date="2026-09-13"'), 'a day with no sessions (other than today) is not drawn');
  assert.equal(noticeHtml(html), '', 'nothing was auto-completed on this boot');
  assert.equal(ui.field('this-week-count').textContent, '12');
  // Pure markup: hostile names are escaped; an empty week says so and still offers today's "+".
  const App = ui.App, hostile = App.thisWeekHtml(App.thisWeekDays([{ id: 'x"><img src=x>', date: TODAY, time: '<b>', clientIds: ['h'], duration: 1, amount: 1, status: 'scheduled' }],
    [{ id: 'h', firstName: '<img src=x onerror=alert(1)>', lastName: '' }], TODAY, () => false));
  assert.ok(!/<img|<b>/.test(hostile), hostile);
  const empty = App.thisWeekHtml(App.thisWeekDays([], [], TODAY));
  assert.match(empty, /Nothing scheduled this week/); assert.match(empty, /data-action="this-week-add"/);
});

test('display order: today first, then the past newest-first, then the days ahead oldest-first under "Coming up"', async () => {
  const ui = await boot(), html = ui.html();
  const drawn = [...html.matchAll(/<section class="tw-day(?: tw-today)?" data-date="([0-9-]+)">/g)].map(m => m[1]);
  assert.equal(drawn[0], TODAY, 'today is at the top');
  const past = drawn.filter(d => d < TODAY), ahead = drawn.filter(d => d > TODAY);
  assert.ok(past.length >= 2 && ahead.length >= 1, 'fixture has past and future days: ' + drawn.join(','));
  assert.deepEqual(drawn, [TODAY, ...past, ...ahead], 'past block before the ahead block');
  assert.deepEqual(past, [...past].sort().reverse(), 'past days newest-first');
  assert.deepEqual(ahead, [...ahead].sort(), 'days ahead oldest-first');
  assert.equal((html.match(/<p class="tw-divider">Coming up<\/p>/g) || []).length, 1, 'exactly one divider');
  assert.match(html, new RegExp('<p class="tw-divider">Coming up</p><section class="tw-day" data-date="' + ahead[0] + '">'), 'divider sits right above the first day ahead');
  // Pure: with nothing ahead there is no divider; the model itself is still oldest-first (thisWeekDays is unchanged).
  const App = ui.App, model = App.thisWeekDays([{ id: 'p', date: '2026-09-18', clientIds: ['c1'], duration: 1, amount: 1 }], [{ id: 'c1', firstName: 'A', lastName: 'B' }], TODAY, () => false);
  assert.ok(!App.thisWeekHtml(model).includes('tw-divider'));
  assert.equal(JSON.stringify(App.thisWeekDisplayOrder(model).ordered.map(d => d.date).slice(0, 3)), JSON.stringify([TODAY, '2026-09-18', '2026-09-17']));
});

test('open/closed choice survives re-renders for the page load; the group starts open', async () => {
  const ui = await boot(), details = ui.field('this-week');
  ui.html(); assert.equal(details.open, true);
  details.open = false; ui.html(); assert.equal(details.open, false, 'a closed group stays closed after a re-render');
  details.open = true; ui.html(); assert.equal(details.open, true);
});

test('locked unpaid row: No-show appends exactly one correction, evidence byte-identical, Owed drops; Undo restores the exact total', async () => {
  const ui = await boot(), stored = ui.stored('w-locked'), finalized = ui.finalized('w-locked'), owed = ui.owed(), revision = ui.repo.revision;
  assert.equal(ui.view('w-locked').status, 'completed'); assert.deepEqual(ui.events(), []);
  await ui.tap('this-week-status', 'w-locked', 'no-show');
  assert.deepEqual(ui.errors(), [], 'the tap was refused');
  assert.deepEqual(ui.events(), [['correction', 'w-locked', { status: 'no-show' }]]);
  assert.equal(ui.repo.revision, revision + 1);
  assert.equal(ui.stored('w-locked'), stored, 'the stored row changed'); assert.equal(ui.finalized('w-locked'), finalized, 'the lock evidence changed');
  assert.equal(ui.view('w-locked').status, 'no-show'); assert.equal(ui.owed(), owed - 100);
  assert.deepEqual(chips(rowHtml(ui.html(), 'w-locked')).filter(c => c.lit).map(c => c.label), ['No-show']);
  assert.ok(!/mark-paid/.test(rowHtml(ui.html(), 'w-locked')));
  assert.match(ui.toasts.at(-1).innerHTML, /Marked as no-show.*<button type="button" class="toast-action">Undo<\/button>/);
  assert.equal(ui.lifetimes().at(-1), 8000, 'an Undo toast stays for 8 s');
  await ui.toasts.at(-1).press('.toast-action');
  assert.deepEqual(ui.errors(), []);
  assert.deepEqual(ui.events(), [['correction', 'w-locked', { status: 'no-show' }], ['correction', 'w-locked', { status: 'completed' }]]);
  assert.equal(ui.owed(), owed, 'Owed must return to the exact prior total');
  assert.equal(ui.stored('w-locked'), stored); assert.equal(ui.finalized('w-locked'), finalized);
  assert.ok(!ui.toasts.at(-1).innerHTML.includes('toast-action')); assert.equal(ui.lifetimes().at(-1), 3000, 'a plain toast keeps 3 s');
  // Pressing Undo twice, tapping the chip that is already lit, or sending an unknown status records nothing more.
  await ui.toasts.at(-2).press('.toast-action');
  await ui.tap('this-week-status', 'w-locked', 'completed');
  await ui.tap('this-week-status', 'w-locked', 'scheduled');
  assert.equal(ui.events().length, 2);
  // Locked rows change only through a correction: the direct commands still refuse.
  await assert.rejects(command(ui.repo, 'session.update', { ids: ['w-locked'], patch: { status: 'no-show' } }), /Read-only/);
  await assert.rejects(command(ui.repo, 'session.status', { ids: ['w-locked'], status: 'no-show' }), /Only pre-activation scheduled/);
});

test('future unlocked row: Skip deletes it, Undo restores a byte-identical stored record', async () => {
  const ui = await boot(), stored = ui.stored('w-future'), revision = ui.repo.revision, others = () => JSON.stringify(ui.snapshot().working.sessions.filter(s => s.id !== 'w-future'));
  const rest = others();
  assert.ok(!Object.hasOwn(JSON.parse(stored), 'paid') && ui.view('w-future').paid === false, 'fixture premise: the read view differs from the stored record');
  await ui.tap('this-week-skip', 'w-future');
  assert.deepEqual(ui.errors(), []);
  assert.equal(ui.stored('w-future'), undefined); assert.equal(ui.view('w-future'), undefined);
  assert.equal(ui.repo.revision, revision + 1); assert.equal(others(), rest); assert.deepEqual(ui.events(), []);
  assert.ok(!ui.html().includes('data-id="w-future"'));
  assert.match(ui.toasts.at(-1).innerHTML, /Session skipped.*class="toast-action">Undo</); assert.equal(ui.lifetimes().at(-1), 8000);
  await ui.toasts.at(-1).press('.toast-action');
  assert.deepEqual(ui.errors(), []);
  assert.equal(ui.stored('w-future'), stored, 'Undo must put back the stored record byte for byte');
  assert.equal(ui.repo.revision, revision + 2); assert.equal(others(), rest);
  assert.equal(ui.finalized('w-future'), undefined, 'a restored scheduled row is not locked');
  assert.deepEqual(chips(rowHtml(ui.html(), 'w-future')).map(c => c.action), ['this-week-skip']);
});

test('paid rows cannot be changed from the group, whatever the DOM sends', async () => {
  const ui = await boot(), before = JSON.stringify(ui.snapshot());
  for (const [action, id, status] of [['this-week-status', 'w-paid', 'no-show'], ['this-week-status', 'arch-paid', 'cancelled'], ['this-week-skip', 'w-prepaid'],
    ['quick-noshow', 'w-prepaid'], ['quick-cancel', 'w-prepaid'], ['quick-complete', 'w-prepaid']]) {
    await ui.tap(action, id, status);
    assert.equal(JSON.stringify(ui.snapshot()), before, action + ' changed a paid row: ' + id);
    assert.match(ui.toasts.at(-1).className, /toast-warning/); assert.ok(ui.toasts.at(-1).innerHTML.includes(PAID_TITLE));
  }
  assert.equal(ui.toasts.length, 6);
});

test('unlocked row dated today: the outcome locks it; Undo of No-show / Cancelled is a correction to completed; Completed has no Undo', async () => {
  const ui = await boot();
  for (const [action, id, status] of [['quick-noshow', 'w-today', 'no-show'], ['quick-cancel', 'w-today-2', 'cancelled']]) {
    const events = ui.events().length;
    await ui.tap(action, id);
    assert.deepEqual(ui.errors(), []);
    assert.equal(JSON.parse(ui.stored(id)).status, status); assert.equal(JSON.parse(ui.finalized(id)).record.status, status);
    assert.equal(ui.App.isProtectedSession(id), true); assert.equal(ui.events().length, events);
    const stored = ui.stored(id), finalized = ui.finalized(id);
    assert.equal(ui.lifetimes().at(-1), 8000);
    await ui.toasts.at(-1).press('.toast-action');
    assert.deepEqual(ui.events().at(-1), ['correction', id, { status: 'completed' }]); assert.equal(ui.events().length, events + 1);
    assert.equal(ui.view(id).status, 'completed'); assert.equal(ui.stored(id), stored); assert.equal(ui.finalized(id), finalized);
  }
  await ui.tap('quick-complete', 'w-today-3');
  assert.equal(JSON.parse(ui.finalized('w-today-3')).record.status, 'completed');
  assert.ok(!ui.toasts.at(-1).innerHTML.includes('toast-action')); assert.equal(ui.lifetimes().at(-1), 3000);
});

test('pre-activation scheduled row (locked): a chip records a correction; there is no Undo because it cannot return to scheduled', async () => {
  const ui = await boot(), stored = ui.stored('arch-sched');
  assert.deepEqual(chips(rowHtml(ui.html(), 'arch-sched')).map(c => [c.action, c.lit]), [['this-week-status', false], ['this-week-status', false], ['this-week-status', false]]);
  await ui.tap('this-week-status', 'arch-sched', 'cancelled');
  assert.deepEqual(ui.errors(), []);
  assert.deepEqual(ui.events(), [['correction', 'arch-sched', { status: 'cancelled' }]]);
  assert.equal(ui.stored('arch-sched'), stored); assert.equal(ui.view('arch-sched').status, 'cancelled');
  assert.ok(!ui.toasts.at(-1).innerHTML.includes('toast-action'));
});

test('auto-completed notice: rows completed on load are listed (any date) until reviewed or dismissed; the key holds ids only and survives a reload', async () => {
  // Two archived rows whose date has passed: one inside the window (09-14), one outside (09-01). init() auto-completes both.
  const ui = await boot({ data: fixture([['arch-over', { date: '2026-09-14', status: 'scheduled' }], ['arch-old', { date: '2026-09-01', status: 'scheduled', time: '' }]]) });
  assert.deepEqual(ui.pending().sort(), ['arch-old', 'arch-over']);
  assert.deepEqual(JSON.parse(ui.storage.getItem(KEY)).autoCompleted.sort(), ['arch-old', 'arch-over']);
  assert.deepEqual(Object.keys(JSON.parse(ui.storage.getItem(KEY))).sort(), ['at', 'autoCompleted'], 'ids and a time, nothing else');
  assert.ok(!ui.storage.getItem(KEY).includes('Gamma') && !ui.storage.getItem(KEY).includes('80'), 'no name or money in the key');
  let html = ui.html(), notice = noticeHtml(html);
  assert.match(notice, /2 sessions auto-completed since your last visit/);
  assert.match(notice, /data-action="this-week-dismiss"/);
  for (const id of ['arch-old', 'arch-over']) {
    assert.ok(notice.includes('data-id="' + id + '"'), id + ' missing from the notice');
    assert.deepEqual(chips(rowHtml(notice, id)).map(c => [c.action, c.lit]), [['this-week-status', true], ['this-week-status', false], ['this-week-status', false]], id + ' chips');
  }
  assert.match(rowHtml(notice, 'arch-old'), /Tue, Sep 1/, 'an out-of-window row shows its date');
  assert.match(rowHtml(notice, 'arch-over'), /Mon, Sep 14 &middot; 15:00/);
  // A noticed row is drawn once: not again under its day.
  assert.equal((html.match(/<li class="tw-row" data-id="arch-over">/g) || []).length, 1);
  assert.ok(!html.includes('data-date="2026-09-14"'), 'the day section is not drawn for a row that sits in the notice');
  assert.equal(ui.field('this-week-count').textContent, '14', '2 noticed + the 12 in-window rows');
  // Review: No-show on one of them is an ordinary correction; the row leaves the notice, returns to its day, and the key is pruned.
  await ui.tap('this-week-status', 'arch-over', 'no-show');
  assert.deepEqual(ui.errors(), []);
  assert.deepEqual(ui.events().at(-1), ['correction', 'arch-over', { status: 'no-show' }]);
  html = ui.html(); notice = noticeHtml(html);
  assert.match(notice, /1 session auto-completed/);
  assert.ok(!notice.includes('arch-over'));
  assert.match(html, /<section class="tw-day" data-date="2026-09-14">.*data-id="arch-over"/);
  assert.deepEqual(ui.pending(), ['arch-old']);
  // Reload with the same browser storage and the same records: the remaining notice is still there.
  const again = await boot({ storage: ui.storage, stored: ui.disk() });
  assert.deepEqual(again.pending(), ['arch-old']);
  assert.match(noticeHtml(again.html()), /1 session auto-completed since your last visit.*data-id="arch-old"/);
  // Dismiss: everything happened as planned. Key emptied, notice gone, nothing written to the records.
  const before = JSON.stringify(again.snapshot());
  await again.click('this-week-dismiss');
  assert.deepEqual(again.pending(), []);
  assert.deepEqual(JSON.parse(again.storage.getItem(KEY)).autoCompleted, []);
  assert.equal(noticeHtml(again.html()), '');
  assert.equal(JSON.stringify(again.snapshot()), before, 'dismiss never touches the store');
});

test('auto-completed notice: the unlocked (session.update) path is recorded too, and a missing localStorage is harmless', async () => {
  const ui = await boot();
  await ui.save('w-overdue', { clientIds: ['c1'], date: '2026-09-13', amount: 100, status: 'scheduled' });
  await ui.settle();
  assert.deepEqual(ui.pending(), []);
  assert.equal(await ui.App.autoCompleteOverdue(), 1);
  await ui.settle();
  assert.deepEqual(ui.pending(), ['w-overdue']);
  assert.equal(JSON.parse(ui.finalized('w-overdue')).record.status, 'completed');
  assert.match(noticeHtml(ui.html()), /1 session auto-completed.*data-id="w-overdue"/);
  // Storage that throws: the pure model still renders; the notice is simply per-load.
  const broken = { getItem() { throw Error('storage unavailable'); }, setItem() { throw Error('storage unavailable'); }, removeItem() {} };
  const quiet = await boot({ storage: broken });
  assert.deepEqual(quiet.pending(), []);
  quiet.App.thisWeek.recordAutoCompleted(['x']);
  assert.deepEqual(quiet.pending(), []);
  assert.match(quiet.html(), /tw-day tw-today/);
});

test('static: group sits above the Owed panel in the Sessions tab, renders first, existing commands only, one allow-listed key', () => {
  const html = readSource('index.html'), module = readSource('js/this-week.js'), sessions = readSource('js/sessions.js'), uiSource = readSource('js/ui.js'), repository = readSource('js/repository.js');
  const panel = html.slice(html.indexOf('id="panel-sessions"'), html.indexOf('id="panel-expenses"'));
  const group = panel.indexOf('<details class="monthly-summary this-week" id="this-week" open>'), owed = panel.indexOf('id="sessions-owed"'), table = panel.indexOf('id="sessions-table"');
  assert.ok(group > 0 && group < owed && owed < table, 'the group must sit in the Sessions panel above the Owed panel and the table');
  assert.match(panel, /<div class="this-week-body" id="this-week-body">/);
  assert.match(panel, /<span class="badge" id="this-week-count">/);
  assert.match(html, /js\/week-log\.js" defer><\/script>\s*<script src="js\/this-week\.js" defer><\/script>\s*<script src="js\/recurring\.js"/, 'script order');
  assert.match(sessions, /function renderSessions\(\) \{\s*if \(App\.renderThisWeek\) App\.renderThisWeek\(\);/, 'the group must render first in renderSessions');
  assert.match(sessions, /App\.thisWeek\.recordAutoCompleted\(completedIds\)/, 'auto-complete must report its ids');
  // Every command the UI issues is one the repository already has; the module itself issues none.
  const known = new Set([...repository.matchAll(/case '([a-z]+\.[A-Za-z]+)':/g)].map(m => m[1]));
  const issued = [...uiSource.matchAll(/runCommand\(\s*'([^']+)'/g)].map(m => m[1]);
  assert.ok(issued.includes('session.correct') && issued.includes('session.delete') && issued.includes('session.save') && issued.includes('session.update'));
  assert.deepEqual(issued.filter(name => !known.has(name)), []);
  assert.doesNotMatch(module, /App\.runCommand\(|repository\.execute\(|App\.state\.\w+\s*=|sessionStorage|indexedDB/);
  for (const action of ['this-week-status', 'this-week-skip', 'this-week-add', 'this-week-dismiss', 'quick-complete', 'quick-noshow', 'quick-cancel']) assert.ok(uiSource.includes("case '" + action + "':"), action);
  // The one localStorage key is allow-listed by the static guard; renaming it to a record key fails the guard.
  assert.equal((module.match(/localStorage\.(setItem|getItem)/g) || []).length, 2);
  assert.deepEqual(analyzeSource(module, 'this-week.js'), []);
  assert.ok(analyzeSource(module.replace("'tutoring-last-seen'", "'tutoring-sessions'"), 'this-week.js').length > 0, 'the guard must refuse a record key');
  assert.ok(readSource('styles.css').includes('.tw-chip:disabled'));
  // 2026-10-11: one-tap "Completed" on scheduled table rows reuses the chip's quick-complete path; the bulk mileage tool is on the toolbar too.
  assert.match(sessions, /!protectedRow && s\.status === 'scheduled' \? '<button class="btn btn-sm btn-complete" data-action="quick-complete"/, 'Completed button on unlocked scheduled rows');
  assert.equal((html.match(/data-action="calc-mileage-by-day"/g) || []).length, 2, 'Mileage button on the Sessions toolbar and in Settings');
  assert.ok(module.includes("label: 'Completed', quick: 'quick-complete'"), 'the chip says Completed');
  // 2026-10-11 simplification: 4-button toolbar + More menu, no Type column, Payment+Status one column, no Duplicate, no table Mark paid, 3 header pills.
  const toolbar = html.slice(html.indexOf('id="panel-sessions"'), html.indexOf('<!-- Month Navigator -->'));
  assert.deepEqual([...toolbar.matchAll(/data-action="([a-z-]+)"/g)].map(m => m[1]),
    ['toggle-filters', 'calc-mileage-by-day', 'toggle-split', 'toggle-edit-mode', 'export-sessions-csv', 'add-session', 'open-week-log'], 'toolbar actions in order');
  assert.ok(toolbar.includes('<details class="toolbar-more"') && toolbar.indexOf('toggle-split') > toolbar.indexOf('toolbar-more-menu'), 'split / edit / CSV sit under More');
  const thead = html.slice(html.indexOf('<table class="data-table" id="sessions-table">'), html.indexOf('<tbody id="sessions-tbody">'));
  assert.deepEqual([...thead.matchAll(/data-sort="([a-z]+)"/g)].map(m => m[1]), ['date', 'time', 'client', 'duration', 'amount', 'split', 'mileage', 'payment'], 'table columns');
  assert.ok(!sessions.includes('duplicate-session') && !uiSource.includes('duplicate-session'), 'Duplicate is gone');
  assert.ok(!sessions.includes('data-action="mark-paid"'), 'the table has no Mark paid (week group and Owed panel only)');
  assert.deepEqual([...html.matchAll(/data-stat="([a-z]+)"/g)].map(m => m[1]), ['projected', 'owed', 'backup'], 'header pills');
  assert.match(readSource('../SECURITY-PRIVACY.md'), /`tutoring-last-seen`/, 'the published privacy table must list the key');
});
