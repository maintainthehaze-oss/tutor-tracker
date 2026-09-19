const test=require('node:test');
const assert=require('node:assert/strict');
const {analyzeSource,scanDirectory}=require('./static-guard.cjs');
test('all application modules pass the static writer guard',()=>assert.deepEqual(scanDirectory(),[]));
for(const [name,source] of Object.entries({
  direct:'App.state.sessions[0].amount = 999;',
  alias:'const rows=App.state.sessions; const s=rows.find(x=>x.id===1); s.amount=99;',
  nested:'const c=App.state.clients[0]; c.splitHistory[0].company="changed";',
  callback:'App.state.sessions.forEach(s=>{s.status="completed";});',
  deletion:'delete App.state.receipts["old"];',
  restore:'App.state.sessions=[];',
  storage:'const storage=localStorage; storage.setItem("tutoring-sessions","[]");',
  assign:'Object.assign(App.state.sessions[0],{amount:0});'
})) test('intentional '+name+' bypass is rejected',()=>assert(analyzeSource(source).length>0));
// UI-preference exemption (split visibility, backup bookkeeping): narrow by construction.
for(const [name,source] of Object.entries({
  'inline literal':'localStorage.setItem("tutoring-show-split","1");',
  'const-bound literal':'const KEY="tutoring-backup-meta"; localStorage.setItem(KEY,"{}"); localStorage.removeItem(KEY);',
})) test('UI preference write with '+name+' key is allowed',()=>assert.deepEqual(analyzeSource(source),[]));
for(const [name,source] of Object.entries({
  'record key through the exemption':'const KEY="tutoring-sessions"; localStorage.setItem(KEY,"[]");',
  'reassignable key':'let KEY="tutoring-show-split"; KEY="tutoring-sessions"; localStorage.setItem(KEY,"[]");',
  'computed key':'localStorage.setItem("tutoring-"+name,"1");',
  'aliased storage object':'const store=localStorage; store.setItem("tutoring-show-split","1");',
  'shadowed localStorage':'function f(localStorage){ localStorage.setItem("tutoring-show-split","1"); }',
  'sessionStorage':'sessionStorage.setItem("tutoring-show-split","1");',
  'clear':'localStorage.clear();',
})) test('UI preference exemption refuses '+name,()=>assert(analyzeSource(source).length>0));
