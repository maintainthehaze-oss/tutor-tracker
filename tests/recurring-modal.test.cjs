'use strict';
// Weekly recurring slots, slice E3: the "Weekly schedule" fieldset of the client modal and the card line.
// FABRICATED DATA ONLY: this repository is public. The fake clock starts Tuesday 2026-03-10 12:00, so a Tuesday
// slot plans 03-10, 03-17, 03-24, 03-31. Slot controls are driven through the same body listeners the page uses.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSource } = require('./helpers/harness.cjs');
const { bootUi } = require('./helpers/ui-app.cjs');

const TUESDAYS = ['2026-03-10', '2026-03-17', '2026-03-24', '2026-03-31'];

function driver(ui) {
  const { App, field, click, settle } = ui;
  const saves = [], toasts = [];
  const runCommand = App.runCommand;
  App.runCommand = (name, payload, revision) => { if (name === 'client.save') saves.push(JSON.parse(JSON.stringify(payload.record))); return runCommand.call(App, name, payload, revision); };
  App.showToast = (message, kind) => toasts.push([kind, message]);
  const key = (n = 0) => [...field('client-slot-list').innerHTML.matchAll(/data-slot-row="([^"]+)"/g)][n][1];
  /** A change/input on one slot control, delivered to the body listeners like a real DOM event. */
  async function setSlot(slotKey, name, value, type = 'change') {
    const attributes = { 'data-slot-key': slotKey, 'data-slot-field': name };
    const target = { value, id: '', getAttribute: k => (k in attributes ? attributes[k] : null) };
    for (const listener of ui.document.body.listeners[type] || []) await listener({ type, target });
    await settle();
  }
  const generated = () => { App.refreshReadViews(); return App.state.sessions.filter(s => s.recurring); };
  const slotsOf = id => ui.disk().working.clients.find(c => c.id === id).slots;
  async function save() {
    const before = App.repository.revision;
    await click('save-client');
    return before;
  }
  return { ...ui, saves, toasts, key, setSlot, generated, slotsOf, save };
}

