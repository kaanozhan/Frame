/**
 * deviceFlow tests — the pure core of Frame Cloud sign-in.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 * No Electron, no network: fetch, sleep, clock and browser are fakes.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const flow = require('../src/main/cloud/deviceFlow');

const API = 'http://cloud.test';

const CODE_BODY = {
  device_code: 'dev-code-1',
  user_code: 'TTN4YFST',
  verification_uri: 'http://web.test/device',
  verification_uri_complete: 'http://web.test/device?code=TTN4YFST',
  expires_in: 900,
  interval: 5,
};

const INFO = { name: 'Studio', os: 'darwin 24.3.0', appVersion: '2.8.1', installId: '3f2a7c1e-9b4d-4e8f-a1c2-5d6e7f8a9b0c' };

// ─── Fakes ────────────────────────────────────────────────────

function abortError() {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

/** A clock that only moves when the flow sleeps. */
function fakeClock() {
  const clock = {
    t: 1_000_000,
    sleeps: [],
    now: () => clock.t,
    sleep: async (ms, signal) => {
      if (signal && signal.aborted) throw abortError();
      clock.sleeps.push(ms);
      clock.t += ms;
      if (clock.onSleep) clock.onSleep(ms);
      if (signal && signal.aborted) throw abortError();
    },
  };
  return clock;
}

/**
 * Scripted fetch: `routes[path]` is an array of answers consumed in order
 * (the last one repeats). An answer is `{ status, body }`, an Error to throw,
 * or a function `(call) => answer`.
 */
