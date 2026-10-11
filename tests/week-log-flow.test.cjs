'use strict';
// Slice A UI: the "Log a week" grid, driven through the real ui.js click delegation and the real week-log.js
// with a fake DOM and a fake clock. Fabricated data only. Unit-level evidence: NOT observed in a browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { bootUi } = require('./helpers/ui-app.cjs');
const { rawFixture } = require('./helpers/money-fixture.cjs');
const { analyzeSource, scanDirectory } = require('./slice1/static-guard.cjs');

const copy = x => JSON.parse(JSON.stringify(x));
const src = file => fs.readFileSync(path.resolve(__dirname, '../protected', file), 'utf8');
const toggle = (ui, key, date) => ui.click('week-toggle', { 'data-key': key, 'data-date': date });
const edit = (ui, key, date, field, value) => ui.App.editWeekTick({ value, getAttribute: k => ({ 'data-key': key, 'data-date': date, 'data-field': field })[k] });
const ticks = ui => copy(ui.App.weekLog.ticks());
const spyToasts = ui => { const seen = []; const orig = ui.App.showToast; ui.App.showToast = (message, kind) => { seen.push({ message, kind }); return orig(message, kind); }; return seen; };

test('revision pin: six ticked cells save in ONE command (+1 revision, +6 rows), past rows lock, future rows stay scheduled', async () => {
  const ui = await bootUi({ startAt: '2026-03-10T12:00:00' });
  const before = { revision: ui.App.repository.revision, rows: ui.disk().working.sessions.length };
  await ui.click('open-week-log');
  assert.equal(ui.App.weekLog.anchor(), '2026-03-09');
  const cells = [['c1', '2026-03-09'], ['c2', '2026-03-10'], ['c3', '2026-03-11'], ['c4', '2026-03-12'], ['c1', '2026-03-13'], ['c2', '2026-03-14']];
  for (const [key, date] of cells) await toggle(ui, key, date);
  assert.equal(ticks(ui).length, 6);
  await ui.click('save-week');
  await ui.waitFor(() => ui.App.repository.revision > before.revision, 'the week to save');
  assert.equal(ui.App.repository.revision, before.revision + 1, 'exactly one revision');
  const disk = ui.disk();
  assert.equal(disk.working.sessions.length, before.rows + 6);
  const added = disk.working.sessions.slice(-6);
  for (const row of added) {
    const past = row.date <= '2026-03-10';
    assert.equal(row.status, past ? 'completed' : 'scheduled', row.date);
    assert.equal(Boolean(disk.finalized[row.id]), past, 'finalized only when completed: ' + row.date);
    assert.equal(row.recurring, null); assert.equal(row.mileage, 0); assert.equal(row.paid, false);
    assert.equal(row.payment, 'unpaid'); assert.equal(row.paymentDate, null); assert.equal(row.companyAmount, 0);
    assert.equal(Math.round(row.amount * 100), row.amount * 100, 'whole cents');
  }
  assert.deepEqual(ticks(ui), [], 'ticks cleared after save');
  assert.equal(ui.App.state.sessions.length, before.rows + 6);
});

test('prefill: usual signature amount, and rate x default duration (cents) for a client with no history', async () => {
  const ui = await bootUi();
  await ui.click('open-week-log');
  await toggle(ui, 'c1', '2026-03-09');
  assert.equal(ticks(ui)[0].amount, 100);
  assert.equal(ticks(ui)[0].duration, 1);

  const data = rawFixture();
  data.clients.push({ id: 'c5', firstName: 'Client', lastName: 'Fresh', rate: 62.5, status: 'active' });
  data.settings = { ...(data.settings || {}), defaultDuration: 0.83 };
  const fresh = await bootUi({ data });
  await fresh.click('open-week-log');
  await toggle(fresh, 'c5', '2026-03-09');
  assert.equal(ticks(fresh)[0].amount, 51.88);
  assert.equal(ticks(fresh)[0].duration, 0.83);
});

test('repeat last week: ticks exactly the non-cancelled rows, dated +7 days, then saves as one command', async () => {
  const ui = await bootUi({ startAt: '2026-02-10T12:00:00' });
  const before = { revision: ui.App.repository.revision, rows: ui.disk().working.sessions.length };
  await ui.click('open-week-log');
  assert.equal(ui.App.weekLog.anchor(), '2026-02-09');
  await ui.click('week-repeat-last');
  const got = ticks(ui).map(t => ({ key: t.key, date: t.date, duration: t.duration, amount: t.amount })).sort((a, b) => a.date.localeCompare(b.date));
  assert.deepEqual(got, [
    { key: 'c1', date: '2026-02-10', duration: 1, amount: 100 },
    { key: 'c1+c2', date: '2026-02-12', duration: 1.5, amount: 150 },
    { key: 'c3', date: '2026-02-14', duration: 1, amount: 80 },
  ]);
  await ui.click('save-week');
  await ui.waitFor(() => ui.App.repository.revision > before.revision, 'the repeat to save');
  assert.equal(ui.App.repository.revision, before.revision + 1);
  assert.equal(ui.disk().working.sessions.length, before.rows + 3);
});

