'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'../../protected');
const fixture=fs.readFileSync(path.join(root,'fixtures/synthetic.json'),'utf8');
const copy=x=>JSON.parse(JSON.stringify(x));
function setup(old=false,shared={disk:null}) {
  const App={DEFAULT_SETTINGS:{}};
  const ctx=vm.createContext({window:{App},crypto:webcrypto,TextEncoder,console,location:{hostname:'localhost'}});
  vm.runInContext(fs.readFileSync(path.join(root,'js/record-policy.js'),'utf8'),ctx);
  vm.runInContext(fs.readFileSync(old?path.join(__dirname,'before/js/repository.js'):path.join(root,'js/repository.js'),'utf8'),ctx);
  const adapter={read:async()=>copy(shared.disk),compareAndSwap:async(expected,next)=>{
    if(shared.fail)throw Error('Quota or interrupted transaction');
    if(JSON.stringify(shared.disk)!==JSON.stringify(expected))throw Error('CAS conflict');
    shared.disk=copy(next);return true;
  }};
  return {App,repo:App.Repository.create(adapter),shared};
}
async function active(){const env=setup();await env.repo.activateSynthetic(fixture,{report:'Exact original source'});return env;}
const command=(r,name,payload)=>r.execute(name,payload,r.revision);
const add=(r,id)=>command(r,'session.save',{record:{id,status:'completed',date:'2026-09-06',duration:1,amount:75,clientIds:[101]}});
async function hash(value,canonical){return Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:canonical(value)))).toString('hex');}
async function repack(env,wrapper){const body=copy(wrapper.snapshot);delete body.integrity;wrapper.snapshot.integrity=await hash(body,env.App.Repository.canonical);wrapper.digest=await hash(wrapper.snapshot,env.App.Repository.canonical);return JSON.stringify(wrapper);}

test('rehashed historical-ID shadow refuses fresh restore, merge, reconcile and reopen',async()=>{
 const a=await active(),good=await a.repo.exportPortable(),wrapper=JSON.parse(good);
 wrapper.snapshot.working.sessions.push({id:'hist-1',status:'scheduled',date:'2026-09-06',duration:1,amount:75,clientIds:[101],companyAmount:0,companySplit:0});
 const bad=await repack(a,wrapper),before=JSON.stringify(a.shared.disk),empty=setup();
 await assert.rejects(empty.repo.stagePortable(bad),/Historical session identity is reserved/);
 assert.equal(empty.shared.disk,null);
 await assert.rejects(a.repo.stagePortable(bad),/Historical session identity is reserved/);
 await assert.rejects(a.repo.reconcilePortable(good,bad),/Historical session identity is reserved/);
 assert.equal(JSON.stringify(a.shared.disk),before);
 const stored={disk:copy(wrapper.snapshot)};
 await assert.rejects(setup(false,stored).repo.open(),/Historical session identity is reserved/);
 assert.deepEqual(stored.disk,wrapper.snapshot);
});