function fakeFetch(routes) {
  const calls = [];
  const fetchJson = async (url, opts = {}) => {
    const [path, query = ''] = url.slice(API.length).split('?');
    calls.push({ url, path, query, ...opts });
    const queue = routes[path];
    if (!queue) throw new Error(`unexpected request ${path}`);
    let answer = queue.length > 1 ? queue.shift() : queue[0];
    if (typeof answer === 'function') answer = answer(calls[calls.length - 1]);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { fetchJson, calls };
}

const ok = (data) => ({ status: 200, body: { result: { data } } });
const trpcErr = (status, code, message = 'nope') => ({
  status,
  body: { error: { message, data: { code, httpStatus: status } } },
});
const tokenErr = (error, status = 400) => ({ status, body: { error } });
const TOKEN_OK = { status: 200, body: { access_token: 'secret-token', token_type: 'Bearer', expires_in: 2592000, scope: '' } };

const REGISTERED = {
  deviceId: 'd1',
  user: { name: 'Ada', email: 'ada@example.com' },
  workspace: { name: 'Lab', slug: 'lab' },
};

function code(overrides = {}) {
  return { ...flow.parseCodeResponse(CODE_BODY), ...overrides };
}

function tokenPolls(calls) {
  return calls.filter((c) => c.path === '/api/auth/device/token');
}

// ─── Building blocks ──────────────────────────────────────────

test('formatUserCode groups eight characters and leaves other shapes alone', () => {
  assert.equal(flow.formatUserCode('TTN4YFST'), 'TTN4-YFST');
  assert.equal(flow.formatUserCode('ttn4yfst'), 'ttn4-yfst', 'case is untouched');
  assert.equal(flow.formatUserCode('ABC'), 'ABC');
  assert.equal(flow.formatUserCode('TTN4-YFST'), 'TTN4-YFST');
  assert.equal(flow.formatUserCode(undefined), '');
});

test('resolveServerUrl prefers env, then setting, then default, and trims trailing slashes', () => {
  const allowed = (url) => ({ url, refused: null });
  assert.deepEqual(
    flow.resolveServerUrl({ env: 'https://a.test/', setting: 'https://b.test', defaultUrl: 'https://c.test' }),
    allowed('https://a.test')
  );
  assert.deepEqual(
    flow.resolveServerUrl({ env: '  ', setting: 'https://b.test//', defaultUrl: 'https://c.test' }),
    allowed('https://b.test')
  );
  assert.deepEqual(flow.resolveServerUrl({ env: undefined, setting: null, defaultUrl: 'https://c.test' }), allowed('https://c.test'));
  assert.deepEqual(flow.resolveServerUrl({ env: undefined, setting: '', defaultUrl: '' }), allowed(''));
  assert.deepEqual(flow.resolveServerUrl(), allowed(''));
});

test('checkServerUrl allows https on any host and http on localhost and 127.0.0.1 only', () => {
  for (const url of ['https://cloud.test', 'https://localhost:3000', 'https://10.0.0.5/api']) {
    assert.deepEqual(flow.checkServerUrl(url), { ok: true, url }, url);
  }
  for (const url of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://LOCALHOST']) {
    assert.deepEqual(flow.checkServerUrl(url), { ok: true, url }, url);
  }
  for (const url of ['http://cloud.test', 'http://192.168.1.5:3000', 'http://localhost.cloud.test', 'http://[::1]:3000']) {
    assert.deepEqual(flow.checkServerUrl(url), { ok: false, reason: 'insecure' }, url);
  }
  for (const url of ['cloud.test', 'not a url', 'ftp://cloud.test', 'file:///tmp/x', 'javascript:alert(1)']) {
    assert.deepEqual(flow.checkServerUrl(url), { ok: false, reason: 'invalid' }, url);
  }
});

test('resolveServerUrl refuses http off loopback and unparsable addresses', () => {
  assert.deepEqual(flow.resolveServerUrl({ env: 'http://cloud.test/' }), { url: '', refused: 'http://cloud.test' });
  assert.deepEqual(flow.resolveServerUrl({ setting: 'cloud.test' }), { url: '', refused: 'cloud.test' });
  assert.deepEqual(flow.resolveServerUrl({ defaultUrl: 'http://localhost:3000/' }), { url: 'http://localhost:3000', refused: null });
  assert.deepEqual(flow.resolveServerUrl({ env: 'http://127.0.0.1:3000' }), { url: 'http://127.0.0.1:3000', refused: null });
});

test('resolveServerUrl does not fall through past a refused candidate', () => {
  assert.deepEqual(
    flow.resolveServerUrl({ env: 'http://cloud.test', setting: 'https://b.test', defaultUrl: 'https://c.test' }),
    { url: '', refused: 'http://cloud.test' }
  );
  assert.deepEqual(
    flow.resolveServerUrl({ env: '', setting: 'not a url', defaultUrl: 'https://c.test' }),
    { url: '', refused: 'not a url' }
  );
});

test('deviceName strips a trailing .local, cuts to 100 characters and never returns empty', () => {
  assert.equal(flow.deviceName('Berkays-MacBook.local'), 'Berkays-MacBook');
  assert.equal(flow.deviceName('  host.LOCAL  '), 'host');
  assert.equal(flow.deviceName('x'.repeat(150)).length, 100);
  assert.equal(flow.deviceName(''), 'Unknown device');
  assert.equal(flow.deviceName('.local'), 'Unknown device');
  assert.equal(flow.deviceName(undefined), 'Unknown device');
});

test('deviceName never uses a network address as a name', () => {
  assert.equal(flow.deviceName('192.168.1.104'), 'Unknown device');
  assert.equal(flow.deviceName('fe80::1c2b:3aff:fe4d:5e6f'), 'Unknown device');
  assert.equal(flow.deviceName('build-01'), 'build-01');
  assert.equal(flow.deviceName('Studio 2024'), 'Studio 2024');
});

test('formatDeviceInfo prefers the computer name and falls back to the hostname', () => {
  assert.equal(flow.formatDeviceInfo({ computerName: 'MacBook Pro (2)', hostname: '192.168.1.104' }).name, 'MacBook Pro (2)');
  assert.equal(flow.formatDeviceInfo({ computerName: '  ', hostname: 'MacBook-Pro-2.local' }).name, 'MacBook-Pro-2');
  assert.equal(flow.formatDeviceInfo({ computerName: '', hostname: '192.168.1.104' }).name, 'Unknown device');
  assert.equal(flow.formatDeviceInfo({ computerName: 'x'.repeat(150) }).name.length, 100);
});

test('formatDeviceInfo builds the register input within the server limits', () => {
  const info = flow.formatDeviceInfo({
    hostname: 'studio.local',
    platform: 'darwin',
    release: '24.3.0',
    appVersion: '2.8.1-' + 'x'.repeat(60),
  });
  assert.equal(info.name, 'studio');
  assert.equal(info.os, 'darwin 24.3.0');
  assert.equal(info.appVersion.length, 40);
});

test('formatDeviceInfo carries the install id, cut to the server limit', () => {
  const id = '3f2a7c1e-9b4d-4e8f-a1c2-5d6e7f8a9b0c';
  assert.equal(flow.formatDeviceInfo({ hostname: 'studio', installId: id }).installId, id);
  assert.equal(flow.formatDeviceInfo({ hostname: 'studio', installId: 'x'.repeat(200) }).installId.length, flow.INSTALL_ID_MAX);
  assert.equal(flow.formatDeviceInfo({ hostname: 'studio' }).installId, '');
});

test('resolveInstallId keeps a stored UUID and replaces anything else', () => {
  const stored = '3f2a7c1e-9b4d-4e8f-a1c2-5d6e7f8a9b0c';
  const mint = () => 'minted-id';
  assert.deepEqual(flow.resolveInstallId(stored, mint), { id: stored, write: null });
  assert.deepEqual(flow.resolveInstallId(stored.toUpperCase(), mint), { id: stored.toUpperCase(), write: null });
  for (const bad of [undefined, null, '', 'not-a-uuid', 42, `${stored}x`]) {
    assert.deepEqual(flow.resolveInstallId(bad, mint), { id: 'minted-id', write: 'set' }, String(bad));
  }
});

test('resolveInstallId mints a UUID by default', () => {
  const { id, write } = flow.resolveInstallId(undefined);
  assert.equal(write, 'set');
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.deepEqual(flow.resolveInstallId(id), { id, write: null });
});

test('parseCodeResponse converts to milliseconds and rejects a body missing device_code', () => {
  const parsed = flow.parseCodeResponse(CODE_BODY);
  assert.deepEqual(parsed, {
    deviceCode: 'dev-code-1',
    userCode: 'TTN4YFST',
    verificationUri: 'http://web.test/device',
    verificationUriComplete: 'http://web.test/device?code=TTN4YFST',
    expiresInMs: 900_000,
    intervalMs: 5_000,
  });
  const { device_code, ...missing } = CODE_BODY;
  assert.throws(() => flow.parseCodeResponse(missing), (err) => err.kind === 'other');
  assert.throws(() => flow.parseCodeResponse(null));
});

test('parseCodeResponse defaults interval to 5 s when the server omits it', () => {
  const { interval, ...rest } = CODE_BODY;
  assert.equal(flow.parseCodeResponse(rest).intervalMs, 5_000);
});

test('classifyTokenResponse maps every documented answer', () => {
  assert.equal(flow.classifyTokenResponse(TOKEN_OK), 'token');
  assert.equal(flow.classifyTokenResponse(tokenErr('authorization_pending')), 'pending');
  assert.equal(flow.classifyTokenResponse(tokenErr('slow_down')), 'slow_down');
  assert.equal(flow.classifyTokenResponse(tokenErr('access_denied')), 'denied');
  assert.equal(flow.classifyTokenResponse(tokenErr('expired_token')), 'expired');
  assert.equal(flow.classifyTokenResponse(tokenErr('invalid_grant')), 'expired');
  assert.equal(flow.classifyTokenResponse(tokenErr('something_new')), 'expired');
  assert.equal(flow.classifyTokenResponse({ status: 429, body: {} }), 'rate_limited');
  assert.equal(flow.classifyTokenResponse({ status: 502, body: null }), 'network');
  assert.equal(flow.classifyTokenResponse(null), 'network');
});

test('classifyTrpcError maps status and tRPC codes to kinds', () => {
  assert.equal(flow.classifyTrpcError(trpcErr(401, 'UNAUTHORIZED')), 'unauthorized');
  assert.equal(flow.classifyTrpcError(trpcErr(412, 'DEVICE_NOT_REGISTERED')), 'not_registered');
  assert.equal(flow.classifyTrpcError(trpcErr(412, 'NO_WORKSPACE')), 'no_workspace');
  assert.equal(flow.classifyTrpcError(trpcErr(429, 'TOO_MANY_REQUESTS')), 'rate_limited');
  assert.equal(flow.classifyTrpcError({ status: 503, body: null }), 'network');
  assert.equal(flow.classifyTrpcError(trpcErr(400, 'BAD_REQUEST')), 'other');
});

// ─── Endpoint calls ───────────────────────────────────────────

test('requestDeviceCode posts the client id and parses the answer', async () => {
  const { fetchJson, calls } = fakeFetch({ '/api/auth/device/code': [{ status: 200, body: CODE_BODY }] });
  const parsed = await flow.requestDeviceCode({ api: API, fetchJson });
  assert.equal(parsed.deviceCode, 'dev-code-1');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, { client_id: 'frame-desktop' });
  assert.equal(calls[0].token, undefined);
});

