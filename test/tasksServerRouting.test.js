/**
 * The desktop side of tasks in server workspaces (server-tasks T04, T05):
 * tasksManager caches each server project's tasks, merges them into every
 * TASKS_DATA push, follows the servers, and sends each change to the task's
 * own home. Two fake Frame Servers stand in for serverConnection, and a fake
 * workspaceManager lists the project's server workspaces.
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('node:module');
const { EventEmitter } = require('events');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'frame-tasksrouting-')));
process.env.HOME = SANDBOX;

// ─── Fake servers ──────────────────────────────────────────────
// Each host keeps its projects' task files in memory, as a clone would.
const HOSTS = {};
function resetHosts() {
  HOSTS.box = { unsupported: false, refuse: false, projects: {
    '/srv/app': { tasksPath: '/srv/app/.frame/tasks.json', tasks: [
      { id: 'task-box-1', title: 'On box', status: 'pending' },
      { id: 'task-spec-merged-T01', title: 'Merged spec task (box copy)', status: 'in_progress' }
    ] }
  } };
  HOSTS.gpu = { unsupported: false, refuse: false, projects: {
    '/home/me/app': { tasksPath: '/home/me/app/.frame/tasks.json', tasks: [{ id: 'task-gpu-1', title: 'On gpu', status: 'pending' }] }
  } };
}
resetHosts();

function fakeLink(key, host) {
  return {
    key, host, up: true, calls: [],
    isConnected() { return this.up; },
    getStatus() { return { state: this.up ? 'connected' : 'reconnecting', host }; },
    async call(method, params) {
      this.calls.push({ method, params });
      if (!this.up) throw new Error(`Not connected to ${host}.`);
      const h = HOSTS[host];
      if (h.unsupported && method.startsWith('tasks.')) throw new Error(`Unknown method: ${method}`);
      if (h.refuse && method.startsWith('tasks.')) throw new Error('This project keeps Frame files out of git (local mode)…');
      const proj = h.projects[params.projectPath];
      if (method === 'tasks.list') return { tasks: proj.tasks.map((t) => ({ ...t })), tasksPath: proj.tasksPath };
      if (method === 'tasks.watch') return { watching: [params.projectPath] };
      if (method === 'tasks.add') {
        const task = { ...params.task, id: `task-new-${proj.tasks.length + 1}`, status: params.task.status || 'pending' };
        proj.tasks.push(task);
        return { task };
      }
      if (method === 'tasks.update') {
        const t = proj.tasks.find((x) => x.id === params.taskId);
        if (!t) throw new Error('No such task on the server, or it could not be saved.');
        Object.assign(t, params.updates);
        return { task: { ...t } };
      }
      if (method === 'tasks.delete') {
        const i = proj.tasks.findIndex((x) => x.id === params.taskId);
        if (i === -1) return { success: false };
        proj.tasks.splice(i, 1);
        return { success: true };
      }
      if (method === 'tasks.reorder') {
        const byId = new Map(proj.tasks.map((t) => [t.id, t]));
        proj.tasks = params.order.map((e) => byId.get(e.id)).filter(Boolean).concat(proj.tasks.filter((t) => !params.order.some((e) => e.id === t.id)));
        return { success: true };
      }
      throw new Error(`unexpected ${method}`);
    }
  };
}
const linkBox = fakeLink('kb', 'box');
const linkGpu = fakeLink('kg', 'gpu');
let saved = [linkBox, linkGpu];
const fakeServer = new EventEmitter();
Object.assign(fakeServer, {
  all: () => saved,
  of: (key) => saved.find((l) => l.key === key) || null,
  on(name, fn) { EventEmitter.prototype.on.call(this, name, fn); return () => this.removeListener(name, fn); }
});

// The project's server workspaces, as workspaceManager.serverRoots reports them.
let ROOTS = [];
const fakeWorkspaces = {
  serverRoots: () => ROOTS,
  serverLocation: (id) => {
    const r = ROOTS.find((x) => x.id === id);
    return r ? { projectPath: r.projectPath, serverProjectPath: r.serverProjectPath, path: r.root, host: r.host, serverKey: r.serverKey, name: r.id } : null;
  }
};

const MAIN = path.join(__dirname, '..', 'src', 'main');
const loadOriginal = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === 'electron') return { app: { getPath: () => SANDBOX, getVersion: () => '0.0.0', on() {} }, ipcMain: { on() {}, handle() {} }, BrowserWindow: { getAllWindows: () => [] } };
  if (request === '@aptabase/electron/main') return { initialize() {}, trackEvent() {} };
  if (request === 'posthog-node') return { PostHog: class { capture() {} shutdown() { return Promise.resolve(); } } };
  if (request.startsWith('.') && parent && parent.filename) {
    let resolved = null;
    try { resolved = Module._resolveFilename(request, parent); } catch (_) { resolved = null; }
    if (resolved === path.join(MAIN, 'serverConnection.js')) return fakeServer;
    if (resolved === path.join(MAIN, 'workspaceManager.js')) return fakeWorkspaces;
  }
  return loadOriginal.call(this, request, parent, ...rest);
};

const tasksManager = require('../src/main/tasksManager');
const { IPC } = require('../src/shared/ipcChannels');

// ─── The Mac project and the window ─────────────────────────────
const project = path.join(SANDBOX, 'app');
const macTasksPath = path.join(project, '.frame', 'tasks.json');
function resetMac() {
  fs.mkdirSync(path.dirname(macTasksPath), { recursive: true });
  fs.writeFileSync(path.join(project, '.frame', 'config.json'), '{}\n');
  fs.writeFileSync(macTasksPath, JSON.stringify({ project: 'app', version: '1.0', tasks: [
    { id: 'task-mac-1', title: 'On the Mac', status: 'pending' },
    { id: 'task-spec-merged-T01', title: 'Merged spec task', status: 'completed' }
  ], metadata: {} }, null, 2));
}
const sent = [];
const win = { isDestroyed: () => false, webContents: { send: (ch, payload) => sent.push([ch, payload]) } };
const handlers = {};
const ipc = { on: (ch, fn) => { handlers[ch] = fn; }, handle: (ch, fn) => { handlers[ch] = fn; } };
tasksManager.init(win);
tasksManager.setupIPC(ipc);
const replies = [];
const evt = { sender: { send: (ch, payload) => replies.push([ch, payload]) } };

const lastPush = () => {
  const all = [...sent, ...replies].filter(([ch]) => ch === IPC.TASKS_DATA);
  return all.length ? all[all.length - 1][1] : null;
};
const ids = (payload) => payload.tasks.tasks.map((t) => t.id);
const rootsFor = (...rows) => rows.map(([id, serverKey, host, serverProjectPath]) => ({ id, root: `${serverProjectPath}-ws/${id}`, host, serverKey, projectPath: project, serverProjectPath }));

beforeEach(() => {
  resetHosts();
  resetMac();
  tasksManager.resetServerTasksForTests();
  tasksManager.setProjectPath(project);
  for (const l of [linkBox, linkGpu]) { l.up = true; l.calls.length = 0; }
  saved = [linkBox, linkGpu];
  ROOTS = [];
  sent.length = 0;
  replies.length = 0;
});

// ─── T04: the merged push ───────────────────────────────────────

test('without server workspaces the push is the Mac\'s tasks as before, plus their file and no notes', () => {
  const p = tasksManager.tasksPayload(project, tasksManager.loadTasks(project));
  assert.deepEqual(ids(p), ['task-mac-1', 'task-spec-merged-T01']);
  assert.equal(p.tasksPath, macTasksPath);
  assert.deepEqual(p.serverNotes, []);
  assert.equal(p.tasks.project, 'app', 'the rest of the Mac\'s file rides along');
});

test('server tasks are merged, tagged with their home, one tasks.list per server project, and watched', async () => {
  ROOTS = rootsFor(['b1', 'kb', 'box', '/srv/app'], ['b2', 'kb', 'box', '/srv/app'], ['g1', 'kg', 'gpu', '/home/me/app']);
  await tasksManager.refreshServerTasks(project);
  const p = lastPush();
  assert.ok(p, 'pushed');
  assert.deepEqual(ids(p), ['task-mac-1', 'task-spec-merged-T01', 'task-box-1', 'task-gpu-1'], 'the Mac copy wins the duplicate');
  const onBox = p.tasks.tasks.find((t) => t.id === 'task-box-1');
  assert.deepEqual([onBox.location, onBox.host, onBox.serverKey, onBox.serverProjectPath, onBox.tasksPath, onBox.offline],
    ['server', 'box', 'kb', '/srv/app', '/srv/app/.frame/tasks.json', false]);
  assert.equal(linkBox.calls.filter((c) => c.method === 'tasks.list').length, 1, 'two workspaces, one server project, one list');
  assert.deepEqual(linkBox.calls.filter((c) => c.method === 'tasks.watch').map((c) => c.params), [{ projectPath: '/srv/app' }]);
  assert.deepEqual(p.serverNotes, []);
});

test('a dropped server keeps its tasks, tagged offline, with a note; a reconnect refreshes it', async () => {
  ROOTS = rootsFor(['b1', 'kb', 'box', '/srv/app'], ['g1', 'kg', 'gpu', '/home/me/app']);
  await tasksManager.refreshServerTasks(project);
  linkBox.up = false;
  fakeServer.emit('disconnected', {}, 'kb');
  let p = lastPush();
  assert.equal(p.tasks.tasks.find((t) => t.id === 'task-box-1').offline, true);
  assert.equal(p.tasks.tasks.find((t) => t.id === 'task-gpu-1').offline, false, 'the other server is untouched');
  assert.deepEqual(p.serverNotes, [{ host: 'box', kind: 'offline' }]);

  linkBox.up = true;
  HOSTS.box.projects['/srv/app'].tasks.push({ id: 'task-box-2', title: 'Added while away', status: 'pending' });
  fakeServer.emit('connected', {}, 'kb');
  await new Promise((r) => setTimeout(r, 20));
  p = lastPush();
  assert.equal(p.tasks.tasks.find((t) => t.id === 'task-box-1').offline, false);
  assert.ok(ids(p).includes('task-box-2'));
  assert.deepEqual(p.serverNotes, []);
});

test('a server that is down at first read is listed as offline with no tasks', async () => {
  ROOTS = rootsFor(['b1', 'kb', 'box', '/srv/app']);
  linkBox.up = false;
  await tasksManager.refreshServerTasks(project);
  const p = lastPush();
  assert.deepEqual(ids(p), ['task-mac-1', 'task-spec-merged-T01']);
  assert.deepEqual(p.serverNotes, [{ host: 'box', kind: 'offline' }]);
});

test('an older Frame Server gets the update note, not an error and not tasks', async () => {
  ROOTS = rootsFor(['b1', 'kb', 'box', '/srv/app'], ['g1', 'kg', 'gpu', '/home/me/app']);
  HOSTS.box.unsupported = true;
  await tasksManager.refreshServerTasks(project);
  const p = lastPush();
  assert.deepEqual(ids(p), ['task-mac-1', 'task-spec-merged-T01', 'task-gpu-1']);
  assert.deepEqual(p.serverNotes, [{ host: 'box', kind: 'update' }]);
});

test('a server that refuses (local mode there) lists nothing and leaves no note', async () => {
  ROOTS = rootsFor(['b1', 'kb', 'box', '/srv/app']);
  HOSTS.box.refuse = true;
  await tasksManager.refreshServerTasks(project);
  const p = lastPush();
  assert.deepEqual(ids(p), ['task-mac-1', 'task-spec-merged-T01']);
  assert.deepEqual(p.serverNotes, []);
});

test('tasks.changed refreshes only that server; a removed server or workspace leaves the list', async () => {
  ROOTS = rootsFor(['b1', 'kb', 'box', '/srv/app'], ['g1', 'kg', 'gpu', '/home/me/app']);
  await tasksManager.refreshServerTasks(project);
  linkBox.calls.length = 0;
  linkGpu.calls.length = 0;
  HOSTS.box.projects['/srv/app'].tasks[0].status = 'completed';
  fakeServer.emit('tasks.changed', { projectPath: '/srv/app' }, 'kb');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(lastPush().tasks.tasks.find((t) => t.id === 'task-box-1').status, 'completed', 'the change shows without a reload');
  assert.equal(linkGpu.calls.length, 0, 'gpu is not asked');

  linkBox.calls.length = 0;
  fakeServer.emit('tasks.changed', { projectPath: '/srv/other' }, 'kb');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(linkBox.calls.length, 0, 'another project\'s change is not ours');

  fakeServer.emit('removed', {}, 'kg');
  assert.ok(!ids(lastPush()).includes('task-gpu-1'), 'a removed server\'s tasks leave');

  ROOTS = rootsFor(['g1', 'kg', 'gpu', '/home/me/app']);
  await tasksManager.refreshServerTasks(project);
  assert.ok(!ids(lastPush()).includes('task-box-1'), 'box has no workspace of this project any more');
});

test('LOAD_TASKS replies at once with the merged list and refreshes the servers at most once in a burst', async () => {
  ROOTS = rootsFor(['b1', 'kb', 'box', '/srv/app']);
  await tasksManager.refreshServerTasks(project);
  linkBox.calls.length = 0;
  replies.length = 0;
  for (let i = 0; i < 5; i++) handlers[IPC.LOAD_TASKS](evt, project);
  assert.ok(ids(replies[0][1]).includes('task-box-1'), 'the reply is merged from the cache');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(linkBox.calls.filter((c) => c.method === 'tasks.list').length, 1, 'five surfaces opening, one refresh');
  tasksManager.stopWatching();
});

// ─── T05: each change goes to the task's home ───────────────────

const macFile = () => JSON.parse(fs.readFileSync(macTasksPath, 'utf8')).tasks;
const boxTasks = () => HOSTS.box.projects['/srv/app'].tasks;
async function withServers() {
  ROOTS = rootsFor(['b1', 'kb', 'box', '/srv/app'], ['g1', 'kg', 'gpu', '/home/me/app']);
  await tasksManager.refreshServerTasks(project);
  linkBox.calls.length = 0;
  linkGpu.calls.length = 0;
}
const changeCalls = (link) => link.calls.filter((c) => /^tasks\.(add|update|delete|reorder)$/.test(c.method));

test('an update goes to the Mac for a Mac task and to its server for a server task — never both', async () => {
  await withServers();
  let res = await tasksManager.routeUpdate(project, 'task-mac-1', { status: 'in_progress' });
  assert.equal(res.success, true);
  assert.equal(macFile().find((t) => t.id === 'task-mac-1').status, 'in_progress');
  assert.equal(changeCalls(linkBox).length + changeCalls(linkGpu).length, 0, 'no server was asked');

  const macBefore = fs.readFileSync(macTasksPath, 'utf8');
  res = await tasksManager.routeUpdate(project, 'task-box-1', { status: 'completed' });
  assert.equal(res.success, true, res.error);
  assert.deepEqual(changeCalls(linkBox).map((c) => [c.method, c.params]), [['tasks.update', { projectPath: '/srv/app', taskId: 'task-box-1', updates: { status: 'completed' } }]]);
  assert.equal(changeCalls(linkGpu).length, 0);
  assert.equal(boxTasks().find((t) => t.id === 'task-box-1').status, 'completed');
  assert.equal(fs.readFileSync(macTasksPath, 'utf8'), macBefore, 'the Mac\'s file is untouched');
  assert.equal(lastPush().tasks.tasks.find((t) => t.id === 'task-box-1').status, 'completed', 'the board shows it at once');
});

test('the duplicate id goes home to the Mac', async () => {
  await withServers();
  const res = await tasksManager.routeUpdate(project, 'task-spec-merged-T01', { status: 'pending' });
  assert.equal(res.success, true);
  assert.equal(macFile().find((t) => t.id === 'task-spec-merged-T01').status, 'pending');
  assert.equal(changeCalls(linkBox).length, 0);
});

test('a change to a down server\'s task is refused with its host named, and nothing is written anywhere', async () => {
  await withServers();
  linkBox.up = false;
  fakeServer.emit('disconnected', {}, 'kb');
  const macBefore = fs.readFileSync(macTasksPath, 'utf8');
  for (const res of [
    await tasksManager.routeUpdate(project, 'task-box-1', { status: 'completed' }),
    await tasksManager.routeDelete(project, 'task-box-1')
  ]) {
    assert.equal(res.success, false);
    assert.equal(res.error, 'box is offline — reconnect to change its tasks.');
  }
  assert.equal(changeCalls(linkBox).length, 0);
  assert.equal(changeCalls(linkGpu).length, 0, 'never another server');
  assert.equal(fs.readFileSync(macTasksPath, 'utf8'), macBefore, 'never the Mac');
});

test('a server error is reported, not retried on the Mac', async () => {
  await withServers();
  HOSTS.box.projects['/srv/app'].tasks = HOSTS.box.projects['/srv/app'].tasks.filter((t) => t.id !== 'task-box-1'); // gone on the server meanwhile
  const macBefore = fs.readFileSync(macTasksPath, 'utf8');
  const res = await tasksManager.routeUpdate(project, 'task-box-1', { status: 'completed' });
  assert.equal(res.success, false);
  assert.match(res.error, /^box: No such task/);
  assert.equal(fs.readFileSync(macTasksPath, 'utf8'), macBefore);
});

test('a delete goes to the task\'s home', async () => {
  await withServers();
  assert.deepEqual(await tasksManager.routeDelete(project, 'task-box-1'), { success: true });
  assert.ok(!boxTasks().some((t) => t.id === 'task-box-1'));
  assert.ok(macFile().some((t) => t.id === 'task-mac-1'));
  assert.deepEqual(await tasksManager.routeDelete(project, 'task-mac-1'), { success: true });
  assert.ok(!macFile().some((t) => t.id === 'task-mac-1'));
});

test('a reorder over the merged list is split: each home gets its own part, a down server\'s part is refused', async () => {
  await withServers();
  boxTasks().push({ id: 'task-box-2', title: 'Second on box', status: 'pending' });
  await tasksManager.refreshServerTasks(project);
  linkBox.calls.length = 0;
  let res = await tasksManager.routeReorder(project, [
    { id: 'task-box-2' }, { id: 'task-spec-merged-T01' }, { id: 'task-gpu-1' }, { id: 'task-box-1' }, { id: 'task-mac-1' }
  ]);
  assert.equal(res.success, true, res.error);
  assert.deepEqual(macFile().map((t) => t.id), ['task-spec-merged-T01', 'task-mac-1']);
  assert.deepEqual(boxTasks().map((t) => t.id), ['task-box-2', 'task-box-1', 'task-spec-merged-T01']);
  assert.deepEqual(changeCalls(linkGpu).map((c) => c.params.order.map((e) => e.id)), [['task-gpu-1']]);

  linkGpu.up = false;
  fakeServer.emit('disconnected', {}, 'kg');
  res = await tasksManager.routeReorder(project, [{ id: 'task-mac-1' }, { id: 'task-gpu-1' }, { id: 'task-spec-merged-T01' }]);
  assert.equal(res.success, false);
  assert.match(res.error, /gpu is offline/);
  assert.deepEqual(macFile().map((t) => t.id), ['task-mac-1', 'task-spec-merged-T01'], 'the Mac\'s part still applies');
});

test('an add lands where the selected workspace lives: its server, or the Mac', async () => {
  await withServers();
  const macBefore = fs.readFileSync(macTasksPath, 'utf8');
  let res = await tasksManager.routeAdd(project, { title: 'Made in a box workspace' }, 'b1');
  assert.equal(res.success, true, res.error);
  assert.ok(boxTasks().some((t) => t.title === 'Made in a box workspace'));
  assert.equal(fs.readFileSync(macTasksPath, 'utf8'), macBefore, 'not on the Mac');
  assert.ok(lastPush().tasks.tasks.some((t) => t.title === 'Made in a box workspace' && t.location === 'server' && t.host === 'box'));

  for (const workspaceId of [null, 'main', 'a-local-workspace']) {
    res = await tasksManager.routeAdd(project, { title: `On the Mac (${workspaceId})` }, workspaceId);
    assert.equal(res.success, true);
    assert.ok(macFile().some((t) => t.title === `On the Mac (${workspaceId})`));
  }

  linkBox.up = false;
  const n = boxTasks().length;
  res = await tasksManager.routeAdd(project, { title: 'While box is down' }, 'b1');
  assert.deepEqual(res, { success: false, error: 'box is offline — reconnect to change its tasks.' });
  assert.equal(boxTasks().length, n);
  assert.ok(!macFile().some((t) => t.title === 'While box is down'), 'never falls back to the Mac');
});

test('the IPC keeps its shape and carries the reason on a refusal', async () => {
  await withServers();
  linkBox.up = false;
  fakeServer.emit('disconnected', {}, 'kb');
  replies.length = 0;
  await handlers[IPC.UPDATE_TASK](evt, { projectPath: project, taskId: 'task-box-1', updates: { status: 'completed' } });
  const [ch, payload] = replies.find(([c]) => c === IPC.TASK_UPDATED);
  assert.equal(ch, IPC.TASK_UPDATED);
  assert.deepEqual({ action: payload.action, success: payload.success, error: payload.error }, { action: 'update', success: false, error: 'box is offline — reconnect to change its tasks.' });
  assert.ok(replies.some(([c]) => c === IPC.TASKS_DATA), 'the merged list still follows');
  tasksManager.stopWatching();
});
