/**
 * Specs in server workspaces (server-specs spec).
 *
 * T01: specManager's per-checkout readers — the same readers scoped to one
 * checkout root, with task state read from a separate tasks project (on the
 * server: the worktree, and the server clone's tasks.json).
 * T02: Frame Server's specs.list / get / report / status on a real server
 * project and workspace (projects.receive + workspaces.create).
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { execFileSync } = require('child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-srvspecs-'));
process.env.HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(process.env.HOME, { recursive: true });
process.env.FRAME_SERVER_PROJECTS = path.join(SANDBOX, 'projects');
process.env.FRAME_SERVER_HOME = path.join(SANDBOX, 'server-home');
process.env.GIT_CONFIG_NOSYSTEM = '1';
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();

// The server's own headless environment: electron and analytics are stubbed
// by the shim, as in Frame Server.
const shim = require('../src/server/electronShim');
const handle = shim.install({ home: path.join(SANDBOX, 'server-home'), version: '0.0.0' });
const methods = {};
const register = (m) => Object.assign(methods, m);
require('../src/server/projects').setup({ shim: handle, registerMethods: register, broadcast() {} });
const specsPart = require('../src/server/specs').setup({ shim: handle, registerMethods: register, broadcast: (...a) => events.push(a) });
const events = [];
// Open watchers would keep the test process alive.
after(() => specsPart.idle());

const specManager = require('../src/main/specManager');

function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n');
}

/** A worktree with one planned spec, and a separate clone holding task state. */
function fixture(name) {
  const base = path.join(SANDBOX, name);
  const worktree = path.join(base, 'worktree');
  const clone = path.join(base, 'clone');
  const dir = path.join(worktree, '.frame', 'specs', 'remote-thing');
  write(path.join(dir, 'status.json'), {
    slug: 'remote-thing', title: 'Remote thing', phase: 'implementing',
    generated_task_ids: ['task-spec-remote-thing-T01', 'task-spec-remote-thing-T02'],
    created_at: '2026-11-14T00:00:00.000Z', updated_at: '2026-11-14T00:00:00.000Z'
  });
  write(path.join(dir, 'spec.md'), '# Remote thing\n');
  write(path.join(dir, 'plan.md'), '# Plan\n');
  write(path.join(dir, 'tasks.md'), '# Tasks\n\n- T01 · One\n- T02 · Two\n');
  write(path.join(dir, 'plan-report.html'), '<html>report</html>');
  write(path.join(clone, '.frame', 'tasks.json'), {
    tasks: [
      { id: 'task-spec-remote-thing-T01', title: 'One', status: 'completed', source: 'spec:remote-thing:T01' },
      { id: 'task-spec-remote-thing-T02', title: 'Two', status: 'in_progress', source: 'spec:remote-thing:T02' }
    ]
  });
  // The worktree's own tracked tasks.json says nothing about this spec.
  write(path.join(worktree, '.frame', 'tasks.json'), { tasks: [] });
  return { worktree, clone, dir };
}

// ─── T01: per-checkout readers ───────────────────────────────

test('T01: listSpecsIn lists one checkout, with task counts from the tasks project', () => {
  const { worktree, clone } = fixture('list');
  const specs = specManager.listSpecsIn(worktree, clone);
  assert.equal(specs.length, 1);
  const [spec] = specs;
  assert.equal(spec.slug, 'remote-thing');
  assert.equal(spec.phase, 'implementing');
  assert.equal(spec.task_count, 2);
  assert.equal(spec.completed_count, 1, 'counted from the clone\'s tasks.json, not the worktree\'s');
  assert.equal(spec.workspace, null);
  assert.deepEqual(spec.reports, ['plan']);
});

test('T01: getSpecIn and readSpecReportIn read the checkout\'s files', () => {
  const { worktree } = fixture('get');
  const full = specManager.getSpecIn(worktree, 'remote-thing');
  assert.equal(full.status.title, 'Remote thing');
  assert.equal(full.spec, '# Remote thing\n');
  assert.equal(full.plan, '# Plan\n');
  assert.equal(full.workspace, null);
  const report = specManager.readSpecReportIn(worktree, 'remote-thing', 'plan');
  assert.equal(report.success, true);
  assert.equal(report.html, '<html>report</html>');
  const missing = specManager.readSpecReportIn(worktree, 'remote-thing', 'implement');
  assert.equal(missing.success, false);
});

