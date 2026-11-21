/**
 * The task run prompt (tasks-list-view spec, T02 / S12 / S15).
 *
 * Pure by design: requiring it must not reach `electron` or the DOM.
 * Pinned: `missingFields` for every combination and the spec-task
 * exemption, the format step present only when a field is missing, the
 * acceptance-criteria line, the branch steps byte-identical to the builder
 * this replaced, and the completion line kept.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { READY_FIELDS, isSpecTask, missingFields, buildTaskPrompt } = require('../src/renderer/tasks/runPrompt');

// The builder as it stood in tasksPanel.js before this spec, kept verbatim
// as the reference for everything a ready task's prompt must not change.
function legacyBuildTaskPrompt(task, opts = {}) {
  let prompt = `Work on this task: ${task.title}`;
  if (task.description) prompt += `. ${task.description}`;
  if (task.priority === 'high') prompt += ` (High priority)`;

  if (opts.branchMode === 'new') {
    const branchStep = opts.newBranchName
      ? `create and switch to a new branch named "${opts.newBranchName}"`
      : `suggest an appropriate branch name based on this task, wait for my confirmation, and then create and switch to that branch`;

    prompt += `. Before starting, do the following in order:`
      + ` First, check for uncommitted changes on the current branch — if any exist, ask me what to do with them (commit, stash, or discard) and act on my decision before continuing.`
      + ` Then, ${branchStep}.`;
  }

  prompt += ` When the task is fully complete, update this task's status to "completed" in tasks.json (task id: ${task.id}).`;

  return prompt;
}

const BRANCH_OPTS = [
  {},
  { branchMode: 'current' },
  { branchMode: 'new' },
  { branchMode: 'new', newBranchName: 'feat/list-view' }
];

const ready = (extra = {}) => ({
  id: 'task-1', title: 'Add tiles', status: 'pending', priority: 'medium',
  description: 'Render tasks as tiles.', acceptanceCriteria: 'Tiles render in the grid', ...extra
});
const specTask = (extra = {}) => ({
  id: 'task-spec-x-T01', title: 'Spec work', description: '', source: 'spec:x:T01', priority: 'medium', ...extra
});

const UNCOMMITTED = 'check for uncommitted changes on the current branch — if any exist, ask me what to do with them (commit, stash, or discard) and act on my decision before continuing.';
const FORMAT_MARK = 'this task is not ready yet';

test('readiness reads description and acceptanceCriteria', () => {
  assert.deepEqual(READY_FIELDS, ['description', 'acceptanceCriteria']);
});

test('missingFields covers every combination, blank counts as missing', () => {
  assert.deepEqual(missingFields(ready()), []);
  assert.deepEqual(missingFields(ready({ description: '' })), ['description']);
  assert.deepEqual(missingFields(ready({ acceptanceCriteria: undefined })), ['acceptanceCriteria']);
  assert.deepEqual(missingFields(ready({ description: '   ', acceptanceCriteria: '\n' })), ['description', 'acceptanceCriteria']);
  assert.deepEqual(missingFields({ id: 'bare', title: 'Bare' }), ['description', 'acceptanceCriteria']);
});

test('a spec task is always ready, whatever its fields', () => {
  assert.equal(isSpecTask(specTask()), true);
  assert.deepEqual(missingFields(specTask()), []);
  assert.ok(!buildTaskPrompt(specTask()).includes(FORMAT_MARK));
});

test('a ready task starts directly: no format step', () => {
  for (const opts of BRANCH_OPTS) {
    assert.ok(!buildTaskPrompt(ready(), opts).includes(FORMAT_MARK), JSON.stringify(opts));
  }
});

test('a ready task carries its acceptance criteria, and is otherwise the legacy prompt', () => {
  for (const opts of BRANCH_OPTS) {
    const task = ready({ priority: 'high' });
    const legacy = legacyBuildTaskPrompt(task, opts);
    const head = 'Work on this task: Add tiles. Render tasks as tiles. (High priority)';
    assert.ok(legacy.startsWith(head));
    const expected = head + '. Acceptance criteria: Tiles render in the grid' + legacy.slice(head.length);
    assert.equal(buildTaskPrompt(task, opts), expected, JSON.stringify(opts));
  }
});

test('branch steps are byte-identical to the legacy builder when no format step applies', () => {
  for (const opts of BRANCH_OPTS) {
    assert.equal(buildTaskPrompt(specTask(), opts), legacyBuildTaskPrompt(specTask(), opts), JSON.stringify(opts));
    assert.equal(
      buildTaskPrompt(specTask({ description: 'Do it.', priority: 'high' }), opts),
      legacyBuildTaskPrompt(specTask({ description: 'Do it.', priority: 'high' }), opts)
    );
  }
});

test('a task missing a field opens with the format step', () => {
  const p = buildTaskPrompt(ready({ acceptanceCriteria: '' }));
  assert.ok(p.includes('. Before starting, do the following in order: First, this task is not ready yet: its `acceptanceCriteria` is empty.'));
  assert.ok(p.includes('Read this task in tasks.json (task id: task-1) and the code it concerns, then write it into that entry.'));
  assert.ok(p.includes('Never add or change `userRequest`.'));
  assert.ok(p.includes('Show me the acceptance criteria and wait for my confirmation before continuing.'));
  assert.ok(!p.includes('Acceptance criteria:'), 'no criteria line before they exist');
});

test('the format step names both fields when both are missing', () => {
  const p = buildTaskPrompt({ id: 'task-2', title: 'Quick one', userRequest: 'make it faster' });
  assert.ok(p.includes('its `description` and `acceptanceCriteria` are empty.'));
  assert.ok(p.includes('then write them into that entry.'));
});

test('a task with criteria but no description shows the criteria and still gets the step', () => {
  const p = buildTaskPrompt(ready({ description: '' }));
  assert.ok(p.startsWith('Work on this task: Add tiles. Acceptance criteria: Tiles render in the grid. Before starting'));
  assert.ok(p.includes('its `description` is empty.'));
});

test('the format step runs before the branch steps, which keep their text', () => {
  const p = buildTaskPrompt(ready({ description: '' }), { branchMode: 'new', newBranchName: 'feat/x' });
  const format = p.indexOf('First, this task is not ready yet');
  const uncommitted = p.indexOf(`Then, ${UNCOMMITTED}`);
  const branch = p.indexOf('Then, create and switch to a new branch named "feat/x".');
  assert.ok(format > 0 && uncommitted > format && branch > uncommitted, p);
});

test('the completion line closes every prompt', () => {
  const tail = ' When the task is fully complete, update this task\'s status to "completed" in tasks.json (task id: task-1).';
  for (const opts of BRANCH_OPTS) {
    assert.ok(buildTaskPrompt(ready(), opts).endsWith(tail));
    assert.ok(buildTaskPrompt(ready({ description: '' }), opts).endsWith(tail));
  }
});

test('tasksPath names the tasks file in the completion line and the format step', () => {
  const tasksPath = '/repo/.frame/tasks.json';
  const tail = ` When the task is fully complete, update this task's status to "completed" in ${tasksPath} (task id: task-1).`
    + ' Use that exact file, not a tasks.json inside the working folder.';
  for (const opts of BRANCH_OPTS) {
    assert.ok(buildTaskPrompt(ready(), { ...opts, tasksPath }).endsWith(tail), JSON.stringify(opts));
  }
  const p = buildTaskPrompt(ready({ acceptanceCriteria: '' }), { tasksPath });
  assert.ok(p.includes(`Read this task in ${tasksPath} (task id: task-1) and the code it concerns`), p);
  assert.ok(!p.includes(' in tasks.json '), p);
});

test('without tasksPath, or with a blank one, the prompt is unchanged', () => {
  for (const opts of BRANCH_OPTS) {
    for (const task of [ready(), ready({ description: '' }), specTask()]) {
      const plain = buildTaskPrompt(task, opts);
      assert.equal(buildTaskPrompt(task, { ...opts, tasksPath: '' }), plain);
      assert.equal(buildTaskPrompt(task, { ...opts, tasksPath: '   ' }), plain);
      assert.equal(buildTaskPrompt(task, { ...opts, tasksPath: undefined }), plain);
    }
    assert.equal(buildTaskPrompt(specTask(), opts), legacyBuildTaskPrompt(specTask(), opts));
  }
});
