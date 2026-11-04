'use strict';
// Dashboard comparison cards + "Hours by family" (2026-11-04): month-to-date windows DAY-MATCHED against the same
// month last year (default) or last month; "on pace" adds this month's scheduled rows; dashed last-year line on
// the Income Trend. FABRICATED DATA ONLY. Unit-tested + static, NOT observed live.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSource, recordingDocument } = require('./helpers/harness.cjs');
const { build } = require('./helpers/money-fixture.cjs');
const { bootUi } = require('./helpers/ui-app.cjs');

const close = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-6, label + ': ' + a + ' vs ' + b);

test('comparison is day-matched: Mar 1–5 against Feb 1–5, never against all of February', async () => {
  const { App } = await build({ globals: { document: recordingDocument() } });
  const c = App.dashboardComparison('2026-03-05', 'month');
  assert.equal(c.currentLabel, 'Mar 1–5');
  assert.equal(c.previousLabel, 'Feb 1–5');
  assert.equal(c.prevFullLabel, 'Feb');
  close(c.current.yourCut, 220, 'Mar 1–5 net (n1 95 after corrections + n2 125)');
  close(c.current.hours, 3, 'Mar 1–5 hours');
  close(c.previous.yourCut, 230, 'Feb 1–5 net (a1 100-20 + a2 150)');
  close(c.previous.hours, 2.5, 'Feb 1–5 hours');
  close(c.prevFull.yourCut, 341.875, 'all of February, for the on-pace line');
  close(c.perHour.current, 220 / 3, 'earned per hour now');
  close(c.perHour.previous, 92, 'earned per hour then');
  assert.equal(c.pace.scheduledCount, 0);
  close(c.pace.net, 220, 'pace = realized when nothing is scheduled');
});

test('same month last year is the default; the day clamps to a shorter month; pace adds scheduled rows, waived at $0', async () => {
  const { App } = await build({ globals: { document: recordingDocument() } });
  const y = App.dashboardComparison('2026-03-05', 'year');
  assert.equal(y.prevKey, '2025-03');
  assert.equal(y.previousLabel, 'Mar 1–5, 2025');
  assert.equal(y.prevFullLabel, 'Mar 2025');
  assert.equal(y.previous.sessionCount, 0, 'nothing fabricated in 2025');
  const clamp = App.dashboardComparison('2026-03-31', 'month');
  assert.equal(clamp.previousLabel, 'Feb', 'Feb 1–28 is the whole month');
  close(clamp.previous.yourCut, 341.875, 'whole February when the day runs past its end');
  const dec = App.dashboardComparison('2026-12-03', 'month');
  assert.equal(dec.pace.scheduledCount, 2, 'a5 + a7 scheduled in December');
  close(dec.pace.net, 200, 'a5 $200 + a7 waived $0');
  close(dec.pace.hours, 7, '2 h + 5 h still scheduled');
  assert.equal(dec.previousLabel, 'Nov 1–3');
});

test('hours by family roll siblings up, keep a family seen only in the comparison window, and render two bars', async () => {
  const document = recordingDocument();
  const { App } = await build({ globals: { document } });
  const cmp = App.dashboardComparison('2026-03-05', 'month');
  const rows = App.dashboardFamilyRows(cmp);
  // JSON, not deepEqual: arrays from the vm context have another realm's Array prototype.
  assert.equal(JSON.stringify(rows.map((r) => [r.label, r.hours, r.prevHours])), JSON.stringify([['Client Delta', 2, 0], ['Family Test-1', 1, 2.5]]));
  assert.equal(rows[1].family, 'Family Test-1');
  close(rows[1].net, 95, 'family net this window');
  assert.equal(rows[1].sessions, 1);
  App.renderFamilyHours(cmp);
  const html = document.getElementById('family-hours-list').innerHTML;
  assert.ok(html.includes('Family Test-1') && html.includes('Client Delta'));
  assert.ok(html.includes('class="family-hours-bar bar-now" style="width:80%"'), 'Delta 2 h of max 2.5 h');
  assert.ok(html.includes('class="family-hours-bar bar-then" style="width:100%"'), 'family 2.5 h last window');
  assert.ok(html.includes('<small>—</small>'), 'dash when nothing in the comparison window');
  assert.equal(document.getElementById('family-hours-sub').textContent, 'Mar 1–5 vs Feb 1–5');
});

