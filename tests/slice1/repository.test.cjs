'use strict';
// Synthetic fixtures only. This suite tests the real repository with a MEMORY
// adapter; quota/interruption/CAS checks here do not prove browser IDB behavior.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const policySource = fs.readFileSync(path.join(root, 'protected/js/record-policy.js'), 'utf8');
const repositorySource = fs.readFileSync(path.join(root, 'protected/js/repository.js'), 'utf8');
const copy = x => x == null ? x : JSON.parse(JSON.stringify(x));
function load(source = repositorySource, clock = Date) {
  const App = { DEFAULT_SETTINGS: { autoSync: 'off', defaultDuration: 1 } };
  const context = vm.createContext({ window: { App }, crypto: webcrypto, TextEncoder, console,
    location: { hostname: 'localhost' }, indexedDB: {}, Date: clock });
  vm.runInContext(policySource, context);
  vm.runInContext(source, context);
  return App.Repository;
}
function memoryAdapter() {
  let stored = null, fault = null, hold = null;
  return {
    read: async () => copy(stored),
    async compareAndSwap(expected, next) {
      if (hold) { const pending = hold; hold = null; await pending; }
      if (fault) { const e = fault; fault = null; throw Error(e); }
      if ((stored && stored.integrity) !== (expected && expected.integrity) ||
          (stored && stored.revision) !== (expected && expected.revision)) throw Error('Memory CAS conflict');
      stored = copy(next);
    },
    failNext(message) { fault = message; },
    holdNext() { let release; hold = new Promise(resolve => { release = resolve; }); return release; },
    corrupt(fn) { fn(stored); },
  };
}
function fixture() {
  return { syntheticOnly: true,
    clients: [{ id: 7, name: 'Fabricated Client', hourlyRate: '55', status: 'active', companySplit: '20',
      splitHistory: [{ date: '2020-01-01', percent: 20 }], unknownClient: null }],
    sessions: [
      { id: 'old', clientId: 7, date: '2025-02-01', paymentStatus: 'unpaid', amount: '55', status: 'completed', unknown: { retained: true } },
      { id: 'old-scheduled', date: '2026-09-10', status: 'scheduled', amount: 10 },
      { id: 'old-cancelled', date: '2026-09-11', status: 'cancelled' },
    ],
    expenses: [{ id: 'expense-old', amount: '8', unknown: false }],
    taxPayments: [{ id: 'tax-old', amount: '40', year: 2025 }],
    historical: [{ id: 'history-old', year: 2024, income: '100' }],
    settings: { companySplit: 20, defaultDuration: '1', unknown: null },
    receipts: { 'expense-old': { data: 'synthetic-receipt', metadata: { size: 1 } } },
  };
}
function session(id = 'draft') {
  return { id, date: '2026-09-06', duration: 1, amount: 55, clientIds: [7], status: 'scheduled',
    paid: false, payment: 'unpaid', companyAmount: 400, companySplit: 80, unknown: { keep: true } };
}
async function setup(source) {
  const api = load(source), adapter = memoryAdapter(), repo = api.create(adapter);
  const raw = JSON.stringify(fixture(), null, 2);
  await repo.activateSynthetic(raw, { calculationVersion: 'synthetic-v1' });
  return { api, adapter, repo, raw };
}
const run = (repo, name, payload) => repo.execute(name, payload, repo.revision);
async function refusedUnchanged(repo, adapter, name, payload, pattern) {
  const before = JSON.stringify(repo.snapshot()), disk = JSON.stringify(await adapter.read());
  await assert.rejects(run(repo, name, payload), pattern);
  assert.equal(JSON.stringify(repo.snapshot()), before, name + ' changed memory');
  assert.equal(JSON.stringify(await adapter.read()), disk, name + ' changed storage');
}
test('memory adapter: activation preserves bytes, types, missing fields, hashes and restart evidence', async () => {
  const { api, adapter, repo, raw } = await setup();
  const snap = repo.snapshot();
  assert.equal(snap.archive.rawSnapshot, raw);
  assert.deepEqual(copy(snap.archive.originals.sessions), fixture().sessions);
  assert.equal(snap.archive.rawHash, createHash('sha256').update(raw).digest('hex'));
  assert.equal(Object.hasOwn(snap.working.sessions[0], 'clientIds'), false);
  assert.deepEqual(copy(repo.read().sessions[0].clientIds), [7]);
  assert.equal(repo.read().clients[0].rate, '55');
  assert.ok(Object.isFrozen(repo.read().sessions[0].unknown));
  assert.throws(() => { repo.read().sessions[0].unknown.retained = false; }, TypeError);
  const restart = api.create(adapter); assert.equal(await restart.open(), true);
  assert.equal(await restart.exportEvidence(), await repo.exportEvidence());
  await assert.rejects(repo.activateSynthetic(raw), /already initialized/);
});
test('memory adapter: only explicit synthetic input and unambiguous IDs activate', async () => {
  for (const alter of [f => { delete f.syntheticOnly; }, f => { f.sessions.push({ id: 'old' }); },
    f => { f.clients.push({ id: '7' }); }, f => { f.sessions[0].id = null; },
    f => { f.sessions[0].id = ''; }, f => { f.sessions[0].id = {}; }]) {
    const api = load(), adapter = memoryAdapter(), repo = api.create(adapter), f = fixture(); alter(f);
    await assert.rejects(repo.activateSynthetic(JSON.stringify(f)));
    assert.equal(repo.ready, false); assert.equal(await adapter.read(), null);
  }
});
test('memory adapter: historical writes refuse atomically across every guarded command', async () => {
  const { repo, adapter } = await setup();
  for (const id of ['old', 'old-scheduled', 'old-cancelled']) {
    assert.equal(repo.isProtectedSession(id), true);
    for (const [name, payload] of [ ['session.save', { record: { id, amount: 0 } }],
      ['session.update', { ids: [id], patch: { status: 'scheduled' } }],
      ['session.delete', { ids: [id] }] ])
      await refusedUnchanged(repo, adapter, name, payload, /read-only|Read-only/i);
  }
  // Owner ruling 2026-09-15 (commit d9c56d0): activation archives every pre-existing session, so an
  // archived COMPLETED row must still be markable as paid. The payment is an append-only event; the
  // archived original is never edited. Rows that are not completed still refuse.
  for (const id of ['old-scheduled', 'old-cancelled'])
    await refusedUnchanged(repo, adapter, 'session.payment', { ids: [id], date: '2026-09-06' }, /Complete the session/);
  const archive = JSON.stringify(repo.snapshot().archive), stored = JSON.stringify(repo.snapshot().working.sessions);
  await run(repo, 'session.payment', { ids: ['old'], date: '2026-09-06' });
  assert.equal(JSON.stringify(repo.snapshot().archive), archive, 'payment changed the archive');
  assert.equal(JSON.stringify(repo.snapshot().working.sessions), stored, 'payment edited a stored record');
  assert.deepEqual(copy(repo.snapshot().events).map(e => [e.type, e.sessionId, e.date]), [['payment', 'old', '2026-09-06']]);
  const paid = repo.read().sessions.find(s => s.id === 'old');
  assert.equal(paid.paid, true); assert.equal(paid.paymentDate, '2026-09-06');
  await refusedUnchanged(repo, adapter, 'session.payment', { ids: ['old'], date: '2026-09-07' }, /already recorded/);
  for (const [name,payload] of [ ['expense.save',{record:{id:'expense-old',amount:0},receipt:null}],
    ['expense.delete',{id:'expense-old'}], ['tax.save',{record:{id:'tax-old',amount:0}}],
    ['tax.delete',{id:'tax-old'}] ]) await refusedUnchanged(repo,adapter,name,payload,/read-only/i);
});
test('memory adapter: scheduling, finalization and payment preserve immutable snapshots', async () => {
  const { repo, adapter } = await setup(); const archive = JSON.stringify(repo.snapshot().archive);
  await run(repo,'session.save',{record:session()});
  assert.equal(repo.read().sessions.at(-1).companySplit,0); assert.equal(repo.read().sessions.at(-1).companyAmount,0);
  await run(repo,'session.save',{record:{id:'draft',time:'10:00'}});
  assert.deepEqual(copy(repo.read().sessions.at(-1).unknown),{keep:true});
  await run(repo,'session.update',{ids:['draft'],patch:{status:'completed',mileage:4}});
  const finalized = JSON.stringify(repo.snapshot().finalized.draft);
  const storedSession = JSON.stringify(repo.snapshot().working.sessions.at(-1));
  await run(repo,'session.payment',{ids:['draft'],date:'2026-09-06'});
  assert.equal(repo.read().sessions.at(-1).paid,true);assert.equal(repo.snapshot().events.length,1);
  assert.equal(JSON.stringify(repo.snapshot().working.sessions.at(-1)),storedSession);
  await run(repo,'client.save',{record:{id:7,hourlyRate:100,name:'Fabricated New Name'}});
  await run(repo,'settings.update',{patch:{defaultDuration:2,autoSync:'on'}});
  assert.equal(repo.read().settings.autoSync,'off');
  assert.equal(JSON.stringify(repo.snapshot().finalized.draft),finalized);
  assert.equal(JSON.stringify(repo.snapshot().archive),archive);
  for(const [name,payload] of [['session.save',{record:{id:'draft',amount:0}}],
    ['session.update',{ids:['draft'],patch:{mileage:0}}],['session.delete',{ids:['draft']}],
    ['session.payment',{ids:['draft'],date:'2026-09-07'}]]) await refusedUnchanged(repo,adapter,name,payload);
});
test('memory adapter: client retirement, company metadata, expense receipts and tax CRUD',async()=>{
  const {repo,adapter}=await setup(); const archive=JSON.stringify(repo.snapshot().archive);
  await run(repo,'client.save',{record:{id:7,name:'Fabricated Changed',companySplit:0,splitHistory:[]}});
  assert.equal(repo.read().clients[0].companySplit,'20');assert.equal(repo.read().clients[0].splitHistory.length,1);
  await run(repo,'client.retire',{id:'7'});assert.equal(repo.read().clients[0].status,'inactive');
  await run(repo,'client.save',{record:{id:'new-client',name:'Fabricated Second'}});
  await run(repo,'expense.save',{record:{id:'new-expense',amount:2,extra:true},receipt:{data:'fabricated'}});
  await run(repo,'expense.save',{record:{id:'new-expense',amount:3},receipt:null});
  assert.equal(repo.read().expenses.at(-1).extra,true);assert.equal(Object.hasOwn(repo.read().receipts,'new-expense'),false);
  await run(repo,'expense.save',{record:{id:'new-expense'},receipt:{data:'replacement'}});
  await run(repo,'expense.delete',{id:'new-expense'});assert.equal(Object.hasOwn(repo.read().receipts,'new-expense'),false);
  await run(repo,'tax.save',{record:{id:'new-tax',amount:2,unknown:1}});
  await run(repo,'tax.save',{record:{id:'new-tax',amount:3}});assert.equal(repo.read().taxPayments.at(-1).unknown,1);
  await run(repo,'tax.delete',{id:'new-tax'});assert.equal(repo.read().taxPayments.length,1);
  await refusedUnchanged(repo,adapter,'client.retire',{id:'missing'});
  assert.equal(JSON.stringify(repo.snapshot().archive),archive);
});
test('memory adapter: mixed bulk and invalid proposals cannot partially commit',async()=>{
  const {repo,adapter}=await setup();await run(repo,'session.save',{record:session()});
  for(const [name,payload] of [['session.update',{ids:['draft','old'],patch:{amount:1}}],
    ['session.delete',{ids:['draft','old']}],['session.payment',{ids:['draft','old'],date:'2026-09-06'}],
    ['session.update',{ids:['draft'],patch:{id:'replacement'}}],['session.update',{ids:[],patch:{amount:1}}],
    ['session.delete',{ids:['draft','missing']}],['session.save',{record:session(null)}],
    ['session.save',{record:{...session('bad'),duration:0}}],['session.save',{record:{...session('bad'),status:'unknown'}}],
    ['session.save',{record:{...session('bad'),clientIds:[]}}], ['maintenance.set',{enabled:'true'}],
    ['restore',{data:fixture()}],['totally.unknown',{}]]) await refusedUnchanged(repo,adapter,name,payload);
  await run(repo,'session.update',{ids:['draft','draft'],patch:{amount:60}});
  assert.equal(repo.read().sessions.at(-1).amount,60);
  await run(repo,'session.delete',{ids:['draft']});assert.equal(repo.read().sessions.length,3);
});
test('memory adapter fault injection: quota and interrupted commit leave memory/storage/revision unchanged',async()=>{
  const {repo,adapter}=await setup();
  for(const failure of ['QuotaExceededError (injected memory failure)','Interrupted transaction (injected memory failure)']) {
    adapter.failNext(failure);await refusedUnchanged(repo,adapter,'expense.save',{record:{id:'pending',amount:3},receipt:{data:'fabricated'}});
  }
  await run(repo,'expense.save',{record:{id:'pending',amount:3}});assert.equal(repo.revision,1);
});
test('memory adapter CAS: two stale repositories and late maintenance proposals fail safely',async()=>{
  const {repo,adapter,api}=await setup();const other=api.create(adapter);await other.open();
  const revision=other.revision;await run(repo,'maintenance.set',{enabled:true});
  const stale=JSON.stringify(other.snapshot());
  await assert.rejects(other.execute('session.save',{record:session()},revision),/CAS conflict/);
  assert.equal(JSON.stringify(other.snapshot()),stale);
  await other.open();await refusedUnchanged(other,adapter,'session.save',{record:session()},/Maintenance/);
  await run(other,'maintenance.set',{enabled:false});await other.execute('session.save',{record:session()},other.revision);
  assert.equal(other.read().sessions.length,4);
});
test('memory adapter queued proposals: snapshot input before await and reject stale callbacks',async()=>{
  const {repo,adapter}=await setup();const release=adapter.holdNext();
  const record=session(), revision=repo.revision;const pending=repo.execute('session.save',{record},revision);
  record.amount=999;record.unknown.keep=false;
  const late=repo.execute('settings.update',{patch:{defaultDuration:9}},revision);
  release();await pending;await assert.rejects(late,/Stale/);
  assert.equal(repo.read().sessions.at(-1).amount,55);assert.equal(repo.read().sessions.at(-1).unknown.keep,true);
  const captured=repo.revision;await run(repo,'maintenance.set',{enabled:true});
  await assert.rejects(repo.execute('session.update',{ids:['draft'],patch:{amount:5}},captured),/Stale/);
});
test('memory adapter: restart rejects tampered archive and integrity evidence',async()=>{
  for(const corrupt of [e=>{e.archive.rawSnapshot+=' ';},e=>{e.working.settings.defaultDuration=88;},
    e=>{e.archive.originals.sessions[0].amount=0;},e=>{delete e.archive.manifest.sessions.old;}]) {
    const {adapter,api}=await setup();adapter.corrupt(corrupt);const repo=api.create(adapter);
    await assert.rejects(repo.open());assert.equal(repo.ready,false);
  }
});
test('disposable source mutation: transition guard rejects internally injected archive-deleting restore',async()=>{
  const injection = `case 'test.restore': {
    draft.archive.originals.sessions = [];
    draft.archive.manifest.sessions = {};
    const raw = JSON.parse(draft.archive.rawSnapshot); raw.sessions = [];
    draft.archive.rawSnapshot = JSON.stringify(raw);
    draft.archive.rawHash = await hash(draft.archive.rawSnapshot);
    w.sessions = []; break;
  }
  default: throw Error('Unavailable command: '+name);`;
  const target="default: throw Error('Unavailable command: '+name);";
  assert.equal(repositorySource.split(target).length,2,'mutation anchor changed');
  const {repo,adapter}=await setup(repositorySource.replace(target,injection));
  await refusedUnchanged(repo,adapter,'test.restore',{},/Archive replacement forbidden/);
});

