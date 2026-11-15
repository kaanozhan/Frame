/**
 * The desktop half of "Send files to server" (server-copy-files T05).
 *
 * The real sendFiles module runs against a temp git project; the server
 * connection, the SSH upload and the workspace lookup are stubbed. Also
 * pinned here: createOnServer passes this desktop's copyFiles patterns with
 * workspaces.create (T04's desktop half).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('node:module');
const { execFileSync } = require('child_process');
const { EventEmitter } = require('events');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'frame-sendfiles-desk-')));
process.env.HOME = SANDBOX;
process.env.GIT_CONFIG_NOSYSTEM = '1';
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();

const calls = [];
const uploads = [];
const fakeServer = new EventEmitter();
Object.assign(fakeServer, {
  connected: true,
  answers: {},
  isConnected() { return this.connected; },
  getStatus() { return { state: this.connected ? 'connected' : 'reconnecting', host: 'box' }; },
  on(name, fn) { EventEmitter.prototype.on.call(this, name, fn); return () => this.removeListener(name, fn); },
  async call(method, params) {
    calls.push({ method, params });
    const a = this.answers[method];
    if (a instanceof Error) throw a;
    if (typeof a === 'function') return a(params);
    if (method === 'files.receive') return { written: ['x'], overwritten: [], skipped: [], toMainCopy: [] };
    return a === undefined ? null : a;
  }
});
const fakeInstaller = { async upload(host, local, remote) { uploads.push({ host, remote, bytes: fs.readFileSync(local) }); } };
const fakeWorkspaces = {
  serverLocation: (id) => (id === 'srv' ? { serverProjectPath: '/srv/projects/app', path: '/srv/ws/app/teal', host: 'box', name: 'teal' } : null)
};

const MAIN = path.join(__dirname, '..', 'src', 'main');
const STUBS = {
  '@aptabase/electron/main': { initialize() {}, trackEvent() {} },
  'posthog-node': { PostHog: class { capture() {} captureException() {} identify() {} shutdown() { return Promise.resolve(); } } },
  electron: { app: { getPath: () => SANDBOX, getVersion: () => '0.0.0', on() {} }, ipcMain: { handle() {}, on() {} }, BrowserWindow: { getAllWindows: () => [] }, dialog: {} }
};
const loadOriginal = Module._load;
Module._load = function (request, parent, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('.') && parent && parent.filename) {
    let resolved = null;
    try { resolved = Module._resolveFilename(request, parent); } catch (_) { resolved = null; }
    if (resolved === path.join(MAIN, 'serverConnection.js')) return fakeServer;
    if (resolved === path.join(MAIN, 'serverInstaller.js')) return fakeInstaller;
    // Only sendFiles gets the stubbed lookup; the createOnServer test uses the real module.
    if (resolved === path.join(MAIN, 'workspaceManager.js') && parent.filename === path.join(MAIN, 'sendFiles.js')) return fakeWorkspaces;
  }
  return loadOriginal.call(this, request, parent, ...rest);
};

const sendFiles = require('../src/main/sendFiles');
const { readEntries } = require('../src/shared/fileArchive');
const frameProject = require('../src/main/frameProject');

const write = (file, body = 'x\n', mode) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); if (mode) fs.chmodSync(file, mode); };

/** A Frame project with tracked a.txt; ignored .env, certs/, node_modules/ and .frame/bin; untracked src/new.js. */
function project() {
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'proj-'));
  git(['init', '-q', '-b', 'main', dir]);
  write(path.join(dir, '.gitignore'), '.env*\ncerts/\nnode_modules/\n.frame/bin/\n');
  write(path.join(dir, 'a.txt'), 'tracked\n');
  write(path.join(dir, '.frame', 'config.json'), JSON.stringify({ version: '1.0', name: 'app' }));
  git(['add', '.'], dir); git(['commit', '-qm', 'first'], dir);
  write(path.join(dir, '.env'), 'SECRET=1\n', 0o600);
  write(path.join(dir, 'certs', 'dev.pem'), 'PEM\n');
  write(path.join(dir, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1;\n');
  write(path.join(dir, '.frame', 'bin', 'spec-hint.js'), '// frame tooling\n');
  write(path.join(dir, 'src', 'new.js'), 'new\n');
  return dir;
}

test('T05: the list is what git leaves out, minus .frame; heavy folders are sized, not compared', async () => {
  const dir = project();
  calls.length = 0;
  fakeServer.answers['files.compare'] = { '.env': 'same' };
  const r = await sendFiles.list({ projectPath: dir, workspaceId: 'srv' });
  assert.equal(r.error, undefined, r.error);
  assert.deepEqual([...r.ignored].sort(), ['.env', 'certs/', 'node_modules/']);
  assert.deepEqual(r.untracked, ['src/new.js']);
  assert.equal(r.sizes.node_modules.size, 'module.exports = 1;\n'.length);
  assert.deepEqual(r.server, { '.env': 'same' });
  assert.deepEqual(r.copyFiles, ['.env*']);
  const compared = calls.find((c) => c.method === 'files.compare').params;
  assert.deepEqual({ projectPath: compared.projectPath, root: compared.root }, { projectPath: '/srv/projects/app', root: '/srv/ws/app/teal' });
  assert.deepEqual(compared.entries.map((e) => e.path).sort(), ['.env', 'certs', 'src/new.js'], 'node_modules is never compared');
  assert.match(compared.entries.find((e) => e.path === '.env').sha256, /^[0-9a-f]{64}$/);
});

test('T05: sending packs exactly the ticked files with their modes, and Remember saves the patterns', async () => {
  const dir = project();
  calls.length = 0; uploads.length = 0;
  const r = await sendFiles.send({ projectPath: dir, workspaceId: 'srv', paths: ['.env', 'certs', 'src/new.js'], remember: true });
  assert.equal(r.error, undefined, r.error);
  assert.equal(uploads.length, 1);
  assert.match(uploads[0].remote, /^\.frame-server\/tmp\/files-[0-9a-f]{12}\.fpk$/);
  const entries = readEntries(uploads[0].bytes);
  assert.deepEqual(entries.map((e) => [e.path, e.mode & 0o777]), [['.env', 0o600], ['certs/dev.pem', 0o644], ['src/new.js', 0o644]]);
  const receive = calls.find((c) => c.method === 'files.receive').params;
  assert.equal(receive.archive, uploads[0].remote.split('/').pop());
  assert.deepEqual(receive.untracked, ['src/new.js'], 'untracked files are named so the server keeps them out of the main copy');
  assert.equal(r.remembered[0], '.env*', 'the existing pattern stays first');
  assert.deepEqual([...r.remembered].sort(), ['.env*', '/.env', 'certs/**'], 'untracked src/new.js is not remembered');
  assert.deepEqual(frameProject.getWorkspaceSettings(dir).copyFiles, r.remembered);
});

test('T05: a path git does not leave out is refused before anything is uploaded', async () => {
  const dir = project();
  for (const bad of ['a.txt', '../outside', '.frame/bin', '.frame/bin/spec-hint.js']) {
    uploads.length = 0;
    const r = await sendFiles.send({ projectPath: dir, workspaceId: 'srv', paths: ['.env', bad] });
    assert.match(String(r.error), /Not files git leaves out/, bad);
    assert.equal(uploads.length, 0, `nothing uploaded (${bad})`);
  }
});

test('T05: an older server is told to update; offline and a local workspace say so', async () => {
  const dir = project();
  fakeServer.answers['files.compare'] = new Error('Unknown method files.compare');
  try {
    assert.match((await sendFiles.list({ projectPath: dir, workspaceId: 'srv' })).error, /Update Frame Server/);
  } finally { delete fakeServer.answers['files.compare']; }
  fakeServer.answers['files.receive'] = new Error('Unknown method files.receive');
  try {
    assert.match((await sendFiles.send({ projectPath: dir, workspaceId: 'srv', paths: ['.env'] })).error, /Update Frame Server/);
  } finally { delete fakeServer.answers['files.receive']; }
  fakeServer.connected = false;
  try {
    assert.match((await sendFiles.list({ projectPath: dir, workspaceId: 'srv' })).error, /box is offline/);
  } finally { fakeServer.connected = true; }
  assert.match((await sendFiles.list({ projectPath: dir, workspaceId: 'local-ws' })).error, /not a server workspace/);
});

test('T05: the bounded size walk stops and says the size is a lower bound', () => {
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'walk-'));
  for (let i = 0; i < 30; i++) write(path.join(dir, `f${i}.txt`), '12345');
  assert.deepEqual(sendFiles.boundedSize(dir), { size: 150, cut: false });
});

test('T04 (desktop half): createOnServer passes this desktop\'s copyFiles with workspaces.create', async () => {
  const dir = project();
  frameProject.setWorkspaceSettings(dir, { copyFiles: ['/.env', 'certs/**'] });
  const root = git(['rev-list', '--max-parents=0', 'HEAD'], dir);
  calls.length = 0;
  fakeServer.answers['projects.list'] = [{ projectPath: '/srv/projects/app', remote: null, root }];
  fakeServer.answers['workspaces.create'] = () => ({ workspace: { id: 'w1', name: 'teal', branch: 'ws/teal', path: '/srv/ws/app/teal', base: 'main' } });
  try {
    const wm = require('../src/main/workspaceManager');
    await wm.create(dir, { from: 'new', location: 'server' });
    const create = calls.find((c) => c.method === 'workspaces.create');
    assert.ok(create, `calls: ${calls.map((c) => c.method).join(', ')}`);
    assert.deepEqual(create.params.copyFiles, ['/.env', 'certs/**']);
  } finally {
    delete fakeServer.answers['projects.list'];
    delete fakeServer.answers['workspaces.create'];
  }
});
