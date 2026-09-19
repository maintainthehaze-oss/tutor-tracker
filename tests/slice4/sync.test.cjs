'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'../../protected');
const clone=x=>x==null?null:JSON.parse(JSON.stringify(x));
function memory(initial=null){
  let value=clone(initial), fail=false;
  return {read:async()=>clone(value), failNext(){fail=true;}, async compareAndSwap(expected,next){
    if(fail){fail=false;throw Error('Injected storage failure');}
    assert.deepEqual(value,clone(expected),'CAS conflict');value=clone(next);return true;
  }};
}
async function setup(){
  const ctx=vm.createContext({window:{},document:require('../helpers/harness.cjs').documentStub(),crypto:webcrypto,TextEncoder,console,location:{hostname:'localhost'},indexedDB:{},setTimeout});
  for(const file of ['app-core','record-policy','repository','sync'])vm.runInContext(fs.readFileSync(path.join(root,'js',file+'.js'),'utf8'),ctx);
  const App=ctx.window.App,local=memory(),connection=memory();
  const repository=App.Repository.create(local);
  const remote=repository.slotAdapter('slice4-remote');
  await repository.activateSynthetic(fs.readFileSync(path.join(root,'fixtures/synthetic.json'),'utf8'),{definition:'fabricated baseline evidence'});
  const transport=App.Sync.localTransport(remote);
  const sync=App.Sync.create({repository,connection,transport});
  return {App,repository,connection,remote,local,transport,sync};
}
async function push(sync){const stage=await sync.stagePush();await sync.commit(stage.id);return stage;}
async function add(repository,id){await repository.execute('session.save',{record:{id,clientIds:[101],date:'2026-10-01',duration:1,amount:100,mileage:0,status:'scheduled',paid:false}},repository.revision);}

test('first push, second push and pull retain one mirror identity; manual only; legacy credentials never accessed',async()=>{
  const a=await setup();let reads=0;
  const originalState=a.App.state;
  Object.defineProperty(a.App,'state',{configurable:true,get(){reads++;throw Error('Must not read legacy credentials');}});
  const first=await push(a.sync),status=await a.sync.status();
  assert.match(first.summary.message,/Nothing is sent online/);assert.equal(status.autoSync,false);
  await push(a.sync);
  assert.equal(reads,0);
  Object.defineProperty(a.App,'state',{configurable:true,writable:true,value:originalState});
  await a.sync.commit((await a.sync.stagePull()).id);
  assert.equal((await a.sync.status()).gistId,status.gistId);
  assert.equal(Object.keys((await a.remote.read()).documents).length,1);
  assert.equal(reads,0);assert.equal(a.App.hasSyncConfig(),false);assert.equal(await a.App.saveToGist(),false);
  const portable=await a.repository.exportPortable();assert(!portable.includes(status.gistId));assert(!portable.includes('local-sync-rehearsal'));
});

for(const failure of ['create-response','readback','connection-finalize'])test('uncertain '+failure+' reopens and retries without duplicate creation',async()=>{
  const a=await setup();let fail=true,keys=[];
  const transport={...a.transport,
    async create(text,key){keys.push(key);const result=await a.transport.create(text,key);
      if(fail&&failure==='create-response'){fail=false;throw Error('Interrupted create response');}
      if(fail&&failure==='connection-finalize'){fail=false;a.connection.failNext();}
      return result;
    },
    async read(id){if(fail&&failure==='readback'){fail=false;throw Error('Interrupted readback');}return a.transport.read(id);}
  };
  const sync=a.App.Sync.create({repository:a.repository,connection:a.connection,transport});
  await assert.rejects(push(sync),/Interrupted|Injected/);
  assert.equal((await sync.status()).pendingCreate,true);
  const saved=await a.connection.read();assert(saved.pending.key);assert(saved.pending.portable);
  const reopened=a.App.Sync.create({repository:a.repository,connection:a.connection,transport});
  await push(reopened);assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
  assert.equal(Object.keys((await a.remote.read()).documents).length,1);
  assert.equal((await reopened.status()).pendingCreate,false);
});

test('connection quota failure before first create leaves remote empty',async()=>{
  const a=await setup(),stage=await a.sync.stagePush();a.connection.failNext();
  await assert.rejects(a.sync.commit(stage.id),/Injected/);assert.equal(await a.remote.read(),null);
});

