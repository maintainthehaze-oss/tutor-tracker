'use strict';
// Weekly recurring slots, slice E4 polish (2026-10-11): weekly tag, Record payment sentence, gap/skipped notice,
// runaway nudge + pause tap. FABRICATED DATA ONLY. Unit-tested, NOT observed in a live browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const { command } = require('./helpers/harness.cjs');
const { bootUi } = require('./helpers/ui-app.cjs');
const { newSession } = require('./helpers/money-fixture.cjs');

const TODAY = '2026-09-19';
const SLOT = { id: 'slot-tue', anchor: '2026-08-18', every: 1, time: '16:00', duration: 1, type: 'in-person', through: '2026-09-30' };
const client = (id, extra = {}) => ({ id, firstName: 'Client', lastName: id.toUpperCase(), rate: 100, status: 'active', familyGroup: 'Family ' + id, address: '1 Example Street, Faketown, NY 00000', ...extra });
const gen = (date, fields = {}) => ({ clientIds: ['c1'], date, time: '16:00', duration: 1, amount: 100, status: 'completed', paid: false, payment: 'unpaid',
  recurring: { slotId: 'slot-tue', date, stamp: 'x' }, ...fields });
const DATES = ['2026-08-25', '2026-09-01', '2026-09-08', '2026-09-15'];

async function boot(rows, clients) {
  const ui = await bootUi({ startAt: TODAY + 'T12:00:00', data: { syntheticOnly: true, clients: clients || [client('c1', { slots: [SLOT] }), client('c2')], sessions: [],
    expenses: [], taxPayments: [], historical: [], receipts: {}, settings: { mileageRate: 0.5 } }, globals: { setTimeout: () => 1 } });
  for (const r of rows) await command(ui.App.repository, 'session.save', { record: newSession(r.id || 'rec:slot-tue:' + r.date, r) });
  await ui.settle();
  ui.App.renderSessions(); ui.App.renderThisWeek();
  return ui;
}

test('weekly tag: Sessions table row and week-group row show it for generated rows only', async () => {
  const ui = await boot([gen('2026-09-15'), { ...gen('2026-09-16'), recurring: null, id: 'hand' }]);
  const table = ui.field('sessions-tbody').innerHTML, week = ui.field('this-week-body').innerHTML;
  const row = (html, id) => (html.match(new RegExp('<(?:tr|li) class="(?:session-row|tw-row)"[^>]*data-id="' + id + '".*?</(?:tr|li)>')) || [''])[0];
  assert.match(row(table, 'rec:slot-tue:2026-09-15'), /<span class="outstanding-tag">weekly<\/span>/);
  assert.match(row(week, 'rec:slot-tue:2026-09-15'), /<span class="outstanding-tag">weekly<\/span>/);
  assert.ok(row(table, 'hand') && !/weekly/.test(row(table, 'hand')), 'hand-entered row must not be tagged');
  assert.ok(row(week, 'hand') && !/weekly/.test(row(week, 'hand')));
});

test('autoLoggedCount (pure) and the Record payment sentence', async () => {
  const ui = await boot([gen('2026-09-01'), gen('2026-09-08'), { ...gen('2026-09-10'), recurring: null, id: 'hand' }]);
  assert.equal(ui.App.autoLoggedCount([{ recurring: { slotId: 'a' } }, { recurring: null }, {}, null]), 1);
  assert.equal(ui.App.autoLoggedCount(undefined), 0);
  await ui.click('record-payment', { 'data-key': 'family:Family c1', 'data-label': 'Family c1' });
  assert.match(ui.field('record-payment-preview').innerHTML, /2 of these were logged automatically from the weekly schedule; check the total matches what you received\./);
  ui.field('record-payment-amount').value = '100.00'; ui.App.previewRecordPayment();
  assert.match(ui.field('record-payment-preview').innerHTML, /1 of these were logged automatically/, 'only the covered rows are counted');
});

