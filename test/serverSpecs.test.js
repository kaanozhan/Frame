/**
 * Specs in server workspaces (server-specs spec).
 *
 * T01: specManager's per-checkout readers — the same readers scoped to one
 * checkout root, with task state read from a separate tasks project (on the
 * server: the worktree, and the server clone's tasks.json).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('node:module');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-srvspecs-'));
process.env.HOME = SANDBOX;

const STUBS = {
  '@aptabase/electron/main': { initialize() {}, trackEvent() {} },
  'posthog-node': { PostHog: class { capture() {} captureException() {} identify() {} shutdown() { return Promise.resolve(); } } },
  electron: { app: { getPath: () => SANDBOX, getVersion: () => '0.0.0', on() {} }, ipcMain: { handle() {}, on() {} }, BrowserWindow: { getAllWindows: () => [] } }
};
const loadOriginal = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return loadOriginal.call(this, request, ...rest);
};

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