test('requestDeviceCode turns 429 into rate_limited and a transport error into network', async () => {
  const limited = fakeFetch({ '/api/auth/device/code': [{ status: 429, body: {} }] });
  await assert.rejects(flow.requestDeviceCode({ api: API, fetchJson: limited.fetchJson }), (err) => err.kind === 'rate_limited');
  const down = fakeFetch({ '/api/auth/device/code': [new Error('ECONNREFUSED')] });
  await assert.rejects(flow.requestDeviceCode({ api: API, fetchJson: down.fetchJson }), (err) => err.kind === 'network');
});

test('registerDevice posts the device info with the bearer token and unwraps result.data', async () => {
  const { fetchJson, calls } = fakeFetch({ '/trpc/device.register': [ok(REGISTERED)] });
  const data = await flow.registerDevice({ api: API, token: 'tk', info: INFO, fetchJson });
  assert.deepEqual(data, REGISTERED);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].token, 'tk');
  assert.deepEqual(calls[0].body, INFO);
});

test('fetchMe is a GET with the bearer token and no body', async () => {
  const me = { user: REGISTERED.user, workspace: REGISTERED.workspace, device: { id: 'd1', name: 'Studio' } };
  const { fetchJson, calls } = fakeFetch({ '/trpc/device.me': [ok(me)] });
  assert.deepEqual(await flow.fetchMe({ api: API, token: 'tk', fetchJson }), me);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].token, 'tk');
  assert.equal('body' in calls[0], false);
  assert.equal(calls[0].query, '', 'a query without input sends no ?input');
});

