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
    App.showToast('Historical and finalized sessions are read-only. Duplicate to create a new session.', 'warning');
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

    let amountDisplay = formatCurrency(s.amount);
    const splitDisplay = splitAmount > 0
      ? escapeHtml(num(s.companySplit)) + '% / ' + formatCurrency(splitAmount)
      : '-';

    const protectedRow = App.isProtectedSession(s.id);
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
        '<td class="col-actions"><button class="btn btn-sm btn-icon btn-danger" data-action="delete-session" data-id="' + escapeHtml(s.id) + '"' + (protectedRow ? ' disabled title="Read-only record"' : ' title="Delete"') + '><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></td>' +
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
      '<td><span class="payment-badge ' + paymentClass + '">' + paymentLabel + '</span></td>' +
      '<td><span class="' + statusClass + '">' + escapeHtml(s.status || 'completed') + '</span></td>' +
      '<td class="col-actions">' +
        (protectedRow && !App.isArchivedRecord('sessions',s.id) && s.status === 'completed' && !s.paid ? '<button class="btn btn-sm" data-action="record-payment" data-id="' + escapeHtml(s.id) + '">Record payment</button>' : '') +
        '<button class="btn btn-sm btn-icon" data-action="edit-session" data-id="' + escapeHtml(s.id) + '"' + (protectedRow ? ' title="View (read-only record)"' : ' title="Edit"') + '><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>' +
        '<button class="btn btn-sm btn-icon" data-action="duplicate-session" data-id="' + escapeHtml(s.id) + '" title="Duplicate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>' +
        '<button class="btn btn-sm btn-icon btn-danger" data-action="delete-session" data-id="' + escapeHtml(s.id) + '"' + (protectedRow ? ' disabled title="Read-only record"' : ' title="Delete"') + '><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>' +
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
    else if (payment === 'unpaid') filtered = filtered.filter((s) => !s.paid && s.payment !== 'waived');
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
          va = a.paid ? 'a' : 'b';
          vb = b.paid ? 'a' : 'b';
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
    if (!archived) {
      appendEvidence('Later payment events — separate from the original record', snapshot.events.filter((event) => String(event.sessionId) === String(id)));
    }
    App.openModal('modal-session-detail');
  }

  function openSessionForm(id, prefillDate) {
    if (id && App.isProtectedSession(id)) return openSessionDetail(id);
    sessionFormRevision = App.repository.revision;
    const sessions = App.state.sessions;
    const clients = App.state.clients;
    const settings = App.state.settings;

    const modal = $('modal-session');
    const title = $('modal-session-title');
    const form = $('session-form');
    if (!modal || !form) return;

    form.reset();
    $('session-id').value = '';

    // Populate client dropdown
    const clientSelect = $('session-clients');
    if (clientSelect) {
      clientSelect.innerHTML = clients
        .filter((c) => c.status === 'active')
        .sort((a, b) => clientName(a).localeCompare(clientName(b)))
        .map((c) => '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(clientName(c)) +
          ' (' + formatCurrency(c.rate) + '/hr)</option>')
        .join('');
    }

    if (id) {
      const s = sessions.find((ses) => String(ses.id) === String(id));
      if (!s) return;
      if (title) title.textContent = 'Edit Session';
      $('session-id').value = s.id;
      $('session-date').value = s.date || '';
      $('session-time').value = s.time || '';
      $('session-type').value = s.type || 'in-person';
      $('session-duration').value = s.duration || 1;
      $('session-amount').value = s.amount == null ? '' : s.amount;
      $('session-mileage').value = s.mileage || '';
      $('session-payment').value = s.paid ? 'paid' : (s.payment === 'waived' ? 'waived' : 'unpaid');
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
    }

    App.openModal('modal-session');
    updateSessionPrefill();
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
    if (id && rejectProtected(id)) return false;

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
      paymentDate: paid ? todayISO() : null,
      status: $('session-status').value || 'completed',
      mileage: num($('session-mileage').value),
      mileageDetails: '',
      // Mileage is entered before finalization; no background writes follow.
      mileageCalculated: num($('session-mileage').value) > 0,
      // Hand-entered mileage is FINAL: day recalcs must never overwrite it.
      mileageManual: num($('session-mileage').value) > 0,
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
      sessionData.mileageManual = prev.mileageManual === true ||
        (mileageVal > 0 && mileageVal !== num(prev.mileage));
      // Cash-basis integrity: editing an ALREADY-paid session must not
      // re-stamp its payment date (that would move income between tax years).
      // Only an unpaid -> paid transition gets today's date.
      if (paid && prev.paid && prev.paymentDate) {
        sessionData.paymentDate = prev.paymentDate;
      }

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

  function deleteSession(id) {
    if (rejectProtected(id)) return;
    const revision = App.repository.revision;
    const s = App.state.sessions.find((ses) => String(ses.id) === String(id));
    if (!s) return;
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
     MILEAGE CALCULATION
     ========================================================== */

  async function geocode(address) {
    const settings = App.state.settings;
    if (!address || !settings.orsApiKey) return null;
    try {
      // Key goes in the Authorization header, never the query string: URLs leak
      // into browser history, referrers and network logs. Matches routeDist().
      const url = 'https://api.openrouteservice.org/geocode/search?text=' +
        encodeURIComponent(address) +
        '&size=1&boundary.country=US';
      const resp = await fetch(url, { headers: { Authorization: settings.orsApiKey } });
      const data = await resp.json();
      if (data.features && data.features.length > 0) {
        const coords = data.features[0].geometry.coordinates;
        return [coords[0], coords[1]]; // [lng, lat]
      }
    } catch (e) {
      console.error('Geocode error:', e);
    }
    return null;
  }

  async function routeDist(coords1, coords2) {
    const settings = App.state.settings;
    if (!settings.orsApiKey) return null;
    try {
      const resp = await fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
        method: 'POST',
        headers: {
          Authorization: settings.orsApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          coordinates: [coords1, coords2],
        }),
      });
      const data = await resp.json();
      if (data.routes && data.routes.length > 0) {
        return data.routes[0].summary.distance / 1609.34; // meters to miles
      }
    } catch (e) {
      console.error('Route error:', e);
    }
    return null;
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 3958.8; // Earth radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function fallbackDist(addr1, addr2) {
    if (!addr1 || !addr2) return 0;
    const city1 = (addr1.split(',')[1] || '').trim().toLowerCase();
    const city2 = (addr2.split(',')[1] || '').trim().toLowerCase();
    if (city1 && city2 && city1 === city2) return 3;
    return 8;
  }

  async function calculateMileage(address) {
    const settings = App.state.settings;
    if (!address) return 0;
    const homeAddr = settings.businessAddress;
    if (!homeAddr) return 0;

    // Try ORS API first
    if (settings.orsApiKey) {
      try {
        const homeCoords = await geocode(homeAddr);
        const destCoords = await geocode(address);
        if (homeCoords && destCoords) {
          const dist = await routeDist(homeCoords, destCoords);
          if (dist != null) return Math.round(dist * 2 * 10) / 10; // Round trip

          // Fallback to haversine
          const hvDist = haversine(homeCoords[1], homeCoords[0], destCoords[1], destCoords[0]);
          return Math.round(hvDist * 1.3 * 2 * 10) / 10; // *1.3 road factor, round trip
        }
      } catch (e) {
        console.error('Mileage calc error:', e);
      }
    }

    // Crude fallback
    return fallbackDist(homeAddr, address) * 2;
  }

  // Bulk/day recalculation stays unavailable until complete proposed routes can be
  // validated and committed atomically. Manual mileage is saved with the form.
  async function autoCalcDayMileage() {
    App.showToast('Automatic mileage recalculation is unavailable. Enter mileage before finalizing a new session.', 'warning');
    return false;
  }

  async function recalc2026Mileage() {
    App.showToast('Historical mileage is read-only. Bulk recalculation is unavailable.', 'warning');
    return false;
  }

  // Expose to App namespace
  App.renderSessions = renderSessions;
  App.setSessionMonth = setSessionMonth;
  App.getSessionMonth = () => sessionMonth;
  App.sessionScopeLabel = sessionScopeLabel;
  App.openSessionForm = openSessionForm;
  App.openSessionDetail = openSessionDetail;
  App.saveSession = saveSession;
  App.duplicateSession = duplicateSession;
  App.deleteSession = deleteSession;
  App.handleInlineEdit = handleInlineEdit;
  App.updateBulkBar = updateBulkBar;
  App.applySessionFilters = applySessionFilters;
  App.calculateMileage = calculateMileage;
  App.recalc2026Mileage = recalc2026Mileage;
  App.autoCalcDayMileage = autoCalcDayMileage;
  App.sessionSort = sessionSort;
  App.populateClientFilter = populateClientFilter;
  App.updateSessionPrefill = updateSessionPrefill;
  App.repeatLastSession = repeatLastSession;

})();