test('schema2 portable fresh restore preserves exact complete evidence and one-use stages',async()=>{
 const a=await active();await add(a.repo,'new');await command(a.repo,'session.payment',{ids:['new'],date:'2026-09-06'});
 const portable=await a.repo.exportPortable(),b=setup(),stage=await b.repo.stagePortable(portable);
 assert.equal(stage.summary.current.sessions,0);assert.equal(stage.summary.added.sessions,a.repo.snapshot().working.sessions.length);
 assert.equal(await b.repo.commitPortable(stage.id),true);assert.equal(await b.repo.exportPortable(),portable);
 await assert.rejects(b.repo.commitPortable(stage.id),/used|expired/);
 assert.equal(b.repo.snapshot().schema,2);assert.deepEqual(copy(b.repo.snapshot()),copy(a.repo.snapshot()));
});
test('verified schema1 upgrades atomically; old reader and stale writer refuse schema2',async()=>{
 const a=setup(true);await a.repo.activateSynthetic(fixture);const before=copy(a.shared.disk),n=setup(false,a.shared);
 await n.repo.open();assert.equal(n.repo.snapshot().schema,2);assert.equal(n.repo.revision,before.revision+1);
 for(const k of ['archive','working','finalized','events','maintenance'])assert.deepEqual(copy(n.repo.snapshot()[k]),before[k]);
 await assert.rejects(setup(true,a.shared).repo.open(),/Invalid protected store/);
 await assert.rejects(command(a.repo,'client.save',{record:{id:'old',name:'Old'}}),/CAS/);
 const bad=setup(true);await bad.repo.activateSynthetic(fixture);bad.shared.disk.archive.rawHash='bad';
 const saved=JSON.stringify(bad.shared.disk);await assert.rejects(setup(false,bad.shared).repo.open(),/hash|integrity/);assert.equal(JSON.stringify(bad.shared.disk),saved);
 const quota=setup(true);await quota.repo.activateSynthetic(fixture);quota.shared.fail=true;
 await assert.rejects(setup(false,quota.shared).repo.open(),/Quota/);assert.equal(quota.shared.disk.schema,1);
});
test('compatible union retains both branches and missing incoming records never delete local data',async()=>{
 const a=await active(),b=setup();let stage=await b.repo.stagePortable(await a.repo.exportPortable());await b.repo.commitPortable(stage.id);
 await add(a.repo,'left');await add(b.repo,'right');await command(b.repo,'session.payment',{ids:['right'],date:'2026-09-06'});
 const pure=await a.repo.reconcilePortable(await a.repo.exportPortable(),await b.repo.exportPortable());
 assert.equal(a.repo.snapshot().working.sessions.some(x=>x.id==='right'),false);
 stage=await a.repo.stagePortable(pure);assert.equal(stage.summary.added.sessions,1);await a.repo.commitPortable(stage.id);
 assert(a.repo.snapshot().working.sessions.some(x=>x.id==='left'));assert(a.repo.snapshot().working.sessions.some(x=>x.id==='right'));
 assert.equal(a.repo.snapshot().events.length,1);
});
test('same-ID, settings, archive, receipts and finalization conflicts refuse without mutation',async()=>{
 const a=await active(),base=await a.repo.exportPortable();
 for(const mutation of [w=>w.working.clients[0].rate=987,w=>w.working.settings.extra='different',w=>w.archive.id='another']){
  const wrapper=JSON.parse(base);mutation(wrapper.snapshot);const text=await repack(a,wrapper),before=JSON.stringify(a.shared.disk);
  await assert.rejects(a.repo.stagePortable(text),/Conflict|conflict/);assert.equal(JSON.stringify(a.shared.disk),before);
 }
 await add(a.repo,'final');const good=await a.repo.exportPortable(),wrapper=JSON.parse(good);wrapper.snapshot.finalized.final.settings.changed='different';
 await assert.rejects(a.repo.stagePortable(await repack(a,wrapper)),/finalizations/);
});
test('stale stages, other tabs, quota, interruption, maintenance and bounded tokens refuse safely',async()=>{
 const a=await active(),text=await a.repo.exportPortable();let s=await a.repo.stagePortable(text);
 await command(a.repo,'client.save',{record:{id:'new',name:'New'}});await assert.rejects(a.repo.commitPortable(s.id),/Stale/);
 s=await a.repo.stagePortable(await a.repo.exportPortable());const second=setup(false,a.shared);await second.repo.open();
 await command(second.repo,'client.save',{record:{id:'tab',name:'Tab'}});await assert.rejects(a.repo.assertPortableStage(s.id),/Another tab/);await assert.rejects(a.repo.commitPortable(s.id),/Another tab/);await assert.rejects(a.repo.exportPortable(),/Another tab/);
 await a.repo.open();s=await a.repo.stagePortable(await a.repo.exportPortable());const before=JSON.stringify(a.shared.disk);a.shared.fail=true;
 await assert.rejects(a.repo.commitPortable(s.id),/Quota/);assert.equal(JSON.stringify(a.shared.disk),before);await assert.rejects(a.repo.commitPortable(s.id),/used|expired/);a.shared.fail=false;
 await command(a.repo,'maintenance.set',{enabled:true});const maintenance=await a.repo.exportPortable();await assert.rejects(a.repo.stagePortable(maintenance),/Maintenance/);
 const fresh=setup();s=await fresh.repo.stagePortable(maintenance);await fresh.repo.commitPortable(s.id);assert.equal(fresh.repo.maintenance,true);
 await command(a.repo,'maintenance.set',{enabled:false});const now=await a.repo.exportPortable(),first=await a.repo.stagePortable(now);
 for(let i=0;i<20;i++)await a.repo.stagePortable(now);await assert.rejects(a.repo.commitPortable(first.id),/expired/);
});
test('tampering, old formats, envelope protection failures and credential fields including raw JSON refuse',async()=>{
 const a=await active(),text=await a.repo.exportPortable();
 await assert.rejects(a.repo.inspectPortable(await a.repo.exportEvidence()),/schema-2/);
 await assert.rejects(a.repo.inspectPortable(fixture),/schema-2/);
 let w=JSON.parse(text);w.snapshot.revision++;await assert.rejects(a.repo.inspectPortable(JSON.stringify(w)),/integrity/);
 w=JSON.parse(text);w.digest='bad';await assert.rejects(a.repo.inspectPortable(JSON.stringify(w)),/digest/);
 for(const mutation of [x=>x.finalized=[],x=>x.events=[{id:'bogus',sessionId:'missing',type:'payment'}],x=>x.working.sessions[0].amount=900,x=>x.working.clients=[],x=>x.working.historical=[],x=>x.archive.manifest={}]){
  w=JSON.parse(text);mutation(w.snapshot);await assert.rejects(a.repo.inspectPortable(await repack(a,w)));
 }
 for(const field of ['gistToken','gistId','access_token','apiKey','password','credentials','connection']){
  w=JSON.parse(text);w.snapshot.working.settings[field]='synthetic-secret';await assert.rejects(a.repo.inspectPortable(await repack(a,w)),/credential|connection/);
 }
 await add(a.repo,'evidence');w=JSON.parse(await a.repo.exportPortable());w.snapshot.finalized.evidence.settings.payload=JSON.stringify({gistToken:'synthetic-secret'});
 await assert.rejects(a.repo.inspectPortable(await repack(a,w)),/credential|connection/);
 const raw=JSON.parse(fixture);raw.settings.gistToken='synthetic-secret';const b=setup();await b.repo.activateSynthetic(JSON.stringify(raw));
 await assert.rejects(b.repo.exportPortable(),/credential|connection/);assert.equal(JSON.parse(b.repo.snapshot().archive.rawSnapshot).settings.gistToken,'synthetic-secret');
});
test('auxiliary adapters are isolated, restricted and compare complete values',async()=>{
 const a=await active(),before=await a.repo.exportPortable(),slot=a.repo.slotAdapter('slice4-connection');
 assert.equal(await slot.read(),null);await slot.compareAndSwap(null,{gistId:'fixture',token:'local-only'});
 const value=await slot.read();value.token='changed';assert.equal((await slot.read()).token,'local-only');
 await assert.rejects(slot.compareAndSwap(null,{}),/changed/);assert.throws(()=>a.repo.slotAdapter('active'),/Unavailable/);
 assert.equal(await a.repo.exportPortable(),before);assert.equal(await a.repo.slotAdapter('slice4-remote').read(),null);
});

 test('rehashed new session violations and app-specific credentials cannot enter protected imports',async()=>{
  const a=await active();await command(a.repo,'session.save',{record:{id:'scheduled',status:'scheduled',date:'2026-09-06',duration:1,amount:75,clientIds:[101]}});
  await add(a.repo,'final');const portable=await a.repo.exportPortable();
  for(const patch of [{companyAmount:1},{companySplit:1},{status:'made-up'},{duration:-1},{clientIds:[]}]){
    const w=JSON.parse(portable);Object.assign(w.snapshot.working.sessions.find(x=>x.id==='scheduled'),patch);
    await assert.rejects(a.repo.inspectPortable(await repack(a,w)),/Invalid new session/);
  }
  let w=JSON.parse(portable);w.snapshot.finalized.final.record.status='scheduled';w.snapshot.working.sessions.find(x=>x.id==='final').status='scheduled';
  await assert.rejects(a.repo.inspectPortable(await repack(a,w)),/finalized session status/);
  for(const mutate of [x=>x.working.settings.orsApiKey='synthetic-only',x=>x.finalized.final.settings.orsApiKey='synthetic-only',x=>{const raw=JSON.parse(x.archive.rawSnapshot);raw.settings.orsApiKey='synthetic-only';x.archive.rawSnapshot=JSON.stringify(raw);}]){
    w=JSON.parse(portable);mutate(w.snapshot);await assert.rejects(a.repo.inspectPortable(await repack(a,w)),/credential|connection/);
  }
 });

