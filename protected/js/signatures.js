/* ============================================================
   Tutoring Tracker Pro — Session signatures + week planning (PURE)
   What the owner "usually" does per client set, read from the sessions
   already on file, and the pure model behind the "Log a week" grid.
   No DOM, no storage, no App.state reads: every function takes its
   inputs and returns new values. Also the "Usual" quick-pick tiles
   on the session form (usualTiles, Slice C). Loaded after sessions.js (uses
   App.newAmount / App.defaultStatusForDate for money and status).
   ============================================================ */
(function () {
  'use strict';

  const App = window.App;
  const num = App.num;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const COUNTED = ['completed', 'scheduled']; // cancelled / no-show rows are not what he "usually" does

  /** Sorted string ids joined with '+': the identity of a client set ('c1+c2'). */
  function signatureKey(clientIds) {
    return [...new Set((clientIds || []).map(String))].sort().join('+');
  }
  const keyIds = (key) => (key ? key.split('+') : []);

  /** Most frequent value in a list (first seen wins a tie); '' when the list is empty. */
  function mode(values) {
    const counts = new Map();
    let best = '', bestCount = 0;
    values.forEach((v) => {
      const c = (counts.get(v) || 0) + 1;
      counts.set(v, c);
      if (c > bestCount) { best = v; bestCount = c; }
    });
    return best;
  }

  // --- calendar arithmetic on 'YYYY-MM-DD' strings, time-zone free ---
  function dayNum(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
  }
  function isoOf(n) {
    return new Date(n * 86400000).toISOString().slice(0, 10);
  }
  /** 0 = Monday … 6 = Sunday (the grid's column order). */
  function weekdayOf(iso) {
    return (new Date(dayNum(iso) * 86400000).getUTCDay() + 6) % 7;
  }
  /** The Monday that starts the week containing `iso`. */
  function weekStart(iso) {
    return isoOf(dayNum(iso) - weekdayOf(iso));
  }
  /** The seven dates Mon..Sun of the week starting `mondayIso`. */
  function weekDates(mondayIso) {
    const start = dayNum(mondayIso);
    return [0, 1, 2, 3, 4, 5, 6].map((i) => isoOf(start + i));
  }
  const WEEKDAY_LABELS = Object.freeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

  /**
   * PURE. Group sessions by (sorted clientIds, duration, amount, type). Each signature carries how often
   * it happened, when it last happened, its weekday spread and its most common start time. Only sessions
   * dated on/after `since` (optional 'YYYY-MM-DD') and with a counted status are included; sessions
   * referencing no known client are ignored. Sorted most frequent first, then most recent.
   */
  function sessionSignatures(sessions, clients, since) {
    const known = new Set((clients || []).map((c) => String(c.id)));
    const groups = new Map();
    (sessions || []).forEach((s) => {
      if (!s || !COUNTED.includes(s.status) || typeof s.date !== 'string' || !DATE_RE.test(s.date)) return;
      if (since && s.date < since) return;
      const ids = (s.clientIds || []).map(String).filter((id) => known.has(id));
      if (!ids.length) return;
      const key = signatureKey(ids), duration = num(s.duration), amount = num(s.amount), type = s.type || 'in-person';
      const gk = key + '|' + duration + '|' + amount + '|' + type;
      let g = groups.get(gk);
      if (!g) { g = { key, clientIds: keyIds(key), duration, amount, type, count: 0, lastDate: '', weekdays: [0, 0, 0, 0, 0, 0, 0], times: [] }; groups.set(gk, g); }
      g.count += 1;
      if (s.date > g.lastDate) g.lastDate = s.date;
      g.weekdays[weekdayOf(s.date)] += 1;
      g.times.push(s.time || '');
    });
    return [...groups.values()]
      .map((g) => ({ key: g.key, clientIds: g.clientIds, duration: g.duration, amount: g.amount, type: g.type, time: mode(g.times), count: g.count, lastDate: g.lastDate, weekdays: g.weekdays }))
      .sort((a, b) => (b.count - a.count) || b.lastDate.localeCompare(a.lastDate) || a.key.localeCompare(b.key));
  }

  /** PURE. The usual (most frequent, then most recent) signature for one client set, or null. */
  function usualFor(signatures, clientIds) {
    const key = signatureKey(clientIds);
    return (signatures || []).find((sig) => sig.key === key) || null;
  }

  /** PURE. True when any of `clientIds` already has a counted or cancelled/no-show session dated `date`
   *  (same rule as the weekly-slots planner: a client has at most one planned session per day). */
  function loggedOn(sessions, date, clientIds) {
    const ids = (clientIds || []).map(String);
    return (sessions || []).some((s) => s && s.date === date && (s.clientIds || []).some((cid) => ids.includes(String(cid))));
  }

  /** PURE. Average rate of the clients × duration, in whole cents (same rule as the session form). */
  function rateAmount(clientIds, clientsById, duration) {
    const rates = (clientIds || []).map((id) => { const c = clientsById[String(id)]; return c ? num(c.rate) : 0; }).filter((r) => r > 0);
    const avg = rates.length ? rates.reduce((s, r) => s + r, 0) / rates.length : 0;
    return App.newAmount(avg * num(duration), null);
  }

  /**
   * PURE. Rows of the grid, in the order given: one per active client (singles, already ordered by the
   * caller, e.g. App.clientPickerRows), then every multi-client combo seen since `since`, then any extra
   * combo keys (e.g. from the week being repeated) whose members are all known clients. Each row carries
   * its `usual` signature (window first, then all time) and the pre-fill the grid uses when a cell is ticked.
   */
  function weekRows(sessions, orderedActiveClients, allClients, since, extraKeys, defaultDuration) {
    const clientsById = {};
    (allClients || []).forEach((c) => { clientsById[String(c.id)] = c; });
    const recent = sessionSignatures(sessions, allClients, since), allTime = sessionSignatures(sessions, allClients);
    const seen = new Set(), rows = [];
    const add = (ids, combo) => {
      const key = signatureKey(ids);
      if (!key || seen.has(key) || !keyIds(key).every((id) => clientsById[id])) return;
      seen.add(key);
      const usual = usualFor(recent, ids) || usualFor(allTime, ids);
      const duration = usual ? usual.duration : (num(defaultDuration) || 1);
      rows.push({ key, clientIds: keyIds(key), combo, usual,
        label: keyIds(key).map((id) => App.clientName(clientsById[id])).join(' + '),
        prefill: { duration, amount: usual ? App.newAmount(usual.amount, null) : rateAmount(keyIds(key), clientsById, duration), type: usual ? usual.type : 'in-person', time: usual ? usual.time : '' } });
    };
    (orderedActiveClients || []).forEach((c) => add([c.id], false));
    recent.filter((sig) => sig.clientIds.length > 1).forEach((sig) => add(sig.clientIds, true));
    (extraKeys || []).forEach((key) => { if (keyIds(key).length > 1) add(keyIds(key), true); });
    return rows;
  }

  /**
   * PURE. "Repeat last week": the ticks that copy the week BEFORE `dates` (seven Mon..Sun ISO dates) forward
   * by seven days. One tick per (client set, weekday); cancelled / no-show rows, unknown client ids and targets
   * already logged are skipped. Each tick keeps the copied session's duration, amount, type and time (mileage never).
   */
  function repeatLastWeek(sessions, dates, clients) {
    const start = dayNum(dates[0]);
    const known = new Set((clients || []).map((c) => String(c.id)));
    const ticks = [], seen = new Set();
    (sessions || [])
      .filter((s) => s && COUNTED.includes(s.status) && typeof s.date === 'string' && DATE_RE.test(s.date) && dayNum(s.date) >= start - 7 && dayNum(s.date) < start)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''))
      .forEach((s) => {
        const key = signatureKey((s.clientIds || []).filter((id) => known.has(String(id)))), date = isoOf(dayNum(s.date) + 7), id = key + '|' + date;
        if (!key || seen.has(id) || loggedOn(sessions, date, keyIds(key))) return;
        seen.add(id);
        ticks.push({ key, clientIds: keyIds(key), date, duration: num(s.duration), amount: App.newAmount(s.amount, null), type: s.type || 'in-person', time: s.time || '' });
      });
    return ticks;
  }

  /**
   * PURE. State of one cell: 'logged' (a member already has a session that day), 'ticked', 'blocked' (another
   * ticked row shares a member that day), or 'open'. `ticks` is the list of current ticks.
   */
  function cellState(row, date, sessions, ticks) {
    if (loggedOn(sessions, date, row.clientIds)) return 'logged';
    const mine = (ticks || []).find((t) => t.key === row.key && t.date === date);
    if (mine) return 'ticked';
    const clash = (ticks || []).some((t) => t.date === date && t.key !== row.key && t.clientIds.some((id) => row.clientIds.includes(id)));
    return clash ? 'blocked' : 'open';
  }

  /**
   * PURE. Turn ticks into the plain session records `session.saveMany` stores: the same shape saveSession
   * writes (sessions.js), cents via App.newAmount, status from App.defaultStatusForDate, mileage 0, address of
   * the first client, recurring null. `ids` yields one fresh id per record; `now` is an ISO timestamp.
   */
  function buildRecords(ticks, allClients, today, ids, now) {
    const clientsById = {};
    (allClients || []).forEach((c) => { clientsById[String(c.id)] = c; });
    return (ticks || []).map((t) => {
      const clientIds = t.clientIds.map((id) => (clientsById[id] ? clientsById[id].id : id)); // keep each client's own id type
      const primary = clientsById[t.clientIds[0]];
      return {
        id: ids(), date: t.date, time: t.time || '', clientIds, type: t.type || 'in-person',
        duration: num(t.duration), amount: App.newAmount(t.amount, null),
        paid: false, payment: 'unpaid', paymentDate: null,
        status: App.defaultStatusForDate(t.date, today),
        mileage: 0, mileageDetails: '', mileageCalculated: false, mileageManual: false,
        address: primary ? (primary.address || '') : '', notes: '',
        recurring: null, createdAt: now, updatedAt: now,
      };
    });
  }

  /**
   * PURE. The weekday labels a signature "usually" falls on: every day with at least half the busiest day's
   * count, Mon..Sun order. Empty when more than three days qualify (no pattern worth stating) or nothing counted.
   */
  function usualWeekdays(weekdays) {
    const counts = (weekdays || []).map(num);
    const top = Math.max(0, ...counts);
    if (!top) return [];
    const days = WEEKDAY_LABELS.filter((_, i) => counts[i] * 2 >= top);
    return days.length > 3 ? [] : days;
  }

  /**
   * PURE. "Usual" quick-pick tiles for the session form: up to `limit` signatures whose members are all
   * pickable (active) clients, ranked by frequency in the 90 days before `today` (ties: most recent), then
   * by all-time frequency for combos not already listed. Each tile carries the values one tap fills.
   */
  function usualTiles(sessions, clients, today, limit) {
    const max = num(limit) > 0 ? num(limit) : 5;
    const active = new Set((clients || []).filter((c) => c && (c.status || 'active') === 'active').map((c) => String(c.id)));
    const since = typeof today === 'string' && DATE_RE.test(today) ? isoOf(dayNum(today) - 90) : undefined;
    const tileId = (sig) => sig.key + '|' + sig.duration + '|' + sig.amount + '|' + sig.type;
    const seen = new Set(), tiles = [];
    const take = (sig) => {
      if (tiles.length >= max || seen.has(tileId(sig)) || !sig.clientIds.every((id) => active.has(id))) return;
      seen.add(tileId(sig));
      tiles.push({ key: sig.key, clientIds: [...sig.clientIds], duration: sig.duration, amount: App.newAmount(sig.amount, null),
        type: sig.type, time: sig.time, count: sig.count, lastDate: sig.lastDate, weekdays: usualWeekdays(sig.weekdays) });
    };
    sessionSignatures(sessions, clients, since).forEach(take);
    sessionSignatures(sessions, clients).forEach(take);
    return tiles;
  }

  App.sessionSignatures = sessionSignatures;
  App.usualTiles = usualTiles;
  App.weekPlan = Object.freeze({ signatureKey, dayNum, isoOf, weekdayOf, weekStart, weekDates, WEEKDAY_LABELS,
    usualFor, loggedOn, rateAmount, weekRows, repeatLastWeek, cellState, buildRecords, usualWeekdays, usualTiles });
})();
