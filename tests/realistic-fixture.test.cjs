'use strict';
// Roadmap 4.7: the realistic-shape fixture generator. Pins the SHAPE the real store was measured to have
// (plan §1, 2026-10-11) so scale-sensitive work (save latency, table rendering) runs against it, and pins
// that nothing in it could be mistaken for real data (public repository).
const test = require('node:test');
const assert = require('node:assert/strict');
const { SHAPE, generate, buildRealistic } = require('./helpers/realistic-fixture.cjs');
const { command } = require('./helpers/harness.cjs');

const sig = r => `${r.clientIds.join('+')}|${r.duration}|${r.amount}|${r.type}`;

test('generator: deterministic per seed, fabricated names only', () => {
  const a = JSON.stringify(generate({ seed: 7 })), b = JSON.stringify(generate({ seed: 7 })), c = JSON.stringify(generate({ seed: 8 }));
  assert.equal(a, b, 'same seed, same bytes');
  assert.notEqual(a, c, 'another seed, different data');
  const data = generate();
  assert.equal(data.syntheticOnly, true);
  assert.ok(data.clients.every(x => x.firstName === 'Client' && /^Family Test-[A-C]$/.test(x.familyGroup || 'Family Test-A')), 'every client is obviously fabricated');
  assert.ok(data.clients.every(x => /Faketown|Mocksville/.test(x.address)), 'addresses are fabricated');
});

test('generator: the measured shape - 12 clients / 3 families / 144 sessions / 1,652 historical', () => {
  const data = generate();
  assert.equal(data.clients.length, SHAPE.clients);
  assert.equal(new Set(data.clients.map(c => c.familyGroup).filter(Boolean)).size, SHAPE.families);
  assert.equal(data.sessions.length, SHAPE.sessions);
  assert.equal(data.historical.length, SHAPE.historical);
  assert.equal(new Set([...data.sessions, ...data.historical].map(r => r.id)).size, SHAPE.sessions + SHAPE.historical, 'ids never collide');
  const bySig = new Map();
  data.sessions.forEach(r => bySig.set(sig(r), (bySig.get(sig(r)) || 0) + 1));
  assert.equal(bySig.get('c2+c7+c8|2|300|in-person'), 14, 'the family trio signature is the single biggest shared row');
  assert.equal(bySig.get('c2+c8|1.5|150|in-person'), 12, 'duo rows');
  assert.equal(data.sessions.filter(r => r.clientIds.join() === 'c10').length, 38, 'the high-frequency single client');
  assert.equal(data.sessions.filter(r => r.status === 'scheduled').length, SHAPE.future, 'rows entered ahead of time');
  assert.equal(data.sessions.filter(r => r.updatedAt && r.updatedAt.startsWith(SHAPE.batchDay)).length, SHAPE.batchRows, 'batch-entry cluster');
  assert.ok(data.sessions.some(r => r.type === 'hybrid' && /in person.*remote/.test(r.notes)), 'a hybrid note the model cannot hold yet (Slice F)');
  assert.ok(data.sessions.some(r => r.duration === 0 && r.amount === 0 && r.status === 'cancelled'), 'the zero-duration cancelled row');
  assert.ok(data.historical.every(r => r.date < '2026-01-01' && /^\d+\.\d\d$/.test(r.amount)), 'historical rows are pre-2026 strings like the archive');
});

test('generator: activates, verifies, seeds 107 events and reads back at scale', async () => {
  const { App, repo, disk, seeded } = await buildRealistic();
  assert.equal(seeded.events, SHAPE.events);
  const stored = disk();
  assert.equal(stored.events.length, SHAPE.events, 'every seeded event is in the envelope');
  assert.equal(stored.events.filter(e => e.type === 'payment' && e.date === '2026-09-17').length, 10, 'the lump payment day');
  assert.ok(stored.events.some(e => e.type === 'payment' && e.method === 'Zelle') && stored.events.some(e => e.type === 'payment' && !e.method), 'about half the payments carry no method');
  const view = repo.read();
  assert.equal(view.sessions.length, SHAPE.sessions);
  assert.equal(view.historical.length, SHAPE.historical);
  assert.equal(view.clients.length, SHAPE.clients);
  assert.equal(view.sessions.filter(r => r.status === 'scheduled').length, 2, '10 scheduled rows minus 8 status events');
  // Records alone are the realistic size class (hundreds of KB, not the 3 KB demo file); receipts are opt-in.
  assert.ok(JSON.stringify(stored).length > 500_000, 'realistic byte size: ' + JSON.stringify(stored).length);
  assert.ok(JSON.stringify(generate({ receiptBytes: 400_000 })).length > 400_000, 'receipt padding is available for latency work');
  // One more write at this scale stays well inside the §4.2 budget (measured ~200 ms on the real store).
  const t0 = performance.now();
  await command(repo, 'session.save', { record: { id: 'perf-1', clientIds: ['c1'], date: '2026-10-11', time: '16:00', type: 'in-person', duration: 1, amount: 80, companyAmount: 0, companySplit: 0, status: 'completed', paid: false, payment: 'unpaid', paymentDate: null, mileage: 0, notes: '' } });
  const ms = performance.now() - t0;
  assert.ok(ms < 2000, 'one save at realistic scale took ' + ms.toFixed(0) + ' ms');
  assert.equal(App.repository.read().sessions.length, SHAPE.sessions + 1);
});
