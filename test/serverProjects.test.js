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

/**
 * A project on the server whose `origin` is a real (bare) repository, with
 * a commit pushed to origin's `main` after the server got its copy — so only
 * a fetch on the server sees it. Returns { projectPath, bare, local, tip }.
 */
async function onServerWithOrigin() {
  const n = ++seq;
  const bare = path.join(SANDBOX, `origin-${n}.git`);
  git(['init', '-q', '--bare', '-b', 'main', bare]);
  const { dir: local, root, bundle } = localRepo({ remote: bare });
  git(['push', '-q', 'origin', 'main'], local);
  const { projectPath } = await methods['projects.receive']({ bundlePath: bundle, originUrl: `https://github.com/me/app-${n}.git`, root, name: `app-${n}` });
  git(['remote', 'set-url', 'origin', bare], projectPath);
  fs.writeFileSync(path.join(local, 'c.txt'), 'three\n');
  git(['add', '.'], local); git(['commit', '-qm', 'third'], local);
  git(['push', '-q', 'origin', 'main'], local);
  return { projectPath, bare, local, tip: git(['rev-parse', 'main'], local) };
}

test('workspaces.create with a branch cuts it from the fetched origin/<base> and names the workspace from it', async () => {
  const { projectPath, tip } = await onServerWithOrigin();
  assert.notEqual(git(['rev-parse', 'refs/remotes/origin/main'], projectPath), tip, 'the server has not seen the new commit yet');
  const res = await methods['workspaces.create']({ projectPath, from: 'new', base: 'main', branch: 'frame/cloud-12-login' });
  assert.equal(res.error, null, res.error);
  assert.equal(res.workspace.branch, 'frame/cloud-12-login');
  assert.equal(res.workspace.name, 'cloud-12-login');
  assert.equal(res.workspace.base, 'main');
  assert.equal(res.fetch.fetched, true);
  assert.equal(git(['rev-parse', 'refs/heads/frame/cloud-12-login'], projectPath), tip, 'cut from origin/main after the fetch');
  assert.equal(res.startSha, tip, 'startSha is the commit the branch was cut from');
  assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], res.workspace.path), 'frame/cloud-12-login');
});

test('workspaces.create refuses a branch name that is taken or invalid, and creates nothing', async () => {
  const { projectPath } = await onServerWithOrigin();
  git(['branch', 'frame/cloud-13-taken', 'main'], projectPath);
  const before = (await methods['workspaces.list']({ projectPath })).workspaces.length;
  const taken = await methods['workspaces.create']({ projectPath, from: 'new', base: 'main', branch: 'frame/cloud-13-taken' });
  assert.match(taken.error, /already exists/);
  const invalid = await methods['workspaces.create']({ projectPath, from: 'new', base: 'main', branch: '--upload-pack=touch x' });
  assert.match(invalid.error, /not a valid branch name/);
  assert.equal((await methods['workspaces.list']({ projectPath })).workspaces.length, before, 'no workspace was made');
});

test('workspaces.create without a branch still picks its own name and answers startSha', async () => {
  const { projectPath, tip } = await onServerWithOrigin();
  const res = await methods['workspaces.create']({ projectPath, from: 'new', base: 'main' });
  assert.equal(res.error, null, res.error);
  assert.match(res.workspace.branch, /\//);
  assert.equal(res.startSha, tip);
  assert.equal(git(['rev-parse', `refs/heads/${res.workspace.branch}`], projectPath), tip);
});

test('workspaces.preflight fetches the base and answers what Start Work checks, writing nothing', async () => {
  const { projectPath, tip } = await onServerWithOrigin();
  const branchesBefore = git(['branch', '--list'], projectPath);
  const res = await methods['workspaces.preflight']({ projectPath, branch: 'frame/cloud-20-new', base: 'main' });
  assert.deepEqual(res, { branchTaken: false, baseOnOrigin: true, fetch: { fetched: true, error: null }, tasksPath: null });
  assert.equal(git(['rev-parse', 'refs/remotes/origin/main'], projectPath), tip, 'origin/main was fetched');
  assert.equal(git(['branch', '--list'], projectPath), branchesBefore, 'no branch was made');

  git(['branch', 'frame/cloud-20-taken', 'main'], projectPath);
  assert.equal((await methods['workspaces.preflight']({ projectPath, branch: 'frame/cloud-20-taken', base: 'main' })).branchTaken, true);

  const missing = await methods['workspaces.preflight']({ projectPath, branch: 'frame/cloud-20-new', base: 'only-on-mac' });
  assert.equal(missing.baseOnOrigin, false);
  assert.equal(missing.fetch.fetched, false);

  fs.mkdirSync(path.join(projectPath, '.frame'), { recursive: true });
  fs.writeFileSync(path.join(projectPath, '.frame', 'config.json'), '{}\n');
  assert.equal((await methods['workspaces.preflight']({ projectPath, branch: 'frame/cloud-20-new', base: 'main' })).tasksPath, path.join(projectPath, '.frame', 'tasks.json'));
});

test('workspaces.preflight keeps the last fetched copy of the base when the fetch fails', async () => {
  const { projectPath } = await onServerWithOrigin();
  git(['remote', 'set-url', 'origin', path.join(SANDBOX, 'gone.git')], projectPath);
  const res = await methods['workspaces.preflight']({ projectPath, branch: 'frame/cloud-21-x', base: 'main' });
  assert.equal(res.fetch.fetched, false);
  assert.ok(res.fetch.error);
  assert.equal(res.baseOnOrigin, true, 'origin/main from the last fetch still counts');
});

test('workspaces.preflight refuses an unknown project and invalid names before any git runs', async () => {
  const { projectPath } = await onServerWithOrigin();
  await assert.rejects(methods['workspaces.preflight']({ projectPath: path.join(SANDBOX, 'nope'), branch: 'a', base: 'main' }), /not on the server/);
  await assert.rejects(methods['workspaces.preflight']({ projectPath, branch: '--upload-pack=touch x', base: 'main' }), /not a valid branch name/);
  await assert.rejects(methods['workspaces.preflight']({ projectPath, branch: 'frame/ok', base: '--upload-pack=touch x' }), /not a valid base branch name/);
});
