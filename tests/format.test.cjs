'use strict';
// Display helpers in app-core.js. No data involved.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/harness.cjs');

test('formatDuration never prints 60 minutes (audit 6f)', () => {
  const { formatDuration } = loadApp(['app-core']);
  for (const [hours, expected] of [[1.999, '2h'], [0.999, '1h'], [2, '2h'], [1.9917, '2h'], [0.9917, '1h'],
    [0.83, '50m'], [0.5, '30m'], [0.75, '45m'], [1, '1h'], [1.5, '1h 30m'], [1.25, '1h 15m'], [2.75, '2h 45m'],
    ['1.50', '1h 30m'], [8.33, '8h 20m'], [0, '0h'], [-1, '0h'], ['abc', '0h'], [null, '0h']])
    assert.equal(formatDuration(hours), expected, String(hours));
  for (let minutes = 1; minutes <= 600; minutes++) {
    const text = formatDuration(minutes / 60), match = /^(?:(\d+)h)? ?(?:(\d+)m)?$/.exec(text);
    assert.ok(match, text);
    assert.ok(Number(match[2] || 0) < 60, minutes + ' min printed as ' + text);
    assert.equal(Number(match[1] || 0) * 60 + Number(match[2] || 0), minutes, minutes + ' min printed as ' + text);
  }
});
