/**
 * Frame Server receives git-ignored files (server-copy-files T03, T04).
 *
 * The real server parts run with the electron shim against a project
 * received by bundle and a real server workspace.
 *
 * T03: files.compare and files.receive — exactly the archive's files, with
 * their modes, into the workspace and (ignored files only) the main copy;
 * the whole send refused on one bad path; nothing written through a
 * symlinked folder; the archive only from the server's tmp folder.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'frame-sendfiles-')));
process.env.HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(process.env.HOME, { recursive: true });
process.env.FRAME_SERVER_PROJECTS = path.join(SANDBOX, 'projects');
process.env.FRAME_SERVER_HOME = path.join(SANDBOX, 'server-home');
process.env.GIT_CONFIG_NOSYSTEM = '1';
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();

const shim = require('../src/server/electronShim');
const handle = shim.install({ home: path.join(SANDBOX, 'server-home'), version: '0.0.0' });
const methods = {};
const register = (m) => Object.assign(methods, m);
require('../src/server/projects').setup({ shim: handle, registerMethods: register, broadcast() {} });
require('../src/server/sendFiles').setup({ shim: handle, registerMethods: register, broadcast() {} });
const { pack } = require('../src/shared/fileArchive');

const TMP = path.join(SANDBOX, 'server-home', 'tmp');
const write = (file, body = 'x\n') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); };

let seq = 0;
/** A server project received by bundle (.gitignore ignores .env, certs/, config/local.json) and one server workspace. */
async function serverWorkspace() {
  const local = path.join(SANDBOX, `local-${++seq}`);
  git(['init', '-q', '-b', 'main', local]);
  write(path.join(local, '.gitignore'), '.env*\ncerts/\nconfig/local.json\n');
  write(path.join(local, 'a.txt'), 'one\n');
  git(['add', '.'], local); git(['commit', '-qm', 'first'], local);
  const root = git(['rev-list', '--max-parents=0', 'HEAD'], local);
  fs.mkdirSync(TMP, { recursive: true });
  const bundle = path.join(TMP, `receive-${seq}.bundle`);
  git(['bundle', 'create', '-q', bundle, 'HEAD', '--branches', '--tags'], local);
  const { projectPath } = await methods['projects.receive']({ bundlePath: bundle, originUrl: null, root, name: `proj-${seq}` });
  const created = await methods['workspaces.create']({ projectPath, from: 'new' });
  return { projectPath, ws: created.workspace.path };
}

/** Upload an archive the way the desktop does: a `files-*.fpk` in the server's tmp folder. */
function upload(entries, name = `files-${crypto.randomBytes(4).toString('hex')}.fpk`) {
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(path.join(TMP, name), pack(entries));
  return name;
}
const file = (p, body, mode = 0o644) => ({ path: p, type: 'file', mode, data: Buffer.from(body) });
const modeOf = (f) => fs.statSync(f).mode & 0o777;

// ─── T03: receive and compare ────────────────────────────────

test('T03: the ticked files land in the workspace with their modes; ignored ones also in the main copy', async () => {
  const { projectPath, ws } = await serverWorkspace();
  const archive = upload([file('.env', 'SECRET=1\n', 0o600), file('certs/dev.pem', 'PEM', 0o400), file('src/new.js', 'new\n')]);
  const r = await methods['files.receive']({ archive, projectPath, root: ws, untracked: ['src/new.js'] });
  assert.deepEqual(r.written, ['.env', 'certs/dev.pem', 'src/new.js']);
  assert.deepEqual(r.toMainCopy, ['.env', 'certs/dev.pem'], 'untracked files stay out of the main copy');
  assert.equal(fs.readFileSync(path.join(ws, '.env'), 'utf8'), 'SECRET=1\n');
  assert.equal(modeOf(path.join(ws, '.env')), 0o600);
  assert.equal(modeOf(path.join(ws, 'certs/dev.pem')), 0o400);
  assert.equal(fs.readFileSync(path.join(projectPath, '.env'), 'utf8'), 'SECRET=1\n');
  assert.equal(fs.existsSync(path.join(projectPath, 'src/new.js')), false);
  assert.equal(git(['status', '--porcelain'], projectPath), '', 'the main copy does not look dirty');
  assert.equal(fs.existsSync(path.join(TMP, archive)), false, 'the archive is removed');
});

test('T03: an existing file is overwritten and reported', async () => {
  const { projectPath, ws } = await serverWorkspace();
  write(path.join(ws, '.env'), 'OLD\n');
  const r = await methods['files.receive']({ archive: upload([file('.env', 'NEW\n', 0o600)]), projectPath, root: ws });
  assert.deepEqual(r.overwritten, ['.env']);
  assert.equal(fs.readFileSync(path.join(ws, '.env'), 'utf8'), 'NEW\n');
});