test('callTrpc sends GET input as ?input=<url-encoded JSON> and no body', async () => {
  const { fetchJson, calls } = fakeFetch({ '/trpc/link.candidates': [ok([])] });
  const input = { folderName: 'My App & co', remote: 'git@github.com:a/b.git' };
  await flow.callTrpc({ api: API, token: 'tk', fetchJson, name: 'link.candidates', method: 'GET', input });
  assert.equal(calls[0].method, 'GET');
  assert.equal('body' in calls[0], false);
  assert.equal(calls[0].url, `${API}/trpc/link.candidates?input=${encodeURIComponent(JSON.stringify(input))}`);
  assert.deepEqual(JSON.parse(decodeURIComponent(calls[0].query.replace(/^input=/, ''))), input);
});

test('callTrpc posts mutation input as the body, with no query string', async () => {
  const { fetchJson, calls } = fakeFetch({ '/trpc/link.claim': [ok({ projectId: 'p1' })] });
  const input = { projectId: 'p1', frameProjectId: 'f1' };
  assert.deepEqual(
    await flow.callTrpc({ api: API, token: 'tk', fetchJson, name: 'link.claim', method: 'POST', input }),
    { projectId: 'p1' }
  );
  assert.equal(calls[0].url, `${API}/trpc/link.claim`);
  assert.deepEqual(calls[0].body, input);
});

test('signOutDevice posts an empty object with the bearer token', async () => {
  const { fetchJson, calls } = fakeFetch({ '/trpc/device.signOut': [ok({ ok: true })] });
  assert.deepEqual(await flow.signOutDevice({ api: API, token: 'tk', fetchJson }), { ok: true });
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, {});
  assert.equal(calls[0].token, 'tk');
});

test('tRPC error bodies become CloudError kinds with the server message', async () => {
  const cases = [
    [trpcErr(401, 'UNAUTHORIZED'), 'unauthorized'],
    [trpcErr(412, 'DEVICE_NOT_REGISTERED'), 'not_registered'],
    [trpcErr(412, 'NO_WORKSPACE', 'Create a workspace'), 'no_workspace'],
    [trpcErr(429, 'TOO_MANY_REQUESTS'), 'rate_limited'],
    [new Error('offline'), 'network'],
  ];
  for (const [answer, kind] of cases) {
    const { fetchJson } = fakeFetch({ '/trpc/device.me': [answer] });
    await assert.rejects(flow.fetchMe({ api: API, token: 'tk', fetchJson }), (err) => {
      assert.ok(err instanceof flow.CloudError);
      assert.equal(err.kind, kind);
      return true;
    });
  }
  const { fetchJson } = fakeFetch({ '/trpc/device.register': [trpcErr(412, 'NO_WORKSPACE', 'Create a workspace')] });
  await assert.rejects(flow.registerDevice({ api: API, token: 'tk', info: INFO, fetchJson }), (err) => {
    assert.equal(err.message, 'Create a workspace');
    assert.equal(err.status, 412);
    return true;
  });
});

// ─── Poll loop ────────────────────────────────────────────────

test('pollForToken waits the interval before each request and returns the token', async () => {
  const clock = fakeClock();
  const { fetchJson, calls } = fakeFetch({
    '/api/auth/device/token': [tokenErr('authorization_pending'), tokenErr('authorization_pending'), TOKEN_OK],
  });
  const result = await flow.pollForToken({ api: API, code: code(), fetchJson, sleep: clock.sleep, now: clock.now });
  assert.deepEqual(result, { ok: true, token: 'secret-token' });
  assert.deepEqual(clock.sleeps, [5000, 5000, 5000]);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].body, {
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    device_code: 'dev-code-1',
    client_id: 'frame-desktop',
  });
});

test('pollForToken adds 5 s to the interval on every slow_down', async () => {
  const clock = fakeClock();
  const { fetchJson } = fakeFetch({
    '/api/auth/device/token': [tokenErr('slow_down'), tokenErr('authorization_pending'), tokenErr('slow_down'), TOKEN_OK],
  });
  await flow.pollForToken({ api: API, code: code(), fetchJson, sleep: clock.sleep, now: clock.now });
  assert.deepEqual(clock.sleeps, [5000, 10000, 10000, 15000]);
});

test('pollForToken stops on access_denied', async () => {
  const clock = fakeClock();
  const { fetchJson, calls } = fakeFetch({
    '/api/auth/device/token': [tokenErr('authorization_pending'), tokenErr('access_denied'), TOKEN_OK],
  });
  const result = await flow.pollForToken({ api: API, code: code(), fetchJson, sleep: clock.sleep, now: clock.now });
  assert.deepEqual(result, { ok: false, reason: 'denied' });
  assert.equal(calls.length, 2);
});

for (const error of ['expired_token', 'invalid_grant', 'unsupported_grant_type']) {
  test(`pollForToken treats ${error} as expired`, async () => {
    const clock = fakeClock();
    const { fetchJson, calls } = fakeFetch({ '/api/auth/device/token': [tokenErr(error), TOKEN_OK] });
    const result = await flow.pollForToken({ api: API, code: code(), fetchJson, sleep: clock.sleep, now: clock.now });
    assert.deepEqual(result, { ok: false, reason: 'expired' });
    assert.equal(calls.length, 1);
  });
}

