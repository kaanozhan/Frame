const test = require('node:test');
const assert = require('node:assert');
const q = require('../src/shared/queueRules');

const task = (ref, extra = {}) => ({ kind: 'task', ref, title: `Task ${ref}`, status: 'pending', ...extra });
const spec = (ref, extra = {}) => ({ kind: 'spec', ref, title: `Spec ${ref}`, phase: 'specified', ...extra });

function withItems(...sources) {
  let queue = q.emptyQueue();
  sources.forEach((s, i) => { queue = q.add(queue, s, { id: `q${i + 1}`, now: 't' }).queue; });
  return queue;
}

test('empty queue defaults to parallel 9 and version 1', () => {
  assert.deepStrictEqual(q.emptyQueue(), { version: 1, parallel: 9, items: [] });
});

test('add appends a reference with full auto for specs', () => {
  const r = q.add(q.emptyQueue(), spec('work-queue'), { id: 'a', now: '2026-11-25' });
  assert.strictEqual(r.refused, undefined);
  assert.deepStrictEqual(r.queue.items.map((i) => [i.id, i.kind, i.ref, i.state, i.flowMode]), [['a', 'spec', 'work-queue', 'queued', 'full-auto']]);
  const t = q.add(r.queue, task('t1'), { id: 'b' });
  assert.strictEqual(t.queue.items.length, 2);
  assert.strictEqual('flowMode' in t.item, false);
});

test('add refuses duplicates, spec tasks, completed tasks and done specs', () => {
  const queue = withItems(task('t1'));
  assert.strictEqual(q.add(queue, task('t1'), { id: 'x' }).refused, 'duplicate');
  assert.strictEqual(q.add(queue, task('t2', { source: 'spec:foo:T01' }), { id: 'x' }).refused, 'spec-task');
  assert.strictEqual(q.add(queue, task('t3', { status: 'completed' }), { id: 'x' }).refused, 'completed');
  assert.strictEqual(q.add(queue, spec('s', { phase: 'done' }), { id: 'x' }).refused, 'spec-done');
  assert.strictEqual(q.add(queue, spec('s', { malformed: true }), { id: 'x' }).refused, 'malformed');
  assert.strictEqual(q.add(queue, task('t4'), {}).refused, 'malformed');
  assert.ok(q.REFUSAL_TEXT.duplicate);
});

test('a done item can be queued again', () => {
  let queue = withItems(task('t1'));
  queue = q.setState(queue, 'q1', 'done').queue;
  assert.strictEqual(q.add(queue, task('t1'), { id: 'q2' }).refused, undefined);
});

test('remove refuses a running item', () => {
  let queue = withItems(task('t1'), task('t2'));
  queue = q.setState(queue, 'q1', 'running', { terminalId: 'term-1' }).queue;
  assert.strictEqual(q.remove(queue, 'q1').refused, 'running');
  assert.deepStrictEqual(q.remove(queue, 'q2').queue.items.map((i) => i.id), ['q1']);
  assert.strictEqual(q.remove(queue, 'nope').refused, 'not-found');
});

test('reorder puts named ids first and keeps the rest', () => {
  const queue = withItems(task('a'), task('b'), task('c'), task('d'));
  assert.deepStrictEqual(q.reorder(queue, ['q3', 'q1', 'zzz', 'q3']).queue.items.map((i) => i.id), ['q3', 'q1', 'q2', 'q4']);
});

test('setState follows the transition table and stamps times', () => {
  let queue = withItems(task('a'));
  assert.strictEqual(q.setState(queue, 'q1', 'review').refused, 'bad-state');
  let r = q.setState(queue, 'q1', 'running', { terminalId: 'term-1', worktree: { path: '/w', branch: 'b' } }, { now: 'T1' });
  assert.strictEqual(r.item.startedAt, 'T1');
  assert.strictEqual(r.item.terminalId, 'term-1');
  r = q.setState(r.queue, 'q1', 'review', { note: 'ok' }, { now: 'T2' });
  assert.deepStrictEqual([r.item.state, r.item.terminalId, r.item.finishedAt, r.item.note, r.item.worktree.path], ['review', null, 'T2', 'ok', '/w']);
  r = q.setState(r.queue, 'q1', 'done', {}, { now: 'T3' });
  assert.strictEqual(r.item.state, 'done');
  assert.strictEqual(q.setState(r.queue, 'q1', 'running').refused, 'bad-state');
});

test('a queued item that cannot start goes straight to failed', () => {
  const queue = withItems(task('a'));
  const r = q.setState(queue, 'q1', 'failed', { note: 'no worktree' }, { now: 'T' });
  assert.deepStrictEqual([r.item.state, r.item.note, r.item.finishedAt], ['failed', 'no worktree', 'T']);
});

test('needs-you continues back to queued', () => {
  let queue = withItems(spec('s'));
  queue = q.setState(queue, 'q1', 'running', { terminalId: 't' }).queue;
  queue = q.setState(queue, 'q1', 'needs-you', { note: 'plan done' }).queue;
  const r = q.setState(queue, 'q1', 'queued');
  assert.deepStrictEqual([r.item.state, r.item.note], ['queued', null]);
});

test('setParallel clamps to 1..9', () => {
  assert.strictEqual(q.setParallel(q.emptyQueue(), 0).queue.parallel, 1);
  assert.strictEqual(q.setParallel(q.emptyQueue(), 20).queue.parallel, 9);
  assert.strictEqual(q.setParallel(q.emptyQueue(), '3').queue.parallel, 3);
});

