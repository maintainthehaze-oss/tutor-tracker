// The app shows and hides everything with the `hidden` attribute (no style.display anywhere).
// A class that sets `display` beats the browser's built-in [hidden] rule, so the stylesheet must
// carry a global override. Found live 2026-09-19: the locked-session note showed on every new session.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'protected');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('stylesheet makes the hidden attribute always win', () => {
  assert.match(css, /(^|\n)\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
});

test('no script shows or hides with style.display (it would fight the global rule)', () => {
  const dir = path.join(root, 'js');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.ok(!/\.style\.display/.test(source), `${file} uses style.display`);
  }
});
