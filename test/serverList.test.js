/**
 * serverList — the saved Frame Servers (multi-server-connections T01).
 * Pinned: host validation, add with a stable key, refused duplicate alias,
 * remove, serverId lookup, auto-connect keys, and the one-time migration from
 * the old single `server` setting.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/shared/serverList');

const keys = (...ks) => { let i = 0; return () => ks[i++]; };

test('normalizeHost trims and refuses what cannot be an SSH host', () => {
  assert.deepEqual(L.normalizeHost('  devbox '), { host: 'devbox' });
  assert.deepEqual(L.normalizeHost('me@server.example.com'), { host: 'me@server.example.com' });
  for (const bad of ['', '   ', 'two words', '-oProxyCommand=x', null, undefined]) {
    assert.match(L.normalizeHost(bad).error, /SSH host/, String(bad));
  }
});

test('addServer gives each server its own key and connects it on launch by default', () => {
  const a = L.addServer([], 'devbox', { makeKey: keys('aaaa1111') });
  assert.deepEqual(a.entry, { key: 'aaaa1111', host: 'devbox', serverId: null, autoConnect: true });
  const b = L.addServer(a.list, 'gpu', { makeKey: keys('bbbb2222') });
  assert.deepEqual(b.list.map((e) => e.key), ['aaaa1111', 'bbbb2222']);
});

test('addServer refuses an alias already listed, naming the existing entry', () => {
  const { list } = L.addServer([], 'DevBox', { makeKey: keys('aaaa1111') });
  const again = L.addServer(list, 'devbox', { makeKey: keys('cccc3333') });
  assert.match(again.error, /DevBox is already in the list/);
  assert.equal(again.existing.key, 'aaaa1111');
  assert.match(L.addServer(list, 'bad host').error, /SSH host/);
});

test('addServer never reuses a key', () => {
  const { list } = L.addServer([], 'a', { makeKey: keys('k1') });
  const b = L.addServer(list, 'b', { makeKey: keys('k1', 'k2') });
  assert.equal(b.entry.key, 'k2');
});

test('removeServer drops only that key', () => {
  const list = [{ key: 'k1', host: 'a', autoConnect: true }, { key: 'k2', host: 'b', autoConnect: false }];
  assert.deepEqual(L.removeServer(list, 'k1').map((e) => e.key), ['k2']);
  assert.deepEqual(L.removeServer(list, 'nope').map((e) => e.key), ['k1', 'k2']);
});

test('findByServerId finds another entry holding the same machine', () => {
  const list = [{ key: 'k1', host: 'a', serverId: 'm1' }, { key: 'k2', host: 'b', serverId: null }];
  assert.equal(L.findByServerId(list, 'm1').key, 'k1');
  assert.equal(L.findByServerId(list, 'm1', 'k1'), null, 'an entry is not its own duplicate');
  assert.equal(L.findByServerId(list, null), null);
  assert.equal(L.findByServerId(list, 'm9'), null);
});

test('updateServer merges fields but never changes the key', () => {
  const list = [{ key: 'k1', host: 'a', serverId: null, autoConnect: true }];
  const next = L.updateServer(list, 'k1', { serverId: 'm1', autoConnect: false, key: 'evil' });
  assert.deepEqual(next, [{ key: 'k1', host: 'a', serverId: 'm1', autoConnect: false }]);
});

test('autoConnectKeys lists only servers left connected, in order', () => {
  const list = [{ key: 'k1', host: 'a', autoConnect: true }, { key: 'k2', host: 'b', autoConnect: false }, { key: 'k3', host: 'c', autoConnect: true }];
  assert.deepEqual(L.autoConnectKeys(list), ['k1', 'k3']);
});

test('sanitize drops malformed entries and repeated keys', () => {
  const list = [{ key: 'k1', host: 'a' }, { key: 'k1', host: 'b' }, { host: 'nokey' }, { key: 'k2', host: 'bad host' }, null, 'x'];
  assert.deepEqual(L.sanitize(list), [{ key: 'k1', host: 'a', serverId: null, autoConnect: false }]);
  assert.deepEqual(L.sanitize(undefined), []);
});

test('migrate turns the old single server into a one-entry list, once', () => {
  const m = L.migrate({ server: { host: 'devbox', autoConnect: true } }, { makeKey: keys('aaaa1111') });
  assert.equal(m.migrated, true);
  assert.deepEqual(m.servers, [{ key: 'aaaa1111', host: 'devbox', serverId: null, autoConnect: true }]);

  const off = L.migrate({ server: { host: 'devbox', autoConnect: false } }, { makeKey: keys('k') });
  assert.equal(off.servers[0].autoConnect, false, 'a server left disconnected stays off');

  const already = L.migrate({ servers: [{ key: 'k9', host: 'gpu', autoConnect: true }], server: { host: 'devbox', autoConnect: true } });
  assert.equal(already.migrated, false, 'an existing list wins over the old setting');
  assert.deepEqual(already.servers.map((e) => e.host), ['gpu']);

  assert.deepEqual(L.migrate({}), { servers: [], migrated: false });
  assert.deepEqual(L.migrate({ server: { host: '' } }), { servers: [], migrated: false });
  assert.deepEqual(L.migrate({ servers: [] }), { servers: [], migrated: false });
});
