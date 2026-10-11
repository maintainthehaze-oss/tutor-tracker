/* ============================================================
   Tutoring Tracker Pro — "This week" group (Sessions tab)
   Every session dated today-7 .. today+7, grouped by day, with one-tap
   exceptions (Completed / No-show / Cancelled / Skip / Mark paid). Above the
   days: the rows auto-completed on load since the owner last cleared the notice.
   The taps themselves are handled in ui.js (this-week-* and quick-* actions).
   Pure model + pure markup; the only writes are App.runCommand (ui.js) and the
   per-device notice bookkeeping key below (session ids only, never a record).
   ============================================================ */
(function () {
  'use strict';

  const App = window.App;
  const $ = App.$;
  const escapeHtml = App.escapeHtml;
  const num = App.num;
  const todayISO = App.todayISO;
  const clientName = App.clientName;
  const formatDuration = App.formatDuration;
  const formatCurrency = App.formatCurrency;

  const DAYS = 7;
  const CHIPS = Object.freeze([
    { status: 'completed', label: 'Completed', quick: 'quick-complete' },
    { status: 'no-show', label: 'No-show', quick: 'quick-noshow' },
    { status: 'cancelled', label: 'Cancelled', quick: 'quick-cancel' },
  ]);
  const PAID_TITLE = 'Marked paid: un-pay with the pencil first';
  // Per-device UI bookkeeping (ids of rows auto-completed on load, not yet reviewed). No names, no money.
  const LAST_SEEN_KEY = 'tutoring-last-seen';

  let collapsed = false; // the owner's open/closed choice, kept across re-renders for this page load

  /** 'YYYY-MM-DD' plus n days. UTC arithmetic on the date STRING, so a DST change can never shift a day. */
  function shiftISO(iso, days) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d) + days * 864e5).toISOString().slice(0, 10);
  }

  /** PURE. One tappable row model. `mode` decides which chips it gets (see thisWeekDays). */
  function rowModel(s, names, locked, today) {
    const status = s.status || 'completed', isLockedRow = !!locked(s.id), waived = App.isWaived(s);
    const date = typeof s.date === 'string' ? s.date : '';
    return {
      id: String(s.id), date, time: typeof s.time === 'string' ? s.time : '', status, waived, paid: !!s.paid,
      names: (s.clientIds || []).map((cid) => names.get(String(cid)) || 'Unknown').join(', '),
      duration: num(s.duration), amount: num(s.amount),
      mode: s.paid ? 'paid' : isLockedRow ? 'correct' : date > today ? 'skip' : 'status',
      canMarkPaid: isLockedRow && status === 'completed' && !s.paid && !waived,
    };
  }
  const byTime = (a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id);
  const nameMap = (clients) => new Map((clients || []).map((c) => [String(c.id), clientName(c)]));

  /**
   * PURE (no DOM, no clock). One entry per calendar day from today-7 to today+7, oldest first, each
   * holding that day's sessions in time order. `mode` decides which chips a row gets:
   *   paid     any paid row: chips shown but disabled (un-pay with the pencil first)
   *   correct  locked (archived or finalized) and unpaid: Completed / No-show / Cancelled as a correction
   *   skip     unlocked and dated after today: Skip
   *   status   unlocked and dated today or earlier: Completed / No-show / Cancelled
   * `isLocked` defaults to the repository's own answer; tests may pass their own.
   * `exclude` (optional Set of ids) leaves out rows that are drawn in the auto-completed notice instead.
   */
  function thisWeekDays(sessions, clients, today, isLocked, exclude) {
    const locked = isLocked || App.isProtectedSession;
    const names = nameMap(clients);
    const first = shiftISO(today, -DAYS), last = shiftISO(today, DAYS);
    const inWindow = (sessions || []).filter((s) => typeof s.date === 'string' && s.date >= first && s.date <= last &&
      !(exclude && exclude.has(String(s.id))));
    const days = [];
    for (let offset = -DAYS; offset <= DAYS; offset++) {
      const date = shiftISO(today, offset);
      const rows = inWindow.filter((s) => s.date === date).map((s) => rowModel(s, names, locked, today)).sort(byTime);
      days.push({ date, isToday: offset === 0, rows });
    }
    return days;
  }

  /**
   * PURE. The rows auto-completed on load that the owner has not reviewed yet: still on file, still
   * `completed` (a tap to No-show / Cancelled, or an edit, drops a row from the notice), any date.
   */
  function thisWeekNotice(sessions, clients, pendingIds, today, isLocked) {
    const locked = isLocked || App.isProtectedSession, names = nameMap(clients), pending = new Set((pendingIds || []).map(String));
    return (sessions || []).filter((s) => pending.has(String(s.id)) && (s.status || 'completed') === 'completed')
      .map((s) => rowModel(s, names, locked, today)).sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b));
  }

  function chipsHtml(row) {
    const id = escapeHtml(row.id);
    if (row.mode === 'skip') {
      return '<button type="button" class="duration-chip tw-chip" data-action="this-week-skip" data-id="' + id +
        '" title="Remove this session. Undo is offered for 8 seconds.">Skip</button>';
    }
    return CHIPS.map((chip) => {
      const lit = row.mode !== 'status' && row.status === chip.status;
      const action = row.mode === 'status' ? chip.quick : 'this-week-status';
      return '<button type="button" class="duration-chip tw-chip' + (lit ? ' selected' : '') + '" data-action="' + action +
        '" data-status="' + chip.status + '" data-id="' + id + '" aria-pressed="' + (lit ? 'true' : 'false') + '"' +
        (row.mode === 'paid' ? ' disabled title="' + PAID_TITLE + '"' : '') + '>' + chip.label + '</button>';
    }).join('');
  }

  function dayLabel(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function rowHtml(row, withDate) {
    return '<li class="tw-row" data-id="' + escapeHtml(row.id) + '">' +
      '<span class="tw-time">' + (withDate ? escapeHtml(dayLabel(row.date)) + (row.time ? ' &middot; ' : '') : '') + escapeHtml(row.time || (withDate ? '' : '-')) + '</span>' +
      '<span class="tw-info">' +
        '<span class="tw-names">' + escapeHtml(row.names || '-') + '</span>' +
        '<span class="tw-meta">' + formatDuration(row.duration) + ' &middot; ' + formatCurrency(row.amount) +
          (row.waived ? ' &middot; waived' : row.paid ? ' &middot; paid' : '') +
          (row.status === 'scheduled' ? ' &middot; scheduled' : '') + '</span>' +
      '</span>' +
      '<span class="tw-chips" role="group" aria-label="What happened">' + chipsHtml(row) + '</span>' +
      (row.canMarkPaid ? '<button type="button" class="btn btn-sm btn-mark-paid" data-action="mark-paid" data-id="' +
        escapeHtml(row.id) + '" title="Mark this session paid">Mark paid</button>' : '') +
    '</li>';
  }

  /**
   * PURE. Display order for the days: today first, then the past newest-first (yesterday, the day
   * before, ...), then the days ahead oldest-first under a "Coming up" divider. The most recent
   * thing he did is always at the top; what is planned sits at the bottom (ruled 2026-10-11).
   */
  function displayOrder(days) {
    const today = days.filter((day) => day.isToday);
    const todayDate = today.length ? today[0].date : '';
    const past = days.filter((day) => day.date < todayDate).sort((a, b) => b.date.localeCompare(a.date));
    const ahead = days.filter((day) => todayDate && day.date > todayDate).sort((a, b) => a.date.localeCompare(b.date));
    return { ordered: [...today, ...past, ...ahead], firstAhead: ahead.length ? ahead[0].date : '' };
  }

  /** PURE. Markup for the group body: the auto-completed notice (if any), then days that have sessions, plus today. */
  function thisWeekHtml(days, notice) {
    const pending = notice || [];
    const empty = !pending.length && !days.some((day) => day.rows.length);
    const { ordered, firstAhead } = displayOrder(days);
    // The divider goes above the first day AHEAD that is actually drawn (days ahead with nothing are skipped).
    const firstAheadDrawn = firstAhead ? (ordered.find((day) => day.date >= firstAhead && day.rows.length) || {}).date : '';
    return (pending.length ? '<section class="tw-notice" aria-label="Auto-completed since your last visit">' +
        '<header class="tw-day-head">' +
          '<span class="tw-day-label tw-notice-label">' + pending.length + ' session' + (pending.length === 1 ? '' : 's') +
            ' auto-completed since your last visit</span>' +
          '<button type="button" class="btn btn-sm" data-action="this-week-dismiss" title="All of these happened as planned">Dismiss</button>' +
        '</header>' +
        '<ul class="tw-rows">' + pending.map((row) => rowHtml(row, true)).join('') + '</ul>' +
      '</section>' : '') +
      (empty ? '<p class="empty-state">Nothing scheduled this week. Tap + to add a session.</p>' : '') +
      ordered.filter((day) => day.isToday || day.rows.length).map((day) => {
        const label = dayLabel(day.date);
        const divider = firstAheadDrawn && day.date === firstAheadDrawn ? '<p class="tw-divider">Coming up</p>' : '';
        return divider + '<section class="tw-day' + (day.isToday ? ' tw-today' : '') + '" data-date="' + day.date + '">' +
          '<header class="tw-day-head">' +
            '<span class="tw-day-label">' + (day.isToday ? 'Today &middot; ' : '') + escapeHtml(label) + '</span>' +
            '<button type="button" class="btn btn-sm btn-icon tw-add" data-action="this-week-add" data-date="' + day.date +
              '" title="Add a session on this day" aria-label="Add a session on ' + escapeHtml(label) + '">+</button>' +
          '</header>' +
          (day.rows.length ? '<ul class="tw-rows">' + day.rows.map((row) => rowHtml(row, false)).join('') + '</ul>' : '') +
        '</section>';
      }).join('');
  }

  /* ---- Notice bookkeeping: ids of rows auto-completed on load, until reviewed or dismissed ---- */
  function readPending() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LAST_SEEN_KEY) || 'null');
      return parsed && Array.isArray(parsed.autoCompleted) ? parsed.autoCompleted.map(String) : [];
    } catch (_) { return []; }
  }
  function writePending(ids) {
    try { localStorage.setItem(LAST_SEEN_KEY, JSON.stringify({ at: new Date().toISOString(), autoCompleted: ids })); } catch (_) { /* storage unavailable: the notice is per-load only */ }
  }
  /** Called by autoCompleteOverdue (sessions.js) with the ids it just completed. */
  function recordAutoCompleted(ids) {
    const merged = [...new Set([...readPending(), ...(ids || []).map(String)])];
    writePending(merged);
  }
  function dismissNotice() {
    writePending([]);
    renderThisWeek();
  }

  /** Runs first in renderSessions. It must never stop the rest of the Sessions tab from painting. */
  function renderThisWeek() {
    const body = $('this-week-body');
    if (!body) return;
    try {
      const today = todayISO();
      const pendingIds = readPending();
      const notice = thisWeekNotice(App.state.sessions, App.state.clients, pendingIds, today);
      // A reviewed row (no longer completed) or a deleted one leaves the key, so it never grows.
      if (notice.length !== pendingIds.length) writePending(notice.map((row) => row.id));
      const days = thisWeekDays(App.state.sessions, App.state.clients, today, null, new Set(notice.map((row) => row.id)));
      body.innerHTML = thisWeekHtml(days, notice);
      const count = $('this-week-count');
      if (count) count.textContent = String(notice.length + days.reduce((n, day) => n + day.rows.length, 0));
      const details = $('this-week');
      if (details) {
        if (details.dataset.drawn) collapsed = !details.open;
        details.dataset.drawn = '1';
        details.open = !collapsed;
      }
    } catch (error) {
      console.error('This week could not be drawn', error);
      body.innerHTML = '<p class="empty-state">This week could not be shown. The table below still has everything.</p>';
    }
  }

  App.thisWeekDays = thisWeekDays;
  App.thisWeekNotice = thisWeekNotice;
  App.thisWeekHtml = thisWeekHtml;
  App.thisWeekDisplayOrder = displayOrder;
  App.renderThisWeek = renderThisWeek;
  App.THIS_WEEK_PAID_TITLE = PAID_TITLE;
  App.thisWeek = { recordAutoCompleted, dismissNotice, pending: readPending };
})();
