/* ============================================================
   Tutoring Tracker Pro — Sessions calendar (dashboard slice 2, ruled 2026-11-04)
   List / Calendar toggle on the Sessions tab. Calendar mode draws a 7-column month grid for the month the
   navigator shows; each day lists that day's rows as chips and offers a quick "+" that opens the session form
   with the date prefilled (the existing data-action="add-session" data-date path). The toggle state lives in
   memory only: no browser storage key, nothing for SECURITY-PRIVACY.md. The Dashboard stays calendar-free.
   ============================================================ */
(function () {
  'use strict';

  const App = window.App;
  const $ = App.$;
  const escapeHtml = App.escapeHtml;
  const formatDuration = App.formatDuration;
  const clientName = App.clientName;

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /** 'list' | 'calendar'. In memory only, on purpose. */
  let sessionView = 'list';

  const pad2 = (n) => String(n).padStart(2, '0');

  /** Family label when the client has one, else the client's name; several clients de-duplicate. */
  function chipLabel(s) {
    const labels = [];
    (s.clientIds || []).forEach((id) => {
      const c = App.state.clients.find((cl) => String(cl.id) === String(id));
      const label = c ? ((c.familyGroup ? String(c.familyGroup).trim() : '') || clientName(c)) : 'Unknown';
      if (!labels.includes(label)) labels.push(label);
    });
    return labels.join(', ') || '-';
  }

  /** Status colour class: scheduled, completed (paid or waived), completed-unpaid, muted (cancelled / no-show). */
  function chipClass(s) {
    const status = s.status || 'completed';
    if (status === 'cancelled' || status === 'no-show') return 'chip-muted';
    if (status === 'scheduled') return 'chip-scheduled';
    if (!s.paid && s.payment !== 'waived') return 'chip-unpaid';
    return 'chip-completed';
  }

  function chipHtml(s) {
    const time = s.time ? escapeHtml(s.time) : '';
    const label = escapeHtml(chipLabel(s));
    const status = escapeHtml(s.status || 'completed');
    const title = (s.time ? s.time + ' · ' : '') + chipLabel(s) + ' · ' + formatDuration(s.duration) + ' · ' + status +
      (s.status === 'completed' ? (s.paid ? ', paid' : (s.payment === 'waived' ? ', waived' : ', unpaid')) : '');
    return '<button type="button" class="calendar-chip ' + chipClass(s) + '" data-action="edit-session" data-id="' + escapeHtml(s.id) +
      '" title="' + escapeHtml(title) + '">' +
      (time ? '<span class="chip-time">' + time + '</span>' : '') +
      '<span class="chip-label">' + label + '</span>' +
      '<span class="chip-duration">' + formatDuration(s.duration) + '</span>' +
      '</button>';
  }

  /** Pure grid builder for 'YYYY-MM' from already-filtered rows (no DOM), so tests can pin it. */
  function calendarHtml(ym, rows) {
    const [y, m] = ym.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const daysInMonth = new Date(y, m, 0).getDate();
    const lead = first.getDay();                 // Sunday-first weeks
    const today = App.todayISO();

    const byDay = {};
    rows.forEach((s) => {
      const d = s.date || '';
      if (d.slice(0, 7) !== ym) return;
      (byDay[d] = byDay[d] || []).push(s);
    });
    Object.keys(byDay).forEach((d) => byDay[d].sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')) || String(a.id).localeCompare(String(b.id))));

    let html = '<div class="calendar-weekdays" aria-hidden="true">' + WEEKDAYS.map((w) => '<span>' + w + '</span>').join('') + '</div>';
    html += '<div class="calendar-grid">';
    for (let i = 0; i < lead; i++) html += '<div class="calendar-day is-outside" aria-hidden="true"></div>';
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = ym + '-' + pad2(day);
      const list = byDay[iso] || [];
      const isToday = iso === today;
      const weekday = new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      html += '<div class="calendar-day' + (isToday ? ' is-today' : '') + (list.length ? ' has-sessions' : '') + '" data-date="' + iso + '">' +
        '<div class="calendar-day-head">' +
          '<span class="calendar-day-number">' + day + '</span>' +
          '<button type="button" class="btn btn-sm btn-icon calendar-add" data-action="add-session" data-date="' + iso + '" aria-label="Add session on ' + escapeHtml(weekday) + '" title="Add session on ' + escapeHtml(weekday) + '">+</button>' +
        '</div>' +
        '<div class="calendar-day-body">' + list.map(chipHtml).join('') + '</div>' +
      '</div>';
    }
    const trail = (lead + daysInMonth) % 7;
    for (let i = trail ? 7 - trail : 0; i > 0; i--) html += '<div class="calendar-day is-outside" aria-hidden="true"></div>';
    html += '</div>';
    return html;
  }

  function renderViewToggle() {
    ['list', 'calendar'].forEach((v) => {
      const btn = $('session-view-' + v);
      if (!btn) return;
      btn.classList.toggle('active', sessionView === v);
      btn.setAttribute('aria-pressed', sessionView === v ? 'true' : 'false');
    });
  }

  /**
   * Called by renderSessions() with the rows it is showing. Shows the grid or the table, never both.
   * The calendar is by month: with "All time" selected it falls back to the list.
   */
  function renderSessionCalendar(filtered) {
    const ym = App.getSessionMonth();
    if (sessionView === 'calendar' && !ym) sessionView = 'list';
    renderViewToggle();
    const calendar = $('session-calendar');
    const table = $('sessions-table-wrap');
    const showCalendar = sessionView === 'calendar';
    if (calendar) calendar.hidden = !showCalendar;
    if (table) table.hidden = showCalendar;
    if (!calendar || !showCalendar) return;
    calendar.innerHTML = calendarHtml(ym, filtered || []);
  }

  /** Toggle handler. Switching to the calendar from "All time" jumps to the current month first. */
  function setSessionView(v, render) {
    sessionView = v === 'calendar' ? 'calendar' : 'list';
    if (sessionView === 'calendar' && !App.getSessionMonth()) App.setSessionMonth('today', false);
    if (render !== false) App.renderSessions();
  }

  /** Dashboard "Open calendar" line: Sessions tab, calendar mode, current month. */
  function openSessionCalendar() {
    App.setSessionMonth('today', false);
    setSessionView('calendar', false);
    App.switchTab('sessions');
  }

  App.renderSessionCalendar = renderSessionCalendar;
  App.calendarHtml = calendarHtml;
  App.setSessionView = setSessionView;
  App.getSessionView = () => sessionView;
  App.openSessionCalendar = openSessionCalendar;

})();
