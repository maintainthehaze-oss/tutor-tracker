'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'../../protected');
const fixture=()=>JSON.parse(fs.readFileSync(path.join(root,'fixtures/synthetic.json'),'utf8'));
async function setup(data=fixture()) {
  const ctx=vm.createContext({window:{},document:require('../helpers/harness.cjs').documentStub(),crypto:webcrypto,TextEncoder,console,location:{hostname:'localhost'},indexedDB:{},setTimeout});
  for(const file of ['app-core','record-policy','repository','report-model','reports'])vm.runInContext(fs.readFileSync(path.join(root,'js',file+'.js'),'utf8'),ctx);
  const App=ctx.window.App;let stored;
  App.repository=App.Repository.create({read:async()=>stored,compareAndSwap:async(_,next)=>{stored=JSON.parse(JSON.stringify(next));}});
  await App.repository.activateSynthetic(JSON.stringify(data),{definition:'fabricated baseline evidence'});
  App.refreshReadViews();return App;
}
test('captured v1 golden figures retained; current combines distinct historical records once',async()=>{
  const a=await setup(),before=JSON.stringify(a.repository.snapshot().archive);
  const old=a.reportModel.period({year:'2025'},'captured-v1');
  assert.equal(old.gross,120);assert.equal(old.companySplit,24);assert.equal(old.netProfit,89);
  const current=a.reportModel.period({year:'2025'});
  assert.equal(current.gross,420);assert.equal(current.companySplit,84);assert.equal(current.sessionCount,2);
  assert(current.warnings.some(x=>x.includes('hist-1')&&x.includes('mileage')));
  assert.equal(JSON.stringify(a.repository.snapshot().archive),before);
});
test('current edits cannot change captured historical reports or grouping',async()=>{
  const data=fixture();data.sessions[0].date='2023-12-31';
  const a=await setup(data),before=JSON.stringify(a.reportModel.period({year:'2023'}));
  const old=JSON.stringify(a.reportModel.period({year:'2023'},'captured-v1'));
  await a.repository.execute('client.save',{record:{id:101,firstName:'Changed',familyGroup:'Changed',rate:999,address:'Changed, NY'}},a.repository.revision);
  await a.repository.execute('settings.update',{patch:{mileageRate:9}},a.repository.revision);a.refreshReadViews();
  assert.equal(JSON.stringify(a.reportModel.period({year:'2023'})),before);
  assert.equal(JSON.stringify(a.reportModel.period({year:'2023'},'captured-v1')),old);
});
test('missing, null and invalid values are visible; explicit zero stays known',async()=>{
  const data=fixture();data.sessions[3].status='completed';data.sessions[3].amount='80oops';
  const a=await setup(data),m=a.reportModel.metrics({month:'2026-02'});
  assert.equal(m.gross,100);assert.equal(m.companySplit,0);assert(m.hasLegacyShare);
  assert(m.warnings.some(x=>x.includes('missing')));assert(m.warnings.some(x=>x.includes('null')));
  assert(m.warnings.some(x=>x.includes('not numeric')));
  assert.equal(a.reportModel.metrics({month:'2026-01'}).warnings.length,0);
});
test('duplicate cross-collection identity is counted once and disclosed',async()=>{
  const data=fixture();data.historical.push({...data.sessions[0],id:'1',amount:999});
  const a=await setup(data),m=a.reportModel.metrics({year:'2025'});
  assert.equal(m.gross,420);assert.equal(m.sessionCount,2);assert(m.warnings.some(x=>x.includes('Duplicate identity')));
});

test('new sessions cannot shadow historical-only identity or change historical totals',async()=>{
  const a=await setup(),before=JSON.stringify(a.repository.snapshot());
  const totals=JSON.stringify(a.reportModel.period({year:'2025'}));
  await assert.rejects(a.repository.execute('session.save',{record:{id:'hist-1',clientIds:[101],date:'2026-09-06',duration:1,amount:10,status:'scheduled'}},a.repository.revision),/Historical session identity is reserved/);
  assert.equal(JSON.stringify(a.repository.snapshot()),before);
  assert.equal(JSON.stringify(a.reportModel.period({year:'2025'})),totals);
});
test('finalized rates and clients freeze; later payment remains a separate event',async()=>{
  const a=await setup();
  await a.repository.execute('session.save',{record:{id:'new',clientIds:[101],date:'2023-01-01',duration:1,amount:100,mileage:10,status:'completed',paid:false}},a.repository.revision);
  const before=JSON.stringify(a.repository.snapshot().finalized);
  await a.repository.execute('settings.update',{patch:{mileageRate:7}},a.repository.revision);
  await a.repository.execute('client.save',{record:{id:101,familyGroup:'Changed'}},a.repository.revision);
  await a.repository.execute('session.payment',{ids:['new'],date:'2026-09-06'},a.repository.revision);
  const m=a.reportModel.period({year:'2023',paid:'paid'});
  assert.equal(m.gross,100);assert.equal(m.companySplit,0);assert.equal(m.mileageDeduction,5);
  assert.equal(m.sessions[0]._report.raw.paid,false);assert.equal(m.sessions[0].paid,true);
  assert.equal(m.groups[0].family,'Fixture Family');
  assert.equal(JSON.stringify(a.repository.snapshot().finalized),before);
});
test('month/client/paid filters and monthly sums agree, including zero and unknown inputs',async()=>{
  const a=await setup(),year=a.reportModel.period({year:'2026'});
  const months=Array.from({length:12},(_,i)=>a.reportModel.period({year:'2026',month:'2026-'+String(i+1).padStart(2,'0')}));
  assert.equal(months.reduce((s,m)=>s+m.gross,0),year.gross);
  assert.equal(months.reduce((s,m)=>s+m.netProfit,0),year.netProfit);
  const m=a.reportModel.metrics({year:'2026',month:'2026-03',clientId:101,paid:'paid'});
  assert.equal(m.sessionCount,1);assert.equal(m.gross,160);assert.equal(m.companySplit,32);
});
test('unknown captured rates remain unknown, not replaced by current defaults',async()=>{
  const data=fixture();delete data.settings.mileageRate;data.sessions[0].date='2023-12-31';
  const a=await setup(data),m=a.reportModel.period({year:'2023'});
  assert(m.warnings.some(x=>x.includes('rate is unknown')));assert.equal(m.mileageDeduction,0);
});
test('captured v1 preserves previous compatibility reads and partial date selection',async()=>{
  const data=fixture();data.sessions[0].date='2025-12';data.sessions[2].paymentStatus='paid';
  const a=await setup(data);
  assert.equal(a.reportModel.metrics({year:'2025'},'captured-v1').gross,120);
  assert.equal(a.reportModel.metrics({year:'2026',family:'Fixture Family'},'captured-v1').gross,a.computeMetrics({year:'2026',family:'Fixture Family'}).gross);
  assert.equal(a.getTaxData(2026,'captured-v1').grossIncome,380);
});
test('malformed preserved dates never crash current reports and remain visible',async()=>{
  const data=fixture();data.sessions[0].date=20250101;data.sessions[1].date='2026-02-31';data.expenses[0].date=null;data.taxPayments[0].date=2026;
  const a=await setup(data),m=a.reportModel.period({year:'2026'});
  assert(m.warnings.some(x=>x.includes('date is unknown')));
  assert(m.warnings.some(x=>x.includes('Expense exp-1')));
  const t=a.getTaxData(2026);assert.equal(t.grossIncome,280);assert(t.warnings.length);
});
module.exports={setup,fixture};