test('logged and blocked cells are disabled and cannot be ticked', async () => {
  const ui = await bootUi({ startAt: '2026-02-10T12:00:00' });
  await ui.click('open-week-log');
  await toggle(ui, 'c2', '2026-02-09');                                   // a6 already exists for c2 that day
  assert.deepEqual(ticks(ui), []);
  const grid = ui.field('week-grid').innerHTML;
  assert.match(grid, /<button[^>]*week-cell-logged[^>]*data-key="c2" data-date="2026-02-09"[^>]*disabled/);
  await toggle(ui, 'c1+c2', '2026-02-11');
  await toggle(ui, 'c1', '2026-02-11');                                   // member of the ticked combo
  assert.equal(ticks(ui).length, 1);
  assert.match(ui.field('week-grid').innerHTML, /<button[^>]*week-cell-blocked[^>]*data-key="c1" data-date="2026-02-11"[^>]*disabled/);
});

test('edit in review: duration and amount are validated, then saved as edited', async () => {
  const ui = await bootUi();
  const toasts = spyToasts(ui);
  await ui.click('open-week-log');
  await toggle(ui, 'c1', '2026-03-09');
  edit(ui, 'c1', '2026-03-09', 'duration', '2');
  assert.equal(ticks(ui)[0].duration, 2);
  edit(ui, 'c1', '2026-03-09', 'amount', '123.456');
  assert.equal(ticks(ui)[0].amount, 123.46);
  edit(ui, 'c1', '2026-03-09', 'duration', '0');
  assert.equal(ticks(ui)[0].duration, 2, 'a zero duration is refused');
  assert.ok(toasts.some(t => t.kind === 'error'), 'an error toast was shown');
  edit(ui, 'c1', '2026-03-09', 'amount', '-5');
  assert.equal(ticks(ui)[0].amount, 0, 'never negative');
  edit(ui, 'c1', '2026-03-09', 'amount', '123.456');
  const rev = ui.App.repository.revision;
  await ui.click('save-week');
  await ui.waitFor(() => ui.App.repository.revision > rev, 'the save');
  const row = ui.disk().working.sessions.at(-1);
  assert.equal(row.duration, 2); assert.equal(row.amount, 123.46);
});

test('empty save writes nothing', async () => {
  const ui = await bootUi();
  const rev = ui.App.repository.revision, rows = ui.App.state.sessions.length;
  await ui.click('open-week-log');
  await ui.click('save-week');
  assert.equal(ui.App.repository.revision, rev);
  assert.equal(ui.App.state.sessions.length, rows);
});

test('stale revision: another write after open makes Save fail, keeps the ticks, adds no rows', async () => {
  const ui = await bootUi();
  await ui.click('open-week-log');
  await toggle(ui, 'c1', '2026-03-09');
  await ui.save();
  const rev = ui.App.repository.revision, rows = ui.disk().working.sessions.length;
  assert.equal(await ui.App.saveWeek(), false);
  assert.equal(ui.App.repository.revision, rev);
  assert.equal(ui.disk().working.sessions.length, rows);
  assert.equal(ticks(ui).length, 1);
});

test('week navigation keeps ticks and the review lists them', async () => {
  const ui = await bootUi();
  await ui.click('open-week-log');
  assert.equal(ui.App.weekLog.anchor(), '2026-03-09');
  await toggle(ui, 'c1', '2026-03-09');
  await ui.click('week-next');
  assert.equal(ui.App.weekLog.anchor(), '2026-03-16');
  await ui.click('week-prev'); await ui.click('week-prev');
  assert.equal(ui.App.weekLog.anchor(), '2026-03-02');
  assert.equal(ticks(ui).length, 1);
  assert.match(ui.field('week-review').innerHTML, /data-key="c1" data-date="2026-03-09"/);
  assert.match(ui.field('week-summary').textContent, /^1 session · /);
});

test('source guards: one chokepoint, script order, wiring', () => {
  const js = src('js/week-log.js');
  assert.ok(js.includes('session.saveMany'));
  for (const banned of ["'session.save'", 'session.update', 'session.correct', 'session.delete', 'localStorage', 'indexedDB'])
    assert.ok(!js.includes(banned), banned);
  const html = src('index.html');
  const at = s => html.indexOf('js/' + s + '.js');
  assert.ok(at('sessions') > 0 && at('sessions') < at('signatures') && at('signatures') < at('week-log') && at('week-log') < at('recurring'));
  assert.ok(html.includes('data-action="open-week-log"') && html.includes('id="modal-week"'));
  const ui = src('js/ui.js');
  for (const c of ["case 'open-week-log'", "case 'week-prev'", "case 'week-next'", "case 'week-toggle'", "case 'week-repeat-last'", "case 'save-week'", "action === 'week-edit'"])
    assert.equal(ui.split(c).length - 1, 1, c);
});

test('static guard: week-log.js and the whole tree report no state or storage mutation', () => {
  assert.deepEqual(analyzeSource(src('js/week-log.js'), 'week-log.js'), []);
  assert.deepEqual(scanDirectory(), []);
});
