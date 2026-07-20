/**
 * tasks.md → tasks.json sync tests (deep-spec-tasks T07).
 *
 * The report pass may insert new work into an existing list. It does so by
 * allocating the next unused number rather than renumbering, so a regenerated
 * tasks.md is ordered by implementation order while its IDs are not ascending.
 * These tests pin the two properties that makes safe:
 *
 *   - parseTasksMarkdown is order-agnostic — it yields every entry in file
 *     order, whatever the numbers do.
 *   - re-syncing an unchanged list is a no-op — no task is added, none is
 *     updated, and user-set status survives.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const specManager = require('../src/main/specManager');
const tasksManager = require('../src/main/tasksManager');
const { FRAME_DIR, FRAME_FILES } = require('../src/shared/frameConstants');

const SLUG = 'sample-spec';

// A regenerated list: implementation order top to bottom, IDs out of sequence
// because T05 and T06 were allocated after T03 and T04 already existed.
const NON_ASCENDING = `# Tasks — Sample spec

- T01 · Expose the report path from getSpec
- T02 · Stage the report template on dispatch
- T05 · Handle a missing report without failing
- T03 · Add the View Report button
- T06 · Cover the non-ascending case
- T04 · Restyle the report template
`;

let projectDir;

function specDir() {
  return path.join(projectDir, FRAME_DIR, 'specs', SLUG);
}

function writeTasksMd(content) {
  fs.mkdirSync(specDir(), { recursive: true });
  fs.writeFileSync(path.join(specDir(), 'tasks.md'), content, 'utf8');
}

function writeStatus() {
  fs.mkdirSync(specDir(), { recursive: true });
  fs.writeFileSync(
    path.join(specDir(), 'status.json'),
    JSON.stringify({
      slug: SLUG,
      title: 'Sample spec',
      phase: 'tasks_generated',
      generated_task_ids: []
    }, null, 2),
    'utf8'
  );
}

function readSpecTasks() {
  const data = tasksManager.loadTasks(projectDir);
  return data.tasks.filter(t => t.source && t.source.startsWith(`spec:${SLUG}:`));
}

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-spec-sync-'));
  fs.writeFileSync(
    path.join(projectDir, FRAME_FILES.TASKS),
    JSON.stringify({ version: '2.0', tasks: [] }, null, 2),
    'utf8'
  );
  specManager.init(null); // no window — IPC pushes no-op
  tasksManager.init(null);
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('parseTasksMarkdown yields every entry of a non-ascending list in file order', () => {
  const parsed = specManager.parseTasksMarkdown(NON_ASCENDING);

  assert.equal(parsed.length, 6, 'no entry is dropped for being out of sequence');
  assert.deepEqual(
    parsed.map(p => p.taskId),
    ['T01', 'T02', 'T05', 'T03', 'T06', 'T04'],
    'file order is preserved rather than sorted by ID'
  );
  assert.equal(parsed[2].description, 'Handle a missing report without failing');
});

test('syncTasksFromMarkdown imports a non-ascending list intact', () => {
  writeStatus();
  writeTasksMd(NON_ASCENDING);

  const result = specManager.syncTasksFromMarkdown(projectDir, SLUG);

  assert.equal(result.added, 6);
  assert.equal(result.updated, 0);
  assert.deepEqual(
    readSpecTasks().map(t => t.source),
    [
      `spec:${SLUG}:T01`, `spec:${SLUG}:T02`, `spec:${SLUG}:T05`,
      `spec:${SLUG}:T03`, `spec:${SLUG}:T06`, `spec:${SLUG}:T04`
    ]
  );
});

test('re-syncing an unchanged list adds and updates nothing', () => {
  writeStatus();
  writeTasksMd(NON_ASCENDING);
  specManager.syncTasksFromMarkdown(projectDir, SLUG);

  const result = specManager.syncTasksFromMarkdown(projectDir, SLUG);

  assert.equal(result.added, 0, 'no task is re-imported');
  assert.equal(result.updated, 0, 'no title is rewritten');
  assert.equal(result.unchanged, 6);
  assert.equal(readSpecTasks().length, 6, 'no duplicates accumulate');
});

test('re-syncing preserves user-set status on every task', () => {
  writeStatus();
  writeTasksMd(NON_ASCENDING);
  specManager.syncTasksFromMarkdown(projectDir, SLUG);

  // The user works through part of the list in the Tasks panel.
  const data = tasksManager.loadTasks(projectDir);
  data.tasks.find(t => t.source === `spec:${SLUG}:T05`).status = 'completed';
  data.tasks.find(t => t.source === `spec:${SLUG}:T03`).status = 'in_progress';
  tasksManager.saveTasks(projectDir, data);

  specManager.syncTasksFromMarkdown(projectDir, SLUG);

  const after = readSpecTasks();
  assert.equal(after.find(t => t.source === `spec:${SLUG}:T05`).status, 'completed');
  assert.equal(after.find(t => t.source === `spec:${SLUG}:T03`).status, 'in_progress');
  assert.equal(after.find(t => t.source === `spec:${SLUG}:T01`).status, 'pending');
});

test('appending new work leaves existing tasks untouched', () => {
  writeStatus();
  writeTasksMd(NON_ASCENDING);
  specManager.syncTasksFromMarkdown(projectDir, SLUG);

  const data = tasksManager.loadTasks(projectDir);
  data.tasks.find(t => t.source === `spec:${SLUG}:T05`).status = 'completed';
  tasksManager.saveTasks(projectDir, data);

  // The report pass inserts T07 in implementation order — nothing renumbers.
  writeTasksMd(NON_ASCENDING.replace(
    '- T03 · Add the View Report button\n',
    '- T03 · Add the View Report button\n- T07 · Close the coverage gap\n'
  ));
  const result = specManager.syncTasksFromMarkdown(projectDir, SLUG);

  assert.equal(result.added, 1, 'only the new work is imported');
  assert.equal(result.updated, 0, 'no existing title is rewritten');
  assert.equal(
    readSpecTasks().find(t => t.source === `spec:${SLUG}:T05`).status,
    'completed',
    'the completed task still describes the work it was completed for'
  );
});
