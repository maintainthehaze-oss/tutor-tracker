/* ============================================================
   Tutoring Tracker Pro — Sessions table
   Month navigator, filters, sort, row rendering, totals, bulk bar. Split out of sessions.js (roadmap 4.4).
   ============================================================ */
(function () {
  'use strict';

  const App = window.App;
  const $ = App.$;
  const escapeHtml = App.escapeHtml;
  const formatCurrency = App.formatCurrency;
  const formatDate = App.formatDate;
  const formatDuration = App.formatDuration;
  const num = App.num;
  const clientName = App.clientName;

  let sessionSort = { field: 'date', dir: 'desc' };

  /** Month shown in the Sessions tab ('YYYY-MM'), or '' for all time. Defaults to the current month. */
  let sessionMonth = App.currentMonth();

  function monthLabel(ym) {
    if (!ym) return 'All time';
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  /**
   * Change the month shown. v: 'prev' | 'next' | 'today' | 'all' | 'YYYY-MM'.
   *
   * Date scope rule (both halves live here, see applySessionFilters):
   *   picking a month clears any custom From/To range;
   *   typing a From/To range switches the month to all time.
   * Whichever the user touched last wins.
   */
  function setSessionMonth(v, render) {
    if (v === 'all') sessionMonth = '';
    else if (v === 'today') sessionMonth = App.currentMonth();
    else if (v === 'prev' || v === 'next') {
      const base = sessionMonth || App.currentMonth();
      const [y, m] = base.split('-').map(Number);
      const d = new Date(y, m - 1 + (v === 'next' ? 1 : -1), 1);
      sessionMonth = App.monthKey(d);
    } else sessionMonth = v || '';
    if (v !== 'all') {
      const fds = $('filter-date-start'); if (fds) fds.value = '';
      const fde = $('filter-date-end'); if (fde) fde.value = '';
    }
    if (render !== false) renderSessions();
  }

  /** After a save, make sure the saved session is on screen (jump the month if needed). */
  function showMonthOf(date) {
    const ym = (date || '').slice(0, 7);
    if (sessionMonth && ym && ym !== sessionMonth) setSessionMonth(ym, false);
  }

  /** Human description of what the Sessions tab is currently showing, for exports/toasts. */
  function sessionScopeLabel() {
    const anyFilter = ['filter-date-start', 'filter-date-end', 'filter-client', 'filter-payment', 'filter-status']
      .some((id) => $(id) && $(id).value);
    return monthLabel(sessionMonth) + (anyFilter ? ', filtered' : '');
  }

  function renderMonthNav() {
    const label = $('session-month-label');
    if (label) {
      label.textContent = monthLabel(sessionMonth);
      label.classList.toggle('is-current', sessionMonth === App.currentMonth());
    }
    const allBtn = $('session-month-all');
    if (allBtn) {
      allBtn.classList.toggle('active', !sessionMonth);
      allBtn.setAttribute('aria-pressed', !sessionMonth ? 'true' : 'false');
    }
  }

  /** Empty-month state: message + Show all time, the next scheduled session anywhere (if any), and Add Session. */
  function emptyMonthHtml() {
    const today = App.todayISO();
    const next = App.state.sessions
      .filter((s) => s.status === 'scheduled' && s.date && s.date >= today)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time || '').localeCompare(String(b.time || '')))[0];
    let html = '<div class="empty-line">No sessions in ' + escapeHtml(monthLabel(sessionMonth)) +
      '. <button class="btn btn-sm" data-action="session-month-all">Show all time</button></div>';
    if (next) {
      const [y, m, d] = next.date.split('-').map(Number);
      const when = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const names = (next.clientIds || []).map((id) => {
        const c = App.state.clients.find((cl) => String(cl.id) === String(id));
        return c ? clientName(c) : 'Unknown';
      }).join(', ');
      html += '<div class="empty-line">Next up: ' + escapeHtml(when) + (next.time ? ' · ' + escapeHtml(next.time) : '') +
        ' · ' + escapeHtml(names) + ' · ' + formatCurrency(next.amount) +
        ' <button class="btn btn-sm" data-action="session-month-goto" data-month="' + escapeHtml(next.date.slice(0, 7)) + '">Go to that month</button></div>';
    }
    // Prefill: first of the shown month when that is in the future, otherwise today (the form's default).
    const first = sessionMonth + '-01';
    const prefill = first > today ? first : today;
    html += '<div class="empty-line"><button class="btn btn-primary btn-sm" data-action="add-session" data-date="' + escapeHtml(prefill) + '">Add Session</button></div>';
    return html;
  }

  function renderSessions() {
    const sessions = App.state.sessions;

    // Populate filter client dropdown
    populateClientFilter();

    // Apply filters first: this also settles the month-vs-range rule
    let filtered = applySessionFilters();

    // Month navigator + owed-by-family (all time) + summary for the shown month
    renderMonthNav();
    App.renderOwedList($('sessions-owed-list'), $('sessions-owed-total'));

    // Bulk selection can only ever contain rows that are on screen
    const sel = App.state.selectedSessions;
    if (sel && sel.size) {
      const visible = new Set(filtered.map((s) => s.id));
      [...sel].forEach((id) => { if (!visible.has(id)) sel.delete(id); });
    }

    // Badge = what is shown; tooltip = everything
    const countEl = $('session-count');
    if (countEl) {
      countEl.textContent = filtered.length;
      countEl.title = filtered.length + ' shown of ' + sessions.length + ' total';
    }

    // Sort
    filtered = sortSessions(filtered);

    // Show/hide columns for edit mode and checkboxes
    const editMode = App.state.editMode;
    const checkCols = document.querySelectorAll('.col-check');
    checkCols.forEach((el) => el.hidden = !editMode);
    const selectAll = document.querySelector('[data-action="select-all-sessions"]');
    if (selectAll) {
      const selectable = filtered.filter((s) => !App.isProtectedSession(s.id));
      selectAll.checked = selectable.length > 0 && selectable.every((s) => sel.has(s.id));
    }

    // Render table
    const tbody = $('sessions-tbody');
    if (!tbody) return;

    if (filtered.length === 0) {
      const hint = sessionMonth ? emptyMonthHtml() : 'No sessions match your filters';
      tbody.innerHTML = '<tr class="empty-row"><td colspan="9">' + hint + '</td></tr>';
      updateSessionTotals([]);
      updateBulkBar();
      return;
    }

    tbody.innerHTML = filtered.map((s) => renderSessionRow(s)).join('');
    updateSessionTotals(filtered);
    updateBulkBar();
    updateSortHeaders();
  }

  /** Reflect current sessionSort state as aria-sort on the sessions table's
   *  sortable headers so screen readers announce the active sort column. */
  function updateSortHeaders() {
    const table = $('sessions-table');
    if (!table) return;
    table.querySelectorAll('th[data-sort]').forEach((th) => {
      const field = th.getAttribute('data-sort');
      if (field === sessionSort.field) {
        th.setAttribute('aria-sort', sessionSort.dir === 'asc' ? 'ascending' : 'descending');
      } else {
        th.setAttribute('aria-sort', 'none');
      }
    });
  }

  function renderSessionRow(s) {
    const clients = App.state.clients;
    const editMode = App.state.editMode;
    const selectedSessions = App.state.selectedSessions;

    const clientNames = (s.clientIds || []).map((id) => {
      const c = clients.find((cl) => String(cl.id) === String(id));
      return c ? clientName(c) : 'Unknown';
    }).join(', ');

    const typeLabels = { 'in-person': 'In Person', 'online': 'Online', 'hybrid': 'Hybrid', 'group': 'Group' };
    // No Type column (ruled 2026-10-11): anything other than in-person is noted after the client names.
    const minutesNote = s.type === 'hybrid' && s.inPersonMinutes != null ? ' \u00b7 ' + num(s.inPersonMinutes) + ' min in person' : '';
    const typeNote = (s.type || 'in-person') === 'in-person' ? '' : ' <span class="type-note">' + escapeHtml((typeLabels[s.type] || s.type) + minutesNote) + '</span>';
    const paymentClass = s.paid ? 'payment-paid' : (s.payment === 'waived' ? 'payment-waived' : 'payment-unpaid');
    const paymentLabel = s.paid ? 'Paid' : (s.payment === 'waived' ? 'Waived' : 'Unpaid');
    const statusClass = 'status-badge status-' + escapeHtml(s.status || 'completed');
    const isSelected = selectedSessions.has(s.id);

    const splitAmount = num(s.companyAmount);

    // Cancelled / no-show sessions carry no charge (owner ruling 2026-09-15):
    // show a dash instead of an amount and a payment state.
    const noCharge = s.status === 'cancelled' || s.status === 'no-show';
    const amountDisplay = noCharge ? '<span title="No charge">&mdash;</span>' : formatCurrency(s.amount);
    const paymentCell = noCharge
      ? '<span title="No charge: session did not happen">&mdash;</span>'
      : '<span class="payment-badge ' + paymentClass + '">' + paymentLabel + '</span>';
    const splitDisplay = splitAmount > 0
      ? escapeHtml(num(s.companySplit)) + '% / ' + formatCurrency(splitAmount)
      : '-';

    const weeklyTag = s.recurring && s.recurring.slotId ? ' <span class="outstanding-tag">weekly</span>' : '';
    const protectedRow = App.isProtectedSession(s.id);
    // Pre-activation sessions that were still scheduled at activation are read-only, so their outcome is
    // recorded as a status event (last wins). Offer the choice in place of the badge.
    const archivedScheduled = protectedRow && App.isArchivedRecord('sessions', s.id) && (s.status === 'scheduled' || s.statusEvent);
    const statusCell = archivedScheduled
      ? '<select class="input input-sm archived-status" data-action="archived-status" data-id="' + escapeHtml(s.id) + '" title="Record what happened to this scheduled session">' +
          ['scheduled', 'completed', 'cancelled', 'no-show'].map((v) =>
            '<option value="' + v + '"' + (s.status === v ? ' selected' : '') + (v === 'scheduled' && s.statusEvent ? ' disabled' : '') + '>' + v + '</option>').join('') +
        '</select>'
      : '<span class="' + statusClass + '">' + escapeHtml(s.status || 'completed') + '</span>';
    if (editMode && !protectedRow) {
      return '<tr class="session-row' + (isSelected ? ' selected' : '') + '" data-id="' + escapeHtml(s.id) + '">' +
        '<td class="col-check"><input type="checkbox" data-action="select-session" data-id="' + escapeHtml(s.id) + '"' + (isSelected ? ' checked' : '') + ' aria-label="Select session"></td>' +
        '<td><input type="date" class="input input-sm" value="' + escapeHtml(s.date || '') + '" data-field="date" data-action="inline-edit" data-id="' + escapeHtml(s.id) + '"></td>' +
        '<td><input type="time" class="input input-sm" value="' + escapeHtml(s.time || '') + '" data-field="time" data-action="inline-edit" data-id="' + escapeHtml(s.id) + '"></td>' +
        '<td class="col-client">' + escapeHtml(clientNames) + typeNote + weeklyTag + '</td>' +
        '<td><input type="number" class="input input-sm" value="' + num(s.duration) + '" step="0.25" min="0.25" data-field="duration" data-action="inline-edit" data-id="' + escapeHtml(s.id) + '"></td>' +
        '<td><input type="number" class="input input-sm" value="' + num(s.amount) + '" step="0.01" min="0" data-field="amount" data-action="inline-edit" data-id="' + escapeHtml(s.id) + '"></td>' +
        '<td class="split-info">' + splitDisplay + '</td>' +
        '<td>' + (num(s.mileage) > 0 ? num(s.mileage).toFixed(1) + ' mi' : '-') + '</td>' +
        '<td class="col-pay-status"><select class="input input-sm" data-field="payment" data-action="inline-edit" data-id="' + escapeHtml(s.id) + '">' +
          '<option value="paid"' + (s.paid ? ' selected' : '') + '>Paid</option>' +
          '<option value="unpaid"' + (!s.paid && s.payment !== 'waived' ? ' selected' : '') + '>Unpaid</option>' +
          '<option value="waived"' + (s.payment === 'waived' ? ' selected' : '') + '>Waived</option>' +
        '</select> ' +
        '<select class="input input-sm" data-field="status" data-action="inline-edit" data-id="' + escapeHtml(s.id) + '">' +
          '<option value="completed"' + (s.status === 'completed' ? ' selected' : '') + '>Completed</option>' +
          '<option value="scheduled"' + (s.status === 'scheduled' ? ' selected' : '') + '>Scheduled</option>' +
          '<option value="cancelled"' + (s.status === 'cancelled' ? ' selected' : '') + '>Cancelled</option>' +
          '<option value="no-show"' + (s.status === 'no-show' ? ' selected' : '') + '>No Show</option>' +
        '</select></td>' +
        '<td class="col-actions"><button class="btn btn-sm btn-icon btn-danger" data-action="delete-session" data-id="' + escapeHtml(s.id) + '"' + (protectedRow ? ' title="Locked: kept on file. Click to cancel it instead"' : ' title="Delete"') + '><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></td>' +
      '</tr>';
    }

    return '<tr class="session-row" data-id="' + escapeHtml(s.id) + '">' +
      (editMode ? '<td class="col-check" title="Read-only record">Locked</td>' : '') +
      '<td>' + escapeHtml(formatDate(s.date)) + '</td>' +
      '<td>' + escapeHtml(s.time || '-') + '</td>' +
      '<td class="col-client">' + escapeHtml(clientNames || '-') + typeNote + weeklyTag + '</td>' +
      '<td>' + formatDuration(s.duration) + '</td>' +
      '<td>' + amountDisplay + '</td>' +
      '<td class="split-info">' + splitDisplay + '</td>' +
      '<td>' + (num(s.mileage) > 0 ? num(s.mileage).toFixed(1) + ' mi' : '-') + '</td>' +
      '<td class="col-pay-status">' + paymentCell + ' ' + statusCell + '</td>' +
      '<td class="col-actions">' +
        // One tap for a scheduled row he has not opened (session.update).
        (!protectedRow && s.status === 'scheduled' ? '<button class="btn btn-sm btn-complete" data-action="quick-complete" data-id="' + escapeHtml(s.id) + '" title="Mark this session completed">Completed</button>' : '') +
        // Mark paid lives in the Owed panel only; no Duplicate: Usual tiles and Week cover it (ruled 2026-10-11).
        '<button class="btn btn-sm btn-icon" data-action="edit-session" data-id="' + escapeHtml(s.id) + '"' + (protectedRow ? ' title="View (read-only record)"' : ' title="Edit"') + '><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>' +
        '<button class="btn btn-sm btn-icon btn-danger" data-action="delete-session" data-id="' + escapeHtml(s.id) + '"' + (protectedRow ? ' title="Locked: kept on file. Click to cancel it instead"' : ' title="Delete"') + '><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>' +
      '</td>' +
    '</tr>';
  }

  function populateClientFilter() {
    const clients = App.state.clients;
    const select = $('filter-client');
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = '<option value="">All Clients</option>' +
      [...clients].sort((a, b) => clientName(a).localeCompare(clientName(b)))
        .map((c) => '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(clientName(c)) + '</option>')
        .join('');
    select.value = currentVal;
  }

  function applySessionFilters() {
    let filtered = [...App.state.sessions];

    const dateStart = $('filter-date-start') ? $('filter-date-start').value : '';
    const dateEnd = $('filter-date-end') ? $('filter-date-end').value : '';
    const clientId = $('filter-client') ? $('filter-client').value : '';
    const payment = $('filter-payment') ? $('filter-payment').value : '';
    const status = $('filter-status') ? $('filter-status').value : '';

    // A custom From/To range overrides the month navigator (other half of the rule in setSessionMonth)
    if (dateStart || dateEnd) sessionMonth = '';
    if (sessionMonth) filtered = filtered.filter((s) => (s.date || '').slice(0, 7) === sessionMonth);
    if (dateStart) filtered = filtered.filter((s) => s.date >= dateStart);
    if (dateEnd) filtered = filtered.filter((s) => s.date <= dateEnd);
    if (clientId) filtered = filtered.filter((s) => (s.clientIds || []).some((cid) => String(cid) === String(clientId)));
    if (payment === 'paid') filtered = filtered.filter((s) => s.paid === true);
    else if (payment === 'unpaid') filtered = filtered.filter((s) => !s.paid && s.payment !== 'waived' && s.status !== 'cancelled' && s.status !== 'no-show');
    else if (payment === 'waived') filtered = filtered.filter((s) => s.payment === 'waived');
    if (status) filtered = filtered.filter((s) => s.status === status);

    return filtered;
  }

  function sortSessions(arr) {
    const clients = App.state.clients;
    const { field, dir } = sessionSort;
    const mult = dir === 'asc' ? 1 : -1;
    const str = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
    // Ties follow the primary direction: Date descending lists 18:30 above 16:15 within one day.
    const tieBreak = (a, b) => (str(a.date || '', b.date || '') || str(a.time || '', b.time || '') || str(String(a.id), String(b.id))) * mult;

    return arr.sort((a, b) => primary(a, b) || tieBreak(a, b));

    function primary(a, b) {
      let va, vb;
      switch (field) {
        case 'date':
          va = a.date || '';
          vb = b.date || '';
          return va < vb ? -1 * mult : va > vb ? 1 * mult : 0;
        case 'time':
          va = a.time || '';
          vb = b.time || '';
          return va < vb ? -1 * mult : va > vb ? 1 * mult : 0;
        case 'client':
          va = (a.clientIds || []).map((id) => { const c = clients.find((cl) => String(cl.id) === String(id)); return c ? clientName(c) : ''; }).join('');
          vb = (b.clientIds || []).map((id) => { const c = clients.find((cl) => String(cl.id) === String(id)); return c ? clientName(c) : ''; }).join('');
          return va.localeCompare(vb) * mult;
        case 'duration':
          return (num(a.duration) - num(b.duration)) * mult;
        case 'amount':
          return (num(a.amount) - num(b.amount)) * mult;
        case 'payment':
          va = a.paid ? 'a' : (a.payment === 'waived' ? 'c' : 'b');
          vb = b.paid ? 'a' : (b.payment === 'waived' ? 'c' : 'b');
          return va < vb ? -1 * mult : va > vb ? 1 * mult : 0;
        case 'status':
          return (a.status || '').localeCompare(b.status || '') * mult;
        default:
          return 0;
      }
    }
  }

  /** Pure arithmetic behind the Sessions Totals row (no DOM), so tests can pin it against
   *  App.computeMetrics and App.reportModel.metrics. */
  function sessionTotals(filtered) {
    const completed = filtered.filter((s) => s.status === 'completed');
    const totalDur = completed.reduce((sum, s) => sum + num(s.duration), 0);
    // Waived fees are not revenue (App.revenueAmount returns 0 for them).
    const totalAmt = completed.reduce((sum, s) => sum + App.revenueAmount(s), 0);
    const totalMiles = completed.reduce((sum, s) => sum + num(s.mileage), 0);

    // Projected revenue = scheduled (not-yet-realized) sessions in the current view.
    // Kept separate from realized totals on purpose; the app only counts completed as revenue.
    const scheduled = filtered.filter((s) => s.status === 'scheduled');
    const projectedAmt = scheduled.reduce((sum, s) => sum + App.revenueAmount(s), 0);
    return { totalDur, totalAmt, totalMiles, projectedAmt, scheduled };
  }

  function updateSessionTotals(filtered) {
    const { totalDur, totalAmt, totalMiles, projectedAmt, scheduled } = sessionTotals(filtered);

    const durEl = $('total-duration');
    if (durEl) durEl.textContent = formatDuration(totalDur);
    const amtEl = $('total-amount');
    if (amtEl) {
      // formatCurrency yields only digits/currency punctuation, so this is safe to inject.
      amtEl.innerHTML = formatCurrency(totalAmt) +
        (projectedAmt > 0
          ? '<span class="total-projected" title="Projected revenue from ' + scheduled.length +
            ' scheduled session' + (scheduled.length === 1 ? '' : 's') +
            ' in view (not yet realized)">+' + formatCurrency(projectedAmt) + ' projected</span>'
          : '');
    }
    const miEl = $('total-mileage');
    if (miEl) miEl.textContent = totalMiles.toFixed(1) + ' mi';
  }

  function updateBulkBar() {
    const selectedSessions = App.state.selectedSessions;
    const bar = $('bulk-actions');
    if (!bar) return;
    const count = selectedSessions.size;
    bar.hidden = count === 0;
    const countEl = $('bulk-selected-count');
    if (countEl) countEl.textContent = count;
  }

  /** Column header tapped: flip the direction on the same column, else sort that column descending. */
  function applySessionSort(field) {
    if (App.sessionSort.field === field) {
      App.sessionSort.dir = App.sessionSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      App.sessionSort.field = field;
      App.sessionSort.dir = 'desc';
    }
    App.renderSessions();
  }

  // Expose to App namespace
  App.renderSessions = renderSessions;
  App.setSessionMonth = setSessionMonth;
  App.getSessionMonth = () => sessionMonth;
  App.sessionScopeLabel = sessionScopeLabel;
  App.updateBulkBar = updateBulkBar;
  App.applySessionFilters = applySessionFilters;
  App.sessionTotals = sessionTotals;
  App.sessionSort = sessionSort;
  App.sortSessions = sortSessions;
  App.populateClientFilter = populateClientFilter;
  App.showMonthOf = showMonthOf;
  App.applySessionSort = applySessionSort;

})();