test('wiring: the Compare select re-renders the cards; default is last year', async () => {
  const ui = await bootUi({ startAt: '2026-02-08T12:00:00', globals: { setTimeout: () => 1 } });
  ui.App.renderIncomeChart = () => {};
  ui.App.renderYearOverYearChart = () => {};
  assert.equal(ui.App.dashboardCompareMode(), 'year');
  ui.App.renderDashboard();
  assert.equal(ui.field('dashboard-compare-label').textContent, 'Feb 1–8 vs Feb 1–8, 2025');
  assert.equal(ui.field('dash-net').textContent, '$230.00', 'a1 80 + a2 150 + a3 waived (a6 on the 9th is still scheduled)');
  assert.equal(ui.field('dash-hours').textContent, '3h 30m');
  assert.equal(ui.field('dash-hours-sub').textContent, '3 sessions · 1h still scheduled');
  assert.equal(ui.field('dash-per-hour').textContent, '$65.71/h');
  assert.equal(ui.field('dash-revenue-trend').textContent, '▲ 100% · $0.00 in Feb 1–8, 2025');
  assert.equal(ui.field('dash-pace').textContent, '$290.00', '230 realized + a6 $60 scheduled');
  assert.equal(ui.field('dash-pace-sub').textContent, '1 session still scheduled this month');
  assert.equal(ui.field('dash-pace-trend').textContent, '▲ 100% · Feb 2025 finished at $0.00');
  for (const listener of ui.document.body.listeners.change || []) {
    await listener({ target: { id: '', value: 'month', getAttribute: (k) => (k === 'data-action' ? 'dashboard-compare' : null) } });
  }
  await ui.settle();
  assert.equal(ui.App.dashboardCompareMode(), 'month');
  assert.equal(ui.field('dashboard-compare-label').textContent, 'Feb 1–8 vs Jan 1–8');
  assert.equal(ui.field('dash-pace-trend').textContent, '▲ 100% · Jan finished at $0.00');
});

test('static: compare select above the cards, four month-to-date cards, Hours by family, dashed last-year line, handler wired', () => {
  const html = readSource('index.html'), css = readSource('styles.css'), dash = readSource('js/dashboard.js'), ui = readSource('js/ui.js');
  const sel = html.match(/<select[^>]*data-action="dashboard-compare"[^>]*>[\s\S]*?<\/select>/);
  assert.ok(sel, 'compare select exists');
  assert.match(sel[0], /value="year" selected/);
  assert.match(sel[0], /value="month"/);
  for (const id of ['dash-net', 'dash-pace', 'dash-hours', 'dash-per-hour', 'dash-revenue-trend', 'dash-pace-trend', 'dash-hours-trend',
    'dash-per-hour-trend', 'family-hours-list', 'family-hours-sub', 'dashboard-compare-label']) {
    assert.equal(html.split('id="' + id + '"').length - 1, 1, id + ' appears once');
  }
  for (const gone of ['dash-clients', 'dash-avg-rate', 'dash-sessions', 'top-clients-list', 'Top Clients']) assert.ok(!html.includes(gone), gone + ' removed');
  assert.ok(html.indexOf('data-action="dashboard-compare"') < html.indexOf('class="summary-cards"'), 'toggle sits above the cards');
  assert.match(dash, /label: 'Net, a year earlier'[\s\S]*?borderDash: \[6, 4\]/, 'dashed last-year dataset');
  assert.ok(dash.includes("const showPrevYear = rangeVal !== 'all'"), 'not drawn on All Time');
  assert.ok(dash.includes("metrics({ month: prevKey, dateEnd: prevKey + '-' + pad2(prevDay) })"), 'comparison window is day-matched');
  assert.ok(ui.includes("if (action === 'dashboard-compare') { App.setDashboardCompare(target.value); return; }"));
  assert.ok(css.includes('.family-hours-item {') && css.includes('.dashboard-compare {'));
  assert.ok(!css.includes('.top-clients-list'));
});
