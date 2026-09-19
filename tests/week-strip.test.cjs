'use strict';
// "This week" strip (recurring-slots design, Slice 1). FABRICATED DATA ONLY: this repository is public.
// The strip model and its markup are pure functions. The taps run through the real ui.js click delegation
// with a fake DOM, a fake clock (2026-09-19, a Saturday) and an in-memory repository.
// No browser: this is unit-tested + static evidence, NOT observed live.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSource, command } = require('./helpers/harness.cjs');
const { bootUi } = require('./helpers/ui-app.cjs');
const { newSession } = require('./helpers/money-fixture.cjs');

const TODAY = '2026-09-19';
const PAID_TITLE = 'Marked paid: un-pay with the pencil first';
const copy = x => JSON.parse(JSON.stringify(x));

function fixture() {
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
    ],
    expenses: [], taxPayments: [], historical: [], receipts: {}, settings: { mileageRate: 0.5 },
  };
}

/** Boot the real UI on the fake clock, then add post-activation rows through the repository. */
async function boot() {
  const timers = [];
  const ui = await bootUi({ startAt: TODAY + 'T12:00:00', data: fixture(), globals: { setTimeout: (fn, ms) => { timers.push(ms); return timers.length; } } });
  const repo = ui.App.repository, save = (id, fields) => command(repo, 'session.save', { record: newSession(id, fields) });
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
  return { ...ui, repo, toasts, timers, snapshot,
    stored: id => JSON.stringify(snapshot().working.sessions.find(s => s.id === id)),
    finalized: id => JSON.stringify(snapshot().finalized[id]),
    view: id => ui.App.state.sessions.find(s => s.id === id),
    events: () => copy(snapshot().events).map(e => [e.type, e.sessionId, e.fields || e.status]),
    owed: () => ui.App.computeOwedByFamily().total,
    errors: () => toasts.filter(t => /toast-(error|warning)/.test(t.className)).map(t => t.innerHTML),
    lifetimes: () => timers.filter(ms => ms === 3000 || ms === 8000),
    html() { ui.App.renderWeekStrip(); return ui.field('week-strip-body').innerHTML; },
    tap: (action, id, status) => ui.click(action, { 'data-id': id, ...(status ? { 'data-status': status } : {}) }) };
}

const rowHtml = (html, id) => { const m = html.match(new RegExp('<li class="strip-row" data-id="' + id + '">.*?</li>')); assert.ok(m, 'no strip row for ' + id); return m[0]; };
const chips = row => [...row.matchAll(/<button type="button" class="duration-chip strip-chip( selected)?" data-action="([a-z-]+)"(?: data-status="([a-z-]+)")? data-id="[^"]+"(?: aria-pressed="(true|false)")?( disabled title="([^"]*)")?[^>]*>([^<]+)<\/button>/g)]
  .map(m => ({ lit: !!m[1], action: m[2], status: m[3], pressed: m[4], disabled: !!m[5], title: m[6], label: m[7] }));

test('weekStripDays (pure): 15 days around today, window edges, row modes, time order', async () => {
  const ui = await boot(), App = ui.App;
  const days = copy(App.weekStripDays(App.state.sessions, App.state.clients, TODAY));
  const rows = days.flatMap(d => d.rows), ids = rows.map(r => r.id);
  // Window edge: rows dated 09-11 (today-8) and 09-27 (today+8) are absent; 09-12 and 09-26 are present.
  assert.ok(!ids.includes('edge-out-before') && !ids.includes('edge-out-after'), 'a row outside today-7..today+7 leaked into the strip: ' + ids);
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
  // Lock state is injectable, and the date steps never drift across a DST change (US: 2026-03-08 and 2026-11-01).
  assert.equal(App.weekStripDays([{ id: 'x', date: TODAY, clientIds: [] }], [], TODAY, () => false)[7].rows[0].mode, 'status');
  for (const middle of ['2026-03-08', '2026-11-01']) {
    const dates = App.weekStripDays([], [], middle).map(d => d.date), expected = [];
    for (let i = -7; i <= 7; i++) expected.push(new Date(Date.parse(middle + 'T00:00:00Z') + i * 864e5).toISOString().slice(0, 10));
    assert.deepEqual(copy(dates), expected);
  }
});

