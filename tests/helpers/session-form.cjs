'use strict';
// Drives the REAL session form code (openSessionForm / saveSession / handleInlineEdit in
// protected/js/sessions.js) against a recording fake DOM. Fabricated data only.
const { activate, recordingDocument, stubUi } = require('./harness.cjs');
const { MODULES, rawFixture } = require('./money-fixture.cjs');

async function formApp(options = {}) {
  const document = recordingDocument();
  const { App, disk } = await activate(MODULES, options.data || rawFixture(), { ...options, globals: { document, ...(options.globals || {}) } });
  const toasts = stubUi(App);
  const field = id => document.getElementById(id);
  /** Make the picker selection exactly `ids`, by tapping tiles through the real toggle handler. */
  const tile = id => ({ getAttribute: k => (k === 'data-id' ? String(id) : null), setAttribute() {}, classList: { toggle() {} } });
  const chooseClients = ids => {
    const want = ids.map(String), have = App.getSelectedSessionClientIds();
    have.filter(id => !want.includes(id)).forEach(id => App.toggleSessionClient(tile(id)));   // tap off
    want.filter(id => !have.includes(id)).forEach(id => App.toggleSessionClient(tile(id)));   // tap on, in the order given
  };
  const fill = values => Object.entries(values).forEach(([id, value]) => { field('session-' + id).value = value; });
  const working = id => disk().working.sessions.find(s => String(s.id) === String(id));
  const inline = (id, name, value) => App.handleInlineEdit({ value, getAttribute: k => ({ 'data-id': id, 'data-field': name })[k] });
  return { App, document, disk, toasts, field, chooseClients, fill, working, inline };
}

module.exports = { formApp };
