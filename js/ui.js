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

  /* ==========================================================
     IMPORT / EXPORT
     ========================================================== */

  function backupData() {
    const backup = {
      version: 2,
      exportedAt: new Date().toISOString(),
      clients: App.state.clients,
      sessions: App.state.sessions,
      expenses: App.state.expenses,
      settings: App.state.settings,
      receipts: App.state.receipts,
      taxPayments: App.state.taxPayments,
    };
    const json = JSON.stringify(backup, null, 2);
    const date = todayISO().replace(/-/g, '');
    downloadFile(json, 'tutoring-backup-' + date + '.json', 'application/json');
    App.state.settings.lastBackup = new Date().toISOString();
    App.saveData();
    showToast('Backup downloaded', 'success');
  }

  function restoreData(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const imported = JSON.parse(e.target.result);
        if (typeof imported !== 'object' || imported === null) throw new Error('Invalid format');
        if (imported.clients && !Array.isArray(imported.clients)) throw new Error('clients must be an array');
        if (imported.sessions && !Array.isArray(imported.sessions)) throw new Error('sessions must be an array');
        if (imported.expenses && !Array.isArray(imported.expenses)) throw new Error('expenses must be an array');
        if (imported.settings && typeof imported.settings !== 'object') throw new Error('settings must be an object');
        if (imported.receipts && typeof imported.receipts !== 'object') throw new Error('receipts must be an object');
        if (imported.clients) {
          imported.clients = imported.clients.filter((c) => c && typeof c === 'object' && c.id != null);
        }
        if (imported.sessions) {
          imported.sessions = imported.sessions.filter((s) => s && typeof s === 'object' && s.id != null);
        }
        if (imported.expenses) {
          imported.expenses = imported.expenses.filter((e) => e && typeof e === 'object' && e.id != null);
        }

        // Confirm before overwriting live data — one wrong file pick
        // shouldn't silently roll everything back.
        const cur = App.state;
        const backupDate = imported.exportedAt ? formatDate(imported.exportedAt.slice(0, 10)) : 'unknown date';
        const incoming = (imported.clients ? imported.clients.length : 0) + ' clients, ' +
          (imported.sessions ? imported.sessions.length : 0) + ' sessions, ' +
          (imported.expenses ? imported.expenses.length : 0) + ' expenses';
        const current = cur.clients.length + ' clients, ' + cur.sessions.length + ' sessions, ' +
          cur.expenses.length + ' expenses';
        showConfirm(
          'Restore Backup?',
          'Replace the data on this device (' + current + ') with the backup from ' +
            backupDate + ' (' + incoming + ')? This cannot be undone.',
          () => {
            if (imported.clients) App.state.clients = imported.clients;
            if (imported.sessions) App.state.sessions = imported.sessions;
            if (imported.expenses) App.state.expenses = imported.expenses;
            if (imported.settings) App.state.settings = { ...DEFAULT_SETTINGS, ...imported.settings };
            if (imported.receipts) App.state.receipts = imported.receipts;
            if (Array.isArray(imported.taxPayments)) App.state.taxPayments = imported.taxPayments;
            App.migrateData();
            App.saveData();
            App.renderTab(App.state.activeTab);
            App.updateHeaderStats();
            showToast('Data restored successfully', 'success');
          }
        );
      } catch (err) {
        showToast('Invalid backup file: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  }

  function exportCSV(type) {
    const sessions = App.state.sessions;
    const clients = App.state.clients;
    const expenses = App.state.expenses;
    const settings = App.state.settings;

    let csv = '';
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
        csv = 'Date,Time,Client(s),Type,Duration (hrs),Amount,Company Split,Paid,Status,Mileage,Notes\n';
        sessions.forEach((s) => {
          const names = (s.clientIds || []).map((id) => {
            const c = clients.find((cl) => String(cl.id) === String(id));
            return c ? clientName(c) : 'Unknown';
          }).join('; ');
          csv += csvRow([
            s.date, s.time, names, s.type, s.duration, s.amount,
            s.companyAmount, s.paid ? 'Yes' : 'No', s.status, s.mileage, s.notes,
          ]);
        });
        filename = 'sessions-' + todayISO() + '.csv';
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
        const yearSelect = $('report-year');
        const year = yearSelect ? parseInt(yearSelect.value) : new Date().getFullYear();
        const yearRate = App.mileageRateFor(year);
        csv = 'Month,Sessions,Hours,Gross Income,Company Split,Your Cut,Expenses,Net,Miles,Mileage Deduction\n';
        for (let m = 0; m < 12; m++) {
          const monthKey = year + '-' + String(m + 1).padStart(2, '0');
          const mm = App.computeMetrics({ month: monthKey });
          const exp = expenses
            .filter((e) => e.date && e.date.slice(0, 7) === monthKey)
            .reduce((s, x) => s + num(x.amount), 0);
          const monthName = new Date(year, m, 1).toLocaleDateString('en-US', { month: 'long' });
          csv += csvRow([monthName, mm.sessionCount, mm.hours, mm.gross, mm.companySplit,
            mm.yourCut, exp, mm.yourCut - exp, mm.miles, mm.miles * yearRate]);
        }
        filename = 'report-' + year + '.csv';
        break;
      }

      case 'tax': {
        const taxYearSelect = $('tax-year');
        const taxYear = taxYearSelect ? parseInt(taxYearSelect.value) : new Date().getFullYear();
        const data = App.getTaxData(taxYear);
        csv = 'Line,Description,Amount\n';
        csv += csvRow(['1', 'Gross receipts', data.grossIncome]);
        csv += csvRow(['9', 'Car and truck expenses', data.line9]);
        csv += csvRow(['10', 'Commissions and fees', data.line10]);
        csv += csvRow(['15', 'Insurance', data.line15]);
        csv += csvRow(['17', 'Professional services', data.line17]);
        csv += csvRow(['18', 'Office expenses', data.line18]);
        csv += csvRow(['22', 'Supplies', data.line22]);
        csv += csvRow(['25', 'Utilities', data.line25]);
        csv += csvRow(['27a', 'Other expenses', data.line27a]);
        csv += csvRow(['28', 'Total expenses', data.line28]);
        csv += csvRow(['31', 'Net profit', data.line31]);
        filename = 'tax-summary-' + taxYear + '.csv';
        break;
      }
    }

    if (csv) {
      downloadFile(csv, filename, 'text/csv');
      showToast('CSV exported', 'success');
    }
  }

  function csvRow(fields) {
    return fields.map((f) => {
      const val = f == null ? '' : String(f);
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
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
      const years = [...new Set(sessions.map((s) => s.date ? s.date.slice(0, 4) : ''))].filter(Boolean).sort();
      el.textContent = sessions.length + ' sessions loaded locally (' + years[0] + '–' + years[years.length - 1] + '). Never synced or uploaded.';
    }
  }

  function openSettings() {
    const settings = App.state.settings;
    const el = (id, val) => { const e = $(id); if (e) e.value = val != null ? val : ''; };
    el('settings-business-name', settings.businessName);
    el('settings-business-address', settings.businessAddress);
    el('settings-irs-rate', settings.mileageRate);
    el('settings-default-duration', settings.defaultDuration);
    el('settings-ors-key', settings.orsApiKey);
    el('settings-gist-token', settings.gistToken);
    el('settings-gist-id', settings.gistId);
    el('settings-auto-sync', settings.autoSync);

    updateHistoricalStatus();
    openModal('modal-settings');
  }

  function saveSettings() {
    const settings = App.state.settings;
    settings.businessName = ($('settings-business-name').value || '').trim();
    settings.businessAddress = ($('settings-business-address').value || '').trim();
    settings.mileageRate = num($('settings-irs-rate').value) || 0.725;
    settings.defaultDuration = num($('settings-default-duration').value) || 1;
    settings.orsApiKey = ($('settings-ors-key').value || '').trim();
    settings.gistToken = ($('settings-gist-token').value || '').trim();
    settings.gistId = ($('settings-gist-id').value || '').trim();
    settings.autoSync = $('settings-auto-sync').value || 'off';

    if (settings.gistToken) {
      sessionStorage.setItem('gist-token', settings.gistToken);
    }

    App.saveData();
    App.startAutoSync();
    App.updateSyncUI(App.hasSyncConfig() ? 'synced' : null);
    closeModal('modal-settings');
    showToast('Settings saved', 'success');
  }

  function clearAllData() {
    showConfirm('Clear All Data', 'This will permanently delete ALL clients, sessions, expenses, and settings. This cannot be undone!', () => {
      showConfirm('Are you absolutely sure?', 'Type is irreversible. All data will be lost forever.', () => {
        App.state.clients = [];
        App.state.sessions = [];
        App.state.expenses = [];
        App.state.receipts = {};
        App.state.taxPayments = [];
        App.state.settings = { ...DEFAULT_SETTINGS };
        App.saveData();
        App.renderTab(App.state.activeTab);
        App.updateHeaderStats();
        showToast('All data cleared', 'success');
      });
    });
  }

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

  function openModal(id) {
    const overlay = $(id);
    if (!overlay) return;
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('modal-active'));
    const firstInput = overlay.querySelector('input:not([hidden]):not([type="hidden"]), select:not([hidden]), textarea:not([hidden])');
    if (firstInput) setTimeout(() => firstInput.focus(), 100);
    trapFocus(overlay);
  }

  function closeModal(id) {
    const overlay = $(id);
    if (!overlay) return;
    overlay.classList.remove('modal-active');
    setTimeout(() => { overlay.hidden = true; }, 200);
  }

  function closeAllModals() {
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

  function setupEventDelegation() {
    document.body.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) {
        const tabBtn = e.target.closest('[data-tab]');
        if (tabBtn) { e.preventDefault(); App.switchTab(tabBtn.getAttribute('data-tab')); return; }
        const sortHeader = e.target.closest('[data-sort]');
        if (sortHeader && sortHeader.closest('#sessions-table')) {
          const field = sortHeader.getAttribute('data-sort');
          if (App.sessionSort.field === field) {
            App.sessionSort.dir = App.sessionSort.dir === 'asc' ? 'desc' : 'asc';
          } else {
            App.sessionSort.field = field;
            App.sessionSort.dir = 'desc';
          }
          App.renderSessions();
          return;
        }
        if (e.target.classList.contains('modal-overlay')) {
          e.target.classList.remove('modal-active');
          e.target.hidden = true;
          return;
        }
        return;
      }

      const action = target.getAttribute('data-action');
      const rawId = target.getAttribute('data-id');
      const id = rawId != null ? (isNaN(rawId) ? rawId : Number(rawId)) : null;

      switch (action) {
        case 'toggle-theme': App.toggleTheme(); break;
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

        case 'mark-client-paid': {
          const sess = App.state.sessions;
          const owed = sess.filter((s) =>
            s.status === 'completed' && !s.paid && s.payment !== 'waived' &&
            (s.clientIds || []).some((cid) => String(cid) === String(id))
          );
          if (owed.length === 0) break;
          const c = App.state.clients.find((cl) => String(cl.id) === String(id));
          const name = c ? clientName(c) : 'this client';
          showConfirm('Mark Paid', 'Mark ' + owed.length + ' unpaid session' + (owed.length === 1 ? '' : 's') + ' for ' + name + ' as paid?', () => {
            owed.forEach((s) => { s.paid = true; s.payment = 'paid'; s.paymentDate = todayISO(); s.updatedAt = new Date().toISOString(); });
            App.saveAndRender();
            showToast('Marked ' + owed.length + ' session' + (owed.length === 1 ? '' : 's') + ' paid', 'success');
          });
          break;
        }

        case 'add-client': App.openClientForm(); break;
        case 'edit-client': App.openClientForm(id); break;
        case 'delete-client': App.deleteClient(id); break;
        case 'save-client': App.saveClient(); break;
        case 'view-client-sessions':
          App.switchTab('sessions');
          setTimeout(() => {
            const el = $('filter-client');
            if (el) { el.value = id; App.renderSessions(); }
            const filterPanel = $('session-filters');
            if (filterPanel) filterPanel.hidden = false;
          }, 100);
          break;
        case 'toggle-split-history': {
          const histEl = $('split-history');
          if (histEl) {
            histEl.hidden = !histEl.hidden;
            target.setAttribute('aria-expanded', !histEl.hidden);
            target.textContent = histEl.hidden ? 'Show Split History' : 'Hide Split History';
          }
          break;
        }

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
          App.renderSessions();
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
          if (target.checked) { App.state.selectedSessions.add(id); } else { App.state.selectedSessions.delete(id); }
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
          const sel = App.state.selectedSessions;
          const sess = App.state.sessions;
          sel.forEach((sid) => {
            const s = sess.find((ses) => String(ses.id) === String(sid));
            if (s) { s.paid = true; s.payment = 'paid'; s.paymentDate = todayISO(); }
          });
          sel.clear();
          App.saveAndRender();
          showToast('Sessions marked as paid', 'success');
          break;
        }
        case 'bulk-mark-unpaid': {
          const sel2 = App.state.selectedSessions;
          const sess2 = App.state.sessions;
          sel2.forEach((sid) => {
            const s = sess2.find((ses) => String(ses.id) === String(sid));
            if (s) { s.paid = false; s.payment = 'unpaid'; s.paymentDate = null; }
          });
          sel2.clear();
          App.saveAndRender();
          showToast('Sessions marked as unpaid', 'success');
          break;
        }
        case 'bulk-delete':
          showConfirm('Delete Sessions', 'Delete ' + App.state.selectedSessions.size + ' selected session(s)?', () => {
            App.state.sessions = App.state.sessions.filter((s) => !App.state.selectedSessions.has(s.id));
            App.state.selectedSessions.clear();
            App.saveAndRender();
            showToast('Sessions deleted', 'success');
          });
          break;
        case 'bulk-deselect':
          App.state.selectedSessions.clear();
          App.renderSessions();
          break;
        case 'quick-complete': {
          const qs = App.state.sessions.find((s) => String(s.id) === String(id));
          if (qs) { qs.status = 'completed'; qs.updatedAt = new Date().toISOString(); }
          App.saveAndRender();
          showToast('Session completed', 'success');
          break;
        }
        case 'quick-noshow': {
          const ns = App.state.sessions.find((s) => String(s.id) === String(id));
          if (ns) { ns.status = 'no-show'; ns.updatedAt = new Date().toISOString(); }
          App.saveAndRender();
          showToast('Session marked as no-show', 'success');
          break;
        }
        case 'calc-mileage': {
          const sessionClientsEl = $('session-clients');
          if (!sessionClientsEl) break;
          const selectedOpts = Array.from(sessionClientsEl.selectedOptions);
          if (selectedOpts.length === 0) { showToast('Select a client first', 'warning'); break; }
          const cid = selectedOpts[0].value;
          const client = App.state.clients.find((c) => String(c.id) === String(cid));
          if (!client || !client.address) { showToast('Client has no address set', 'warning'); break; }
          showToast('Calculating mileage...', 'info');
          App.calculateMileage(client.address).then((miles) => {
            $('session-mileage').value = miles;
            showToast('Mileage calculated: ' + miles + ' mi', 'success');
          }).catch(() => { showToast('Could not calculate mileage', 'error'); });
          break;
        }
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
        case 'sync-push': App.saveToGist({ interactive: true }); break;
        case 'sync-pull':
          showConfirm(
            'Pull from Gist?',
            'This replaces the data on this device with the Gist copy. Continue?',
            () => App.loadFromGist()
          );
          break;
        case 'backup-data': {
          backupData();
          const bb = $('backup-banner');
          if (bb) bb.hidden = true;
          break;
        }
        case 'dismiss-backup-banner': {
          const db = $('backup-banner');
          if (db) db.hidden = true;
          localStorage.setItem('backup-banner-dismissed', Date.now().toString());
          break;
        }
        case 'restore-data': $('restore-file-input').click(); break;
        case 'clear-all-data': clearAllData(); break;
        case 'import-historical':
          $('historical-file-input').click();
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
        case 'confirm-ok':
          closeModal('modal-confirm');
          if (App.state.confirmCallback) {
            const cb = App.state.confirmCallback;
            App.state.confirmCallback = null;
            cb();
          }
          break;
      }
    });

    document.body.addEventListener('change', (e) => {
      const target = e.target;
      const action = target.getAttribute('data-action');
      if (action === 'inline-edit') { App.handleInlineEdit(target); return; }
      if (action === 'filter-sessions') { App.renderSessions(); return; }
      if (action === 'income-chart-range') { App.renderIncomeChart(); return; }
      if (action === 'report-filter') { App.renderReports(); return; }
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
        if (openModalEl) {
          if (openModalEl.id === 'modal-confirm') App.state.confirmCallback = null;
          closeModal(openModalEl.id);
        }
        return;
      }
    });
  }

  /* ==========================================================
     INITIALIZATION
     ========================================================== */

  function autoCompletePastSessions() {
    const sessions = App.state.sessions;
    const today = todayISO();
    let changed = false;
    sessions.forEach((s) => {
      if (s.status === 'scheduled' && s.date && s.date < today) { s.status = 'completed'; changed = true; }
    });
    if (changed) App.saveData();
  }

  function init() {
    App.initTheme();
    App.loadData();
    setupEventDelegation();
    setupReceiptDragDrop();
    App.renderTab('dashboard');
    App.updateHeaderStats();

    if (App.hasSyncConfig()) {
      App.updateSyncUI('synced');
      App.startAutoSync();
    }

    // Backup reminder banner
    setTimeout(() => {
      const settings = App.state.settings;
      const banner = $('backup-banner');
      const msg = $('backup-banner-msg');
      if (!banner) return;
      const dismissedAt = localStorage.getItem('backup-banner-dismissed');
      if (dismissedAt) {
        const hoursSince = (Date.now() - parseInt(dismissedAt, 10)) / (1000 * 60 * 60);
        if (hoursSince < 24) return; // dismissed within last 24h — don't nag
      }
      if (!settings.lastBackup) {
        msg.textContent = 'You have never backed up your data. Download a backup to keep it safe!';
        banner.hidden = false;
      } else {
        const daysSince = (Date.now() - new Date(settings.lastBackup).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince >= (settings.autoBackupDays || 7)) {
          msg.textContent = 'Last backup was ' + Math.floor(daysSince) + ' days ago — time for a new one!';
          banner.hidden = false;
        }
      }
    }, 1500);

    autoCompletePastSessions();

    const currentYear = new Date().getFullYear();
    [$('report-year'), $('tax-year')].forEach((sel) => {
      if (!sel) return;
      sel.innerHTML = '';
      for (let y = currentYear; y >= currentYear - 5; y--) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y;
        if (y === currentYear) opt.selected = true;
        sel.appendChild(opt);
      }
    });

    console.log('Tutoring Tracker Pro initialized');
  }

  // Expose to App namespace
  App.showToast = showToast;
  App.showConfirm = showConfirm;
  App.openModal = openModal;
  App.closeModal = closeModal;
  App.closeAllModals = closeAllModals;
  App.exportCSV = exportCSV;
  App.backupData = backupData;
  App.restoreData = restoreData;
  App.openSettings = openSettings;
  App.saveSettings = saveSettings;
  App.clearAllData = clearAllData;
  App.performGlobalSearch = performGlobalSearch;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
