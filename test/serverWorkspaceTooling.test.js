/**
 * Frame's gitignored tooling in server workspaces (server-workspace-tooling).
 *
 * A server clone never gets `.frame/runtime/commands` (spec templates),
 * `.frame/bin` or `.frame/index` from git, and nothing staged them until a
 * spec command was sent from the desktop — so an agent asked for a spec in a
 * server workspace's terminal found no templates. Creating, restoring and
 * selecting (workspaces.provision) a workspace of a Frame project now stages
 * them; a project without Frame gets nothing. Runs Frame Server's real
 * methods against projects received by bundle, as serverSpecs.test.js does.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-srvtooling-'));
process.env.HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(process.env.HOME, { recursive: true });
process.env.FRAME_SERVER_PROJECTS = path.join(SANDBOX, 'projects');
process.env.FRAME_SERVER_HOME = path.join(SANDBOX, 'server-home');
process.env.GIT_CONFIG_NOSYSTEM = '1';
// Git 2.47+ runs auto-maintenance in a detached process after clone, commit
// and fetch. On CI's newer git it was still writing into these repositories
// when the after hook removed the sandbox, which then failed with ENOTEMPTY.
// Every git child (ours and the server methods') inherits this env.
Object.assign(process.env, {
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'maintenance.auto', GIT_CONFIG_VALUE_0: 'false',
  GIT_CONFIG_KEY_1: 'gc.auto', GIT_CONFIG_VALUE_1: '0'
});
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();

const shim = require('../src/server/electronShim');
const handle = shim.install({ home: path.join(SANDBOX, 'server-home'), version: '0.0.0' });
const methods = {};
const register = (m) => Object.assign(methods, m);
require('../src/server/projects').setup({ shim: handle, registerMethods: register, broadcast() {} });
const specsPart = require('../src/server/specs').setup({ shim: handle, registerMethods: register, broadcast() {} });

test.after(() => {
  specsPart.idle();
  // Retried as well, in case anything else is still finishing a write.
  fs.rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

const TEMPLATE = path.join('.frame', 'runtime', 'commands', 'claude-code', 'spec.plan.md');
const HOOK = path.join('.frame', 'bin', 'spec-command-hint.js');
const INDEX = path.join('.frame', 'index');

let seq = 0;
/** A project received by the server; `frame` gives it .frame/config.json and Frame's .gitignore block. */
async function receive({ frame }) {
  const local = path.join(SANDBOX, `local-${++seq}`);
  git(['init', '-q', '-b', 'main', local]);
  write(path.join(local, 'a.txt'), 'one\n');
  if (frame) {
    write(path.join(local, '.frame', 'config.json'), '{}\n');
    write(path.join(local, '.frame', '.gitignore'), 'runtime/\nbin/\nindex/\n');
  }
  git(['add', '.'], local);
  git(['commit', '-qm', 'first'], local);
  const root = git(['rev-list', '--max-parents=0', 'HEAD'], local);
  const tmp = path.join(SANDBOX, 'server-home', 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const bundle = path.join(tmp, `receive-${seq}.bundle`);
  git(['bundle', 'create', '-q', bundle, 'HEAD', '--branches', '--tags'], local);
  const { projectPath } = await methods['projects.receive']({ bundlePath: bundle, originUrl: null, root, name: `proj-${seq}` });
  return projectPath;
}

const has = (dir, rel) => fs.existsSync(path.join(dir, rel));

test('a new workspace of a Frame project has the spec templates, hook scripts and spec index — and git sees no change', async () => {
  const projectPath = await receive({ frame: true });
  assert.equal(has(projectPath, TEMPLATE), false, 'the clone starts without them');
  const created = await methods['workspaces.create']({ projectPath, from: 'new' });
  assert.ok(created && created.workspace, JSON.stringify(created));
  const ws = created.workspace.path;
  for (const rel of [TEMPLATE, HOOK, INDEX]) {
    assert.equal(has(projectPath, rel), true, `clone: ${rel}`);
    assert.equal(has(ws, rel), true, `workspace: ${rel}`);
  }
  assert.equal(git(['status', '--porcelain'], ws), '', 'only gitignored files were written');
});

test('a project without Frame gets no .frame folder from the server', async () => {
  const projectPath = await receive({ frame: false });
  const created = await methods['workspaces.create']({ projectPath, from: 'new' });
  assert.ok(created && created.workspace, JSON.stringify(created));
  assert.equal(has(projectPath, '.frame'), false, 'clone');
  assert.equal(has(created.workspace.path, '.frame'), false, 'workspace');
  const res = await methods['workspaces.provision']({ projectPath, id: created.workspace.id });
  assert.deepEqual(res, { copied: [] });
  assert.equal(has(created.workspace.path, '.frame'), false);
});

test('workspaces.provision brings missing tooling back; an unknown or archived workspace gets nothing', async () => {
  const projectPath = await receive({ frame: true });
  const { workspace } = await methods['workspaces.create']({ projectPath, from: 'new' });
  fs.rmSync(path.join(workspace.path, '.frame', 'runtime'), { recursive: true, force: true });
  fs.rmSync(path.join(projectPath, '.frame', 'runtime'), { recursive: true, force: true });
  const res = await methods['workspaces.provision']({ projectPath, id: workspace.id });
  assert.ok(res.copied.includes('.frame/runtime/commands'), JSON.stringify(res));
  assert.equal(has(workspace.path, TEMPLATE), true);

  assert.deepEqual(await methods['workspaces.provision']({ projectPath, id: 'no-such-id' }), { copied: [] });
  const archived = await methods['workspaces.archive']({ projectPath, id: workspace.id });
  assert.equal(archived.error, null, archived.error);
  assert.deepEqual(await methods['workspaces.provision']({ projectPath, id: workspace.id }), { copied: [] });
  await assert.rejects(methods['workspaces.provision']({ projectPath: path.join(SANDBOX, 'elsewhere'), id: workspace.id }));
});

test('a restored workspace comes back with the tooling, even when the clone had lost it', async () => {
  const projectPath = await receive({ frame: true });
  const { workspace } = await methods['workspaces.create']({ projectPath, from: 'new' });
  assert.equal((await methods['workspaces.archive']({ projectPath, id: workspace.id })).error, null);
  fs.rmSync(path.join(projectPath, '.frame', 'runtime'), { recursive: true, force: true });
  const restored = await methods['workspaces.restore']({ projectPath, id: workspace.id });
  assert.equal(restored.error, null, restored.error);
  assert.equal(has(restored.workspace.path, TEMPLATE), true);
});

test('specs.stage still provisions as before (it shares the code)', async () => {
  const projectPath = await receive({ frame: true });
  const { workspace } = await methods['workspaces.create']({ projectPath, from: 'new' });
  fs.rmSync(path.join(workspace.path, '.frame', 'runtime'), { recursive: true, force: true });
  const staged = await methods['specs.stage']({ projectPath, root: workspace.path, slug: null, command: 'spec.new', description: 'x' });
  assert.equal(staged.success, true, staged.error);
  assert.equal(has(workspace.path, TEMPLATE), true);
});
