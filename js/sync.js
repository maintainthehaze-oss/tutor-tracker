/* ============================================================
   Tutoring Tracker Pro — Sync
   GitHub Gist sync functions
   ============================================================ */
(function () {
  'use strict';

  const App = window.App;
  const $ = App.$;
  const num = App.num;

  function getSyncConfig() {
    const settings = App.state.settings;
    return {
      token: settings.gistToken || sessionStorage.getItem('gist-token') || '',
      gistId: settings.gistId || '',
    };
  }

  function hasSyncConfig() {
    const cfg = getSyncConfig();
    return !!(cfg.token);
  }

  /** Settings copy safe to store in the Gist: secrets and device-local
   *  values (the PAT itself, ORS key, home address, sync timestamp) stay
   *  on this device only. */
  function sanitizedSettings() {
    const s = { ...App.state.settings };
    delete s.gistToken;
    delete s.orsApiKey;
    delete s.businessAddress;
    delete s.lastSyncAt;
    return s;
  }

  /** Fetch the Gist's updated_at timestamp (null on any failure). */
  async function fetchGistUpdatedAt(cfg) {
    try {
      const resp = await fetch('https://api.github.com/gists/' + cfg.gistId, {
        headers: {
          Authorization: 'Bearer ' + cfg.token,
          Accept: 'application/vnd.github.v3+json',
        },
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      return data.updated_at || null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Push to Gist. Last-writer-wins is guarded: if the Gist changed since this
   * device last synced (another device pushed), a manual push asks before
   * overwriting and auto-sync aborts with a warning instead of clobbering.
   * opts.interactive — true for a user-initiated push (may show a confirm)
   * opts.force       — skip the freshness check (set after the user confirms)
   */
  async function saveToGist(opts) {
    opts = opts || {};
    const cfg = getSyncConfig();
    if (!cfg.token) {
      App.showToast('No GitHub token configured', 'warning');
      return;
    }
    updateSyncUI('syncing');

    // Freshness guard — only meaningful when updating an existing gist
    if (cfg.gistId && !opts.force) {
      const remoteUpdatedAt = await fetchGistUpdatedAt(cfg);
      const lastSyncAt = App.state.settings.lastSyncAt;
      const remoteIsNewer = remoteUpdatedAt &&
        (!lastSyncAt || new Date(remoteUpdatedAt).getTime() > new Date(lastSyncAt).getTime());
      if (remoteIsNewer) {
        updateSyncUI(null);
        if (opts.interactive) {
          App.showConfirm(
            'Gist Has Newer Data',
            'The Gist was updated after this device last synced (possibly from another device). Overwrite it with this device\'s data?',
            () => saveToGist({ interactive: true, force: true })
          );
        } else {
          App.showToast('Auto-sync skipped: Gist has newer data. Use Pull or Push in Settings to resolve.', 'warning');
          updateSyncUI('error');
        }
        return;
      }
    }

    try {
      const clients = App.state.clients;
      const sessions = App.state.sessions;
      const expenses = App.state.expenses;
      const receipts = App.state.receipts;
      const taxPayments = App.state.taxPayments;

      const payload = {
        description: 'Tutoring Tracker Pro Backup',
        files: {
          'tutoring-data.json': {
            content: JSON.stringify({
              clients,
              sessions,
              expenses,
              settings: sanitizedSettings(),
              receipts,
              taxPayments,
              exportedAt: new Date().toISOString(),
            }, null, 2),
          },
        },
      };

      let url, method;
      if (cfg.gistId) {
        url = 'https://api.github.com/gists/' + cfg.gistId;
        method = 'PATCH';
      } else {
        url = 'https://api.github.com/gists';
        method = 'POST';
        payload.public = false;
      }

      const resp = await fetch(url, {
        method,
        headers: {
          Authorization: 'Bearer ' + cfg.token,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github.v3+json',
        },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) throw new Error('HTTP ' + resp.status);

      const data = await resp.json();
      if (!cfg.gistId && data.id) {
        App.state.settings.gistId = data.id;
        const el = $('settings-gist-id');
        if (el) el.value = data.id;
      }
      App.state.settings.lastSyncAt = data.updated_at || new Date().toISOString();
      App.saveData();

      updateSyncUI('synced');
      App.showToast('Data pushed to Gist', 'success');
    } catch (e) {
      console.error('Gist push error:', e);
      updateSyncUI('error');
      App.showToast('Failed to push to Gist: ' + e.message, 'error');
    }
  }

  async function loadFromGist() {
    const cfg = getSyncConfig();
    if (!cfg.token || !cfg.gistId) {
      App.showToast('Gist ID and token required for pull', 'warning');
      return;
    }
    updateSyncUI('syncing');
    try {
      const resp = await fetch('https://api.github.com/gists/' + cfg.gistId, {
        headers: {
          Authorization: 'Bearer ' + cfg.token,
          Accept: 'application/vnd.github.v3+json',
        },
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);

      const data = await resp.json();
      const file = data.files['tutoring-data.json'];
      if (!file || !file.content) throw new Error('No data file in Gist');

      const imported = JSON.parse(file.content);
      if (imported.clients) App.state.clients = imported.clients;
      if (imported.sessions) App.state.sessions = imported.sessions;
      if (imported.expenses) App.state.expenses = imported.expenses;
      if (imported.settings) {
        // Device-local values always win over whatever the Gist holds
        // (older gists may still contain a token/key/address — ignore them).
        const local = App.state.settings;
        App.state.settings = {
          ...App.DEFAULT_SETTINGS,
          ...imported.settings,
          gistToken: local.gistToken,
          gistId: local.gistId,
          orsApiKey: local.orsApiKey,
          businessAddress: local.businessAddress,
          lastSyncAt: local.lastSyncAt,
        };
      }
      if (imported.receipts) App.state.receipts = imported.receipts;
      if (Array.isArray(imported.taxPayments)) App.state.taxPayments = imported.taxPayments;
      App.state.settings.lastSyncAt = data.updated_at || new Date().toISOString();

      App.migrateData();
      App.saveData();
      App.renderTab(App.state.activeTab);
      App.updateHeaderStats();
      updateSyncUI('synced');
      App.showToast('Data pulled from Gist', 'success');
    } catch (e) {
      console.error('Gist pull error:', e);
      updateSyncUI('error');
      App.showToast('Failed to pull from Gist: ' + e.message, 'error');
    }
  }

  function scheduleSave() {
    if (!hasSyncConfig()) return;
    const settings = App.state.settings;
    if (settings.autoSync === 'off') return;
    if (settings.autoSync === 'save') {
      clearTimeout(App.state.syncDebounceTimer);
      App.state.syncDebounceTimer = setTimeout(() => saveToGist(), 5000);
    }
  }

  function startAutoSync() {
    clearInterval(App.state.syncTimer);
    if (!hasSyncConfig()) return;
    const settings = App.state.settings;
    let interval = 0;
    if (settings.autoSync === '5min' || settings.autoSync === 'frequent') interval = 5 * 60 * 1000;
    else if (settings.autoSync === '15min') interval = 15 * 60 * 1000;
    if (interval > 0) {
      App.state.syncTimer = setInterval(() => saveToGist(), interval);
    }
  }

  function updateSyncUI(status) {
    const el = $('sync-indicator');
    if (!el) return;
    el.className = 'sync-indicator';
    const textEl = el.querySelector('.sync-text');
    const gistLink = el.querySelector('.sync-gist-link');
    const settings = App.state.settings;

    // Show/hide Gist link
    if (gistLink) {
      if (hasSyncConfig() && settings.gistId) {
        gistLink.href = 'https://gist.github.com/' + encodeURIComponent(settings.gistId);
        gistLink.style.display = 'inline';
        gistLink.title = 'Open Gist: ' + settings.gistId;
      } else {
        gistLink.style.display = 'none';
      }
    }

    switch (status) {
      case 'synced':
        el.classList.add('sync-ok');
        if (textEl) textEl.textContent = 'Synced';
        break;
      case 'syncing':
        el.classList.add('sync-active');
        if (textEl) textEl.textContent = 'Syncing...';
        break;
      case 'error':
        el.classList.add('sync-error');
        if (textEl) textEl.textContent = 'Sync error';
        break;
      case 'offline':
        el.classList.add('sync-offline');
        if (textEl) textEl.textContent = 'Offline';
        break;
      default:
        if (textEl) textEl.textContent = hasSyncConfig() ? 'Ready' : 'Not synced';
    }
  }

  // Expose to App namespace
  App.getSyncConfig = getSyncConfig;
  App.hasSyncConfig = hasSyncConfig;
  App.saveToGist = saveToGist;
  App.loadFromGist = loadFromGist;
  App.scheduleSave = scheduleSave;
  App.startAutoSync = startAutoSync;
  App.updateSyncUI = updateSyncUI;

})();
