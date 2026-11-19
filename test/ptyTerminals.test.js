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

// The connected server "box" (key kbox): terminals.create answers after a delay.
const serverCalls = [];
const fakeServer = {
  key: 'kbox',
  host: 'box',
  connected: true,
  isConnected() { return this.connected; },
  getStatus() { return { state: this.connected ? 'connected' : 'reconnecting', host: 'box' }; },
  async call(method, params) {
    serverCalls.push({ method, params });
    if (method === 'terminals.create') {
      await new Promise((r) => setTimeout(r, 50));
      return { terminalId: `srv-${serverCalls.length}` };
    }
    return null;
  },
  send(method, params) { serverCalls.push({ method, params, sent: true }); }
};
// A second server "gpu" (key kgpu), multi-server-connections.
const gpuCalls = [];
const gpu = {
  key: 'kgpu',
  host: 'gpu',
  connected: true,
  isConnected() { return this.connected; },
  getStatus() { return { state: 'connected', host: 'gpu' }; },
  async call(method, params) {
    gpuCalls.push({ method, params });
    if (method === 'terminals.create') return { terminalId: 'srv-g1-1' };
    if (method === 'terminals.list') return [];
    return null;
  },
  send(method, params) { gpuCalls.push({ method, params, sent: true }); }
};
// The registry: events carry the key of the server they came from.
const registry = new EventEmitter();
Object.assign(registry, {
  saved: [fakeServer, gpu],
  all() { return this.saved; },
  of(key) { return this.saved.find((l) => l.key === key) || null; },
  on(name, fn) { EventEmitter.prototype.on.call(this, name, fn); return () => this.removeListener(name, fn); }
});
const fakeWorkspaces = {
  serverLocation: (id) => (id === 'remote-ws' ? { serverProjectPath: '/srv/p', path: '/srv/ws', host: 'box', serverKey: 'kbox' }
    : id === 'gpu-ws' ? { serverProjectPath: '/gpu/p', path: '/gpu/ws', host: 'gpu', serverKey: 'kgpu' } : null),
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
    if (resolved === path.join(MAIN, 'serverConnection.js')) return registry;
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
const toWindow = [];
pty.init({ isDestroyed: () => false, webContents: { send: (ch, p) => toWindow.push([ch, p]), isDestroyed: () => false } });
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
  assert.match(server.payload.terminalId, /^srv-kbox\./, 'the desktop id names its server');
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

fakeWorkspaces.list = async () => ({ workspaces: [{ id: 'remote-ws', location: 'server', serverKey: 'kbox' }] });
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
  handlers[IPC.TERMINAL_DESTROY]({}, 'srv-kbox.boot1-7');
  assert.equal(serverCalls.filter((c) => c.method === 'terminals.destroy').length, 0, 'nothing sent while offline');
  fakeServer.connected = true;
  registry.emit('connected', {}, 'kgpu');
  assert.equal(serverCalls.filter((c) => c.method === 'terminals.destroy').length, 0, "another server's reconnect sends nothing to box");
  registry.emit('connected', {}, 'kbox');
  const sent = serverCalls.filter((c) => c.method === 'terminals.destroy' && c.params.terminalId === 'srv-boot1-7');
  assert.equal(sent.length, 1, 'the close is sent on reconnect, with the server\'s own id');
  const restore = liveList(['srv-boot1-7', 'srv-boot1-8']);
  try {
    const adopted = await adopt();
    assert.deepEqual(adopted.map((t) => t.terminalId), ['srv-kbox.boot1-8'], 'the closed terminal is not adopted back');
  } finally { restore(); }
});

test('T3: adopt forgets server terminals that no longer exist', async () => {
  pty.noteServerTerminal('srv-kbox.oldboot-1', { projectPath: '/p', workspaceId: 'remote-ws' });
  const restore = liveList(['srv-newboot-1']);
  try {
    await adopt();
  } finally { restore(); }
  assert.equal(pty.serverTerminalInfo('srv-kbox.oldboot-1'), null, 'the dead id is forgotten');
  assert.deepEqual(pty.serverTerminalInfo('srv-kbox.newboot-1'), { projectPath: '/p', workspaceId: 'remote-ws', serverKey: 'kbox' });
});

test('T3: adopt says "cannot tell" (null) while offline, so lanes are kept', async () => {
  fakeServer.connected = false;
  try {
    assert.equal(await adopt(), null);
  } finally { fakeServer.connected = true; }
});

