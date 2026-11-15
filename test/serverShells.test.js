/**
 * Shells on a Linux Frame Server (server-linux-readiness T02, T03).
 *
 * T02: the default Unix shell when none was chosen, and a requested shell
 * path that does not exist on this machine. The rules take the platform and
 * a file-exists check, so Linux is tested on any machine.
 * T03: a server workspace's "+" menu lists the server's shells
 * (terminals.shells), and never an empty list — the menus read empty as
 * "still loading" and ask again.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Module = require('node:module');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-shells-'));
process.env.HOME = SANDBOX;
const STUBS = {
  'node-pty': { spawn() { throw new Error('not in this test'); } },
  '@aptabase/electron/main': { initialize() {}, trackEvent() {} },
  'posthog-node': { PostHog: class { capture() {} shutdown() { return Promise.resolve(); } } },
  electron: { app: { getPath: () => SANDBOX, getVersion: () => '0.0.0', on() {} }, ipcMain: { on() {}, handle() {}, removeHandler() {} }, BrowserWindow: { getAllWindows: () => [] } }
};
// T03: a connected Frame Server and one server workspace, stubbed.
const { EventEmitter } = require('events');
const serverCalls = [];
const fakeServer = new EventEmitter();
// One saved server (multi-server-connections): the fake is both the registry
// (of / all) and that server's link (key kbox).
Object.assign(fakeServer, {
  key: 'kbox',
  host: 'box',
  of(key) { return key === 'kbox' ? this : null; },
  all() { return [this]; },
  connected: true,
  shells: [{ id: 'bash', name: 'Bash', path: '/bin/bash', isDefault: true }, { id: 'sh', name: 'Shell', path: '/bin/sh' }],
  isConnected() { return this.connected; },
  getStatus() { return { state: this.connected ? 'connected' : 'reconnecting', host: 'box' }; },
  on(name, fn) { EventEmitter.prototype.on.call(this, name, fn); return () => this.removeListener(name, fn); },
  async call(method) {
    serverCalls.push(method);
    if (method === 'terminals.shells') {
      if (this.shells instanceof Error) throw this.shells;
      return this.shells;
    }
    return null;
  }
});
const fakeWorkspaces = {
  serverLocation: (id) => (id === 'srv-ws' ? { path: '/home/u/frame/workspaces/app/teal', host: 'box', serverKey: 'kbox', projectPath: '/Users/me/app', serverProjectPath: '/home/u/frame/projects/app' } : null),
  serverRoots: () => []
};
const MAIN = path.join(__dirname, '..', 'src', 'main');
const loadOriginal = Module._load;
Module._load = function (request, parent, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('.') && parent && parent.filename && parent.filename.startsWith(MAIN)) {
    let resolved = null;
    try { resolved = Module._resolveFilename(request, parent); } catch (_) { resolved = null; }
    if (resolved === path.join(MAIN, 'serverConnection.js')) return fakeServer;
    if (resolved === path.join(MAIN, 'workspaceManager.js')) return fakeWorkspaces;
  }
  return loadOriginal.call(this, request, parent, ...rest);
};

const pty = require('../src/main/ptyManager');
const { IPC } = require('../src/shared/ipcChannels');
const handlers = {};
pty.init({ isDestroyed: () => false, webContents: { send() {}, isDestroyed: () => false } });
pty.setupIPC({ on: (ch, fn) => { handlers[ch] = fn; }, handle: (ch, fn) => { handlers[ch] = fn; }, removeHandler() {} });

/** Ask for the shell list like the renderer does; resolve the reply. */
function shellsFor(workspaceId) {
  return new Promise((resolve) => {
    handlers[IPC.GET_AVAILABLE_SHELLS]({ reply: (ch, payload) => resolve(payload) }, workspaceId === undefined ? undefined : { workspaceId });
  });
}

const has = (...files) => (p) => files.includes(p);

// ─── T02: default and requested shells ───────────────────────

test('T02: $SHELL wins wherever it is set', () => {
  assert.equal(pty.defaultUnixShell('linux', { SHELL: '/usr/bin/fish' }, has()), '/usr/bin/fish');
  assert.equal(pty.defaultUnixShell('darwin', { SHELL: '/bin/bash' }, has()), '/bin/bash');
});

test('T02: with $SHELL unset, Linux starts bash, else sh; macOS keeps zsh', () => {
  assert.equal(pty.defaultUnixShell('linux', {}, has('/bin/bash', '/bin/sh')), '/bin/bash');
  assert.equal(pty.defaultUnixShell('linux', {}, has('/bin/sh')), '/bin/sh', 'no bash: sh');
  assert.equal(pty.defaultUnixShell('darwin', {}, has()), '/bin/zsh');
});

test('T02: on Linux a requested shell that does not exist there is dropped for the default', () => {
  assert.equal(pty.requestedShell('/bin/zsh', 'linux', has('/bin/bash')), null);
  assert.equal(pty.requestedShell('/bin/bash', 'linux', has('/bin/bash')), '/bin/bash');
  assert.equal(pty.requestedShell(null, 'linux', has()), null);
});

test('T02: macOS and Windows pass a requested shell through as before', () => {
  assert.equal(pty.requestedShell('/opt/homebrew/bin/fish', 'darwin', has()), '/opt/homebrew/bin/fish');
  assert.equal(pty.requestedShell('pwsh.exe', 'win32', has()), 'pwsh.exe');
});

// ─── T03: the server's shells ────────────────────────────────

test('T03: Frame Server answers terminals.shells with its own shells', async () => {
  const shim = require('../src/server/electronShim');
  const handle = shim.install({ home: path.join(SANDBOX, 'server-home'), version: '0.0.0' });
  const methods = {};
  require('../src/server/terminals').setup({ shim: handle, registerMethods: (m) => Object.assign(methods, m), broadcast() {} });
  const shells = await methods['terminals.shells']();
  assert.ok(Array.isArray(shells) && shells.length > 0);
  for (const s of shells) assert.ok(fs.existsSync(s.path), `${s.path} exists on this machine`);
});

test('T03: a server workspace lists the server\'s shells; main lists this machine\'s', async () => {
  serverCalls.length = 0;
  const remote = await shellsFor('srv-ws');
  assert.deepEqual(remote.shells.map((s) => s.path), ['/bin/bash', '/bin/sh']);
  assert.deepEqual(serverCalls, ['terminals.shells']);
  serverCalls.length = 0;
  const local = await shellsFor('main');
  assert.deepEqual(local.shells, pty.getAvailableShells());
  const legacy = await shellsFor(undefined);
  assert.deepEqual(legacy.shells, pty.getAvailableShells(), 'an old renderer sending nothing still gets this machine\'s');
  assert.equal(serverCalls.length, 0);
});

test('T03: an older server or no connection gives one "Default shell" entry, never an empty list', async () => {
  fakeServer.shells = new Error('Unknown method terminals.shells');
  try {
    const old = await shellsFor('srv-ws');
    assert.deepEqual(old.shells, [{ id: 'server-default', name: 'Default shell', path: null, isDefault: true }]);
  } finally {
    fakeServer.shells = [{ id: 'bash', name: 'Bash', path: '/bin/bash', isDefault: true }];
  }
  fakeServer.connected = false;
  try {
    const off = await shellsFor('srv-ws');
    assert.equal(off.shells.length, 1);
    assert.equal(off.shells[0].path, null, 'null path: the server picks its default shell');
  } finally {
    fakeServer.connected = true;
  }
});
