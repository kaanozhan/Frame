/**
 * leadRules — the Chief's rules (lead-agent spec, T01).
 * Pinned: status from OSC 7501 reports and the foreground process, scope per
 * project and machine, refusals that hold in both modes, the approval book
 * (first decision wins, cancel), and the per-target delivery gate + FIFO.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/shared/leadRules');

const { STATUS } = R;

test('program states map onto Chief statuses', () => {
  assert.deepEqual(R.mapProgramState({ state: 'idle' }), { status: 'ready' });
  assert.deepEqual(R.mapProgramState({ state: 'done' }), { status: 'ready' });
  assert.deepEqual(R.mapProgramState({ state: 'clear' }), { status: 'ready' });
  assert.deepEqual(R.mapProgramState({ state: 'working' }), { status: 'working' });
  assert.deepEqual(R.mapProgramState({ state: 'blocked', kind: 'permission' }), { status: 'approval', kind: 'permission' });
  assert.deepEqual(R.mapProgramState({ state: 'blocked', kind: 'question' }), { status: 'approval', kind: 'question' });
  assert.deepEqual(R.mapProgramState({ state: 'blocked' }), { status: 'approval', kind: null });
  assert.deepEqual(R.mapProgramState({ state: 'error', msg: 'rate limited' }), { status: 'ready', error: 'rate limited' });
  assert.deepEqual(R.mapProgramState({ state: 'something-new' }), { status: 'unknown' }, 'an unknown state never reads as ready');
  assert.deepEqual(R.mapProgramState(null), { status: 'unknown' });
});

test('deriveStatus: shells, agents with and without reports, ended', () => {
  assert.deepEqual(R.deriveStatus({ alive: false }), { status: 'ended', agent: null });
  assert.deepEqual(R.deriveStatus({ foreground: 'zsh', shellName: '/bin/zsh' }), { status: 'ready', agent: null });
  // A stale report from a CLI that has exited is ignored once the shell is back.
  assert.deepEqual(R.deriveStatus({ foreground: 'zsh', shellName: 'zsh', agentState: { state: 'working' } }), { status: 'ready', agent: null });
  assert.deepEqual(R.deriveStatus({ foreground: 'claude', shellName: 'zsh', agentState: { state: 'working' } }), { status: 'working', agent: 'claude' });
  assert.deepEqual(R.deriveStatus({ foreground: '2.1.331', shellName: 'zsh', agentState: { state: 'idle' } }), { status: 'ready', agent: '2.1.331' }, 'native installs report their version as the process name');
  assert.deepEqual(R.deriveStatus({ foreground: 'claude', shellName: 'zsh' }), { status: 'unknown', agent: 'claude' }, 'an agent without a report is unknown');
  assert.deepEqual(R.deriveStatus({ foreground: 'codex', shellName: 'bash' }), { status: 'unknown', agent: 'codex' });
  assert.deepEqual(R.deriveStatus({ foreground: 'node', shellName: 'zsh' }), { status: 'busy', agent: null });
  assert.deepEqual(R.deriveStatus({ foreground: null, shellName: 'pwsh.exe' }), { status: 'unknown', agent: null }, 'no foreground info (Windows) and no report');
  assert.deepEqual(R.deriveStatus({ foreground: null, shellName: 'pwsh.exe', agentState: { state: 'idle' } }), { status: 'ready', agent: 'claude' });
});

test('scopeFilter keeps one project on one machine and drops home / lead / self', () => {
  const ts = [
    { id: 'a', projectPath: '/p', machine: 'desktop' },
    { id: 'b', projectPath: '/p', machine: 'desktop', home: true },
    { id: 'c', projectPath: '/q', machine: 'desktop' },
    { id: 'd', projectPath: '/p', machine: 'srv1' },
    { id: 'e', projectPath: '/p', machine: 'desktop', lead: true },
    { id: 'chief', projectPath: '/p', machine: 'desktop' }
  ];
  assert.deepEqual(R.scopeFilter(ts, { projectPath: '/p', machine: 'desktop', chiefId: 'chief' }).map((t) => t.id), ['a']);
  // A server Chief never sees a desktop terminal, even from a merged list.
  assert.deepEqual(R.scopeFilter(ts, { projectPath: '/p', machine: 'srv1' }).map((t) => t.id), ['d']);
  assert.deepEqual(R.scopeFilter(ts, { projectPath: null }), []);
  assert.deepEqual(R.scopeFilter(null, { projectPath: '/p' }), []);
});

test('sendRefusal: every hard refusal, in order, and the allowed cases', () => {
  const ready = { id: 't1', status: STATUS.READY, pasteMode: true };
  const ctx = { chiefId: 'chief', inScope: true, orchestrationIds: new Set(['cond']), text: 'run the tests' };
  assert.equal(R.sendRefusal(null, ctx).code, 'not-found');
  assert.equal(R.sendRefusal({ ...ready, id: 'chief' }, ctx).code, 'self');
  assert.equal(R.sendRefusal(ready, { ...ctx, inScope: false }).code, 'out-of-scope');
  assert.equal(R.sendRefusal({ ...ready, id: 'cond' }, ctx).code, 'conductor-lane');
  assert.equal(R.sendRefusal({ ...ready, id: 'cond' }, { ...ctx, orchestrationIds: ['cond'] }).code, 'conductor-lane', 'arrays work too');
  assert.equal(R.sendRefusal(ready, { ...ctx, text: '   ' }).code, 'empty');
  assert.equal(R.sendRefusal({ ...ready, status: STATUS.APPROVAL, kind: 'question' }, ctx).code, 'awaiting-user');
  assert.match(R.sendRefusal({ ...ready, status: STATUS.APPROVAL, kind: 'question' }, ctx).reason, /question/);
  assert.equal(R.sendRefusal({ ...ready, status: STATUS.UNKNOWN }, ctx).code, 'status-unknown');
  assert.equal(R.sendRefusal({ ...ready, status: STATUS.BUSY }, ctx).code, 'busy-process');
  assert.equal(R.sendRefusal({ ...ready, status: STATUS.ENDED }, ctx).code, 'ended');
  assert.equal(R.sendRefusal({ ...ready, pasteMode: false }, { ...ctx, text: 'a\nb' }).code, 'multiline-no-paste');
  // Allowed: ready, working (it queues), multi-line into a paste-mode target, a trailing newline.
  assert.equal(R.sendRefusal(ready, ctx), null);
  assert.equal(R.sendRefusal({ ...ready, status: STATUS.WORKING }, ctx), null);
  assert.equal(R.sendRefusal(ready, { ...ctx, text: 'a\nb' }), null);
  assert.equal(R.sendRefusal({ ...ready, pasteMode: false }, { ...ctx, text: 'one line\n' }), null);
});

test('modes: user-guided by default, full auto skips approval, refusals do not depend on mode', () => {
  assert.equal(R.DEFAULT_MODE, 'user-guided');
  assert.equal(R.normalizeMode(undefined), 'user-guided');
  assert.equal(R.normalizeMode('full-auto'), 'full-auto');
  assert.equal(R.normalizeMode('garbage'), 'user-guided');
  const send = { name: 'terminal_send', approval: true };
  const read = { name: 'terminal_read', approval: false };
  assert.equal(R.needsApproval(send, 'user-guided'), true);
  assert.equal(R.needsApproval(send), true);
  assert.equal(R.needsApproval(send, 'full-auto'), false);
  assert.equal(R.needsApproval(read, 'user-guided'), false);
  assert.equal(R.needsApproval({ name: 'future_tool' }, 'user-guided'), true, 'an action that does not opt out asks');
  // sendRefusal takes no mode at all — the same target is refused either way.
  assert.equal(R.sendRefusal.length <= 2, true);
});

test('approvals: request, first decision wins, edit carries text, cancel, prune', () => {
  let s = R.createApprovals();
  let r = R.requestApproval(s, { action: 'terminal_send', target: 't1', summary: '→ t1: run tests', payload: { text: 'run tests' }, chiefId: 'chief', at: 1 });
  s = r.state;
  const id = r.record.id;
  assert.equal(R.pendingApprovals(s).length, 1);

  r = R.decideApproval(s, id, { decision: 'edited', text: 'run the unit tests', at: 2 });
  assert.equal(r.changed, true);
  assert.equal(r.record.status, 'edited');
  assert.equal(r.record.text, 'run the unit tests');
  s = r.state;

  const again = R.decideApproval(s, id, { decision: 'approved', at: 3 });
  assert.equal(again.changed, false, 'a second decision is ignored');
  assert.equal(again.record.status, 'edited');
  assert.equal(R.decideApproval(s, 'nope', { decision: 'approved' }).changed, false);

  r = R.requestApproval(s, { action: 'terminal_send', target: 't2', chiefId: 'chief', at: 4 });
  s = r.state;
  assert.equal(R.decideApproval(s, r.record.id, { decision: 'maybe' }).changed, false, 'unknown decisions are ignored');
  const c = R.cancelApprovals(s, (rec) => rec.target === 't2', { at: 5 });
  assert.equal(c.cancelled.length, 1);
  assert.equal(c.cancelled[0].status, 'cancelled');
  assert.equal(R.pendingApprovals(c.state).length, 0);
  assert.equal(R.cancelApprovals(c.state, () => true).changed, false, 'nothing pending, nothing cancelled');

  let big = R.createApprovals();
  for (let i = 0; i < 10; i++) {
    const q = R.requestApproval(big, { action: 'x', at: i });
    big = R.decideApproval(q.state, q.record.id, { decision: 'approved', at: i }).state;
  }
  big = R.requestApproval(big, { action: 'x', at: 99 }).state;
  const pruned = R.pruneApprovals(big, 3);
  assert.equal(pruned.records.length, 4);
  assert.equal(R.pendingApprovals(pruned).length, 1, 'pending survives pruning');
});

test('delivery gate: ready only, and never within the quiet period after the user typed', () => {
  assert.deepEqual(R.deliveryGate({ status: 'working', now: 10 }), { ok: false, waitMs: null, why: 'working' });
  assert.deepEqual(R.deliveryGate({ status: 'ready', now: 10 }), { ok: true, waitMs: 0, why: null });
  assert.deepEqual(R.deliveryGate({ status: 'ready', lastUserInputAt: 9000, now: 10000 }), { ok: false, waitMs: 3000, why: 'user-typing' });
  assert.deepEqual(R.deliveryGate({ status: 'ready', lastUserInputAt: 1000, now: 10000 }), { ok: true, waitMs: 0, why: null });
});

test('per-target FIFO keeps order and drops a closed target', () => {
  let q = new Map();
  q = R.enqueue(q, 't1', 'a');
  q = R.enqueue(q, 't1', 'b');
  q = R.enqueue(q, 't2', 'x');
  assert.equal(R.head(q, 't1'), 'a');
  q = R.dequeue(q, 't1');
  assert.equal(R.head(q, 't1'), 'b');
  q = R.dequeue(q, 't1');
  assert.equal(R.head(q, 't1'), null);
  assert.equal(q.has('t1'), false);
  const d = R.dropTarget(q, 't2');
  assert.deepEqual(d.dropped, ['x']);
  assert.equal(d.queues.size, 0);
});

test('agent process names', () => {
  assert.equal(R.isAgentProcess('claude'), true);
  assert.equal(R.isAgentProcess('/usr/local/bin/codex'), true);
  assert.equal(R.isAgentProcess('Claude.exe'), true);
  assert.equal(R.isAgentProcess('2.1.331'), true, 'native Claude installs are named after their version');
  assert.deepEqual(R.deriveStatus({ foreground: '2.1.331', shellName: 'zsh' }), { status: 'unknown', agent: '2.1.331' });
  assert.equal(R.isAgentProcess('node'), false);
  assert.equal(R.isAgentProcess(null), false);
});
