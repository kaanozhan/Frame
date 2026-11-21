/**
 * cloudDone tests — the pure core of reporting a started brief's parts to
 * Frame Cloud: what to send, when a record is finished, and when a completion
 * is due. Runs with Node's built-in runner: `npm test` (node --test test/).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const done = require('../src/main/cloud/cloudDone');
const copy = require('../src/renderer/cloudBriefsCopy');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);
const STARTED_AT = '2026-10-01T10:00:00.000Z';
const MERGED = { mergedAt: '2026-11-01T10:00:00.000Z', mergedBase: 'main' };

/** A started, Active brief with `parts`. */
function brief(parts, extra = {}) {
  return { id: 'b1', number: 3, kind: 'work', status: 'active', startedAt: STARTED_AT, targetBranch: 'main', parts, ...extra };
}

/** A live part linked to a record, with nothing reported yet. */
function part(id, extra = {}) {
  return {
    id, shape: 'spec', recordRef: `ref-${id}`,
    branch: null, completionSha: null, mergedAt: null, mergedBase: null, droppedAt: null, dropReason: null,
    ...extra,
  };
}

/** A `begun(number, partId)` over `{ partId: entry }`. */
const begunFrom = (entries = {}) => (number, partId) => (number === 3 ? entries[partId] || null : null);

// ─── plan ─────────────────────────────────────────────────────

test('plan reads only Active briefs and their live, unmerged parts with a ref', () => {
  const local = new Set(['feat/a', 'feat/b', 'feat/c']);
  const parts = [part('p1', { branch: 'feat/a' })];
  const briefs = [
    brief(parts),
    brief(parts, { id: 'b2', number: 4, status: 'backlog', startedAt: null }),
    brief(parts, { id: 'b3', number: 5, status: 'done' }),
    brief(parts, { id: 'b4', number: 6, status: 'closed' }),
    brief(null, { id: 'b5', number: 7 }),
    brief([part('p2', { recordRef: null, branch: 'feat/b' }), part('p3', { branch: 'feat/c' })], { id: 'b6', number: 8 }),
  ];
  const { completions } = done.plan({ briefs, begun: begunFrom(), localBranches: local });
  assert.deepEqual(completions.map((c) => [c.id, c.partId]), [['b1', 'p1'], ['b6', 'p3']]);
  assert.deepEqual(completions[0], { id: 'b1', number: 3, partId: 'p1', ref: 'ref-p1', shape: 'spec', branch: 'feat/a', stored: null });
});

test('plan leaves out a dropped part and a merged one, but keeps a part merged into an old target', () => {
  const local = new Set(['feat/a', 'feat/b', 'feat/c']);
  const parts = [
    part('dropped', { branch: 'feat/a', droppedAt: '2026-11-02T10:00:00.000Z', dropReason: 'Not needed' }),
    part('merged', { branch: 'feat/b', ...MERGED }),
    part('old', { branch: 'feat/c', mergedAt: MERGED.mergedAt, mergedBase: 'develop' }),
  ];
  const { branches, completions } = done.plan({
    briefs: [brief(parts)],
    begun: begunFrom({ dropped: { branch: 'feat/a', baseSha: SHA_A }, merged: { branch: 'feat/b', baseSha: SHA_A } }),
    localBranches: local,
  });
  assert.deepEqual(completions.map((c) => c.partId), ['old']);
  assert.deepEqual(branches, []);
});

test('plan sends a branch only while the cloud has none and this machine\'s entry has its base commit', () => {
  const local = new Set(['feat/p1', 'feat/p2', 'feat/p3']);
  const parts = [
    part('p1'),
    part('p2'),
    part('p3', { branch: 'feat/someone-else' }),
  ];
  const { branches } = done.plan({
    briefs: [brief(parts)],
    begun: begunFrom({
      p1: { branch: 'feat/p1', baseSha: SHA_A },
      p2: { branch: 'feat/p2' }, // begun before this feature: no base commit
      p3: { branch: 'feat/p3', baseSha: SHA_B }, // the cloud already has another machine's branch
    }),
    localBranches: local,
  });
  assert.deepEqual(branches, [{ id: 'b1', number: 3, partId: 'p1', branch: 'feat/p1', baseSha: SHA_A }]);
});

test('plan sends a begun branch even when this folder no longer has it', () => {
  const { branches, completions } = done.plan({
    briefs: [brief([part('p1')])],
    begun: begunFrom({ p1: { branch: 'feat/gone', baseSha: SHA_A } }),
    localBranches: new Set(['main']),
  });
  assert.deepEqual(branches.map((b) => b.branch), ['feat/gone']);
  assert.deepEqual(completions, []);
});

test('plan reads the cloud\'s branch first, and the begun branch for older parts', () => {
  const local = new Set(['feat/cloud', 'feat/mine', 'feat/old']);
  const parts = [
    part('p1', { branch: 'feat/cloud', completionSha: SHA_C }),
    part('p2'),
    part('p3', { branch: 'feat/not-here' }),
  ];
  const { completions } = done.plan({
    briefs: [brief(parts)],
    begun: begunFrom({ p1: { branch: 'feat/mine', baseSha: SHA_A }, p2: { branch: 'feat/old' }, p3: { branch: 'feat/mine' } }),
    localBranches: local,
  });
  assert.deepEqual(completions.map((c) => [c.partId, c.branch, c.stored]), [
    ['p1', 'feat/cloud', SHA_C],
    ['p2', 'feat/old', null],
    ['p3', 'feat/mine', null],
  ]);
});

