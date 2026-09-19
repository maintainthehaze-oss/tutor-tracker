'use strict';
// Shared Node harness for the protected app. Fabricated data only: this repo is public.
// Loads the real modules from protected/js into a vm context with inert browser stubs.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const root = path.resolve(__dirname, '../../protected');
const readSource = file => fs.readFileSync(path.join(root, file), 'utf8');

/** Inert `document`: app-core registers a DOMContentLoaded listener at load (split preference). */
function documentStub() {
  return { body: null, getElementById: () => null, addEventListener() {}, querySelectorAll: () => [], querySelector: () => null };
}

/** `document` whose getElementById hands back one persistent fake element per id, so a test can
 *  read what a render function wrote (textContent / innerHTML / hidden / title) without a browser. */
function recordingDocument() {
  const elements = new Map();
  const element = () => ({ textContent: '', innerHTML: '', title: '', hidden: false, value: '', dataset: {},
    classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, getAttribute: () => null });
  return { ...documentStub(), elements,
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); } };
}

/** In-memory localStorage so UI-preference code can be exercised without a browser. */
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: k => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: k => { map.delete(String(k)); },
    dump: () => Object.fromEntries(map),
  };
}

/**
 * Build a vm context and run the named protected/js modules in order.
 * `sources` lets a mutation test substitute altered source text for one module.
 */
function loadApp(modules, { sources = {}, globals = {} } = {}) {
  const context = vm.createContext({
    window: {}, document: documentStub(), crypto: webcrypto, TextEncoder, console,
    location: { hostname: 'localhost' }, indexedDB: {}, setTimeout, Date, ...globals,
  });
  for (const name of modules) {
    vm.runInContext(sources[name] ?? readSource('js/' + name + '.js'), context, { filename: name + '.js' });
  }
  return context.window.App;
}

/** App with an activated in-memory repository seeded from fabricated `data`. */
async function activate(modules, data, options) {
  const App = loadApp(modules, options);
  let stored = null;
  App.repository = App.Repository.create({
    read: async () => (stored == null ? stored : JSON.parse(JSON.stringify(stored))),
    compareAndSwap: async (_, next) => { stored = JSON.parse(JSON.stringify(next)); },
  });
  await App.repository.activateSynthetic(JSON.stringify(data), { definition: 'fabricated test evidence' });
  if (App.refreshReadViews) App.refreshReadViews();
  return { App, disk: () => JSON.parse(JSON.stringify(stored)) };
}

const command = (repo, name, payload) => repo.execute(name, payload, repo.revision);

module.exports = { root, readSource, documentStub, recordingDocument, memoryStorage, loadApp, activate, command };
