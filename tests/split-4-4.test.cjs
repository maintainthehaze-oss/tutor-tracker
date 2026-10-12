'use strict';
// Roadmap 4.4: sessions.js split into session-table.js / session-form.js / mileage.js. Static pins only:
// script order, the table module stays read-only, no function is defined twice across the four files.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSource } = require('./helpers/harness.cjs');

const MODULES = ['sessions', 'session-table', 'session-form', 'mileage'];

test('4.4 split: the four session modules load in order, right after sessions.js and before signatures.js', () => {
  const html = readSource('index.html');
  const at = name => html.indexOf('<script src="js/' + name + '.js" defer></script>');
  const order = [...MODULES, 'signatures'].map(at);
  assert.ok(order.every(i => i > 0), 'every module has a script tag');
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'script order: ' + [...MODULES, 'signatures'].join(' < '));
});

test('4.4 split: session-table.js only reads (no commands, storage, network or writes to App.state)', () => {
  const table = readSource('js/session-table.js');
  assert.doesNotMatch(table, /App\.runCommand\(|repository\.execute\(|localStorage|sessionStorage|indexedDB|fetch\(|App\.state\.\w+\s*=[^=]/);
});

test('4.4 split: every top-level function is defined exactly once across the four modules', () => {
  const seen = new Map();
  for (const name of MODULES) {
    for (const m of readSource('js/' + name + '.js').matchAll(/^  (?:async )?function (\w+)\(/gm)) {
      assert.ok(!seen.has(m[1]), m[1] + ' is defined in both ' + seen.get(m[1]) + ' and ' + name);
      seen.set(m[1], name);
    }
  }
  assert.ok(seen.size > 60, 'the sweep found the moved functions (' + seen.size + ')');
});