test('pollForToken doubles the wait on network errors and 429, capped at 30 s, then resets', async () => {
  const clock = fakeClock();
  const { fetchJson } = fakeFetch({
    '/api/auth/device/token': [
      new Error('offline'),
      { status: 429, body: {} },
      new Error('offline'),
      new Error('offline'),
      tokenErr('authorization_pending'),
      TOKEN_OK,
    ],
  });
  const result = await flow.pollForToken({ api: API, code: code(), fetchJson, sleep: clock.sleep, now: clock.now });
  assert.equal(result.ok, true);
  assert.deepEqual(clock.sleeps, [5000, 10000, 20000, 30000, 30000, 5000]);
});

test('pollForToken never waits less than the interval, even while backing off', async () => {
  const clock = fakeClock();
  const { fetchJson } = fakeFetch({ '/api/auth/device/token': [new Error('offline'), TOKEN_OK] });
  await flow.pollForToken({ api: API, code: code({ intervalMs: 40_000 }), fetchJson, sleep: clock.sleep, now: clock.now });
  assert.deepEqual(clock.sleeps, [40_000, 40_000]);
  assert.ok(clock.sleeps.every((ms) => ms >= 40_000));
});

test('pollForToken returns expired once expires_in elapses, without polling past the deadline', async () => {
  const clock = fakeClock();
  const start = clock.t;
  const { fetchJson, calls } = fakeFetch({ '/api/auth/device/token': [tokenErr('authorization_pending')] });
  const result = await flow.pollForToken({
    api: API,
    code: code({ expiresInMs: 12_000 }),
    fetchJson,
    sleep: clock.sleep,
    now: clock.now,
  });
  assert.deepEqual(result, { ok: false, reason: 'expired' });
  assert.equal(calls.length, 2, 'polls at 5 s and 10 s, not at 15 s');
  assert.deepEqual(clock.sleeps, [5000, 5000, 2000]);
  assert.equal(clock.t - start, 12_000);
});

test('pollForToken returns cancelled when the signal fires mid-wait', async () => {
  const clock = fakeClock();
  const controller = new AbortController();
  const { fetchJson, calls } = fakeFetch({ '/api/auth/device/token': [tokenErr('authorization_pending')] });
  clock.onSleep = () => {
    if (clock.sleeps.length === 2) controller.abort();
  };
  const result = await flow.pollForToken({
    api: API, code: code(), fetchJson, sleep: clock.sleep, now: clock.now, signal: controller.signal,
  });
  assert.deepEqual(result, { ok: false, reason: 'cancelled' });
  assert.equal(calls.length, 1);
});

test('pollForToken returns cancelled when the request itself is aborted', async () => {
  const clock = fakeClock();
  const controller = new AbortController();
  const { fetchJson } = fakeFetch({
    '/api/auth/device/token': [() => { controller.abort(); return abortError(); }],
  });
  const result = await flow.pollForToken({
    api: API, code: code(), fetchJson, sleep: clock.sleep, now: clock.now, signal: controller.signal,
  });
  assert.deepEqual(result, { ok: false, reason: 'cancelled' });
});

test('pollForToken does not start when the signal is already aborted', async () => {
  const clock = fakeClock();
  const controller = new AbortController();
  controller.abort();
  const { fetchJson, calls } = fakeFetch({ '/api/auth/device/token': [TOKEN_OK] });
  const result = await flow.pollForToken({
    api: API, code: code(), fetchJson, sleep: clock.sleep, now: clock.now, signal: controller.signal,
  });
  assert.deepEqual(result, { ok: false, reason: 'cancelled' });
  assert.equal(calls.length, 0);
});

// ─── Orchestration ────────────────────────────────────────────

function signInHarness(routes, extra = {}) {
  const clock = fakeClock();
  const { fetchJson, calls } = fakeFetch(routes);
  const states = [];
  const opened = [];
  const run = () =>
    flow.runSignIn({
      api: API,
      fetchJson,
      sleep: clock.sleep,
      now: clock.now,
      openUrl: (url) => opened.push(url),
      deviceInfo: INFO,
      onState: (patch) => states.push(patch),
      ...extra,
    });
  return { clock, calls, states, opened, run };
}

