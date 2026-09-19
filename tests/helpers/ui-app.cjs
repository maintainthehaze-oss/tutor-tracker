'use strict';
// Boots the protected UI (every page script except the OCR loader, ending with ui.js and its real init();
// tab painting is switched off) inside a vm context with a recording fake DOM, a controllable clock, an in-memory localStorage
// and an in-memory repository. No browser, no network, fabricated data only.
// This is unit-level evidence: it proves the wiring, not what a person sees on screen.
const { activate, recordingDocument, memoryStorage, fakeClock } = require('./harness.cjs');
const { rawFixture } = require('./money-fixture.cjs');

const PAGE_SCRIPTS = ['app-core', 'backup-status', 'record-policy', 'repository', 'report-model', 'sync', 'dashboard',
  'historical', 'clients', 'sessions', 'recurring', 'expenses', 'reports'];

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
/** Poll (real event loop) until `predicate()` is true. Hashing in the repository is genuinely asynchronous. */
async function waitFor(predicate, label) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw Error('Timed out waiting for: ' + label);
    await new Promise(resolve => setImmediate(resolve));
  }
  await settle();
}

/**
 * options.startAt   local ISO time for the fake clock (default 2026-03-10 12:00)
 * options.storage   an existing memoryStorage (simulated reload keeps the browser's localStorage)
 * options.stored    a previously saved envelope (simulated reload keeps the browser's IndexedDB)
 * options.navigator navigator stub (default: storage.persist() resolves true)
 */
async function bootUi(options = {}) {
  const time = options.time || fakeClock(options.startAt || '2026-03-10T12:00:00');
  const storage = options.storage || memoryStorage();
  const document = recordingDocument();
  Object.assign(document, { readyState: 'complete', body: document.getElementById('(body)'), documentElement: document.getElementById('(html)'),
    createElement: () => document.getElementById('(created)'), querySelector: selector => document.getElementById('(query) ' + selector) });
  const downloads = [];
  const globals = { document, localStorage: storage, Date: time.Date, Chart: class { destroy() {} update() {} },
    navigator: options.navigator || { storage: { persist: async () => true } },
    window: { addEventListener() {} }, location: { hostname: 'localhost', hash: '' },
    requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout() {}, ...(options.globals || {}) };
  const env = await activate(PAGE_SCRIPTS, options.data || rawFixture(), { globals, stored: options.stored, sources: options.sources });
  env.App.downloadFile = (content, filename, type) => downloads.push({ content, filename, type });
  // Tab painting (charts, tables) is out of scope for wiring tests and needs a far richer DOM than this fake one.
  env.App.renderTab = () => {};
  const field = id => document.getElementById(id);
  env.run(['ui']);           // runs the real init()
  // init() is not awaitable from outside; its LAST statement wires the maintenance button.
  await waitFor(() => (field('toggle-maintenance').listeners.click || []).length > 0, 'ui.js init() to finish');
  /** Dispatch a delegated click exactly the way ui.js receives it: body listener + closest('[data-action]'). */
  async function click(action, attributes = {}) {
    const all = { 'data-action': action, ...attributes };
    const target = { getAttribute: k => (k in all ? all[k] : null), setAttribute(k, v) { all[k] = String(v); }, classList: { contains: () => false, toggle() {} }, dataset: {},
      closest: s => (s === '[data-action]' ? target : null) };
    for (const listener of document.body.listeners.click || []) await listener({ target, preventDefault() {}, stopPropagation() {} });
    await settle();
  }
  /** A committed form-control change, delivered through the same body 'change' delegation ui.js uses. */
  async function change(id, value) {
    field(id).value = value;
    for (const listener of document.body.listeners.change || []) await listener({ target: { id, value, getAttribute: () => null } });
    await settle();
  }
  const save = async (n = 1) => {
    for (let i = 0; i < n; i++) await env.App.runCommand('settings.update', { patch: { businessName: 'Fabricated Tutoring ' + env.App.repository.revision } }, env.App.repository.revision);
    await settle();
  };
  return { ...env, document, storage, downloads, clock: time.clock, time, field, click, change, save, settle, waitFor };
}

module.exports = { bootUi, settle, waitFor };
