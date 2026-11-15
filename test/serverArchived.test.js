/**
 * Workspaces archived on a server: listed in the desktop's Archived list with
 * their host, and restored on their own server. The real workspaceManager
 * with two stubbed server links (multi-server-connections), against a temp
 * repo with an origin remote.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Module = require('node:module');
const { EventEmitter } = require('events');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-archived-'));
process.env.HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(process.env.HOME, { recursive: true });

// Two saved servers (multi-server-connections). Server A has a clone of the
// project with workspace "sage"; server B has its own clone with a workspace
// of the same name and id-space.
const HOSTS = {
  A: { clones: [{ projectPath: '/srv/a/app', remote: 'github.com/me/app' }], workspaces: [{ id: 'wa', name: 'sage', path: '/srv/a/ws/sage', branch: 'ws/sage' }], archived: [{ id: 'xa', name: 'teal', path: '/srv/a/ws/teal', branch: 'ws/teal', archivedAt: '2026-11-15T00:00:00Z' }] },
  B: { clones: [{ projectPath: '/srv/b/app', remote: 'github.com/me/app' }], workspaces: [{ id: 'wb', name: 'sage', path: '/srv/b/ws/sage', branch: 'ws/sage' }], archived: [{ id: 'xb', name: 'jade', path: '/srv/b/ws/jade', branch: 'ws/jade', archivedAt: '2026-11-15T00:00:00Z' }] }
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
      if (method === 'workspaces.list') return { workspaces: h.workspaces, archived: h.archived };
      if (method === 'workspaces.restore') {
        const i = h.archived.findIndex((w) => w.id === params.id);
        if (i === -1) return { error: `No workspace "${params.id}".` };
        const [w] = h.archived.splice(i, 1);
        delete w.archivedAt;
        h.workspaces.push(w);
        return { error: null, workspace: w };
      }
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


test('workspaces archived on each server are in the Archived list, with their host', async () => {
  const listed = await wm.list(project);
  assert.deepEqual(listed.archived.map((w) => [w.id, w.name, w.location, w.host, w.serverKey]), [['xa', 'teal', 'server', 'A', 'ka'], ['xb', 'jade', 'server', 'B', 'kb']]);
  assert.equal(listed.workspaces.some((w) => w.id === 'xa'), false, 'not among the active ones');
  assert.deepEqual(wm.serverRoots().map((r) => r.id), ['wa', 'wb'], 'archived rows are never routed to as roots');
});

test('restoring an archived server workspace runs on its own server only, and it comes back as active', async () => {
  linkA.calls = []; linkB.calls = [];
  const res = await wm.restore(project, 'xb');
  assert.equal(res.error, null);
  assert.deepEqual(linkB.calls.map((c) => [c.method, c.params.id, c.params.projectPath]), [['workspaces.restore', 'xb', '/srv/b/app']]);
  assert.equal(linkA.calls.length, 0, 'A was not asked');
  const listed = await wm.list(project);
  assert.ok(listed.workspaces.some((w) => w.id === 'xb' && w.host === 'B'));
  assert.equal(listed.archived.some((w) => w.id === 'xb'), false);
});

test('while a server is down its archived rows stay listed, offline, and restore says it is not connected', async () => {
  await wm.list(project);
  linkA.up = false;
  try {
    const listed = await wm.list(project);
    const xa = listed.archived.find((w) => w.id === 'xa');
    assert.equal(xa.offline, true);
    assert.match(String((await wm.restore(project, 'xa')).error), /Not connected to A/);
  } finally {
    linkA.up = true;
  }
});
