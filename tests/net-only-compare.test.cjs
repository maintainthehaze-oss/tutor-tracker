'use strict';
// Net-only comparisons + split UI removed (MTH, 2026-11-04): every Dashboard comparison is net vs net (cards AND the
// two charts), and no screen shows a company split figure any more (no Show split toggle, no Split column, no
// Historical Share card/columns, no gross/share chart lines). The data model is untouched: net still equals
// gross minus the stored split, and the CSV exports keep their columns. FABRICATED DATA ONLY.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSource } = require('./helpers/harness.cjs');
const { bootUi } = require('./helpers/ui-app.cjs');

const count = (hay, needle) => hay.split(needle).length - 1;

test('static: no split UI anywhere on screen; Reports labels say Net; table colspans match the narrower tables', () => {
  const html = readSource('index.html'), css = readSource('styles.css');
  const js = Object.fromEntries(['app-core', 'ui', 'dashboard', 'historical', 'session-table', 'reports', 'sessions'].map((m) => [m, readSource('js/' + m + '.js')]));
  for (const gone of ['toggle-split', 'split-info', 'dash-gross-split', 'report-company-split', 'report-foot-split', 'family-foot-split',
    'Historical Share</', 'Show split', 'data-sort="split"', 'Your Cut (after split)', 'after split,']) {
    assert.equal(count(html, gone), 0, 'index.html still has ' + gone);
  }
  assert.ok(html.includes('<span class="card-label">Net Revenue</span>'), 'Reports: Your Cut card relabelled Net Revenue');
  assert.ok(html.includes('<span class="card-label">Net Profit (after expenses, mileage)</span>'));
  assert.ok(html.includes('<th>Gross</th>\n                <th>Net</th>') || html.includes('<th>Gross</th>\r\n                <th>Net</th>'), 'family table: Gross then Net');
  assert.ok(!css.includes('.split-collapsed'), 'the hide-split CSS rule is gone');
  for (const [m, src] of Object.entries(js)) {
    for (const gone of ['showSplit', 'toggleSplit', 'applySplitPref', 'split-info', 'split-collapsed', 'tutoring-show-split', 'SPLIT_PREF_KEY']) {
      assert.equal(count(src, gone), 0, m + '.js still has ' + gone);
    }
  }
  // Sessions table: 8 visible columns (check column is hidden), so the empty rows span 8.
  const sessionsTable = html.slice(html.indexOf('<table class="data-table" id="sessions-table">'), html.indexOf('</table>', html.indexOf('id="sessions-table"')));
  assert.equal((sessionsTable.match(/<th[ >]/g) || []).length, 9, '8 visible headers + the hidden check column');
  assert.ok(sessionsTable.includes('<td colspan="8">No sessions recorded yet</td>'));
  assert.ok(js['session-table'].includes('<tr class="empty-row"><td colspan="8">'));
  assert.ok(!js['session-table'].includes('splitDisplay') && !js['session-table'].includes('companyAmount'), 'no split cell in either row renderer');
  // Reports monthly table 8 columns, family table 6.
  assert.ok(js.reports.includes('<tr><td colspan="8">No data for this selection</td></tr>'));
  assert.ok(js.reports.includes('<tr><td colspan="6">No data for this selection</td></tr>'));
  assert.equal(count(js.reports, 'companySplit'), 0, 'reports.js renders no split figure');
  // Data model and exports untouched.
  assert.ok(readSource('js/report-model.js').includes('M.hasLegacyShare='), 'report-model still computes the share');
  assert.ok(js.ui.includes('Historical Share,Your Cut,Expenses,Net'), 'report CSV keeps its columns');
  assert.ok(js.ui.includes("c.status, c.familyGroup, c.companySplit,"), 'client CSV keeps companySplit');
});

