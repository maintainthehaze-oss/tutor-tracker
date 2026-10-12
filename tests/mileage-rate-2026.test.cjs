'use strict';
// IRS business mileage rate for 2026 changed mid-year (IR-2026-29): 72.5c through 2026-06-30, 76c from 2026-07-01.
// 2027 is unpublished and falls through to the Settings rate. Fabricated data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { activate, command } = require('./helpers/harness.cjs');
const { MODULES, rawFixture, newSession } = require('./helpers/money-fixture.cjs');

test('rate(): 2026 is split on July 1; other years unchanged; 2027 uses the Settings rate', async () => {
  const { App } = await activate(MODULES, rawFixture());          // fixture Settings rate is 0.5
  const rate = App.reportModel.rate;
  assert.equal(rate({ date: '2026-06-30' }, '2026'), 0.725);
  assert.equal(rate({ date: '2026-07-01' }, '2026'), 0.76);
  assert.equal(rate({ date: '2026-12-31' }, 2026), 0.76);
  assert.equal(rate({ date: '2026' }, '2026'), 0.725, 'a partial 2026 date takes the first-half rate');
  assert.equal(rate({}, '2026'), 0.725, 'no date: first-half rate');
  assert.equal(rate({ date: '2025-09-01' }, '2025'), 0.70);
  assert.equal(rate({ date: '2024-09-01' }, '2024'), 0.67);
  const row = App.reportModel.context('current-v2').sessions[0];               // a real row carries its captured settings
  assert.equal(rate({ ...row, date: '2027-01-05' }, '2027'), 0.5, '2027 is not published: Settings rate');
  assert.equal(rate(null, '2027'), 0.5, 'no row: the current Settings rate');
});

test('tax summary: a July 2026 leg deducts at 76c, a June one at 72.5c, and the label names both rates', async () => {
  const { App, repo } = await (async () => { const env = await activate(MODULES, rawFixture()); return { App: env.App, repo: env.App.repository }; })();
  const deduction = () => { App.refreshReadViews(); return App.getTaxData(2026); };
  const before = deduction();
  assert.equal(before.mileageRateLabel, '$0.725/mi (2026)', 'fixture rows are all first-half 2026');
  await command(repo, 'session.save', { record: newSession('h2', { clientIds: ['c1'], date: '2026-07-01', amount: 100, status: 'completed', mileage: 10 }) });
  const july = deduction();
  assert.equal(+(july.mileageDeduction - before.mileageDeduction).toFixed(2), 7.6);
  assert.equal(july.mileageRateLabel, '$0.725/mi then $0.760/mi (2026, IRS mid-year change)');
  await command(repo, 'session.save', { record: newSession('h1', { clientIds: ['c1'], date: '2026-06-30', amount: 100, status: 'completed', mileage: 10 }) });
  assert.equal(+(deduction().mileageDeduction - july.mileageDeduction).toFixed(2), 7.25);
});
