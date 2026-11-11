/**
 * The screen mirror loads on Node 21+ (field test, 2026-11-11): Node 21 added
 * a global `navigator`, and xterm-headless 5.3 decides "not Node" from
 * `typeof navigator`, then touches `window` and crashes at load. Simulated
 * here on any Node by defining a navigator before the first require.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('screenMirror loads and works with a global navigator present (Node 21+)', async () => {
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Node.js/22' }, configurable: true, writable: true, enumerable: false });
  try {
    for (const k of Object.keys(require.cache)) if (/xterm-headless|xterm-addon-serialize|screenMirror/.test(k)) delete require.cache[k];
    const { createMirror } = require('../src/server/screenMirror');
    const m = createMirror({ cols: 20, rows: 4 });
    m.write('hello');
    const snap = await m.snapshot();
    assert.match(String(snap.screen || snap), /hello/);
    assert.equal(typeof globalThis.navigator, 'object', 'the global navigator is put back');
  } finally {
    delete globalThis.navigator;
  }
});
