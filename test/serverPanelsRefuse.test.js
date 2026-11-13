/**
 * Panel handlers on server roots (server-hardening T7, T10): file-tree
 * replies name their root and carry server errors; branch and worktree
 * mutations under a server root are refused, the worktree list is empty with
 * a note. The real handlers run against a fake ipcMain with the server
 * routing stubbed.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('node:module');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-panels-'));
process.env.HOME = SANDBOX;
const LOCAL = path.join(SANDBOX, 'local');
fs.mkdirSync(path.join(LOCAL, 'src'), { recursive: true });
fs.writeFileSync(path.join(LOCAL, 'src', 'a.js'), '');
const SERVER_ROOT = '/srv/ws/sage';

let serverUp = true;
const fakeServer = {
  isConnected: () => serverUp,
  getStatus: () => ({ state: serverUp ? 'connected' : 'reconnecting', host: 'box' }),
  on: () => () => {},
  call: async (method) => { if (method === 'files.tree') throw new Error('permission denied on the server'); return null; }
};
const fakeWorkspaces = { serverRoots: () => [{ root: SERVER_ROOT, id: 'srv-ws', host: 'box' }], serverLocation: () => null };

const MAIN = path.join(__dirname, '..', 'src', 'main');
const loadOriginal = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === 'electron') return { shell: { trashItem: async () => {} }, app: { getPath: () => SANDBOX, getVersion: () => '0.0.0', on() {} }, ipcMain: { on() {}, handle() {}, removeHandler() {} }, BrowserWindow: { getAllWindows: () => [] } };
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

const { IPC } = require('../src/shared/ipcChannels');
const handlers = {};
const ipcMain = { on: (ch, fn) => { handlers[ch] = fn; }, handle: (ch, fn) => { handlers[ch] = fn; }, removeHandler() {} };
require('../src/main/fileTree').setupIPC(ipcMain);
require('../src/main/gitBranchesManager').setupIPC(ipcMain);

function loadTree(root, ctx) {
  return new Promise((resolve) => {
    handlers[IPC.LOAD_FILE_TREE]({ sender: { isDestroyed: () => false, send: (ch, payload) => resolve(payload) } }, root, ctx);
  });
}

test('T7: a local tree reply names its root', async () => {
  const reply = await loadTree(LOCAL, { workspaceId: 'main' });
  assert.equal(reply.root, LOCAL);
  assert.ok(Array.isArray(reply.files) && reply.files.length > 0);
  assert.equal(reply.error || null, null);
});

test('T7: a server error reaches the tree as an error, not an empty tree', async () => {
  const reply = await loadTree(SERVER_ROOT, { workspaceId: 'srv-ws' });
  assert.equal(reply.root, SERVER_ROOT);
  assert.deepEqual(reply.files, []);
  assert.match(String(reply.error), /permission denied/);
});

test('T10: branch and worktree changes under a server root are refused; the worktree list is empty with a note', async () => {
  const ctx = { workspaceId: 'srv-ws' };
  for (const [ch, payload] of [
    [IPC.CREATE_GIT_BRANCH, { projectPath: SERVER_ROOT, branchName: 'x', ...ctx }],
    [IPC.DELETE_GIT_BRANCH, { projectPath: SERVER_ROOT, branchName: 'x', ...ctx }],
    [IPC.ADD_GIT_WORKTREE, { projectPath: SERVER_ROOT, worktreePath: '/tmp/x', branchName: 'x', ...ctx }],
    [IPC.REMOVE_GIT_WORKTREE, { projectPath: SERVER_ROOT, worktreePath: '/tmp/x', ...ctx }]
  ]) {
    const r = await handlers[ch]({}, payload);
    assert.match(String(r && r.error), /server workspace/i, `${ch} refused`);
  }
  const wt = await handlers[IPC.LOAD_GIT_WORKTREES]({}, SERVER_ROOT, ctx);
  assert.deepEqual(wt.worktrees, []);
  assert.match(String(wt.note), /server/i);
});
