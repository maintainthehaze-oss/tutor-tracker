'use strict';
// Dashboard / header / footer polish (2026-10-24): income audit behind an info toggle, sync string in Settings, "?" shortcuts popover.
// FABRICATED DATA ONLY. Unit-tested + static, NOT observed live.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSource } = require('./helpers/harness.cjs');
const { bootUi } = require('./helpers/ui-app.cjs');

test('static: info toggle, sync string in Settings, footer "?" popover', () => {
  const html = readSource('index.html'), css = readSource('styles.css');
  const tag = html.match(/<button[^>]*id="income-audit-toggle"[^>]*>/);
  assert.ok(tag, 'toggle exists');
  assert.match(tag[0], /data-action="toggle-income-audit"/);
  assert.match(tag[0], /\shidden[\s>]/);
  assert.equal(html.split('id="sync-indicator"').length - 1, 1);
  assert.ok(html.indexOf('id="sync-indicator"') > html.indexOf('id="modal-settings"'), 'sync string lives in Settings, not the header');
  assert.ok(html.includes('class="footer-help"'));
  assert.ok(!html.includes('class="footer-hint"'));
  const i = css.indexOf('.footer-help-menu {');
  assert.ok(i >= 0);
  assert.match(css.slice(i, css.indexOf('}', i)), /bottom:/, 'popover opens upward');
});

test('wiring: toggle-income-audit flips aria-expanded; empty notice stays hidden', async () => {
  const ui = await bootUi({ startAt: '2026-09-19T12:00:00', data: { syntheticOnly: true, clients: [], sessions: [], expenses: [], taxPayments: [], historical: [], receipts: {}, settings: { mileageRate: 0.5 } }, globals: { setTimeout: () => 1 } });
  const toggle = ui.field('income-audit-toggle');
  await ui.click('toggle-income-audit');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(ui.field('income-report-notice').hidden, true, 'no audit text, so the notice stays hidden');
  await ui.click('toggle-income-audit');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
});