test('plan yields nothing for a branch this folder lacks', () => {
  const { branches, completions } = done.plan({
    briefs: [brief([part('p1', { branch: 'feat/theirs' }), part('p2')])],
    begun: begunFrom(),
    localBranches: new Set(['main']),
  });
  assert.deepEqual(branches, []);
  assert.deepEqual(completions, []);
});

test('plan survives missing inputs', () => {
  assert.deepEqual(done.plan(), { branches: [], completions: [] });
  assert.deepEqual(done.plan({ briefs: [brief([part('p1', { branch: 'feat/a' })])] }), { branches: [], completions: [] });
});

// ─── isFinished ───────────────────────────────────────────────

const row = (id, source, status) => ({ id, source, status });

test('isFinished: a spec part is finished when every one of its tasks is completed', () => {
  const tasks = {
    tasks: [
      row('t1', 'spec:login:T01', 'completed'),
      row('t2', 'spec:login:T02', 'completed'),
      row('t3', 'spec:login-flow:T01', 'pending'),
      row('t4', null, 'pending'),
    ],
  };
  assert.equal(done.isFinished({ shape: 'spec', ref: 'login', tasks }), true);
  assert.equal(done.isFinished({ shape: 'spec', ref: 'login', tasks: tasks.tasks }), true);
});

test('isFinished: a spec part with one pending task, or none at all, is not finished', () => {
  const tasks = { tasks: [row('t1', 'spec:login:T01', 'completed'), row('t2', 'spec:login:T02', 'pending')] };
  assert.equal(done.isFinished({ shape: 'spec', ref: 'login', tasks }), false);
  assert.equal(done.isFinished({ shape: 'spec', ref: 'login', tasks: { tasks: [row('t3', 'spec:other:T01', 'completed')] } }), false);
  assert.equal(done.isFinished({ shape: 'spec', ref: 'login', tasks: { tasks: [] } }), false);
  assert.equal(done.isFinished({ shape: 'spec', ref: 'login', tasks: null }), false);
});

test('isFinished: a task part is finished when its row is completed', () => {
  const tasks = { tasks: [row('task-a', '', 'completed'), row('task-b', '', 'in_progress')] };
  assert.equal(done.isFinished({ shape: 'task', ref: 'task-a', tasks }), true);
  assert.equal(done.isFinished({ shape: 'task', ref: 'task-b', tasks }), false);
  assert.equal(done.isFinished({ shape: 'task', ref: 'task-missing', tasks }), false);
  assert.equal(done.isFinished({ shape: 'epic', ref: 'task-a', tasks }), false);
  assert.equal(done.isFinished({ shape: 'task', ref: '', tasks }), false);
});

// ─── completionDue ────────────────────────────────────────────

test('completionDue: nothing stored is due', () => {
  assert.equal(done.completionDue({ stored: null, tip: SHA_A }), true);
});

test('completionDue: the tip itself stored is not due', () => {
  assert.equal(done.completionDue({ stored: SHA_A, tip: SHA_A, storedKnown: true, tipAtOrBeforeStored: true }), false);
});

test('completionDue: a stored commit at or after the tip is not due', () => {
  assert.equal(done.completionDue({ stored: SHA_B, tip: SHA_A, storedKnown: true, tipAtOrBeforeStored: true }), false);
});

test('completionDue: a stored commit this repository does not know is not due', () => {
  assert.equal(done.completionDue({ stored: SHA_B, tip: SHA_A, storedKnown: false, tipAtOrBeforeStored: false }), false);
});

test('completionDue: a tip that moved on, or a rebased tip, is due', () => {
  // Later commits: the stored commit is behind the tip.
  assert.equal(done.completionDue({ stored: SHA_B, tip: SHA_A, storedKnown: true, tipAtOrBeforeStored: false }), true);
  // Rebased: the old stored commit is still known here but is not after the new tip.
  assert.equal(done.completionDue({ stored: SHA_C, tip: SHA_A, storedKnown: true, tipAtOrBeforeStored: false }), true);
});

test('completionDue: no tip is never due', () => {
  assert.equal(done.completionDue({ stored: null, tip: null }), false);
  assert.equal(done.completionDue({ stored: null, tip: 'abc' }), false);
});

// ─── countsAsMerged ───────────────────────────────────────────

test('countsAsMerged is the same rule as the copy\'s', () => {
  const cases = [
    [MERGED, 'main'],
    [MERGED, 'develop'],
    [{ mergedAt: null, mergedBase: 'main' }, 'main'],
    [{ mergedAt: MERGED.mergedAt, mergedBase: null }, 'main'],
    [MERGED, ''],
    [MERGED, undefined],
    [undefined, 'main'],
  ];
  for (const [p, target] of cases) {
    assert.equal(done.countsAsMerged(p, target), copy.countsAsMerged(p, target), JSON.stringify([p, target]));
  }
  assert.equal(done.countsAsMerged(MERGED, 'main'), true);
});
