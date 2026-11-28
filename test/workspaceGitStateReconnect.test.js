/**
 * Server PR state after a reconnect (#235): when a Frame Server's link comes
 * back, the desktop's workspaceGitState asks that server again (pr.refresh)
 * and pushes WORKSPACE_GIT_STATE with its GitHub access, instead of leaving
 * `serverAccess` empty until the next project switch. Two fake servers stand
 * in for serverConnection, and a fake workspaceManager lists the project's
 * server workspaces.
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('node:module');
const { EventEmitter } = require('events');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'frame-prreconnect-')));
process.env.HOME = SANDBOX;

const ACCESS = { gh: true, authed: true, repoName: 'me/app' };
function fakeLink(key, host, serverProjectPath, wsId) {
  return {
    key, host, up: true, calls: [],
    isConnected() { return this.up; },
    async call(method, params) {
      this.calls.push({ method, params });
      if (!this.up) throw new Error('Disconnected from the server.');
      if (method !== 'pr.refresh') throw new Error(`unexpected ${method}`);
      assert.equal(params.projectPath, serverProjectPath);
      return { projectPath: serverProjectPath, access: ACCESS, workspaces: { [wsId]: { dirty: 0, unpushed: 1, behind: 0, hasUpstream: true, pr: null } } };
    }
  };
}
const linkBox = fakeLink('kb', 'box', '/srv/app', 'ws-box');
const linkGpu = fakeLink('kg', 'gpu', '/home/me/app', 'ws-gpu');
const links = [linkBox, linkGpu];
const fakeServer = new EventEmitter();
Object.assign(fakeServer, {
  of: (key) => links.find((l) => l.key === key) || null,
  on(name, fn) { EventEmitter.prototype.on.call(this, name, fn); return () => this.removeListener(name, fn); }
});

const project = path.join(SANDBOX, 'app');
fs.mkdirSync(project, { recursive: true });
const ROOTS = [
  { id: 'ws-box', root: '/srv/app-ws/ws-box', host: 'box', serverKey: 'kb', projectPath: project, serverProjectPath: '/srv/app' },
  { id: 'ws-gpu', root: '/home/me/app-ws/ws-gpu', host: 'gpu', serverKey: 'kg', projectPath: project, serverProjectPath: '/home/me/app' }
];
const fakeWorkspaces = { serverRoots: () => ROOTS, serverLocation: () => null };

const MAIN = path.join(__dirname, '..', 'src', 'main');
const loadOriginal = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === 'electron') return { app: { getPath: () => SANDBOX, getVersion: () => '0.0.0', on() {} }, ipcMain: { on() {}, handle() {} }, BrowserWindow: { getAllWindows: () => [] } };
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

const gitState = require('../src/main/workspaceGitState');
const { IPC } = require('../src/shared/ipcChannels');

const sent = [];
const win = { isDestroyed: () => false, on() {}, webContents: { send: (ch, payload) => sent.push([ch, payload]) } };
gitState.init(win);
gitState.setupIPC({ handle() {}, on() {} });

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const pushes = () => sent.filter(([ch]) => ch === IPC.WORKSPACE_GIT_STATE).map(([, p]) => p);
const tick = () => new Promise((r) => setImmediate(r));
async function waitFor(pred, ms = 2000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out');
    await tick();
  }
}

beforeEach(() => {
  sent.length = 0;
  for (const l of links) { l.calls.length = 0; l.up = true; }
  gitState.setWatched(project);
});

test('a server that reconnects is asked again and its GitHub access is pushed', async () => {
  fakeServer.emit('disconnected', { state: 'reconnecting' }, 'kb');
  fakeServer.emit('connected', { state: 'connected' }, 'kb');
  await waitFor(() => pushes().length > 0);

  assert.deepEqual(linkBox.calls.map((c) => c.method), ['pr.refresh']);
  assert.equal(linkGpu.calls.length, 0, 'only the server that came back is asked');
  const last = pushes().at(-1);
  assert.equal(last.projectPath, project);
  assert.deepEqual(last.serverAccess.kb, ACCESS);
  assert.ok(last.workspaces['ws-box'], "the server's workspace rows are back");
});

test('a reconnect drops nothing from the other servers', async () => {
  fakeServer.emit('connected', { state: 'connected' }, 'kg');
  await waitFor(() => pushes().length > 0);
  fakeServer.emit('disconnected', { state: 'reconnecting' }, 'kb');
  fakeServer.emit('connected', { state: 'connected' }, 'kb');
  await waitFor(() => pushes().length > 1);

  const last = pushes().at(-1);
  assert.deepEqual(Object.keys(last.serverAccess).sort(), ['kb', 'kg']);
  assert.ok(last.workspaces['ws-gpu'] && last.workspaces['ws-box']);
});

test('nothing is asked when no project is watched', async () => {
  gitState.setWatched(null);
  fakeServer.emit('connected', { state: 'connected' }, 'kb');
  await tick(); await tick();
  assert.equal(linkBox.calls.length, 0);
  assert.equal(pushes().length, 0);
});

test('a link that drops again before answering leaves no push and no throw', async () => {
  fakeServer.emit('disconnected', { state: 'reconnecting' }, 'kb');
  linkBox.up = false;
  fakeServer.emit('connected', { state: 'connected' }, 'kb');
  await tick(); await tick();
  assert.equal(linkBox.calls.length, 0, 'an unconnected link is skipped');
  // The handler still pushes what it has; the dropped server is simply absent.
  await waitFor(() => pushes().length > 0);
  assert.equal(pushes().at(-1).serverAccess && pushes().at(-1).serverAccess.kb, undefined);
});
