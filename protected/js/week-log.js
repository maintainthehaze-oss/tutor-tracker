/* ============================================================
   Tutoring Tracker Pro — "Log a week" grid
   Rows = client sets, columns = Mon..Sun. Tapping a cell ticks it with that
   set's usual session; Save writes every ticked row in ONE repository command.
   Keeps its own model (ticks); never touches App.state. The pure planning
   helpers live in signatures.js (App.weekPlan).
   ============================================================ */
(function () {
  'use strict';

  const App = window.App;
  const $ = App.$;
  const escapeHtml = App.escapeHtml;
  const num = App.num;
  const todayISO = App.todayISO;
  const W = App.weekPlan;

  let anchor = '';      // Monday ISO of the week shown
  let ticks = [];       // { key, clientIds, date, duration, amount, type, time }
  let revision = null;  // repository revision captured when the modal opened

  /** Local-date formatting from the ISO parts; never new Date(iso), which reads as UTC. */
  function localDate(iso, options) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', options);
  }
  const shortDate = (iso) => localDate(iso, { month: 'short', day: 'numeric' });

  function currentRows() {
    const clients = App.state.clients;
    const byId = new Map(clients.map((c) => [String(c.id), c]));
    const ordered = App.clientPickerRows(clients, App.state.sessions, [])
      .map((r) => byId.get(String(r.id))).filter(Boolean);
    const since = W.isoOf(W.dayNum(todayISO()) - 60);
    return W.weekRows(App.state.sessions, ordered, clients, since, ticks.map((t) => t.key), App.state.settings.defaultDuration);
  }

  function renderGrid(rows) {
    const grid = $('week-grid');
    if (!grid) return;
    const dates = W.weekDates(anchor), today = todayISO();
    let html = '<div class="week-corner"></div>' + dates.map((d, i) =>
      '<div class="week-head' + (d === today ? ' week-today' : '') + '"><span>' + escapeHtml(W.WEEKDAY_LABELS[i]) + '</span><strong>' +
      escapeHtml(String(Number(d.slice(8)))) + '</strong></div>').join('');
    rows.forEach((row) => {
      const usual = row.prefill;
      html += '<div class="week-row-label"><span>' + escapeHtml(row.label) + '</span><small>' +
        escapeHtml(num(usual.duration) + ' h · ' + App.formatCurrency(usual.amount) + ' · ' + usual.type) + '</small></div>';
      dates.forEach((d) => {
        const state = W.cellState(row, d, App.state.sessions, ticks);
        const tick = ticks.find((t) => t.key === row.key && t.date === d);
        const text = state === 'ticked' ? num(tick.duration) + ' h · ' + App.formatCurrency(tick.amount)
          : state === 'open' ? '+' : state === 'logged' ? 'logged' : '–';
        const verb = { open: 'Add', ticked: 'Remove', logged: 'Already logged:', blocked: 'Unavailable:' }[state];
        html += '<button type="button" class="week-cell week-cell-' + escapeHtml(state) + '" data-action="week-toggle" data-key="' +
          escapeHtml(row.key) + '" data-date="' + escapeHtml(d) + '" aria-pressed="' + (state === 'ticked' ? 'true' : 'false') + '"' +
          (state === 'logged' || state === 'blocked' ? ' disabled' : '') +
          ' aria-label="' + escapeHtml(verb + ' ' + row.label + ' ' + shortDate(d)) + '">' + escapeHtml(text) + '</button>';
      });
    });
    grid.innerHTML = html;
  }

  function renderReview(rows) {
    const review = $('week-review');
    if (review) {
      if (!ticks.length) {
        review.innerHTML = '<p class="client-picker-empty">Nothing ticked yet.</p>';
      } else {
        const today = todayISO();
        const sorted = [...ticks].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
        review.innerHTML = sorted.map((t) => {
          const row = rows.find((r) => r.key === t.key);
          const day = localDate(t.date, { weekday: 'short' }) + ' ' + shortDate(t.date);
          const attrs = ' data-key="' + escapeHtml(t.key) + '" data-date="' + escapeHtml(t.date) + '"';
          const scheduled = App.defaultStatusForDate(t.date, today) === 'scheduled';
          return '<div class="week-review-row"><span class="week-review-date">' + escapeHtml(day) + '</span>' +
            '<span class="week-review-name">' + escapeHtml(row ? row.label : t.key) + '</span>' +
            '<input type="number" class="input" min="0.25" step="0.25" value="' + escapeHtml(t.duration) + '" data-action="week-edit"' + attrs + ' data-field="duration" aria-label="Duration (hours)">' +
            '<input type="number" class="input" min="0" step="0.01" value="' + escapeHtml(t.amount) + '" data-action="week-edit"' + attrs + ' data-field="amount" aria-label="Amount ($)">' +
            '<span class="week-pill' + (scheduled ? ' week-pill-scheduled' : '') + '">' + (scheduled ? 'Scheduled' : 'Completed (locks)') + '</span>' +
            '<button type="button" class="btn btn-sm" data-action="week-toggle"' + attrs + ' aria-label="Remove">×</button></div>';
        }).join('');
      }
    }
    const summary = $('week-summary');
    if (summary) {
      const total = ticks.reduce((s, t) => s + num(t.amount), 0);
      summary.textContent = ticks.length + ' session' + (ticks.length === 1 ? '' : 's') + ' · ' + App.formatCurrency(total);
    }
    const save = $('save-week');
    if (save) save.disabled = ticks.length === 0;
  }

  function render() {
    const rows = currentRows();
    const label = $('week-label');
    if (label) {
      const dates = W.weekDates(anchor);
      label.textContent = 'Mon ' + shortDate(dates[0]) + ' – Sun ' + shortDate(dates[6]) + ', ' + dates[6].slice(0, 4);
    }
    renderGrid(rows);
    renderReview(rows);
  }

  function openWeekLog(dateIso) {
    if (!App.repository.ready) { App.showToast('Still loading. Try again in a moment.', 'warning'); return; }
    revision = App.repository.revision;
    anchor = W.weekStart(dateIso || todayISO());
    ticks = [];
    render();
    App.openModal('modal-week');
  }

  function shiftWeek(delta) {
    anchor = W.isoOf(W.dayNum(anchor) + 7 * delta);
    render();
  }

  function toggleWeekCell(key, date) {
    const row = currentRows().find((r) => r.key === key);
    if (!row) return;
    const state = W.cellState(row, date, App.state.sessions, ticks);
    if (state === 'logged') { App.showToast('Already logged that day', 'info'); return; }
    if (state === 'blocked') { App.showToast('Another ticked row has that client that day', 'info'); return; }
    if (state === 'ticked') ticks = ticks.filter((t) => !(t.key === key && t.date === date));
    else ticks.push({ key, clientIds: row.clientIds, date, ...row.prefill });
    render();
  }

  function repeatWeek() {
    const dates = W.weekDates(anchor);
    const fresh = W.repeatLastWeek(App.state.sessions, dates, App.state.clients);
    ticks = ticks.filter((t) => !dates.includes(t.date)).concat(fresh);
    if (fresh.length) App.showToast(fresh.length + ' cell' + (fresh.length === 1 ? '' : 's') + ' ticked from last week', 'success');
    else App.showToast('Nothing to repeat: no sessions last week', 'warning');
    render();
  }

  function editWeekTick(el) {
    const key = el.getAttribute('data-key'), date = el.getAttribute('data-date'), field = el.getAttribute('data-field');
    const tick = ticks.find((t) => t.key === key && t.date === date);
    if (!tick) return;
    if (field === 'duration') {
      const v = num(el.value);
      if (v <= 0) App.showToast('Duration must be more than zero', 'error');
      else tick.duration = v;
    } else if (field === 'amount') {
      tick.amount = App.newAmount(Math.max(0, num(el.value)), null);
    }
    render(); // the ticked grid cell shows duration and amount too
  }

  async function saveWeek() {
    if (!ticks.length) { App.showToast('Tick at least one day', 'warning'); return false; }
    const records = W.buildRecords(ticks, App.state.clients, todayISO(), App.generateId, new Date().toISOString());
    const ok = await App.runCommand('session.saveMany', { records }, revision);
    if (!ok) return false;
    App.closeModal('modal-week');
    App.setSessionMonth(records[0].date.slice(0, 7), false);
    App.renderSessions();
    App.showToast(records.length + ' session' + (records.length === 1 ? '' : 's') + ' logged', 'success');
    ticks = [];
    return true;
  }

  App.openWeekLog = openWeekLog;
  App.shiftWeek = shiftWeek;
  App.toggleWeekCell = toggleWeekCell;
  App.repeatWeek = repeatWeek;
  App.editWeekTick = editWeekTick;
  App.saveWeek = saveWeek;
  App.weekLog = { ticks: () => ticks.map((t) => ({ ...t })), anchor: () => anchor };
})();
