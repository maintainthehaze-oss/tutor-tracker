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
  /** How the form reports the chosen clients. One place to change if the picker markup changes. */
  const chooseClients = ids => { field('session-clients').selectedOptions = ids.map(value => ({ value: String(value) })); };
  const fill = values => Object.entries(values).forEach(([id, value]) => { field('session-' + id).value = value; });
  const working = id => disk().working.sessions.find(s => String(s.id) === String(id));
  const inline = (id, name, value) => App.handleInlineEdit({ value, getAttribute: k => ({ 'data-id': id, 'data-field': name })[k] });
  return { App, document, disk, toasts, field, chooseClients, fill, working, inline };
}

module.exports = { formApp };
