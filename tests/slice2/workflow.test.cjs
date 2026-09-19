'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const root = path.resolve(__dirname, '../../protected');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
async function setup() {
  const App = {DEFAULT_SETTINGS: {}};
  const context = vm.createContext({window:{App}, crypto:webcrypto, TextEncoder, console,
    location:{hostname:'localhost'}, Date});
  for (const file of ['js/record-policy.js','js/repository.js']) vm.runInContext(read(file),context);
  let disk = null;
  const repo = App.Repository.create({read:async()=>disk, compareAndSwap:async(_,next)=>{disk=structuredClone(next);}});
  await repo.activateSynthetic(read('fixtures/synthetic.json'));
  return repo;
}
const command = (repo,name,payload)=>repo.execute(name,payload,repo.revision);

test('backdated, future and multi-client sessions cannot inherit or set company shares', async()=>{
  const repo=await setup(), archive=JSON.stringify(repo.snapshot().archive);
  for(const [i,date] of ['1999-12-31','2026-09-06','2030-01-01'].entries()) {
    await command(repo,'session.save',{record:{id:'new-'+i,date,time:'23:30',duration:1,
      amount:0,clientIds:[101,'102'],status:'scheduled',companyAmount:90,companySplit:100}});
    await command(repo,'session.update',{ids:['new-'+i],patch:{companyAmount:50,companySplit:75}});
    const row=repo.read().sessions.find(s=>s.id==='new-'+i);
    assert.equal(row.companyAmount,0); assert.equal(row.companySplit,0);
    assert.equal(row.amount,0); assert.equal(row.date,date); assert.equal(row.time,'23:30');
  }
  assert.equal(JSON.stringify(repo.snapshot().archive),archive);
});

test('new client commands cannot configure shares; edits retain original metadata and family peers',async()=>{
  const repo=await setup(), before=repo.snapshot(), archive=JSON.stringify(before.archive);
  await command(repo,'client.save',{record:{id:'fresh',name:'New Fixture',companyName:'Ignored',
    companySplit:50,splitHistory:[{split:50}],familyGroup:'Fixture Family'}});
  const fresh=repo.read().clients.find(c=>c.id==='fresh');
  assert.equal(Object.keys(fresh).some(k=>/company|split/i.test(k)),false);
  await command(repo,'client.save',{record:{id:101,rate:120,companySplit:70,splitHistory:[],companyName:'Changed'}});
  const old=repo.snapshot().working.clients.find(c=>c.id===101);
  assert.equal(old.companySplit,20);
  assert.equal(JSON.stringify(old.splitHistory),JSON.stringify(before.working.clients[0].splitHistory));
  assert.equal(Object.hasOwn(old,'companyName'),false);
  assert.equal(JSON.stringify(repo.snapshot().working.clients[1]),JSON.stringify(before.working.clients[1]));
  assert.equal(JSON.stringify(repo.snapshot().archive),archive);
});

test('retired setup controls and effective share calculator have no executable references',()=>{
  const files=['index.html','js/app-core.js','js/clients.js','js/sessions.js','js/ui.js'];
  for(const file of files) assert.doesNotMatch(read(file),/getEffectiveSplit|client-company-name|client-company-pct|client-split-effective|client-split-stop|toggle-split-history|split-history-tbody/,file);
});
