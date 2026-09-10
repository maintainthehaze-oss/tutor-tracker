/* ============================================================
   Tutoring Tracker Pro — UI
   Import/export, settings, global search, toasts, modals,
   confirm dialogs, drag & drop receipts, event delegation,
   keyboard shortcuts, initialization
   ============================================================ */
(function () {
  'use strict';

  const App = window.App;
  const $ = App.$;
  const escapeHtml = App.escapeHtml;
  const formatCurrency = App.formatCurrency;
  const formatDate = App.formatDate;
  const todayISO = App.todayISO;
  const num = App.num;
  const clientName = App.clientName;
  const downloadFile = App.downloadFile;
  const EXPENSE_CATEGORIES = App.EXPENSE_CATEGORIES;
  const DEFAULT_SETTINGS = App.DEFAULT_SETTINGS;

  const validTabs = ['dashboard', 'clients', 'sessions', 'expenses', 'reports', 'tax'];
  const production = () => !!App.Repository.productionMode?.();

  /* ==========================================================
     IMPORT / EXPORT
     ========================================================== */

  async function backupData() {
    try {
      const json = await (production() ? App.repository.exportPrivateRecovery() : App.repository.exportPortable());
      downloadFile(json, production() ? 'tutor-tracker-private-recovery.json' : 'synthetic-protected-backup-v2.json', 'application/json');
      showToast(production() ? 'Private recovery saved. Keep this file on your device; it may contain credentials.' : 'Protected backup downloaded. Connection settings stay on this device.', 'success');
    } catch(error) { showToast(error.message, 'error'); }
  }
  let transferGeneration = 0, pendingTransfer = null;
  const transferStamp = () => App.repository.ready ? App.repository.snapshot().integrity : null;
  function describeTransfer(summary) {
    if (typeof summary === 'string') return summary;
    const names = {clients:'client',sessions:'session',expenses:'expense',taxPayments:'tax payment',historical:'historical record',receipts:'receipt',finalized:'locked session',events:'payment event'};
    const counted = (count,label) => count+' '+label+(Number(count)===1?'':'s');
    const added = Object.entries(summary?.added || {}).filter(([,count])=>Number(count)>0)
      .map(([key,count])=>counted(count,names[key]||'record'));
    for (const [key,label] of [['receiptsAdded','receipt'],['finalizationsAdded','locked session record'],['paymentEventsAdded','payment event']]) {
      if (Number(summary?.[key])>0) added.push(counted(summary[key],label));
    }
    return (summary?.message ? summary.message+'\n' : '') +
      (added.length ? 'Adds '+added.join(', ')+'.' : 'No additional records or payment events found.') +
      '\nExisting records stay intact. Conflicting versions cannot be applied.' +
      (summary?.maintenance ? '\nThis restored copy opens in read-only maintenance mode.' : '');
  }
  function presentTransfer(title, stage, apply) {
    pendingTransfer = apply;
    $('transfer-title').textContent = title;
    $('transfer-summary').textContent = describeTransfer(stage.summary);
    $('transfer-apply').disabled = false;
    openModal('modal-transfer');
  }
  async function restoreData(file) {
    if (!file) { $('restore-file-input').click(); return; }
    const generation = ++transferGeneration, before = transferStamp();
    pendingTransfer = null; $('transfer-apply').disabled = true;
    try {
      const text = await file.text();
      if (generation !== transferGeneration || transferStamp() !== before) throw Error('Records changed while reading the file. Choose the backup again.');
      const stage = await (production() ? App.repository.stagePrivateRecovery(text) : App.repository.stagePortable(text));
      if (generation !== transferGeneration) return;
      presentTransfer('Review protected restore', stage, async () => {
        if (production()) await window.TrackerUpgrade.retireLegacyRoot();
        return App.repository.commitPortable(stage.id);
      });
    } catch(error) { showToast(error.message, 'error'); }
  }
  async function stageRehearsal(direction) {
    const generation = ++transferGeneration;
    pendingTransfer = null; $('transfer-apply').disabled = true;
    try {
      const stage = await (direction === 'push' ? App.syncRehearsal.stagePush() : App.syncRehearsal.stagePull());
      if (generation !== transferGeneration) return;
      presentTransfer('Review local rehearsal ' + direction, stage, () => App.syncRehearsal.commit(stage.id));
    } catch(error) { showToast(error.message, 'error'); }
  }
  async function applyTransfer() {
    const apply = pendingTransfer;
    if (!apply) return;
    pendingTransfer = null;
    $('transfer-apply').disabled = true;
    try {
      await apply();
      App.refreshReadViews(); populateReportYears(); updateProtectionStatus();
      App.renderTab(App.state.activeTab); App.updateHeaderStats(); App.updateSyncUI();
      closeModal('modal-transfer');
      showToast('Protected transfer completed locally.', 'success');
    } catch(error) { showToast(error.message, 'error'); }
  }

  function exportCSV(type) {
    const sessions = App.state.sessions;
    const clients = App.state.clients;
    const expenses = App.state.expenses;
    const settings = App.state.settings;

    let csv = '';
    let note = '';
    let filename = '';

    switch (type) {
      case 'clients':
        csv = 'Name,Email,Phone,Address,Rate,Subjects,Status,Family,Company Split\n';
        clients.forEach((c) => {
          csv += csvRow([
            clientName(c), c.email, c.phone, c.address, c.rate, c.subjects,
            c.status, c.familyGroup, c.companySplit,
          ]);
        });
        filename = 'clients-' + todayISO() + '.csv';
        break;

      case 'sessions':
        // Export exactly what the Sessions tab is showing (month + filters), so the
        // file matches the badge. Pick "All time" first for a full export.
        // The scope is named in the filename and the toast so it is never silent.
        csv = 'Date,Time,Client(s),Type,Duration (hrs),Amount,Historical Share,Paid,Status,Mileage,Notes,Source,Raw Evidence JSON\n';
        const shown = App.applySessionFilters();
        const reportSessions = App.reportModel.context('current-v2').sessions;
        note = shown.length + ' session' + (shown.length === 1 ? '' : 's') + ' (' + App.sessionScopeLabel() + ')';
        shown.forEach((s) => {
          const reportSession = reportSessions.find(row => String(row.id) === String(s.id));
          const evidence = reportSession && reportSession._report ? reportSession._report : null;
          const names = (s.clientIds || []).map((id) => {
            const c = (evidence ? evidence.clients : clients).find((cl) => String(cl.id) === String(id));
            return c ? clientName(c) : 'Unknown';
          }).join('; ');
          csv += csvRow([
            s.date, s.time, names, s.type, s.duration, s.amount,
            s.companyAmount, s.paid ? 'Yes' : 'No', s.status, s.mileage, s.notes,
            evidence ? evidence.source : 'current session', JSON.stringify(evidence ? evidence.raw : s),
          ]);
        });
        filename = 'sessions-' + (App.getSessionMonth() || 'all-time') + '-' + todayISO() + '.csv';
        break;

      case 'expenses':
        csv = 'Date,Category,Description,Amount\n';
        expenses.forEach((e) => {
          const catLabel = EXPENSE_CATEGORIES.find((c) => c.value === e.category);
          csv += csvRow([e.date, catLabel ? catLabel.label : e.category, e.description, e.amount]);
        });
        filename = 'expenses-' + todayISO() + '.csv';
        break;

      case 'report': {
        // Same shared metrics model as the on-screen Reports table, so the
        // exported numbers (incl. company split and net) match what's shown.
        const mode = App.reportModel.mode('report');
        const filter = App.getReportFilter();
        const year = parseInt(filter.year);
        const data = App.reportModel.period(filter, mode);
        csv = csvRow(['Report mode', mode]) + csvRow(['Data notice', App.reportModel.notice(data.warnings, mode)]) + csvRow(['Filters', JSON.stringify(filter)]);
        csv += 'Month,Sessions,Hours,Gross Income,Historical Share,Your Cut,Expenses,Net,Miles,Mileage Deduction\n';
        for (let m = 0; m < 12; m++) {
          const monthKey = year + '-' + String(m + 1).padStart(2, '0');
          if (filter.month && filter.month !== monthKey) continue;
          const mm = App.reportModel.period(Object.assign({}, filter, { month: monthKey }), mode);
          const monthName = new Date(year, m, 1).toLocaleDateString('en-US', { month: 'long' });
          csv += csvRow([monthName, mm.sessionCount, mm.hours, mm.gross, mm.companySplit,
            mm.yourCut, mm.totalExpenses, mm.netProfit, mm.miles, mm.mileageDeduction]);
        }
        filename = 'report-' + year + '-' + mode + '.csv';
        break;
      }

      case 'tax': {
        const taxYearSelect = $('tax-year');
        const taxYear = taxYearSelect ? parseInt(taxYearSelect.value) : new Date().getFullYear();
        const data = App.getTaxData(taxYear);
        csv = csvRow(['Report mode', data.mode]) + csvRow(['Data notice', App.reportModel.notice(data.warnings, data.mode)]);
        csv += 'Line,Description,Amount\n';
        csv += csvRow(['1', 'Gross receipts', data.grossIncome]);
        csv += csvRow(['9', 'Car and truck expenses', data.line9]);
        csv += csvRow(['10', 'Commissions and fees', data.line10]);
        csv += csvRow(['15', 'Insurance', data.line15]);
        csv += csvRow(['17', 'Professional services', data.line17]);
        csv += csvRow(['18', 'Office expenses', data.line18]);
        csv += csvRow(['22', 'Supplies', data.line22]);
        csv += csvRow(['24b', 'Deductible meals (50%)', data.line24b]);
        csv += csvRow(['25', 'Utilities', data.line25]);
        csv += csvRow(['27b', 'Other expenses', data.line27b]);
        csv += csvRow(['28', 'Total expenses', data.line28]);
        csv += csvRow(['31', 'Net profit', data.line31]);
        filename = 'tax-summary-' + taxYear + '-' + data.mode + '.csv';
        break;
      }
    }

    if (csv) {
      downloadFile(csv, filename, 'text/csv');
      showToast('CSV exported' + (note ? ': ' + note : ''), 'success');
    }
  }

  function csvRow(fields) {
    return fields.map((f) => {
      let val = f == null ? '' : String(f);
      const numericText = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(val.trim());
      if (typeof f === 'string' && !numericText && /^[\s]*[=+@-]/.test(val)) val = "'" + val;
      if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
        return '"' + val.replace(/"/g, '""') + '"';
      }
      return val;
    }).join(',') + '\n';
  }

  /* ==========================================================
     SETTINGS
     ========================================================== */

  function updateHistoricalStatus() {
    const el = $('historical-status');
    if (!el) return;
    const sessions = typeof App.getHistoricalSessions === 'function' ? App.getHistoricalSessions() : [];
    if (sessions.length === 0) {
      el.textContent = 'No historical data loaded.';
    } else {
      const years = [...new Set(sessions.map((s) => typeof s.date === 'string' ? s.date.slice(0, 4) : ''))].filter(Boolean).sort();
      el.textContent = sessions.length + ' historical records retained locally' + (years.length ? ' (' + years[0] + '–' + years[years.length - 1] + ')' : '') + '. Included in protected backups and the local rehearsal mirror.';
    }
  }

  let settingsRevision;
  function openSettings() {
    settingsRevision = App.repository.revision;
    const settings = App.state.settings;
    const el = (id, val) => { const e = $(id); if (e) e.value = val != null ? val : ''; };
    el('settings-business-name', settings.businessName);
    el('settings-business-address', settings.businessAddress);
    el('settings-irs-rate', settings.mileageRate);
    el('settings-default-duration', settings.defaultDuration);
    el('settings-ors-key', settings.orsApiKey);

    updateHistoricalStatus();
    openModal('modal-settings');
  }

  async function saveSettings() {
    const patch = {
      businessName: ($('settings-business-name').value || '').trim(),
      businessAddress: ($('settings-business-address').value || '').trim(),
      mileageRate: num($('settings-irs-rate').value),
      defaultDuration: num($('settings-default-duration').value),
      autoSync: 'off'
    };
    if(await App.runCommand('settings.update',{patch},settingsRevision)) {
      closeModal('modal-settings'); showToast('Settings saved', 'success');
    }
  }

  function clearAllData() { showToast('Protected evidence cannot be cleared.', 'warning'); }

  /* ==========================================================
     GLOBAL SEARCH
     ========================================================== */

  function performGlobalSearch(query) {
    const clients = App.state.clients;
    const sessions = App.state.sessions;
    const expenses = App.state.expenses;

    const results = $('search-results');
    if (!results) return;

    const q = query.toLowerCase().trim();
    if (!q) {
      results.innerHTML = '<div class="search-empty">Type to search across all your data</div>';
      return;
    }

    let html = '';
    let hasResults = false;

    const matchedClients = clients.filter((c) => {
      const searchable = (clientName(c) + ' ' + (c.email || '') + ' ' + (c.subjects || '') +
        ' ' + (c.phone || '') + ' ' + (c.familyGroup || '')).toLowerCase();
      return searchable.includes(q);
    });

    if (matchedClients.length > 0) {
      hasResults = true;
      html += '<div class="search-group"><h4 class="search-group-title">Clients</h4>';
      matchedClients.slice(0, 5).forEach((c) => {
        html += '<button class="search-result" data-action="search-goto-client" data-id="' + escapeHtml(c.id) + '">' +
          '<span class="search-result-icon">&#128100;</span>' +
          '<div class="search-result-text">' +
          '<strong>' + escapeHtml(clientName(c)) + '</strong>' +
          '<small>' + escapeHtml((c.subjects || '') + (c.email ? ' | ' + c.email : '')) + '</small>' +
          '</div>' +
          '</button>';
      });
      html += '</div>';
    }

    const matchedSessions = sessions.filter((s) => {
      const clientNames = (s.clientIds || []).map((id) => {
        const c = clients.find((cl) => String(cl.id) === String(id));
        return c ? clientName(c) : '';
      }).join(' ');
      const searchable = ((s.date || '') + ' ' + clientNames + ' ' + (s.notes || '') + ' ' + (s.type || '')).toLowerCase();
      return searchable.includes(q);
    });

    if (matchedSessions.length > 0) {
      hasResults = true;
      html += '<div class="search-group"><h4 class="search-group-title">Sessions</h4>';
      matchedSessions.slice(0, 5).forEach((s) => {
        const names = (s.clientIds || []).map((id) => {
          const c = clients.find((cl) => String(cl.id) === String(id));
          return c ? clientName(c) : 'Unknown';
        }).join(', ');
        html += '<button class="search-result" data-action="search-goto-session" data-id="' + escapeHtml(s.id) + '">' +
          '<span class="search-result-icon">&#128337;</span>' +
          '<div class="search-result-text">' +
          '<strong>' + escapeHtml(formatDate(s.date)) + ' - ' + escapeHtml(names) + '</strong>' +
          '<small>' + formatCurrency(s.amount) + ' | ' + escapeHtml(s.status || '') + '</small>' +
          '</div>' +
          '</button>';
      });
      html += '</div>';
    }

    const matchedExpenses = expenses.filter((e) => {
      const searchable = ((e.date || '') + ' ' + (e.description || '') + ' ' + (e.category || '')).toLowerCase();
      return searchable.includes(q);
    });

    if (matchedExpenses.length > 0) {
      hasResults = true;
      html += '<div class="search-group"><h4 class="search-group-title">Expenses</h4>';
      matchedExpenses.slice(0, 5).forEach((e) => {
        html += '<button class="search-result" data-action="search-goto-expense" data-id="' + escapeHtml(e.id) + '">' +
          '<span class="search-result-icon">&#128176;</span>' +
          '<div class="search-result-text">' +
          '<strong>' + escapeHtml(e.description || '') + '</strong>' +
          '<small>' + escapeHtml(formatDate(e.date)) + ' | ' + formatCurrency(e.amount) + '</small>' +
          '</div>' +
          '</button>';
      });
      html += '</div>';
    }

    if (!hasResults) {
      html = '<div class="search-empty">No results for "' + escapeHtml(query) + '"</div>';
    }

    results.innerHTML = html;
  }

  /* ==========================================================
     TOAST NOTIFICATIONS
     ========================================================== */

  function showToast(message, type) {
    const container = $('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast toast-' + (type || 'info');

    const icons = { success: '&#10004;', error: '&#10060;', warning: '&#9888;', info: '&#8505;' };

    toast.innerHTML = '<span class="toast-icon">' + (icons[type] || icons.info) + '</span>' +
      '<span class="toast-message">' + escapeHtml(message) + '</span>' +
      '<button class="toast-close" aria-label="Close">&times;</button>';

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-visible'));

    const timer = setTimeout(() => dismissToast(toast), 3000);
    toast.querySelector('.toast-close').addEventListener('click', () => {
      clearTimeout(timer);
      dismissToast(toast);
    });
  }

  function dismissToast(toast) {
    toast.classList.remove('toast-visible');
    toast.classList.add('toast-hiding');
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
  }

  /* ==========================================================
     MODALS
     ========================================================== */

  // Bumped on every modal open/close so async work started while a modal was
  // open (mileage lookup, OCR) can detect that the modal was closed/reopened
  // in the meantime and discard its result instead of writing into a
  // different, later form.
  let modalGeneration = 0;

  // Element that had focus before a modal opened, keyed by modal id, so
  // closeModal can restore it instead of leaving focus stranded on <body>.
  const modalReturnFocus = {};

  function openModal(id) {
    const overlay = $(id);
    if (!overlay) return;
    modalGeneration++;
    const focusGeneration = modalGeneration;
    modalReturnFocus[id] = document.activeElement;
    overlay.hidden = false;
    requestAnimationFrame(() => {
      if (modalGeneration === focusGeneration && !overlay.hidden) overlay.classList.add('modal-active');
    });
    // Move focus into the modal. Prefer the first form field; for button-only
    // dialogs (confirm, receipt viewer) fall back to the first action button
    // that isn't the header close (×), so focus is never left stranded outside.
    const firstFocusable = overlay.querySelector('input:not([hidden]):not([type="hidden"]), select:not([hidden]), textarea:not([hidden])')
      || overlay.querySelector('button:not([disabled]):not([hidden]):not(.modal-close)')
      || overlay.querySelector('button:not([disabled]):not([hidden])');
    if (firstFocusable) setTimeout(() => {
      if (modalGeneration === focusGeneration && !overlay.hidden && overlay.classList.contains('modal-active')) firstFocusable.focus();
    }, 100);
    trapFocus(overlay);
  }

  function closeModal(id) {
    const overlay = $(id);
    if (!overlay) return;
    if (id === 'modal-confirm') App.state.confirmCallback = null;
    if (id === 'modal-transfer') { pendingTransfer = null; transferGeneration++; }
    modalGeneration++;
    overlay.classList.remove('modal-active');
    // Guard the delayed hide: if this same overlay was reopened within the
    // 200ms transition (e.g. clear-all's second confirm), don't hide it.
    setTimeout(() => { if (!overlay.classList.contains('modal-active')) overlay.hidden = true; }, 200);
    const returnEl = modalReturnFocus[id];
    delete modalReturnFocus[id];
    if (returnEl && document.contains(returnEl)) returnEl.focus();
  }

  function closeAllModals() {
    pendingTransfer = null; transferGeneration++;
    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
      overlay.classList.remove('modal-active');
      overlay.hidden = true;
    });
  }

  function trapFocus(el) {
    // Drop the previous trap so repeated opens don't stack listeners
    if (el._focusTrap) el.removeEventListener('keydown', el._focusTrap);
    const focusable = el.querySelectorAll(
      'button:not([disabled]):not([hidden]), input:not([hidden]):not([type="hidden"]), select:not([hidden]), textarea:not([hidden]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    el._focusTrap = function (e) {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    el.addEventListener('keydown', el._focusTrap);
  }

  function showConfirm(title, message, callback) {
    const titleEl = $('confirm-title');
    const msgEl = $('confirm-message');
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    App.state.confirmCallback = callback;
    openModal('modal-confirm');
  }

  /* ==========================================================
     DRAG & DROP RECEIPTS
     ========================================================== */

  function setupReceiptDragDrop() {
    const dropZone = $('receipt-drop-zone');
    if (dropZone) {
      dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drop-active'); });
      dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('drop-active'); });
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drop-active');
        const files = e.dataTransfer.files;
        if (files.length > 0) { App.openExpenseForm(); App.processReceiptFile(files[0]); }
      });
      dropZone.addEventListener('click', () => { $('receipt-file-input').click(); });
      dropZone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          $('receipt-file-input').click();
        }
      });
    }

    const fileInput = $('receipt-file-input');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) { App.openExpenseForm(); App.processReceiptFile(e.target.files[0]); e.target.value = ''; }
      });
    }

    const modalDrop = $('modal-receipt-drop');
    if (modalDrop) {
      modalDrop.addEventListener('dragover', (e) => { e.preventDefault(); modalDrop.classList.add('drop-active'); });
      modalDrop.addEventListener('dragleave', () => { modalDrop.classList.remove('drop-active'); });
      modalDrop.addEventListener('drop', (e) => {
        e.preventDefault();
        modalDrop.classList.remove('drop-active');
        if (e.dataTransfer.files.length > 0) { App.processReceiptFile(e.dataTransfer.files[0]); }
      });
      modalDrop.addEventListener('click', () => { $('expense-receipt-input').click(); });
      modalDrop.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          $('expense-receipt-input').click();
        }
      });
    }

    const modalFileInput = $('expense-receipt-input');
    if (modalFileInput) {
      modalFileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) { App.processReceiptFile(e.target.files[0]); e.target.value = ''; }
      });
    }
  }

  /* ==========================================================
     EVENT DELEGATION & KEYBOARD SHORTCUTS
     ========================================================== */

  function applySessionSort(field) {
    if (App.sessionSort.field === field) {
      App.sessionSort.dir = App.sessionSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      App.sessionSort.field = field;
      App.sessionSort.dir = 'desc';
    }
    App.renderSessions();
  }

  function setupEventDelegation() {
    document.body.addEventListener('click', async (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) {
        const tabBtn = e.target.closest('[data-tab]');
        if (tabBtn) { e.preventDefault(); App.switchTab(tabBtn.getAttribute('data-tab')); return; }
        const sortHeader = e.target.closest('[data-sort]');
        if (sortHeader && sortHeader.closest('#sessions-table')) {
          applySessionSort(sortHeader.getAttribute('data-sort'));
          return;
        }
        if (e.target.classList.contains('modal-overlay')) {
          closeModal(e.target.id);
          return;
        }
        return;
      }

      const action = target.getAttribute('data-action');
      const rawId = target.getAttribute('data-id');
      const id = rawId; // Never coerce string identities such as 001 or large numeric strings.

      switch (action) {
        case 'toggle-theme': App.toggleTheme(); break;
        case 'toggle-split': App.toggleSplit(); break;
        case 'open-settings': openSettings(); break;
        case 'global-search':
          openModal('modal-search');
          setTimeout(() => { const el = $('global-search-input'); if (el) el.focus(); }, 100);
          break;

        case 'apply-family-suggest': {
          const fam = target.getAttribute('data-family');
          const familyEl = $('client-family');
          if (familyEl && fam) { familyEl.value = fam; App.suggestFamily(false); }
          break;
        }

        case 'mark-group-paid': {
          const key = target.getAttribute('data-key');
          const label = target.getAttribute('data-label') || key;
          const { own, shared } = App.owedSessionsForGroup(key);
          const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
          if (own.length === 0) {
            if (shared.length) showToast(plural(shared.length, 'session') + ' for ' + label + ' also bill another family. Mark those paid from the table.', 'error');
            break;
          }
          let msg = 'Mark ' + plural(own.length, 'unpaid session') + ' for ' + label + ' as paid?';
          if (shared.length) msg += ' ' + plural(shared.length, 'session') + ' shared with another family will stay unpaid; mark those from the table.';
          const revision = App.repository.revision;
          showConfirm('Mark Paid', msg, async () => {
            if (!await App.runCommand('session.payment',{ids:own.map(s=>s.id),date:todayISO()},revision)) return;
            showToast('Marked ' + plural(own.length, 'session') + ' paid', 'success');
          });
          break;
        }

        case 'show-owed': {
          // Header pill: jump to Sessions, all time, unpaid only, filter panel open
          App.switchTab('sessions');
          const fds = $('filter-date-start'); if (fds) fds.value = '';
          const fde = $('filter-date-end'); if (fde) fde.value = '';
          const fc = $('filter-client'); if (fc) fc.value = '';
          const fp = $('filter-payment'); if (fp) fp.value = 'unpaid';
          const fs = $('filter-status'); if (fs) fs.value = 'completed';
          const filters = $('session-filters');
          const toggle = document.querySelector('[data-action="toggle-filters"]');
          if (filters) { filters.hidden = false; if (toggle) toggle.setAttribute('aria-expanded', 'true'); }
          App.setSessionMonth('all');
          break;
        }

        case 'session-month-prev': App.setSessionMonth('prev'); break;
        case 'session-month-next': App.setSessionMonth('next'); break;
        case 'session-month-today': App.setSessionMonth('today'); break;
        case 'session-month-all': App.setSessionMonth('all'); break;

        case 'add-client': App.openClientForm(); break;
        case 'edit-client': App.openClientForm(id); break;
        case 'delete-client': App.deleteClient(id); break;
        case 'save-client': App.saveClient(); break;
        case 'view-client-sessions':
          App.switchTab('sessions');
          setTimeout(() => {
            const el = $('filter-client');
            if (el) { el.value = id; App.setSessionMonth('all', false); App.renderSessions(); }
            const filterPanel = $('session-filters');
            if (filterPanel) filterPanel.hidden = false;
          }, 100);
          break;
        case 'repeat-last-session': App.repeatLastSession(); break;

        case 'add-session': App.openSessionForm(); break;
        case 'edit-session': App.openSessionForm(id); break;
        case 'delete-session': App.deleteSession(id); break;
        case 'save-session': App.saveSession(); break;
        case 'duplicate-session': App.duplicateSession(id); break;
        case 'toggle-filters': {
          const filters = $('session-filters');
          if (filters) { filters.hidden = !filters.hidden; target.setAttribute('aria-expanded', !filters.hidden); }
          break;
        }
        case 'clear-filters': {
          const fds = $('filter-date-start'); if (fds) fds.value = '';
          const fde = $('filter-date-end'); if (fde) fde.value = '';
          const fc = $('filter-client'); if (fc) fc.value = '';
          const fp = $('filter-payment'); if (fp) fp.value = '';
          const fs = $('filter-status'); if (fs) fs.value = '';
          App.setSessionMonth('today');  // back to the default view, renders
          break;
        }
        case 'toggle-edit-mode':
          App.state.editMode = !App.state.editMode;
          target.setAttribute('aria-pressed', App.state.editMode);
          target.classList.toggle('active', App.state.editMode);
          if (!App.state.editMode) App.state.selectedSessions.clear();
          App.renderSessions();
          break;
        case 'select-session':
          { const row=App.state.sessions.find(s=>String(s.id)===id);
            if(row) { if(target.checked)App.state.selectedSessions.add(row.id);else App.state.selectedSessions.delete(row.id); }
          }
          App.updateBulkBar();
          break;
        case 'select-all-sessions':
          if (target.checked) {
            App.applySessionFilters().forEach((s) => App.state.selectedSessions.add(s.id));
          } else {
            App.state.selectedSessions.clear();
          }
          App.renderSessions();
          break;
        case 'bulk-mark-paid': {
          if(await App.runCommand('session.payment',{ids:[...App.state.selectedSessions],date:todayISO()},App.repository.revision)) {
            App.state.selectedSessions.clear(); App.renderSessions(); showToast('Payments recorded', 'success');
          }
          break;
        }
        case 'bulk-mark-unpaid': {
          if(await App.runCommand('session.update',{ids:[...App.state.selectedSessions],patch:{paid:false,payment:'unpaid',paymentDate:null}},App.repository.revision)) {
            App.state.selectedSessions.clear(); App.renderSessions(); showToast('Scheduled sessions updated', 'success');
          }
          break;
        }
        case 'bulk-delete': {
          const ids=[...App.state.selectedSessions], revision=App.repository.revision;
          showConfirm('Delete Sessions','Delete the selected editable sessions?',async()=>{
            if(await App.runCommand('session.delete',{ids},revision)) {
              App.state.selectedSessions.clear(); App.renderSessions(); showToast('Sessions deleted','success');
            }
          });
          break;
        }
        case 'bulk-deselect':
          App.state.selectedSessions.clear();
          App.renderSessions();
          break;
        case 'record-payment':
          if(await App.runCommand('session.payment',{ids:[id],date:todayISO()},App.repository.revision)) showToast('Payment recorded separately','success');
          break;
        case 'quick-complete':
          if(await App.runCommand('session.update',{ids:[id],patch:{status:'completed'}},App.repository.revision)) showToast('Session finalized','success');
          break;
        case 'quick-noshow':
          if(await App.runCommand('session.update',{ids:[id],patch:{status:'no-show'}},App.repository.revision)) showToast('Session finalized as no-show','success');
          break;
        case 'calc-mileage':
          showToast('Automatic mileage is unavailable in this protected preview. Enter mileage before completion.','warning');
          break;
        case 'recalc-2026-mileage':
          showConfirm(
            'Recalculate 2026 Mileage',
            'This recomputes per-leg driving miles for all 2026 in-person sessions (in drive order) and overwrites their current mileage. Previous years and historical data are NOT affected. Continue?',
            () => { App.recalc2026Mileage(); }
          );
          break;
        case 'export-sessions-csv': exportCSV('sessions'); break;

        case 'add-expense': App.openExpenseForm(); break;
        case 'edit-expense': App.openExpenseForm(id); break;
        case 'delete-expense': App.deleteExpense(id); break;
        case 'save-expense': App.saveExpense(); break;
        case 'export-expenses-csv': exportCSV('expenses'); break;
        case 'remove-receipt':
          $('expense-receipt-data').value = '';
          { const prvw = $('expense-receipt-preview'); if (prvw) prvw.hidden = true; }
          break;
        case 'view-receipt': {
          const rData = (App.state.receipts || {})[id] || '';
          if (rData) {
            const viewerImg = $('receipt-viewer-img');
            if (viewerImg) viewerImg.src = rData;
            openModal('modal-receipt-viewer');
          }
          break;
        }

        case 'change-report-year': App.renderReports(); break;
        case 'report-filter-reset': {
          ['report-month', 'report-family', 'report-paid'].forEach((id) => { const el = $(id); if (el) el.value = ''; });
          App.renderReports();
          break;
        }
        case 'export-report-csv': exportCSV('report'); break;

        case 'change-tax-year': App.renderTaxSummary(); break;
        case 'add-tax-payment': App.openTaxPaymentForm(); break;
        case 'save-tax-payment': App.saveTaxPayment(); break;
        case 'delete-tax-payment': App.deleteTaxPayment(id); break;
        case 'export-tax-pdf': App.exportTaxPDF(); break;
        case 'export-tax-csv': exportCSV('tax'); break;

        case 'save-settings': saveSettings(); break;
        case 'sync-push': stageRehearsal('push'); break;
        case 'sync-pull': stageRehearsal('pull'); break;
        case 'apply-transfer': applyTransfer(); break;
        case 'backup-data': {
          backupData();
          const bb = $('backup-banner');
          if (bb) bb.hidden = true;
          break;
        }
        case 'dismiss-backup-banner': {
          const db = $('backup-banner');
          if (db) db.hidden = true;

          break;
        }
        case 'restore-data': restoreData(); break;
        case 'clear-all-data': clearAllData(); break;
        case 'import-historical':
          App.importHistoricalFile();
          break;
        case 'clear-historical':
          showConfirm('Clear Historical Data', 'Remove all historical session data from this device?', function () {
            App.clearHistoricalData();
            updateHistoricalStatus();
          });
          break;

        case 'search-goto-client':
          closeAllModals();
          App.switchTab('clients');
          setTimeout(() => { App.openClientForm(id); }, 100);
          break;
        case 'search-goto-session':
          closeAllModals();
          App.switchTab('sessions');
          setTimeout(() => App.openSessionForm(id), 100);
          break;
        case 'search-goto-expense':
          closeAllModals();
          App.switchTab('expenses');
          setTimeout(() => App.openExpenseForm(id), 100);
          break;

        case 'close-modal': {
          const modal = target.closest('.modal-overlay');
          if (modal) closeModal(modal.id);
          break;
        }
        case 'confirm-cancel':
          App.state.confirmCallback = null;
          closeModal('modal-confirm');
          break;
        case 'confirm-ok': {
          const cb = App.state.confirmCallback;
          App.state.confirmCallback = null;
          closeModal('modal-confirm');
          if (cb) cb();
          break;
        }
      }
    });

    document.body.addEventListener('change', (e) => {
      const target = e.target;
      const action = target.getAttribute('data-action');
      if (action === 'inline-edit') { App.handleInlineEdit(target); return; }
      if (action === 'filter-sessions') { App.renderSessions(); return; }
      if (action === 'income-chart-range') { App.renderIncomeChart(); return; }
      if (action === 'report-filter') { App.renderReports(); return; }
      if (action === 'change-report-version') { populateReportYears(); App.renderReports(); return; }
      if (action === 'change-tax-version') { populateReportYears(); App.renderTaxSummary(); return; }
      if (action === 'change-tax-year') { App.renderTaxSummary(); return; }
      if (action === 'search-clients') { App.renderClients(target.value); return; }
      if (target.id === 'session-clients') { App.updateSessionPrefill(); return; }
    });

    document.body.addEventListener('input', (e) => {
      if (e.target.getAttribute('data-action') === 'search-clients') { App.renderClients(e.target.value); return; }
      if (e.target.id === 'global-search-input') { performGlobalSearch(e.target.value); return; }
      if (e.target.id === 'client-name') { App.suggestFamily(true); return; }
      if (e.target.id === 'session-duration') { App.updateSessionPrefill(); return; }
    });

    // Restore file input
    const restoreInput = $('restore-file-input');
    if (restoreInput) {
      restoreInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) { restoreData(e.target.files[0]); e.target.value = ''; }
      });
    }

    // Historical data file input — stored locally only, never synced or uploaded
    const historicalInput = $('historical-file-input');
    if (historicalInput) {
      historicalInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          App.importHistoricalFile(e.target.files[0]);
          e.target.value = '';
          setTimeout(updateHistoricalStatus, 500);
        }
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const sortHeader = e.target.closest && e.target.closest('[data-sort]');
        if (sortHeader && sortHeader.closest('#sessions-table')) {
          e.preventDefault();
          applySessionSort(sortHeader.getAttribute('data-sort'));
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        openModal('modal-search');
        setTimeout(() => { const el = $('global-search-input'); if (el) { el.value = ''; el.focus(); } }, 100);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        switch (App.state.activeTab) {
          case 'clients': App.openClientForm(); break;
          case 'sessions': App.openSessionForm(); break;
          case 'expenses': App.openExpenseForm(); break;
          default: App.openSessionForm(); break;
        }
        return;
      }
      if (e.key === 'Escape') {
        const openModalEl = document.querySelector('.modal-overlay:not([hidden])');
        if (openModalEl) closeModal(openModalEl.id);
        return;
      }
    });
  }

  /* ==========================================================
     INITIALIZATION
     ========================================================== */

  function updateProtectionStatus() {
    const el=$('protection-status');
    if(el) el.textContent = !App.repository.ready ? (production() ? 'Device upgrade required. Your original storage has not been changed.' : 'Synthetic preview not initialized. Real data is never loaded.') :
      (App.repository.maintenance ? 'Maintenance: all records read-only.' : 'Historical records read-only. New sessions lock on completion.') + ' Revision ' + App.repository.revision;
    const saved=$('last-saved'); if(saved && App.repository.ready)saved.textContent='Protected revision '+App.repository.revision;
    const button=$('initialize-preview'); if(button) button.hidden=App.repository.ready || production();
    if (production()) {
      $('protection-heading').textContent='Protected tutoring tracker';
      $('production-upgrade').hidden=App.repository.ready;
    }
    // Maintenance mode is no longer offered (owner ruling 2026-09-10); the button only
    // remains as an exit if the stored flag is ever found on.
    const maintenance=$('toggle-maintenance');
    if(maintenance) maintenance.hidden=!(App.repository.ready && App.repository.maintenance);
    // Live site: the whole panel is upgrade scaffolding. Hide it once records are
    // activated unless maintenance mode needs the exit button.
    const panel=$('protection-panel');
    if(panel && production()) panel.hidden=App.repository.ready && !App.repository.maintenance;
  }
  function populateReportYears() {
    ['report', 'tax'].forEach(surface => {
      const sel = $(surface + '-year');
      if (!sel) return;
      const previous = sel.value;
      const context = App.reportModel.context(App.reportModel.mode(surface));
      const currentYear = new Date().getFullYear();
      const years = new Set(Array.from({ length: 8 }, (_, i) => String(currentYear - i)));
      [...context.sessions, ...context.expenses, ...(context.taxPayments || [])].forEach(row => {
        [row.date, row.paymentDate].forEach(date => { if (typeof date === 'string' && /^\d{4}-/.test(date)) years.add(date.slice(0, 4)); });
      });
      sel.innerHTML = [...years].sort().reverse().map(year => '<option value="' + year + '">' + year + '</option>').join('');
      sel.value = years.has(previous) ? previous : String(currentYear);
    });
  }
  let activationStage = null;
  async function prepareProductionUpgrade() {
    const button=$('prepare-upgrade'); button.disabled=true;
    activationStage=null; $('upgrade-backup').hidden=true;
    $('verify-upgrade-recovery').disabled=true;
    try {
      await window.TrackerUpgrade.assertReady();
      const sources={};
      for(const file of ['baseline/app-core.js.txt','baseline/reports.js.txt','baseline/historical.js.txt','baseline/ui.js.txt']) {
        const response=await fetch(file);
        if(!response.ok)throw Error('Original report definitions could not be loaded.');
        sources[file]=await response.text();
      }
      activationStage=await App.repository.stageLegacyActivation(sources);
      const summary=activationStage.summary;
      $('upgrade-summary').textContent=Object.entries(summary.counts || {}).map(([name,count])=>count+' '+name).join(', ')+
        '. '+summary.receiptRows+' original receipt entries. All existing records will be protected, including future scheduled records.';
      $('upgrade-backup').hidden=false;
    }catch(error){$('upgrade-summary').textContent=error.message;showToast(error.message,'error');}
    finally{button.disabled=false;}
  }
  async function verifyProductionRecovery(file) {
    if(!file || !activationStage)return;
    const stage=activationStage;
    $('verify-upgrade-recovery').disabled=true;
    try {
      if(await file.text()!==stage.recoveryText)throw Error('This file does not match the current device recovery. Save and reopen the current file.');
      await window.TrackerUpgrade.retireLegacyRoot();
      await App.repository.commitLegacyActivation(stage.id,{backupAcknowledged:true});
      activationStage=null;
      App.refreshReadViews();populateReportYears();updateProtectionStatus();
      App.renderTab(App.state.activeTab);App.updateHeaderStats();
      showToast('Device upgrade verified. Original records are protected; cloud sync is off.','success');
    }catch(error){showToast(error.message,'error');$('upgrade-summary').textContent=error.message;}
    finally{$('upgrade-recovery-file').value='';$('verify-upgrade-recovery').disabled=!activationStage;}
  }
  async function init() {
    App.initTheme();
    setupEventDelegation(); setupReceiptDragDrop();
    App.repository.subscribe(()=>{App.refreshReadViews();populateReportYears();updateProtectionStatus();});
    try { await App.loadData(); } catch(error) { showToast(error.message,'error'); }
    populateReportYears();
    updateProtectionStatus(); App.updateSyncUI();
    if(production()) {
      $('private-backup-notice').hidden=false;
      $('prepare-upgrade').addEventListener('click',prepareProductionUpgrade);
      $('download-upgrade-recovery').addEventListener('click',()=>{
        if(!activationStage)return;
        downloadFile(activationStage.recoveryText,'tutor-tracker-before-upgrade-private.json','application/json');
        $('verify-upgrade-recovery').disabled=false;
      });
      $('verify-upgrade-recovery').addEventListener('click',()=>$('upgrade-recovery-file').click());
      $('upgrade-recovery-file').addEventListener('change',event=>verifyProductionRecovery(event.target.files[0]));
      const mirrorButton=document.querySelector('[data-action="sync-push"]');
      if(mirrorButton)mirrorButton.closest('fieldset').hidden=true;
      const syncLabel=$('sync-indicator');if(syncLabel)syncLabel.textContent='Cloud sync off · records stay on this device';
    }
    const hashTab=(location.hash||'').replace('#','');
    App.switchTab(validTabs.includes(hashTab)?hashTab:'dashboard'); App.updateHeaderStats();
    // Keep unavailable paths visible with an explicit reason.
    ['settings-ors-key'].forEach(id=>{
      const el=$(id); if(el){el.disabled=true;el.title='Unavailable in protected preview';}
    });
    $('initialize-preview').addEventListener('click',async()=>{
      try {
        const fixture=await fetch('fixtures/synthetic.json').then(r=>{if(!r.ok)throw Error('Fixture unavailable');return r.text();});
        const sources={};
        for(const file of ['baseline/app-core.js.txt','baseline/reports.js.txt','baseline/historical.js.txt','baseline/ui.js.txt']){
          const r=await fetch(file);if(!r.ok)throw Error('Report baseline unavailable');sources[file]=await r.text();
        }
        await App.repository.activateSynthetic(fixture,sources);
        App.refreshReadViews();App.renderTab(App.state.activeTab);App.updateHeaderStats();updateProtectionStatus();
        showToast('Fabricated preview initialized. No real records were read.','success');
      }catch(error){showToast(error.message,'error');}
    });
    $('toggle-maintenance').addEventListener('click',()=>App.runCommand('maintenance.set',{enabled:false},App.repository.revision));
  }
  App.updateProtectionStatus=updateProtectionStatus;
  App.backupData=backupData; App.restoreData=restoreData; App.clearAllData=clearAllData;

  // Listen for hash changes to support bookmark shortcuts
  window.addEventListener('hashchange', () => {
    const t = (location.hash || '').replace('#', '');
    if (validTabs.includes(t)) App.switchTab(t);
  });

  // Expose to App namespace
  App.showToast = showToast;
  App.showConfirm = showConfirm;
  App.openModal = openModal;
  App.closeModal = closeModal;
  App.getModalGeneration = () => modalGeneration;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
