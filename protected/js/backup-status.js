/* ============================================================
   Tutoring Tracker Pro — Backup safety net (audit 2026-09-19, phase 1)
   Bookkeeping only. Nothing here reads, changes or uploads a record, and nothing is added to the
   protected store: the two values below are per-device UI keys in localStorage, the same pattern
   as the split-visibility preference in app-core.js.
   ============================================================ */
(function () {
  'use strict';
  const App = window.App;

  const META_KEY = 'tutoring-backup-meta';      // {"revision": 123, "date": "<ISO time of the last backup>"}
  const SNOOZE_KEY = 'tutoring-backup-snooze';  // {"until": "<ISO time>", "shownOn": "YYYY-MM-DD"}
  const AMBER_DAYS = 7;
  const AMBER_CHANGES = 10;
  const DAY_MS = 24 * 60 * 60 * 1000;

  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  const localDay = (ms) => {
    const d = new Date(ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  /** Accept only a well-formed record; anything else counts as "never backed up". */
  function cleanMeta(meta, nowMs) {
    if (!meta || typeof meta !== 'object' || !Number.isSafeInteger(meta.revision) || meta.revision < 0 || typeof meta.date !== 'string') return null;
    const at = Date.parse(meta.date);
    if (!Number.isFinite(at) || at > nowMs + DAY_MS) return null;
    return { revision: meta.revision, at };
  }

  /**
   * PURE. What the header pill should say.
   *   meta      last-backup record from localStorage (or null / garbage)
   *   revision  current protected revision, or null while records are not open
   *   nowMs     current time in ms
   * Returns { level: 'hidden' | 'ok' | 'amber', days, changes, label (pill), message (banner), title (tooltip) }.
   * Amber at AMBER_DAYS days or AMBER_CHANGES saved changes since the last backup, whichever comes first.
   */
  function backupState(meta, revision, nowMs) {
    if (!Number.isSafeInteger(revision) || revision < 0) return { level: 'hidden', days: null, changes: null, label: '', message: '', title: '' };
    const click = ' Click to download a backup now.';
    const last = cleanMeta(meta, nowMs);
    if (!last) {
      const message = 'No backup has been downloaded from this browser yet: ' + plural(revision, 'saved change') + ' so far.';
      return { level: revision >= AMBER_CHANGES ? 'amber' : 'ok', days: null, changes: revision,
        label: 'never / ' + plural(revision, 'change'), message, title: message + click };
    }
    // A revision lower than the backed-up one means different records were restored here: the old bookkeeping no longer applies.
    if (revision < last.revision) {
      const message = 'These records are not the ones last backed up from this browser.';
      return { level: 'amber', days: null, changes: null, label: 'check', message, title: message + click };
    }
    const days = Math.max(0, Math.floor((nowMs - last.at) / DAY_MS));
    const changes = revision - last.revision;
    const level = days >= AMBER_DAYS || changes >= AMBER_CHANGES ? 'amber' : 'ok';
    const message = 'Last backup ' + (days === 0 ? 'today' : plural(days, 'day') + ' ago') + ', ' + plural(changes, 'saved change') + ' since.' +
      (level === 'amber' ? ' Time to back up.' : '');
    return { level, days, changes, label: (days === 0 ? 'today' : days + 'd') + ' / ' + plural(changes, 'change'), message, title: message + click };
  }

  /** PURE. The reminder banner appears only when amber, not snoozed, and not already shown today. */
  function bannerDue(state, snooze, nowMs) {
    if (!state || state.level !== 'amber') return false;
    const until = snooze && typeof snooze.until === 'string' ? Date.parse(snooze.until) : NaN;
    if (Number.isFinite(until) && nowMs < until) return false;
    return !(snooze && snooze.shownOn === localDay(nowMs));
  }

  /** PURE. tutor-tracker-recovery-YYYY-MM-DD-rNNN.json (live site) / synthetic-protected-backup-...json (preview). */
  function backupFilename(nowMs, revision, production) {
    const tag = localDay(nowMs) + '-r' + String(Number.isSafeInteger(revision) && revision >= 0 ? revision : 0).padStart(3, '0');
    return (production ? 'tutor-tracker-recovery-' : 'synthetic-protected-backup-') + tag + '.json';
  }

  function readJSON(key) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function readMeta() { return readJSON(META_KEY); }
  function readSnooze() { return readJSON(SNOOZE_KEY); }

  /** A backup of `revision` was just downloaded. */
  function recordBackup(revision, nowMs) {
    try { localStorage.setItem(META_KEY, JSON.stringify({ revision, date: new Date(nowMs).toISOString() })); } catch (e) { /* private mode: pill stays honest, just not persisted */ }
    try { localStorage.removeItem(SNOOZE_KEY); } catch (e) { /* ignore */ }
  }
  /** "Remind me later": 24 hours. */
  function snooze(nowMs) {
    const next = { ...(readSnooze() || {}), until: new Date(nowMs + DAY_MS).toISOString() };
    try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
  }
  /** The banner was put on screen: at most once per calendar day. */
  function markShown(nowMs) {
    const next = { ...(readSnooze() || {}), shownOn: localDay(nowMs) };
    try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
  }

  /** Ask the browser not to evict this site's storage. Feature-detected; every failure is silent. */
  function requestPersistence() {
    try {
      if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.persist === 'function') {
        return Promise.resolve(navigator.storage.persist()).then((granted) => granted === true, () => false);
      }
    } catch (e) { /* fall through */ }
    return Promise.resolve(false);
  }

  App.backupStatus = Object.freeze({
    AMBER_DAYS, AMBER_CHANGES, backupState, bannerDue, backupFilename,
    readMeta, readSnooze, recordBackup, snooze, markShown, requestPersistence,
  });
})();
