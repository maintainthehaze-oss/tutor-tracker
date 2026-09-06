/* One validated writer. Production activation only reads original legacy stores. */
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
  function validateEnvelope(e, allowLegacy = false) {
    if (!e || (e.schema !== 2 && !(allowLegacy && e.schema === 1)) || !Number.isSafeInteger(e.revision) || e.revision < 0 ||
        typeof e.maintenance !== 'boolean' || !e.archive || typeof e.archive.id !== 'string' ||
        !e.finalized || !Array.isArray(e.events)) throw Error('Invalid protected store');
    if (!e.finalized || typeof e.finalized !== 'object' || Array.isArray(e.finalized) ||
        typeof e.archive.rawSnapshot !== 'string' || typeof e.archive.rawHash !== 'string' ||
        !e.archive.reportSources || typeof e.archive.reportSources !== 'object' || Array.isArray(e.archive.reportSources)) throw Error('Invalid protected evidence');
    validateShape(e.working);
    validateShape(e.archive.originals);
    if (!equal(e.archive.manifest, manifests(e.archive.originals))) throw Error('Archive manifest mismatch');
    const raw = JSON.parse(e.archive.rawSnapshot);
    if (productionMode() && raw.format !== LEGACY_FORMAT) throw Error('Production requires captured legacy evidence');
    const source = raw.format === LEGACY_FORMAT ? legacyOriginals(raw) : raw;
    if (raw.format !== LEGACY_FORMAT && raw.syntheticOnly !== true) throw Error('Unrecognized activation evidence');
    for (const k of [...collections, 'settings', 'receipts']) {
      if (!equal(source[k], e.archive.originals[k])) throw Error('Archive raw snapshot mismatch');
    }
    for (const k of ['sessions', 'expenses', 'taxPayments', 'historical']) unchangedRows(e.archive.originals[k], e.working[k], k);
    if (!equal(e.working.historical, e.archive.originals.historical)) throw Error('Historical collection is read-only');
    for (const [k,v] of Object.entries(e.archive.originals.receipts)) {
      if (!Object.hasOwn(e.working.receipts,k) || !equal(v,e.working.receipts[k])) throw Error('Protected receipt: ' + k);
    }
    Object.entries(e.finalized).forEach(([id, value]) => {
      if (!value || !value.record || !Array.isArray(value.clients) || !value.settings || typeof value.settings !== 'object' || Array.isArray(value.settings)) throw Error('Invalid finalization evidence');
      index(value.clients);
      if (!['completed','cancelled','no-show'].includes(value.record.status) || Object.hasOwn(e.archive.manifest.sessions,id)) throw Error('Invalid finalized session status or archived identity');
      if (id !== P.key(value.record.id)) throw Error('Finalized identity mismatch');
      unchangedRows([value.record], e.working.sessions, 'finalized session');
    });
    const workingClients = index(e.working.clients);
    e.archive.originals.clients.forEach(c => {
      const updated = workingClients[P.key(c.id)];
      if (!updated) throw Error('Archived client missing');
      Object.keys(c).filter(k => /company|split/i.test(k)).forEach(k => {
        if (!Object.hasOwn(updated,k) || !equal(c[k],updated[k])) throw Error('Protected client company metadata');
      });
    });
    index(e.events);
    const sessions = index(e.working.sessions), payments = new Set();
    e.events.forEach(event => {
      const key = P.key(event.sessionId), session = sessions[key];
      if (event.type !== 'payment' || !session || session.status !== 'completed' ||
          Object.hasOwn(e.archive.manifest.sessions,key) || !Object.hasOwn(e.finalized,key) ||
          typeof event.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(event.date) ||
          typeof event.recordedAt !== 'string' || !Number.isFinite(Date.parse(event.recordedAt)) || payments.has(key)) throw Error('Invalid or conflicting payment event');
      payments.add(key);
    });
    e.working.sessions.forEach(row => {
      if (!Object.hasOwn(e.archive.manifest.sessions,P.key(row.id))) {
        if (Object.hasOwn(e.archive.manifest.historical,P.key(row.id))) throw Error('Historical session identity is reserved');
        if (!['scheduled','completed','cancelled','no-show'].includes(row.status) ||
            typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
            !Number.isFinite(Number(row.duration)) || Number(row.duration)<=0 ||
            !Number.isFinite(Number(row.amount)) || Number(row.amount)<0 ||
            !Array.isArray(row.clientIds) || !row.clientIds.length ||
            row.companyAmount !== 0 || row.companySplit !== 0) throw Error('Invalid new session or nonzero company share');
        row.clientIds.forEach(P.key);
        if (row.status !== 'scheduled' && !Object.hasOwn(e.finalized,P.key(row.id))) throw Error('Finalization evidence missing');
      }
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
  async function verify(e, allowLegacy = false) {
    validateEnvelope(e, allowLegacy);
    if (e.archive.rawHash !== await hash(e.archive.rawSnapshot)) throw Error('Raw archive hash mismatch');
    if (e.integrity !== (await seal(e)).integrity) throw Error('Protected store integrity mismatch');
  }
  const PORTABLE_FORMAT = 'tutor-tracker-protected-portable';
  function rejectConnections(value, path = 'snapshot') {
    if (!value || typeof value !== 'object') return;
    if (value.format === LEGACY_FORMAT) {
      // Typed evidence and storage entry pairs are not ordinary JSON property
      // trees. Inspect their decoded values/names without rewriting evidence.
      legacyOriginals(value);
      value.receipts.rows.forEach((row,i)=>rejectConnections(decodeLegacy(row.value),path+'.receipts['+i+']'));
      value.localStorage.forEach(([key,raw])=>rejectConnections({[key.slice('tutoring-'.length)]:raw},path+'.localStorage'));
    }
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g,'');
      if (/^(gist(id|token|url|version)?|github(token|pat|connection)|token|accesstoken|refreshtoken|authtoken|authorization|apikey|apisecret|clientsecret|password|passwd|credentials?|connection(metadata)?|syncconnection|privatekey|secret|orsapikey|apitoken|bearertoken|githubaccesstoken|personalaccesstoken|syncgistid|synctoken|gistconnection)$/.test(normalized) &&
          child !== null && child !== '' && child !== false && !(Array.isArray(child) && !child.length) && !(child && typeof child === 'object' && !Object.keys(child).length)) {
        throw Error('Portable backup contains connection or credential field: ' + path + '.' + key + '. Keep connection data in the separate local connection adapter; immutable evidence cannot be redacted.');
      }
      if (child && typeof child === 'object') rejectConnections(child,path+'.'+key);
      // Historical raw JSON is evidence too. Inspect embedded JSON without rewriting its bytes.
      if (typeof child === 'string' && /^[\s]*[\[{]/.test(child)) {
        let parsed; try { parsed = JSON.parse(child); } catch (_) { continue; }
        rejectConnections(parsed,path+'.'+key+'(JSON)');
      }
    }
  }
  async function pack(snapshot) {
    await verify(snapshot); rejectConnections(snapshot);
    return JSON.stringify({format:PORTABLE_FORMAT,version:1,snapshot:clone(snapshot),digest:await hash(snapshot)},null,2);
  }
  async function inspectPortable(text) {
    if (typeof text !== 'string') throw Error('Choose a portable JSON backup');
    let wrapper; try { wrapper=JSON.parse(text); } catch (_) { throw Error('Portable backup is not valid JSON'); }
    if (!wrapper || wrapper.format !== PORTABLE_FORMAT || wrapper.version !== 1 || !wrapper.snapshot || wrapper.snapshot.schema !== 2) {
      throw Error('A versioned protected schema-2 portable backup is required. Open the protected local preview with this reader and export a new portable backup; old/unprotected backups cannot be imported.');
    }
    if (!equal(Object.keys(wrapper).sort(),['digest','format','snapshot','version'])) throw Error('Unexpected portable wrapper fields');
    rejectConnections(wrapper);
    await verify(wrapper.snapshot);
    if (wrapper.digest !== await hash(wrapper.snapshot)) throw Error('Portable digest mismatch');
    return freeze(clone(wrapper.snapshot));
  }
  async function inspectPrivateRecovery(text) {
    let wrapper; try {wrapper=JSON.parse(text);} catch (_) {throw Error('Private recovery is not valid JSON');}
    if (!wrapper || wrapper.format!=='tutor-tracker-private-recovery-v1' || !equal(Object.keys(wrapper).sort(),['format','snapshot'])) throw Error('Choose a private protected recovery file');
    await verify(wrapper.snapshot); return freeze(clone(wrapper.snapshot));
  }
  function unionRows(local, incoming, label) {
    const out=clone(local), lookup=index(out);
    incoming.forEach(row=>{
      const id=P.key(row.id);
      if (Object.hasOwn(lookup,id)) { if (!equal(lookup[id],row)) throw Error('Conflict in '+label+': '+id); }
      else { out.push(clone(row)); lookup[id]=row; }
    });
    return out;
  }
  function unionMap(local,incoming,label) {
    const out=clone(local);
    Object.entries(incoming).forEach(([id,value])=>{
      if (Object.hasOwn(out,id) && !equal(out[id],value)) throw Error('Conflict in '+label+': '+id);
      Object.defineProperty(out,id,{value:clone(value),enumerable:true,writable:true,configurable:true});
    }); return out;
  }
  async function reconcileSnapshots(local,incoming) {
    if (!equal(local.archive,incoming.archive)) throw Error('Archive conflict: restore into a fresh preview or use a backup from this exact archive');
    if (!equal(local.working.settings,incoming.working.settings)) throw Error('Settings conflict: choose matching settings before reconciliation');
    const next=clone(local);
    collections.forEach(k=>{next.working[k]=unionRows(local.working[k],incoming.working[k],k);});
    next.working.receipts=unionMap(local.working.receipts,incoming.working.receipts,'receipts');
    next.finalized=unionMap(local.finalized,incoming.finalized,'finalizations');
    next.events=unionRows(local.events,incoming.events,'payment events');
    next.revision=local.revision+1;
    validateTransition(local,next);
    return seal(next);
  }
  async function reconcilePortable(localText,remoteText) {
    const local=await inspectPortable(localText), incoming=await inspectPortable(remoteText);
    if (local.maintenance || incoming.maintenance) throw Error('Maintenance mode: reconciliation is read-only');
    return pack(await reconcileSnapshots(local,incoming));
  }
  const LEGACY_FORMAT = 'tutor-tracker-legacy-capture-v1';
  function productionMode() {
    return location.origin === 'https://maintainthehaze-oss.github.io' && /^\/tutor-tracker\//.test(location.pathname);
  }
  function localOnly() {
    if (!productionMode() && !['localhost','127.0.0.1','[::1]'].includes(location.hostname)) throw Error('This build is restricted to the tracker production path or localhost');
  }
  // JSON-safe, explicitly typed evidence. Unsupported structured-clone values fail
  // closed instead of being dropped by JSON.stringify or the old receipt reader.
  function encodeLegacy(value, seen = new Set()) {
    if (value === null) return ['null'];
    if (typeof value === 'string' || typeof value === 'boolean') return [typeof value,value];
    if (typeof value === 'number' && Number.isFinite(value)) return ['number',Object.is(value,-0)?'-0':String(value)];
    if (typeof value !== 'object' || seen.has(value)) throw Error('Unsupported legacy receipt value');
    seen.add(value);
    let result;
    const tag=Object.prototype.toString.call(value);
    if (tag === '[object Date]' && Number.isFinite(value.getTime())) result=['date',value.toISOString()];
    else if (tag === '[object ArrayBuffer]') result=['bytes',Array.from(new Uint8Array(value))];
    else if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) throw Error('Unsupported sparse legacy receipt array');
      result=['array',value.map(v=>encodeLegacy(v,seen))];
    } else if (tag === '[object Object]' && (Object.getPrototypeOf(value) === null || Object.getPrototypeOf(Object.getPrototypeOf(value)) === null)) {
      if (Object.getOwnPropertySymbols(value).length) throw Error('Unsupported legacy receipt symbols');
      result=['object',Object.keys(value).sort().map(k=>[k,encodeLegacy(value[k],seen)])];
    } else throw Error('Unsupported legacy receipt type: '+tag);
    // JSON has no alias identity: repeated references must stop capture too.
    return result;
  }
  function decodeLegacy(encoded, key = false) {
    if (!Array.isArray(encoded) || typeof encoded[0] !== 'string') throw Error('Invalid typed receipt evidence');
    const [tag,value]=encoded;
    let result;
    if (tag === 'null' && encoded.length === 1 && !key) result=null;
    else if (encoded.length !== 2) throw Error('Invalid typed receipt evidence');
    else if (tag === 'string' && typeof value === 'string') result=value;
    else if (tag === 'boolean' && typeof value === 'boolean' && !key) result=value;
    else if (tag === 'number' && typeof value === 'string' && Number.isFinite(Number(value)) && (String(Number(value))===value || value==='-0')) result=Number(value);
    else if (tag === 'date' && typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value) result=new Date(value);
    else if (tag === 'bytes' && Array.isArray(value) && value.every(n=>Number.isInteger(n)&&n>=0&&n<=255)) result=new Uint8Array(value).buffer;
    else if (tag === 'array' && Array.isArray(value)) result=value.map(v=>decodeLegacy(v,key));
    else if (tag === 'object' && !key && Array.isArray(value)) {
      result=Object.create(null);
      for (const pair of value) {
        if (!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||Object.hasOwn(result,pair[0])) throw Error('Invalid typed object evidence');
        result[pair[0]]=decodeLegacy(pair[1]);
      }
    } else throw Error('Invalid typed receipt evidence');
    if (!equal(encodeLegacy(result),encoded)) throw Error('Noncanonical typed receipt evidence');
    return result;
  }
  function legacyOriginals(capture) {
    if (!capture || capture.format!==LEGACY_FORMAT || !Array.isArray(capture.localStorage) || !capture.receipts ||
        typeof capture.receipts.databasePresent!=='boolean' || typeof capture.receipts.storePresent!=='boolean' || !Array.isArray(capture.receipts.rows) ||
        (!capture.receipts.databasePresent && capture.receipts.storePresent) || (!capture.receipts.storePresent && capture.receipts.rows.length)) throw Error('Invalid legacy capture');
    const stores=Object.create(null);
    for (const entry of capture.localStorage) {
      if (!Array.isArray(entry)||entry.length!==2||typeof entry[0]!=='string'||!entry[0].startsWith('tutoring-')||typeof entry[1]!=='string'||Object.hasOwn(stores,entry[0])) throw Error('Invalid raw storage evidence');
      stores[entry[0]]=entry[1];
    }
    const parse=(key,fallback)=>Object.hasOwn(stores,key)?JSON.parse(stores[key]):fallback;
    const originals=Object.fromEntries(collections.map(k=>[k,parse('tutoring-'+(k==='taxPayments'?'tax-payments':k),[])]));
    originals.settings=parse('tutoring-settings',{});
    originals.receipts=parse('tutoring-receipts',{});
    validateShape(originals);
    const keys=new Set();
    for (const row of capture.receipts.rows) {
      if (!row || !equal(Object.keys(row).sort(),['displayKey','key','value']) || typeof row.displayKey!=='string') throw Error('Invalid receipt row');
      const key=decodeLegacy(row.key,true), value=decodeLegacy(row.value), stamp=canonical(row.key);
      if ((typeof key==='string'||typeof key==='number') && row.displayKey!==String(key)) throw Error('Receipt display identity mismatch');
      if (keys.has(stamp)) throw Error('Duplicate typed receipt key');
      keys.add(stamp);
      // Preserve legacy display precedence, while retaining every source row above.
      if (typeof value==='string' && value) Object.defineProperty(originals.receipts,row.displayKey,{value,enumerable:true,writable:true,configurable:true});
    }
    return originals;
  }
  async function captureLegacy() {
    localOnly();
    const entries=[];
    for (let i=0;i<localStorage.length;i++) {
      const key=localStorage.key(i);
      if (key && key.startsWith('tutoring-')) entries.push([key,localStorage.getItem(key)]);
    }
    entries.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
    if (typeof indexedDB.databases!=='function') throw Error('This browser cannot inspect legacy storage without creating it');
    const exists=(await indexedDB.databases()).some(db=>db.name==='tutor-tracker');
    const receipts={databasePresent:exists,storePresent:false,rows:[]};
    if (exists) await new Promise((resolve,reject)=>{
      const req=indexedDB.open('tutor-tracker');
      req.onupgradeneeded=()=>{req.transaction.abort();reject(Error('Legacy database changed during capture'));};
      req.onerror=()=>reject(req.error||Error('Legacy receipt database unavailable'));
      req.onblocked=()=>reject(Error('Legacy receipt database is blocked'));
      req.onsuccess=()=>{
        const db=req.result;
        if (!db.objectStoreNames.contains('receipts')) {db.close();resolve();return;}
        receipts.storePresent=true;
        const tx=db.transaction('receipts','readonly'), cursor=tx.objectStore('receipts').openCursor();
        let failure;
        cursor.onsuccess=()=>{
          const row=cursor.result;if(!row)return;
          try {receipts.rows.push({key:encodeLegacy(row.key),displayKey:String(row.key),value:encodeLegacy(row.value)});row.continue();}
          catch(error){failure=error;tx.abort();}
        };
        tx.oncomplete=()=>{db.close();resolve();};
        tx.onabort=tx.onerror=()=>{db.close();reject(failure||tx.error||Error('Legacy receipt read failed'));};
      };
    });
    return {format:LEGACY_FORMAT,localStorage:entries,receipts};
  }
  function indexedDBAdapter(slot = 'active') {
    if (slot !== 'active') checkSlot(slot);
    let dbPromise;
    function db() {
      localOnly();
      if (!dbPromise) dbPromise = new Promise((resolve,reject) => {
        const req = indexedDB.open(productionMode()?'tutor-tracker-protected-production':'tutor-tracker-slice1-preview', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('repository');
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(Error('Another preview tab blocks storage'));
        req.onsuccess = () => { req.result.onversionchange = () => { req.result.close(); dbPromise = null; }; resolve(req.result); };
      }).catch(e => { dbPromise = null; throw e; });
      return dbPromise;
    }
    return Object.freeze({
      slotAdapter(name) { checkSlot(name); return indexedDBAdapter(name); },
      async read() {
        const database = await db();
        return new Promise((resolve,reject) => {
          const tx = database.transaction('repository', 'readonly');
          const req = tx.objectStore('repository').get(slot);
          tx.oncomplete = () => resolve(req.result || null);
          tx.onabort = tx.onerror = () => reject(tx.error || Error('Read failed'));
        });
      },
      async compareAndSwap(expected, next, expectedActiveStamp) {
        expected=clone(expected); next=clone(next);
        const guard=expectedActiveStamp === undefined ? undefined : clone(expectedActiveStamp);
        if (guard !== undefined && slot !== 'slice4-remote') throw Error('Active guard is only available for the rehearsal mirror');
        const database = await db();
        return new Promise((resolve,reject) => {
          const tx = database.transaction('repository', 'readwrite');
          const store = tx.objectStore('repository');
          let conflict;
          const req = store.get(slot);
          req.onsuccess = () => {
            const actual = req.result || null;
            if (slot !== 'active' ? !equal(actual, expected) : ((actual && actual.integrity) !== (expected && expected.integrity) ||
                (actual && actual.revision) !== (expected && expected.revision))) {
              conflict = Error('Another tab changed the store. Reload before trying again.'); tx.abort(); return;
            }
            function write() {
              // Active guard and mirror write share this readwrite transaction, so another
              // tab cannot enable maintenance or change records between the check and write.
              try { store.put(next, slot); }
              catch(error) { conflict=error; tx.abort(); }
            }
            if (guard !== undefined) {
              const activeRequest=store.get('active');
              activeRequest.onsuccess=()=>{
                try { assertActiveStamp(activeRequest.result || null,guard); write(); }
                catch(error) { conflict=error; tx.abort(); }
              };
            } else write();
          };
          tx.oncomplete = () => resolve(true);
          tx.onabort = tx.onerror = () => reject(conflict || tx.error || Error('Save failed'));
        });
      }
    });
  }
  function assertActiveStamp(active,stamp) {
    if (!stamp || !Number.isSafeInteger(stamp.revision) || typeof stamp.integrity !== 'string' ||
        !active || active.schema !== 2 || active.maintenance || active.revision !== stamp.revision || active.integrity !== stamp.integrity) {
      throw Error('Stale sync stage or maintenance mode: records changed before the mirror write. Stage again.');
    }
  }
  function checkSlot(slot) {
    if (!['slice4-connection','slice4-remote'].includes(slot)) throw Error('Unavailable auxiliary slot');
  }
  function create(adapter, options = {}) {
    let current = null;
    const stages = new Map(), auxiliary = new Map();
    const activationStages = new Map();
    async function stableCapture() {
      const capture=options.captureLegacy || captureLegacy;
      const first=clone(await capture()), second=clone(await capture());
      if (!equal(first,second)) throw Error('Legacy records changed during capture. Stage again.');
      legacyOriginals(first); return first;
    }
    async function guardFreshImport(expected, incoming, stagedCapture) {
      if (expected || !productionMode()) return null;
      const capture=await stableCapture();
      if (stagedCapture !== undefined && !equal(capture,stagedCapture)) throw Error('Legacy records changed after recovery staging. Stage again.');
      if ((capture.localStorage.length || capture.receipts.rows.length) && !equal(JSON.parse(incoming.archive.rawSnapshot),capture)) {
        throw Error('Recovery archive does not match this device\'s existing legacy records. Preserve and activate those records first.');
      }
      return capture;
    }
    let queue = Promise.resolve();
    const listeners = new Set();
    const serial = fn => { const task = queue.then(fn); queue = task.catch(() => {}); return task; };
    function publish(value) { current = freeze(clone(value)); listeners.forEach(fn => { try { fn(); } catch(error) { console.error('Saved, but a view refresh failed',error); } }); }
    async function persist(expected,next) {
      if (await adapter.compareAndSwap(expected,next) === false) throw Error('CAS conflict: another writer changed the store');
    }
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
        await persist(current,next);
        publish(next); return true;
      });
    }
    async function assertCurrent(expected) {
      if (!equal(current,expected)) throw Error('Stale stage: local records changed. Stage again.');
      const durable=await adapter.read();
      if (!equal(durable || null,expected)) throw Error('Another tab changed the store. Reload and stage again.');
      if (durable) await verify(durable);
    }
    async function assertPortableStage(id) {
      const stage=stages.get(id);
      if (!stage) throw Error('Stage expired or already used. Stage again.');
      if (stage.privateRecovery) throw Error('Private recovery evidence cannot be synchronized');
      await assertCurrent(stage.expected);
      if (current && current.maintenance) throw Error('Maintenance mode: imports and sync writes are read-only');
      return true;
    }
    return Object.freeze({
      get revision(){return current ? current.revision : null;},
      get ready(){return !!current;}, get maintenance(){return !current || current.maintenance;},
      read, isArchivedRecord:archived, isProtectedSession:protectedSession,
      subscribe(fn){listeners.add(fn); return ()=>listeners.delete(fn);},
      execute, inspectPortable, reconcilePortable, assertPortableStage,
      async portableStageGuard(id) {
        await assertPortableStage(id);
        const stage=stages.get(id);
        if (!stage || !stage.expected) throw Error('An initialized writable preview is required for a mirror write');
        return freeze({revision:stage.expected.revision,integrity:stage.expected.integrity});
      },
      slotAdapter(slot) {
        checkSlot(slot);
        if (adapter.slotAdapter) return adapter.slotAdapter(slot);
        if (!auxiliary.has(slot)) {
          let value=null;
          auxiliary.set(slot,Object.freeze({read:async()=>clone(value),compareAndSwap:async(expected,next,expectedActiveStamp)=>{
            expected=clone(expected); next=clone(next);
            if (expectedActiveStamp !== undefined) {
              if (slot !== 'slice4-remote') throw Error('Active guard is only available for the rehearsal mirror');
              const guard=clone(expectedActiveStamp);
              assertActiveStamp(await adapter.read(),guard);
            }
            if (!equal(value,expected)) throw Error('Auxiliary connection changed; retry');
            value=clone(next); return true;
          }}));
        }
        return auxiliary.get(slot);
      },
      async exportPortable() { requireReady(); const expected=current; await assertCurrent(expected); return pack(expected); },
      async exportPrivateRecovery() {
        requireReady(); const expected=current; await assertCurrent(expected); await verify(expected);
        return JSON.stringify({format:'tutor-tracker-private-recovery-v1',snapshot:expected},null,2);
      },
      async stagePrivateRecovery(text) {
        return serial(async()=>{
          const expected=current; await assertCurrent(expected);
          if (expected && expected.maintenance) throw Error('Maintenance mode: imports and sync writes are read-only');
          const incoming=await inspectPrivateRecovery(text), next=expected?await reconcileSnapshots(expected,incoming):incoming;
          const legacyCapture=await guardFreshImport(expected,incoming);
          await assertCurrent(expected);
          const id=crypto.randomUUID();
          while (stages.size>=20) stages.delete(stages.keys().next().value);
          stages.set(id,{expected:clone(expected),text,next:clone(next),privateRecovery:true,legacyCapture});
          return freeze({id,summary:{mode:expected?'Compatible private merge':'Private recovery',archiveId:incoming.archive.id,
            current:Object.fromEntries(collections.map(k=>[k,expected?expected.working[k].length:0])),
            added:Object.fromEntries(collections.map(k=>[k,next.working[k].length-(expected?expected.working[k].length:0)])),
            receiptsAdded:Object.keys(next.working.receipts).length-(expected?Object.keys(expected.working.receipts).length:0),
            finalizationsAdded:Object.keys(next.finalized).length-(expected?Object.keys(expected.finalized).length:0),
            paymentEventsAdded:next.events.length-(expected?expected.events.length:0),maintenance:next.maintenance}});
        });
      },
      async stagePortable(text) {
        return serial(async()=>{
          const expected=current;
          await assertCurrent(expected);
          if (expected && expected.maintenance) throw Error('Maintenance mode: imports and sync writes are read-only');
          const incoming=await inspectPortable(text);
          const next=expected ? await reconcileSnapshots(expected,incoming) : incoming;
          const legacyCapture=await guardFreshImport(expected,incoming);
          await assertCurrent(expected);
          const summary={mode:expected?'Compatible merge':'Fresh restore',archiveId:incoming.archive.id,
            current:Object.fromEntries(collections.map(k=>[k,expected?expected.working[k].length:0])),
            added:Object.fromEntries(collections.map(k=>[k,next.working[k].length-(expected?expected.working[k].length:0)])),
            receiptsAdded:Object.keys(next.working.receipts).length-(expected?Object.keys(expected.working.receipts).length:0),
            finalizationsAdded:Object.keys(next.finalized).length-(expected?Object.keys(expected.finalized).length:0),
            paymentEventsAdded:next.events.length-(expected?expected.events.length:0),maintenance:next.maintenance};
          const id=crypto.randomUUID();
          while (stages.size>=20) stages.delete(stages.keys().next().value);
          stages.set(id,{expected:clone(expected),text,next:clone(next),legacyCapture});
          return freeze({id,summary});
        });
      },
      async commitPortable(id) {
        return serial(async()=>{
          const stage=stages.get(id);
          if (!stage) throw Error('Stage expired or already used. Stage again.');
          stages.delete(id); // Every commit attempt consumes its token, including failed CAS/quota writes.
          await assertCurrent(stage.expected);
          if (current && current.maintenance) throw Error('Maintenance mode: imports and sync writes are read-only');
          const incoming=await (stage.privateRecovery?inspectPrivateRecovery:inspectPortable)(stage.text);
          const next=current?await reconcileSnapshots(current,incoming):incoming;
          if (!equal(next,stage.next)) throw Error('Staged content changed');
          await verify(next);
          await guardFreshImport(stage.expected,incoming,stage.legacyCapture);
          await persist(stage.expected,next); publish(next); return true;
        });
      },
      async open(){return serial(async()=>{
        let e=await adapter.read();
        if(e){
          await verify(e,true);
          if(e.schema===1){const next=await seal({...clone(e),schema:2,revision:e.revision+1}); await verify(next); await persist(e,next); e=next;}
          publish(e);
        } else { current=null; }
        stages.clear(); return !!e;
      });},
      async stageLegacyActivation(reportSources = {}) {
        return serial(async()=>{
          if (current || await adapter.read()) throw Error('Protected store already initialized; reopen it');
          const capture=await stableCapture(), rawSnapshot=JSON.stringify(capture), originals=legacyOriginals(capture);
          const archive={id:crypto.randomUUID(),rawSnapshot,rawHash:await hash(rawSnapshot),originals,manifest:manifests(originals),
            activatedAt:new Date().toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,
            reportSources:clone(reportSources),sourceCommit:'a5f7394116479974af347d1540a255681fab515c'};
          const next=await seal({schema:2,revision:0,maintenance:false,archive,working:clone(originals),finalized:{},events:[]});
          await verify(next);
          const recoveryText=JSON.stringify({format:'tutor-tracker-private-recovery-v1',snapshot:next},null,2);
          const id=crypto.randomUUID(); activationStages.clear(); activationStages.set(id,{capture,next});
          return freeze({id,recoveryText,recoveryDigest:await hash(recoveryText),summary:{counts:Object.fromEntries(collections.map(k=>[k,originals[k].length])),
            receiptRows:capture.receipts.rows.length,futureScheduled:originals.sessions.filter(s=>s.status==='scheduled'&&typeof s.date==='string'&&s.date>=[new Date().getFullYear(),String(new Date().getMonth()+1).padStart(2,'0'),String(new Date().getDate()).padStart(2,'0')].join('-')).length}});
        });
      },
      async commitLegacyActivation(id, acknowledgment = {}) {
        return serial(async()=>{
          const stage=activationStages.get(id); activationStages.delete(id);
          if (!stage) throw Error('Activation stage expired; stage again');
          if (acknowledgment.backupAcknowledged !== true) throw Error('Save and verify the private recovery copy before activation');
          if (current || await adapter.read()) throw Error('Protected store already initialized; reopen it');
          if (!equal(stage.capture,await stableCapture())) throw Error('Legacy records changed after backup. Stage again.');
          await verify(stage.next); await persist(null,stage.next);
          const durable=await adapter.read(); await verify(durable);
          if (!equal(durable,stage.next)) throw Error('Activation readback mismatch; reopen to inspect the committed store');
          publish(durable); return true;
        });
      },
      async activateSynthetic(rawSnapshot, reportSources) {
        return serial(async()=>{
          if (productionMode()) throw Error('Fabricated fixture activation is disabled in production');
          if (current || await adapter.read()) throw Error('Preview already initialized; archive cannot be replaced');
          const raw=JSON.parse(rawSnapshot);
          if (raw.syntheticOnly !== true) throw Error('Only explicitly fabricated fixtures are allowed in Slice 1');
          const originals=Object.fromEntries([...collections,'settings','receipts'].map(k=>[k,clone(raw[k])]));
          validateShape(originals);
          const archive={id:crypto.randomUUID(),rawSnapshot,rawHash:await hash(rawSnapshot), originals,
            manifest:manifests(originals), activatedAt:new Date().toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,
            reportSources:clone(reportSources || {}),sourceCommit:'a5f7394116479974af347d1540a255681fab515c'};
          const next=await seal({schema:2,revision:0,maintenance:false,archive,working:clone(originals),finalized:{},events:[]});
          await verify(next); await persist(null,next); publish(next); return true;
        });
      },
      snapshot(){requireReady();return freeze(clone(current));},
      async exportEvidence(){requireReady(); await verify(current); return JSON.stringify(current,null,2);}
    });
  }
  App.Repository = Object.freeze({create,indexedDBAdapter,canonical,inspectPortable,reconcilePortable,productionMode});
  App.repository = create(indexedDBAdapter());
})();