test('static: the Income Trend is net vs net a year earlier and the Year-over-Year bars are net only', () => {
  const dash = readSource('js/dashboard.js'), hist = readSource('js/historical.js');
  for (const gone of ['Gross Income', 'Historical share', 'grossData', 'companyData', 'hasLegacyShare']) assert.equal(count(dash, gone), 0, 'dashboard.js still has ' + gone);
  assert.match(dash, /label: 'Net Revenue',[\s\S]*?fill: true,/, 'net is now the filled line');
  assert.ok(dash.includes("].filter((dataset) => dataset.label !== 'Net, a year earlier' || showPrevYear),"));
  assert.ok(dash.includes("label: 'Net, a year earlier'"));
  for (const gone of ['Gross Revenue', 'Historical share', 'grossData', 'cpData', 'colorGross', 'colorCp', 'hasLegacyShare']) assert.equal(count(hist, gone), 0, 'historical.js still has ' + gone);
  assert.equal(count(hist, "label: '"), 1, 'exactly one YoY dataset');
  assert.ok(hist.includes("label: 'Net Revenue'"));
  // Every card trend compares yourCut with yourCut (or values derived from it).
  assert.ok(dash.includes("setTrend('dash-revenue-trend', current.yourCut, previous.yourCut,"));
  assert.ok(dash.includes("setTrend('dash-pace-trend', cmp.pace.net, prevFull.yourCut,"));
  assert.ok(dash.includes("const perHour = (m) => (m.hours > 0 ? m.yourCut / m.hours : 0);"));
  assert.ok(!dash.includes('current.gross') && !dash.includes('previous.gross'), 'no gross figure reaches a card');
});

test('render: the Income Trend chart receives exactly Net Revenue + Net a year earlier, with net values', async () => {
  const configs = [];
  const ui = await bootUi({ startAt: '2026-03-10T12:00:00', globals: { setTimeout: () => 1,
    Chart: class { constructor(canvas, config) { configs.push(config); } destroy() {} update() {} } } });
  const App = ui.App;
  App.renderYearOverYearChart = () => {};
  // The fake DOM has no canvas parent; give the chart a canvas and its wrapper.
  const canvas = ui.field('income-chart');
  canvas.parentNode = { hidden: false };
  ui.document.getElementById('(query) [data-action="income-chart-range"]').value = '12';
  App.renderIncomeChart();
  assert.equal(configs.length, 1, 'one chart built');
  const labels = configs[0].data.datasets.map((d) => d.label);
  assert.equal(JSON.stringify(labels), JSON.stringify(['Net Revenue']), 'no last-year line when nothing was earned a year earlier; no gross, no share');
  const net = configs[0].data.datasets[0];
  const feb = configs[0].data.labels.indexOf('Feb 26');
  assert.ok(feb >= 0);
  // February net per the shared model (same figure the slice-1 test pins for "all of February"): 341.875.
  // Gross would be 361.875; the 20.00 stored split on a1 is what separates the two.
  assert.ok(Math.abs(net.data[feb] - 341.875) < 1e-6, 'net, not gross: ' + net.data[feb]);
  assert.ok(Math.abs(App.reportModel.metrics({ month: '2026-02' }).gross - 361.875) < 1e-6, 'gross differs, so the pin is load-bearing');
  assert.equal(net.fill, true);
});

test('wiring: the dashboard still renders with the gross/share sub line gone and the Reports tab without the share card', async () => {
  const ui = await bootUi({ startAt: '2026-02-08T12:00:00', globals: { setTimeout: () => 1 } });
  const App = ui.App;
  App.renderIncomeChart = () => {};
  App.renderYearOverYearChart = () => {};
  App.renderDashboard();
  assert.equal(ui.field('dash-net').textContent, '$230.00');
  assert.equal(ui.field('dash-revenue-trend').textContent, '▲ 100% · $0.00 in Feb 1–8, 2025');
  assert.equal(ui.document.elements.has('dash-gross-split'), false, 'nothing ever asked for the old sub line');
  App.renderReports();
  assert.equal(ui.document.elements.has('report-company-split'), false, 'nothing ever asked for the share card');
  assert.equal(ui.document.elements.has('report-foot-split'), false);
  assert.equal(ui.document.elements.has('family-foot-split'), false);
  assert.equal(typeof App.toggleSplit, 'undefined');
  assert.equal(typeof App.showSplit, 'undefined');
});