test('runSignIn walks requestingCode → awaitingApproval → registering and returns the session', async () => {
  const h = signInHarness({
    '/api/auth/device/code': [{ status: 200, body: CODE_BODY }],
    '/api/auth/device/token': [tokenErr('authorization_pending'), TOKEN_OK],
    '/trpc/device.register': [ok(REGISTERED)],
  });
  const result = await h.run();
  assert.deepEqual(h.states, [
    { state: 'requestingCode' },
    { state: 'awaitingApproval', userCode: 'TTN4-YFST', verificationUrl: 'http://web.test/device?code=TTN4YFST' },
    { state: 'registering' },
  ]);
  assert.deepEqual(h.opened, ['http://web.test/device?code=TTN4YFST']);
  assert.deepEqual(result, {
    ok: true,
    token: 'secret-token',
    session: { deviceId: 'd1', user: REGISTERED.user, workspace: REGISTERED.workspace },
  });
  assert.equal('access' in result.session, false);
  const register = h.calls.filter((c) => c.path === '/trpc/device.register');
  assert.equal(register.length, 1);
  assert.equal(register[0].token, 'secret-token');
  assert.ok(!JSON.stringify(h.states).includes('secret-token'), 'the token never reaches onState');
});

test('runSignIn sends the device code untouched, not the display grouping', async () => {
  const h = signInHarness({
    '/api/auth/device/code': [{ status: 200, body: CODE_BODY }],
    '/api/auth/device/token': [TOKEN_OK],
    '/trpc/device.register': [ok(REGISTERED)],
  });
  await h.run();
  assert.equal(tokenPolls(h.calls)[0].body.device_code, 'dev-code-1');
});

test('runSignIn reports noWorkspace when register answers 412 NO_WORKSPACE', async () => {
  const h = signInHarness({
    '/api/auth/device/code': [{ status: 200, body: CODE_BODY }],
    '/api/auth/device/token': [TOKEN_OK],
    '/trpc/device.register': [trpcErr(412, 'NO_WORKSPACE')],
  });
  assert.deepEqual(await h.run(), { ok: false, reason: 'noWorkspace' });
});

test('runSignIn signs in without a workspace when register answers workspace: null', async () => {
  const h = signInHarness({
    '/api/auth/device/code': [{ status: 200, body: CODE_BODY }],
    '/api/auth/device/token': [TOKEN_OK],
    '/trpc/device.register': [ok({ ...REGISTERED, workspace: null })],
  });
  const result = await h.run();
  assert.equal(result.ok, true);
  assert.equal(result.token, 'secret-token');
  assert.equal(result.session.workspace, null);
  assert.deepEqual(result.session.user, REGISTERED.user);
});

test('runSignIn reports rateLimited when /device/code answers 429', async () => {
  const h = signInHarness({ '/api/auth/device/code': [{ status: 429, body: {} }] });
  assert.deepEqual(await h.run(), { ok: false, reason: 'rateLimited' });
  assert.deepEqual(h.states, [{ state: 'requestingCode' }]);
  assert.equal(h.opened.length, 0);
});

test('runSignIn reports network when the server cannot be reached', async () => {
  const h = signInHarness({ '/api/auth/device/code': [new Error('ECONNREFUSED')] });
  assert.deepEqual(await h.run(), { ok: false, reason: 'network' });
});

test('runSignIn never registers after a failed poll', async () => {
  for (const [answer, reason] of [[tokenErr('access_denied'), 'denied'], [tokenErr('expired_token'), 'expired']]) {
    const h = signInHarness({
      '/api/auth/device/code': [{ status: 200, body: CODE_BODY }],
      '/api/auth/device/token': [answer],
      '/trpc/device.register': [ok(REGISTERED)],
    });
    assert.deepEqual(await h.run(), { ok: false, reason });
    assert.equal(h.calls.filter((c) => c.path === '/trpc/device.register').length, 0);
    assert.ok(!h.states.some((s) => s.state === 'registering'));
  }
});

test('runSignIn returns cancelled when aborted mid-poll and does not register', async () => {
  const controller = new AbortController();
  const h = signInHarness(
    {
      '/api/auth/device/code': [{ status: 200, body: CODE_BODY }],
      '/api/auth/device/token': [tokenErr('authorization_pending')],
      '/trpc/device.register': [ok(REGISTERED)],
    },
    { signal: controller.signal }
  );
  h.clock.onSleep = () => {
    if (h.clock.sleeps.length === 3) controller.abort();
  };
  assert.deepEqual(await h.run(), { ok: false, reason: 'cancelled' });
  assert.equal(h.calls.filter((c) => c.path === '/trpc/device.register').length, 0);
});

test('runSignIn survives an openUrl or onState that throws', async () => {
  const h = signInHarness(
    {
      '/api/auth/device/code': [{ status: 200, body: CODE_BODY }],
      '/api/auth/device/token': [TOKEN_OK],
      '/trpc/device.register': [ok(REGISTERED)],
    },
    {
      openUrl: () => { throw new Error('no browser'); },
      onState: () => { throw new Error('listener bug'); },
    }
  );
  const result = await h.run();
  assert.equal(result.ok, true);
});

test('refreshSession returns the me payload as a session', async () => {
  const me = { user: REGISTERED.user, workspace: REGISTERED.workspace, device: { id: 'd1', name: 'Studio' } };
  const { fetchJson } = fakeFetch({ '/trpc/device.me': [ok(me)] });
  const result = await flow.refreshSession({ api: API, token: 'tk', deviceInfo: INFO, fetchJson });
  assert.deepEqual(result, { ok: true, session: { deviceId: 'd1', ...me } });
});

