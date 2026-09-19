'use strict';
// Fabricated legacy captures only. The production reader is exercised separately
// with a readonly fake cursor; no browser profile or real records are accessed.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const copy=x=>x==null?x:JSON.parse(JSON.stringify(x));
function setup(options={}) {
  const App={DEFAULT_SETTINGS:{autoSync:'off'}};
  const context=vm.createContext({window:{App},location:{hostname:'maintainthehaze-oss.github.io',origin:'https://maintainthehaze-oss.github.io',pathname:'/tutor-tracker/protected/'},
    crypto:webcrypto,TextEncoder,console,...options});
  for(const file of ['record-policy.js','repository.js'])vm.runInContext(fs.readFileSync(path.join(root,'protected/js',file),'utf8'),context);
  return App.Repository;
}
function memory(){let value=null;return {read:async()=>copy(value),fail:false,async compareAndSwap(expected,next){if(this.fail)throw Error('quota');assert.deepEqual(value,copy(expected));value=copy(next);}};}
function fixture(){return {format:'tutor-tracker-legacy-capture-v1',localStorage:[
  ['tutoring-clients',' [ {"id":1,"companySplit":"20","name":"Fictional"} ] '],
  ['tutoring-sessions','[{"id":"old","status":"scheduled","date":"2099-01-01","amount":"0","unknown":null}]'],
  ['tutoring-receipts','{"1":"local-copy","orphan":"local-orphan"}'],
  ['tutoring-settings','{"gistToken":"fabricated-secret","autoSync":"on"}'],
  ['tutoring-sessions-corrupt-1','not JSON: retain exact'],
],receipts:{databasePresent:true,storePresent:true,rows:[
  {key:['number','1'],displayKey:'1',value:['string','numeric-receipt']},
  {key:['string','1'],displayKey:'1',value:['string','string-receipt']},
  {key:['array',[['number','2'],['string','orphan']]],displayKey:'2,orphan',value:['object',[['retained',['boolean',true]]]]},
  {key:['date','2025-01-01T00:00:00.000Z'],displayKey:'original date string',value:['bytes',[0,255,1]]},
]}};}
function repository(capture=fixture()){const api=setup(),adapter=memory();return {api,adapter,repo:api.create(adapter,{captureLegacy:async()=>copy(capture)}),capture};}
test('production captures exact raw strings and typed rows; original stores remain untouched',async()=>{
  const {repo,capture}=repository(),before=copy(capture),stage=await repo.stageLegacyActivation({version:'captured'});
  assert.equal(stage.summary.counts.sessions,1);assert.equal(stage.summary.futureScheduled,1);assert.equal(stage.summary.receiptRows,4);
  await repo.commitLegacyActivation(stage.id,{backupAcknowledged:true});
  assert.deepEqual(JSON.parse(repo.snapshot().archive.rawSnapshot),before);
  assert.equal(repo.read().receipts['1'],'string-receipt');assert.equal(repo.read().receipts.orphan,'local-orphan');
  assert.deepEqual(capture,before);assert.equal(repo.read().settings.autoSync,'off');
  assert.equal(repo.snapshot().archive.originals.settings.autoSync,'on');
  await assert.rejects(repo.execute('session.delete',{id:'old'}));
  await assert.rejects(repo.exportPortable(),/credential/);
});
test('private recovery verifies before activation and restores via the same commit boundary',async()=>{
  const first=repository(),stage=await first.repo.stageLegacyActivation();
  const second=repository(),restore=await second.repo.stagePrivateRecovery(stage.recoveryText);
  await assert.rejects(second.repo.portableStageGuard(restore.id),/cannot be synchronized/);
  await second.repo.commitPortable(restore.id);
  assert.equal(second.repo.snapshot().archive.id,JSON.parse(stage.recoveryText).snapshot.archive.id);
  assert.equal(await second.repo.exportPrivateRecovery(),stage.recoveryText);
  const third=repository(),tampered=JSON.parse(stage.recoveryText);tampered.snapshot.working.sessions[0].amount=99;
  await assert.rejects(third.repo.stagePrivateRecovery(JSON.stringify(tampered)),/Protected/);
  await assert.rejects(first.repo.stagePortable(stage.recoveryText));
});
test('missing stores initialize empty without writing originals; malformed active values fail closed',async()=>{
  const empty={format:'tutor-tracker-legacy-capture-v1',localStorage:[],receipts:{databasePresent:false,storePresent:false,rows:[]}};
  const {repo}=repository(empty),stage=await repo.stageLegacyActivation();await repo.commitLegacyActivation(stage.id,{backupAcknowledged:true});
  assert.equal(repo.read().sessions.length,0);
  for(const raw of ['{bad','null','{}','[{"id":1},{"id":1}]']){
    const capture=copy(empty);capture.localStorage=[['tutoring-sessions',raw]];
    const bad=repository(capture);await assert.rejects(bad.repo.stageLegacyActivation());assert.equal(await bad.adapter.read(),null);
  }
});
test('stale stage, missing acknowledgment, quota and repeated activation never replace legacy evidence',async()=>{
  const {repo,adapter,capture,api}=repository(),original=copy(capture);
  let stage=await repo.stageLegacyActivation();await assert.rejects(repo.commitLegacyActivation(stage.id),/recovery copy/);assert.equal(await adapter.read(),null);
  stage=await repo.stageLegacyActivation();capture.localStorage.push(['tutoring-theme','dark']);
  await assert.rejects(repo.commitLegacyActivation(stage.id,{backupAcknowledged:true}),/changed after backup/);assert.equal(await adapter.read(),null);
  capture.localStorage.pop();stage=await repo.stageLegacyActivation();adapter.fail=true;
  await assert.rejects(repo.commitLegacyActivation(stage.id,{backupAcknowledged:true}),/quota/);assert.equal(await adapter.read(),null);assert.equal(repo.ready,false);
  adapter.fail=false;stage=await repo.stageLegacyActivation();await repo.commitLegacyActivation(stage.id,{backupAcknowledged:true});
  await assert.rejects(repo.stageLegacyActivation(),/already initialized/);
  const restarted=api.create(adapter,{captureLegacy:async()=>{throw Error('must not recapture');}});assert.equal(await restarted.open(),true);
  assert.equal(restarted.snapshot().archive.id,repo.snapshot().archive.id);assert.deepEqual(capture,original);
  await restarted.execute('maintenance.set',{enabled:true});
  await assert.rejects(restarted.stagePrivateRecovery(await restarted.exportPrivateRecovery()),/Maintenance/);
});
test('capture changing between reads refuses; forged typed rows and duplicate keys refuse',async()=>{
  const api=setup(),adapter=memory();let count=0;
  const repo=api.create(adapter,{captureLegacy:async()=>{const c=fixture();c.localStorage.push(['tutoring-counter',String(count++)]);return c;}});
  await assert.rejects(repo.stageLegacyActivation(),/changed during capture/);
  for(const row of [{key:['string','x'],value:['blob','unsupported']},{key:['number','NaN'],value:['string','x']},fixture().receipts.rows[0]]){
    const capture=fixture();capture.receipts.rows.push(row);await assert.rejects(repository(capture).repo.stageLegacyActivation());
  }
});
test('production rejects synthetic activation; host/path detection is exact',async()=>{
  const {repo,api}=repository();assert.equal(api.productionMode(),true);
  await assert.rejects(repo.activateSynthetic('{"syntheticOnly":true}'),/disabled in production/);
  for(const pathname of ['/elsewhere/','/tutor-tracker-evil/'])assert.equal(setup({location:{origin:'https://maintainthehaze-oss.github.io',pathname}}).productionMode(),false);
});
function fakeLegacy(rows){
  const raw=fixture().localStorage,writes=[];
  const localStorage={length:raw.length,key:i=>raw[i][0],getItem:k=>raw.find(r=>r[0]===k)?.[1]??null,setItem:()=>writes.push('ls'),removeItem:()=>writes.push('ls')};
  const indexedDB={databases:async()=>[{name:'tutor-tracker'}],open(name){assert.equal(name,'tutor-tracker');const request={};queueMicrotask(()=>{request.result={objectStoreNames:{contains:n=>n==='receipts'},close(){},transaction(store,mode){assert.equal(store,'receipts');assert.equal(mode,'readonly');const tx={abort(){queueMicrotask(()=>tx.onabort());},objectStore(){return {openCursor(){const cursor={};let i=0;const next=()=>queueMicrotask(()=>{cursor.result=i<rows.length?{...rows[i++],continue:next}:null;cursor.onsuccess();if(!cursor.result)queueMicrotask(()=>tx.oncomplete());});next();return cursor;}};}};return tx;}};request.onsuccess();});return request;}};
  return {localStorage,indexedDB,writes};
}
test('actual capture reader uses only readonly cursor and retains numeric/string/date/binary values',async()=>{
  const native=fakeLegacy([{key:1,value:'n'},{key:'1',value:'s'},{key:new Date('2025-01-01'),value:new Uint8Array([4,5]).buffer},{key:['compound',2],value:{a:null,b:[false,2]}}]);
  const repo=setup(native).create(memory()),stage=await repo.stageLegacyActivation();
  const capture=JSON.parse(JSON.parse(stage.recoveryText).snapshot.archive.rawSnapshot);
  assert.deepEqual(capture.receipts.rows[0].key,['number','1']);assert.deepEqual(capture.receipts.rows[1].key,['string','1']);
  assert.deepEqual(capture.receipts.rows[2].value,['bytes',[4,5]]);assert.deepEqual(native.writes,[]);
  await repo.commitLegacyActivation(stage.id,{backupAcknowledged:true});assert.deepEqual(native.writes,[]);
});
test('actual capture reader fails closed on unsupported values instead of dropping them',async()=>{
  const native=fakeLegacy([{key:'x',value:new Map([['receipt','data']])}]);
  await assert.rejects(setup(native).create(memory()).stageLegacyActivation(),/Unsupported legacy receipt/);
  assert.deepEqual(native.writes,[]);
});
test('every fresh production import binds existing legacy records at stage and commit',async()=>{
  const clean=fixture();clean.localStorage=clean.localStorage.filter(([key])=>key!=='tutoring-settings');
  const source=repository(clean),activation=await source.repo.stageLegacyActivation();
  await source.repo.commitLegacyActivation(activation.id,{backupAcknowledged:true});
  const routes=[['stagePrivateRecovery',await source.repo.exportPrivateRecovery()],['stagePortable',await source.repo.exportPortable()]];
  const empty={format:'tutor-tracker-legacy-capture-v1',localStorage:[],receipts:{databasePresent:false,storePresent:false,rows:[]}};
  for(const [method,text] of routes){
    const mismatch=copy(clean);mismatch.localStorage.push(['tutoring-theme','different']);
    const bad=repository(mismatch),before=copy(mismatch);
    await assert.rejects(bad.repo[method](text),/does not match/);assert.equal(await bad.adapter.read(),null);assert.deepEqual(mismatch,before);
    const stale=repository(copy(clean)),stage=await stale.repo[method](text);
    stale.capture.localStorage.push(['tutoring-theme','changed after staging']);
    await assert.rejects(stale.repo.commitPortable(stage.id),/changed after recovery staging/);assert.equal(await stale.adapter.read(),null);
    const fresh=repository(copy(empty)),restore=await fresh.repo[method](text);
    await fresh.repo.commitPortable(restore.id);assert.equal(fresh.repo.snapshot().archive.id,source.repo.snapshot().archive.id);
    const matching=repository(copy(clean)),match=await matching.repo[method](text);
    await matching.repo.commitPortable(match.id);assert.equal(matching.repo.snapshot().archive.id,source.repo.snapshot().archive.id);
    const malformed=copy(clean);malformed.localStorage.push(['tutoring-expenses','not json']);
    const corrupt=repository(malformed);await assert.rejects(corrupt.repo[method](text));assert.equal(await corrupt.adapter.read(),null);
    const receiptsOnly=copy(empty);receiptsOnly.receipts=copy(clean.receipts);
    await assert.rejects(repository(receiptsOnly).repo[method](text),/does not match/);
  }
});
test('fresh recovery from empty storage refuses records arriving between staging and commit',async()=>{
  const source=repository(),backup=await source.repo.stageLegacyActivation();
  const capture={format:'tutor-tracker-legacy-capture-v1',localStorage:[],receipts:{databasePresent:false,storePresent:false,rows:[]}};
  const target=repository(capture),stage=await target.repo.stagePrivateRecovery(backup.recoveryText);
  capture.localStorage.push(['tutoring-sessions','[{"id":"new-legacy"}]']);
  await assert.rejects(target.repo.commitPortable(stage.id),/changed after recovery staging/);assert.equal(await target.adapter.read(),null);
});
test('portable export rejects credentials in typed receipt objects and prefixed legacy storage keys',async()=>{
  for(const kind of ['typed','storage']){
    const capture=fixture();capture.localStorage=capture.localStorage.filter(([key])=>key!=='tutoring-settings');
    if(kind==='typed')capture.receipts.rows.push({key:['string','private'],displayKey:'private',value:['object',[['token',['string','fabricated-secret']]]]});
    else capture.localStorage.push(['tutoring-gist-token','fabricated-secret']);
    const {repo}=repository(capture),stage=await repo.stageLegacyActivation();await repo.commitLegacyActivation(stage.id,{backupAcknowledged:true});
    await assert.rejects(repo.exportPortable(),/credential field/);
    const backup=await repo.exportPrivateRecovery();assert.equal(JSON.parse(backup).format,'tutor-tracker-private-recovery-v1');
    assert.deepEqual(JSON.parse(repo.snapshot().archive.rawSnapshot),capture);
  }
});
test('capture refuses shared object references instead of losing alias identity',async()=>{
  const shared={receipt:'data'},native=fakeLegacy([{key:'aliased',value:{a:shared,b:shared}}]);
  const adapter=memory();await assert.rejects(setup(native).create(adapter).stageLegacyActivation(),/Unsupported legacy receipt value/);
  assert.equal(await adapter.read(),null);assert.deepEqual(native.writes,[]);
});
