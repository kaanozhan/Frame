/**
 * derivePhase tests — what the file-based fallback may and may not decide.
 *
 * The fallback tops out at `tasks_generated`: `implementing` and `done` are
 * reached through task statuses or the AI's own status.json write, never
 * through which files exist. So the question these tests pin is what happens
 * when the task data is unavailable — because "could not read the tasks" and
 * "this spec has no tasks" reach derivePhase as the same empty list, and only
 * the second is evidence.
 *
 * Unavailable data used to fall through to the fallback, which then demoted
 * every spec above its ceiling. Migration moving tasks.json under a running
 * Frame walked 24 specs back to `tasks_generated` that way on 2026-08-19; the
 * phases returned only because the file did.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Same stubs as specTasksSync.test.js: telemetry.js pulls in
// @aptabase/electron/main and userSettings.js pulls in electron, and CI runs
// this suite with no node_modules. Nothing here emits telemetry or reaches
// app.getPath.
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
const { FRAME_DIR } = require('../src/shared/frameConstants');

const SLUG = 'sample-spec';

let projectDir;

/** Lay down the spec artifacts named, in ladder order. */
function writeArtifacts(...names) {
  const dir = path.join(projectDir, FRAME_DIR, 'specs', SLUG);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of names) fs.writeFileSync(path.join(dir, name), '# stub\n', 'utf8');
}

/** A readable tasks.json holding this spec's tasks at the given statuses. */
function tasksData(...statuses) {
  return {
    version: '2.0',
    tasks: statuses.map((status, i) => ({
      id: `task-spec-${SLUG}-T0${i + 1}`,
      source: `spec:${SLUG}:T0${i + 1}`,
      status
    }))
  };
}

/** What loadTasks hands back when the file and its .bak are both unparseable. */
const CORRUPT_RESET = { version: '2.0', tasks: [], corrupt: true };

function derive(currentPhase, data) {
  return specManager.derivePhase(projectDir, SLUG, currentPhase, data);
}

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-derive-phase-'));
  specManager.init(null); // no window — IPC pushes no-op
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

// ── unknown task data must not demote a task-driven phase ──

test('a done spec holds its phase when the task data is unreadable', () => {
  writeArtifacts('spec.md', 'plan.md', 'tasks.md');

  assert.equal(derive('done', null), 'done', 'null tasks data is missing evidence, not evidence of no tasks');
  assert.equal(derive('done', CORRUPT_RESET), 'done', 'a corrupt reset is unreadable, not empty');
});

test('an implementing spec holds its phase when the task data is unreadable', () => {
  writeArtifacts('spec.md', 'plan.md', 'tasks.md');

  assert.equal(derive('implementing', null), 'implementing');
  assert.equal(derive('implementing', CORRUPT_RESET), 'implementing');
});

// ── ...while the fallback keeps working everywhere it is competent ──

test('the fallback still advances the phases it can actually derive', () => {
  writeArtifacts('spec.md');
  assert.equal(derive('draft', null), 'specified', 'a project with no tasks.json yet still advances');

  writeArtifacts('spec.md', 'plan.md');
  assert.equal(derive('specified', null), 'planned');

  writeArtifacts('spec.md', 'plan.md', 'tasks.md');
  assert.equal(derive('planned', null), 'tasks_generated', 'the ceiling is reachable, just not passable');
});

test('a spec with no artifacts at all reads as draft', () => {
  assert.equal(derive('draft', null), 'draft');
});

// ── known task data decides as it always has ──

test('task statuses drive implementing and done when the data is readable', () => {
  writeArtifacts('spec.md', 'plan.md', 'tasks.md');

  assert.equal(derive('tasks_generated', tasksData('completed', 'completed')), 'done');
  assert.equal(derive('tasks_generated', tasksData('completed', 'in_progress')), 'implementing');
  assert.equal(derive('done', tasksData('completed', 'pending')), 'implementing', 'a task moved back rewinds the phase');
  assert.equal(derive('implementing', tasksData('pending', 'pending')), 'tasks_generated', 'nothing started falls through to the files');
});

test('readable task data that holds no tasks for this spec still demotes', () => {
  writeArtifacts('spec.md', 'plan.md', 'tasks.md');
  const otherSpecOnly = { version: '2.0', tasks: [{ id: 'task-spec-other-T01', source: 'spec:other:T01', status: 'completed' }] };

  assert.equal(
    derive('done', otherSpecOnly),
    'tasks_generated',
    'the guard covers missing evidence only — a readable list saying "no tasks" is left to decide'
  );
});
