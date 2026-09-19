/* ============================================================
   Tutoring Tracker Pro — Weekly recurring slots: the planner
   PURE and INERT (recurring-slots design 2026-09-19, slice 2). Nothing calls this yet.
   It reads clients and sessions and RETURNS a plan. It never writes, never reads the clock,
   and never touches the DOM, storage or the repository.

   A slot lives in client.slots[]:
     { id, anchor: 'YYYY-MM-DD', every: 1|2, time: 'HH:MM', duration: <decimal hours>,
       type: 'in-person'|'online'|'hybrid'|'group', with: [clientId...], through: 'YYYY-MM-DD'|null }
   anchor is the first occurrence (the weekday comes from it); through is the last date already planned.
   ============================================================ */
(function () {
  'use strict';

  const App = window.App;
  const DAY_MS = 864e5;
  const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const TYPES = Object.freeze(['in-person', 'online', 'hybrid', 'group']);

  /* Date math is UTC-integer only: a calendar date is a whole number of days. The caller passes `today`
     as the LOCAL calendar date string (the app's own "today" helper). Nothing here reads the clock or
     does local-time arithmetic, so a DST change or a different time zone can never move a date. */
  function isoOf(n) { return new Date(n * DAY_MS).toISOString().slice(0, 10); }
  function dayNum(iso) {
    const m = ISO_RE.exec(typeof iso === 'string' ? iso : '');
    if (!m) return NaN;
    const n = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
    return isoOf(n) === iso ? n : NaN; // 2026-02-31 is not a date
  }
  /** 0 = Sunday ... 6 = Saturday (1970-01-01 was a Thursday). */
  function weekdayOf(n) { return (((n + 4) % 7) + 7) % 7; }

  const isActive = (c) => !!c && (c.status || 'active') === 'active';
  const rowId = (slotId, date) => 'rec:' + slotId + ':' + date;

  /** What the planner wrote, as one string. A row whose stamp no longer matches was edited by hand. */
  function stampOf(row) {
    return [row.time, Number(row.duration), Number(row.amount), row.type, (row.clientIds || []).map(String).join(','), row.address].join('|');
  }

  /** A generated row nobody has touched: still scheduled, not moved, not edited, no notes, no miles, not paid or waived. */
  function isPristine(row) {
    const r = row && row.recurring;
    return !!r && String(row.id) === rowId(r.slotId, r.date) && row.status === 'scheduled' && row.date === r.date &&
      stampOf(row) === r.stamp && !row.notes && App.num(row.mileage) === 0 && !row.paid && row.payment !== 'waived';
  }

  /** '' when the slot is well formed, otherwise the reason in plain words. */
  function slotProblem(slot) {
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)) return 'slot is not an object';
    if (typeof slot.id !== 'string' || !slot.id) return 'slot has no id';
    if (!Number.isFinite(dayNum(slot.anchor))) return 'first session is not a valid date';
    if (slot.every !== 1 && slot.every !== 2) return 'repeat must be weekly or every 2 weeks';
    if (typeof slot.time !== 'string' || !TIME_RE.test(slot.time)) return 'time is not HH:MM';
    if (typeof slot.duration !== 'number' || !Number.isFinite(slot.duration) || slot.duration <= 0) return 'duration must be more than 0';
    if (!TYPES.includes(slot.type)) return 'unknown session type';
    if (slot.with != null && (!Array.isArray(slot.with) || slot.with.some((id) => typeof id !== 'string' && typeof id !== 'number'))) return 'also-attending list is not a list of clients';
    if (slot.through != null && !Number.isFinite(dayNum(slot.through))) return 'planned-through date is not a valid date';
    return '';
  }

  /**
   * The session record this slot produces on `date`: the same fields saveSession builds, minus the
   * timestamps (the writer adds createdAt / updatedAt). Only ACTIVE clients attend; the amount is the
   * AVERAGE positive rate times the duration, in whole cents (the rule in saveSession).
   */
  function expectedRecord(slot, owner, date, clientsById) {
    const listed = [owner.id].concat(slot.with || []).map((id) => clientsById.get(String(id))).filter(isActive);
    const attending = listed.filter((c, i) => listed.findIndex((x) => String(x.id) === String(c.id)) === i);
    const rates = attending.map((c) => App.num(c.rate)).filter((rate) => rate > 0);
    const averageRate = rates.length ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length : 0;
    const record = {
      id: rowId(slot.id, date), date, time: slot.time, clientIds: attending.map((c) => c.id), type: slot.type,
      duration: slot.duration, amount: App.roundCents(averageRate * slot.duration),
      paid: false, payment: 'unpaid', paymentDate: null, status: 'scheduled',
      mileage: 0, mileageDetails: '', mileageCalculated: false, mileageManual: false,
      address: owner.address || '', notes: '',
    };
    return { ...record, recurring: { slotId: slot.id, date, stamp: stampOf(record) } };
  }

  /**
   * Plan one pass. Returns { create, removeIds, clients, skipped, gaps }:
   *   create     session records to add (status scheduled, id rec:<slotId>:<date>)
   *   removeIds  ids of untouched future generated rows to drop (orphaned, paused, or about to be re-created)
   *   clients    [{ id, slots }] for each client whose planned-through watermark moved (the COMPLETE slots array)
   *   skipped    [{ clientId, slotId, date, reason }] malformed slots (date null) and dates left alone because
   *              the client already has a session that day
   *   gaps       [{ clientId, slotId, date }] occurrences that passed while nothing was planning. Never back-filled.
   * Feeding the result back in (rows added, rows removed, slots replaced) plans nothing further.
   */
  function materializeRecurring(clients, sessions, today, horizon = 28) {
    const todayNum = dayNum(today);
    if (!Number.isFinite(todayNum) || !Number.isInteger(horizon) || horizon < 1) throw new Error('Recurring plan needs today as YYYY-MM-DD and a whole number of days');
    const allClients = Array.isArray(clients) ? clients : [], allSessions = Array.isArray(sessions) ? sessions : [];
    const create = [], removeIds = [], marks = [], skipped = [], gaps = [];
    const clientsById = new Map(allClients.map((c) => [String(c.id), c]));
    const windowEnd = todayNum + horizon - 1;

    // 1. Slots. `live`: slot id -> { slot, owner } for well-formed slots of ACTIVE owners.
    //    `through`: slot object -> the watermark this pass leaves behind (starts as the stored one).
    const live = new Map(), through = new Map(), slotIds = new Set();
    allClients.forEach((owner) => (Array.isArray(owner.slots) ? owner.slots : []).forEach((slot) => {
      const problem = slotProblem(slot) || (slotIds.has(slot.id) ? 'slot id is used twice' : '');
      if (problem) { skipped.push({ clientId: owner.id, slotId: slot && typeof slot.id === 'string' ? slot.id : null, date: null, reason: problem }); return; }
      slotIds.add(slot.id);
      through.set(slot, slot.through || null);
      if (isActive(owner)) live.set(slot.id, { slot, owner });
      // Paused or inactive owner: nothing is created, and the watermark drops back to today so that un-pausing refills.
      else if (slot.through && dayNum(slot.through) > todayNum) through.set(slot, today);
    }));

    // 2. Reconcile untouched generated rows dated AFTER today (today's row is never removed).
    const existingIds = new Set(allSessions.map((s) => String(s.id))), removing = new Set(), planned = new Set();
    allSessions.forEach((row) => {
      if (!isPristine(row) || !(dayNum(row.date) > todayNum)) return;
      const entry = live.get(row.recurring.slotId);
      const expected = entry ? expectedRecord(entry.slot, entry.owner, row.recurring.date, clientsById) : null;
      if (expected && expected.recurring.stamp === row.recurring.stamp) return;
      removeIds.push(row.id); removing.add(String(row.id));
      // Rate, sibling status or address changed: same id, new values.
      if (expected) { create.push(expected); planned.add(expected.id); }
    });

    // 3. Create. Sessions by date (minus the ones being removed) guard against double income.
    const byDate = new Map();
    allSessions.forEach((s) => {
      if (typeof s.date !== 'string' || removing.has(String(s.id))) return;
      if (!byDate.has(s.date)) byDate.set(s.date, []);
      byDate.get(s.date).push(s);
    });
    live.forEach(({ slot, owner }) => {
      const anchorNum = dayNum(slot.anchor), step = 7 * slot.every;
      const throughNum = slot.through ? dayNum(slot.through) : -Infinity;
      const occurrenceFrom = (n) => anchorNum + Math.max(0, Math.ceil((n - anchorNum) / step)) * step;
      let examined = false;
      for (let d = occurrenceFrom(todayNum); d <= windowEnd; d += step) {
        const date = isoOf(d), id = rowId(slot.id, date);
        if (d > throughNum) examined = true;
        if ((existingIds.has(id) && !removing.has(id)) || planned.has(id)) continue; // already there
        if (d <= throughNum) continue; // planned before and since deleted or skipped by hand: it never comes back
        const record = expectedRecord(slot, owner, date, clientsById), attending = record.clientIds.map(String);
        const clash = (byDate.get(date) || []).find((s) => (s.clientIds || []).some((cid) => attending.includes(String(cid))) &&
          !(s.recurring && s.recurring.slotId !== slot.id && live.has(s.recurring.slotId)));
        if (clash) { skipped.push({ clientId: owner.id, slotId: slot.id, date, reason: 'client already has a session that day' }); continue; }
        create.push(record); planned.add(id);
      }
      // The watermark moves only when a not-yet-planned occurrence came into the window, so a quiet day plans nothing at all.
      if (examined && windowEnd > throughNum) through.set(slot, isoOf(windowEnd));
      // 4. Gaps: occurrences after the watermark and before today were never planned. Reported, never created.
      if (slot.through && throughNum < todayNum - 1) {
        for (let g = occurrenceFrom(throughNum + 1); g < todayNum; g += step) gaps.push({ clientId: owner.id, slotId: slot.id, date: isoOf(g) });
      }
    });

    // 5. Watermark marks: each changed client carries its complete slots array (unchanged and malformed slots ride along untouched).
    allClients.forEach((owner) => {
      const slots = Array.isArray(owner.slots) ? owner.slots : [];
      const moved = (slot) => through.has(slot) && through.get(slot) !== (slot.through || null);
      if (slots.some(moved)) marks.push({ id: owner.id, slots: slots.map((slot) => (moved(slot) ? { ...slot, through: through.get(slot) } : slot)) });
    });

    return { create, removeIds, clients: marks, skipped, gaps };
  }

  App.recurring = Object.freeze({ materializeRecurring, dayNum, isoOf, weekdayOf, stampOf, isPristine, slotProblem });
})();