test('T01: updateSpecStatusIn writes the checkout\'s status.json', () => {
  const { worktree, dir } = fixture('status');
  const r = specManager.updateSpecStatusIn(worktree, 'remote-thing', { implement_mode: 'guided' });
  assert.equal(r.status.implement_mode, 'guided');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8')).implement_mode, 'guided');
});

test('T01: buildSpecCommandFileIn stages the prompt in the checkout and names the tasks project\'s tasks.json', () => {
  const { worktree, clone } = fixture('stage');
  const r = specManager.buildSpecCommandFileIn(worktree, clone, 'remote-thing', 'spec.plan', 'claude-code', '');
  assert.equal(r.success, true, r.error);
  const prompt = fs.readFileSync(path.join(worktree, r.relPath), 'utf8');
  assert.ok(prompt.includes(worktree), 'project_path is the checkout');
  assert.match(r.instruction, /^Read \.frame\/runtime\/prompts\/remote-thing__spec\.plan\.md/);
  const implement = specManager.buildSpecCommandFileIn(worktree, clone, 'remote-thing', 'spec.implement', 'claude-code', '');
  const implPrompt = fs.readFileSync(path.join(worktree, implement.relPath), 'utf8');
  assert.ok(implPrompt.includes(path.join(clone, '.frame', 'tasks.json')), 'tasks_path is the clone\'s tasks.json');
  assert.ok(!implPrompt.includes(path.join(worktree, '.frame', 'tasks.json')), 'never the worktree\'s');
});

test('T01: a per-checkout read leaves the project\'s own slug map alone', () => {
  const { worktree } = fixture('isolation');
  const project = path.join(SANDBOX, 'isolation', 'project');
  write(path.join(project, '.frame', 'specs', 'local-one', 'status.json'), {
    slug: 'local-one', title: 'Local one', phase: 'specified', generated_task_ids: []
  });
  write(path.join(project, '.frame', 'tasks.json'), { tasks: [] });
  assert.deepEqual(specManager.listSpecs(project).map((s) => s.slug), ['local-one']);
  specManager.listSpecsIn(worktree, worktree);
  assert.deepEqual(specManager.listSpecs(project).map((s) => s.slug), ['local-one']);
  assert.equal(specManager.getSpec(project, 'remote-thing'), null, 'the worktree\'s spec does not leak into the project');
});

// ─── T02: Frame Server reads specs ───────────────────────────