test('markup: chips per row state, paid rows disabled, today highlighted, names escaped, empty state', async () => {
  const ui = await boot(), html = ui.html();
  // Locked, completed, unpaid (dated 09-16): three chips, Happened lit, plus Mark paid.
  assert.deepEqual(chips(rowHtml(html, 'w-locked')).map(c => [c.label, c.action, c.status, c.lit, c.pressed, c.disabled]), [
    ['Happened', 'strip-status', 'completed', true, 'true', false], ['No-show', 'strip-status', 'no-show', false, 'false', false], ['Cancelled', 'strip-status', 'cancelled', false, 'false', false]]);
  assert.match(rowHtml(html, 'w-locked'), /data-action="mark-paid" data-id="w-locked"/);
  // Unlocked future row: only Skip.
  assert.deepEqual(chips(rowHtml(html, 'w-future')).map(c => [c.label, c.action]), [['Skip', 'strip-skip']]);
  assert.equal((rowHtml(html, 'w-future').match(/<button/g) || []).length, 1);
  // Unlocked row dated today: the three outcomes through session.update, none lit.
  assert.deepEqual(chips(rowHtml(html, 'w-today')).map(c => [c.label, c.action, c.lit]), [['Happened', 'quick-complete', false], ['No-show', 'quick-noshow', false], ['Cancelled', 'quick-cancel', false]]);
  // Paid rows (finalized, archived, and a prepaid future one): every chip disabled with the reason; no Mark paid.
  for (const id of ['w-paid', 'arch-paid', 'w-prepaid']) {
    const row = rowHtml(html, id), found = chips(row);
    assert.equal(found.length, 3, id);
    assert.deepEqual(found.map(c => [c.disabled, c.title]), Array(3).fill([true, PAID_TITLE]), id + ' must render its chips disabled');
    assert.equal((row.match(/<button/g) || []).length, 3, id + ' has a button that is not a disabled chip');
  }
  assert.deepEqual(chips(rowHtml(html, 'w-paid')).filter(c => c.lit).map(c => c.label), ['Happened']);
  assert.ok(!html.includes('edge-out-before') && !html.includes('edge-out-after'));
  assert.match(html, new RegExp('<section class="strip-day strip-today" data-date="' + TODAY + '">'));
  assert.equal((html.match(/strip-today/g) || []).length, 1);
  assert.match(html, new RegExp('data-action="strip-add" data-date="' + TODAY + '"'));
  assert.ok(!html.includes('data-date="2026-09-13"'), 'a day with no sessions (other than today) is not drawn');
  // Pure markup: hostile names are escaped; an empty week says so and still offers today\'s "+".
  const App = ui.App, hostile = App.weekStripHtml(App.weekStripDays([{ id: 'x"><img src=x>', date: TODAY, time: '<b>', clientIds: ['h'], duration: 1, amount: 1, status: 'scheduled' }],
    [{ id: 'h', firstName: '<img src=x onerror=alert(1)>', lastName: '' }], TODAY, () => false));
  assert.ok(!/<img|<b>/.test(hostile), hostile);
  const empty = App.weekStripHtml(App.weekStripDays([], [], TODAY));
  assert.match(empty, /Nothing scheduled this week/); assert.match(empty, /data-action="strip-add"/);
});

test('locked unpaid row: No-show appends exactly one correction, evidence byte-identical, Owed drops; Undo restores the exact total', async () => {
  const ui = await boot(), stored = ui.stored('w-locked'), finalized = ui.finalized('w-locked'), owed = ui.owed(), revision = ui.repo.revision;
  assert.equal(ui.view('w-locked').status, 'completed'); assert.deepEqual(ui.events(), []);
  await ui.tap('strip-status', 'w-locked', 'no-show');
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
  // Pressing Undo twice, or tapping the chip that is already lit, records nothing more.
  await ui.toasts.at(-2).press('.toast-action');
  await ui.tap('strip-status', 'w-locked', 'completed');
  assert.equal(ui.events().length, 2);
  // Locked rows change only through a correction: the direct commands still refuse.
  await assert.rejects(command(ui.repo, 'session.update', { ids: ['w-locked'], patch: { status: 'no-show' } }), /Read-only/);
  await assert.rejects(command(ui.repo, 'session.status', { ids: ['w-locked'], status: 'no-show' }), /Only pre-activation scheduled/);
});

