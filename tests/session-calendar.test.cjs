'use strict';
// Sessions-tab List / Calendar toggle (dashboard slice 2, ruled 2026-11-04): a 7-column month grid for the month the
// navigator shows, chips per session coloured by status, hover "+" per day that prefills the add-session date, a chip
// opens the session like the table's Edit. Toggle state in memory only. Dashboard gets one line, no grid.
// FABRICATED DATA ONLY. Unit-tested + static, NOT observed live by this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readSource } = require('./helpers/harness.cjs');
const { bootUi } = require('./helpers/ui-app.cjs');

const count = (hay, needle) => hay.split(needle).length - 1;

/** rawFixture() + one client with a family and a hostile name, inside the clock's month (Feb 2026). */
function data() {
  return {
    syntheticOnly: true,
    clients: [
      { id: 'c1', firstName: 'Client', lastName: 'Alpha', rate: 100, status: 'active', familyGroup: 'Family Test-1' },
      { id: 'c2', firstName: 'Client', lastName: 'Beta', rate: 60, status: 'active', familyGroup: 'Family Test-1' },
      { id: 'c3', firstName: 'Client', lastName: 'Gamma', rate: 80, status: 'active', familyGroup: 'Family Test-2' },
      { id: 'c4', firstName: 'Client', lastName: 'Delta', rate: 62.5, status: 'active' },
      { id: 'c5', firstName: '<b>Hostile', lastName: 'Name</b>', rate: 50, status: 'active', familyGroup: '<i>Fam</i>' },
    ],
    sessions: [
      { id: 'a1', clientIds: ['c1'], date: '2026-02-03', time: '16:00', duration: 1, amount: 100, status: 'completed', paid: true, payment: 'paid', paymentDate: '2026-02-10', mileage: 10 },
      { id: 'a2', clientIds: ['c1', 'c2'], date: '2026-02-05', time: '17:30', duration: 1.5, amount: 150, status: 'completed', paid: false, payment: 'unpaid', mileage: 0 },
      { id: 'a3', clientIds: ['c3'], date: '2026-02-07', time: '09:00', duration: 1, amount: 80, status: 'completed', paid: false, payment: 'waived', mileage: 4 },
      { id: 'a4', clientIds: ['c3'], date: '2026-02-08', time: '10:00', duration: 1, amount: 70, status: 'cancelled', paid: false, payment: 'unpaid', mileage: 0 },
      { id: 'a5', clientIds: ['c3'], date: '2026-12-01', time: '10:00', duration: 2, amount: 200, status: 'scheduled', paid: false, payment: 'unpaid', mileage: 0 },
      { id: 'a6', clientIds: ['c2'], date: '2026-02-09', time: '15:00', duration: 1, amount: 60, status: 'scheduled', paid: false, payment: 'unpaid', mileage: 0 },
      { id: 'a7', clientIds: ['c4'], date: '2026-02-09', time: '11:15', duration: 0.5, amount: 31.25, status: 'no-show', paid: false, payment: 'unpaid', mileage: 0 },
      { id: 'a8', clientIds: ['c5'], date: '2026-02-11', time: '', duration: 0.75, amount: 37.5, status: 'completed', paid: false, payment: 'unpaid', mileage: 0 },
    ],
    expenses: [], taxPayments: [], historical: [], receipts: {}, settings: { mileageRate: 0.5 },
  };
}
const TODAY = '2026-02-08';
const boot = () => bootUi({ startAt: TODAY + 'T12:00:00', data: data(), globals: { setTimeout: () => 1 } });

