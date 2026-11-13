/**
 * serverSecurity — Frame Server's guard rails (server-workspaces spec, T01).
 * Pinned: tokens are random and long, comparison is exact, the upgrade
 * needs the Bearer token and refuses browser origins, and any non-local
 * bind address carries a warning.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/shared/serverSecurity');

test('generateToken is random, URL-safe and 256-bit', () => {
  const a = S.generateToken();
  const b = S.generateToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
});

test('tokensEqual is exact and refuses empties', () => {
  assert.equal(S.tokensEqual('abc', 'abc'), true);
  assert.equal(S.tokensEqual('abc', 'abd'), false);
  assert.equal(S.tokensEqual('abc', 'abcd'), false);
  assert.equal(S.tokensEqual('', ''), false);
  assert.equal(S.tokensEqual(undefined, 'abc'), false);
});

test('checkUpgrade needs the token and the desktop origin (or none)', () => {
  const t = 'tok123';
  assert.equal(S.checkUpgrade({ authorization: 'Bearer tok123' }, t).ok, true);
  assert.equal(S.checkUpgrade({ authorization: 'Bearer tok123', origin: 'frame-desktop' }, t).ok, true);
  assert.deepEqual(S.checkUpgrade({ authorization: 'Bearer tok123', origin: 'https://evil.example' }, t), { ok: false, status: 403, reason: 'origin not allowed' });
  assert.equal(S.checkUpgrade({ authorization: 'Bearer nope' }, t).status, 401);
  assert.equal(S.checkUpgrade({}, t).status, 401);
  assert.equal(S.checkUpgrade({ authorization: 'tok123' }, t).status, 401, 'the Bearer scheme is required');
  assert.equal(S.checkUpgrade({ authorization: 'Bearer ' }, '').status, 401, 'no token configured means no access');
});

test('bindRule defaults to localhost and warns otherwise', () => {
  assert.deepEqual(S.bindRule(), { host: '127.0.0.1', warning: null });
  assert.equal(S.bindRule('localhost').warning, null);
  assert.equal(S.bindRule('::1').warning, null);
  const wide = S.bindRule('0.0.0.0');
  assert.equal(wide.host, '0.0.0.0');
  assert.match(wide.warning, /not only on this machine/);
});