test('stale stages refuse without a remote write',async()=>{
  const a=await setup(),stage=await a.sync.stagePush();await add(a.repository,'after-stage');
  await assert.rejects(a.sync.commit(stage.id),/changed|stale/i);assert.equal(await a.remote.read(),null);
  await assert.rejects(a.sync.commit(stage.id),/expired|already/);
  const before=await a.sync.stagePush();
  const tab=a.App.Repository.create(a.local);await tab.open();await add(tab,'another-tab');
  await assert.rejects(a.sync.commit(before.id),/changed|stale|reload/i);assert.equal(await a.remote.read(),null);
});

test('maintenance refuses sync writes; pull connection failure cannot change local records',async()=>{
  const a=await setup();await push(a.sync);
  const stage=await a.sync.stagePull(),before=await a.repository.exportPortable();a.connection.failNext();
  await assert.rejects(a.sync.commit(stage.id),/Injected/);assert.equal(await a.repository.exportPortable(),before);
  await a.repository.execute('maintenance.set',{enabled:true},a.repository.revision);
  const mirror=await a.remote.read();await assert.rejects(a.sync.stagePush(),/Maintenance/);await assert.rejects(a.sync.stagePull(),/Maintenance/);
  assert.deepEqual(await a.remote.read(),mirror);
});

test('two devices reconcile additions; remote version conflicts never overwrite unseen data',async()=>{
  const a=await setup();
  // A shared simulated external service has no access to either device's local DB.
  a.remote=memory();a.transport=a.App.Sync.localTransport(a.remote);
  a.sync=a.App.Sync.create({repository:a.repository,connection:a.connection,transport:a.transport});
  await push(a.sync);
  const bRepo=a.App.Repository.create(memory());await bRepo.commitPortable((await bRepo.stagePortable(await a.repository.exportPortable())).id);
  const b=a.App.Sync.create({repository:bRepo,transport:a.transport,connection:memory(await a.connection.read())});
  await add(a.repository,'device-a');await add(bRepo,'device-b');
  const stale=await b.stagePush();await push(a.sync);
  const before=await a.remote.read();await assert.rejects(b.commit(stale.id),/version conflict/);assert.deepEqual(await a.remote.read(),before);
  await push(b);await a.sync.commit((await a.sync.stagePull()).id);
  const rows=a.repository.snapshot().working.sessions;
  assert(rows.some(r=>r.id==='device-a'));assert(rows.some(r=>r.id==='device-b'));
  assert.equal(Object.keys((await a.remote.read()).documents).length,1);
});

test('pull refuses remote change after stage and local commit interruption leaves local records unchanged',async()=>{
  const a=await setup();await push(a.sync);
  const stage=await a.sync.stagePull(),status=await a.sync.status();
  const old=await a.transport.read(status.gistId);await a.transport.compareAndSwap(old.gistId,old.version,old.portable);
  const before=await a.repository.exportPortable();await assert.rejects(a.sync.commit(stage.id),/Mirror changed/);
  assert.equal(await a.repository.exportPortable(),before);
  const next=await a.sync.stagePull();a.local.failNext();await assert.rejects(a.sync.commit(next.id),/Injected/);
  assert.equal(await a.repository.exportPortable(),before);
});

test('conditional update interruption is safely restaged; same-ID disagreements refuse atomically',async()=>{
  const a=await setup();await push(a.sync);await add(a.repository,'new-record');let fail=true;
  const transport={...a.transport,async compareAndSwap(...args){const result=await a.transport.compareAndSwap(...args);if(fail){fail=false;throw Error('Lost update response');}return result;}};
  const sync=a.App.Sync.create({repository:a.repository,transport,connection:a.connection});
  await assert.rejects(push(sync),/Lost/);await push(sync);
  const bRepo=a.App.Repository.create(memory());await bRepo.commitPortable((await bRepo.stagePortable(await a.repository.exportPortable())).id);
  await bRepo.execute('settings.update',{patch:{businessName:'Conflicting device'}},bRepo.revision);
  const b=a.App.Sync.create({repository:bRepo,transport:a.transport,connection:memory(await a.connection.read())});
  const before=await a.remote.read();await assert.rejects(b.stagePush(),/settings|conflict|disagree/i);assert.deepEqual(await a.remote.read(),before);
});

test('concurrent first pushes cannot mint two mirrors; transport creation key is idempotent',async()=>{
  const a=await setup(),second=a.App.Sync.create({repository:a.repository,connection:a.connection,transport:a.transport});
  const first=await a.sync.stagePush(),other=await second.stagePush();
  const outcomes=await Promise.allSettled([a.sync.commit(first.id),second.commit(other.id)]);
  assert(outcomes.some(x=>x.status==='fulfilled'));assert.equal(Object.keys((await a.remote.read()).documents).length,1);
  const isolated=a.App.Sync.localTransport(memory()),text=await a.repository.exportPortable();
  const results=await Promise.all([isolated.create(text,'stable-request'),isolated.create(text,'stable-request')]);
  assert.equal(results[0].gistId,results[1].gistId);
  await assert.rejects(isolated.create(text+' ','stable-request'),/payload changed/);
});

