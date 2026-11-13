/**
 * Workspace rollup — per-workspace attention for the sidebar rows
 * (workspaces spec, T07 / G2 / S5).
 *
 * Pinned: terminals group by workspaceId with main as the default; other
 * projects are ignored; approval outranks input outranks working; a shell
 * running a process counts as working; status lookups may return an object
 * or a bare string; a workspace with no terminals reads as idle.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { summarize, summaryFor } = require('../src/renderer/workspaces/rollup');

const P = '/work/app';
const statuses = {
  t1: { status: 'agent-working' },
  t2: { status: 'agent-input' },
  t3: { status: 'agent-approval' },
  t4: { status: 'idle' },
  t5: 'running',
  t6: { status: 'agent-approval' }
};
const lookup = (id) => statuses[id] || null;

test('terminals group by workspace, main by default, other projects ignored', () => {
  const map = summarize([
    { id: 't1', projectPath: P },
    { id: 't2', projectPath: P, workspaceId: 'teal' },
    { id: 't3', projectPath: P, workspaceId: 'teal' },
    { id: 't4', projectPath: P, workspaceId: 'amber' },
    { id: 't6', projectPath: '/work/other', workspaceId: 'teal' }
  ], P, lookup);

  assert.deepEqual(summaryFor(map, 'main'), { terminals: 1, approval: 0, input: 0, working: 1, dot: 'working' });
  assert.deepEqual(summaryFor(map, 'teal'), { terminals: 2, approval: 1, input: 1, working: 0, dot: 'approval' });
  assert.deepEqual(summaryFor(map, 'amber'), { terminals: 1, approval: 0, input: 0, working: 0, dot: 'idle' });
});

test('input outranks working; a running shell process counts as working', () => {
  const map = summarize([
    { id: 't1', projectPath: P, workspaceId: 'w' },
    { id: 't2', projectPath: P, workspaceId: 'w' },
    { id: 't5', projectPath: P, workspaceId: 'v' }
  ], P, lookup);
  assert.equal(summaryFor(map, 'w').dot, 'input');
  assert.equal(summaryFor(map, 'v').dot, 'working');
});

test('a workspace without terminals, or no lookup, reads as idle', () => {
  const map = summarize([{ id: 'tx', projectPath: P, workspaceId: 'w' }], P, null);
  assert.equal(summaryFor(map, 'w').dot, 'idle');
  assert.deepEqual(summaryFor(map, 'nope'), { terminals: 0, approval: 0, input: 0, working: 0, dot: 'idle' });
  assert.equal(summarize(null, P, lookup).size, 0);
});
