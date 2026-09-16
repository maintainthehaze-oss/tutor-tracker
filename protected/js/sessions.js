/* ============================================================
   Tutoring Tracker Pro — Sessions
   Session CRUD, sorting, filtering, mileage calculation
   ============================================================ */
(function () {
  'use strict';

  const App = window.App;
  const $ = App.$;
  const escapeHtml = App.escapeHtml;
  const generateId = App.generateId;
  const formatCurrency = App.formatCurrency;
  const formatDate = App.formatDate;
  const formatDuration = App.formatDuration;
  const todayISO = App.todayISO;
  const num = App.num;
  const clientName = App.clientName;

  let sessionFormRevision = null;

  function rejectProtected(id) {
    if (!App.isProtectedSession(id)) return false;
    App.showToast('Locked session: use the pencil to save a correction, or Duplicate it.', 'warning');
    return true;
  }

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

    // Render table
    const tbody = $('sessions-tbody');
    if (!tbody) return;

    if (filtered.length === 0) {
      const hint = sessionMonth
        ? 'No sessions in ' + escapeHtml(monthLabel(sessionMonth)) + '. <button class="btn btn-sm" data-action="session-month-all">Show all time</button>'
        : 'No sessions match your filters';
      tbody.innerHTML = '<tr class="empty-row"><td colspan="11">' + hint + '</td></tr>';
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
    const typeClass = 'type-badge type-' + (s.type || 'in-person');
    const paymentClass = s.paid ? 'payment-paid' : (s.payment === 'waived' ? 'payment-waived' : 'payment-unpaid');
    const paymentLabel = s.paid ? 'Paid' : (s.payment === 'waived' ? 'Waived' : 'Unpaid');
    const statusClass = 'status-badge status-' + (s.status || 'completed');
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
        '<td class="col-client">' + escapeHtml(clientNames) + '</td>' +
        '<td><span class="' + typeClass + '">' + escapeHtml(typeLabels[s.type] || s.type || 'In Person') + '</span></td>' +
        '<td><input type="number" class="input input-sm" value="' + num(s.duration) + '" step="0.25" min="0.25" data-field="duration" data-action="inline-edit" data-id="' + escapeHtml(s.id) + '"></td>' +
        '<td><input type="number" class="input input-sm" value="' + num(s.amount) + '" step="0.01" min="0" data-field="amount" data-action="inline-edit" data-id="' + escapeHtml(s.id) + '"></td>' +
        '<td class="split-info">' + splitDisplay + '</td>' +
        '<td>' + (num(s.mileage) > 0 ? num(s.mileage).toFixed(1) + ' mi' : '-') + '</td>' +
        '<td><select class="input input-sm" data-field="payment" data-action="inline-edit" data-id="' + escapeHtml(s.id) + '">' +
          '<option value="paid"' + (s.paid ? ' selected' : '') + '>Paid</option>' +
          '<option value="unpaid"' + (!s.paid && s.payment !== 'waived' ? ' selected' : '') + '>Unpaid</option>' +
          '<option value="waived"' + (s.payment === 'waived' ? ' selected' : '') + '>Waived</option>' +
        '</select></td>' +
        '<td><select class="input input-sm" data-field="status" data-action="inline-edit" data-id="' + escapeHtml(s.id) + '">' +
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
      '<td class="col-client">' + escapeHtml(clientNames || '-') + '</td>' +
      '<td><span class="' + typeClass + '">' + escapeHtml(typeLabels[s.type] || s.type || 'In Person') + '</span></td>' +
      '<td>' + formatDuration(s.duration) + '</td>' +
      '<td>' + amountDisplay + '</td>' +
      '<td class="split-info">' + splitDisplay + '</td>' +
      '<td>' + (num(s.mileage) > 0 ? num(s.mileage).toFixed(1) + ' mi' : '-') + '</td>' +
      '<td>' + paymentCell + '</td>' +
      '<td>' + statusCell + '</td>' +
      '<td class="col-actions">' +
        (protectedRow && s.status === 'completed' && !s.paid && !App.isWaived(s) ? '<button class="btn btn-sm" data-action="mark-paid" data-id="' + escapeHtml(s.id) + '" title="Mark this session paid">Mark paid</button>' : '') +
        '<button class="btn btn-sm btn-icon" data-action="edit-session" data-id="' + escapeHtml(s.id) + '"' + (protectedRow ? ' title="View (read-only record)"' : ' title="Edit"') + '><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>' +
        '<button class="btn btn-sm btn-icon" data-action="duplicate-session" data-id="' + escapeHtml(s.id) + '" title="Duplicate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>' +
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

    return arr.sort((a, b) => {
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
    });
  }

  function updateSessionTotals(filtered) {
    const completed = filtered.filter((s) => s.status === 'completed');
    const totalDur = completed.reduce((sum, s) => sum + num(s.duration), 0);
    // Waived fees are not revenue (App.revenueAmount returns 0 for them).
    const totalAmt = completed.reduce((sum, s) => sum + App.revenueAmount(s), 0);
    const totalMiles = completed.reduce((sum, s) => sum + num(s.mileage), 0);

    // Projected revenue = scheduled (not-yet-realized) sessions in the current view.
    // Kept separate from realized totals on purpose; the app only counts completed as revenue.
    const scheduled = filtered.filter((s) => s.status === 'scheduled');
    const projectedAmt = scheduled.reduce((sum, s) => sum + App.revenueAmount(s), 0);

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

  function openSessionDetail(id) {
    if (!App.isProtectedSession(id)) return;
    const snapshot = App.repository.snapshot();
    const archived = App.isArchivedRecord('sessions', id);
    const evidence = archived ? snapshot.archive.originals : snapshot.finalized[String(id)];
    const record = archived
      ? evidence.sessions.find((s) => String(s.id) === String(id))
      : evidence && evidence.record;
    const content = $('session-detail-content');
    if (!record || !content) return;

    const title = $('modal-session-detail-title');
    if (title) title.textContent = archived ? 'Historical session — read-only' : 'Finalized session — read-only';
    const rawValue = (field) => Object.hasOwn(record, field) ? JSON.stringify(record[field]) : 'Missing (not stored)';
    const fields = [
      ['Date', 'date'], ['Time', 'time'], ['Duration', 'duration'],
      ['Amount', 'amount'], ['Rate', 'rate'], ['Hourly rate', 'hourlyRate'],
      ['Company share percent', 'companySplit'], ['Company share amount', 'companyAmount'],
      ['Status', 'status'], ['Paid', 'paid'], ['Payment', 'payment'], ['Payment date', 'paymentDate']
    ];
    content.innerHTML = '<p>Original stored values. Missing means the field was not stored; null is an explicitly stored empty value. Quoted values are text. No values below are recalculated.</p>' +
      '<dl>' + fields.map(([label, field]) => {
        const cls = /^company/.test(field) ? ' class="split-info"' : '';
        return '<dt' + cls + '>' + label + '</dt><dd' + cls + '>' + escapeHtml(rawValue(field)) + '</dd>';
      }).join('') + '</dl>';
    const appendEvidence = (label, value) => {
      const heading = document.createElement('h3');
      heading.textContent = label;
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(value, null, 2);
      content.append(heading, pre);
    };
    appendEvidence('Original session record', record);
    const clientIds = Array.isArray(record.clientIds) ? record.clientIds :
      (Object.hasOwn(record, 'clientId') ? [record.clientId] : []);
    appendEvidence('Clients captured with the original record', evidence.clients.filter((client) =>
      clientIds.some((clientId) => String(clientId) === String(client.id))));
    // Show stored pricing defaults only, never unrelated settings such as credentials.
    const pricingSettings = {};
    Object.keys(evidence.settings).filter((field) => /rate|price|split|company|duration/i.test(field)).forEach((field) => {
      pricingSettings[field] = evidence.settings[field];
    });
    appendEvidence('Original pricing settings (stored fields only)', pricingSettings);
    appendEvidence('Later events (status, payment, corrections) — separate from the original record', snapshot.events.filter((event) => String(event.sessionId) === String(id)));
    App.openModal('modal-session-detail');
  }

  function openSessionForm(id, prefillDate) {
    const locked = !!id && App.isProtectedSession(id);
    sessionFormRevision = App.repository.revision;
    const sessions = App.state.sessions;
    const clients = App.state.clients;
    const settings = App.state.settings;

    const modal = $('modal-session');
    const title = $('modal-session-title');
    const form = $('session-form');
    if (!modal || !form) return;

    form.reset();
    delete $('session-mileage').dataset.details;
    $('session-id').value = '';
    const note = $('session-protected-note');
    if (note) note.hidden = !locked;
    const editing = id ? sessions.find((ses) => String(ses.id) === String(id)) : null;
    const editingClientIds = editing && Array.isArray(editing.clientIds) ? editing.clientIds.map(String) : [];
    // A locked session can only carry a real outcome; it never goes back to scheduled.
    const scheduledOpt = $('session-status') && $('session-status').querySelector('option[value="scheduled"]');
    if (scheduledOpt) scheduledOpt.disabled = locked;

    // Populate client dropdown: active clients, plus whoever is on the session being edited (may be inactive now).
    const clientSelect = $('session-clients');
    if (clientSelect) {
      clientSelect.innerHTML = clients
        .filter((c) => c.status === 'active' || editingClientIds.includes(String(c.id)))
        .sort((a, b) => clientName(a).localeCompare(clientName(b)))
        .map((c) => '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(clientName(c)) +
          ' (' + formatCurrency(c.rate) + '/hr)</option>')
        .join('');
    }

    if (id) {
      const s = sessions.find((ses) => String(ses.id) === String(id));
      if (!s) return;
      if (title) title.textContent = locked ? 'Edit Session (original kept)' : 'Edit Session';
      $('session-id').value = s.id;
      $('session-date').value = s.date || '';
      $('session-time').value = s.time || '';
      $('session-type').value = s.type || 'in-person';
      $('session-duration').value = s.duration || 1;
      $('session-amount').value = s.amount == null ? '' : s.amount;
      $('session-mileage').value = s.mileage || '';
      $('session-payment').value = s.paid ? 'paid' : (s.payment === 'waived' ? 'waived' : 'unpaid');
      $('session-payment-date').value = s.paymentDate || todayISO();
      $('session-status').value = s.status || 'completed';
      $('session-notes').value = s.notes || '';

      // Select clients
      if (clientSelect && s.clientIds) {
        Array.from(clientSelect.options).forEach((opt) => {
          opt.selected = s.clientIds.some((cid) => String(cid) === String(opt.value));
        });
      }
    } else {
      if (title) title.textContent = 'Add Session';
      $('session-date').value = prefillDate || todayISO();
      $('session-duration').value = settings.defaultDuration || 1;
      $('session-status').value = 'scheduled';
      $('session-payment-date').value = todayISO();
    }

    togglePaymentDate();
    App.openModal('modal-session');
    updateSessionPrefill();
  }

  /** "Paid on" is only meaningful when the payment status is paid. */
  function togglePaymentDate() {
    const group = $('session-payment-date-group');
    if (group) group.hidden = $('session-payment').value !== 'paid';
  }

  /**
   * Locked (archived or finalized) sessions are edited through append-only correction events:
   * only the fields that actually changed are recorded; the original record is never touched.
   */
  async function saveCorrection(id, form) {
    const prev = App.state.sessions.find((s) => String(s.id) === String(id));
    if (!prev) return false;
    const fields = {};
    const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
    const prevClientIds = (prev.clientIds || []).map(String);
    if (!same(form.clientIds.map(String), prevClientIds)) fields.clientIds = form.clientIds;
    // Compare against what the form showed for the stored record (older rows omit some fields entirely).
    const shown = { date: prev.date || '', time: prev.time || '', type: prev.type || 'in-person', status: prev.status || 'completed',
      notes: prev.notes || '', payment: prev.paid ? 'paid' : (prev.payment === 'waived' ? 'waived' : 'unpaid') };
    Object.keys(shown).forEach((k) => { if (!same(form[k], shown[k])) fields[k] = form[k]; });
    if (num(form.duration) !== num(prev.duration)) fields.duration = num(form.duration);
    if (num(form.amount) !== num(prev.amount)) fields.amount = num(form.amount);
    if (num(form.mileage) !== num(prev.mileage)) {
      fields.mileage = num(form.mileage);
      fields.mileageManual = !form.mileageDetails;
      if (form.mileageDetails) fields.mileageDetails = form.mileageDetails;
    }
    if (form.paid !== !!prev.paid) fields.paid = form.paid;
    if (!same(form.paymentDate, prev.paymentDate == null ? null : prev.paymentDate)) fields.paymentDate = form.paymentDate;
    if ('paid' in fields || 'payment' in fields) { fields.paid = form.paid; fields.payment = form.payment; fields.paymentDate = form.paymentDate; }
    if (Object.keys(fields).length === 0) { App.closeModal('modal-session'); App.showToast('No changes', 'info'); return true; }
    const saved = await App.runCommand('session.correct', { id, fields }, sessionFormRevision);
    if (!saved) return false;
    App.closeModal('modal-session');
    showMonthOf(form.date);
    App.showToast('Correction saved; original kept on file', 'success');
    return true;
  }

  /** Most recent completed session for a single client (by date, then createdAt). */
  function lastSessionForClient(clientId) {
    const sessions = App.state.sessions;
    const editingId = $('session-id').value;
    const matches = sessions.filter((s) =>
      String(s.id) !== String(editingId) &&
      s.status === 'completed' &&
      (s.clientIds || []).some((cid) => String(cid) === String(clientId))
    );
    if (matches.length === 0) return null;
    matches.sort((a, b) => {
      const d = (b.date || '').localeCompare(a.date || '');
      if (d !== 0) return d;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
    return matches[0];
  }

  /**
   * Refresh the live amount placeholder (rate x duration) and the
   * "Repeat last session" banner based on the currently selected client(s).
   * Only fires for brand-new sessions, not when editing an existing one.
   */
  function updateSessionPrefill() {
    const clients = App.state.clients;
    const clientSelect = $('session-clients');
    const amountEl = $('session-amount');
    const banner = $('repeat-last-banner');
    const isEditing = !!$('session-id').value;

    const selected = clientSelect ? Array.from(clientSelect.selectedOptions).map((o) => o.value) : [];

    // Live amount placeholder = avg rate x duration
    if (amountEl) {
      const duration = num($('session-duration').value) || 0;
      const rates = selected.map((cid) => {
        const c = clients.find((cl) => String(cl.id) === String(cid));
        return c ? num(c.rate) : 0;
      }).filter((r) => r > 0);
      if (rates.length > 0 && duration > 0) {
        const avg = rates.reduce((s, r) => s + r, 0) / rates.length;
        amountEl.placeholder = formatCurrency(avg * duration) + ' (auto)';
      } else {
        amountEl.placeholder = 'Auto-calculated';
      }
    }

    // Repeat-last banner: only for a single selected client on a new session
    if (banner) {
      const textEl = $('repeat-last-text');
      if (!isEditing && selected.length === 1) {
        const last = lastSessionForClient(selected[0]);
        if (last) {
          banner.hidden = false;
          if (textEl) {
            textEl.textContent = 'Repeat last session (' +
              formatDate(last.date) + ' · ' + formatDuration(last.duration) + ' · ' +
              formatCurrency(last.amount) + ')';
          }
          banner.dataset.lastId = last.id;
        } else {
          banner.hidden = true;
          banner.dataset.lastId = '';
        }
      } else {
        banner.hidden = true;
        banner.dataset.lastId = '';
      }
    }
  }

  /** Fill the open session form from a client's most recent session. */
  function repeatLastSession() {
    if ($('session-id').value) return;
    const banner = $('repeat-last-banner');
    if (!banner || !banner.dataset.lastId) return;
    const sessions = App.state.sessions;
    const last = sessions.find((s) => String(s.id) === String(banner.dataset.lastId));
    if (!last) return;

    // Copy the session shape, keeping the form's chosen local date and payment status.
    // NOTE: mileage is intentionally NOT copied — it varies per trip (other
    // families, multi-stop days) and a stale value would skew the deduction.
    $('session-time').value = last.time || '';
    $('session-type').value = last.type || 'in-person';
    $('session-duration').value = num(last.duration) || 1;
    $('session-amount').value = last.amount == null ? '' : last.amount;
    $('session-mileage').value = '';
    if (last.notes) $('session-notes').value = last.notes;

    App.showToast('Filled from ' + formatDate(last.date) + ' session (mileage left blank)', 'success');
    updateSessionPrefill();
  }

  async function saveSession() {
    const sessions = App.state.sessions;
    const clients = App.state.clients;

    const date = $('session-date').value;
    const clientSelect = $('session-clients');
    const selectedClients = clientSelect
      ? Array.from(clientSelect.selectedOptions).map((o) => {
        const client = clients.find((c) => String(c.id) === String(o.value));
        return client ? client.id : o.value;
      })
      : [];
    const duration = num($('session-duration').value);

    if (!date) {
      App.showToast('Date is required', 'error');
      $('session-date').focus();
      return;
    }
    if (selectedClients.length === 0) {
      App.showToast('Select at least one client', 'error');
      return;
    }
    if (duration <= 0) {
      App.showToast('Duration must be greater than 0', 'error');
      $('session-duration').focus();
      return;
    }

    // Auto-calculate amount if blank
    let amount = num($('session-amount').value);
    if ($('session-amount').value === '') {
      const rates = selectedClients.map((cid) => {
        const c = clients.find((cl) => String(cl.id) === String(cid));
        return c ? num(c.rate) : 0;
      }).filter((r) => r > 0);
      const avgRate = rates.length > 0 ? rates.reduce((s, r) => s + r, 0) / rates.length : 0;
      amount = avgRate * duration;
    }

    // New-record share policy is applied by the repository.
    const primaryClient = clients.find((c) => String(c.id) === String(selectedClients[0]));

    const paymentVal = $('session-payment').value;
    const paid = paymentVal === 'paid';

    const id = $('session-id').value;
    const isNew = !id;
    const paidOn = paid ? ($('session-payment-date').value || todayISO()) : null;
    if (id && App.isProtectedSession(id)) return saveCorrection(id, {
      date, time: $('session-time').value || '', clientIds: selectedClients, type: $('session-type').value || 'in-person',
      duration, amount, paid, payment: paymentVal, paymentDate: paidOn, status: $('session-status').value || 'completed',
      mileage: num($('session-mileage').value), mileageDetails: $('session-mileage').dataset.details || '',
      notes: ($('session-notes').value || '').trim(),
    });

    const sessionData = {
      id: id || generateId(),
      date,
      time: $('session-time').value || '',
      clientIds: selectedClients,
      type: $('session-type').value || 'in-person',
      duration,
      amount,
      paid,
      payment: paymentVal,
      paymentDate: paidOn,
      status: $('session-status').value || 'completed',
      mileage: num($('session-mileage').value),
      // Set by the form's auto-calc button; typing in the field clears it.
      mileageDetails: $('session-mileage').dataset.details || '',
      // Mileage is entered before finalization; no background writes follow.
      mileageCalculated: num($('session-mileage').value) > 0,
      // Hand-entered mileage is FINAL: nothing may overwrite it.
      mileageManual: num($('session-mileage').value) > 0 && !$('session-mileage').dataset.details,
      address: primaryClient ? primaryClient.address : '',
      notes: ($('session-notes').value || '').trim(),
      ...(isNew ? { recurring: null, createdAt: new Date().toISOString() } : {}),
      updatedAt: new Date().toISOString(),
    };

    if (!isNew) {
      const idx = sessions.findIndex((s) => String(s.id) === String(id));
      if (idx === -1) return;
      const prev = sessions[idx];
      sessionData.id = prev.id;
      if (num(sessionData.mileage) === num(prev.mileage)) {
        delete sessionData.mileageDetails;
        delete sessionData.mileageCalculated;
      }
      // The edit form pre-fills the mileage field with the stored value, so a
      // non-zero value is NOT proof of manual entry. Only treat mileage as
      // manual (frozen against day recalcs) if it was already manual, or the
      // user actually CHANGED the value in this edit.
      const mileageVal = num($('session-mileage').value);
      const mileageAuto = !!$('session-mileage').dataset.details;
      sessionData.mileageManual = !mileageAuto && (prev.mileageManual === true ||
        (mileageVal > 0 && mileageVal !== num(prev.mileage)));
      // Cash-basis integrity: the "Paid on" field is pre-filled with the stored payment date, so an
      // already-paid session keeps its date unless the owner deliberately changes it.

    }

    const saved = await App.runCommand('session.save', { record: sessionData }, sessionFormRevision);
    if (!saved) return false;
    App.closeModal('modal-session');
    showMonthOf(sessionData.date);
    renderSessions();
    App.showToast(isNew ? 'Session added' : 'Session updated', 'success');
    return true;
  }

  async function duplicateSession(id) {
    const revision = App.repository.revision;
    const sessions = App.state.sessions;
    const s = sessions.find((ses) => String(ses.id) === String(id));
    if (!s) return;

    // Copy only the scheduling shape, never archive/finalization/payment evidence.
    const dup = {
      time: s.time || '', type: s.type || 'in-person',
      duration: s.duration, amount: s.amount,
      clientIds: [...(s.clientIds || [])], address: s.address || '', notes: s.notes || '',
      mileage: 0, mileageCalculated: false, mileageManual: false, mileageDetails: ''
    };
    dup.id = generateId();
    dup.date = todayISO();
    dup.paid = false;
    dup.payment = 'unpaid';
    dup.paymentDate = null;
    dup.status = 'scheduled';
    dup.createdAt = new Date().toISOString();
    dup.updatedAt = new Date().toISOString();

    if (!await App.runCommand('session.save', { record: dup }, revision)) return false;
    showMonthOf(dup.date);
    renderSessions();
    App.showToast('Session duplicated', 'success');
    return true;
  }

  /** Trash can on a locked row: deletion is impossible (append-only evidence), so offer a cancel
   *  correction instead. The original stays on file; the row drops out of revenue, hours and miles. */
  function voidLockedSession(s) {
    if (['cancelled', 'no-show'].includes(s.status)) {
      App.showToast('Locked session is already ' + s.status + '. It stays on file and does not count.', 'info');
      return;
    }
    if (s.paid) {
      App.showToast('This session is marked paid. Use the pencil to un-pay it first, then cancel it.', 'warning');
      return;
    }
    const revision = App.repository.revision;
    App.showConfirm('Cancel locked session',
      'Locked sessions are kept on file and cannot be deleted. Mark the ' + formatDate(s.date) +
      ' session as cancelled instead? It drops out of revenue, hours and miles; the original stays on file.',
      async () => {
        if (!await App.runCommand('session.correct', { id: s.id, fields: { status: 'cancelled' } }, revision)) return;
        App.showToast('Session cancelled; original kept on file', 'success');
      });
  }

  function deleteSession(id) {
    const revision = App.repository.revision;
    const s = App.state.sessions.find((ses) => String(ses.id) === String(id));
    if (!s) return;
    if (App.isProtectedSession(id)) { voidLockedSession(s); return; }
    App.showConfirm('Delete Session', 'Delete this session from ' + formatDate(s.date) + '?', async () => {
      if (!await App.runCommand('session.delete', { ids: [id] }, revision)) return;
      App.state.selectedSessions.delete(id);
      updateBulkBar();
      App.showToast('Session deleted', 'success');
    });
  }

  async function handleInlineEdit(el) {
    const revision = App.repository.revision;
    const id = el.getAttribute('data-id');
    const field = el.getAttribute('data-field');
    if (rejectProtected(id)) { renderSessions(); return false; }
    const s = App.state.sessions.find((ses) => String(ses.id) === String(id));
    if (!s) return false;
    const patch = {};
    switch (field) {
      case 'date': case 'time': case 'status': patch[field] = el.value; break;
      case 'duration': case 'amount': patch[field] = num(el.value); break;
      case 'payment':
        patch.paid = el.value === 'paid';
        patch.payment = el.value;
        patch.paymentDate = patch.paid ? (s.paymentDate || todayISO()) : null;
        break;
      default: return false;
    }
    const saved = await App.runCommand('session.update', { ids: [id], patch }, revision);
    if (saved && field === 'date') showMonthOf(patch.date);
    renderSessions();
    return saved;
  }

  /**
   * Scheduled sessions dated before today are treated as having happened and
   * flip to completed on load (owner ruling 2026-09-15). Completed sessions
   * lock, so a session that did NOT happen must be cancelled on or before its
   * date. Rows that would fail validation are left alone rather than blocking
   * the whole batch.
   */
  async function autoCompleteOverdue() {
    if (!App.repository.ready || App.repository.maintenance) return 0;
    const today = todayISO();
    const past = (s) => s.status === 'scheduled' && typeof s.date === 'string' && s.date < today;
    const overdue = App.state.sessions.filter((s) =>
      past(s) && !App.isProtectedSession(s.id) &&
      num(s.duration) > 0 && Number.isFinite(Number(s.amount)) && Number(s.amount) >= 0 &&
      Array.isArray(s.clientIds) && s.clientIds.length > 0);
    // Pre-activation scheduled sessions are read-only; they complete through an append-only status event.
    const archivedOverdue = App.state.sessions.filter((s) => past(s) && App.isArchivedRecord('sessions', s.id));
    let done = 0;
    if (overdue.length && await App.runCommand('session.update',
      { ids: overdue.map((s) => s.id), patch: { status: 'completed' } }, App.repository.revision)) done += overdue.length;
    if (archivedOverdue.length && await App.runCommand('session.status',
      { ids: archivedOverdue.map((s) => s.id), status: 'completed' }, App.repository.revision)) done += archivedOverdue.length;
    if (done === 0) return 0;
    App.showToast(done + ' past scheduled session' + (done === 1 ? '' : 's') +
      ' auto-completed (date has passed)', 'success');
    return done;
  }

  /** Status select on an archived (pre-activation) scheduled row changed. */
  async function setArchivedStatus(el) {
    const id = el.getAttribute('data-id'), status = el.value;
    if (status === 'scheduled') { renderSessions(); return; }
    const ok = await App.runCommand('session.status', { ids: [id], status }, App.repository.revision);
    if (ok) App.showToast('Session marked ' + status, 'success'); else renderSessions();
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

  /* ==========================================================
     MILEAGE CALCULATION (OpenRouteService; day-sequential legs)
     Drive order per day: home -> stop 1 -> ... -> stop n -> home. Each stop is
     credited the leg that arrives at it; the last stop also gets the return
     leg (so a lone session = a round trip). Hand-entered miles are never
     changed, but they still shape the route. Only real driving routes are
     written: no estimates, no guesses. Nothing runs in the background.
     ========================================================== */

  const ORS_BASE = 'https://api.openrouteservice.org';
  const geocodeCache = new Map(); // address -> [lng, lat]
  const routeCache = new Map();   // 'from|to' -> one-way miles
  let orsRouteCalls = 0;
  const ORS_FATAL = /API key|reach OpenRouteService|rate limit|OpenRouteService error|Business Address/;

  // Key goes in the Authorization header, never the query string: URLs leak
  // into browser history, referrers and network logs.
  async function orsFetch(path, options) {
    let resp;
    try {
      resp = await fetch(ORS_BASE + path, options);
    } catch (e) {
      // ORS answers a bad/missing key with 401/403 and NO CORS headers, so the
      // browser reports it as a network failure. Cover both causes.
      throw new Error('Could not reach OpenRouteService. Check the API key in Settings, or your connection.');
    }
    if (resp.status === 401 || resp.status === 403) throw new Error('OpenRouteService rejected the API key. Check it in Settings.');
    if (resp.status === 429) throw new Error('OpenRouteService rate limit reached. Try again in a minute.');
    if (resp.status === 404) return null; // directions: no route between the points
    if (!resp.ok) throw new Error('OpenRouteService error (HTTP ' + resp.status + ').');
    return resp.json();
  }

  /** [lng, lat] for an address, or null when ORS cannot find it. Cached per page load. */
  async function geocode(address) {
    if (geocodeCache.has(address)) return geocodeCache.get(address);
    const data = await orsFetch('/geocode/search?text=' + encodeURIComponent(address) + '&size=1&boundary.country=US',
      { headers: { Authorization: App.state.settings.orsApiKey } });
    if (data && data.features && data.features.length > 0) {
      const c = data.features[0].geometry.coordinates;
      geocodeCache.set(address, [c[0], c[1]]);
      return geocodeCache.get(address);
    }
    return null;
  }

  /** One-way driving miles between two addresses (real route only). Cached per address pair. */
  async function routeMiles(from, to) {
    if (from === to) return 0;
    const k = from + '|' + to;
    if (routeCache.has(k)) return routeCache.get(k);
    const a = await geocode(from);
    if (!a) throw new Error('Could not locate address: ' + from);
    const b = await geocode(to);
    if (!b) throw new Error('Could not locate address: ' + to);
    const data = await orsFetch('/v2/directions/driving-car', {
      method: 'POST',
      headers: { Authorization: App.state.settings.orsApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: [a, b] }),
    });
    orsRouteCalls++;
    if (!data || !data.routes || !data.routes.length) throw new Error('No driving route between ' + from + ' and ' + to);
    const miles = data.routes[0].summary.distance / 1609.34;
    routeCache.set(k, miles);
    // Free ORS tier allows 40 directions calls a minute; pace long runs.
    await new Promise((r) => setTimeout(r, orsRouteCalls > 30 ? 1600 : 250));
    return miles;
  }

  /** Where a session happened: the address stored on it, else the first of its clients with one. */
  function sessionAddress(s) {
    if (s.address && s.address.trim()) return s.address.trim();
    for (const cid of (s.clientIds || [])) {
      const c = App.state.clients.find((cl) => String(cl.id) === String(cid));
      if (c && c.address && c.address.trim()) return c.address.trim();
    }
    return '';
  }

  function isDriveStop(s) {
    return (s.type || 'in-person') !== 'online' && ['completed', 'scheduled'].includes(s.status || 'completed');
  }

  /** Values this tool may (re)write: hand-entered miles are final; miles from the retired
   *  root app's own recalc ("Leg n of m (real route)") are left alone as well. */
  const OWN_DETAILS = /^(Driving route, round trip:|Straight-line estimate|Leg \d+ of \d+ .*\(driving route, day order\))/;
  function isAutoMileage(s) {
    return s.mileageManual !== true && (num(s.mileage) === 0 || OWN_DETAILS.test(s.mileageDetails || ''));
  }

  /** The day's stops in drive order (by time; blank time first). `extra` = an unsaved form session. */
  function dayStops(date, extra, excludeId) {
    const rows = App.state.sessions
      .filter((s) => s.date === date && String(s.id) !== String(excludeId) && isDriveStop(s))
      .map((s) => ({ session: s, address: sessionAddress(s), time: s.time || '' }));
    if (extra) rows.push(extra);
    rows.sort((a, b) => a.time.localeCompare(b.time));
    return rows;
  }

  /** Route one day's stops home -> ... -> home. Returns the stops with miles + details, or throws. */
  async function planDay(stops) {
    const home = (App.state.settings.businessAddress || '').trim();
    const missing = stops.find((x) => !x.address);
    if (missing) throw new Error('A session that day has no address (client has none on file).');
    const route = [home, ...stops.map((x) => x.address), home];
    const legs = [];
    for (let i = 0; i < route.length - 1; i++) legs.push(await routeMiles(route[i], route[i + 1]));
    return stops.map((x, i) => {
      const last = i === stops.length - 1;
      const miles = legs[i] + (last ? legs[legs.length - 1] : 0);
      return { ...x, miles: Math.round(miles * 10) / 10,
        details: 'Leg ' + (i + 1) + ' of ' + stops.length + (last ? ' + return home' : '') + ' (driving route, day order)' };
    });
  }

  function requireMileageSetup() {
    const settings = App.state.settings;
    if (!(settings.businessAddress || '').trim()) throw new Error('Set your Business Address in Settings first.');
    if (!settings.orsApiKey) throw new Error('Add your OpenRouteService API key in Settings first.');
  }

  /** Session-form pin button: this session's leg within its day, in drive order. Editable before save. */
  async function calcFormMileage() {
    const input = $('session-mileage');
    const btn = document.querySelector('[data-action="calc-mileage"]');
    if (!input) return false;
    const clientSelect = $('session-clients');
    const selected = clientSelect ? Array.from(clientSelect.selectedOptions).map((o) => o.value) : [];
    if (selected.length === 0) { App.showToast('Select a client first', 'warning'); return false; }
    if (($('session-type').value || 'in-person') === 'online') {
      App.showToast('Online session: no travel. Change Session Type to In Person to calculate mileage.', 'warning');
      return false;
    }
    const date = $('session-date').value;
    if (!date) { App.showToast('Enter the session date first', 'warning'); return false; }
    const address = sessionAddress({ clientIds: selected });
    if (btn) btn.disabled = true;
    try {
      requireMileageSetup();
      if (!address) throw new Error('This client has no address on file. Add it on the Clients tab.');
      const extra = { session: null, address, time: $('session-time').value || '' };
      const planned = await planDay(dayStops(date, extra, $('session-id').value));
      const mine = planned.find((x) => x.session === null);
      input.value = mine.miles;
      input.dataset.details = mine.details;
      const others = planned.filter((x) => x.session && isAutoMileage(x.session) && Math.abs(x.miles - num(x.session.mileage)) >= 0.05);
      App.showToast(mine.miles.toFixed(1) + ' mi: ' + mine.details.replace(' (driving route, day order)', '') +
        ' that day. Edit before saving if needed.' +
        (others.length ? ' ' + others.length + ' other session' + (others.length === 1 ? '' : 's') +
          ' that day will change: run "Calculate mileage by day" in Settings after saving.' : ''),
        others.length ? 'warning' : 'success');
      return true;
    } catch (e) {
      App.showToast(e.message || 'Mileage calculation failed', 'error');
      return false;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // Typing over an auto-calculated figure makes it hand-entered again.
  document.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'session-mileage') delete e.target.dataset.details;
  });

  /** Settings tool: route every day that has an auto-calculable session, in drive order.
   *  Fills 0-mi sessions, corrects this tool's own earlier values, never touches hand-entered miles. */
  async function calculateMileageByDay() {
    try { requireMileageSetup(); } catch (e) { App.showToast(e.message, 'warning'); return false; }
    const dates = new Set();
    let targets = 0;
    App.state.sessions.forEach((s) => {
      if (!isDriveStop(s) || !isAutoMileage(s) || !/^\d{4}-\d{2}-\d{2}$/.test(s.date || '')) return;
      dates.add(s.date); targets++;
    });
    if (!targets) { App.showToast('Nothing to calculate: every in-person session already has miles (hand-entered miles are never changed).', 'info'); return false; }
    const addresses = new Set();
    let noAddress = 0;
    dates.forEach((d) => dayStops(d).forEach((x) => { if (x.address) addresses.add(x.address); else noAddress++; }));
    App.showConfirm('Calculate mileage by day',
      dates.size + ' day' + (dates.size === 1 ? '' : 's') + ' (' + targets + ' session' + (targets === 1 ? '' : 's') + ') will be routed in drive order:' +
      ' home, then each session in time order, then home. Each session gets its own leg; the last one also gets the drive home.' +
      ' Hand-entered miles are never changed. Locked sessions keep their original on file.' +
      (noAddress ? ' ' + noAddress + ' session' + (noAddress === 1 ? '' : 's') + ' with no client address will make their day skip.' : '') +
      ' Up to ' + (addresses.size + 1) + ' addresses go to OpenRouteService. Continue?',
      () => runCalculateMileageByDay([...dates].sort()));
    return true;
  }

  async function runCalculateMileageByDay(dates) {
    const btn = document.querySelector('[data-action="calc-mileage-by-day"]');
    const label = btn ? btn.textContent : '';
    if (btn) btn.disabled = true;
    const updates = [], corrections = [], skipped = [];
    let unchanged = 0;
    try {
      for (let i = 0; i < dates.length; i++) {
        const date = dates[i];
        if (btn) btn.textContent = 'Routing day ' + (i + 1) + ' of ' + dates.length + '...';
        let planned;
        try {
          planned = await planDay(dayStops(date));
        } catch (e) {
          if (ORS_FATAL.test(e.message)) throw e; // key, network, home address: abort the whole run
          skipped.push(formatDate(date) + ': ' + e.message);
          continue;
        }
        planned.forEach((x) => {
          if (!x.session || !isAutoMileage(x.session)) return;
          if (Math.abs(x.miles - num(x.session.mileage)) < 0.05) { unchanged++; return; }
          const fields = { mileage: x.miles, mileageCalculated: true, mileageManual: false, mileageDetails: x.details };
          (App.isProtectedSession(x.session.id) ? corrections : updates).push({ id: x.session.id, fields });
        });
      }
      for (const u of updates) {
        if (!await App.runCommand('session.update', { ids: [u.id], patch: u.fields }, App.repository.revision)) return false;
      }
      if (corrections.length) {
        if (!await App.runCommand('session.correctMany', { items: corrections }, App.repository.revision)) return false;
      }
      const written = updates.length + corrections.length;
      if (skipped.length) console.warn('Calculate mileage by day: days left unchanged:', skipped);
      App.showToast('Mileage set on ' + written + ' session' + (written === 1 ? '' : 's') + ' across ' + dates.length + ' day' + (dates.length === 1 ? '' : 's') + '.' +
        (unchanged ? ' ' + unchanged + ' already correct.' : '') +
        (skipped.length ? ' ' + skipped.length + ' day' + (skipped.length === 1 ? '' : 's') + ' skipped (no address or no route); see console.' : ''),
        skipped.length ? 'warning' : 'success');
      return true;
    } catch (e) {
      App.showToast(e.message || 'Mileage calculation failed', 'error');
      return false;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  }

  // Expose to App namespace
  App.renderSessions = renderSessions;
  App.setSessionMonth = setSessionMonth;
  App.getSessionMonth = () => sessionMonth;
  App.sessionScopeLabel = sessionScopeLabel;
  App.openSessionForm = openSessionForm;
  App.togglePaymentDate = togglePaymentDate;
  App.openSessionDetail = openSessionDetail;
  App.saveSession = saveSession;
  App.duplicateSession = duplicateSession;
  App.deleteSession = deleteSession;
  App.handleInlineEdit = handleInlineEdit;
  App.updateBulkBar = updateBulkBar;
  App.autoCompleteOverdue = autoCompleteOverdue;
  App.setArchivedStatus = setArchivedStatus;
  App.applySessionFilters = applySessionFilters;
  App.calcFormMileage = calcFormMileage;
  App.calculateMileageByDay = calculateMileageByDay;
  App.sessionAddress = sessionAddress;
  App.sessionSort = sessionSort;
  App.populateClientFilter = populateClientFilter;
  App.updateSessionPrefill = updateSessionPrefill;
  App.repeatLastSession = repeatLastSession;

})();
