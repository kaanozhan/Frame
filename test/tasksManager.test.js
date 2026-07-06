/**
 * tasksManager corruption-recovery tests (T02): corrupt tasks.json must no
 * longer silently disable CRUD or destroy recoverable data.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tasksManager = require('../src/main/tasksManager');
const { FRAME_FILES } = require('../src/shared/frameConstants');

let projectDir;
let tasksPath;

function writeTasksFile(tasks) {
  fs.writeFileSync(tasksPath, JSON.stringify({ version: '2.0', tasks }, null, 2), 'utf8');
}

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-tasks-'));
  tasksPath = path.join(projectDir, FRAME_FILES.TASKS);
  tasksManager.init(null); // no window — IPC pushes no-op
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('loadTasks returns null for a project without tasks.json', () => {
  assert.equal(tasksManager.loadTasks(projectDir), null);
});

test('loadTasks parses a valid file', () => {
  writeTasksFile([{ id: 't1', title: 'A', status: 'pending' }]);
  const data = tasksManager.loadTasks(projectDir);
  assert.equal(data.tasks.length, 1);
  assert.ok(!data.corrupt);
});

test('corrupt tasks.json with .bak: restores and keeps CRUD alive', () => {
  writeTasksFile([{ id: 't1', title: 'A', status: 'pending' }]);
  const added = tasksManager.addTask(projectDir, { title: 'B' }); // atomic save → creates .bak
  assert.ok(added, 'addTask works on a healthy file');

  fs.writeFileSync(tasksPath, '{"version":"2.0","tasks":[{"id":"t1"'); // torn write

  const data = tasksManager.loadTasks(projectDir);
  assert.ok(Array.isArray(data.tasks), 'recovered data is usable');
  assert.ok(data.tasks.some((t) => t.id === 't1'), 'pre-corruption task survives');
  assert.ok(!data.corrupt);
  const corrupt = fs.readdirSync(projectDir).filter((f) => f.includes('.corrupt-'));
  assert.equal(corrupt.length, 1, 'corrupt copy preserved');
});

test('corrupt tasks.json without .bak: flagged empty set, mutation cannot clobber', () => {
  fs.writeFileSync(tasksPath, '{"version":"2.0","tasks":[{"id":"only"'); // corrupt, never saved by us

  const data = tasksManager.loadTasks(projectDir);
  assert.deepEqual(data.tasks, []);
  assert.equal(data.corrupt, true, 'error state is visible, not a silent null');

  // CRUD is NOT dead (old behavior): a new task lands in a fresh file...
  const added = tasksManager.addTask(projectDir, { title: 'new task' });
  assert.ok(added);
  // ...and the corrupt original is still recoverable on disk.
  const corrupt = fs.readdirSync(projectDir).filter((f) => f.includes('.corrupt-'));
  assert.equal(corrupt.length, 1);

  // the corrupt flag is never persisted
  const onDisk = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
  assert.ok(!('corrupt' in onDisk));
  assert.equal(onDisk.tasks.length, 1);
});