let seq = 0;
/** A server project received by bundle, with one server workspace holding a spec. */
async function serverWorkspace() {
  const local = path.join(SANDBOX, `local-${++seq}`);
  git(['init', '-q', '-b', 'main', local]);
  write(path.join(local, 'a.txt'), 'one\n');
  write(path.join(local, '.frame', 'tasks.json'), { tasks: [] });
  git(['add', '.'], local); git(['commit', '-qm', 'first'], local);
  const root = git(['rev-list', '--max-parents=0', 'HEAD'], local);
  const tmp = path.join(SANDBOX, 'server-home', 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const bundle = path.join(tmp, `receive-${seq}.bundle`);
  git(['bundle', 'create', '-q', bundle, 'HEAD', '--branches', '--tags'], local);
  const { projectPath } = await methods['projects.receive']({ bundlePath: bundle, originUrl: null, root, name: `proj-${seq}` });
  const created = await methods['workspaces.create']({ projectPath, from: 'new' });
  assert.ok(created && created.workspace, JSON.stringify(created));
  const ws = created.workspace.path;
  const dir = path.join(ws, '.frame', 'specs', 'on-server');
  write(path.join(dir, 'status.json'), { slug: 'on-server', title: 'On server', phase: 'tasks_generated', generated_task_ids: [] });
  write(path.join(dir, 'spec.md'), '# On server\n');
  write(path.join(dir, 'tasks.md'), '# Tasks\n\n- T01 · First\n- T02 · Second\n');
  write(path.join(dir, 'plan-report.html'), '<html>server report</html>');
  return { projectPath, ws, dir };
}

test('T02: specs.list lists a server workspace\'s specs and imports their tasks into the clone\'s tasks.json', async () => {
  const { projectPath, ws } = await serverWorkspace();
  const specs = await methods['specs.list']({ projectPath, root: ws });
  assert.deepEqual(specs.map((s) => s.slug), ['on-server']);
  assert.equal(specs[0].task_count, 2);
  const cloneTasks = JSON.parse(fs.readFileSync(path.join(projectPath, '.frame', 'tasks.json'), 'utf8'));
  assert.deepEqual(cloneTasks.tasks.map((t) => t.source).sort(), ['spec:on-server:T01', 'spec:on-server:T02']);
  const wsTasks = JSON.parse(fs.readFileSync(path.join(ws, '.frame', 'tasks.json'), 'utf8'));
  assert.deepEqual(wsTasks.tasks, [], 'the branch never carries task state');
});

test('T02: specs.get and specs.report read from the server workspace', async () => {
  const { projectPath, ws } = await serverWorkspace();
  const full = await methods['specs.get']({ projectPath, root: ws, slug: 'on-server' });
  assert.equal(full.spec, '# On server\n');
  const report = await methods['specs.report']({ projectPath, root: ws, slug: 'on-server', kind: 'plan' });
  assert.equal(report.html, '<html>server report</html>');
});

test('T02: specs.status changes only the phase, implement mode and flow mode', async () => {
  const { projectPath, ws, dir } = await serverWorkspace();
  const r = await methods['specs.status']({ projectPath, root: ws, slug: 'on-server', partial: { implement_mode: 'guided', title: 'Hijacked' } });
  assert.equal(r.status.implement_mode, 'guided');
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
  assert.equal(onDisk.title, 'On server', 'other keys are not written');
  const none = await methods['specs.status']({ projectPath, root: ws, slug: 'on-server', partial: { title: 'x' } });
  assert.match(none.error, /phase, implement mode and flow mode/);
});

test('full-auto-spec-flow: specs.status records the flow mode', async () => {
  const { projectPath, ws, dir } = await serverWorkspace();
  const r = await methods['specs.status']({ projectPath, root: ws, slug: 'on-server', partial: { flow_mode: 'full-auto' } });
  assert.equal(r.status.flow_mode, 'full-auto');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8')).flow_mode, 'full-auto');
});

test('T02: a folder that is not a server project or its workspace is refused', async () => {
  const { projectPath, ws } = await serverWorkspace();
  const elsewhere = path.join(SANDBOX, 'home');
  await assert.rejects(methods['specs.list']({ projectPath, root: elsewhere }), /not a workspace of this project/);
  await assert.rejects(methods['specs.list']({ projectPath: elsewhere, root: elsewhere }), /not on the server/);
  await assert.rejects(methods['specs.get']({ projectPath, root: ws, slug: '../../etc' }), /Not a spec name/);
});

// ─── T03: watch and push ─────────────────────────────────────

async function waitFor(pred, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

test('T03: a change under a watched workspace\'s specs pushes one specs.changed for that root', async () => {
  const { projectPath, ws, dir } = await serverWorkspace();
  const r = await methods['specs.watch']({ projectPath, roots: [ws] });
  assert.deepEqual(r.watching, [path.resolve(ws)]);
  // FSEvents may replay the fixture's own writes from just before the watch:
  // let them land before the burst under test.
  await new Promise((res) => setTimeout(res, 700));
  events.length = 0;
  fs.writeFileSync(path.join(dir, 'plan.md'), '# Plan\n');
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ slug: 'on-server', title: 'On server', phase: 'planned', generated_task_ids: [] }));
  await waitFor(() => events.some(([name]) => name === 'specs.changed'), 3000, 'specs.changed');
  await new Promise((res) => setTimeout(res, 500));
  const pushes = events.filter(([name]) => name === 'specs.changed');
  assert.equal(pushes.length, 1, 'a burst of writes is one push');
  assert.deepEqual(pushes[0][1], { root: path.resolve(ws) });
  await methods['specs.unwatch']();
});

