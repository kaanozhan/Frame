/**
 * cloudRoles tests — the words Frame says about a workspace role.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 * Pure: no DOM, no Electron.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const roles = require('../src/renderer/cloudRoles');
const { NO_WEB_ORIGIN } = require('../src/renderer/cloudNoWorkspace');

test('roleLabel names the three roles as the web does and nothing else', () => {
  assert.equal(roles.roleLabel('admin'), 'Admin');
  assert.equal(roles.roleLabel('developer'), 'Developer');
  assert.equal(roles.roleLabel('viewer'), 'Viewer');
  for (const unknown of ['pm', '', undefined, null, 'toString', 'constructor']) {
    assert.equal(roles.roleLabel(unknown), '', String(unknown));
  }
  assert.ok(Object.isFrozen(roles.ROLE_LABELS));
});

test('workspaceLine puts the role beside the workspace', () => {
  assert.equal(roles.workspaceLine({ name: 'Acme', slug: 'acme', role: 'developer' }), 'Acme · Developer');
  assert.equal(roles.workspaceLine({ name: 'Acme', slug: 'acme', role: 'admin' }), 'Acme · Admin');
  assert.equal(roles.workspaceLine({ name: '', slug: 'acme', role: 'viewer' }), 'acme · Viewer');
});

test('workspaceLine shows the name alone without a known role, and nothing without a workspace', () => {
  assert.equal(roles.workspaceLine({ name: 'Acme', slug: 'acme' }), 'Acme');
  assert.equal(roles.workspaceLine({ name: 'Acme', slug: 'acme', role: 'pm' }), 'Acme');
  assert.equal(roles.workspaceLine(null), '');
  assert.equal(roles.workspaceLine(undefined), '');
  assert.equal(roles.workspaceLine({ name: '', slug: '' }), '');
});

test('viewerPanel sends a viewer to the web and says an admin can change the role', () => {
  const copy = roles.viewerPanel({ workspace: { name: 'Acme', slug: 'acme', role: 'viewer' }, canOpenWeb: true });
  assert.equal(copy.title, 'Viewers follow the work on the web');
  assert.match(copy.body, /^You are a viewer in Acme\. /);
  assert.match(copy.body, /Viewers can read everything in the workspace/);
  assert.match(copy.body, /An admin can change your role\.$/);
  assert.equal(copy.button, 'Open on web');
  assert.equal(copy.buttonTitle, null);
  assert.ok(copy.local);
});

test('viewerPanel without a web origin says why the button cannot open', () => {
  const copy = roles.viewerPanel({ workspace: { name: 'Acme', slug: 'acme' }, canOpenWeb: false });
  assert.equal(copy.buttonTitle, NO_WEB_ORIGIN);
  assert.equal(roles.viewerPanel().buttonTitle, NO_WEB_ORIGIN);
  assert.match(roles.viewerPanel().body, /^Viewers can read everything/);
});

test('viewerSettingsRow names the workspace and opens the window, with no connect', () => {
  assert.deepEqual(roles.viewerSettingsRow({ name: 'Acme', slug: 'acme' }), {
    label: 'Viewer in Acme',
    description: 'Viewers follow Frame Cloud on the web. An admin can change your role.',
    action: 'Open Frame Cloud',
  });
  assert.equal(roles.viewerSettingsRow(null).label, 'Viewer');
});

test('the developer line and the refusal sentence', () => {
  assert.equal(roles.CREATE_ADMIN_ONLY, 'An admin adds projects to Frame Cloud.');
  assert.match(roles.ROLE_FORBIDDEN, /^Your role in this workspace /);
  assert.match(roles.ROLE_FORBIDDEN, /An admin can change your role\.$/);
});