test('refreshSession returns a null workspace as null', async () => {
  const me = { user: REGISTERED.user, workspace: null, device: { id: 'd1', name: 'Studio' } };
  const { fetchJson } = fakeFetch({ '/trpc/device.me': [ok(me)] });
  const result = await flow.refreshSession({ api: API, token: 'tk', deviceInfo: INFO, fetchJson });
  assert.equal(result.ok, true);
  assert.equal(result.session.workspace, null);
});

test('refreshSession picks up a workspace that appears on a later me', async () => {
  const device = { id: 'd1', name: 'Studio' };
  const { fetchJson } = fakeFetch({
    '/trpc/device.me': [
      ok({ user: REGISTERED.user, workspace: null, device }),
      ok({ user: REGISTERED.user, workspace: REGISTERED.workspace, device }),
    ],
  });
  const first = await flow.refreshSession({ api: API, token: 'tk', deviceInfo: INFO, fetchJson });
  const second = await flow.refreshSession({ api: API, token: 'tk', deviceInfo: INFO, fetchJson });
  assert.equal(first.session.workspace, null);
  assert.deepEqual(second.session.workspace, { name: 'Lab', slug: 'lab' });
});

test('a session never carries access, even when an older server still sends it', async () => {
  const me = { user: REGISTERED.user, workspace: REGISTERED.workspace, device: { id: 'd1' }, access: { planLabel: 'Pro' } };
  const { fetchJson } = fakeFetch({ '/trpc/device.me': [ok(me)] });
  const result = await flow.refreshSession({ api: API, token: 'tk', deviceInfo: INFO, fetchJson });
  assert.equal(result.ok, true);
  assert.equal('access' in result.session, false);
});

test('refreshSession re-registers once after DEVICE_NOT_REGISTERED and retries me', async () => {
  const me = { user: REGISTERED.user, workspace: REGISTERED.workspace, device: { id: 'd2', name: 'Studio' } };
  const { fetchJson, calls } = fakeFetch({
    '/trpc/device.me': [trpcErr(412, 'DEVICE_NOT_REGISTERED'), ok(me)],
    '/trpc/device.register': [ok(REGISTERED)],
  });
  const result = await flow.refreshSession({ api: API, token: 'tk', deviceInfo: INFO, fetchJson });
  assert.equal(result.ok, true);
  assert.equal(result.session.deviceId, 'd2');
  assert.deepEqual(calls.map((c) => c.path), ['/trpc/device.me', '/trpc/device.register', '/trpc/device.me']);
  assert.deepEqual(calls[1].body, INFO);
});

test('refreshSession does not loop when the retry is still unregistered', async () => {
  const { fetchJson, calls } = fakeFetch({
    '/trpc/device.me': [trpcErr(412, 'DEVICE_NOT_REGISTERED')],
    '/trpc/device.register': [ok(REGISTERED)],
  });
  const result = await flow.refreshSession({ api: API, token: 'tk', deviceInfo: INFO, fetchJson });
  assert.deepEqual(result, { ok: false, reason: 'other' });
  assert.equal(calls.length, 3);
});

test('refreshSession reports unauthorized on 401 and network when offline', async () => {
  const dead = fakeFetch({ '/trpc/device.me': [trpcErr(401, 'UNAUTHORIZED')] });
  assert.deepEqual(
    await flow.refreshSession({ api: API, token: 'tk', deviceInfo: INFO, fetchJson: dead.fetchJson }),
    { ok: false, reason: 'unauthorized' }
  );
  const offline = fakeFetch({ '/trpc/device.me': [new Error('offline')] });
  assert.deepEqual(
    await flow.refreshSession({ api: API, token: 'tk', deviceInfo: INFO, fetchJson: offline.fetchJson }),
    { ok: false, reason: 'network' }
  );
});

// ─── Early access ─────────────────────────────────────────────

test('fetchInviteMode reads invite.mode with a GET and no token', async () => {
  const { fetchJson, calls } = fakeFetch({ '/trpc/invite.mode': [ok({ inviteOnly: true })] });
  assert.equal(await flow.fetchInviteMode({ api: API, fetchJson }), true);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].token, undefined);
  assert.equal(calls[0].query, '');
});

test('fetchInviteMode answers false for an open server', async () => {
  const { fetchJson } = fakeFetch({ '/trpc/invite.mode': [ok({ inviteOnly: false })] });
  assert.equal(await flow.fetchInviteMode({ api: API, fetchJson }), false);
});

test('fetchInviteMode answers null for a malformed answer or a server without invite.mode', async () => {
  for (const answer of [ok({}), ok({ inviteOnly: 'yes' }), ok(null), trpcErr(404, 'NOT_FOUND')]) {
    const { fetchJson } = fakeFetch({ '/trpc/invite.mode': [answer] });
    assert.equal(await flow.fetchInviteMode({ api: API, fetchJson }), null, JSON.stringify(answer));
  }
});

