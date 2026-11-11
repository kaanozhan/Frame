/**
 * Server workspace caches follow the connected host (server-hardening T2).
 * The real workspaceManager with a stubbed server connection whose host
 * can change, against a temp repo with an origin remote.
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

// Host A has a clone of the project with one workspace; host B has nothing.
const HOSTS = {
  A: { clones: [{ projectPath: '/srv/a/app', remote: 'github.com/me/app' }], workspaces: [{ id: 'wa', name: 'sage', path: '/srv/a/ws/sage', branch: 'ws/sage' }] },
  B: { clones: [], workspaces: [] }
};
const fakeServer = new EventEmitter();
Object.assign(fakeServer, {
  host: 'A',
  isConnected: () => true,
  getStatus() { return { state: 'connected', host: this.host }; },
  on(name, fn) { EventEmitter.prototype.on.call(this, name, fn); return () => this.removeListener(name, fn); },
  async call(method) {
    const h = HOSTS[this.host];
    if (method === 'projects.list') return h.clones;
    if (method === 'workspaces.list') return { workspaces: h.workspaces };
    throw new Error(`unexpected ${method}`);
  }
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

test('T2: switching host drops the old host\'s workspaces from the list and from routing', async () => {
  const onA = await wm.list(project);
  assert.ok(onA.workspaces.some((w) => w.id === 'wa' && w.location === 'server'), 'listed on host A');
  assert.ok(wm.serverLocation('wa'), 'routable on host A');

  fakeServer.host = 'B';
  fakeServer.emit('connected', fakeServer.getStatus());
  assert.equal(wm.serverLocation('wa'), null, 'host A\'s workspace no longer routes');
  assert.deepEqual(wm.serverRoots(), [], 'no roots of another host');

  const onB = await wm.list(project);
  assert.equal(onB.workspaces.filter((w) => w.location === 'server').length, 0, 'not listed on host B');
});
