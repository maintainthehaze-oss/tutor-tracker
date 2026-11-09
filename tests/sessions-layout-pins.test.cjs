'use strict';
// Sessions tab pins that outlived the "This week" group (removed 2026-10-15 on MTH's request): the table tie-sort
// (2026-10-11 leftover) and the narrow-layout CSS pins. FABRICATED DATA ONLY. Unit-tested + static, NOT observed live.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSource } = require('./helpers/harness.cjs');
const { bootUi } = require('./helpers/ui-app.cjs');

const TODAY = '2026-09-19';
async function boot() {
  return bootUi({ startAt: TODAY + 'T12:00:00', data: { syntheticOnly: true, clients: [], sessions: [], expenses: [], taxPayments: [], historical: [], receipts: {}, settings: { mileageRate: 0.5 } },
    globals: { setTimeout: () => 1 } });
}

test('sessions table sort: ties within one date follow the Date direction (2026-10-11 leftover)', async () => {
  const ui = await boot(), App = ui.App;
  const rows = () => [
    { id: 'a', date: '2026-10-07', time: '16:15' }, { id: 'b', date: '2026-10-07', time: '18:30' },
    { id: 'c', date: '2026-10-06', time: '09:00' }, { id: 'd', date: '2026-10-07', time: '' }, { id: 'e', date: '2026-10-08', time: '10:00' }];
  const ids = (field, dir) => { Object.assign(App.sessionSort, { field, dir }); return App.sortSessions(rows()).map(r => r.id); };
  assert.deepEqual(ids('date', 'desc'), ['e', 'b', 'a', 'd', 'c'], 'newest time first when Date is descending; blank time sorts last');
  assert.deepEqual(ids('date', 'asc'), ['c', 'd', 'a', 'b', 'e'], 'earliest time first when Date is ascending');
  // Same input in any order lands in the same order (the stable-sort insertion order no longer decides ties).
  assert.deepEqual(ids('date', 'desc'), App.sortSessions(rows().reverse()).map(r => r.id));
  // Another column ties fall back to date then time in that column's direction.
  const sameAmount = () => [{ id: 'x', date: '2026-10-07', time: '08:00', amount: 50 }, { id: 'y', date: '2026-10-07', time: '12:00', amount: 50 }, { id: 'z', date: '2026-10-01', time: '12:00', amount: 60 }];
  Object.assign(App.sessionSort, { field: 'amount', dir: 'desc' });
  assert.deepEqual(App.sortSessions(sameAmount()).map(r => r.id), ['z', 'y', 'x']);
  Object.assign(App.sessionSort, { field: 'date', dir: 'desc' });
});

test('static: narrow layout pins - toolbar wraps / stacks, table scrolls inside its own wrap (640 px never observed on real data)', () => {
  const css = readSource('styles.css');
  const block = (selector, from = 0) => { const i = css.indexOf(selector + ' {', from); assert.ok(i >= 0, selector); return css.slice(i, css.indexOf('}', i)); };
  assert.match(block('.panel-toolbar'), /flex-wrap:\s*wrap;/, 'the Sessions toolbar must wrap at any width');
  assert.match(block('.toolbar-right'), /flex-wrap:\s*wrap;/, 'the button cluster must wrap');
  assert.match(block('.table-wrapper'), /overflow-x:\s*auto;/, 'the table scrolls inside its wrap, never the page');
  // Under 480 px the toolbar stacks; the only other .table-wrapper override is the print stylesheet.
  const narrow = css.indexOf('@media (max-width: 480px)'), tablet = css.indexOf('@media (max-width: 768px)');
  assert.ok(narrow > 0 && tablet > narrow);
  assert.match(block('.panel-toolbar', narrow), /flex-direction:\s*column;/, 'toolbar stacks under 480 px');
  const overrides = [...css.matchAll(/\.table-wrapper \{/g)].map(m => m.index), print = css.indexOf('@media print');
  assert.deepEqual(overrides.filter(i => i > narrow && i < print), [], 'no screen media query may override .table-wrapper');
  // 481-768 px: the header wraps and the stat pills take a full second row, so the page never scrolls sideways.
  assert.match(block('.app-header', tablet), /flex-wrap:\s*wrap;/, 'header wraps under 768 px');
  assert.match(block('.header-center', tablet), /flex-basis:\s*100%;/, 'stat pills take their own row under 768 px');
  assert.match(block('.live-stats', tablet), /flex-wrap:\s*wrap;/, 'stat pills wrap under 768 px');
  // The tab strip wraps in the same range, so "Tax Summary" is never clipped inside its own strip.
  assert.match(block('.tab-nav', tablet), /flex-wrap:\s*wrap;/, 'tab strip wraps under 768 px');
});

test('static: Sessions toolbar is Filters / More / Calculate now / Add Session; the whole-history Mileage rewrite is gone (2026-11-09)', () => {
  const html = readSource('index.html');
  const start = html.indexOf('id="panel-sessions"'), tb = html.indexOf('<div class="panel-toolbar">', start), end = html.indexOf('<!-- Month Navigator -->', tb);
  assert.ok(start > 0 && tb > start && end > tb);
  const toolbar = html.slice(tb, end);
  const menuStart = toolbar.indexOf('<div class="toolbar-more-menu"'), menuEnd = toolbar.indexOf('</details>');
  assert.deepEqual([...toolbar.slice(menuStart, menuEnd).matchAll(/data-action="([^"]+)"/g)].map(m => m[1]), ['toggle-edit-mode', 'export-sessions-csv'], 'More menu holds Edit Mode and CSV only');
  const direct = toolbar.replace(/<details[\s\S]*?<\/details>/, '');
  assert.deepEqual([...direct.matchAll(/data-action="([^"]+)"/g)].map(m => m[1]), ['toggle-filters', 'calc-now', 'add-session'], 'Calculate now is a visible toolbar button');
  // The old tool re-routed every writable row in all history; nothing may reach it any more.
  assert.ok(!html.includes('calc-mileage-by-day'), 'no calc-mileage-by-day action in the page');
  assert.ok(!readSource('js/ui.js').includes('calc-mileage-by-day') && !readSource('js/mileage.js').includes('calculateMileageByDay'));
  assert.equal(html.split('data-action="calc-now"').length - 1, 2, 'toolbar + Settings point at the same flow');
});

test('wiring: the Calculate now action reaches App.calculateNow; Save selected reaches App.saveCalculateNow', async () => {
  const ui = await boot();
  let calls = 0, saves = 0;
  ui.App.calculateNow = () => { calls++; };
  ui.App.saveCalculateNow = () => { saves++; };
  await ui.click('calc-now');
  await ui.click('calc-now-save');
  assert.equal(calls, 1); assert.equal(saves, 1);
});