/** Open c1, add a Tuesday 16:00 weekly slot with c2 also attending (online, 1.5 h), and save it. */
async function saveFirstSlot(d) {
  const { App, click } = d;
  App.openClientForm('c1');
  await click('add-client-slot');
  const k = d.key();
  await d.setSlot(k, 'day', '1');                                       // Tuesday
  await d.setSlot(k, 'time', '16:00');
  await d.setSlot(k, 'type', 'online');
  await d.setSlot(k, 'every', '1');
  await click('set-slot-duration', { 'data-slot-key': k, 'data-hours': '1.5' });
  // R1: the usual sibling set (c1 + c2 in the fixture) is pre-selected on a new slot; leave it as offered.
  assert.match(d.field('client-slot-list').innerHTML, /client-pick selected" data-action="toggle-slot-with"[^>]*data-id="c2"/);
  const before = await d.save();
  await d.waitFor(() => App.repository.revision > before && d.generated().length === 4, 'client save + recurring pass');
}

test('(a) a new slot saves with a generated id, through null and the chosen fields; the pass then creates 4 rows', async () => {
  const d = driver(await bootUi());
  await saveFirstSlot(d);
  const sent = d.saves[0].slots;
  assert.equal(sent.length, 1);
  assert.equal(sent[0].through, null, 'a new slot is written with through: null');
  assert.notEqual(sent[0].id, 'new');
  assert.ok(/^[\w-]{6,}$/.test(sent[0].id), 'generated id');
  const stored = d.slotsOf('c1');
  assert.equal(stored.length, 1);
  assert.equal(JSON.stringify({ ...stored[0], id: undefined, through: undefined }),
    JSON.stringify({ anchor: '2026-03-10', every: 1, time: '16:00', duration: 1.5, type: 'online', with: ['c2'] }));
  assert.equal(stored[0].id, sent[0].id);
  assert.equal(d.App.recurring.slotProblem(sent[0]), '');
  assert.equal(JSON.stringify(d.generated().map(s => s.date).sort()), JSON.stringify(TUESDAYS));
  assert.match(stored[0].through, /^2026-0[34]-[0-9][0-9]$/, 'the pass (not the modal) advanced the watermark');
});

test('(b) reopening and saving without touching the slot keeps it byte-identical (same id, through preserved)', async () => {
  const d = driver(await bootUi());
  await saveFirstSlot(d);
  const before = JSON.stringify(d.slotsOf('c1'));
  d.App.openClientForm('c1');
  const r = await d.save();
  await d.waitFor(() => d.App.repository.revision > r, 'second save');
  assert.equal(JSON.stringify(d.slotsOf('c1')), before);
  assert.notEqual(d.saves[1].slots[0].through, null, 'untouched slot sent unchanged, including the pass watermark');
  assert.equal(d.generated().length, 4);
});

test('(c) editing the time gives the slot a new id and through null', async () => {
  const d = driver(await bootUi());
  await saveFirstSlot(d);
  const old = d.slotsOf('c1')[0];
  d.App.openClientForm('c1');
  await d.setSlot(d.key(), 'time', '17:00');
  const r = await d.save();
  await d.waitFor(() => d.App.repository.revision > r, 'edit save');
  const sent = d.saves[1].slots[0];
  assert.notEqual(sent.id, old.id, 'edited slot must not keep its old id');
  assert.equal(sent.through, null);
  assert.equal(sent.time, '17:00');
  assert.equal(d.slotsOf('c1').length, 1);
});

test('(d) a malformed slot (duration 0) is refused with a toast naming the problem and no write', async () => {
  const d = driver(await bootUi());
  const { App, click } = d;
  App.openClientForm('c1');
  await click('add-client-slot');
  await d.setSlot(d.key(), 'duration', '0', 'input');
  const r = App.repository.revision, disk = JSON.stringify(d.disk());
  await d.save();
  await d.settle();
  assert.equal(App.repository.revision, r);
  assert.equal(JSON.stringify(d.disk()), disk);
  assert.equal(d.saves.length, 0, 'client.save never reached');
  assert.equal(JSON.stringify(d.toasts), JSON.stringify([['error', 'Weekly slot 1: duration must be more than 0']]));
});

test('(e) the client card shows the slot as "Tue 4:00 PM weekly" / "every 2 weeks"', async () => {
  const d = driver(await bootUi());
  await saveFirstSlot(d);
  d.App.renderClients();
  assert.match(d.field('clients-grid').innerHTML, /Tue 4:00 PM weekly/);
  d.App.openClientForm('c1');
  await d.setSlot(d.key(), 'every', '2');
  const r = await d.save();
  await d.waitFor(() => d.App.repository.revision > r, 'every-2 save');
  d.App.renderClients();
  assert.match(d.field('clients-grid').innerHTML, /Tue 4:00 PM every 2 weeks/);
});

test('new-slot rows: Also attending lists only same-family active clients; Day moves First session; First session sets Day; paused note follows status', async () => {
  const d = driver(await bootUi());
  const { App, click, field } = d;
  App.openClientForm('c1');
  await click('add-client-slot');
  const html = () => field('client-slot-list').innerHTML;
  assert.ok(html().includes('data-id="c2"') && !html().includes('data-id="c3"') && !html().includes('data-id="c1"'));
  const k = d.key();
  await d.setSlot(k, 'day', '4');                                       // Friday: next one on/after Tue 2026-03-10
  assert.match(html(), /value="2026-03-13"/);
  await d.setSlot(k, 'anchor', '2026-03-16');                           // a Monday
  assert.match(html(), /<option value="0" selected>/);
  field('client-status').value = 'paused';
  for (const listener of d.document.body.listeners.change || []) await listener({ type: 'change', target: { id: 'client-status', value: 'paused', getAttribute: () => null } });
  assert.equal(field('client-slots-paused').hidden, false);
  App.openClientForm('c4');                                             // no family: no attending tiles
  await click('add-client-slot');
  assert.ok(!html().includes('slot-with'));
});

test('(f) static: fieldset sits between the payment select and #client-more; clients.js never plans, forges ids or writes through other than null', () => {
  const html = readSource('index.html'), js = readSource('js/clients.js');
  const pay = html.indexOf('id="client-default-payment-method"'), set = html.indexOf('<fieldset class="form-group-full weekly-slots" id="client-slots">'), more = html.indexOf('id="client-more"');
  assert.ok(pay > 0 && pay < set && set < more, 'fieldset position');
  for (const needle of ['id="client-slot-list"', 'data-action="add-client-slot"', 'id="client-slots-paused"', 'Sessions are created 4 weeks ahead as Scheduled.', '<legend>Weekly schedule</legend>']) assert.ok(html.includes(needle), needle);
  assert.ok(!js.includes('rec:') && !js.includes('materializeRecurring'));
  const writes = js.split('\n').filter(l => !/^\s*(\/\/|\/?\*)/.test(l)).join('\n').match(/through\s*[:=][^,}\n]*/g) || [];
  assert.ok(writes.length > 0 && writes.every(w => /through\s*:\s*null\b/.test(w)), 'only through: null is ever written: ' + writes.join(' | '));
});
