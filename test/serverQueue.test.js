/**
 * Frame Server's queue methods (work-queue T04): a server project's queue
 * lives in the clone's `.frame/queue.json`, machine-local, and only there.
 * Runs Frame Server's real methods on projects received by bundle, as
 * serverTasks.test.js does.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'frame-srvqueue-')));
process.env.HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(process.env.HOME, { recursive: true });
process.env.FRAME_SERVER_PROJECTS = path.join(SANDBOX, 'projects');
process.env.FRAME_SERVER_HOME = path.join(SANDBOX, 'server-home');
process.env.GIT_CONFIG_NOSYSTEM = '1';
// As serverWorkspaceTooling.test.js (#232): git 2.47+ auto-maintenance runs
// detached after clone and commit and was still writing when the sandbox was
// removed on CI (ENOTEMPTY). Every git child inherits this env.
Object.assign(process.env, {
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'maintenance.auto', GIT_CONFIG_VALUE_0: 'false',
  GIT_CONFIG_KEY_1: 'gc.auto', GIT_CONFIG_VALUE_1: '0'
});
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();

const shim = require('../src/server/electronShim');
const handle = shim.install({ home: path.join(SANDBOX, 'server-home'), version: '0.0.0' });
const methods = {};
const events = [];
const register = (m) => Object.assign(methods, m);
require('../src/server/projects').setup({ shim: handle, registerMethods: register, broadcast() {} });
const queuePart = require('../src/server/queue').setup({ shim: handle, registerMethods: register, broadcast: (...a) => events.push(a) });
const { LOCAL_MODE, NO_FRAME } = require('../src/server/queue');

test.after(async () => {
  queuePart.idle();
  // Workspace actions start git-state refreshes without awaiting them; let
  // them finish before the sandbox goes (#232), and retry the removal.
  await require('../src/main/workspaceGitState').settled();
  fs.rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n');
}

const seedTasks = () => ({ project: 'app', version: '1.0', tasks: [
  { id: 'task-a', title: 'First', status: 'pending', createdAt: '2026-11-24T00:00:00Z', updatedAt: '2026-11-24T00:00:00Z' },
  { id: 'task-b', title: 'Second', status: 'pending', createdAt: '2026-11-24T00:00:00Z', updatedAt: '2026-11-24T00:00:00Z' }
], metadata: {} });

let seq = 0;
/** A project on "the Mac" received by the server. `frame`: a Frame project; `mode`: its gitSharing. */
async function receive({ frame = true, mode = null } = {}) {
  const local = path.join(SANDBOX, `local-${++seq}`);
  git(['init', '-q', '-b', 'main', local]);
  write(path.join(local, 'a.txt'), 'one\n');
  if (frame) {
    write(path.join(local, '.frame', 'config.json'), mode ? { settings: { gitSharing: mode } } : {});
    write(path.join(local, '.frame', 'tasks.json'), seedTasks());
    // Every Frame project ignores .frame/runtime/ (the managed block), where the queue lives.
    write(path.join(local, '.frame', '.gitignore'), '# managed by Frame — machine-local; edit outside this block\nruntime/\n# end managed by Frame\n');
  }
  git(['add', '.'], local);
  git(['commit', '-qm', 'first'], local);
  const root = git(['rev-list', '--max-parents=0', 'HEAD'], local);
  const tmp = path.join(SANDBOX, 'server-home', 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const bundle = path.join(tmp, `receive-${seq}.bundle`);
  git(['bundle', 'create', '-q', bundle, 'HEAD', '--branches', '--tags'], local);
  const { projectPath } = await methods['projects.receive']({ bundlePath: bundle, originUrl: null, root, name: `proj-${seq}` });
  return { local, projectPath };
}

const task = (ref) => ({ kind: 'task', ref, title: ref, status: 'pending' });
const fileQueue = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.frame', 'runtime', 'queue.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('add, reorder, set, parallel and remove change only the clone\'s queue.json', async () => {
  const { local, projectPath } = await receive();
  assert.deepEqual((await methods['queue.list']({ projectPath })).queue.items, []);
  const a = (await methods['queue.add']({ projectPath, source: task('task-a') })).item;
  const b = (await methods['queue.add']({ projectPath, source: { kind: 'spec', ref: 'some-spec', title: 'S', phase: 'planned' } })).item;
  assert.equal(b.flowMode, 'full-auto');
  await assert.rejects(methods['queue.add']({ projectPath, source: task('task-a') }), /Already in the queue/);
  assert.deepEqual(await methods['queue.reorder']({ projectPath, ids: [b.id] }), { ok: true });
  assert.deepEqual(fileQueue(projectPath).items.map((i) => i.id), [b.id, a.id]);
  assert.equal((await methods['queue.set']({ projectPath, itemId: b.id, action: 'flowMode', mode: 'step-by-step' })).item.flowMode, 'step-by-step');
  assert.equal((await methods['queue.set']({ projectPath, itemId: a.id, action: 'done' })).item.state, 'done');
  await assert.rejects(methods['queue.set']({ projectPath, itemId: a.id, action: 'nope' }), /Unknown action/);
  assert.deepEqual(await methods['queue.parallel']({ projectPath, parallel: 3 }), { parallel: 3 });
  assert.deepEqual(await methods['queue.remove']({ projectPath, itemId: a.id }), { ok: true });
  assert.deepEqual((await methods['queue.list']({ projectPath })).queue.items.map((i) => i.id), [b.id]);
  assert.equal(fs.existsSync(path.join(local, '.frame', 'runtime', 'queue.json')), false, 'the Mac never gets the server\'s queue');
  assert.equal(git(['status', '--porcelain', '--', '.frame/runtime/queue.json'], projectPath), '', 'queue.json never shows as a change in the clone');
});

test('only a project on the server is accepted', async () => {
  await assert.rejects(methods['queue.list']({ projectPath: path.join(SANDBOX, 'elsewhere') }), /not on the server/);
  const { projectPath } = await receive();
  await assert.rejects(methods['queue.reorder']({ projectPath, ids: 'x' }), /Missing order/);
});

test('a project without Frame lists an empty queue and takes no change — no .frame is written', async () => {
  const { projectPath } = await receive({ frame: false });
  assert.deepEqual((await methods['queue.list']({ projectPath })).queue.items, []);
  await assert.rejects(methods['queue.add']({ projectPath, source: task('x') }), new RegExp(NO_FRAME.slice(0, 30)));
  assert.equal(fs.existsSync(path.join(projectPath, '.frame')), false);
});

test('a project in local sharing mode is refused', async () => {
  const { projectPath } = await receive({ mode: 'local' });
  await assert.rejects(methods['queue.list']({ projectPath }), /local mode/);
  assert.ok(LOCAL_MODE.includes('local mode'));
});

test('queue.watch pushes a debounced queue.changed when queue.json changes', async () => {
  const { projectPath } = await receive();
  await methods['queue.watch']({ projectPath });
  events.length = 0;
  await methods['queue.add']({ projectPath, source: task('task-a') });
  await methods['queue.add']({ projectPath, source: task('task-b') });
  const until = Date.now() + 3000;
  while (Date.now() < until && !events.some((e) => e[0] === 'queue.changed')) await sleep(25);
  await sleep(450);
  const changed = events.filter((e) => e[0] === 'queue.changed');
  assert.ok(changed.length >= 1, 'a change is pushed');
  assert.ok(changed.length <= 2, `debounced (${changed.length})`);
  assert.deepEqual(changed[0][1], { projectPath });
  await methods['queue.unwatch']();
  events.length = 0;
  await methods['queue.add']({ projectPath, source: task('task-c') });
  await sleep(450);
  assert.equal(events.filter((e) => e[0] === 'queue.changed').length, 0, 'no events after unwatch');
});