test('static: toggle beside the month navigator, grid container before the table, script order, no new storage key, handlers wired', () => {
  const html = readSource('index.html'), css = readSource('styles.css'), cal = readSource('js/session-calendar.js');
  const ui = readSource('js/ui.js'), table = readSource('js/session-table.js'), dash = readSource('js/dashboard.js');
  // Toggle lives inside the Sessions month navigator (not on the Dashboard).
  const nav = html.slice(html.indexOf('<nav class="month-nav"'), html.indexOf('</nav>', html.indexOf('<nav class="month-nav"')));
  assert.ok(nav.includes('data-action="session-view" data-view="list" id="session-view-list" aria-pressed="true"'), 'List button, pressed by default');
  assert.ok(nav.includes('data-action="session-view" data-view="calendar" id="session-view-calendar" aria-pressed="false"'), 'Calendar button');
  for (const id of ['session-view-list', 'session-view-calendar', 'session-calendar', 'sessions-table-wrap', 'dash-scheduled-count']) {
    assert.equal(count(html, 'id="' + id + '"'), 1, id + ' appears once');
  }
  assert.match(html, /<div class="session-calendar" id="session-calendar"[^>]*hidden><\/div>/, 'grid container ships hidden');
  assert.ok(html.indexOf('id="session-calendar"') < html.indexOf('id="sessions-table-wrap"'), 'grid sits above the table');
  // Script order: session-table -> session-calendar -> session-form, mirrored by the test helper.
  const order = [...html.matchAll(/<script src="js\/([a-z-]+)\.js(?:\?v=\d+)?" defer><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(order.slice(order.indexOf('session-table'), order.indexOf('session-table') + 3), ['session-table', 'session-calendar', 'session-form']);
  const helper = fs.readFileSync(path.join(__dirname, 'helpers/ui-app.cjs'), 'utf8');
  assert.ok(helper.includes("'session-table', 'session-calendar', 'session-form'"), 'bootUi loads the calendar in page order');
  // In memory only: the module never touches storage, never writes.
  for (const banned of ['localStorage', 'sessionStorage', 'indexedDB', 'runCommand', 'App.state.sessions =']) assert.ok(!cal.includes(banned), 'session-calendar.js must not use ' + banned);
  assert.ok(cal.includes("let sessionView = 'list';"), 'default view is the list');
  // Wiring.
  assert.ok(ui.includes("case 'session-view': App.setSessionView(target.getAttribute('data-view')); break;"));
  assert.ok(ui.includes("case 'open-calendar': App.openSessionCalendar(); break;"));
  assert.equal(count(table, 'if (App.renderSessionCalendar) App.renderSessionCalendar(filtered);'), 2, 'both renderSessions branches hand the rows over');
  // Chip = the table's own Edit path; "+" = the table's own add-session path with a date.
  assert.ok(cal.includes('data-action="edit-session" data-id="'));
  assert.ok(cal.includes('data-action="add-session" data-date="'));
  // Dashboard: one line under the cards, no grid markup inside the dashboard panel.
  const dashPanel = html.slice(html.indexOf('id="panel-dashboard"'), html.indexOf('id="panel-clients"'));
  assert.ok(dashPanel.indexOf('class="summary-cards"') < dashPanel.indexOf('id="dashboard-calendar-line"'), 'line sits under the cards');
  assert.ok(dashPanel.indexOf('id="dashboard-calendar-line"') < dashPanel.indexOf('class="charts-row"'), 'line sits above the charts');
  assert.ok(dashPanel.includes('data-action="open-calendar">Open calendar</button>'));
  for (const grid of ['calendar-grid', 'session-calendar', 'calendar-day']) assert.ok(!dashPanel.includes(grid), 'no ' + grid + ' on the Dashboard');
  assert.ok(dash.includes("setText('dash-scheduled-count', cmp.pace.scheduledCount + ' session'"), 'count comes from the comparison model, not a new read');
  // CSS: 7 columns, hover-revealed "+", four chip colours.
  const block = (sel) => { const i = css.indexOf(sel + ' {'); assert.ok(i >= 0, sel); return css.slice(i, css.indexOf('}', i)); };
  assert.match(block('.calendar-grid'), /grid-template-columns:\s*repeat\(7, 1fr\);/);
  assert.match(block('.calendar-add'), /opacity:\s*0;/);
  assert.ok(css.includes('.calendar-day:hover .calendar-add,'), 'the + shows on hover');
  for (const chip of ['chip-scheduled', 'chip-completed', 'chip-unpaid', 'chip-muted']) assert.ok(css.includes('.calendar-chip.' + chip + ' {'), chip);
  // The owner rules file records the ruling (the old "do not re-add" line no longer covers the Sessions tab).
  const rules = fs.readFileSync(path.join(__dirname, '../CLAUDE-INSTRUCTIONS.md'), 'utf8');
  assert.ok(rules.includes('2026-11-04') && rules.includes('List / Calendar toggle inside the Sessions tab'), 'ruling recorded');
  assert.ok(!rules.includes('Heatmap, calendar and the Dashboard'), 'old blanket ban line is gone');
});

test('wiring: the toggle flips the view both ways; All time falls back to the list; calendar from All time jumps to this month', async () => {
  const ui = await boot(), App = ui.App;
  App.renderSessions();
  assert.equal(App.getSessionView(), 'list');
  assert.equal(ui.field('session-calendar').hidden, true);
  assert.equal(ui.field('sessions-table-wrap').hidden, false);
  assert.equal(ui.field('session-view-list').getAttribute('aria-pressed'), 'true');

  await ui.click('session-view', { 'data-view': 'calendar' });
  assert.equal(App.getSessionView(), 'calendar');
  assert.equal(ui.field('session-calendar').hidden, false);
  assert.equal(ui.field('sessions-table-wrap').hidden, true);
  assert.equal(ui.field('session-view-calendar').getAttribute('aria-pressed'), 'true');
  assert.equal(ui.field('session-view-list').getAttribute('aria-pressed'), 'false');
  assert.ok(ui.field('session-calendar').innerHTML.includes('data-date="2026-02-01"'), 'February drawn');

  await ui.click('session-view', { 'data-view': 'list' });
  assert.equal(App.getSessionView(), 'list');
  assert.equal(ui.field('session-calendar').hidden, true);
  assert.equal(ui.field('sessions-table-wrap').hidden, false);

  // The calendar is by month: All time sends it back to the list; Calendar from All time picks the current month.
  await ui.click('session-view', { 'data-view': 'calendar' });
  await ui.click('session-month-all');
  assert.equal(App.getSessionMonth(), '');
  assert.equal(App.getSessionView(), 'list');
  assert.equal(ui.field('session-calendar').hidden, true);
  await ui.click('session-view', { 'data-view': 'calendar' });
  assert.equal(App.getSessionMonth(), '2026-02');
  assert.equal(App.getSessionView(), 'calendar');
  // Month navigation re-renders the grid in place.
  await ui.click('session-month-next');
  assert.equal(App.getSessionView(), 'calendar');
  assert.ok(ui.field('session-calendar').innerHTML.includes('data-date="2026-03-31"'), 'March drawn after Next');
  assert.ok(!ui.field('session-calendar').innerHTML.includes('data-date="2026-02-'), 'February gone');
});

test('wiring: a day "+" opens Add Session on that date; a chip opens that session like the table Edit button', async () => {
  const ui = await boot(), App = ui.App;
  await ui.click('session-view', { 'data-view': 'calendar' });
  const html = ui.field('session-calendar').innerHTML;
  assert.ok(html.includes('data-action="add-session" data-date="2026-02-14"'), 'the 14th has a +');
  await ui.click('add-session', { 'data-date': '2026-02-14' });
  assert.equal(ui.field('modal-session-title').textContent, 'Add Session');
  assert.equal(ui.field('session-date').value, '2026-02-14');
  assert.equal(ui.field('session-id').value, '');
  // Chip = the row's Edit: same action, same id.
  assert.ok(html.includes('class="calendar-chip chip-unpaid" data-action="edit-session" data-id="a2"'));
  await ui.click('edit-session', { 'data-id': 'a2' });
  assert.equal(ui.field('session-id').value, 'a2');
  assert.equal(ui.field('session-date').value, '2026-02-05');
  assert.equal(ui.field('session-time').value, '17:30');
  // Saving from the form still lands on the shown month (showMonthOf) and keeps calendar mode.
  assert.equal(App.getSessionView(), 'calendar');
});

test('wiring: the Dashboard line counts this month\'s scheduled rows and "Open calendar" lands on Sessions, calendar mode, this month', async () => {
  const ui = await boot(), App = ui.App;
  App.renderIncomeChart = () => {};
  App.renderYearOverYearChart = () => {};
  App.renderDashboard();
  assert.equal(ui.field('dash-scheduled-count').textContent, '1 session scheduled this month', 'a6 on Feb 9; a5 is December');
  App.setSessionMonth('2025-11', false);
  assert.equal(App.state.activeTab, 'dashboard');
  await ui.click('open-calendar');
  assert.equal(App.state.activeTab, 'sessions');
  assert.equal(App.getSessionView(), 'calendar');
  assert.equal(App.getSessionMonth(), '2026-02', 'jumped to the current month');
  // Plural form.
  ui.clock.now = new Date('2026-12-01T12:00:00').getTime();
  App.renderDashboard();
  assert.equal(ui.field('dash-scheduled-count').textContent, '1 session scheduled this month', 'a5 only in December');
  ui.clock.now = new Date('2026-07-01T12:00:00').getTime();
  App.renderDashboard();
  assert.equal(ui.field('dash-scheduled-count').textContent, '0 sessions scheduled this month');
});

test('render: every day of the month, outside cells pad the weeks, chips sorted by time with status colours, every user value escaped', async () => {
  const ui = await boot(), App = ui.App;
  await ui.click('session-view', { 'data-view': 'calendar' });
  const feb = ui.field('session-calendar').innerHTML;
  for (let d = 1; d <= 28; d++) assert.equal(count(feb, 'data-date="2026-02-' + String(d).padStart(2, '0') + '"'), 2, 'day ' + d + ': cell + its +');
  assert.ok(!feb.includes('2026-02-29'));
  assert.equal(count(feb, 'class="calendar-day is-outside"'), 0, 'Feb 2026 starts on a Sunday and ends on a Saturday');
  assert.equal(count(feb, '<span>Sun</span>'), 1);
  assert.equal(count(feb, 'class="calendar-day is-today'), 1, 'today ring');
  assert.ok(feb.includes('class="calendar-day is-today has-sessions" data-date="2026-02-08"'));
  // Status colours.
  assert.ok(feb.includes('chip-completed" data-action="edit-session" data-id="a1"'), 'paid completed');
  assert.ok(feb.includes('chip-unpaid" data-action="edit-session" data-id="a2"'), 'unpaid completed');
  assert.ok(feb.includes('chip-completed" data-action="edit-session" data-id="a3"'), 'waived counts as settled');
  assert.ok(feb.includes('chip-muted" data-action="edit-session" data-id="a4"'), 'cancelled muted');
  assert.ok(feb.includes('chip-scheduled" data-action="edit-session" data-id="a6"'), 'scheduled');
  assert.ok(feb.includes('chip-muted" data-action="edit-session" data-id="a7"'), 'no-show muted');
  assert.ok(!feb.includes('data-id="a5"'), 'December row not drawn in February');
  // Two chips on the 9th sort by time: 11:15 (a7) before 15:00 (a6).
  assert.ok(feb.indexOf('data-id="a7"') < feb.indexOf('data-id="a6"'));
  // Chip content: time, family (siblings de-duplicated) or client, duration.
  assert.ok(feb.includes('<span class="chip-time">17:30</span><span class="chip-label">Family Test-1</span><span class="chip-duration">1h 30m</span>'), 'a2: two siblings, one family label');
  assert.ok(feb.includes('<span class="chip-label">Client Delta</span><span class="chip-duration">30m</span>'), 'a7: no family -> client name');
  assert.ok(feb.includes('data-id="a8" title="&lt;i&gt;Fam&lt;/i&gt; · 45m · completed, unpaid"><span class="chip-label">&lt;i&gt;Fam&lt;/i&gt;</span>'), 'a8: blank time omitted, family escaped');
  assert.ok(!feb.includes('<i>Fam</i>') && !feb.includes('<b>Hostile'), 'nothing hostile reaches the markup unescaped');
  // Padding: April 2026 starts on a Wednesday (3 leading) and ends on a Thursday (2 trailing) -> 35 cells.
  const apr = App.calendarHtml('2026-04', App.state.sessions);
  assert.equal(count(apr, 'class="calendar-day is-outside"'), 5);
  assert.equal((apr.match(/<div class="calendar-day(?: [^"]*)?" /g) || []).length, 35, '7 x 5 cells');
  assert.equal(count(apr, 'data-action="add-session"'), 30);
  assert.ok(!apr.includes('calendar-chip'), 'nothing fabricated in April');
  // Filters apply to the grid too (same rows as the table).
  ui.field('filter-status').value = 'scheduled';
  App.renderSessions();
  const only = ui.field('session-calendar').innerHTML;
  assert.equal(count(only, 'calendar-chip'), 1);
  assert.ok(only.includes('data-id="a6"'));
  ui.field('filter-status').value = '';
});
