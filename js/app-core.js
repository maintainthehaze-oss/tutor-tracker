/* ============================================================
   Tutoring Tracker Pro — Core
   Namespace, utilities, data management, theme, tab system
   ============================================================ */
(function () {
  'use strict';

  const App = window.App = {};

  /* ==========================================================
     1. HELPERS & UTILITIES
     ========================================================== */

  /** Shorthand getElementById */
  const $ = (id) => document.getElementById(id);

  /** Escape HTML to prevent XSS */
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Generate a unique ID */
  function generateId() {
    try {
      return crypto.randomUUID();
    } catch (_) {
      return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }
  }

  /** Format number as currency */
  function formatCurrency(n) {
    const val = parseFloat(n);
    if (isNaN(val)) return '$0.00';
    return '$' + val.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /** Format ISO date string to readable */
  function formatDate(d) {
    if (!d) return '';
    try {
      const dt = new Date(d + (d.length === 10 ? 'T00:00:00' : ''));
      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_) {
      return d;
    }
  }

  /** Format duration in hours to readable string */
  function formatDuration(hours) {
    const h = parseFloat(hours);
    if (isNaN(h) || h <= 0) return '0h';
    const hrs = Math.floor(h);
    const mins = Math.round((h - hrs) * 60);
    if (hrs === 0) return mins + 'm';
    if (mins === 0) return hrs + 'h';
    return hrs + 'h ' + mins + 'm';
  }

  /** Get today's date as YYYY-MM-DD */
  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  /** Parse float safely */
  function num(v) {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  /** Debounce helper */
  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  /** Download a string as a file */
  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** Get client full name */
  function clientName(c) {
    if (!c) return 'Unknown';
    const first = (c.firstName || '').trim();
    const last = (c.lastName || '').trim();
    if (first && last) return first + ' ' + last;
    return first || last || 'Unknown';
  }

  /** Get initials for avatar */
  function initials(c) {
    if (!c) return '?';
    const f = (c.firstName || '')[0] || '';
    const l = (c.lastName || '')[0] || '';
    return (f + l).toUpperCase() || '?';
  }

  /* ==========================================================
     2. DATA MANAGEMENT
     ========================================================== */

  const STORAGE_KEYS = {
    clients: 'tutoring-clients',
    sessions: 'tutoring-sessions',
    expenses: 'tutoring-expenses',
    settings: 'tutoring-settings',
    receipts: 'tutoring-receipts',
    theme: 'tutoring-theme',
    taxPayments: 'tutoring-tax-payments',
  };

  const DEFAULT_SETTINGS = {
    businessName: '',
    // Default home-base address. Kept OUT of source control for privacy — if a
    // gitignored local-config.js is present it supplies this; otherwise blank.
    businessAddress: (window.LOCAL_CONFIG && window.LOCAL_CONFIG.businessAddress) || '',
    mileageRate: 0.725,
    defaultDuration: 1,
    orsApiKey: '',
    gistId: '',
    gistToken: '',
    autoSync: 'off',
    autoBackupDays: 7,
    lastBackup: null,
  };

  const EXPENSE_CATEGORIES = [
    { value: 'supplies', label: 'Supplies' },
    { value: 'software', label: 'Software / Subscriptions' },
    { value: 'books', label: 'Books / Materials' },
    { value: 'office', label: 'Office Expenses' },
    { value: 'insurance', label: 'Insurance' },
    { value: 'professional', label: 'Professional Services' },
    { value: 'advertising', label: 'Advertising' },
    { value: 'utilities', label: 'Utilities' },
    { value: 'equipment', label: 'Equipment' },
    { value: 'training', label: 'Training / PD' },
    { value: 'travel', label: 'Travel (non-mileage)' },
    { value: 'meals', label: 'Meals (business)' },
    { value: 'other', label: 'Other' },
  ];

  /** Application state */
  let clients = [];
  let sessions = [];
  let expenses = [];
  let settings = { ...DEFAULT_SETTINGS };
  let receipts = {};
  let taxPayments = [];

  let activeTab = 'dashboard';
  let editMode = false;
  let selectedSessions = new Set();
  let confirmCallback = null;

  // Chart instances
  let incomeChart = null;

  // Sync state
  let syncTimer = null;
  let syncDebounceTimer = null;

  // State object - modules read/write these directly via getters/setters
  App.state = {
    get clients() { return clients; },
    set clients(v) { clients = v; },
    get sessions() { return sessions; },
    set sessions(v) { sessions = v; },
    get expenses() { return expenses; },
    set expenses(v) { expenses = v; },
    get settings() { return settings; },
    set settings(v) { settings = v; },
    get receipts() { return receipts; },
    set receipts(v) { receipts = v; },
    get taxPayments() { return taxPayments; },
    set taxPayments(v) { taxPayments = v; },
    get activeTab() { return activeTab; },
    set activeTab(v) { activeTab = v; },
    get editMode() { return editMode; },
    set editMode(v) { editMode = v; },
    get selectedSessions() { return selectedSessions; },
    set selectedSessions(v) { selectedSessions = v; },
    get confirmCallback() { return confirmCallback; },
    set confirmCallback(v) { confirmCallback = v; },
    get incomeChart() { return incomeChart; },
    set incomeChart(v) { incomeChart = v; },
    get syncTimer() { return syncTimer; },
    set syncTimer(v) { syncTimer = v; },
    get syncDebounceTimer() { return syncDebounceTimer; },
    set syncDebounceTimer(v) { syncDebounceTimer = v; },
  };

  /** Load all data from localStorage */
  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.clients);
      clients = raw ? JSON.parse(raw) : [];
    } catch (_) {
      clients = [];
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.sessions);
      sessions = raw ? JSON.parse(raw) : [];
    } catch (_) {
      sessions = [];
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.expenses);
      expenses = raw ? JSON.parse(raw) : [];
    } catch (_) {
      expenses = [];
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.settings);
      settings = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
    } catch (_) {
      settings = { ...DEFAULT_SETTINGS };
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.receipts);
      receipts = raw ? JSON.parse(raw) : {};
    } catch (_) {
      receipts = {};
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.taxPayments);
      taxPayments = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(taxPayments)) taxPayments = [];
    } catch (_) {
      taxPayments = [];
    }

    // Migrations
    migrateData();
  }

  /** Migrate old data formats */
  function migrateData() {
    clients.forEach((c) => {
      // Migrate hourlyRate -> rate
      if (c.hourlyRate != null && c.rate == null) {
        c.rate = c.hourlyRate;
      }
      // Ensure rate field always exists
      if (c.rate == null) c.rate = c.hourlyRate || 0;

      // Ensure splitHistory array exists and normalize format
      if (!Array.isArray(c.splitHistory)) {
        c.splitHistory = [];
        if (c.companySplit != null && c.companySplit > 0) {
          c.splitHistory.push({
            split: c.companySplit,
            effectiveDate: c.createdAt ? c.createdAt.slice(0, 10) : todayISO(),
          });
        }
      } else {
        // Normalize old splitHistory format: {date, rate} -> {effectiveDate, split}
        c.splitHistory = c.splitHistory.map((h) => ({
          split: h.split != null ? h.split : (h.rate != null ? h.rate : 0),
          effectiveDate: h.effectiveDate || h.date || todayISO(),
          stopDate: h.stopDate || null,
        }));
      }

      // Ensure name fields from old single-name format
      if (!c.firstName && !c.lastName && c.name) {
        const parts = c.name.trim().split(/\s+/);
        c.firstName = parts[0] || '';
        c.lastName = parts.slice(1).join(' ') || '';
      }
      if (c.status == null) c.status = 'active';
    });

    sessions.forEach((s) => {
      // Ensure clientIds array (migrate from single clientId)
      if (!Array.isArray(s.clientIds)) {
        s.clientIds = s.clientId ? [s.clientId] : [];
      }
      if (s.status == null) s.status = 'completed';

      // Migrate paymentStatus -> paid
      if (s.paid == null) {
        if (s.paymentStatus != null) {
          s.paid = s.paymentStatus === 'paid';
        } else if (s.payment != null) {
          s.paid = s.payment === 'paid';
        } else {
          s.paid = false;
        }
      }

      // Calculate companyAmount from client split if not already set
      if (s.companyAmount == null || s.companySplit == null) {
        const sessionClients = (s.clientIds || []).map((id) => clients.find((c) => c.id === id)).filter(Boolean);
        if (sessionClients.length > 0) {
          // Use the highest split among session clients
          const maxSplit = Math.max(...sessionClients.map((c) => getEffectiveSplit(c, s.date)));
          s.companySplit = maxSplit;
          s.companyAmount = num(s.amount) * (maxSplit / 100);
        } else {
          s.companySplit = 0;
          s.companyAmount = 0;
        }
      }
    });

    // Save migrated data
    saveData();
  }

  /** Get the effective split % for a client on a given date */
  function getEffectiveSplit(client, sessionDate) {
    if (!client) return 0;
    const history = client.splitHistory || [];
    if (history.length === 0) return num(client.companySplit);

    // Find the most recent entry whose effectiveDate <= sessionDate and (no stopDate or stopDate > sessionDate)
    const applicable = history
      .filter((h) => {
        const start = h.effectiveDate || '1970-01-01';
        const stop = h.stopDate;
        const date = sessionDate || todayISO();
        return start <= date && (!stop || stop > date);
      })
      .sort((a, b) => (b.effectiveDate || '').localeCompare(a.effectiveDate || ''));

    if (applicable.length > 0) return num(applicable[0].split);
    return num(client.companySplit);
  }

  /* ==========================================================
     SHARED METRICS MODEL — single source of truth
     Every dashboard/report/tax view should derive its numbers
     from computeMetrics() so "income", "your cut", "net", and
     per-family rollups are calculated ONE way everywhere.
     ========================================================== */

  /** Family group label for a client ('' if none). */
  function clientFamily(c) {
    return c && c.familyGroup ? String(c.familyGroup).trim() : '';
  }

  /**
   * A "group key" for rollups: the family name if the client belongs to one,
   * otherwise the individual client's own name. So Cal/Chase/Daisy (no family)
   * each become their own group, and the three Ventorinos roll into one.
   */
  function groupKeyForClient(c) {
    const fam = clientFamily(c);
    return fam || clientName(c);
  }

  /**
   * Compute rolled-up business metrics over a filtered set of sessions.
   *
   * filter (all optional):
   *   year       e.g. '2026'        (matches s.date.slice(0,4))
   *   month      e.g. '2026-03'     (matches s.date.slice(0,7))
   *   dateStart / dateEnd  ISO YYYY-MM-DD inclusive bounds
   *   clientId   only sessions including this client
   *   family     only sessions whose primary/any client is in this family
   *   paid       'paid' | 'unpaid'  (unpaid excludes waived)
   *
   * Money model (consistent everywhere):
   *   gross        = sum of session.amount (the full charged amount)
   *   companySplit = sum of session.companyAmount (what you pay the company)
   *   yourCut      = gross - companySplit   (what you actually keep, pre-expense)
   *   For per-CLIENT / per-FAMILY attribution, a multi-client session's gross
   *   and companySplit are divided EVENLY among its clients.
   */
  function computeMetrics(filter) {
    filter = filter || {};
    const allClients = clients;
    const findClient = (id) => allClients.find((c) => String(c.id) === String(id));

    // 1) Filter sessions (completed only — these are realized business activity)
    let rows = sessions.filter((s) => s.status === 'completed' && s.date);

    if (filter.year) rows = rows.filter((s) => s.date.slice(0, 4) === String(filter.year));
    if (filter.month) rows = rows.filter((s) => s.date.slice(0, 7) === filter.month);
    if (filter.dateStart) rows = rows.filter((s) => s.date >= filter.dateStart);
    if (filter.dateEnd) rows = rows.filter((s) => s.date <= filter.dateEnd);
    if (filter.clientId) {
      rows = rows.filter((s) => (s.clientIds || []).some((id) => String(id) === String(filter.clientId)));
    }
    if (filter.family) {
      rows = rows.filter((s) => (s.clientIds || []).some((id) => {
        const c = findClient(id);
        return c && clientFamily(c) === filter.family;
      }));
    }
    if (filter.paid === 'paid') rows = rows.filter((s) => s.paid === true);
    else if (filter.paid === 'unpaid') rows = rows.filter((s) => !s.paid && s.payment !== 'waived');

    // 2) Totals
    let gross = 0, companySplit = 0, miles = 0, hours = 0;
    let outstanding = 0, outstandingCount = 0;
    rows.forEach((s) => {
      gross += num(s.amount);
      companySplit += num(s.companyAmount);
      miles += num(s.mileage);
      hours += num(s.duration);
      if (!s.paid && s.payment !== 'waived') {
        outstanding += num(s.amount);
        outstandingCount++;
      }
    });
    const yourCut = gross - companySplit;

    // 3) Per-group (family-or-individual) rollup, splitting multi-client sessions evenly
    const groups = {};
    rows.forEach((s) => {
      const ids = s.clientIds || [];
      if (ids.length === 0) return;
      const shareGross = num(s.amount) / ids.length;
      const shareSplit = num(s.companyAmount) / ids.length;
      const shareHours = num(s.duration) / ids.length;
      const isUnpaid = !s.paid && s.payment !== 'waived';
      const shareUnpaid = isUnpaid ? num(s.amount) / ids.length : 0;
      // count a session once per group it touches
      const touched = new Set();
      ids.forEach((id) => {
        const c = findClient(id);
        if (!c) return;
        const key = groupKeyForClient(c);
        if (!groups[key]) {
          groups[key] = { key, family: clientFamily(c), gross: 0, companySplit: 0, yourCut: 0, hours: 0, sessions: 0, outstanding: 0 };
        }
        groups[key].gross += shareGross;
        groups[key].companySplit += shareSplit;
        groups[key].yourCut += (shareGross - shareSplit);
        groups[key].hours += shareHours;
        groups[key].outstanding += shareUnpaid;
        if (!touched.has(key)) { groups[key].sessions++; touched.add(key); }
      });
    });
    const groupRows = Object.values(groups).sort((a, b) => b.gross - a.gross);

    return {
      sessionCount: rows.length,
      gross, companySplit, yourCut, miles, hours,
      outstanding, outstandingCount,
      groups: groupRows,
      sessions: rows,
    };
  }

  /** Save all data to localStorage */
  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEYS.clients, JSON.stringify(clients));
      localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
      localStorage.setItem(STORAGE_KEYS.expenses, JSON.stringify(expenses));
      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
      localStorage.setItem(STORAGE_KEYS.receipts, JSON.stringify(receipts));
      localStorage.setItem(STORAGE_KEYS.taxPayments, JSON.stringify(taxPayments));
      const now = new Date();
      const ts = now.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      const el = $('last-saved');
      if (el) el.textContent = 'Saved ' + ts;
    } catch (e) {
      console.error('Failed to save data:', e);
      App.showToast('Failed to save data. Storage may be full.', 'error');
    }
  }

  /** Save and re-render current tab */
  function saveAndRender() {
    saveData();
    App.renderTab(activeTab);
    App.updateHeaderStats();
    App.scheduleSave();
  }

  /* ==========================================================
     3. THEME TOGGLE
     ========================================================== */

  function initTheme() {
    const saved = localStorage.getItem(STORAGE_KEYS.theme);
    if (saved) {
      document.documentElement.setAttribute('data-theme', saved);
    }
    updateThemeColor();
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(STORAGE_KEYS.theme, next);
    updateThemeColor();
    // Re-render charts with new theme
    if (activeTab === 'dashboard') App.renderDashboard();
  }

  function updateThemeColor() {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isDark ? '#1a1a2e' : '#ffffff');
  }

  /* ==========================================================
     4. TAB SYSTEM
     ========================================================== */

  function switchTab(tabName) {
    activeTab = tabName;

    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      const isActive = btn.getAttribute('data-tab') === tabName;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // Show/hide panels
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      const panelTab = panel.id.replace('panel-', '');
      const isActive = panelTab === tabName;
      panel.classList.toggle('active', isActive);
      panel.hidden = !isActive;
    });

    App.renderTab(tabName);
  }

  function renderTab(tabName) {
    switch (tabName) {
      case 'dashboard': App.renderDashboard(); break;
      case 'clients': App.renderClients(); break;
      case 'sessions': App.renderSessions(); break;
      case 'expenses': App.renderExpenses(); break;
      case 'reports': App.renderReports(); break;
      case 'tax': App.renderTaxSummary(); break;
    }
  }

  /* ==========================================================
     Expose everything to the App namespace
     ========================================================== */

  // Utilities
  App.$ = $;
  App.escapeHtml = escapeHtml;
  App.generateId = generateId;
  App.formatCurrency = formatCurrency;
  App.formatDate = formatDate;
  App.formatDuration = formatDuration;
  App.todayISO = todayISO;
  App.num = num;
  App.debounce = debounce;
  App.downloadFile = downloadFile;
  App.clientName = clientName;
  App.initials = initials;

  // Constants
  App.STORAGE_KEYS = STORAGE_KEYS;
  App.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  App.EXPENSE_CATEGORIES = EXPENSE_CATEGORIES;

  // Data functions
  App.loadData = loadData;
  App.migrateData = migrateData;
  App.getEffectiveSplit = getEffectiveSplit;
  App.computeMetrics = computeMetrics;
  App.clientFamily = clientFamily;
  App.groupKeyForClient = groupKeyForClient;
  App.saveData = saveData;
  App.saveAndRender = saveAndRender;

  // Theme
  App.initTheme = initTheme;
  App.toggleTheme = toggleTheme;
  App.updateThemeColor = updateThemeColor;

  // Tab system
  App.switchTab = switchTab;
  App.renderTab = renderTab;

})();