test('recurringNotice (pure): gaps, clashes, both, singular, empty, malformed entries ignored', async () => {
  const { App } = await boot([]);
  const n = App.recurringNotice;
  assert.equal(n(null, []), ''); assert.equal(n({ skipped: [], gaps: [] }, []), '');
  assert.equal(n({ skipped: [{ date: null, reason: 'slot has no id' }], gaps: [] }, []), '', 'dateless malformed-slot entries are not dates');
  assert.equal(n({ skipped: [], gaps: [{ date: '2026-09-15' }, { date: '2026-09-01' }, { date: '2026-09-08' }] }, []),
    'Weekly schedule: 3 dates were skipped while the app was closed (never filled in): Sep 1, Sep 8, Sep 15.');
  assert.equal(n({ skipped: [{ date: '2026-09-22', reason: 'x' }, { date: '2026-09-29', reason: 'x' }], gaps: [] }, []),
    'Weekly schedule: 2 dates already had a session for that client and were not added: Sep 22, Sep 29.');
  assert.equal(n({ skipped: [{ date: '2026-09-22' }], gaps: [{ date: '2026-09-01' }] }, []),
    'Weekly schedule: 1 date was skipped while the app was closed (never filled in): Sep 1. 1 date already had a session for that client and was not added: Sep 22.');
});

test('notice markup: second tw-notice, after the auto-completed one, not dismissible, no new localStorage key', async () => {
  const ui = await boot([]);
  const days = ui.App.thisWeekDays([], [], TODAY);
  const html = ui.App.thisWeekHtml(days, [], { recurringText: 'Weekly schedule: <b>x</b>', stale: [] });
  assert.match(html, /<section class="tw-notice" aria-label="Weekly schedule"><p [^>]*>Weekly schedule: &lt;b&gt;x&lt;\/b&gt;<\/p><\/section>/);
  assert.doesNotMatch(html, /this-week-dismiss/);
  const pending = [{ id: 'z', date: TODAY, time: '', names: 'N', duration: 1, amount: 1, status: 'completed', mode: 'status' }];
  const both = ui.App.thisWeekHtml(days, pending, { recurringText: 'W' });
  assert.ok(both.indexOf('Auto-completed since') > -1 && both.indexOf('Auto-completed since') < both.indexOf('aria-label="Weekly schedule"'), 'auto-completed notice stays first');
  const src = require('fs').readFileSync(require('path').join(__dirname, '../protected/js/this-week.js'), 'utf8');
  assert.deepEqual([...new Set(src.match(/'tutoring-[a-z-]+'/g))], ["'tutoring-last-seen'"], 'no new localStorage key');
});

test('staleSlots (pure): 4 unpaid completed generated rows trigger; paid, short runs, paused owner, future rows do not', async () => {
  const { App } = await boot([]);
  const clients = [client('c1', { slots: [SLOT] }), client('c2')];
  const rows = (fields) => DATES.map((d, i) => ({ id: 'rec:slot-tue:' + d, ...gen(d), ...(fields && fields[i]) }));
  const out = JSON.parse(JSON.stringify(App.staleSlots(clients, rows(), TODAY)));
  assert.deepEqual(out, [{ clientId: 'c1', slotId: 'slot-tue', names: 'Client C1', weekday: 'Tuesdays', count: 4 }]);
  assert.equal(App.staleSlots(clients, rows([{ paid: true }]), TODAY).length, 0, 'a paid first row leaves a run of 3');
  assert.equal(App.staleSlots(clients, rows([null, null, null, { paid: true }]), TODAY).length, 0, 'a paid row after the run clears it');
  assert.equal(App.staleSlots(clients, rows([null, { paid: true }]), TODAY).length, 0, 'run of 2 after a paid row');
  assert.equal(App.staleSlots(clients, rows([null, null, null, { status: 'cancelled' }]), TODAY).length, 0);
  assert.equal(App.staleSlots(clients, rows().slice(0, 3), TODAY).length, 0, 'only 3');
  assert.equal(App.staleSlots([client('c1', { slots: [SLOT], status: 'paused' })], rows(), TODAY).length, 0, 'paused owner');
  assert.equal(App.staleSlots(clients, rows(), '2026-09-08').length, 0, 'rows dated after today are not counted');
});

test('nudge line in the week group, and the Pause tap pauses the client', async () => {
  const ui = await boot(DATES.map((d) => gen(d)));
  const html = ui.field('this-week-body').innerHTML;
  assert.match(html, /Still tutoring Client C1 on Tuesdays\? 4 sessions auto-logged and unpaid\./);
  assert.match(html, /<button type="button" class="duration-chip tw-chip" data-action="this-week-pause" data-id="c1"/);
  await ui.click('this-week-pause', { 'data-id': 'c1' });
  const c1 = ui.App.state.clients.find((c) => c.id === 'c1');
  assert.equal(c1.status, 'paused');
  assert.equal(c1.slots.length, 1, 'merge keeps the slots');
});