test('receipt disagreements and explicit false CAS results refuse atomically',async()=>{
 const a=await active();await command(a.repo,'expense.save',{record:{id:'receipt-new',amount:10},receipt:{data:'first'}});
 const text=await a.repo.exportPortable(),w=JSON.parse(text);w.snapshot.working.receipts['receipt-new']={data:'second'};
 await assert.rejects(a.repo.stagePortable(await repack(a,w)),/Conflict in receipts/);assert.equal(await a.repo.exportPortable(),text);
 const fresh=a.App.Repository.create({read:async()=>null,compareAndSwap:async()=>false});const stage=await fresh.stagePortable(text);
 await assert.rejects(fresh.commitPortable(stage.id),/CAS conflict/);assert.equal(fresh.ready,false);
});

test('mirror CAS guard refuses record or maintenance changes after sync preflight',async()=>{
 const a=await active(),slot=a.repo.slotAdapter('slice4-remote');
 let stage=await a.repo.stagePortable(await a.repo.exportPortable()),guard=await a.repo.portableStageGuard(stage.id);
 await slot.compareAndSwap(null,{version:1},guard);
 stage=await a.repo.stagePortable(await a.repo.exportPortable());guard=await a.repo.portableStageGuard(stage.id);
 await command(a.repo,'client.save',{record:{id:'race',name:'Changed after preflight'}});
 await assert.rejects(slot.compareAndSwap({version:1},{version:2},guard),/Stale sync stage/);assert.equal((await slot.read()).version,1);
 stage=await a.repo.stagePortable(await a.repo.exportPortable());guard=await a.repo.portableStageGuard(stage.id);
 await command(a.repo,'maintenance.set',{enabled:true});
 await assert.rejects(slot.compareAndSwap({version:1},{version:2},guard),/maintenance/);assert.equal((await slot.read()).version,1);
 await assert.rejects(slot.compareAndSwap({version:1},{version:2},null),/Stale sync stage/);
});
