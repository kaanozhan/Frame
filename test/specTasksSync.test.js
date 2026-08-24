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

// specManager reaches two packages transitively: telemetry.js requires
// @aptabase/electron/main, and userSettings.js requires electron. CI runs this
// suite with no node_modules on purpose (see .github/workflows/ci.yml), so both
// are stubbed before specManager loads. Neither is exercised here —
// syncTasksFromMarkdown emits no telemetry, and app.getPath is only reached
// from userSettings.init(), which nothing here calls.
const Module = require('node:module');
const EXTERNAL_STUBS = {
  '@aptabase/electron/main': { initialize() {}, trackEvent() {} },
  electron: { app: {}, ipcMain: { handle() {}, on() {} } }
};
const loadOriginal = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(EXTERNAL_STUBS, request)) {
    return EXTERNAL_STUBS[request];
  }
  return loadOriginal.call(this, request, ...rest);
};

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
  fs.mkdirSync(path.join(projectDir, FRAME_DIR), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, FRAME_DIR, FRAME_FILES.TASKS),
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

test('a spec is never walked back when the task data cannot be read', () => {
  // An older Frame opening a migrated repository reads the pre-`.frame/`
  // tasks.json, finds nothing, and used to derive the phase from files alone —
  // which walked every finished spec in this repository from `done` back to
  // `tasks_generated`, rewriting 21 status.json files nobody asked it to touch.
  writeStatus();
  writeTasksMd(NON_ASCENDING);
  fs.writeFileSync(path.join(specDir(), 'spec.md'), '# Sample spec\n', 'utf8');
  fs.writeFileSync(path.join(specDir(), 'plan.md'), '# Plan\n', 'utf8');

  for (const phase of ['done', 'implementing']) {
    const statusPath = path.join(specDir(), 'status.json');
    const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    fs.writeFileSync(statusPath, JSON.stringify({ ...status, phase }, null, 2), 'utf8');

    assert.equal(specManager.derivePhase(projectDir, SLUG, phase, null), phase, `${phase} survives null`);
    assert.equal(specManager.derivePhase(projectDir, SLUG, phase, undefined), phase, `${phase} survives undefined`);

    specManager.reconcilePhase(projectDir, SLUG, null);
    assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).phase, phase, 'status.json untouched');
  }

  // Real task data still drives the transition it is there to drive.
  specManager.syncTasksFromMarkdown(projectDir, SLUG);
  const data = tasksManager.loadTasks(projectDir);
  assert.equal(specManager.derivePhase(projectDir, SLUG, 'done', data), 'tasks_generated', 'pending tasks still rewind');
});

test('a spec is never walked back when its recorded tasks are gone from tasks.json', () => {
  // A corrupt tasks.json is not reported as unreadable: tasksManager replaces
  // it with a fresh empty one and hands back `{ tasks: [], corrupt: true }`,
  // and the next open reads that empty file as plain valid data. Both look
  // like "this spec has no tasks" and used to walk `done` back — permanently,
  // because the empty replacement is on disk from then on.
  writeStatus();
  writeTasksMd(NON_ASCENDING);
  fs.writeFileSync(path.join(specDir(), 'spec.md'), '# Sample spec\n', 'utf8');

  const statusPath = path.join(specDir(), 'status.json');
  const recorded = { ...JSON.parse(fs.readFileSync(statusPath, 'utf8')), phase: 'done', generated_task_ids: ['task-a', 'task-b'] };
  fs.writeFileSync(statusPath, JSON.stringify(recorded, null, 2), 'utf8');

  for (const data of [{ version: '2.0', tasks: [], corrupt: true }, { version: '2.0', tasks: [] }, {}]) {
    assert.equal(
      specManager.derivePhase(projectDir, SLUG, 'done', data),
      'done',
      `done survives ${JSON.stringify(data)}`
    );
    specManager.reconcilePhase(projectDir, SLUG, data);
    assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).phase, 'done', 'status.json untouched');
  }

  // A regenerate that legitimately ends with no tasks clears the record, and
  // then the file-based fallback is the right answer again.
  fs.writeFileSync(statusPath, JSON.stringify({ ...recorded, generated_task_ids: [] }, null, 2), 'utf8');
  assert.equal(
    specManager.derivePhase(projectDir, SLUG, 'done', { version: '2.0', tasks: [] }),
    'tasks_generated',
    'no recorded ids → files decide'
  );
});
