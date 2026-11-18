/**
 * Workspace attention — who waits on the user, and in what order
 * (workspace-list-agent-alerts spec, T01).
 *
 * Pinned: only approval and input count as waiting; approval comes before
 * input, then the longest wait; other projects are ignored and a terminal
 * without a workspaceId belongs to main; a row shows its workspace's most
 * urgent wait; the folded header counts the other workspaces only; "next"
 * skips the terminal on screen; the label reads `approval · 2m`.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { waitingQueue, workspaceWait, othersWaiting, nextWaiting, waitLabel } = require('../src/renderer/workspaces/attention');

const P = '/work/app';
const NOW = 1_000_000_000;
const MIN = 60_000;
const statuses = {
  t1: { status: 'agent-working', lastActivityAt: NOW, agentName: 'claude' },
  t2: { status: 'agent-input', lastActivityAt: NOW - 9 * MIN, agentName: 'claude' },
  t3: { status: 'agent-approval', lastActivityAt: NOW - 2 * MIN, agentName: 'codex' },
  t4: { status: 'agent-approval', lastActivityAt: NOW - 5 * MIN, agentName: null },
  t5: 'agent-input',
  t6: { status: 'agent-approval', lastActivityAt: NOW - 30 * MIN, agentName: 'claude' },
  t7: { status: 'agent-input', lastActivityAt: NOW - 20 * MIN, agentName: 'claude' }
};
const lookup = (id) => statuses[id] || null;
const states = [
  { id: 't1', projectPath: P, name: '1st Terminal' },
  { id: 't2', projectPath: P, workspaceId: 'teal', name: '1st Terminal' },
  { id: 't3', projectPath: P, workspaceId: 'teal', name: '2nd Terminal' },
  { id: 't4', projectPath: P, workspaceId: 'amber', name: '1st Terminal' },
  { id: 't5', projectPath: P, name: '2nd Terminal' },
  { id: 't6', projectPath: '/work/other', workspaceId: 'teal', name: '1st Terminal' },
  { id: 't7', projectPath: P, workspaceId: 'amber', name: '2nd Terminal' }
];

test('waitingQueue: approval first, then the longest wait; other projects and working agents are left out', () => {
  const queue = waitingQueue(states, P, lookup);
  assert.deepEqual(queue.map((e) => e.terminalId), ['t4', 't3', 't7', 't2', 't5']);
  assert.deepEqual(queue[0], { terminalId: 't4', workspaceId: 'amber', kind: 'approval', agentName: '1st Terminal', since: NOW - 5 * MIN });
  assert.deepEqual(queue[1], { terminalId: 't3', workspaceId: 'teal', kind: 'approval', agentName: 'codex', since: NOW - 2 * MIN });
  // A bare-string status has no start: it waits in main and sorts last of its kind.
  assert.deepEqual(queue[4], { terminalId: 't5', workspaceId: 'main', kind: 'input', agentName: '2nd Terminal', since: null });
  assert.deepEqual(waitingQueue(null, P, lookup), []);
  assert.deepEqual(waitingQueue(states, P, null), []);
});

test('workspaceWait: a row shows its most urgent wait, main by default, nothing when no agent waits', () => {
  const queue = waitingQueue(states, P, lookup);
  assert.equal(workspaceWait(queue, 'teal').terminalId, 't3');
  assert.equal(workspaceWait(queue, 'amber').terminalId, 't4');
  assert.equal(workspaceWait(queue, null).terminalId, 't5');
  assert.equal(workspaceWait(queue, 'violet'), null);
  assert.equal(workspaceWait(null, 'teal'), null);
});

test('othersWaiting: counts the other workspaces and names the most urgent kind', () => {
  const queue = waitingQueue(states, P, lookup);
  assert.deepEqual(othersWaiting(queue, 'teal'), { count: 3, kind: 'approval' });
  assert.deepEqual(othersWaiting(queue, null), { count: 4, kind: 'approval' });
  const inputOnly = waitingQueue(states.filter((s) => s.id === 't2' || s.id === 't5'), P, lookup);
  assert.deepEqual(othersWaiting(inputOnly, 'main'), { count: 1, kind: 'input' });
  assert.deepEqual(othersWaiting(inputOnly.slice(0, 1), 'teal'), { count: 0, kind: null });
  assert.deepEqual(othersWaiting(null, 'teal'), { count: 0, kind: null });
});

test('nextWaiting: the most urgent agent that is not on screen', () => {
  const queue = waitingQueue(states, P, lookup);
  assert.equal(nextWaiting(queue, null).terminalId, 't4');
  assert.equal(nextWaiting(queue, 't4').terminalId, 't3');
  assert.equal(nextWaiting(queue.slice(0, 1), 't4'), null);
  assert.equal(nextWaiting([], 't4'), null);
});

test('waitLabel: the wait by name, never how long it has lasted', () => {
  assert.equal(waitLabel('approval'), 'approval');
  assert.equal(waitLabel('input'), 'waiting');
  // Extra arguments (an old caller passing `since`) change nothing.
  assert.equal(waitLabel('input', NOW - 9 * MIN, NOW), 'waiting');
  assert.doesNotMatch(waitLabel('approval', NOW - 125 * MIN, NOW), /·|\dm|\dh/);
});
