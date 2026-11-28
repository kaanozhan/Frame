/**
 * Desktop specManager with server workspaces (server-specs spec).
 *
 * The server connection and workspaceManager are stubbed; the real
 * specManager runs against a temp project with one local spec.
 *
 * T05: the server spec cache — listed on refresh, merged into listSpecs with
 * the workspace's host, refreshed on specs.changed, offline on disconnect.
 * T06: GET_SPEC / READ_SPEC_REPORT / UPDATE_SPEC_STATUS route a server spec
 * to Frame Server; rename and delete refuse it.
 * T07: BUILD_SPEC_COMMAND_FILE stages on the server for a server workspace.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('node:module');
const { EventEmitter } = require('events');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-specsrv-'));
process.env.HOME = SANDBOX;

const serverCalls = [];
const remote = {}; // root → specs list the fake server answers
const fakeServer = new EventEmitter();
// One saved server (multi-server-connections): the fake is both the registry
// (of / all) and that server's link (key kbox).
Object.assign(fakeServer, {
  key: 'kbox',
  host: 'box',
  of(key) { return key === 'kbox' ? this : null; },
  all() { return [this]; },
  connected: true,
  isConnected() { return this.connected; },
  getStatus() { return { state: this.connected ? 'connected' : 'reconnecting', host: 'box' }; },
  on(name, fn) { EventEmitter.prototype.on.call(this, name, fn); return () => this.removeListener(name, fn); },
  async call(method, params) {
    serverCalls.push({ method, params });
    if (!this.connected) throw new Error('box is offline');
    if (method === 'specs.list') return remote[params.root] || [];
    if (method === 'specs.get') return { status: { slug: params.slug, phase: 'planned' }, spec: '# from the server\n', planReportPath: '/srv/plan-report.html', workspace: null };
    if (method === 'specs.report') return { success: true, html: '<html>server</html>', path: '/srv/plan-report.html' };
    if (method === 'specs.status') return { status: { slug: params.slug, ...params.partial } };
    if (method === 'specs.stage') return { success: true, relPath: `.frame/runtime/prompts/${params.slug || 'spec.new__x'}__${params.command}.md`, instruction: 'Read it.', launchFlags: [] };
    return null;
  }
});
const PROJECT = path.join(SANDBOX, 'project');
const serverRows = [{ id: 'srv-ws-1', root: '/home/u/frame/workspaces/project/teal', host: 'box', serverKey: 'kbox', projectPath: PROJECT, serverProjectPath: '/home/u/frame/projects/project' }];
const fakeWorkspaces = {
  serverRoots: () => serverRows,
  serverLocation: (id) => { const r = serverRows.find((x) => x.id === id); return r ? { path: r.root, host: r.host, serverKey: r.serverKey, name: 'teal', projectPath: r.projectPath, serverProjectPath: r.serverProjectPath } : null; }
};

const MAIN = path.join(__dirname, '..', 'src', 'main');
const STUBS = {
  '@aptabase/electron/main': { initialize() {}, trackEvent() {} },
  'posthog-node': { PostHog: class { capture() {} captureException() {} identify() {} shutdown() { return Promise.resolve(); } } },
  electron: { app: { getPath: () => SANDBOX, getVersion: () => '0.0.0', on() {} }, ipcMain: { handle() {}, on() {} }, BrowserWindow: { getAllWindows: () => [] } }
};
const loadOriginal = Module._load;
Module._load = function (request, parent, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('.') && parent && parent.filename) {
    let resolved = null;
    try { resolved = Module._resolveFilename(request, parent); } catch (_) { resolved = null; }
    if (resolved === path.join(MAIN, 'serverConnection.js')) return fakeServer;
    if (resolved === path.join(MAIN, 'workspaceManager.js')) return fakeWorkspaces;
  }
  return loadOriginal.call(this, request, parent, ...rest);
};

const specManager = require('../src/main/specManager');
const { IPC } = require('../src/shared/ipcChannels');

const pushes = [];
// Open fs watchers would keep the test process alive.
after(() => specManager.stopWatching());
specManager.init({ isDestroyed: () => false, webContents: { send: (ch, payload) => { if (ch === IPC.SPEC_DATA) pushes.push(payload); } } });

function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n');
}
write(path.join(PROJECT, '.frame', 'specs', 'local-one', 'status.json'), { slug: 'local-one', title: 'Local one', phase: 'specified', generated_task_ids: [] });
write(path.join(PROJECT, '.frame', 'tasks.json'), { tasks: [] });
write(path.join(PROJECT, '.frame', 'config.json'), { version: '1.0', name: 'project' });

const ROOT = serverRows[0].root;
const serverSpec = (phase) => ({ slug: 'on-server', title: 'On server', phase, task_count: 2, completed_count: 1, workspace: null });

// ─── T05: cache and merge ────────────────────────────────────

test('T05: a server workspace\'s specs are listed once, tagged with the workspace and its host', async () => {
  remote[ROOT] = [serverSpec('planned')];
  await specManager.refreshServerSpecs(PROJECT);
  const listCall = serverCalls.find((c) => c.method === 'specs.list');
  assert.deepEqual(listCall.params, { projectPath: '/home/u/frame/projects/project', root: ROOT });
  const watchCall = serverCalls.find((c) => c.method === 'specs.watch');
  assert.deepEqual(watchCall.params, { projectPath: '/home/u/frame/projects/project', roots: [ROOT] });
  const specs = specManager.listSpecs(PROJECT);
  assert.deepEqual(specs.map((s) => s.slug).sort(), ['local-one', 'on-server']);
  const remoteSpec = specs.find((s) => s.slug === 'on-server');
  // serverKey + serverProjectPath: where a server spec is queued (work-queue).
  assert.deepEqual(remoteSpec.workspace, { id: 'srv-ws-1', name: 'teal', branch: null, root: ROOT, host: 'box', offline: false, serverKey: 'kbox', serverProjectPath: '/home/u/frame/projects/project' });
  assert.equal(remoteSpec.completed_count, 1);
  assert.equal(specs.find((s) => s.slug === 'local-one').workspace, null);
});

test('T05: specs.changed re-lists only that root and pushes the new phase', async () => {
  specManager.startWatching(PROJECT);
  serverCalls.length = 0;
  pushes.length = 0;
  remote[ROOT] = [serverSpec('tasks_generated')];
  fakeServer.emit('specs.changed', { root: ROOT });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(serverCalls.filter((c) => c.method === 'specs.list').map((c) => c.params.root), [ROOT]);
  const last = pushes[pushes.length - 1];
  assert.equal(last.specs.find((s) => s.slug === 'on-server').phase, 'tasks_generated');
});

test('T05: on disconnect the server specs stay listed, tagged offline, and come back on connect', async () => {
  pushes.length = 0;
  fakeServer.connected = false;
  fakeServer.emit('disconnected', {});
  let spec = specManager.listSpecs(PROJECT).find((s) => s.slug === 'on-server');
  assert.equal(spec.workspace.offline, true);
  assert.ok(pushes.length >= 1, 'the offline tag is pushed');
  fakeServer.connected = true;
  fakeServer.emit('connected', { host: 'box' });
  await new Promise((r) => setTimeout(r, 50));
  spec = specManager.listSpecs(PROJECT).find((s) => s.slug === 'on-server');
  assert.equal(spec.workspace.offline, false);
});

test('T05: an older Frame Server (Unknown method) lists nothing instead of failing', async () => {
  const saved = fakeServer.call;
  fakeServer.call = async (method) => { if (method === 'specs.list') throw new Error('Unknown method specs.list'); return null; };
  try {
    await specManager.refreshServerSpecs(PROJECT);
    assert.deepEqual(specManager.listSpecs(PROJECT).map((s) => s.slug), ['local-one']);
  } finally {
    fakeServer.call = saved;
  }
});

// ─── T06: routed handlers ────────────────────────────────────

test('T06: a server spec is read, reported and updated through Frame Server', async () => {
  remote[ROOT] = [serverSpec('planned')];
  await specManager.refreshServerSpecs(PROJECT);
  serverCalls.length = 0;
  const full = await specManager.handleGetSpec(PROJECT, 'on-server');
  assert.equal(full.spec, '# from the server\n');
  assert.equal(full.workspace.host, 'box', 'tagged with its server workspace');
  const call = serverCalls.find((c) => c.method === 'specs.get');
  assert.deepEqual(call.params, { projectPath: '/home/u/frame/projects/project', root: ROOT, slug: 'on-server' });
  const report = await specManager.handleReadSpecReport(PROJECT, 'on-server', 'plan');
  assert.equal(report.html, '<html>server</html>');
  const upd = await specManager.handleUpdateSpecStatus(PROJECT, 'on-server', { implement_mode: 'guided' });
  assert.equal(upd.status.implement_mode, 'guided');
  assert.deepEqual(serverCalls.find((c) => c.method === 'specs.status').params.partial, { implement_mode: 'guided' });
});

test('T06: a local spec still reads from disk', async () => {
  serverCalls.length = 0;
  const local = await specManager.handleGetSpec(PROJECT, 'local-one');
  assert.equal(local.status.title, 'Local one');
  assert.equal(serverCalls.filter((c) => c.method.startsWith('specs.')).length, 0);
});

test('T06: offline, a server spec answers { offline: host } and its report and status say so', async () => {
  fakeServer.connected = false;
  fakeServer.emit('disconnected', {});
  try {
    const full = await specManager.handleGetSpec(PROJECT, 'on-server');
    assert.equal(full.offline, 'box');
    assert.equal(full.status.title, 'On server', 'the last known title');
    assert.equal(full.status.phase, 'planned', 'the last known phase');
    assert.match(full.spec, /box is offline\*\* — reconnect to open this spec/);
    assert.equal(full.plan, null, 'no cached content');
    const report = await specManager.handleReadSpecReport(PROJECT, 'on-server', 'plan');
    assert.equal(report.success, false);
    assert.match(report.error, /box is offline/);
    const upd = await specManager.handleUpdateSpecStatus(PROJECT, 'on-server', { phase: 'done' });
    assert.match(upd.error, /box is offline/);
  } finally {
    fakeServer.connected = true;
    fakeServer.emit('connected', { host: 'box' });
    await new Promise((r) => setTimeout(r, 50));
  }
});

test('T06: renaming or deleting a server spec is refused, and no local copy is touched in its place', () => {
  const r = specManager.renameSpec(PROJECT, 'on-server', { title: 'New' });
  assert.match(r.error, /server workspace comes in a later update/);
  write(path.join(PROJECT, '.frame', 'specs', 'on-server', 'status.json'), { slug: 'on-server', title: 'Main copy', phase: 'done', generated_task_ids: [] });
  assert.equal(specManager.deleteSpec(PROJECT, 'on-server'), false);
  assert.ok(fs.existsSync(path.join(PROJECT, '.frame', 'specs', 'on-server', 'status.json')), 'the main copy is still there');
  fs.rmSync(path.join(PROJECT, '.frame', 'specs', 'on-server'), { recursive: true, force: true });
});

// ─── T07: staging on the server ──────────────────────────────

test('T07: a new spec in a selected server workspace is staged by Frame Server, not on this disk', async () => {
  serverCalls.length = 0;
  const r = await specManager.handleBuildSpecCommandFile({ projectPath: PROJECT, slug: null, command: 'spec.new', aiTool: 'claude-code', description: 'Make it', root: ROOT, workspaceId: 'srv-ws-1' });
  assert.equal(r.success, true, r.error);
  const call = serverCalls.find((c) => c.method === 'specs.stage');
  assert.deepEqual(call.params, { projectPath: '/home/u/frame/projects/project', root: ROOT, slug: null, command: 'spec.new', aiTool: 'claude-code', description: 'Make it' });
  assert.equal(fs.existsSync(ROOT), false, 'nothing was written under the server path on this machine');
  assert.ok(serverCalls.some((c) => c.method === 'specs.list' && c.params.root === ROOT), 'the workspace is re-listed so the new spec shows up');
});

test('T07: a command for a server spec is staged on the server even with main selected', async () => {
  remote[ROOT] = [serverSpec('planned')];
  await specManager.refreshServerSpecs(PROJECT);
  serverCalls.length = 0;
  const r = await specManager.handleBuildSpecCommandFile({ projectPath: PROJECT, slug: 'on-server', command: 'spec.tasks', aiTool: 'claude-code' });
  assert.equal(r.success, true, r.error);
  assert.equal(serverCalls.find((c) => c.method === 'specs.stage').params.slug, 'on-server');
});

test('T07: a local spec is still staged locally', async () => {
  serverCalls.length = 0;
  const r = await specManager.handleBuildSpecCommandFile({ projectPath: PROJECT, slug: 'local-one', command: 'spec.plan', aiTool: 'claude-code' });
  assert.equal(r.success, true, r.error);
  assert.ok(fs.existsSync(path.join(PROJECT, r.relPath)));
  assert.equal(serverCalls.filter((c) => c.method === 'specs.stage').length, 0);
});

test('T07: an older Frame Server is told to update; offline fails before anything is dispatched', async () => {
  const saved = fakeServer.call;
  fakeServer.call = async (method, params) => {
    if (method === 'specs.stage') throw new Error('Unknown method specs.stage');
    return saved.call(fakeServer, method, params);
  };
  try {
    const old = await specManager.handleBuildSpecCommandFile({ projectPath: PROJECT, slug: null, command: 'spec.new', workspaceId: 'srv-ws-1' });
    assert.equal(old.success, false);
    assert.match(old.error, /Update Frame Server to run specs on this server/);
  } finally {
    fakeServer.call = saved;
  }
  fakeServer.connected = false;
  try {
    serverCalls.length = 0;
    const off = await specManager.handleBuildSpecCommandFile({ projectPath: PROJECT, slug: null, command: 'spec.new', workspaceId: 'srv-ws-1' });
    assert.equal(off.success, false);
    assert.match(off.error, /box is offline/);
    assert.equal(serverCalls.filter((c) => c.method === 'specs.stage').length, 0);
  } finally {
    fakeServer.connected = true;
  }
});

test('T07: a local-mode project is refused on the desktop, since its server clone carries no Frame config', async () => {
  const cfg = path.join(PROJECT, '.frame', 'config.json');
  const saved = fs.readFileSync(cfg, 'utf8');
  write(cfg, { version: '1.0', name: 'project', settings: { gitSharing: 'local' } });
  try {
    serverCalls.length = 0;
    const r = await specManager.handleBuildSpecCommandFile({ projectPath: PROJECT, slug: null, command: 'spec.new', workspaceId: 'srv-ws-1' });
    assert.equal(r.success, false);
    assert.match(r.error, /local mode/);
    assert.equal(serverCalls.filter((c) => c.method === 'specs.stage').length, 0, 'the server is never asked');
  } finally {
    fs.writeFileSync(cfg, saved);
  }
});
