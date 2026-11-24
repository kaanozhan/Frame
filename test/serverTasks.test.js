/**
 * Frame Server's tasks methods (server-tasks T02): a server project's task
 * state lives in the clone's `.frame/tasks.json`, and only there. Runs Frame
 * Server's real methods on projects received by bundle, as
 * serverSpecs.test.js does.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'frame-srvtasks-')));
process.env.HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(process.env.HOME, { recursive: true });
process.env.FRAME_SERVER_PROJECTS = path.join(SANDBOX, 'projects');
process.env.FRAME_SERVER_HOME = path.join(SANDBOX, 'server-home');
process.env.GIT_CONFIG_NOSYSTEM = '1';
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();

const shim = require('../src/server/electronShim');
const handle = shim.install({ home: path.join(SANDBOX, 'server-home'), version: '0.0.0' });
const methods = {};
const events = [];
const register = (m) => Object.assign(methods, m);
require('../src/server/projects').setup({ shim: handle, registerMethods: register, broadcast() {} });
const specsPart = require('../src/server/specs').setup({ shim: handle, registerMethods: register, broadcast() {} });
const tasksPart = require('../src/server/tasks').setup({ shim: handle, registerMethods: register, broadcast: (...a) => events.push(a) });
const { LOCAL_MODE, NO_FRAME } = require('../src/server/tasks');

test.after(() => {
  specsPart.idle();
  if (tasksPart.idle) tasksPart.idle();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
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

const fileTasks = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.frame', 'tasks.json'), 'utf8')).tasks;

test('tasks.list returns the clone\'s tasks and its tasks.json by absolute path', async () => {
  const { projectPath } = await receive();
  const res = await methods['tasks.list']({ projectPath });
  assert.deepEqual(res.tasks.map((t) => t.id), ['task-a', 'task-b']);
  assert.equal(res.tasksPath, path.join(projectPath, '.frame', 'tasks.json'));
  assert.ok(path.isAbsolute(res.tasksPath));
});

test('add, update, delete and reorder change only the clone\'s tasks.json', async () => {
  const { local, projectPath } = await receive();
  const macBefore = fs.readFileSync(path.join(local, '.frame', 'tasks.json'), 'utf8');

  const { task } = await methods['tasks.add']({ projectPath, task: { title: 'Added on the server', status: 'pending' } });
  assert.ok(task && task.id, 'the new task gets an id');
  assert.ok(fileTasks(projectPath).some((t) => t.id === task.id));

  const upd = await methods['tasks.update']({ projectPath, taskId: 'task-a', updates: { status: 'completed' } });
  assert.equal(upd.task.status, 'completed');
  assert.equal(fileTasks(projectPath).find((t) => t.id === 'task-a').status, 'completed');

  assert.deepEqual(await methods['tasks.reorder']({ projectPath, order: [{ id: task.id }, { id: 'task-b' }, { id: 'task-a' }] }), { success: true });
  assert.deepEqual(fileTasks(projectPath).map((t) => t.id), [task.id, 'task-b', 'task-a']);

  assert.deepEqual(await methods['tasks.delete']({ projectPath, taskId: 'task-b' }), { success: true });
  assert.equal(fileTasks(projectPath).some((t) => t.id === 'task-b'), false);
  assert.deepEqual(await methods['tasks.delete']({ projectPath, taskId: 'task-b' }), { success: false }, 'deleting it again finds nothing');
  await assert.rejects(methods['tasks.update']({ projectPath, taskId: 'nope', updates: {} }), /No such task/);

  assert.equal(fs.readFileSync(path.join(local, '.frame', 'tasks.json'), 'utf8'), macBefore, 'the Mac\'s file never changes');
});

test('a server spec\'s tasks.md, once synced, is listed as the clone\'s tasks', async () => {
  const { projectPath } = await receive();
  const { workspace } = await methods['workspaces.create']({ projectPath, from: 'new' });
  const dir = path.join(workspace.path, '.frame', 'specs', 'on-server');
  write(path.join(dir, 'status.json'), { slug: 'on-server', title: 'On server', phase: 'tasks_generated', generated_task_ids: [] });
  write(path.join(dir, 'spec.md'), '# On server\n');
  write(path.join(dir, 'tasks.md'), '# Tasks\n\n- T01 · First\n- T02 · Second\n');
  await methods['specs.list']({ projectPath, root: workspace.path }); // the sync /spec.tasks relies on
  const res = await methods['tasks.list']({ projectPath });
  assert.ok(res.tasks.some((t) => t.id === 'task-spec-on-server-T01'), JSON.stringify(res.tasks.map((t) => t.id)));
  assert.ok(res.tasks.some((t) => t.id === 'task-spec-on-server-T02'));
  assert.equal(git(['status', '--porcelain', '--', '.frame/tasks.json'], workspace.path), '', 'the workspace\'s branch carries no task state');
});

test('only a project on the server is accepted', async () => {
  await assert.rejects(methods['tasks.list']({ projectPath: path.join(SANDBOX, 'elsewhere') }), /not on the server/);
  await assert.rejects(methods['tasks.list']({}), /not on the server/);
  const { projectPath } = await receive();
  await assert.rejects(methods['tasks.update']({ projectPath, taskId: '', updates: {} }), /Missing task id/);
  await assert.rejects(methods['tasks.reorder']({ projectPath, order: 'x' }), /Missing order/);
});

test('a project without Frame lists nothing and takes no change — no .frame is written', async () => {
  const { projectPath } = await receive({ frame: false });
  assert.deepEqual(await methods['tasks.list']({ projectPath }), { tasks: [], tasksPath: null });
  await assert.rejects(methods['tasks.add']({ projectPath, task: { title: 'x' } }), new RegExp(NO_FRAME.slice(0, 30)));
  assert.equal(fs.existsSync(path.join(projectPath, '.frame')), false);
});

test('a project in local sharing mode is refused', async () => {
  const { projectPath } = await receive({ mode: 'local' });
  await assert.rejects(methods['tasks.list']({ projectPath }), new RegExp(LOCAL_MODE.slice(0, 30).replace(/[()]/g, '\\$&')));
  await assert.rejects(methods['tasks.add']({ projectPath, task: { title: 'x' } }), /local mode/);
});