test('setFlowMode only for specs that are not running', () => {
  let queue = withItems(spec('s'), task('t'));
  assert.strictEqual(q.setFlowMode(queue, 'q1', 'step-by-step').item.flowMode, 'step-by-step');
  assert.strictEqual(q.setFlowMode(queue, 'q2', 'step-by-step').refused, 'not-spec');
  queue = q.setState(queue, 'q1', 'running', { terminalId: 't' }).queue;
  assert.strictEqual(q.setFlowMode(queue, 'q1', 'full-auto').refused, 'running');
});

test('nextRunnable respects parallel, running items and free slots', () => {
  let queue = withItems(task('a'), task('b'), task('c'), task('d'), task('e'));
  assert.deepStrictEqual(q.nextRunnable(queue.items, { parallel: 3, freeSlots: 9 }).map((i) => i.id), ['q1', 'q2', 'q3']);
  queue = q.setState(queue, 'q1', 'running', { terminalId: 't1' }).queue;
  queue = q.setState(queue, 'q2', 'running', { terminalId: 't2' }).queue;
  queue = q.setState(queue, 'q3', 'running', { terminalId: 't3' }).queue;
  assert.deepStrictEqual(q.nextRunnable(queue.items, { parallel: 3, freeSlots: 9 }), []);
  queue = q.setState(queue, 'q1', 'review').queue;
  assert.deepStrictEqual(q.nextRunnable(queue.items, { parallel: 3, freeSlots: 9 }).map((i) => i.id), ['q4']);
  assert.deepStrictEqual(q.nextRunnable(queue.items, { parallel: 9, freeSlots: 1 }).map((i) => i.id), ['q4']);
  assert.deepStrictEqual(q.nextRunnable(queue.items, { parallel: 9, freeSlots: 0 }), []);
});

test('interrupted items are resumable and come first in queue order', () => {
  let queue = withItems(task('a'), task('b'));
  queue = q.setState(queue, 'q1', 'running', { terminalId: 'gone' }).queue;
  const r = q.markInterrupted(queue, new Set(['other']));
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.queue.items[0].state, 'interrupted');
  assert.deepStrictEqual(q.nextRunnable(r.queue.items, { parallel: 9, freeSlots: 9 }).map((i) => i.id), ['q1', 'q2']);
  assert.strictEqual(q.markInterrupted(r.queue, []).changed, false);
});

test('deriveMissing marks unfinished items whose source is gone', () => {
  let queue = withItems(task('a'), spec('s'), task('b'));
  queue = q.setState(queue, 'q3', 'done').queue;
  const shown = q.deriveMissing(queue.items, { taskIds: ['x'], specSlugs: new Set(['s']) });
  assert.deepStrictEqual(shown.map((i) => i.state), ['missing', 'queued', 'done']);
  assert.strictEqual(shown[0].storedState, 'queued');
  assert.deepStrictEqual(q.deriveMissing(queue.items, {}).map((i) => i.state), ['queued', 'queued', 'done']);
});

test('mergeQueues tags homes; homeOf routes by id', () => {
  const merged = q.mergeQueues([{ id: 'm1' }], [{ serverKey: 'k', serverProjectPath: '/srv/p', host: 'box', offline: true, items: [{ id: 's1' }] }]);
  assert.deepStrictEqual(merged.map((i) => [i.id, i.location, i.host || null, !!i.offline]), [['m1', 'mac', null, false], ['s1', 'server', 'box', true]]);
  assert.deepStrictEqual(q.homeOf('m1', merged), { location: 'mac' });
  assert.deepStrictEqual(q.homeOf('s1', merged), { location: 'server', serverKey: 'k', serverProjectPath: '/srv/p', host: 'box', offline: true });
  assert.strictEqual(q.homeOf('zz', merged), null);
});

test('worktreeKey uses slug or task id and avoids taken branches', () => {
  assert.strictEqual(q.worktreeKey({ kind: 'spec', ref: 'work-queue' }), 'work-queue');
  assert.strictEqual(q.worktreeKey({ kind: 'task', ref: 'task-ABC_1' }), 'task-abc-1');
  assert.strictEqual(q.worktreeKey({ kind: 'task', ref: '1700000000' }), 'task-1700000000');
  assert.strictEqual(q.worktreeKey({ kind: 'spec', ref: 'x' }, ['frame/queue/x', 'frame/queue/x-2']), 'x-3');
  assert.strictEqual(q.queueBranch('x'), 'frame/queue/x');
  assert.strictEqual(q.queueWorktreeRel('x'), '.frame/worktrees/queue-x');
});

test('startCommand: full auto → spec.auto, step → next phase, nothing left → null', () => {
  const full = { kind: 'spec', ref: 's', flowMode: 'full-auto' };
  const step = { kind: 'spec', ref: 's', flowMode: 'step-by-step' };
  assert.strictEqual(q.startCommand(full, 'planned'), 'spec.auto');
  assert.strictEqual(q.startCommand(step, 'specified'), 'spec.plan');
  assert.strictEqual(q.startCommand(step, 'planned'), 'spec.tasks');
  assert.strictEqual(q.startCommand(step, 'implementing'), 'spec.implement');
  assert.strictEqual(q.startCommand(full, 'done'), null);
  assert.strictEqual(q.startCommand({ kind: 'task', ref: 't' }, 'planned'), null);
});

test('normalizeQueue drops bad and duplicate items', () => {
  const n = q.normalizeQueue({ parallel: 'x', items: [{ id: 'a', kind: 'task', ref: 't', state: 'bogus' }, { id: 'a', kind: 'task', ref: 't2' }, { kind: 'spec' }, null] });
  assert.strictEqual(n.parallel, 9);
  assert.deepStrictEqual(n.items.map((i) => [i.id, i.state]), [['a', 'queued']]);
});
