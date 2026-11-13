/**
 * The desktop sends a project to Frame Server as a git bundle
 * (server-onboarding T02). Real workspaceManager and git against temp repos;
 * the server connection and the SSH upload are stubbed.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Module = require('node:module');
const { EventEmitter } = require('events');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-send-'));
process.env.HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(process.env.HOME, { recursive: true });
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();

const SERVER_TMP = path.join(SANDBOX, 'server-tmp');
fs.mkdirSync(SERVER_TMP);
const server = new EventEmitter();
Object.assign(server, {
  clones: [],
  calls: [],
  receive: null, // override per test
  isConnected: () => true,
  getStatus: () => ({ state: 'connected', host: 'box' }),
  on(name, fn) { EventEmitter.prototype.on.call(this, name, fn); return () => this.removeListener(name, fn); },
  async call(method, params) {
    this.calls.push({ method, params });
    if (method === 'projects.list') return this.clones;
    if (method === 'projects.receive') return this.receive(params);
    if (method === 'workspaces.create') return { workspace: { id: 'w1', name: 'sage', branch: 'ws/sage', path: '/srv/ws/sage' }, fetch: { skipped: true } };
    if (method === 'workspaces.list') return { workspaces: [] };
    throw new Error(`Unknown method ${method}`);
  }
});
const uploads = [];
const installerStub = {
  async upload(host, localFile, remotePath) {
    const dest = path.join(SERVER_TMP, path.basename(remotePath));
    fs.copyFileSync(localFile, dest);
    uploads.push({ host, remotePath, dest });
  }
};

const MAIN = path.join(__dirname, '..', 'src', 'main');
const loadOriginal = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === 'electron') return { app: { getPath: () => SANDBOX, getVersion: () => '0.0.0', on() {} }, ipcMain: { on() {}, handle() {}, removeHandler() {} }, BrowserWindow: { getAllWindows: () => [] } };
  if (request === '@aptabase/electron/main') return { initialize() {}, trackEvent() {} };
  if (request === 'posthog-node') return { PostHog: class { capture() {} shutdown() { return Promise.resolve(); } } };
  if (request.startsWith('.') && parent && parent.filename) {
    let resolved = null;
    try { resolved = Module._resolveFilename(request, parent); } catch (_) { resolved = null; }
    if (resolved === path.join(MAIN, 'serverConnection.js')) return server;
    if (resolved === path.join(MAIN, 'serverInstaller.js')) return installerStub;
  }
  return loadOriginal.call(this, request, parent, ...rest);
};

const projectRegistry = require('../src/main/projectRegistry');
projectRegistry.init({}, null);
const wm = require('../src/main/workspaceManager');
wm.init(null);

let seq = 0;
function project({ remote = null } = {}) {
  const dir = path.join(SANDBOX, `app-${++seq}`);
  git(['init', '-q', '-b', 'main', dir]);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(['add', '.'], dir); git(['commit', '-qm', 'first'], dir);
  git(['branch', 'feat/x'], dir);
  if (remote) git(['remote', 'add', 'origin', remote], dir);
  projectRegistry.addProject(dir, path.basename(dir), false);
  return { dir, root: git(['rev-list', '--max-parents=0', 'HEAD'], dir) };
}
function reset() { server.calls = []; uploads.length = 0; server.clones = []; }

test('a project the server does not have is sent as a bundle with its remote and root', async () => {
  reset();
  const { dir, root } = project({ remote: 'git@github.com:me/private-app.git' });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'changed\n');     // uncommitted
  fs.writeFileSync(path.join(dir, 'new.txt'), 'untracked\n'); // untracked
  let received = null;
  server.receive = (p) => { received = p; return { projectPath: '/srv/projects/private-app', cloned: true }; };
  const res = await wm.create(dir, { from: 'new', base: 'main', location: 'server' });
  assert.equal(res.error, null, res.error);
  assert.equal(uploads.length, 1, 'one upload');
  assert.match(uploads[0].remotePath, /^\.frame-server\/tmp\/receive-[A-Za-z0-9._-]+\.bundle$/);
  const heads = git(['bundle', 'list-heads', uploads[0].dest], SANDBOX);
  assert.match(heads, /refs\/heads\/feat\/x/);
  assert.match(heads, /HEAD/);
  assert.deepEqual({ ...received, bundlePath: path.basename(received.bundlePath) }, { bundlePath: path.basename(uploads[0].remotePath), originUrl: 'git@github.com:me/private-app.git', root, name: path.basename(dir) });
  assert.deepEqual(res.sent, { uncommitted: 2 }, 'what stayed on this Mac is counted');
});

test('a project already on the server is not sent again', async () => {
  reset();
  const { dir } = project({ remote: 'https://github.com/me/known' });
  server.clones = [{ projectPath: '/srv/projects/known', remote: 'github.com/me/known', root: null }];
  server.receive = () => { throw new Error('should not be called'); };
  const res = await wm.create(dir, { from: 'new', base: 'main', location: 'server' });
  assert.equal(res.error, null, res.error);
  assert.equal(uploads.length, 0);
  assert.equal(res.sent, undefined);
});

test('a project with no remote is sent and later found by its root commit', async () => {
  reset();
  const { dir, root } = project();
  server.receive = (p) => { assert.equal(p.originUrl, null); assert.equal(p.root, root); return { projectPath: '/srv/projects/notes', cloned: true }; };
  const res = await wm.create(dir, { from: 'new', base: 'main', location: 'server' });
  assert.equal(res.error, null, res.error);
  assert.equal(uploads.length, 1);
  // The listing now finds it by root.
  server.clones = [{ projectPath: '/srv/projects/notes', remote: null, root }];
  server.calls = [];
  await wm.list(dir);
  assert.ok(server.calls.some((c) => c.method === 'workspaces.list' && c.params.projectPath === '/srv/projects/notes'), 'listed through its root-matched clone');
});

test('an older Frame Server is asked to update', async () => {
  reset();
  const { dir } = project({ remote: 'https://github.com/me/old' });
  server.receive = () => { throw new Error('Unknown method projects.receive'); };
  const res = await wm.create(dir, { from: 'new', base: 'main', location: 'server' });
  assert.match(String(res.error), /Update Frame Server/);
});
