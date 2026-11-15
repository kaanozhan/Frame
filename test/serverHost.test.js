/**
 * Server workspace caches are kept per server (server-hardening T2,
 * multi-server-connections): two saved servers list side by side, one going
 * down or being removed never touches the other.
 * The real workspaceManager with a stubbed registry of two server links,
 * against a temp repo with an origin remote.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Module = require('node:module');
const { EventEmitter } = require('events');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-host-'));
process.env.HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(process.env.HOME, { recursive: true });

// Two saved servers (multi-server-connections). Server A has a clone of the
// project with workspace "sage"; server B has its own clone with a workspace
// of the same name and id-space.
const HOSTS = {
  A: { clones: [{ projectPath: '/srv/a/app', remote: 'github.com/me/app' }], workspaces: [{ id: 'wa', name: 'sage', path: '/srv/a/ws/sage', branch: 'ws/sage' }] },
  B: { clones: [{ projectPath: '/srv/b/app', remote: 'github.com/me/app' }], workspaces: [{ id: 'wb', name: 'sage', path: '/srv/b/ws/sage', branch: 'ws/sage' }] }
};
function fakeLink(key, host) {
  return {
    key, host, up: true, calls: [],
    isConnected() { return this.up; },
    getStatus() { return { state: this.up ? 'connected' : 'reconnecting', host }; },
    async call(method, params) {
      this.calls.push({ method, params });
      if (!this.up) throw new Error(`Not connected to ${host}.`);
      const h = HOSTS[host];
      if (method === 'projects.list') return h.clones;
      if (method === 'workspaces.list') return { workspaces: h.workspaces };
      if (method === 'workspaces.status') return { dirty: false, count: 0, host };
      throw new Error(`unexpected ${method}`);
    }
  };
}
const linkA = fakeLink('ka', 'A');
const linkB = fakeLink('kb', 'B');
let saved = [linkA, linkB];
const fakeServer = new EventEmitter();
Object.assign(fakeServer, {
  all: () => saved,
  of: (key) => saved.find((l) => l.key === key) || null,
  on(name, fn) { EventEmitter.prototype.on.call(this, name, fn); return () => this.removeListener(name, fn); }
});

const MAIN = path.join(__dirname, '..', 'src', 'main');
const loadOriginal = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === 'electron') return { app: { getPath: () => SANDBOX, getVersion: () => '0.0.0', on() {} }, ipcMain: { on() {}, handle() {}, removeHandler() {} }, BrowserWindow: { getAllWindows: () => [] } };
  if (request === '@aptabase/electron/main') return { initialize() {}, trackEvent() {} };
  if (request === 'posthog-node') return { PostHog: class { capture() {} shutdown() { return Promise.resolve(); } } };
  if (request.startsWith('.') && parent && parent.filename) {
    let resolved = null;
    try { resolved = Module._resolveFilename(request, parent); } catch (_) { resolved = null; }
    if (resolved === path.join(MAIN, 'serverConnection.js')) return fakeServer;
  }
  return loadOriginal.call(this, request, parent, ...rest);
};

const projectRegistry = require('../src/main/projectRegistry');
projectRegistry.init({}, null);
const wm = require('../src/main/workspaceManager');
wm.init(null);

const project = path.join(SANDBOX, 'app');
execFileSync('git', ['init', '-q', '-b', 'main', project]);
execFileSync('git', ['-C', project, 'remote', 'add', 'origin', 'git@github.com:me/app.git']);
execFileSync('git', ['-C', project, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
projectRegistry.addProject(project, 'app', false);

test('both servers are listed side by side, each row naming its own server', async () => {
  const listed = await wm.list(project);
  const remote = listed.workspaces.filter((w) => w.location === 'server');
  assert.deepEqual(remote.map((w) => [w.id, w.name, w.host, w.serverKey]), [['wa', 'sage', 'A', 'ka'], ['wb', 'sage', 'B', 'kb']], 'same name, two servers');
  assert.equal(wm.serverLocation('wa').serverKey, 'ka');
  assert.equal(wm.serverLocation('wb').serverKey, 'kb');
  assert.equal(wm.serverLocation('wb').path, '/srv/b/ws/sage');
  assert.deepEqual(wm.serverRoots().map((r) => [r.id, r.serverKey]), [['wa', 'ka'], ['wb', 'kb']]);
});

test('a call for a workspace goes to its own server only', async () => {
  linkA.calls = []; linkB.calls = [];
  const res = await wm.status(project, 'wb');
  assert.equal(res.host, 'B');
  assert.equal(linkA.calls.length, 0, 'A was not asked');
});

test('one server down: its rows go offline and refuse; the other keeps routing', async () => {
  linkA.up = false;
  try {
    const listed = await wm.list(project);
    const byId = Object.fromEntries(listed.workspaces.filter((w) => w.location === 'server').map((w) => [w.id, w]));
    assert.equal(byId.wa.offline, true, "A's row stays listed, offline");
    assert.equal(byId.wb.offline, undefined, "B's row is live");
    const refused = await wm.status(project, 'wa');
    assert.match(String(refused.error), /Not connected to A/);
    assert.equal((await wm.status(project, 'wb')).host, 'B');
  } finally {
    linkA.up = true;
  }
});

test('a removed server stops listing and routing; nothing else changes', async () => {
  await wm.list(project);
  saved = [linkA];
  fakeServer.emit('removed', { key: 'kb' }, 'kb');
  assert.equal(wm.serverLocation('wb'), null, "B's workspace no longer routes");
  assert.deepEqual(wm.serverRoots().map((r) => r.id), ['wa']);
  const listed = await wm.list(project);
  assert.deepEqual(listed.workspaces.filter((w) => w.location === 'server').map((w) => w.id), ['wa']);
  saved = [linkA, linkB];
});