test('T03: watching stops on unwatch, on a new set without the root, and when the last desktop leaves', async () => {
  const a = await serverWorkspace();
  const b = await serverWorkspace();
  await methods['specs.watch']({ projectPath: a.projectPath, roots: [a.ws] });
  await methods['specs.watch']({ projectPath: b.projectPath, roots: [b.ws] });
  // FSEvents may still replay writes made just before a watch started, so
  // settle first and then look only at pushes for the root in question.
  await new Promise((res) => setTimeout(res, 700));
  const pushesFor = (root) => events.filter(([n, p]) => n === 'specs.changed' && p.root === path.resolve(root)).length;
  events.length = 0;
  fs.writeFileSync(path.join(a.dir, 'plan.md'), 'changed\n');
  await new Promise((res) => setTimeout(res, 700));
  assert.equal(pushesFor(a.ws), 0, 'a root dropped from the set is no longer watched');
  specsPart.idle();
  events.length = 0;
  fs.writeFileSync(path.join(b.dir, 'plan.md'), 'changed\n');
  await new Promise((res) => setTimeout(res, 700));
  assert.equal(pushesFor(b.ws), 0, 'idle stops every watcher');
  await assert.rejects(methods['specs.watch']({ projectPath: a.projectPath, roots: [path.join(SANDBOX, 'home')] }), /not a workspace/);
});

// ─── T04: staging a spec command on the server ───────────────

test('T04: specs.stage writes the prompt in the server workspace, where its relative path resolves', async () => {
  const { projectPath, ws } = await serverWorkspace();
  const r = await methods['specs.stage']({ projectPath, root: ws, slug: 'on-server', command: 'spec.plan', aiTool: 'claude-code' });
  assert.equal(r.success, true, r.error);
  assert.equal(r.relPath, '.frame/runtime/prompts/on-server__spec.plan.md');
  assert.ok(fs.existsSync(path.join(ws, r.relPath)), 'the instruction\'s relative path exists in the worktree');
  assert.match(r.instruction, /^Read \.frame\/runtime\/prompts\/on-server__spec\.plan\.md/);
  assert.ok(fs.readFileSync(path.join(ws, r.relPath), 'utf8').includes(ws), 'project_path is the server workspace');
});

test('T04: specs.stage provisions Frame tooling in the clone and the worktree', async () => {
  const { projectPath, ws } = await serverWorkspace();
  await methods['specs.stage']({ projectPath, root: ws, slug: 'on-server', command: 'spec.tasks' });
  for (const rel of ['.frame/bin/spec-hint.js', '.frame/bin/spec-context.js', '.frame/runtime/commands/claude-code/spec.plan.md', '.frame/runtime/commands/claude-code/plan-report-template.html']) {
    assert.ok(fs.existsSync(path.join(projectPath, rel)), `clone has ${rel}`);
    assert.ok(fs.existsSync(path.join(ws, rel)), `worktree has ${rel}`);
  }
  assert.ok(fs.existsSync(path.join(ws, '.frame', 'index', 'spec-index.json')), 'the spec index reaches the worktree');
});

test('T04: spec.implement names the clone\'s tasks.json; spec.new stages without a slug', async () => {
  const { projectPath, ws } = await serverWorkspace();
  const impl = await methods['specs.stage']({ projectPath, root: ws, slug: 'on-server', command: 'spec.implement' });
  const prompt = fs.readFileSync(path.join(ws, impl.relPath), 'utf8');
  assert.ok(prompt.includes(path.join(projectPath, '.frame', 'tasks.json')), 'tasks_path is the server clone');
  assert.ok(!prompt.includes(path.join(ws, '.frame', 'tasks.json')), 'never the worktree\'s copy');
  const fresh = await methods['specs.stage']({ projectPath, root: ws, slug: null, command: 'spec.new', description: 'Make a thing' });
  assert.equal(fresh.success, true, fresh.error);
  assert.match(fresh.relPath, /^\.frame\/runtime\/prompts\/spec\.new__.*\.md$/);
  assert.ok(fs.readFileSync(path.join(ws, fresh.relPath), 'utf8').includes('Make a thing'));
});

