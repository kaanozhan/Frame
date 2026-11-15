/**
 * Frame Server restores an archived workspace (workspaces.restore), the
 * method behind the desktop's Archived list for server workspaces.
 * The real projects part runs with the electron shim against a project
 * received by bundle.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'frame-restore-')));
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

test('an archived server workspace is listed as archived, then restored from its branch with its commits', async () => {
  const local = path.join(SANDBOX, 'local');
  git(['init', '-q', '-b', 'main', local]);
  fs.writeFileSync(path.join(local, 'a.txt'), 'one\n');
  git(['add', '.'], local); git(['commit', '-qm', 'first'], local);
  const tmp = path.join(SANDBOX, 'server-home', 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const bundle = path.join(tmp, 'receive-1.bundle');
  git(['bundle', 'create', '-q', bundle, 'HEAD', '--branches', '--tags'], local);
  const { projectPath } = await methods['projects.receive']({ bundlePath: bundle, originUrl: null, root: git(['rev-list', '--max-parents=0', 'HEAD'], local), name: 'app' });

  const { workspace } = await methods['workspaces.create']({ projectPath, from: 'new' });
  fs.writeFileSync(path.join(workspace.path, 'work.txt'), 'kept\n');
  git(['add', '.'], workspace.path); git(['commit', '-qm', 'work'], workspace.path);
  const archived = await methods['workspaces.archive']({ projectPath, id: workspace.id });
  assert.equal(archived.error, null, archived.error);
  assert.equal(fs.existsSync(workspace.path), false, 'the worktree folder is gone');

  const listed = await methods['workspaces.list']({ projectPath });
  assert.deepEqual(listed.archived.map((w) => w.id), [workspace.id], 'the server lists it as archived');

  const restored = await methods['workspaces.restore']({ projectPath, id: workspace.id });
  assert.equal(restored.error, null, restored.error);
  assert.equal(fs.readFileSync(path.join(workspace.path, 'work.txt'), 'utf8'), 'kept\n', 'its commits came back');
  const after = await methods['workspaces.list']({ projectPath });
  assert.ok(after.workspaces.some((w) => w.id === workspace.id));
  assert.equal(after.archived.length, 0);
  await assert.rejects(methods['workspaces.restore']({ projectPath: path.join(SANDBOX, 'nope'), id: workspace.id }), /not on the server/);
});
