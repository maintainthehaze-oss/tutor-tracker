'use strict';
// Roadmap 4.2, second two-way-door pass: the published read view shares the frozen receipts map, a draft shares the
// frozen historical rows and copies the receipts map shallowly, and the archive's raw-snapshot checks run once per
// frozen archive. Stored bytes are unchanged (proved by a scratch old-vs-new run of 12 commands). Fabricated data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { activate, command } = require('./helpers/harness.cjs');
const { MODULES, rawFixture } = require('./helpers/money-fixture.cjs');

test('read(): the receipts map is the frozen stored object, identical across reads, and still refuses edits', async () => {
  const { App } = await activate(MODULES, rawFixture());
  const repo = App.repository;
  await command(repo, 'expense.save', { record: { id: 'r1', date: '2026-03-01', category: 'supplies', amount: 5 }, receipt: 'data:image/png;base64,QUJD' });
  const a = repo.read().receipts, b = repo.read().receipts;
  assert.equal(a, b, 'no per-read clone of the receipt bodies');
  assert.ok(Object.isFrozen(a));
  assert.equal(a.r1, 'data:image/png;base64,QUJD');
  assert.throws(() => { 'use strict'; a.r1 = 'x'; }, TypeError);
  // A later command sees a fresh map; the earlier view is untouched (receipt bodies are replaced whole, never edited).
  await command(repo, 'expense.save', { record: { id: 'r1', date: '2026-03-01', category: 'supplies', amount: 6 }, receipt: 'data:image/png;base64,WFla' });
  assert.equal(repo.read().receipts.r1, 'data:image/png;base64,WFla');
  assert.equal(a.r1, 'data:image/png;base64,QUJD');
  await command(repo, 'expense.delete', { id: 'r1' });
  assert.equal(Object.hasOwn(repo.read().receipts, 'r1'), false);
});

test('a tampered archive is still refused on reopen (the once-per-archive check never skips an unfrozen envelope)', async () => {
  const { App, disk } = await activate(MODULES, rawFixture());
  await command(App.repository, 'settings.update', { patch: { businessName: 'x' } });
  const stored = disk();
  stored.archive.originals.settings = { ...stored.archive.originals.settings, businessName: 'forged' };
  await assert.rejects(activate(MODULES, null, { stored }), /Archive raw snapshot mismatch|integrity|Invalid/);
});