test('input, resize and output go to and come from the terminal\'s own server (multi-server-connections)', async () => {
  const onGpu = await create({ requestId: 'r-gpu', workspaceId: 'gpu-ws', projectPath: '/p' });
  assert.equal(onGpu.payload.terminalId, 'srv-kgpu.g1-1');
  serverCalls.length = 0; gpuCalls.length = 0;
  handlers[IPC.TERMINAL_INPUT_ID]({}, { terminalId: 'srv-kgpu.g1-1', data: 'ls\n' });
  handlers[IPC.TERMINAL_RESIZE_ID]({}, { terminalId: 'srv-kgpu.g1-1', cols: 100, rows: 30 });
  assert.deepEqual(gpuCalls.map((c) => [c.method, c.params.terminalId]), [['terminals.input', 'srv-g1-1'], ['terminals.resize', 'srv-g1-1']]);
  assert.equal(serverCalls.length, 0, 'box gets nothing');
  // The same server-side id from two servers stays two terminals.
  toWindow.length = 0;
  registry.emit('terminal.output', { terminalId: 'srv-g1-1', data: 'from gpu' }, 'kgpu');
  registry.emit('terminal.output', { terminalId: 'srv-g1-1', data: 'from box' }, 'kbox');
  const out = toWindow.filter(([ch]) => ch === IPC.TERMINAL_OUTPUT_ID).map(([, p]) => [p.terminalId, p.data]);
  assert.deepEqual(out, [['srv-kgpu.g1-1', 'from gpu'], ['srv-kbox.g1-1', 'from box']]);
});

test('a removed server\'s terminals leave this window', () => {
  pty.noteServerTerminal('srv-kgpu.g1-2', { projectPath: '/p', workspaceId: 'gpu-ws' });
  toWindow.length = 0;
  registry.emit('removed', { key: 'kgpu' }, 'kgpu');
  assert.equal(pty.serverTerminalInfo('srv-kgpu.g1-2'), null);
  assert.ok(toWindow.some(([ch, p]) => ch === IPC.TERMINAL_DESTROYED && p.terminalId === 'srv-kgpu.g1-2'));
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
  assert.deepEqual(pty.serverTerminalInfo(r.payload.terminalId), { projectPath: '/p', workspaceId: 'local-ws', serverKey: 'kbox', home: true });
});

test('a server-home create while not connected says to connect, and nothing is created locally', async () => {
  fakeServer.connected = false;
  gpu.connected = false;
  try {
    const r = await create({ requestId: 'r-off', location: 'server-home', projectPath: '/p', workspaceId: 'main' });
    assert.equal(r.payload.success, false);
    assert.match(r.payload.error, /Connect to a server/);
    assert.equal(r.payload.requestId, 'r-off');
  } finally { fakeServer.connected = true; gpu.connected = true; }
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
    assert.deepEqual(ids, ['srv-kbox.b-1', 'srv-kbox.b-5'], 'another project\'s home terminal is not taken');
    const home = adopted.find((t) => t.terminalId === 'srv-kbox.b-5');
    assert.equal(home.workspaceId, 'local-ws');
    assert.equal(home.home, true);
  } finally { fakeServer.call = saved; }
});

// ─── Why a terminal was closed travels with the close (W3) ────

test('W3: a server terminal close carries the reason to the server', () => {
  fakeServer.connected = true;
  const before = serverCalls.length;
  handlers[IPC.TERMINAL_DESTROY]({}, 'srv-kbox.boot1-21', 'closed with its pane × in Terminals');
  const sent = serverCalls.slice(before).filter((c) => c.method === 'terminals.destroy');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].params, { terminalId: 'srv-boot1-21', reason: 'closed with its pane × in Terminals' });
});

test('W3: a close without a reason is labelled, and an older renderer call still closes', () => {
  fakeServer.connected = true;
  const before = serverCalls.length;
  handlers[IPC.TERMINAL_DESTROY]({}, 'srv-kbox.boot1-22');
  const sent = serverCalls.slice(before).filter((c) => c.method === 'terminals.destroy');
  assert.equal(sent.length, 1, 'the close is still sent');
  assert.equal(sent[0].params.reason, 'unlabelled close');
});

test('W3: a close made while offline keeps its reason for the reconnect', () => {
  fakeServer.connected = false;
  handlers[IPC.TERMINAL_DESTROY]({}, 'srv-kbox.boot1-23', '"Kill & restart here" chosen when starting an agent');
  fakeServer.connected = true;
  const before = serverCalls.length;
  registry.emit('connected', {}, 'kbox');
  const sent = serverCalls.slice(before).filter((c) => c.method === 'terminals.destroy' && c.params.terminalId === 'srv-boot1-23');
  assert.equal(sent.length, 1);
  assert.match(sent[0].params.reason, /^"Kill & restart here" chosen when starting an agent — sent on reconnect/);
});