test('future unlocked row: Skip deletes it, Undo restores a byte-identical stored record', async () => {
  const ui = await boot(), stored = ui.stored('w-future'), revision = ui.repo.revision, others = () => JSON.stringify(ui.snapshot().working.sessions.filter(s => s.id !== 'w-future'));
  const rest = others();
  assert.ok(!Object.hasOwn(JSON.parse(stored), 'paid') && ui.view('w-future').paid === false, 'fixture premise: the read view differs from the stored record');
  await ui.tap('strip-skip', 'w-future');
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
  assert.deepEqual(chips(rowHtml(ui.html(), 'w-future')).map(c => c.action), ['strip-skip']);
});

test('paid rows cannot be changed from the strip, whatever the DOM sends', async () => {
  const ui = await boot(), before = JSON.stringify(ui.snapshot());
  for (const [action, id, status] of [['strip-status', 'w-paid', 'no-show'], ['strip-status', 'arch-paid', 'cancelled'], ['strip-skip', 'w-prepaid'],
    ['quick-noshow', 'w-prepaid'], ['quick-cancel', 'w-prepaid']]) {
    await ui.tap(action, id, status);
    assert.equal(JSON.stringify(ui.snapshot()), before, action + ' changed a paid row: ' + id);
    assert.match(ui.toasts.at(-1).className, /toast-warning/); assert.ok(ui.toasts.at(-1).innerHTML.includes(PAID_TITLE));
  }
  assert.equal(ui.toasts.length, 5);
});

test('unlocked row dated today: the outcome locks it; Undo of No-show / Cancelled is a correction to completed; Happened has no Undo', async () => {
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
  assert.deepEqual(chips(rowHtml(ui.html(), 'arch-sched')).map(c => [c.action, c.lit]), [['strip-status', false], ['strip-status', false], ['strip-status', false]]);
  await ui.tap('strip-status', 'arch-sched', 'cancelled');
  assert.deepEqual(ui.errors(), []);
  assert.deepEqual(ui.events(), [['correction', 'arch-sched', { status: 'cancelled' }]]);
  assert.equal(ui.stored('arch-sched'), stored); assert.equal(ui.view('arch-sched').status, 'cancelled');
  assert.ok(!ui.toasts.at(-1).innerHTML.includes('toast-action'));
});

test('static: strip is first in the dashboard, existing commands only, no new storage', () => {
  const html = readSource('index.html'), dashboard = readSource('js/dashboard.js'), uiSource = readSource('js/ui.js'), repository = readSource('js/repository.js');
  assert.match(html, /<section class="tab-panel active" id="panel-dashboard"[^>]*>\s*<article class="dash-card week-strip" id="week-strip"/, 'the strip must be the first child of the dashboard panel');
  assert.match(html, /<div class="dash-card-body" id="week-strip-body">/);
  assert.match(dashboard, /function renderDashboard\(\) \{\s*renderWeekStrip\(\);/, 'renderWeekStrip must run first in renderDashboard');
  // Every command the UI and the dashboard issue is one the repository already has.
  const known = new Set([...repository.matchAll(/case '([a-z]+\.[A-Za-z]+)':/g)].map(m => m[1]));
  const issued = [...(uiSource + dashboard).matchAll(/runCommand\(\s*'([^']+)'/g)].map(m => m[1]);
  assert.ok(issued.includes('session.correct') && issued.includes('session.delete') && issued.includes('session.save'));
  assert.deepEqual(issued.filter(name => !known.has(name)), []);
  for (const action of ['strip-status', 'strip-skip', 'strip-add', 'quick-cancel']) assert.ok(uiSource.includes("case '" + action + "':"), action);
  assert.doesNotMatch(dashboard, /localStorage|sessionStorage|indexedDB/);
  assert.ok(readSource('styles.css').includes('.strip-chip:disabled'));
});
