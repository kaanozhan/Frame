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
