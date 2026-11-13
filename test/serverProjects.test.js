/**
 * Frame Server receives a project from a git bundle (server-onboarding T01).
 * The real projects part runs with the electron shim against temp repos.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-recv-'));
process.env.HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(process.env.HOME, { recursive: true });
process.env.FRAME_SERVER_PROJECTS = path.join(SANDBOX, 'projects');
process.env.FRAME_SERVER_HOME = path.join(SANDBOX, 'server-home');
process.env.GIT_CONFIG_NOSYSTEM = '1';
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();

const shim = require('../src/server/electronShim');
const handle = shim.install({ home: path.join(SANDBOX, 'server-home'), version: '0.0.0' });
const methods = {};
require('../src/server/projects').setup({ shim: handle, registerMethods: (m) => Object.assign(methods, m), broadcast() {} });

let seq = 0;
/** A local repo with two commits on main and a feature branch; returns { dir, root, bundle }. */
function localRepo({ remote = null } = {}) {
  const dir = path.join(SANDBOX, `local-${++seq}`);
  git(['init', '-q', '-b', 'main', dir]);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(['add', '.'], dir); git(['commit', '-qm', 'first'], dir);
  git(['checkout', '-qb', 'feat/x'], dir); fs.writeFileSync(path.join(dir, 'b.txt'), 'two\n');
  git(['add', '.'], dir); git(['commit', '-qm', 'second'], dir);
  git(['checkout', '-q', 'main'], dir);
  if (remote) git(['remote', 'add', 'origin', remote], dir);
  const root = git(['rev-list', '--max-parents=0', 'HEAD'], dir).split('\n').sort()[0];
  const tmp = path.join(SANDBOX, 'server-home', 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const bundle = path.join(tmp, `receive-${seq}.bundle`);
  git(['bundle', 'create', '-q', bundle, 'HEAD', '--branches', '--tags'], dir);
  return { dir, root, bundle };
}

test('a private repository arrives by bundle and its origin is the real remote', async () => {
  const { root, bundle } = localRepo({ remote: 'git@github.com:me/private-app.git' });
  const res = await methods['projects.receive']({ bundlePath: bundle, originUrl: 'git@github.com:me/private-app.git', root, name: 'private-app' });
  assert.equal(res.projectPath, path.join(process.env.FRAME_SERVER_PROJECTS, 'private-app'));
  assert.equal(git(['remote', 'get-url', 'origin'], res.projectPath), 'git@github.com:me/private-app.git');
  assert.ok(git(['rev-parse', '--verify', 'refs/remotes/origin/feat/x'], res.projectPath), 'every branch came along');
  assert.ok(fs.existsSync(path.join(res.projectPath, 'a.txt')), 'checked out');
  assert.equal(fs.existsSync(bundle), false, 'the bundle is removed');
  const listed = await methods['projects.list']();
  assert.ok(listed.find((p) => p.projectPath === res.projectPath && p.remote === 'github.com/me/private-app' && p.root === root));
});

test('a project with no remote arrives, is known by its root commit, and is not cloned twice', async () => {
  const { root, bundle } = localRepo();
  const res = await methods['projects.receive']({ bundlePath: bundle, originUrl: null, root, name: 'Notes' });
  assert.equal(path.basename(res.projectPath), 'notes');
  assert.throws(() => git(['remote', 'get-url', 'origin'], res.projectPath), 'no origin pointing at the bundle');
  assert.equal(git(['config', 'frame.root'], res.projectPath), root);
  const listed = await methods['projects.list']();
  assert.ok(listed.find((p) => p.projectPath === res.projectPath && p.remote === null && p.root === root));
  const again = localRepo();
  const second = await methods['projects.receive']({ bundlePath: again.bundle, originUrl: null, root, name: 'Notes' });
  assert.equal(second.projectPath, res.projectPath, 'the same project reuses its clone');
  assert.equal(second.cloned, false);
});

test('a corrupt bundle leaves nothing behind and names the cause', async () => {
  const tmp = path.join(SANDBOX, 'server-home', 'tmp');
  const bundle = path.join(tmp, 'receive-bad.bundle');
  fs.writeFileSync(bundle, 'not a bundle');
  await assert.rejects(methods['projects.receive']({ bundlePath: bundle, originUrl: 'https://github.com/me/broken', root: 'c'.repeat(40), name: 'broken' }), /bundle/i);
  const left = fs.existsSync(process.env.FRAME_SERVER_PROJECTS) ? fs.readdirSync(process.env.FRAME_SERVER_PROJECTS) : [];
  assert.deepEqual(left.filter((n) => /broken/.test(n)), [], 'no clone and no partial folder');
  assert.equal(fs.existsSync(bundle), false, 'the bundle is removed');
});

test('a bundle path outside the server\'s tmp folder is refused', async () => {
  await assert.rejects(methods['projects.receive']({ bundlePath: '/etc/passwd', originUrl: 'https://github.com/me/x', root: 'd'.repeat(40), name: 'x' }), /tmp/);
});
