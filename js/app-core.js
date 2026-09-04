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

  /** Get today's date as YYYY-MM-DD in the LOCAL timezone (not UTC — evening
   *  entries in US timezones must not roll over to tomorrow's date). */
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  /** Parse float safely */
  function num(v) {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
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
    lastSyncAt: null,
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

  /** IRS standard business mileage rates by tax year (IRS-published figures:
   *  2024 = 67c, 2025 = 70c, 2026 = 72.5c). Years not listed fall back to the
   *  user-set settings.mileageRate so future years work before this table is
   *  updated. */
  const MILEAGE_RATES = { 2024: 0.67, 2025: 0.70, 2026: 0.725 };
  const _mileageRateWarned = new Set();

  function mileageRateFor(year) {
    const y = parseInt(year, 10);
    if (MILEAGE_RATES[y] != null) return MILEAGE_RATES[y];
    const fallback = num(settings.mileageRate) || 0.725;
    if (!_mileageRateWarned.has(y)) {
      _mileageRateWarned.add(y);
      setTimeout(() => {
        if (App.showToast) App.showToast('No IRS mileage rate on file for ' + y + ' — using $' + fallback.toFixed(3) + '/mi. Update in Settings when the IRS publishes the rate.', 'warning');
      }, 0);
    }
    return fallback;
  }

  /** Application state */
  let clients = [];
  let sessions = [];
  let expenses = [];
  let settings = { ...DEFAULT_SETTINGS };
  let receipts = {};
  let taxPayments = [];
  // Receipts hold base64 image blobs (the largest store). Only re-serialize
  // them to localStorage when they actually changed, so routine saves (e.g. an
  // inline session edit) don't rewrite megabytes on every keystroke. Fail-safe:
  // defaults true and every receipts mutation re-arms it ("when in doubt, write").
  let receiptsDirty = true;

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
    set receipts(v) { receipts = v; receiptsDirty = true; },
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

  // Keys whose stored value was corrupt at load (backed up, never auto-overwritten)
  let corruptKeys = [];

  /** True if any localStorage store failed to load this session (sync pushes are blocked). */
  function hasCorruptStores() { return corruptKeys.length > 0; }

  /**
   * Parse one store from localStorage with shape validation. If the value is
   * unparseable OR the wrong shape, the RAW value is preserved to a
   * `<key>-corrupt-<timestamp>` backup key before the fallback is used, so the
   * original is always recoverable.
   */
  function loadStore(key, fallback, isValid) {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    let parsed;
    try {
      parsed = JSON.parse(raw);
      if (isValid(parsed)) return parsed;
    } catch (_) { /* fall through to backup */ }
    try {
      localStorage.setItem(key + '-corrupt-' + Date.now(), raw);
    } catch (e) {
      console.error('Could not back up corrupt store ' + key, e);
    }
    corruptKeys.push(key);
    console.error('Corrupt or wrong-shaped data in ' + key + ' — backed up, using empty fallback. NOT auto-saving over it.');
    return fallback;
  }

  /** Load all data from localStorage */
  function loadData() {
    corruptKeys = [];
    const isArr = Array.isArray;
    const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

    clients = loadStore(STORAGE_KEYS.clients, [], isArr);
    sessions = loadStore(STORAGE_KEYS.sessions, [], isArr);
    expenses = loadStore(STORAGE_KEYS.expenses, [], isArr);
    const rawSettings = loadStore(STORAGE_KEYS.settings, {}, isObj);
    settings = { ...DEFAULT_SETTINGS, ...rawSettings };
    receipts = loadStore(STORAGE_KEYS.receipts, {}, isObj);
    taxPayments = loadStore(STORAGE_KEYS.taxPayments, [], isArr);

    if (corruptKeys.length > 0) {
      // ui.js loads after app-core; surface the warning once the app is up.
      const keys = corruptKeys.join(', ');
      setTimeout(() => {
        if (App.showToast) {
          App.showToast('Some saved data was unreadable (' + keys + '). A backup copy was kept in browser storage — do not clear site data before recovering it.', 'error');
        }
      }, 500);
    }

    // Security cleanup: legacy sync keys from an old storage scheme held the
    // GitHub PAT and gist ID in plaintext. Nothing reads them anymore.
    localStorage.removeItem('tutor-gist-pat');
    localStorage.removeItem('tutor-gist-id');

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

    // Save migrated data — but NEVER when a store loaded corrupt, so the
    // original raw value in localStorage is not overwritten by empty state.
    if (corruptKeys.length === 0) saveData();
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
   * otherwise the individual client's own name. Clients with no family each
   * become their own group; siblings sharing a family roll into one.
   */
  /**
   * Grouping key for rollups. Namespaced so a family label can never collide
   * with an individual's display name (a family "Smith" and a solo client
   * named Smith must stay separate rows and separate Mark-paid targets).
   */
  function groupKeyForClient(c) {
    const fam = clientFamily(c);
    return fam ? 'family:' + fam : 'client:' + String(c.id);
  }

  /** Human label for a group: the family name, or the client's own name. */
  function groupLabelForClient(c) {
    return clientFamily(c) || clientName(c);
  }

  /** 'YYYY-MM' for a Date (local time). */
  function monthKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  /** 'YYYY-MM' for today. */
  function currentMonth() {
    return monthKey(new Date());
  }

  /**
   * Mark one session paid. Only the unpaid -> paid transition stamps
   * paymentDate, so re-marking never moves a payment's tax year.
   * Returns true if anything changed.
   */
  function markSessionPaid(s) {
    if (!s || s.paid) return false;
    s.paid = true;
    s.payment = 'paid';
    s.paymentDate = todayISO();
    s.updatedAt = new Date().toISOString();
    return true;
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
    const findClient = clientLookup();

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
          groups[key] = { key, label: groupLabelForClient(c), family: clientFamily(c), gross: 0, companySplit: 0, yourCut: 0, hours: 0, sessions: 0, outstanding: 0, members: {} };
        }
        const g = groups[key];
        g.gross += shareGross;
        g.companySplit += shareSplit;
        g.yourCut += (shareGross - shareSplit);
        g.hours += shareHours;
        g.outstanding += shareUnpaid;
        if (!g.members[c.id]) g.members[c.id] = { client: c, gross: 0, outstanding: 0, sessions: 0 };
        g.members[c.id].gross += shareGross;
        g.members[c.id].outstanding += shareUnpaid;
        g.members[c.id].sessions++;
        if (!touched.has(key)) { g.sessions++; touched.add(key); }
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

  /**
   * Money owed RIGHT NOW, grouped by family (siblings roll up; solo clients
   * stand alone). ALL TIME — no month/date filter on purpose. Same rollup as
   * computeMetrics (one set of grouping/split rules), restricted to unpaid.
   *
   * Returns { total, count, groups: [{ key, label, family, amount, count, members: [{ client, amount, count }] }] }
   * sorted by amount desc.
   */
  function computeOwedByFamily() {
    const m = computeMetrics({ paid: 'unpaid' });
    const groups = m.groups
      .filter((g) => g.outstanding > 0)
      .map((g) => ({
        key: g.key, label: g.label, family: g.family,
        amount: g.outstanding, count: g.sessions,
        members: Object.values(g.members)
          .map((x) => ({ client: x.client, amount: x.outstanding, count: x.sessions }))
          .sort((a, b) => b.amount - a.amount),
      }))
      .sort((a, b) => b.amount - a.amount);
    return { total: m.outstanding, count: m.outstandingCount, groups };
  }

  /** Sessions where money is actually owed: completed, unpaid, not waived. */
  function owedSessions() {
    return sessions.filter((s) => s.status === 'completed' && !s.paid && s.payment !== 'waived');
  }

  /** One Map build per call instead of a clients.find() per session id. */
  function clientLookup() {
    const map = new Map(clients.map((c) => [String(c.id), c]));
    return (id) => map.get(String(id));
  }

  /**
   * Owed sessions for a family/individual group key, split into:
   *   own    — every known client on the session is in this group (safe to mark paid as a unit)
   *   shared — the session also bills another group; marking it paid here would
   *            silently clear the other family's balance, so callers must not.
   */
  function owedSessionsForGroup(key) {
    const findClient = clientLookup();
    const own = [], shared = [];
    owedSessions().forEach((s) => {
      const groupsOnSession = (s.clientIds || []).map(findClient).filter(Boolean).map(groupKeyForClient);
      if (!groupsOnSession.includes(key)) return;
      (groupsOnSession.every((k) => k === key) ? own : shared).push(s);
    });
    return { own, shared };
  }

  /** Save all data to localStorage */
  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEYS.clients, JSON.stringify(clients));
      localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
      localStorage.setItem(STORAGE_KEYS.expenses, JSON.stringify(expenses));
      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
      // Skip the costly receipts re-serialization when nothing touched them.
      if (receiptsDirty) {
        localStorage.setItem(STORAGE_KEYS.receipts, JSON.stringify(receipts));
        receiptsDirty = false;
      }
      localStorage.setItem(STORAGE_KEYS.taxPayments, JSON.stringify(taxPayments));
      const now = new Date();
      const ts = now.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      const el = $('last-saved');
      if (el) el.textContent = 'Saved ' + ts;
      // Every successful local write marks data as unsynced; the sync module
      // clears this after a confirmed push (and after a pull, when local ==
      // remote by definition).
      try { localStorage.setItem('tutor-sync-dirty', '1'); } catch (_) { /* ignore */ }
      return true;
    } catch (e) {
      console.error('Failed to save data:', e);
      App.showToast('Failed to save data. Storage may be full.', 'error');
      return false;
    }
  }

  /** Save and re-render current tab. Returns whether the save succeeded. */
  function saveAndRender() {
    const ok = saveData();
    App.renderTab(activeTab);
    App.updateHeaderStats();
    App.scheduleSave();
    return ok;
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
  App.downloadFile = downloadFile;
  App.clientName = clientName;
  App.initials = initials;

  // Constants
  App.STORAGE_KEYS = STORAGE_KEYS;
  App.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  App.EXPENSE_CATEGORIES = EXPENSE_CATEGORIES;
  App.MILEAGE_RATES = MILEAGE_RATES;
  App.mileageRateFor = mileageRateFor;

  // Data functions
  App.loadData = loadData;
  App.migrateData = migrateData;
  App.getEffectiveSplit = getEffectiveSplit;
  App.computeMetrics = computeMetrics;
  App.clientFamily = clientFamily;
  App.groupKeyForClient = groupKeyForClient;
  App.computeOwedByFamily = computeOwedByFamily;
  App.groupLabelForClient = groupLabelForClient;
  App.monthKey = monthKey;
  App.currentMonth = currentMonth;
  App.markSessionPaid = markSessionPaid;
  App.owedSessionsForGroup = owedSessionsForGroup;
  App.saveData = saveData;
  App.hasCorruptStores = hasCorruptStores;
  App.saveAndRender = saveAndRender;
  // In-place receipt mutations (expenses.js) must arm the dirty flag; reassigning
  // App.state.receipts arms it automatically via the setter.
  App.markReceiptsDirty = () => { receiptsDirty = true; };

  // Theme
  App.initTheme = initTheme;
  App.toggleTheme = toggleTheme;
  App.updateThemeColor = updateThemeColor;

  // Tab system
  App.switchTab = switchTab;
  App.renderTab = renderTab;

})();
