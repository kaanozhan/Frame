/**
 * serverConnectModel — the Connect dialog's state rules (server-hardening S12).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/renderer/serverConnectModel');

const filled = () => ({ ...M.initial(), progressLines: ['downloading', 'checksum verified'], doctor: { items: [] }, doctorFor: 'box' });

test('progress and the check-up clear only when the status enters installing', () => {
  const m = filled();
  assert.deepEqual(M.onStatus(m, { state: 'connected' }, { state: 'connected' }), m, 'no change');
  assert.deepEqual(M.onStatus(m, { state: 'installing' }, { state: 'installing' }).progressLines, m.progressLines, 'a second installing status keeps the lines');
  const entered = M.onStatus(m, { state: 'needs-update' }, { state: 'installing' });
  assert.deepEqual(entered.progressLines, []);
  assert.equal(entered.doctor, null);
});

test('one action at a time: a second start while one is in flight is refused', () => {
  const a = M.startAction(M.initial());
  assert.equal(a.allowed, true);
  const b = M.startAction(a.model);
  assert.equal(b.allowed, false, 'a double click does nothing');
  assert.deepEqual(b.model, a.model, 'and changes nothing (progress kept)');
  assert.equal(M.startAction(M.endAction(a.model)).allowed, true);
});

test('actions are disabled while one is in flight or the server is installing', () => {
  assert.equal(M.actionsDisabled(M.initial(), { state: 'connected' }), false);
  assert.equal(M.actionsDisabled(M.startAction(M.initial()).model, { state: 'connected' }), true);
  assert.equal(M.actionsDisabled(M.initial(), { state: 'installing' }), true);
});

test('consent text: named agents, or a general warning when they could not be listed', () => {
  assert.match(M.consentText({ kind: 'update', agents: [{ agent: 'claude' }], host: 'box' }), /1 agent is running on box/);
  const general = M.consentText({ kind: 'rollback', agents: null, host: 'box' });
  assert.match(general, /could not list/i);
  assert.match(general, /Rolling back/);
});

// ─── server-onboarding T06: sign in from the check-up ────────

test('fixTerminalFor: a missing item with a fix command opens a terminal with it; others do not', () => {
  assert.equal(M.fixTerminalFor({ id: 'claude', ok: false, fix: 'claude # then sign in' }), 'claude # then sign in');
  assert.equal(M.fixTerminalFor({ id: 'gh', ok: false, optional: true, fix: 'gh auth login && gh auth setup-git' }), 'gh auth login && gh auth setup-git', 'optional items too');
  assert.equal(M.fixTerminalFor({ id: 'git', ok: true, fix: 'x' }), null, 'ready items get no button');
  assert.equal(M.fixTerminalFor({ id: 'error', ok: false, detail: 'Check-up failed' }), null, 'nothing to type');
  assert.equal(M.fixTerminalFor({ id: 'x', ok: false, fix: 'line one\nline two' }), null, 'never a multi-line command');
});

test('a fix terminal makes the next open of the dialog check again, once', () => {
  let m = M.noteFixOpened(M.initial());
  const first = M.takeRecheck(m);
  assert.equal(first.recheck, true);
  const second = M.takeRecheck(first.model);
  assert.equal(second.recheck, false);
});

// ─── multi-server-connections ────────────────────────────────

const srv = (key, state) => ({ key, host: key, status: { state } });

test('one model per server: progress on one never shows on another', () => {
  let models = {};
  models = M.withModel(models, 'a', { ...M.initial(), progressLines: ['downloading'] });
  assert.deepEqual(M.modelFor(models, 'a').progressLines, ['downloading']);
  assert.deepEqual(M.modelFor(models, 'b'), M.initial(), 'another server starts clean');
  assert.deepEqual(Object.keys(M.pruneModels({ ...models, b: M.initial() }, ['b'])), ['b'], 'removed servers are dropped');
  assert.deepEqual(M.modelFor(null, null), M.initial());
});

test('summary: connected / total and the worst state of servers not off', () => {
  assert.equal(M.summary([]), null);
  assert.deepEqual(M.summary([srv('a', 'connected'), srv('b', 'connected')]), { total: 2, connected: 2, state: 'connected' });
  assert.deepEqual(M.summary([srv('a', 'connected'), srv('b', 'reconnecting')]), { total: 2, connected: 1, state: 'reconnecting' });
  assert.deepEqual(M.summary([srv('a', 'connected'), srv('b', 'off')]), { total: 2, connected: 1, state: 'connected' }, 'a disconnected server does not grey the dot');
  assert.deepEqual(M.summary([srv('a', 'off'), srv('b', 'off')]), { total: 2, connected: 0, state: 'off' });
  assert.equal(M.summary([srv('a', 'connected'), srv('b', 'error'), srv('c', 'needs-update')]).state, 'error');
  assert.deepEqual(M.summary([{ key: 'x' }]), { total: 1, connected: 0, state: 'off' }, 'no status reads as off');
});

test('pickSelected keeps the chosen server, else the first connected, else the first', () => {
  const list = [srv('a', 'off'), srv('b', 'connected')];
  assert.equal(M.pickSelected(list, 'a'), 'a');
  assert.equal(M.pickSelected(list, 'gone'), 'b');
  assert.equal(M.pickSelected([srv('a', 'off')], null), 'a');
  assert.equal(M.pickSelected([], 'a'), null);
});

// ─── server-first-connect T04: the step indicator ────────────

test('T04: the steps follow the server from connecting to a clean check-up', () => {
  const at = (status, doctor = null) => M.steps(status, doctor).map((s) => s.state).join(' ');
  assert.deepEqual(M.steps({ state: 'off' }, null).map((s) => [s.id, s.label]), [['connect', 'Connect'], ['install', 'Install Frame Server'], ['checkup', 'Check-up']]);
  assert.equal(at({ state: 'off' }), 'todo todo todo');
  assert.equal(at({ state: 'connecting' }), 'active todo todo');
  assert.equal(at({ state: 'reconnecting' }), 'active todo todo');
  assert.equal(at({ state: 'error', errorKind: 'auth' }), 'failed todo todo', 'waiting on the user');
  assert.equal(at({ state: 'error', errorKind: 'no-resolve' }), 'failed todo todo', 'retrying');
  assert.equal(at({ state: 'error', errorKind: null, error: 'ssh box: kex failed', install: null }), 'failed todo todo');
  assert.equal(at({ state: 'needs-install', install: { action: 'install' } }), 'done active todo');
  assert.equal(at({ state: 'needs-update', install: { action: 'update' } }), 'done active todo');
  assert.equal(at({ state: 'installing' }), 'done active todo');
  assert.equal(at({ state: 'error', errorKind: null, error: 'The install failed.', install: { action: 'install' } }), 'done failed todo');
  assert.equal(at({ state: 'error', errorKind: null, error: 'socket closed', install: { action: 'none' } }), 'failed todo todo');
  assert.equal(at({ state: 'connected' }, null), 'done done active', 'check-up loading');
  assert.equal(at({ state: 'connected' }, { items: [{ ok: true }, { ok: true }] }), 'done done done');
  assert.equal(at({ state: 'connected' }, { items: [{ ok: true }, { ok: false }] }), 'done done failed', 'something to fix');
  assert.equal(at({ state: 'connected' }, { items: [{ ok: true }, { ok: false, optional: true }] }), 'done done done', 'an optional item may be missing');
  assert.equal(at({ state: 'connected' }, { error: 'Not connected.', items: [] }), 'done done failed');
});