test('corrupt readback refuses success and retains saved creation for safe recovery',async()=>{
  const a=await setup();let corrupt=true;
  const transport={...a.transport,async read(id){const value=await a.transport.read(id);return corrupt?{...value,portable:'corrupt'}:value;}};
  const sync=a.App.Sync.create({repository:a.repository,connection:a.connection,transport});
  const before=await a.repository.exportPortable();await assert.rejects(push(sync),/readback/);
  assert.equal(await a.repository.exportPortable(),before);assert.equal((await sync.status()).pendingCreate,true);
  corrupt=false;await push(sync);assert.equal(Object.keys((await a.remote.read()).documents).length,1);
});

test('lost first-create response recovers identity after conflicting settings edits without merging old data',async()=>{
  const a=await setup();let fail=true;
  const transport={...a.transport,async create(...args){const result=await a.transport.create(...args);if(fail){fail=false;throw Error('Lost creation response');}return result;}};
  let sync=a.App.Sync.create({repository:a.repository,connection:a.connection,transport});
  await assert.rejects(push(sync),/Lost creation/);
  const id=Object.keys((await a.remote.read()).documents)[0];
  await a.repository.execute('settings.update',{patch:{businessName:'Current changed settings'}},a.repository.revision);
  const before=await a.repository.exportPortable();
  sync=a.App.Sync.create({repository:a.repository,connection:a.connection,transport});
  const stage=await sync.stagePush();assert.match(stage.summary.message,/separate next step/);await sync.commit(stage.id);
  assert.equal((await sync.status()).gistId,id);assert.equal((await sync.status()).pendingCreate,false);
  assert.equal(await a.repository.exportPortable(),before);assert.equal(Object.keys((await a.remote.read()).documents).length,1);
  await assert.rejects(sync.stagePush(),/settings|conflict/i);
});

for(const change of ['edit','maintenance'])test('local mirror transaction guard blocks '+change+' arriving before mirror write',async()=>{
  const a=await setup();await push(a.sync);const before=await a.remote.read();
  const transport={...a.transport,async compareAndSwap(...args){
    if(change==='edit')await add(a.repository,'during-write');
    else await a.repository.execute('maintenance.set',{enabled:true},a.repository.revision);
    return a.transport.compareAndSwap(...args);
  }};
  const sync=a.App.Sync.create({repository:a.repository,connection:a.connection,transport});
  await assert.rejects(push(sync),/changed|maintenance|stale|guard/i);
  assert.deepEqual(await a.remote.read(),before);
});

for(const change of ['edit','maintenance'])test('postflight does not claim push success after '+change+' during readback; identity survives',async()=>{
  const a=await setup();let changed=false;
  const transport={...a.transport,async read(id){
    const result=await a.transport.read(id);
    if(!changed){changed=true;
      if(change==='edit')await add(a.repository,'during-readback');
      else await a.repository.execute('maintenance.set',{enabled:true},a.repository.revision);
    }
    return result;
  }};
  const sync=a.App.Sync.create({repository:a.repository,connection:a.connection,transport});
  await assert.rejects(push(sync),/outcome needs review/);
  const status=await sync.status();assert(status.gistId);assert.equal(status.pendingCreate,false);
  assert.equal(Object.keys((await a.remote.read()).documents).length,1);
  if(change==='edit')assert(a.repository.snapshot().working.sessions.some(r=>r.id==='during-readback'));
  else assert.equal(a.repository.maintenance,true);
});

test('external transport completing after local maintenance returns uncertain outcome, never success',async()=>{
  const a=await setup(),remote=memory(),base=a.App.Sync.localTransport(remote);
  const initial=a.App.Sync.create({repository:a.repository,connection:a.connection,transport:base});await push(initial);
  const id=(await initial.status()).gistId;
  const transport={...base,async compareAndSwap(...args){
    await a.repository.execute('maintenance.set',{enabled:true},a.repository.revision);
    // The simulated external service cannot see the local revision guard.
    return base.compareAndSwap(...args);
  }};
  const sync=a.App.Sync.create({repository:a.repository,connection:a.connection,transport});
  await assert.rejects(push(sync),/outcome needs review/);
  assert.equal((await sync.status()).gistId,id);assert.equal(a.repository.maintenance,true);
});
