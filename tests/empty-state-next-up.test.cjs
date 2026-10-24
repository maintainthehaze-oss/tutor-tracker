'use strict';
// Sessions empty month: "Next up" line, Go to that month, Add Session. Fabricated data only; unit-level wiring evidence.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bootUi } = require('./helpers/ui-app.cjs');
const { rawFixture } = require('./helpers/money-fixture.cjs');

const withSessions = sessions => { const d = rawFixture(); d.sessions = sessions; return d; };
const sched = { id: 's1', clientIds: ['c1'], date: '2026-11-15', time: '16:00', duration: 1, amount: 100, status: 'scheduled', mileage: 0 };

test('empty month with a future scheduled row: Next up, client name, goto button, Add Session', async () => {
  const ui = await bootUi({ data: withSessions([sched]) });
  ui.App.setSessionMonth('2027-01');
  const html = ui.field('sessions-tbody').innerHTML;
  assert.match(html, /No sessions in January 2027/);
  assert.match(html, /Next up: .*Nov 15.*16:00.*Client Alpha/);
  assert.match(html, /data-action="session-month-goto" data-month="2026-11"/);
  assert.match(html, /data-action="session-month-all"/);
  assert.match(html, /data-action="add-session" data-date="2027-01-01"/);
});

test('empty month with no future scheduled row: no Next up, still Add Session (today prefill for a past month)', async () => {
  const past = { ...sched, date: '2026-01-05', status: 'completed' };
  const ui = await bootUi({ data: withSessions([past, { ...sched, id: 's2', date: '2026-11-15', status: 'completed' }]) });
  ui.App.setSessionMonth('2025-06');
  const html = ui.field('sessions-tbody').innerHTML;
  assert.doesNotMatch(html, /Next up/);
  assert.match(html, /data-action="add-session" data-date="2026-03-10"/);
});

test('goto button navigates to that month', async () => {
  const ui = await bootUi({ data: withSessions([sched]) });
  ui.App.setSessionMonth('2027-01');
  await ui.click('session-month-goto', { 'data-month': '2026-11' });
  assert.match(ui.field('sessions-tbody').innerHTML, /Client Alpha/);
  assert.doesNotMatch(ui.field('sessions-tbody').innerHTML, /No sessions in/);
});
