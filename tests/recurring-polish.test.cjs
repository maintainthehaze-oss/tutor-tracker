'use strict';
// Weekly recurring slots, slice E4 polish (2026-10-11): weekly tag, Record payment sentence, gap/skipped notice,
// (gap/skipped notice and the runaway nudge left with the "This week" group, removed 2026-10-15). FABRICATED DATA ONLY. Unit-tested, NOT observed in a live browser.
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
  ui.App.renderSessions();
  return ui;
}

test('weekly tag: Sessions table row shows it for generated rows only', async () => {
  const ui = await boot([gen('2026-09-15'), { ...gen('2026-09-16'), recurring: null, id: 'hand' }]);
  const table = ui.field('sessions-tbody').innerHTML;
  const row = (html, id) => (html.match(new RegExp('<(?:tr|li) class="(?:session-row|tw-row)"[^>]*data-id="' + id + '".*?</(?:tr|li)>')) || [''])[0];
  assert.match(row(table, 'rec:slot-tue:2026-09-15'), /<span class="outstanding-tag">weekly<\/span>/);
  assert.ok(row(table, 'hand') && !/weekly/.test(row(table, 'hand')), 'hand-entered row must not be tagged');
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