test('fetchInviteMode throws a CloudError when the server cannot be reached', async () => {
  const { fetchJson } = fakeFetch({ '/trpc/invite.mode': [new Error('ECONNREFUSED')] });
  await assert.rejects(flow.fetchInviteMode({ api: API, fetchJson }), (err) => err.kind === 'network');
});

test('normalizeWaitlistEmail trims and lowercases the whole address, like the server', () => {
  assert.equal(flow.normalizeWaitlistEmail('  Ada@Example.COM '), 'ada@example.com');
  assert.equal(flow.normalizeWaitlistEmail('a@b.co'), 'a@b.co');
});

test('normalizeWaitlistEmail refuses what cannot be an address', () => {
  const tooLong = `${'x'.repeat(flow.WAITLIST_EMAIL_MAX)}@a.co`;
  for (const bad of ['', '   ', 'ada', 'a@b', '@b.co', 'a@@b.co', 'a@b@c.co', 'a b@c.co', 'a@.co', 'a@b.co.', tooLong, null, 42]) {
    assert.equal(flow.normalizeWaitlistEmail(bad), null, String(bad));
  }
});

test('joinWaitlist posts the address with source desktop and no token', async () => {
  const { fetchJson, calls } = fakeFetch({ '/trpc/waitlist.join': [ok({ ok: true })] });
  assert.deepEqual(await flow.joinWaitlist({ api: API, email: 'ada@example.com', fetchJson }), { ok: true });
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].token, undefined);
  assert.deepEqual(calls[0].body, { email: 'ada@example.com', source: 'desktop' });
});

test('joinWaitlist maps every failure to a reason and never throws', async () => {
  const cases = [
    [trpcErr(400, 'BAD_REQUEST'), 'invalid'],
    [trpcErr(429, 'TOO_MANY_REQUESTS'), 'rateLimited'],
    [trpcErr(404, 'NOT_FOUND'), 'unavailable'],
    [{ status: 502, body: {} }, 'network'],
    [new Error('ECONNREFUSED'), 'network'],
  ];
  for (const [answer, reason] of cases) {
    const { fetchJson } = fakeFetch({ '/trpc/waitlist.join': [answer] });
    assert.deepEqual(await flow.joinWaitlist({ api: API, email: 'ada@example.com', fetchJson }), { ok: false, reason });
  }
});

// ─── Early access on this machine ─────────────────────────────

test('earlyAccessFields carries the marker, the invite mode and the address while signed out', () => {
  assert.deepEqual(flow.earlyAccessFields({ signedIn: false, inviteOnly: true, waitlistEmail: 'ada@example.com' }), {
    inviteOnly: true,
    waitlistEmail: 'ada@example.com',
  });
  assert.deepEqual(flow.earlyAccessFields({ signedIn: false, inviteOnly: true, signedInBefore: true }), {
    inviteOnly: true,
    signedInBefore: true,
  });
  // The marker travels before the server has said anything about invites.
  assert.deepEqual(flow.earlyAccessFields({ signedIn: false, inviteOnly: null, signedInBefore: true }), {
    signedInBefore: true,
  });
});

test('earlyAccessFields is empty while signed in and on a machine with nothing to say', () => {
  assert.deepEqual(
    flow.earlyAccessFields({ signedIn: true, inviteOnly: true, waitlistEmail: 'ada@example.com', signedInBefore: true }),
    {}
  );
  for (const input of [undefined, {}, { signedIn: false, inviteOnly: null, waitlistEmail: null, signedInBefore: false }]) {
    assert.deepEqual(flow.earlyAccessFields(input), {}, JSON.stringify(input));
  }
  // A machine that never signed in sends no marker at all, as before.
  assert.equal('signedInBefore' in flow.earlyAccessFields({ inviteOnly: true, signedInBefore: false }), false);
});

test('signedInWrites sets the marker and deletes the waitlist address', () => {
  const keys = { markerKey: 'cloudSignedInBefore', waitlistKey: 'cloudWaitlistEmail' };
  assert.deepEqual(flow.signedInWrites({ signedInBefore: false, waitlistEmail: 'ada@example.com', ...keys }), [
    ['cloudSignedInBefore', true],
    ['cloudWaitlistEmail', null],
  ]);
  assert.deepEqual(flow.signedInWrites({ signedInBefore: false, waitlistEmail: null, ...keys }), [
    ['cloudSignedInBefore', true],
  ]);
});

test('signedInWrites writes nothing once the marker is stored and no address is left', () => {
  const keys = { markerKey: 'cloudSignedInBefore', waitlistKey: 'cloudWaitlistEmail' };
  assert.deepEqual(flow.signedInWrites({ signedInBefore: true, waitlistEmail: null, ...keys }), []);
  // An address that came back (joined again while signed out) still goes.
  assert.deepEqual(flow.signedInWrites({ signedInBefore: true, waitlistEmail: 'ada@example.com', ...keys }), [
    ['cloudWaitlistEmail', null],
  ]);
});