test('reserved string IDs remain own properties and cannot bypass finalization',async()=>{
  const {repo,adapter}=await setup();
  await run(repo,'session.save',{record:{...session('__proto__'),status:'completed'}});
  assert.equal(repo.isProtectedSession('__proto__'),true);
  assert(Object.hasOwn(repo.snapshot().finalized,'__proto__'));
  await refusedUnchanged(repo,adapter,'session.update',{ids:['__proto__'],patch:{amount:999}});
  await run(repo,'expense.save',{record:{id:'__proto__',amount:1},receipt:'synthetic'});
  assert.equal(repo.snapshot().working.receipts.__proto__,'synthetic');
});

test('subscriber failures cannot turn a committed save into a reported failure',async()=>{
  const {repo}=await setup();
  repo.subscribe(()=>{throw Error('Synthetic renderer failure');});
  assert.equal(await run(repo,'client.retire',{id:7}),true);
  assert.equal(repo.read().clients[0].status,'inactive');
});

test('clock changes cannot unlock activation records or recapture the archive',async()=>{
  class Clock extends Date {
    static instant=Date.parse('2026-09-06T12:00:00Z');
    constructor(...args){super(...(args.length?args:[Clock.instant]));}
    static now(){return Clock.instant;}
  }
  const api=load(repositorySource,Clock), adapter=memoryAdapter(), repo=api.create(adapter);
  await repo.activateSynthetic(JSON.stringify(fixture()),{});
  const before=JSON.stringify(repo.snapshot().archive);
  for(const date of ['1990-01-01','2040-01-01']){
    Clock.instant=Date.parse(date);
    assert(repo.isProtectedSession('old-scheduled'));
    await refusedUnchanged(repo,adapter,'session.update',{ids:['old-scheduled'],patch:{status:'completed'}});
    await repo.open();assert.equal(JSON.stringify(repo.snapshot().archive),before);
  }
});