test('T03: one bad path refuses the whole send and writes nothing', async () => {
  const { projectPath, ws } = await serverWorkspace();
  for (const bad of [file('../escape.txt', 'x'), file('.git/hooks/pre-commit', 'x'), { path: 'ln', type: 'symlink', mode: 0o777, target: '../../etc/passwd' }]) {
    const archive = upload([file('.env', 'ok'), bad]);
    await assert.rejects(methods['files.receive']({ archive, projectPath, root: ws }), /Refused the whole send/);
    assert.equal(fs.existsSync(path.join(ws, '.env')), false, `nothing written (${bad.path})`);
    assert.equal(fs.existsSync(path.join(TMP, archive)), false, 'the archive is removed');
  }
});

test('T03: a file whose folder is a symlink on the server is skipped, never followed', async () => {
  const { projectPath, ws } = await serverWorkspace();
  const outside = path.join(SANDBOX, 'outside');
  fs.mkdirSync(outside, { recursive: true });
  fs.symlinkSync(outside, path.join(ws, 'config'));
  const r = await methods['files.receive']({ archive: upload([file('config/local.json', '{}'), file('.env', 'ok')]), projectPath, root: ws });
  assert.deepEqual(r.skipped, [{ path: 'config/local.json', reason: 'config is a symlink on the server' }]);
  assert.equal(fs.existsSync(path.join(outside, 'local.json')), false, 'nothing written outside');
  assert.deepEqual(r.written, ['.env']);
});

test('T03: only an upload in the server tmp folder is read, and only for the project and its workspaces', async () => {
  const { projectPath, ws } = await serverWorkspace();
  const elsewhere = path.join(SANDBOX, 'files-x.fpk');
  fs.writeFileSync(elsewhere, pack([file('.env', 'x')]));
  await assert.rejects(methods['files.receive']({ archive: elsewhere, projectPath, root: ws }), /must be an upload/);
  await assert.rejects(methods['files.receive']({ archive: upload([file('.env', 'x')], 'other.bin'), projectPath, root: ws }), /must be an upload/);
  await assert.rejects(methods['files.receive']({ archive: upload([file('.env', 'x')]), projectPath, root: path.join(SANDBOX, 'home') }), /not a workspace/);
});

test('T03: files.compare says same, changed or missing', async () => {
  const { projectPath, ws } = await serverWorkspace();
  write(path.join(ws, '.env'), 'SAME\n');
  write(path.join(ws, '.env.local'), 'server version\n');
  const hash = crypto.createHash('sha256').update('SAME\n').digest('hex');
  const r = await methods['files.compare']({
    projectPath, root: ws,
    entries: [
      { path: '.env', type: 'file', size: 5, sha256: hash },
      { path: '.env.local', type: 'file', size: 15, sha256: crypto.createHash('sha256').update('mac version!!!\n').digest('hex') },
      { path: 'config/local.json', type: 'file', size: 2, sha256: null },
      { path: '../x', type: 'file', size: 1, sha256: null }
    ]
  });
  assert.deepEqual(r, { '.env': 'same', '.env.local': 'changed', 'config/local.json': 'missing' });
});

// ─── T04: the desktop's patterns on create ───────────────────

test('T04: a new server workspace gets the main copy\'s files matching the patterns the desktop passed', async () => {
  const { projectPath, ws } = await serverWorkspace();
  // Sent once, into the first workspace and the main copy.
  await methods['files.receive']({ archive: upload([file('.env', 'SECRET\n', 0o600), file('certs/dev.pem', 'PEM')]), projectPath, root: ws });
  const next = await methods['workspaces.create']({ projectPath, from: 'new', copyFiles: ['/.env', 'certs/**'] });
  assert.ok(next.workspace, JSON.stringify(next));
  assert.deepEqual([...next.copied].sort(), ['.env', 'certs']);
  assert.equal(fs.readFileSync(path.join(next.workspace.path, '.env'), 'utf8'), 'SECRET\n');
  assert.ok(fs.existsSync(path.join(next.workspace.path, 'certs', 'dev.pem')));
  const none = await methods['workspaces.create']({ projectPath, from: 'new', copyFiles: [] });
  assert.deepEqual(none.copied, [], 'an empty list copies nothing, whatever the server config says');
});

test('T04: without patterns from the desktop the server keeps using its own config', async () => {
  const { projectPath, ws } = await serverWorkspace();
  await methods['files.receive']({ archive: upload([file('.env', 'S\n')]), projectPath, root: ws });
  const next = await methods['workspaces.create']({ projectPath, from: 'new' });
  assert.deepEqual(next.copied, ['.env'], 'the default .env* still applies');
});
