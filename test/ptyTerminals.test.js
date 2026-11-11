/**
 * ptyManager terminal create/destroy over IPC (server-hardening T06, T07).
 *
 * node-pty, the server connection and the workspace routing are stubbed;
 * the real TERMINAL_CREATE handler runs against a fake ipcMain.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Module = require('node:module');
const { EventEmitter } = require('events');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-pty-'));
process.env.HOME = SANDBOX;

let ptySeq = 1000;
const fakePty = {
  spawn() {
    const e = new EventEmitter();
    return {
      pid: ++ptySeq,
      onData: (fn) => e.on('data', fn),
      onExit: (fn) => e.on('exit', fn),
      write() {}, resize() {}, kill() { e.emit('exit', { exitCode: 0 }); }
    };
  }
};

// The connected server: terminals.create answers after a delay.
const serverCalls = [];
const fakeServer = new EventEmitter();
Object.assign(fakeServer, {
  connected: true,
  isConnected() { return this.connected; },
  getStatus() { return { state: this.connected ? 'connected' : 'reconnecting', host: 'box' }; },
  on(name, fn) { EventEmitter.prototype.on.call(this, name, fn); return () => this.removeListener(name, fn); },
  async call(method, params) {
    serverCalls.push({ method, params });
    if (method === 'terminals.create') {
      await new Promise((r) => setTimeout(r, 50));
      return { terminalId: `srv-${serverCalls.length}` };
    }
    return null;
  },
  send(method, params) { serverCalls.push({ method, params, sent: true }); }
});
const fakeWorkspaces = {
  serverLocation: (id) => (id === 'remote-ws' ? { serverProjectPath: '/srv/p', path: '/srv/ws', host: 'box' } : null),
  serverRoots: () => []
};

const MAIN = path.join(__dirname, '..', 'src', 'main');
const loadOriginal = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === 'node-pty') return fakePty;
  if (request === 'electron') return { app: { getPath: () => SANDBOX, getVersion: () => '0.0.0', on() {} }, ipcMain: { on() {}, handle() {}, removeHandler() {} }, BrowserWindow: { getAllWindows: () => [] } };
  if (request === '@aptabase/electron/main') return { initialize() {}, trackEvent() {} };
  if (request === 'posthog-node') return { PostHog: class { capture() {} shutdown() { return Promise.resolve(); } } };
  if (request.startsWith('.') && parent && parent.filename) {
    let resolved = null;
    try { resolved = Module._resolveFilename(request, parent); } catch (_) { resolved = null; }
    if (resolved === path.join(MAIN, 'serverConnection.js')) return fakeServer;
    if (resolved === path.join(MAIN, 'workspaceManager.js')) return fakeWorkspaces;
  }
  return loadOriginal.call(this, request, parent, ...rest);
};

const { IPC } = require('../src/shared/ipcChannels');
const pty = require('../src/main/ptyManager');

const handlers = {};
const fakeIpcMain = {
  on: (ch, fn) => { handlers[ch] = fn; },
  handle: (ch, fn) => { handlers[ch] = fn; },
  removeHandler() {}
};
pty.init({ isDestroyed: () => false, webContents: { send() {}, isDestroyed: () => false } });
pty.setupIPC(fakeIpcMain);

/** Send TERMINAL_CREATE like the renderer; resolve every reply it gets. */
function create(data) {
  return new Promise((resolve) => {
    handlers[IPC.TERMINAL_CREATE]({ reply: (ch, payload) => resolve({ ch, payload }) }, data);
  });
}

test('T1: every TERMINAL_CREATED reply echoes the request id, local and server', async () => {
  const [server, local] = await Promise.all([
    create({ requestId: 'r-server', workspaceId: 'remote-ws', projectPath: '/p', cwd: '/srv/ws' }),
    create({ requestId: 'r-local', workspaceId: 'main', projectPath: '/p', cwd: SANDBOX })
  ]);
  assert.equal(local.payload.requestId, 'r-local');
  assert.equal(server.payload.requestId, 'r-server');
  assert.notEqual(local.payload.terminalId, server.payload.terminalId);
  assert.match(server.payload.terminalId, /^srv-/);
});

test('T1: a failed create echoes the request id too', async () => {
  const saved = fakeServer.call;
  fakeServer.call = async () => { throw new Error('offline'); };
  try {
    const r = await create({ requestId: 'r-fail', workspaceId: 'remote-ws', projectPath: '/p' });
    assert.equal(r.payload.success, false);
    assert.equal(r.payload.requestId, 'r-fail');
  } finally {
    fakeServer.call = saved;
  }
});