test('runtime frozen read views reject direct and derived-alias writes',async()=>{
  const {repo}=await setup();
  const view=repo.read(), before=JSON.stringify(repo.snapshot());
  assert.throws(()=>{view.sessions[0].amount=999;},TypeError);
  const alias=view.clients.find(c=>c.id===7).splitHistory[0];
  assert.throws(()=>{alias.percent=0;},TypeError);
  assert.throws(()=>{repo.snapshot().archive.originals.sessions=[];},TypeError);
  assert.equal(JSON.stringify(repo.snapshot()),before);
});
test('finalize snapshot never carries secrets: ORS key and gist fields are dropped, report settings kept', async () => {
  const { repo } = await setup();
  await run(repo,'settings.update',{patch:{orsApiKey:'synthetic-key-only',gistId:'synthetic-gist',gistToken:'synthetic-token',businessAddress:'1 Fixture Way',mileageRate:0.7}});
  await run(repo,'session.save',{record:session('secret-check')});
  await run(repo,'session.update',{ids:['secret-check'],patch:{status:'completed'}});
  const snap = copy(repo.snapshot().finalized['secret-check'].settings);
  assert.equal(snap.orsApiKey,undefined); assert.equal(snap.gistId,undefined); assert.equal(snap.gistToken,undefined);
  assert.equal(snap.businessAddress,'1 Fixture Way'); assert.equal(snap.mileageRate,0.7);
  assert.equal(JSON.stringify(repo.snapshot().finalized['secret-check']).includes('synthetic-key-only'),false);
  // The working settings still hold the key on-device; only the immutable evidence is clean.
  assert.equal(repo.snapshot().working.settings.orsApiKey,'synthetic-key-only');
});
