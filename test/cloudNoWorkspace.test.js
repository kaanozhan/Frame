/**
 * cloudNoWorkspace tests — the words for a signed-in user without a workspace.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 * Pure: no DOM, no Electron.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const copy = require('../src/renderer/cloudNoWorkspace');

test('workspaceRow without a workspace offers to create one', () => {
  const expected = { value: 'No workspace', link: 'Create a workspace' };
  assert.deepEqual(copy.workspaceRow(null), expected);
  assert.deepEqual(copy.workspaceRow(undefined), expected);
  assert.deepEqual(copy.workspaceRow({ name: 'Lab', slug: '' }), expected);
});

test('workspaceRow with a workspace names it and opens it in the browser', () => {
  assert.deepEqual(copy.workspaceRow({ name: 'Lab', slug: 'lab' }), { value: 'Lab', link: 'Open in browser' });
  assert.deepEqual(copy.workspaceRow({ name: '', slug: 'lab' }), { value: 'lab', link: 'Open in browser' });
});

test('panel counts no Frame projects on this device', () => {
  const p = copy.panel(0);
  assert.equal(p.title, 'A workspace for your own projects');
  assert.match(p.body, /^This device has no Frame projects yet\./);
  assert.equal(p.button, 'Create a workspace');
  assert.match(p.local, /needs no account/);
});

test('panel counts one Frame project in the singular', () => {
  assert.match(copy.panel(1).body, /^This device has 1 Frame project\. With a workspace you can add it /);
});

test('panel counts several Frame projects in the plural', () => {
  assert.match(copy.panel(3).body, /^This device has 3 Frame projects\. With a workspace you can add them /);
});

test('panel treats a missing or odd count as none', () => {
  for (const n of [undefined, null, -2, 'x']) {
    assert.equal(copy.panel(n).body, copy.panel(0).body, String(n));
  }
});

test('settingsRow says there is no workspace and leads to Frame Cloud', () => {
  assert.deepEqual(copy.settingsRow(), {
    label: 'No workspace',
    description: 'Create a workspace on the web to connect this project to Frame Cloud.',
    action: 'Open Frame Cloud',
  });
});

test('no string names a trial, a plan, Pro or a price', () => {
  const strings = [
    copy.NO_WEB_ORIGIN,
    ...Object.values(copy.workspaceRow(null)),
    ...Object.values(copy.workspaceRow({ name: 'Lab', slug: 'lab' })),
    ...[0, 1, 3].flatMap((n) => Object.values(copy.panel(n))),
    ...Object.values(copy.settingsRow()),
  ];
  for (const s of strings) {
    assert.doesNotMatch(s, /\btrial\b|\bplan\b|\bPro\b|\$|€|£|\bprice\b|\bfree\b/i, s);
  }
});
