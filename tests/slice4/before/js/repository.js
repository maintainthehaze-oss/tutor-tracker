/* Slice 1 local preview. One validated writer; never reads/migrates legacy stores. */
(function () {
  'use strict';
  const App = window.App;
  const P = App.recordPolicy;
  const collections = ['clients', 'sessions', 'expenses', 'taxPayments', 'historical'];
  const clone = x => JSON.parse(JSON.stringify(x));
  function freeze(x) {
    if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); }
    return x;
  }
  function canonical(x) {
    if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
    if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
    return JSON.stringify(x);
  }
  const equal = (a, b) => canonical(a) === canonical(b);
  async function hash(x) {
    const bytes = new TextEncoder().encode(typeof x === 'string' ? x : canonical(x));
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  }
  function index(rows) {
    if (!Array.isArray(rows)) throw Error('Expected a record array');
    const out = Object.create(null);
    rows.forEach(r => {
      if (!r || typeof r !== 'object' || Array.isArray(r)) throw Error('Invalid record');
      const k = P.key(r.id);
      if (Object.hasOwn(out, k)) throw Error('Duplicate or ambiguous record identity: ' + k);
      out[k] = r;
    });
    return out;
  }
  function validateShape(state) {
    collections.forEach(k => index(state[k]));
    for (const k of ['settings', 'receipts']) {
      if (!state[k] || typeof state[k] !== 'object' || Array.isArray(state[k])) throw Error('Invalid ' + k);
    }
  }
  function manifests(state) {
    return Object.fromEntries(collections.map(k => [k, Object.fromEntries(state[k].map(r => [P.key(r.id), true]))]));
  }
  function unchangedRows(originals, rows, label) {
    const byId = index(rows);
    originals.forEach(r => {
      if (!equal(r, byId[P.key(r.id)])) throw Error('Protected ' + label + ' record: ' + P.key(r.id));
    });
  }
  function validateEnvelope(e) {
    if (!e || e.schema !== 1 || !Number.isSafeInteger(e.revision) || e.revision < 0 ||
        typeof e.maintenance !== 'boolean' || !e.archive || typeof e.archive.id !== 'string' ||
        !e.finalized || !Array.isArray(e.events)) throw Error('Invalid protected store');
    validateShape(e.working);
    validateShape(e.archive.originals);
    if (!equal(e.archive.manifest, manifests(e.archive.originals))) throw Error('Archive manifest mismatch');
    const raw = JSON.parse(e.archive.rawSnapshot);
    for (const k of [...collections, 'settings', 'receipts']) {
      if (!equal(raw[k], e.archive.originals[k])) throw Error('Archive raw snapshot mismatch');
    }
    for (const k of ['sessions', 'expenses', 'taxPayments', 'historical']) unchangedRows(e.archive.originals[k], e.working[k], k);
    if (!equal(e.working.historical, e.archive.originals.historical)) throw Error('Historical collection is read-only');
    for (const [k,v] of Object.entries(e.archive.originals.receipts)) {
      if (!Object.hasOwn(e.working.receipts,k) || !equal(v,e.working.receipts[k])) throw Error('Protected receipt: ' + k);
    }
    Object.entries(e.finalized).forEach(([id, value]) => {
      if (id !== P.key(value.record.id)) throw Error('Finalized identity mismatch');
      unchangedRows([value.record], e.working.sessions, 'finalized session');
    });
  }
  function validateTransition(old, next) {
    validateEnvelope(next);
    if (!equal(old.archive, next.archive)) throw Error('Archive replacement forbidden');
    if (next.revision !== old.revision + 1) throw Error('Invalid revision');
    for (const [id,value] of Object.entries(old.finalized)) {
      if (!equal(next.finalized[id], value)) throw Error('Finalization is immutable');
    }
    if (!equal(next.events.slice(0, old.events.length), old.events)) throw Error('Payment events are append-only');
    // Working clients may change; original company metadata must not disappear.
    old.working.clients.forEach(c => {
      const updated = index(next.working.clients)[P.key(c.id)];
      if (!updated) throw Error('Retire clients instead of deleting them');
      Object.keys(c).filter(k => /company|split/i.test(k)).forEach(k => {
        if (!Object.hasOwn(updated,k) || !equal(c[k],updated[k])) throw Error('Legacy client company metadata is read-only');
      });
    });
  }
  async function seal(e) { const body = clone(e); delete body.integrity; return {...body, integrity: await hash(body)}; }
  async function verify(e) {
    validateEnvelope(e);
    if (e.archive.rawHash !== await hash(e.archive.rawSnapshot)) throw Error('Raw archive hash mismatch');
    if (e.integrity !== (await seal(e)).integrity) throw Error('Protected store integrity mismatch');
  }
  function localOnly() {
    if (!['localhost','127.0.0.1','[::1]'].includes(location.hostname)) throw Error('Slice 1 is a localhost-only review build; deployment is disabled');
  }
  function indexedDBAdapter() {
    let dbPromise;
    function db() {
      localOnly();
      if (!dbPromise) dbPromise = new Promise((resolve,reject) => {
        const req = indexedDB.open('tutor-tracker-slice1-preview', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('repository');
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(Error('Another preview tab blocks storage'));
        req.onsuccess = () => { req.result.onversionchange = () => { req.result.close(); dbPromise = null; }; resolve(req.result); };
      }).catch(e => { dbPromise = null; throw e; });
      return dbPromise;
    }
    return Object.freeze({
      async read() {
        const database = await db();
        return new Promise((resolve,reject) => {
          const tx = database.transaction('repository', 'readonly');
          const req = tx.objectStore('repository').get('active');
          tx.oncomplete = () => resolve(req.result || null);
          tx.onabort = tx.onerror = () => reject(tx.error || Error('Read failed'));
        });
      },
      async compareAndSwap(expected, next) {
        const database = await db();
        return new Promise((resolve,reject) => {
          const tx = database.transaction('repository', 'readwrite');
          const store = tx.objectStore('repository');
          let conflict;
          const req = store.get('active');
          req.onsuccess = () => {
            const actual = req.result || null;
            if ((actual && actual.integrity) !== (expected && expected.integrity) ||
                (actual && actual.revision) !== (expected && expected.revision)) {
              conflict = Error('Another tab changed the store. Reload before trying again.'); tx.abort(); return;
            }
            // Complete archive, working data, revision, events and maintenance in one IDB transaction.
            try { store.put(next, 'active'); }
            catch(error) { conflict=error; tx.abort(); }
          };
          tx.oncomplete = () => resolve();
          tx.onabort = tx.onerror = () => reject(conflict || tx.error || Error('Save failed'));
        });
      }
    });
  }
  function create(adapter) {
    let current = null;
    let queue = Promise.resolve();
    const listeners = new Set();
    const serial = fn => { const task = queue.then(fn); queue = task.catch(() => {}); return task; };
    function publish(value) { current = freeze(clone(value)); listeners.forEach(fn => { try { fn(); } catch(error) { console.error('Saved, but a view refresh failed',error); } }); }
    function requireReady() { if (!current) throw Error('Open or initialize the synthetic preview first'); }
    function archived(collection, id) { requireReady(); return P.isProtectedRecord(id,current.archive.manifest[collection],{}); }
    function protectedSession(id) { requireReady(); return P.isProtectedRecord(id,current.archive.manifest.sessions,current.finalized); }
    function read() {
      if (!current) return freeze({clients:[], sessions:[], expenses:[], taxPayments:[], historical:[], receipts:{}, settings:{...App.DEFAULT_SETTINGS}});
      const view = clone(current.working);
      view.settings = {...App.DEFAULT_SETTINGS, ...view.settings, autoSync:'off'};
      view.clients = view.clients.map(c => {
        if(c.status == null)c.status='active';
        if (c.rate == null && c.hourlyRate != null) c.rate = c.hourlyRate;
        if (!c.firstName && !c.lastName && c.name) { const parts = c.name.trim().split(/\s+/); c.firstName = parts.shift(); c.lastName = parts.join(' '); }
        return c;
      });
      view.sessions = view.sessions.map(s => {
        if (!Array.isArray(s.clientIds)) s.clientIds = Object.hasOwn(s,'clientId') ? [s.clientId] : [];
        if (s.paid == null && (s.paymentStatus != null || s.payment != null)) s.paid = (s.paymentStatus || s.payment) === 'paid';
        // Payment overlay is a read view only; finalized original is never edited.
        const event = current.events.filter(e => P.key(e.sessionId) === P.key(s.id)).at(-1);
        if (event) { s.paid = true; s.payment = 'paid'; s.paymentDate = event.date; }
        return s;
      });
      return freeze(view);
    }
    function select(rows, ids) {
      if (!Array.isArray(ids) || !ids.length) throw Error('Select at least one record');
      const lookup = index(rows);
      return [...new Set(ids.map(P.key))].map(id => { if (!lookup[id]) throw Error('Record no longer exists: '+id); return lookup[id]; });
    }
    function assertEditableSessions(rows) {
      const locked = rows.filter(s => protectedSession(s.id));
      if (locked.length) throw Error('Read-only sessions block this entire action: ' + locked.map(s=>P.key(s.id)).join(', '));
    }
    function mergeRecord(rows, input) {
      if (!input || typeof input !== 'object') throw Error('Record required');
      const k = P.key(input.id), old = index(rows)[k];
      const record = {...old,...clone(input),id:old ? old.id : input.id};
      if (old) rows[rows.indexOf(old)] = record; else rows.push(record);
      return record;
    }
    function finalize(draft, record) {
      if (record.status !== 'scheduled') Object.defineProperty(draft.finalized,P.key(record.id),{
        value:{record:clone(record),clients:clone(draft.working.clients),settings:clone(draft.working.settings)},
        enumerable:true,writable:true,configurable:true
      });
    }
    function validateNewSession(record) {
      if (!['scheduled','completed','cancelled','no-show'].includes(record.status)) throw Error('Invalid session status');
      if (typeof record.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) throw Error('Session date required');
      if (!Number.isFinite(Number(record.duration)) || Number(record.duration) <= 0 ||
          !Number.isFinite(Number(record.amount)) || Number(record.amount) < 0) throw Error('Invalid duration or amount');
      if (!Array.isArray(record.clientIds) || !record.clientIds.length) throw Error('Session clients required');
    }
    async function execute(name, payload, expectedRevision) {
      // Clone before entering the queue: caller changes cannot alter the proposal.
      const proposal = clone(payload || {});
      const expected = expectedRevision === undefined ? (current && current.revision) : expectedRevision;
      return serial(async () => {
        requireReady();
        if (expected !== current.revision) throw Error('Stale action. Reload or reopen the form.');
        if (current.maintenance && name !== 'maintenance.set') throw Error('Maintenance mode: records are read-only');
        const draft = clone(current), w = draft.working, p = proposal;
        switch (name) {
          case 'session.save': {
            const old = index(w.sessions)[P.key(p.record.id)];
            if (old) assertEditableSessions([old]);
            const r = mergeRecord(w.sessions,p.record);
            r.companyAmount=0; r.companySplit=0;
            validateNewSession(r); finalize(draft,r); break;
          }
          case 'session.update': {
            const rows = select(w.sessions,p.ids); assertEditableSessions(rows);
            if (!p.patch || Object.hasOwn(p.patch,'id')) throw Error('Invalid session update');
            rows.forEach(s => { const r=mergeRecord(w.sessions,{...s,...p.patch,companyAmount:0,companySplit:0}); validateNewSession(r); finalize(draft,r); }); break;
          }
          case 'session.delete': {
            const rows=select(w.sessions,p.ids); assertEditableSessions(rows);
            const ids=new Set(rows.map(s=>P.key(s.id))); w.sessions=w.sessions.filter(s=>!ids.has(P.key(s.id))); break;
          }
          case 'session.payment': {
            const rows=select(w.sessions,p.ids);
            const locked=rows.filter(s=>archived('sessions',s.id));
            if (locked.length) throw Error('Read-only historical sessions: '+locked.map(s=>P.key(s.id)).join(', '));
            if (typeof p.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) throw Error('Payment date required');
            rows.forEach(s => {
              if (s.paid || draft.events.some(e=>P.key(e.sessionId)===P.key(s.id))) throw Error('Payment already recorded');
              if (s.status !== 'completed') throw Error('Complete the session before recording a payment');
              draft.events.push({id:crypto.randomUUID(),sessionId:s.id,date:p.date,type:'payment',recordedAt:new Date().toISOString()});
            }); break;
          }
          case 'client.save': {
            // Company setup is retired. Merge retains existing legacy metadata,
            // while neither new nor edited clients can configure it.
            Object.keys(p.record).filter(k=>/company|split/i.test(k)).forEach(k=>delete p.record[k]);
            mergeRecord(w.clients,p.record); break;
          }
          case 'client.retire': {
            const c=select(w.clients,[p.id])[0]; c.status='inactive'; break;
          }
          case 'expense.save': {
            if (archived('expenses',p.record.id)) throw Error('Historical expenses are read-only');
            const r=mergeRecord(w.expenses,p.record);
            if (Object.hasOwn(p,'receipt')) {
              if (Object.hasOwn(current.archive.originals.receipts,P.key(r.id))) throw Error('Historical receipt is read-only');
              if (p.receipt === null) delete w.receipts[P.key(r.id)]; else Object.defineProperty(w.receipts,P.key(r.id),{value:p.receipt,enumerable:true,writable:true,configurable:true});
            } break;
          }
          case 'expense.delete': {
            select(w.expenses,[p.id]);
            if (archived('expenses',p.id) || Object.hasOwn(current.archive.originals.receipts,P.key(p.id))) throw Error('Historical expense/receipt is read-only');
            w.expenses=w.expenses.filter(r=>P.key(r.id)!==P.key(p.id)); delete w.receipts[P.key(p.id)]; break;
          }
          case 'tax.save':
            if (archived('taxPayments',p.record.id)) throw Error('Historical tax payments are read-only');
            mergeRecord(w.taxPayments,p.record); break;
          case 'tax.delete':
            select(w.taxPayments,[p.id]);
            if (archived('taxPayments',p.id)) throw Error('Historical tax payments are read-only');
            w.taxPayments=w.taxPayments.filter(r=>P.key(r.id)!==P.key(p.id)); break;
          case 'settings.update':
            w.settings={...w.settings,...p.patch,autoSync:'off'}; break;
          case 'maintenance.set':
            if (typeof p.enabled !== 'boolean') throw Error('Maintenance value required');
            draft.maintenance=p.enabled; break;
          default: throw Error('Unavailable command: '+name);
        }
        draft.revision++;
        validateTransition(current,draft);
        const next=await seal(draft);
        await adapter.compareAndSwap(current,next);
        publish(next); return true;
      });
    }
    return Object.freeze({
      get revision(){return current ? current.revision : null;},
      get ready(){return !!current;}, get maintenance(){return !current || current.maintenance;},
      read, isArchivedRecord:archived, isProtectedSession:protectedSession,
      subscribe(fn){listeners.add(fn); return ()=>listeners.delete(fn);},
      execute,
      async open(){return serial(async()=>{const e=await adapter.read(); if(e){await verify(e); publish(e);} return !!e;});},
      async activateSynthetic(rawSnapshot, reportSources) {
        return serial(async()=>{
          if (current || await adapter.read()) throw Error('Preview already initialized; archive cannot be replaced');
          const raw=JSON.parse(rawSnapshot);
          if (raw.syntheticOnly !== true) throw Error('Only explicitly fabricated fixtures are allowed in Slice 1');
          const originals=Object.fromEntries([...collections,'settings','receipts'].map(k=>[k,clone(raw[k])]));
          validateShape(originals);
          const archive={id:crypto.randomUUID(),rawSnapshot,rawHash:await hash(rawSnapshot), originals,
            manifest:manifests(originals), activatedAt:new Date().toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,
            reportSources:clone(reportSources || {}),sourceCommit:'a5f7394116479974af347d1540a255681fab515c'};
          const next=await seal({schema:1,revision:0,maintenance:false,archive,working:clone(originals),finalized:{},events:[]});
          await verify(next); await adapter.compareAndSwap(null,next); publish(next); return true;
        });
      },
      snapshot(){requireReady();return freeze(clone(current));},
      async exportEvidence(){requireReady(); await verify(current); return JSON.stringify(current,null,2);}
    });
  }
  App.Repository = Object.freeze({create,indexedDBAdapter,canonical});
  App.repository = create(indexedDBAdapter());
})();
