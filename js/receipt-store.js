/* ============================================================
   Tutoring Tracker Pro — Receipt Store
   IndexedDB persistence for receipt images.

   Receipts are base64 data URLs and by far the largest thing the app
   stores. localStorage caps around 5 MB per origin, so keeping them there
   meant every save eventually failed once enough receipts were attached.
   IndexedDB has no practical ceiling for this app's volumes.

   Only app-core.js talks to this module. Everything else keeps reading
   the in-memory App.state.receipts map exactly as before.
   ============================================================ */
(function () {
  'use strict';

  const App = window.App;

  const DB_NAME = 'tutor-tracker';
  const DB_VERSION = 1;
  const STORE = 'receipts'; // key: expense id, value: data URL string

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        // Another tab upgraded the schema: drop our handle so the next call reopens.
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
    });
    // A failed open must not poison every later call — allow a retry.
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  }

  /** Read every receipt as { expenseId: dataUrl }. Non-string values are skipped. */
  async function readAll() {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const out = {};
    await new Promise((resolve, reject) => {
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) { resolve(); return; }
        if (typeof cursor.value === 'string' && cursor.value) out[String(cursor.key)] = cursor.value;
        cursor.continue();
      };
      req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
    });
    await txDone(tx);
    return out;
  }

  /**
   * Replace the whole store with `map` in ONE transaction (atomic: either the
   * new set is fully written or the old set is untouched). The entries are
   * snapshotted synchronously so mutations made while the write is in flight
   * cannot produce a half-old, half-new result.
   */
  async function writeAll(map) {
    const entries = Object.keys(map || {})
      .map((k) => [k, map[k]])
      .filter(([, v]) => typeof v === 'string' && v);
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.clear();
    entries.forEach(([k, v]) => { store.put(v, k); });
    await txDone(tx);
  }

  App.receiptStore = { readAll, writeAll };

})();
