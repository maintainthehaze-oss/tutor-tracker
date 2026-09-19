const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../protected/js');
// Realized (completed) money must come from App.reportModel. The header "Projected" pill (shipped
// 2026-09-10) is operational, not a report: it sums sessions that are still SCHEDULED, which the
// model deliberately does not cover. Only that exact scheduled-only read is exempt.
// The "This week" strip (2026-09-19) is operational too: it lists live, tappable session rows (any status)
// and sums nothing. Only that exact call is exempt; every other direct read in dashboard.js still fails.
const OPERATIONAL_READS=["App.state.sessions.filter((s) => s.status === 'scheduled')",
  "weekStripDays(App.state.sessions, App.state.clients, todayISO())"];
function check(sources){
  const failures=[];
  for(const file of ['reports','dashboard','historical']){
    let readers=file==='reports'?sources[file].split('  let taxFormRevision;')[0]:sources[file];
    if(file==='dashboard')for(const allowed of OPERATIONAL_READS)readers=readers.split(allowed).join('');
    if(/App\.state\.(sessions|expenses|taxPayments)|App\.computeMetrics\(|App\.mileageRateFor\(/.test(readers))failures.push(file);
    if(!sources[file].includes('App.reportModel'))failures.push(file+' missing model');
  }
  const reportCSV=sources.ui.split("case 'report': {")[1].split("case 'tax': {")[0];
  if(!reportCSV.includes('App.getReportFilter()')||!reportCSV.includes('App.reportModel.period(')||reportCSV.includes('App.computeMetrics('))failures.push('CSV bypass');
  return failures;
}
const sources=Object.fromEntries(['reports','dashboard','historical','ui'].map(f=>[f,fs.readFileSync(path.join(root,f+'.js'),'utf8')]));
test('all report/chart readers and report CSV route through the shared model',()=>assert.deepEqual(check(sources),[]));
test('intentional direct report reader bypass fails the guard',()=>assert(check({...sources,reports:'App.state.sessions.reduce(()=>0);\n'+sources.reports}).length));
test('intentional unfiltered CSV bypass fails the guard',()=>assert(check({...sources,ui:sources.ui.replace('App.getReportFilter()','{}')}).length));
test('the projection exemption is exact: the dashboard still cannot read realized sessions directly',()=>{
  for(const allowed of OPERATIONAL_READS)assert.equal(sources.dashboard.split(allowed).length,2,'operational read moved or duplicated: '+allowed);
  for(const bypass of ["App.state.sessions.filter((s) => s.status === 'completed');\n","App.state.sessions.filter((s) => s.status !== 'scheduled');\n","App.state.expenses.length;\n","App.computeMetrics({});\n"])
    assert.deepEqual(check({...sources,dashboard:bypass+sources.dashboard}),['dashboard'],bypass);
});
