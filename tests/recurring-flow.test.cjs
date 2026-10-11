'use strict';
// Weekly recurring slots, slice E2: the wrapper runRecurringPass and its triggers, through the real ui.js init().
// FABRICATED DATA ONLY: this repository is public. Today is 2026-09-19 (a Saturday); the Tuesday slot plans 09-22 .. 10-13.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readSource, root } = require('./helpers/harness.cjs');
const { rawFixture } = require('./helpers/money-fixture.cjs');
const { SLOT, slot } = require('./helpers/recurring-scenarios.cjs');
const { bootUi } = require('./helpers/ui-app.cjs');

const TUESDAYS = ['2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13'];
const rid = date => 'rec:' + SLOT + ':' + date;
const MODAL = '(query) .modal-overlay.modal-active:not([hidden])';

async function boot({ withSlot = false } = {}) {
  const data = rawFixture();
  if (withSlot) data.clients[0].slots = [slot()];
  const env = await bootUi({ startAt: '2026-09-19T12:00:00', data });
  const { App, document } = env;
  const toasts = [];
  App.showToast = (message, type) => toasts.push([type, message]);
  const generated = () => { App.refreshReadViews(); return Array.from(App.state.sessions.filter(s => s.recurring).map(s => s.id)).sort(); };
  const give = async () => { // put the Tuesday slot on c1 without running a pass (client.save alone never plans)
    const c1 = App.state.clients.find(c => c.id === 'c1');
    assert.equal(await App.runCommand('client.save', { record: { id: 'c1', slots: [slot()] } }, App.repository.revision), true);
    return c1;
  };
  const setStatus = status => App.runCommand('client.save', { record: { id: 'c1', status } }, App.repository.revision);
  return { ...env, App, document, toasts, generated, give, setStatus, rev: () => App.repository.revision };
}

test('boot plans the slot once: exactly one revision and four rows; a second pass writes nothing', async () => {
  const booted = await boot({ withSlot: true });
  assert.deepEqual(booted.generated(), TUESDAYS.map(rid), 'init() ran the pass');
  const plain = await boot();
  assert.deepEqual(plain.generated(), []);
  await plain.give();
  const r0 = plain.rev();
  await plain.App.runRecurringPass();
  assert.equal(plain.rev(), r0 + 1, 'one pass = exactly one revision');
  assert.deepEqual(plain.generated(), TUESDAYS.map(rid));
  await plain.App.runRecurringPass();
  assert.equal(plain.rev(), r0 + 1, 'second pass = +0');
  assert.deepEqual(plain.toasts, []);
});

test('pause removes future pristine rows and pulls the watermark to today; un-pause brings them back', async () => {
  const t = await boot(); await t.give(); await t.App.runRecurringPass();
  assert.equal(t.generated().length, 4);
  await t.setStatus('paused'); await t.App.runRecurringPass();
  assert.deepEqual(t.generated(), []);
  assert.equal(t.App.state.clients.find(c => c.id === 'c1').slots[0].through, '2026-09-19');
  await t.setStatus('active'); await t.App.runRecurringPass();
  assert.deepEqual(t.generated(), TUESDAYS.map(rid));
});

test('an open modal blocks the pass; a hidden or absent one does not', async () => {
  const t = await boot(); await t.give();
  const el = t.document.getElementById(MODAL), r0 = t.rev();
  el.classList.add('modal-active');                        // the fake can say "open": an overlay still carrying modal-active
  await t.App.runRecurringPass();
  assert.equal(t.rev(), r0); assert.deepEqual(t.generated(), []);
  el.hidden = true;                                        // hidden overlay does not count
  el.classList.remove('modal-active');                     // closeModal drops the class at once: closed
  await t.App.runRecurringPass();
  assert.equal(t.rev(), r0 + 1);
});

test('kill switch: App.features.recurringPass = false writes nothing and says nothing', async () => {
  const t = await boot(); await t.give(); const r0 = t.rev();
  t.App.features.recurringPass = false;
  await t.App.runRecurringPass();
  assert.equal(t.rev(), r0); assert.deepEqual(t.generated(), []); assert.deepEqual(t.toasts, []);
});

test('a second tab winning the CAS is silent; any other error is one warning toast', async () => {
  const t = await boot(); await t.give(); const r0 = t.rev(), real = t.App.repository;
  const failing = message => { t.App.repository = Object.create(real, { execute: { value: async () => { throw Error(message); } } }); };
  failing('Stale action. Reload or reopen the form.');
  await t.App.runRecurringPass();
  assert.equal(t.rev(), r0); assert.deepEqual(t.toasts, []);
  failing('Disk full');
  await t.App.runRecurringPass();
  assert.equal(t.rev(), r0); assert.deepEqual(t.toasts, [['warning', 'Weekly schedule not updated: Disk full']]);
  t.App.repository = real;
  await t.App.runRecurringPass();
  assert.equal(t.rev(), r0 + 1);
});

test('static: one writer call, one planner call, one visibilitychange listener', () => {
  const dir = path.join(root, 'js'), files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  const count = (src, re) => (src.match(re) || []).length;
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (f === 'repository.js') continue;
    assert.equal(count(src, /recurring\.apply/g), f === 'recurring.js' ? 1 : 0, f + ' recurring.apply');
    if (f !== 'recurring.js') assert.equal(count(src, /materializeRecurring\(/g), 0, f);
  }
  assert.equal(count(readSource('js/recurring.js'), /materializeRecurring\(/g), 2, 'one definition + one call');
  assert.equal(count(readSource('js/ui.js'), /'visibilitychange'/g), 1);
});
