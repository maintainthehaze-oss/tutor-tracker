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

  let sessionSort = { field: 'date', dir: 'desc' };

  function renderSessions() {
    const sessions = App.state.sessions;

    // Update client count
    const countEl = $('session-count');
    if (countEl) countEl.textContent = sessions.length;

    // Populate filter client dropdown
    populateClientFilter();

    // Monthly summary
    renderMonthlySummary();

    // Apply filters
    let filtered = applySessionFilters();

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
      tbody.innerHTML = '<tr class="empty-row"><td colspan="11">No sessions match your filters</td></tr>';
      updateSessionTotals([]);
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

    if (editMode) {
      return '<tr class="session-row' + (isSelected ? ' selected' : '') + '" data-id="' + escapeHtml(s.id) + '">' +
        '<td class="col-check"><input type="checkbox" data-action="select-session" data-id="' + escapeHtml(s.id) + '"' + (isSelected ? ' checked' : '') + ' aria-label="Select session"></td>' +
        '<td><input type="date" class="input input-sm" value="' + escapeHtml(s.date || '') + '" data-field="date" data-action="inline-edit" data-id="' + escapeHtml(s.id) + '"></td>' +
        '<td><input type="time" class="input input-sm" value="' + escapeHtml(s.time || '') + '" data-field="time" data-action="inline-edit" data-id="' + escapeHtml(s.id) + '"></td>' +
        '<td>' + escapeHtml(clientNames) + '</td>' +
        '<td><span class="' + typeClass + '">' + escapeHtml(typeLabels[s.type] || s.type || 'In Person') + '</span></td>' +
        '<td><input type="number" class="input input-sm" value="' + num(s.duration) + '" step="0.25" min="0.25" data-field="duration" data-action="inline-edit" data-id="' + escapeHtml(s.id) + '"></td>' +
        '<td><input type="number" class="input input-sm" value="' + num(s.amount) + '" step="0.01" min="0" data-field="amount" data-action="inline-edit" data-id="' + escapeHtml(s.id) + '"></td>' +
        '<td>' + splitDisplay + '</td>' +
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
        '<td class="col-actions"><button class="btn btn-sm btn-icon btn-danger" data-action="delete-session" data-id="' + escapeHtml(s.id) + '" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></td>' +
      '</tr>';
    }

    return '<tr class="session-row" data-id="' + escapeHtml(s.id) + '">' +
      '<td>' + escapeHtml(formatDate(s.date)) + '</td>' +
      '<td>' + escapeHtml(s.time || '-') + '</td>' +
      '<td>' + escapeHtml(clientNames || '-') + '</td>' +
      '<td><span class="' + typeClass + '">' + escapeHtml(typeLabels[s.type] || s.type || 'In Person') + '</span></td>' +
      '<td>' + formatDuration(s.duration) + '</td>' +
      '<td>' + amountDisplay + '</td>' +
      '<td>' + splitDisplay + '</td>' +
      '<td>' + (num(s.mileage) > 0 ? num(s.mileage).toFixed(1) + ' mi' : '-') + '</td>' +
      '<td><span class="payment-badge ' + paymentClass + '">' + paymentLabel + '</span></td>' +
      '<td><span class="' + statusClass + '">' + escapeHtml(s.status || 'completed') + '</span></td>' +
      '<td class="col-actions">' +
        '<button class="btn btn-sm btn-icon" data-action="edit-session" data-id="' + escapeHtml(s.id) + '" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>' +
        '<button class="btn btn-sm btn-icon" data-action="duplicate-session" data-id="' + escapeHtml(s.id) + '" title="Duplicate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>' +
        '<button class="btn btn-sm btn-icon btn-danger" data-action="delete-session" data-id="' + escapeHtml(s.id) + '" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>' +
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
    const totalAmt = completed.reduce((sum, s) => sum + num(s.amount), 0);
    const totalMiles = completed.reduce((sum, s) => sum + num(s.mileage), 0);

    const durEl = $('total-duration');
    if (durEl) durEl.textContent = formatDuration(totalDur);
    const amtEl = $('total-amount');
    if (amtEl) amtEl.textContent = formatCurrency(totalAmt);
    const miEl = $('total-mileage');
    if (miEl) miEl.textContent = totalMiles.toFixed(1) + ' mi';
  }

  function renderMonthlySummary() {
    const sessions = App.state.sessions;
    const clients = App.state.clients;

    const now = new Date();
    const monthStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const dateEl = $('monthly-summary-date');
    if (dateEl) dateEl.textContent = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const content = $('monthly-summary-content');
    if (!content) return;

    const monthSessions = sessions.filter((s) => s.date && s.date.startsWith(monthStr) && s.status === 'completed');

    if (monthSessions.length === 0) {
      content.innerHTML = '<p class="empty-state">No completed sessions this month</p>';
      return;
    }

    const totalSessions = monthSessions.length;
    const totalHours = monthSessions.reduce((sum, s) => sum + num(s.duration), 0);
    const totalRevenue = monthSessions.reduce((sum, s) => sum + num(s.amount), 0);
    const totalSplit = monthSessions.reduce((sum, s) => sum + num(s.companyAmount), 0);
    const totalMiles = monthSessions.reduce((sum, s) => sum + num(s.mileage), 0);
    const unpaidCount = sessions.filter((s) => s.date && s.date.startsWith(monthStr) && !s.paid && s.payment !== 'waived').length;

    content.innerHTML =
      '<div class="monthly-stats">' +
        '<div class="monthly-stat"><span class="monthly-stat-value">' + totalSessions + '</span><span class="monthly-stat-label">Sessions</span></div>' +
        '<div class="monthly-stat"><span class="monthly-stat-value">' + formatDuration(totalHours) + '</span><span class="monthly-stat-label">Hours</span></div>' +
        '<div class="monthly-stat"><span class="monthly-stat-value">' + formatCurrency(totalRevenue) + '</span><span class="monthly-stat-label">Revenue</span></div>' +
        (totalSplit > 0 ? '<div class="monthly-stat"><span class="monthly-stat-value">' + formatCurrency(totalSplit) + '</span><span class="monthly-stat-label">Co. Split</span></div>' : '') +
        (totalMiles > 0 ? '<div class="monthly-stat"><span class="monthly-stat-value">' + totalMiles.toFixed(1) + ' mi</span><span class="monthly-stat-label">Mileage</span></div>' : '') +
        (unpaidCount > 0 ? '<div class="monthly-stat monthly-stat-alert"><span class="monthly-stat-value">' + unpaidCount + '</span><span class="monthly-stat-label">Unpaid</span></div>' : '') +
      '</div>';
  }

  function openSessionForm(id, prefillDate) {
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
      $('session-amount').value = s.amount || '';
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
      $('session-status').value = 'completed';
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
    const banner = $('repeat-last-banner');
    if (!banner || !banner.dataset.lastId) return;
    const sessions = App.state.sessions;
    const last = sessions.find((s) => String(s.id) === String(banner.dataset.lastId));
    if (!last) return;

    // Copy the "shape" of the session, but keep today's date and unpaid status.
    // NOTE: mileage is intentionally NOT copied — it varies per trip (other
    // families, multi-stop days) and a stale value would skew the deduction.
    $('session-time').value = last.time || '';
    $('session-type').value = last.type || 'in-person';
    $('session-duration').value = num(last.duration) || 1;
    $('session-amount').value = num(last.amount) || '';
    if (last.notes) $('session-notes').value = last.notes;

    App.showToast('Filled from ' + formatDate(last.date) + ' session (mileage left blank)', 'success');
    updateSessionPrefill();
  }

  /**
   * Recompute a session's company-split snapshot from its clients' split
   * HISTORY on the SESSION's date (not the clients' current split). Uses the
   * highest split among the session's clients — same rule as migrateData().
   * This means editing or backdating a session can never re-stamp it with
   * today's percentage.
   */
  function applySplitSnapshot(s) {
    const clients = App.state.clients;
    const cs = (s.clientIds || [])
      .map((cid) => clients.find((c) => String(c.id) === String(cid)))
      .filter(Boolean);
    s.companySplit = cs.length > 0
      ? Math.max(0, ...cs.map((c) => App.getEffectiveSplit(c, s.date)))
      : 0;
    s.companyAmount = num(s.amount) * (num(s.companySplit) / 100);
  }

  function saveSession() {
    const sessions = App.state.sessions;
    const clients = App.state.clients;

    const date = $('session-date').value;
    const clientSelect = $('session-clients');
    const selectedClients = clientSelect
      ? Array.from(clientSelect.selectedOptions).map((o) => isNaN(o.value) ? o.value : Number(o.value))
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
    if (!$('session-amount').value || amount === 0) {
      const rates = selectedClients.map((cid) => {
        const c = clients.find((cl) => String(cl.id) === String(cid));
        return c ? num(c.rate) : 0;
      }).filter((r) => r > 0);
      const avgRate = rates.length > 0 ? rates.reduce((s, r) => s + r, 0) / rates.length : 0;
      amount = avgRate * duration;
    }

    // Company split is computed date-aware via applySplitSnapshot() below.
    const primaryClient = clients.find((c) => String(c.id) === String(selectedClients[0]));

    const paymentVal = $('session-payment').value;
    const paid = paymentVal === 'paid';

    const id = $('session-id').value;
    const isNew = !id;

    const sessionData = {
      id: id || generateId(),
      date,
      time: $('session-time').value || '',
      clientIds: selectedClients,
      type: $('session-type').value || 'in-person',
      duration,
      amount,
      companySplit: 0,   // set by applySplitSnapshot() below
      companyAmount: 0,  // set by applySplitSnapshot() below
      paid,
      payment: paymentVal,
      paymentDate: paid ? todayISO() : null,
      status: $('session-status').value || 'completed',
      mileage: num($('session-mileage').value),
      mileageDetails: '',
      // If the user typed a mileage by hand, respect it (treat as final). If
      // they left it blank/0, the auto-calc below will fill it in.
      mileageCalculated: num($('session-mileage').value) > 0,
      // Hand-entered mileage is FINAL: day recalcs must never overwrite it.
      mileageManual: num($('session-mileage').value) > 0,
      address: primaryClient ? primaryClient.address : '',
      notes: ($('session-notes').value || '').trim(),
      recurring: null,
      createdAt: isNew ? new Date().toISOString() : undefined,
      updatedAt: new Date().toISOString(),
    };

    // Date-aware split snapshot (uses split history for the session's date)
    applySplitSnapshot(sessionData);

    // Capture whether mileage was hand-entered BEFORE the modal/form resets.
    const mileageEnteredManually = num($('session-mileage').value) > 0;

    if (isNew) {
      sessions.push(sessionData);
    } else {
      const idx = sessions.findIndex((s) => String(s.id) === String(id));
      if (idx === -1) return;
      const prev = sessions[idx];
      sessionData.createdAt = prev.createdAt;
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
      sessions[idx] = sessionData;
    }

    App.closeModal('modal-session');
    const saved = App.saveAndRender();
    if (saved) App.showToast(isNew ? 'Session added' : 'Session updated', 'success');

    // Auto-calculate mileage in the BACKGROUND for in-person completed sessions
    // when the user didn't enter one manually. Recalculates the whole day so
    // multi-stop drive order stays correct. Never blocks the save.
    if (sessionData.status === 'completed' && sessionData.type === 'in-person' && !mileageEnteredManually) {
      autoCalcDayMileage(sessionData.date);
    }
  }

  function duplicateSession(id) {
    const sessions = App.state.sessions;
    const s = sessions.find((ses) => String(ses.id) === String(id));
    if (!s) return;

    const dup = { ...s };
    dup.id = generateId();
    dup.date = todayISO();
    dup.paid = false;
    dup.payment = 'unpaid';
    dup.paymentDate = null;
    dup.status = 'scheduled';
    dup.createdAt = new Date().toISOString();
    dup.updatedAt = new Date().toISOString();

    sessions.push(dup);
    if (App.saveAndRender()) App.showToast('Session duplicated', 'success');
  }

  function deleteSession(id) {
    const sessions = App.state.sessions;
    const s = sessions.find((ses) => String(ses.id) === String(id));
    if (!s) return;

    App.showConfirm('Delete Session', 'Delete this session from ' + formatDate(s.date) + '?', () => {
      App.state.sessions = sessions.filter((ses) => String(ses.id) !== String(id));
      App.state.selectedSessions.delete(id);
      if (App.saveAndRender()) App.showToast('Session deleted', 'success');
    });
  }

  function handleInlineEdit(el) {
    const sessions = App.state.sessions;
    const id = el.getAttribute('data-id');
    const field = el.getAttribute('data-field');
    const s = sessions.find((ses) => String(ses.id) === String(id));
    if (!s) return;

    switch (field) {
      case 'date': s.date = el.value; applySplitSnapshot(s); break;
      case 'time': s.time = el.value; break;
      case 'duration': s.duration = num(el.value); break;
      case 'amount': s.amount = num(el.value); applySplitSnapshot(s); break;
      case 'payment':
        s.paid = el.value === 'paid';
        s.payment = el.value;
        if (s.paid && !s.paymentDate) s.paymentDate = todayISO();
        break;
      case 'status': s.status = el.value; break;
    }
    s.updatedAt = new Date().toISOString();
    App.saveData();
    updateSessionTotals(applySessionFilters());
    App.updateHeaderStats();
    App.scheduleSave();
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
      const url = 'https://api.openrouteservice.org/geocode/search?api_key=' +
        encodeURIComponent(settings.orsApiKey) +
        '&text=' + encodeURIComponent(address) +
        '&size=1&boundary.country=US';
      const resp = await fetch(url);
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

  /* ---- Throttled, cached, real-routes-only mileage (2026 recalc) ----
     The 2026 recalc must NEVER save a crude estimate over real data, and must
     stay under OpenRouteService rate limits. So: geocode each unique address
     once (cached), throttle every API call, retry on failure, and if any leg
     of a day can't get a REAL route, that whole day is skipped (left unchanged)
     and reported — no haversine/town fallbacks are written. */

  const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ORS_DELAY_MS = 1600;   // spacing between API calls (~37/min, under the 40/min cap)
  const ORS_RETRIES = 3;       // attempts per call before giving up

  /** Geocode with retry. Returns [lng,lat] or null. Throttled by caller. */
  async function geocodeRetry(address, cache) {
    if (!address) return null;
    if (cache.has(address)) return cache.get(address);
    let result = null;
    for (let attempt = 0; attempt < ORS_RETRIES; attempt++) {
      result = await geocode(address);
      if (result) break;
      await _sleep(ORS_DELAY_MS * (attempt + 1)); // back off a bit longer each retry
    }
    cache.set(address, result); // cache even null so we don't hammer a bad address
    return result;
  }

  /** Real driving miles (one-way) between two cached coord pairs, with retry.
   *  Returns a number, or null if it never succeeded (NO fallback estimate). */
  async function routeMilesStrict(coordsA, coordsB) {
    if (!coordsA || !coordsB) return null;
    for (let attempt = 0; attempt < ORS_RETRIES; attempt++) {
      const dist = await routeDist(coordsA, coordsB);
      if (dist != null) return dist;
      await _sleep(ORS_DELAY_MS * (attempt + 1));
    }
    return null;
  }

  /**
   * Distance between two ADDRESSES (one-way miles), memoized by address pair so
   * each unique route is fetched from the API only ONCE across the whole run.
   * With ~6 addresses this caps total route calls at ~30 instead of one-per-leg.
   * Returns a number, or null if no real route could be obtained.
   */
  async function pairMiles(addrA, addrB, coordCache, distCache, callCounter) {
    if (!addrA || !addrB) return null;
    if (addrA === addrB) return 0;
    const k = addrA + '' + addrB;
    if (distCache.has(k)) return distCache.get(k);
    const miles = await routeMilesStrict(coordCache.get(addrA), coordCache.get(addrB));
    callCounter.n++;
    await _sleep(ORS_DELAY_MS);
    distCache.set(k, miles);
    return miles;
  }

  /**
   * Resolve the address to route to for a session: prefer the session's own
   * stored address, then fall back to the primary client's address on file.
   */
  function sessionAddress(s) {
    if (s.address && s.address.trim()) return s.address.trim();
    const clients = App.state.clients;
    for (const cid of (s.clientIds || [])) {
      const c = clients.find((cl) => String(cl.id) === String(cid));
      if (c && c.address && c.address.trim()) return c.address.trim();
    }
    return '';
  }

  /**
   * Compute & assign real-route mileage for ONE day's in-person sessions, in
   * drive order (home -> s1 -> ... -> home). Each stop is credited with the leg
   * that arrived at it; the final home leg is added to the last stop. Sets the
   * `mileageCalculated` flag on success. If any leg can't get a real route, the
   * day is left UNTOUCHED and the function returns false (never writes a guess).
   *
   * Shared by the bulk 2026 recalc and the per-day auto-calc on save.
   */
  async function computeDayMileage(date, coordCache, distCache, callCounter) {
    const settings = App.state.settings;
    const homeAddr = settings.businessAddress;
    if (!homeAddr || !settings.orsApiKey) return false;

    const daySessions = App.state.sessions
      .filter((s) => s.date === date && s.status === 'completed' && s.type === 'in-person')
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    if (daySessions.length === 0) return true; // nothing to do

    const stops = daySessions.map((s) => ({ s, addr: sessionAddress(s) }));
    if (stops.some((x) => !x.addr)) return false; // can't route reliably

    // Ensure every address for this day is geocoded (cached)
    const addrs = [homeAddr, ...stops.map((x) => x.addr)];
    for (const a of addrs) {
      if (!coordCache.has(a)) { await geocodeRetry(a, coordCache); await _sleep(ORS_DELAY_MS); }
    }

    const route = [homeAddr, ...stops.map((x) => x.addr), homeAddr];
    const legMilesArr = [];
    for (let i = 0; i < route.length - 1; i++) {
      const miles = await pairMiles(route[i], route[i + 1], coordCache, distCache, callCounter);
      if (miles == null) return false; // real route unavailable — abort, change nothing
      legMilesArr.push(miles);
    }

    stops.forEach((x, i) => {
      // Never overwrite hand-entered (manual) mileage — it is final. The stop
      // still participates in the route above so other legs stay correct. If
      // the LAST stop is manual, the return-home leg is intentionally not
      // re-credited elsewhere (the manual value is taken as the user's total).
      if (x.s.mileageManual) return;
      let m = legMilesArr[i];
      if (i === stops.length - 1) m += legMilesArr[legMilesArr.length - 1];
      x.s.mileage = Math.round(m * 10) / 10;
      x.s.mileageCalculated = true;
      x.s.mileageDetails = (i === stops.length - 1)
        ? ('Leg ' + (i + 1) + ' of ' + stops.length + ' + return home (real route)')
        : ('Leg ' + (i + 1) + ' of ' + stops.length + ' (real route)');
      x.s.updatedAt = new Date().toISOString();
    });
    return true;
  }

  /**
   * Auto-calculate mileage for the day of a session that was just saved, in the
   * BACKGROUND (does not block the save). Recalculates the whole day so drive
   * order stays correct when a session is added/backdated. Silent on success;
   * a quiet toast only if it couldn't get a real route.
   */
  async function autoCalcDayMileage(date) {
    const settings = App.state.settings;
    if (!settings.businessAddress || !settings.orsApiKey) return; // mileage off — skip silently
    const ok = await computeDayMileage(date, new Map(), new Map(), { n: 0 });
    if (ok) {
      App.saveData();
      if (App.state.activeTab === 'sessions') App.renderSessions();
      App.updateHeaderStats();
    } else {
      App.showToast('Mileage for ' + formatDate(date) + ' needs a manual recalc (no route)', 'warning');
    }
  }

  /**
   * Recalculate mileage for 2026 ONLY, per-leg in drive order, REAL routes only.
   * Operates exclusively on live sessions (App.state.sessions). Historical data
   * (tutoring-historical / previous years) is never read or modified here.
   *
   * Strategy:
   *  1. Collect every unique address (home + all 2026 stops), geocode each ONCE.
   *  2. For each day, route home->s1->...->home using cached coords (throttled).
   *  3. Only write a day's mileage if ALL its legs returned real distances.
   *     Days with any failure are left untouched and reported at the end.
   */
  async function recalc2026Mileage() {
    const sessions = App.state.sessions;
    const settings = App.state.settings;
    const homeAddr = settings.businessAddress;

    if (!homeAddr) {
      App.showToast('Set your home-base address in Settings first', 'warning');
      return;
    }
    if (!settings.orsApiKey) {
      App.showToast('Add your OpenRouteService API key in Settings first', 'warning');
      return;
    }

    // Group 2026 in-person sessions by day, in drive order
    const day2026 = {};
    sessions
      .filter((s) => s.date && s.date.slice(0, 4) === '2026' && s.status === 'completed' && s.type === 'in-person')
      .forEach((s) => { (day2026[s.date] = day2026[s.date] || []).push(s); });
    const dates = Object.keys(day2026).sort();
    if (dates.length === 0) {
      App.showToast('No 2026 in-person sessions to calculate', 'info');
      return;
    }
    dates.forEach((d) => day2026[d].sort((a, b) => (a.time || '').localeCompare(b.time || '')));

    // 1) Geocode all unique addresses once (cached + throttled)
    const uniqueAddrs = new Set([homeAddr]);
    dates.forEach((d) => day2026[d].forEach((s) => { const a = sessionAddress(s); if (a) uniqueAddrs.add(a); }));
    const coordCache = new Map();
    App.showToast('Geocoding ' + uniqueAddrs.size + ' addresses…', 'info');
    for (const addr of uniqueAddrs) {
      await geocodeRetry(addr, coordCache);
      await _sleep(ORS_DELAY_MS);
    }

    // 2) Route each day; only commit days where every leg succeeded.
    //    Distances are memoized per address-pair (shared distCache), so repeated
    //    routes across days cost zero extra API calls.
    let daysDone = 0;
    const failedDays = [];
    const distCache = new Map();
    const callCounter = { n: 0 };
    App.showToast('Routing ' + dates.length + ' days (deliberately throttled)…', 'info');

    for (const date of dates) {
      const ok = await computeDayMileage(date, coordCache, distCache, callCounter);
      if (ok) daysDone++; else failedDays.push(date);
    }

    App.saveAndRender();
    if (failedDays.length === 0) {
      App.showToast('2026 mileage done — ' + daysDone + ' days, all real routes', 'success');
    } else {
      App.showToast(daysDone + ' days updated. ' + failedDays.length + ' skipped (left unchanged) — see console.', 'warning');
      console.warn('2026 mileage: days left unchanged (no real route):', failedDays);
    }
  }

  // Expose to App namespace
  App.renderSessions = renderSessions;
  App.openSessionForm = openSessionForm;
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