test('full-auto-spec-flow T04: specs.stage accepts spec.auto and stages its phase prompts on the server', async () => {
  const { projectPath, ws } = await serverWorkspace();
  const r = await methods['specs.stage']({ projectPath, root: ws, slug: 'on-server', command: 'spec.auto', aiTool: 'claude-code' });
  assert.equal(r.success, true, r.error);
  assert.equal(r.relPath, '.frame/runtime/prompts/on-server__spec.auto.md');
  for (const cmd of ['spec.plan', 'spec.tasks', 'spec.implement']) {
    assert.ok(fs.existsSync(path.join(ws, '.frame', 'runtime', 'prompts', `on-server__${cmd}.md`)), `${cmd} prompt staged in the worktree`);
  }
  assert.equal(r.launchFlags[0], '--settings');
});

test('T04: specs.stage refuses local-mode projects and unknown commands', async () => {
  const { projectPath, ws } = await serverWorkspace();
  const bad = await methods['specs.stage']({ projectPath, root: ws, slug: 'on-server', command: 'spec.ship' });
  assert.equal(bad.success, false);
  assert.match(bad.error, /Unknown spec command/);
  write(path.join(projectPath, '.frame', 'config.json'), { settings: { gitSharing: 'local' } });
  const local = await methods['specs.stage']({ projectPath, root: ws, slug: 'on-server', command: 'spec.plan' });
  assert.equal(local.success, false);
  assert.match(local.error, /local mode/);
  assert.equal(fs.existsSync(path.join(ws, '.frame', 'runtime', 'prompts', 'on-server__spec.plan.md')), false, 'nothing staged');
});

// ─── frame-cloud-start-on-server T03: specs.create ───────────

test('start-on-server T03: specs.create writes a new spec folder into a server workspace', async () => {
  const { projectPath, ws } = await serverWorkspace();
  const files = { 'spec.md': '# Login\n', 'status.json': '{ "slug": "login", "phase": "spec" }\n' };
  const r = await methods['specs.create']({ projectPath, root: ws, slug: 'login', files });
  assert.deepEqual(r, { created: ['spec.md', 'status.json'] });
  const dir = path.join(ws, '.frame', 'specs', 'login');
  assert.equal(fs.readFileSync(path.join(dir, 'spec.md'), 'utf8'), '# Login\n');
  assert.equal(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'), files['status.json']);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['spec.md', 'status.json']);
  assert.equal(fs.existsSync(path.join(projectPath, '.frame', 'specs', 'login')), false, 'the main copy is not written');
});

test('start-on-server T03: specs.create refuses an existing folder, a bad slug, other files and a foreign root', async () => {
  const { projectPath, ws } = await serverWorkspace();
  const files = { 'spec.md': '# X\n', 'status.json': '{}\n' };
  await assert.rejects(methods['specs.create']({ projectPath, root: ws, slug: 'on-server', files }), /already exists/);
  assert.equal(fs.readFileSync(path.join(ws, '.frame', 'specs', 'on-server', 'spec.md'), 'utf8'), '# On server\n', 'the existing spec is untouched');
  await assert.rejects(methods['specs.create']({ projectPath, root: ws, slug: '../escape', files }), /Not a spec name/);
  await assert.rejects(methods['specs.create']({ projectPath, root: ws, slug: 'extra', files: { ...files, 'plan.md': '# P\n' } }), /only spec\.md and status\.json/);
  await assert.rejects(methods['specs.create']({ projectPath, root: ws, slug: 'extra', files: { 'spec.md': 42 } }), /only spec\.md and status\.json/);
  assert.equal(fs.existsSync(path.join(ws, '.frame', 'specs', 'extra')), false, 'nothing written for a refused call');
  await assert.rejects(methods['specs.create']({ projectPath, root: path.join(SANDBOX, 'home'), slug: 'x', files }), /not a workspace of this project/);
  write(path.join(projectPath, '.frame', 'config.json'), { settings: { gitSharing: 'local' } });
  await assert.rejects(methods['specs.create']({ projectPath, root: ws, slug: 'local-one', files }), /local mode/);
});
