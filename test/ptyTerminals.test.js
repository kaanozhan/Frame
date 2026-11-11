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

// ─── T3 / T4: adopt prunes, offline closes are kept ──────────

fakeWorkspaces.list = async () => ({ workspaces: [{ id: 'remote-ws', location: 'server' }] });
function adopt() { return handlers[IPC.TERMINAL_ADOPT]({}, { projectPath: '/p' }); }
function liveList(ids) {
  const saved = fakeServer.call;
  fakeServer.call = async (method, params) => {
    serverCalls.push({ method, params });
    if (method === 'terminals.list') return ids.map((terminalId) => ({ terminalId, workspaceId: 'remote-ws' }));
    if (method === 'terminals.attach') return { screen: '', cols: 80, rows: 24 };
    return saved.call(fakeServer, method, params);
  };
  return () => { fakeServer.call = saved; };
}

test('T4: closing a server terminal while offline is sent on reconnect and not adopted back', async () => {
  fakeServer.connected = false;
  handlers[IPC.TERMINAL_DESTROY]({}, 'srv-boot1-7');
  assert.equal(serverCalls.filter((c) => c.method === 'terminals.destroy').length, 0, 'nothing sent while offline');
  fakeServer.connected = true;
  fakeServer.emit('connected', {});
  const sent = serverCalls.filter((c) => c.method === 'terminals.destroy' && c.params.terminalId === 'srv-boot1-7');
  assert.equal(sent.length, 1, 'the close is sent on reconnect');
  const restore = liveList(['srv-boot1-7', 'srv-boot1-8']);
  try {
    const adopted = await adopt();
    assert.deepEqual(adopted.map((t) => t.terminalId), ['srv-boot1-8'], 'the closed terminal is not adopted back');
  } finally { restore(); }
});

test('T3: adopt forgets server terminals that no longer exist', async () => {
  pty.noteServerTerminal('srv-oldboot-1', { projectPath: '/p', workspaceId: 'remote-ws' });
  const restore = liveList(['srv-newboot-1']);
  try {
    await adopt();
  } finally { restore(); }
  assert.equal(pty.serverTerminalInfo('srv-oldboot-1'), null, 'the dead id is forgotten');
  assert.deepEqual(pty.serverTerminalInfo('srv-newboot-1'), { projectPath: '/p', workspaceId: 'remote-ws' });
});

test('T3: adopt says "cannot tell" (null) while offline, so lanes are kept', async () => {
  fakeServer.connected = false;
  try {
    assert.equal(await adopt(), null);
  } finally { fakeServer.connected = true; }
});

test('T2: connecting to another host forgets the previous host\'s server terminals', () => {
  fakeServer.emit('connected', { host: 'box' });
  pty.noteServerTerminal('srv-x-9', { projectPath: '/p', workspaceId: 'remote-ws' });
  fakeServer.emit('connected', { host: 'box' });
  assert.ok(pty.serverTerminalInfo('srv-x-9'), 'same host: kept');
  fakeServer.emit('connected', { host: 'other-box' });
  assert.equal(pty.serverTerminalInfo('srv-x-9'), null, 'another host: forgotten');
});

// ─── server-onboarding T05: home terminals ───────────────────

test('a server-home create opens a home terminal on the server for this project and view', async () => {
  fakeServer.connected = true;
  const before = serverCalls.length;
  const r = await create({ requestId: 'r-home', location: 'server-home', projectPath: '/p', workspaceId: 'local-ws' });
  assert.equal(r.payload.success, true, r.payload.error);
  assert.equal(r.payload.requestId, 'r-home');
  const call = serverCalls.slice(before).find((c) => c.method === 'terminals.create');
  assert.equal(call.params.home, true);
  assert.equal(call.params.homeFor, '/p');
  assert.equal(call.params.homeWorkspace, 'local-ws');
  assert.deepEqual(pty.serverTerminalInfo(r.payload.terminalId), { projectPath: '/p', workspaceId: 'local-ws', home: true });
});

test('a server-home create while not connected says to connect, and nothing is created locally', async () => {
  fakeServer.connected = false;
  try {
    const r = await create({ requestId: 'r-off', location: 'server-home', projectPath: '/p', workspaceId: 'main' });
    assert.equal(r.payload.success, false);
    assert.match(r.payload.error, /Connect to a server/);
    assert.equal(r.payload.requestId, 'r-off');
  } finally { fakeServer.connected = true; }
});

test('adopt brings back this project\'s home terminals in the view they were opened in, beside workspace terminals', async () => {
  const saved = fakeServer.call;
  fakeServer.call = async (method, params) => {
    serverCalls.push({ method, params });
    if (method === 'terminals.list') {
      return [
        { terminalId: 'srv-b-1', workspaceId: 'remote-ws', home: false, homeFor: null },
        { terminalId: 'srv-b-5', workspaceId: null, home: true, homeFor: '/p', homeWorkspace: 'local-ws' },
        { terminalId: 'srv-b-6', workspaceId: null, home: true, homeFor: '/other', homeWorkspace: 'main' }
      ];
    }
    if (method === 'terminals.attach') return { screen: '', cols: 80, rows: 24 };
    return saved.call(fakeServer, method, params);
  };
  try {
    const adopted = await adopt();
    const ids = adopted.map((t) => t.terminalId).sort();
    assert.deepEqual(ids, ['srv-b-1', 'srv-b-5'], 'another project\'s home terminal is not taken');
    const home = adopted.find((t) => t.terminalId === 'srv-b-5');
    assert.equal(home.workspaceId, 'local-ws');
    assert.equal(home.home, true);
  } finally { fakeServer.call = saved; }
});
