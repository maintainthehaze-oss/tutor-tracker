/* Versioned read-only reporting. Never writes or repairs source evidence. */
(function () {
  'use strict';
  const App = window.App;
  let cachedRepository, cachedRevision;
  const contexts = new Map();
  const freeze = x => { if(x && typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x; };
  const clone = x => JSON.parse(JSON.stringify(x));
  const unique = xs => [...new Set(xs)];
  const validNumber = x => (typeof x === 'number' && Number.isFinite(x)) ||
    (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)));
  const numeric = x => validNumber(x) ? Number(x) : 0;
  const validDate = x => {
    if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x))return false;
    const d=new Date(x+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===x;
  };
  const key = x => App.recordPolicy.key(x);
  const normalizeClient = c => {
    const out = {...c};
    if (!out.firstName && !out.lastName && out.name) out.firstName = String(out.name);
    return out;
  };
  function mode(surface = 'report') {
    return App.$(surface + '-version')?.value === 'captured-v1' ? 'captured-v1' : 'current-v2';
  }
  function context(version = 'current-v2') {
    if (!App.repository.ready) return {sessions:[],clients:[],expenses:[],settings:{},taxPayments:[],warnings:[]};
    if(cachedRepository!==App.repository||cachedRevision!==App.repository.revision){
      contexts.clear();cachedRepository=App.repository;cachedRevision=App.repository.revision;
    }
    if(contexts.has(version))return contexts.get(version);
    const e = App.repository.snapshot(), a = e.archive.originals;
    const captured = version === 'captured-v1';
    const base = captured ? a : e.working;
    const warnings = [], seen = new Set();
    const originals = new Map(a.sessions.map(s => [key(s.id), s]));
    const rows = base.sessions.map(raw => ({raw, source:'sessions'}));
    if (!captured) a.historical.forEach(raw => rows.push({raw,source:'historical'}));
    const sessions = [];
    rows.forEach(({raw,source}) => {
      const id = key(raw.id);
      if (seen.has(id)) { warnings.push('Duplicate identity ' + id + ': sessions record used; historical copy retained in evidence.'); return; }
      seen.add(id);
      const legacy = source === 'historical' || App.recordPolicy.isProtectedRecord(raw.id,e.archive.manifest.sessions,{});
      const finalized = Object.hasOwn(e.finalized,id) ? e.finalized[id] : null;
      const original = source === 'historical' ? raw : originals.get(id) || finalized?.record || raw;
      const inputs = legacy ? a : finalized || e.working;
      const s = clone(original);
      const rowWarnings = [];
      // The pre-Slice-3 repository applied these compatibility aliases on reads.
      App.recordPolicy.normalizeLegacy(s);
      if (!captured) {
        if (!legacy) s.companyAmount = 0;
        // Append-only events (status, payment, correction) overlay archived and finalized rows alike; the stored original is untouched.
        App.recordPolicy.applyEvents(s, e.events);
        // Normalize after the overlay: a correction may have replaced clientIds.
        s.clientIds = unique((Array.isArray(s.clientIds) ? s.clientIds : []).map(String));
      }
      for (const field of ['amount','companyAmount','duration','mileage']) {
        if (!validNumber(s[field])) rowWarnings.push('Record ' + id + ': ' + field + ' is ' +
          (!Object.hasOwn(s,field) ? 'missing' : s[field] === null ? 'null' : 'not numeric') + '.');
      }
      if (!validDate(s.date)) rowWarnings.push('Record ' + id + ': session date is unknown or invalid' + (captured ? '; legacy date selection retained.' : '; excluded from dated reports.'));
      s._report = {legacy,raw:clone(original),source,clients:inputs.clients.map(normalizeClient),settings:clone(inputs.settings),warnings:rowWarnings};
      sessions.push(s);
    });
    const allClients = (captured ? a.clients : [...a.clients,...base.clients,...Object.values(e.finalized).flatMap(f=>f.clients)]).map(normalizeClient);
    const clients = [...new Map(allClients.map(c=>[key(c.id)+'|'+App.clientFamily(c)+'|'+App.clientName(c),c])).values()];
    const result=freeze({sessions,clients,expenses:clone(base.expenses),settings:clone(base.settings),taxPayments:clone(base.taxPayments),warnings});
    contexts.set(version,result);return result;
  }
  function rate(session,year,version = 'current-v2') {
    // Frozen baseline table, not a claim that these inputs reproduce filed reports.
    const table = {2024:0.67,2025:0.70,2026:0.725};
    if (Object.hasOwn(table,String(year))) return table[year];
    const settings = session?._report.settings || context(version).settings;
    if (version === 'captured-v1') return App.num(settings.mileageRate) || 0.725;
    return validNumber(settings.mileageRate) ? Number(settings.mileageRate) : null;
  }
  function metrics(filter = {}, version = 'current-v2') {
    const ctx = context(version), number = version === 'captured-v1' ? App.num : numeric;
    // A correction can point a locked row at a client added after its snapshot; current mode then falls back to today's list.
    const find = (s,id) => s._report.clients.find(c=>key(c.id)===String(id)) ||
      (version==='captured-v1' ? undefined : ctx.clients.find(c=>key(c.id)===String(id)));
    const rows = ctx.sessions.filter(s=>s.status==='completed' && typeof s.date==='string' &&
      (version==='captured-v1' ? !!s.date : validDate(s.date)));
    const M = App.moneyRollup(rows, filter, {number, waivedIsRevenue: version==='captured-v1',
      resolve: (s,id) => find(s,id) || (version==='captured-v1' ? null : {id,firstName:'Unknown client '+id})});
    M.hasLegacyShare=M.sessions.some(s=>s._report.legacy&&(!validNumber(s.companyAmount)||number(s.companyAmount)!==0));
    M.warnings=unique([...ctx.warnings,...M.sessions.flatMap(s=>s._report.warnings),...ctx.sessions.filter(s=>s.status==='completed'&&!validDate(s.date)).flatMap(s=>s._report.warnings)]);
    M.version=version;
    return M;
  }
  function period(filter = {}, version = 'current-v2') {
    const M=metrics(filter,version), ctx=context(version), number=version==='captured-v1'?App.num:numeric;
    const expenses=ctx.expenses.filter(e=>(version==='captured-v1'?typeof e.date==='string'&&!!e.date:validDate(e.date))&&(!filter.year||e.date.slice(0,4)===String(filter.year))&&(!filter.month||e.date.slice(0,7)===filter.month));
    ctx.expenses.forEach(e=>{if(!validDate(e.date))M.warnings.push('Expense '+e.id+': date is unknown or invalid; year allocation unavailable.');});
    M.totalExpenses=expenses.reduce((sum,e)=>sum+number(e.amount),0);
    expenses.forEach(e=>{if(!validNumber(e.amount))M.warnings.push('Expense '+e.id+': amount is unknown.');});
    M.mileageDeduction=M.sessions.reduce((sum,s)=>{
      const r=rate(s,filter.year||s.date.slice(0,4),version);
      if(r===null)M.warnings.push('Record '+s.id+': mileage rate is unknown.');
      return sum+number(s.mileage)*(r===null?0:r);
    },0);
    M.netProfit=M.yourCut-M.totalExpenses-M.mileageDeduction;
    M.warnings=unique(M.warnings);
    return M;
  }
  function notice(warnings = [], version = 'current-v2') {
    return (version==='captured-v1' ? 'Captured v1: original sessions and legacy arithmetic. ' : 'Current v2: stored historical shares; new shares are zero. ') +
      'Captured inputs do not prove reproduction of previously filed reports.' +
      (warnings.length ? ' Incomplete inputs: amounts shown are known subtotals, not complete totals. '+unique(warnings).join(' ') : '');
  }
  /** Same words as notice(), split for the screen: one summary sentence in `el`, and the per-record list
   *  in a collapsible sibling (`<el.id>-details`) so a long list of legacy gaps reads as a note, not an error.
   *  PDF/CSV keep the full text from notice(). */
  function renderNotice(el, warnings = [], version = 'current-v2') {
    if (!el) return;
    const list = unique(warnings);
    const head = version==='captured-v1' ? 'Captured v1: original sessions and legacy arithmetic. ' : 'Current v2: stored historical shares; new shares are zero. ';
    el.textContent = head + 'Captured inputs do not prove reproduction of previously filed reports.' +
      (list.length ? ' Incomplete inputs: ' + list.length + (list.length === 1 ? ' record has' : ' records have') +
        ' a missing or unknown field, so amounts shown are known subtotals, not complete totals.' : '');
    const id = el.id ? el.id + '-details' : '';
    let details = id ? document.getElementById(id) : el.nextElementSibling && el.nextElementSibling.classList.contains('report-notice-details') ? el.nextElementSibling : null;
    if (!list.length) { if (details) details.remove(); return; }
    if (!details) {
      details = document.createElement('details');
      if (id) details.id = id;
      details.className = 'report-notice-details';
      el.parentNode.insertBefore(details, el.nextSibling);
    }
    const open = details.open;
    details.textContent = '';
    const summary = document.createElement('summary');
    summary.textContent = 'Show the ' + list.length + (list.length === 1 ? ' record' : ' records');
    const ul = document.createElement('ul');
    list.forEach((w) => { const li = document.createElement('li'); li.textContent = w; ul.appendChild(li); });
    details.appendChild(summary); details.appendChild(ul); details.open = open;
  }
  App.reportModel=Object.freeze({context,metrics,period,rate,mode,notice,renderNotice,numeric,validNumber,validDate,clients:(v)=>context(v).clients});
})();
