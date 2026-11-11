/**
 * serverProtocol — desktop ↔ Frame Server messages (server-workspaces spec, T01).
 * Pinned: validation of every message type, decode never throws, hello
 * version check names both sides, and the pending table settles, times out
 * and fails everything on disconnect.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/shared/serverProtocol');

test('builders produce valid messages and decode round-trips them', () => {
  for (const m of [P.hello('2.9.0'), P.request('r1', 'terminals.create', { cols: 80 }), P.reply('r1', { terminalId: 'srv-1' }), P.failure('r1', 'nope'), P.event('terminal.output', { terminalId: 'srv-1', data: 'x' })]) {
    assert.equal(P.validate(m), null, JSON.stringify(m));
    assert.deepEqual(P.decode(P.encode(m)), { ok: true, msg: m });
  }
});

test('validate refuses malformed messages', () => {
  assert.match(P.validate(null), /not an object/);
  assert.match(P.validate({ type: 'shout' }), /unknown message type/);
  assert.match(P.validate({ type: 'req', id: 'r1', method: 'rm -rf' }), /invalid method/);
  assert.match(P.validate({ type: 'req', id: '', method: 'a.b' }), /without an id/);
  assert.match(P.validate({ type: 'req', id: 'r1', method: 'a.b', params: [] }), /params/);
  assert.match(P.validate({ type: 'res', id: 'r1', ok: false }), /without an error/);
  assert.match(P.validate({ type: 'event' }), /without a channel/);
  assert.match(P.validate({ type: 'hello', protocol: '1' }), /protocol number/);
  assert.deepEqual(P.decode('{oops'), { ok: false, error: 'not JSON' });
});

test('checkHello accepts the same protocol and names both versions otherwise', () => {
  assert.deepEqual(P.checkHello(P.hello('2.9.0'), '2.9.0'), { ok: true, error: null });
  const r = P.checkHello({ type: 'hello', protocol: 99, frameVersion: '3.0.0' }, '2.9.0');
  assert.equal(r.ok, false);
  assert.match(r.error, /3\.0\.0/);
  assert.match(r.error, /protocol 99/);
  assert.match(r.error, /2\.9\.0/);
  assert.equal(P.checkHello({ type: 'req' }).ok, false);
});

test('pending requests settle by id, time out, and fail on disconnect', async () => {
  const p = P.createPending();
  const id = p.nextId();
  assert.notEqual(id, p.nextId());
  const ok = p.add(id, 1000);
  assert.equal(p.settle(P.reply(id, 42)), true);
  assert.equal(await ok, 42);
  assert.equal(p.settle(P.reply(id, 1)), false, 'a settled id is gone');

  const bad = p.add('x', 1000);
  p.settle(P.failure('x', 'boom'));
  await assert.rejects(bad, /boom/);

  const slow = p.add('slow', 10);
  await assert.rejects(slow, /did not answer/);

  const a = p.add('a', 1000);
  const b = p.add('b', 1000);
  p.rejectAll('gone');
  await assert.rejects(a, /gone/);
  await assert.rejects(b, /gone/);
  assert.equal(p.size, 0);
});

test('protocol 2: the socket transport (server-hardening S8) is a protocol change', () => {
  assert.equal(P.PROTOCOL_VERSION, 2);
  assert.equal(P.checkHello({ type: 'hello', protocol: 1, frameVersion: '2.9.0' }, '3.0.0').ok, false, 'a protocol-1 peer is told to update');
});
