/**
 * serverConnection harness (server-hardening T04): the real connection loop
 * and installer against a "remote" home on this machine.
 *
 * test/fixtures/fake-ssh.js stands in for ssh (remote commands run with
 * HOME=<remote home>; `-L` becomes a TCP proxy). The remote Frame Server is
 * installed with the real install script from a test package whose server
 * (fixtures/fake-frame-server/index-ws.js) speaks the real protocol.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-conn-'));
const LOCAL_HOME = path.join(SANDBOX, 'local');
const REMOTE_HOME = path.join(SANDBOX, 'remote');
const BIN = path.join(SANDBOX, 'bin');
for (const d of [LOCAL_HOME, REMOTE_HOME, BIN]) fs.mkdirSync(d, { recursive: true });

// The "remote" looks like Linux and has no systemd user session.
fs.writeFileSync(path.join(BIN, 'uname'), '#!/bin/sh\ncase "$1" in -s) echo Linux;; -m) echo x86_64;; *) echo Linux x86_64;; esac\n', { mode: 0o755 });
fs.writeFileSync(path.join(BIN, 'systemctl'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });

process.env.HOME = LOCAL_HOME;
process.env.FRAME_SSH = path.join(FIX, 'fake-ssh.js');
process.env.FAKE_REMOTE_HOME = REMOTE_HOME;
process.env.FAKE_BIN_DIR = BIN;
process.env.FAKE_WS_MODULE = require.resolve('ws');
process.env.FAKE_PROTOCOL_MODULE = path.join(ROOT, 'src', 'shared', 'serverProtocol.js');
process.env.FRAME_INSTALL_HEALTH_SECONDS = '8';

const STUBS = {
  '@aptabase/electron/main': { initialize() {}, trackEvent() {} },
  'posthog-node': { PostHog: class { capture() {} captureException() {} identify() {} shutdown() { return Promise.resolve(); } } },
  electron: {
    app: { getPath: () => path.join(SANDBOX, 'userData'), getVersion: () => '9.0.0', isPackaged: true, on() {} },
    ipcMain: { handle() {}, on() {}, removeHandler() {} },
    BrowserWindow: { getAllWindows: () => [] }
  }
};
const loadOriginal = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return loadOriginal.call(this, request, ...rest);
};

fs.mkdirSync(path.join(SANDBOX, 'userData'), { recursive: true });
const userSettings = require('../src/main/userSettings');
userSettings.init();
// A build with one saved server (multi-server-connections S7), left
// disconnected so init does not connect it before the tests do.
userSettings.set('server', { host: 'box', autoConnect: false });
const sc = require('../src/main/serverConnection');
const installer = require('../src/main/serverInstaller');
const { IPC } = require('../src/shared/ipcChannels');
sc.init(null, '9.0.0');

const SERVER_HOME = path.join(REMOTE_HOME, '.frame-server');

// A second server (multi-server-connections): its own remote home.
const REMOTE_HOME_B = path.join(SANDBOX, 'remote-b');
fs.mkdirSync(REMOTE_HOME_B, { recursive: true });
process.env.FAKE_REMOTE_HOMES = JSON.stringify({ box: REMOTE_HOME, 'box-alias': REMOTE_HOME, boxb: REMOTE_HOME_B });

function remotePid(home = REMOTE_HOME) {
  try { return JSON.parse(fs.readFileSync(path.join(home, '.frame-server', 'connection.json'), 'utf8')).pid; } catch (_) { return null; }
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch (_) { return false; } }

async function waitFor(pred, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what} (status: ${JSON.stringify(sc.getStatus())})`);
}

function installRemote(version, home = REMOTE_HOME) {
  const top = path.join(SANDBOX, 'pkg', `frame-server-${version}`);
  fs.mkdirSync(path.join(top, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(top, 'app', 'src', 'server'), { recursive: true });
  fs.mkdirSync(path.join(top, 'app', 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'src', 'server', 'bin', 'frame-server'), path.join(top, 'bin', 'frame-server'));
  fs.chmodSync(path.join(top, 'bin', 'frame-server'), 0o755);
  fs.copyFileSync(path.join(FIX, 'fake-frame-server', 'index-ws.js'), path.join(top, 'app', 'src', 'server', 'index.js'));
  fs.copyFileSync(path.join(ROOT, 'scripts', 'install-frame-server.sh'), path.join(top, 'app', 'scripts', 'install-frame-server.sh'));
  fs.writeFileSync(path.join(top, 'VERSION'), `${version}\n`);
  const tarball = path.join(SANDBOX, 'pkg', `fs-${version}.tar.gz`);
  assert.equal(spawnSync('tar', ['-czf', tarball, '-C', path.dirname(top), path.basename(top)]).status, 0);
  const r = spawnSync('bash', [path.join(ROOT, 'scripts', 'install-frame-server.sh'), '--package-file', tarball], {
    env: { ...process.env, HOME: home, PATH: `${BIN}:${process.env.PATH}`, FRAME_SERVER_HOME: '' }, encoding: 'utf8'
  });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
}

after(() => {
  sc.disconnect({ forget: true, quiet: true });
  for (const home of [REMOTE_HOME, REMOTE_HOME_B]) {
    const pid = remotePid(home);
    if (pid && alive(pid)) process.kill(pid, 'SIGTERM');
  }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

installRemote('9.0.0');

test('S7: a single saved server from an older build migrates and keeps its setting', () => {
  const servers = sc.list();
  assert.equal(servers.length, 1);
  assert.equal(servers[0].host, 'box');
  assert.match(servers[0].key, /^[0-9a-f]{8}$/);
  assert.equal(servers[0].autoConnect, false, 'left disconnected stays off');
  assert.deepEqual(userSettings.get('server'), { host: 'box', autoConnect: false }, 'the old setting is left for a downgrade');
});

test('S4: after the server dies leaving connection.json, the desktop starts it and reconnects', async () => {
  sc.connect('box');
  await waitFor(() => sc.isConnected(), 20000, 'the first connect');
  const first = remotePid();
  process.kill(first, 'SIGKILL'); // connection.json stays behind
  await waitFor(() => !sc.isConnected(), 5000, 'the loss to be noticed');
  await waitFor(() => sc.isConnected() && remotePid() !== first && alive(remotePid()), 25000, 'a restarted server and a reconnect');
});

test('S11: a socket that closes before hello is retried, not left connecting forever', async () => {
  sc.disconnect({ forget: false, quiet: true });
  fs.writeFileSync(path.join(SERVER_HOME, 'fake-mode'), 'close');
  sc.connect('box');
  await waitFor(() => sc.getStatus().state === 'error', 10000, 'the failed attempt to be reported');
  fs.rmSync(path.join(SERVER_HOME, 'fake-mode'));
  await waitFor(() => sc.isConnected(), 20000, 'a connect once the server says hello');
});

test('S4: the probe of a hand-run server checks its pid', async () => {
  const other = path.join(SANDBOX, 'remote-manual');
  fs.mkdirSync(path.join(other, '.frame-server'), { recursive: true });
  fs.writeFileSync(path.join(other, '.frame-server', 'connection.json'), JSON.stringify({ port: 1, token: 't', protocol: 1, frameVersion: '9.0.0', pid: 999999 }));
  process.env.FAKE_REMOTE_HOME = other;
  try {
    const p = await installer.probe('manualbox'); // a host with no home of its own in FAKE_REMOTE_HOMES
    assert.equal(p.installed.manual, true);
    assert.equal(p.installed.running, false, 'a dead pid is not a running server');
  } finally {
    process.env.FAKE_REMOTE_HOME = REMOTE_HOME;
  }
});

test('S10: a second update or rollback while one is checking agents is refused', async () => {
  await waitFor(() => sc.isConnected(), 20000, 'connected');
  fs.writeFileSync(path.join(SERVER_HOME, 'fake-mode'), 'slow-list');
  const handlers = {};
  sc.setupIPC({ handle: (ch, fn) => { handlers[ch] = fn; }, removeHandler() {}, on() {} });
  const [a, b] = await Promise.all([
    handlers[IPC.SERVER_ROLLBACK]({}, {}),
    new Promise((r) => setTimeout(r, 100)).then(() => handlers[IPC.SERVER_ROLLBACK]({}, {}))
  ]);
  fs.rmSync(path.join(SERVER_HOME, 'fake-mode'), { force: true });
  assert.match(String(b.error), /already running/, `second call: ${JSON.stringify(b)}`);
  assert.ok(a, 'the first ran');
});

// ─── S8: Frame Server on a Unix socket ───────────────────────

test('S8: the desktop forwards to the server\'s socket and connects', async () => {
  sc.connect('box'); // the S10 rollback above ended in an error state
  await waitFor(() => sc.isConnected(), 20000, 'connected');
  fs.writeFileSync(path.join(SERVER_HOME, 'fake-socket'), '');
  const before = remotePid();
  process.kill(before, 'SIGKILL'); // restarted by the reconnect, now on the socket
  await waitFor(() => sc.isConnected() && remotePid() !== before, 25000, 'a reconnect over the socket');
  const info = JSON.parse(fs.readFileSync(path.join(SERVER_HOME, 'connection.json'), 'utf8'));
  assert.ok(info.socket && !info.port, 'connection.json names a socket, no port');
  const ping = await sc.of(sc.list()[0].key).call('server.ping', {});
  assert.equal(ping.platform, 'linux');
});

test('S8: an sshd that refuses socket forwarding gets a message naming the setting', async () => {
  sc.disconnect({ forget: false, quiet: true });
  process.env.FAKE_SSH_NO_STREAMLOCAL = '1';
  try {
    sc.connect('box');
    await waitFor(() => /AllowStreamLocalForwarding/.test(String(sc.getStatus().error)), 15000, 'the sshd message');
  } finally {
    delete process.env.FAKE_SSH_NO_STREAMLOCAL;
    sc.disconnect({ forget: false, quiet: true });
    fs.rmSync(path.join(SERVER_HOME, 'fake-socket'), { force: true });
  }
});

// ─── multi-server-connections: several servers at once ───────

function keyOf(host) {
  const e = sc.list().find((s) => s.host === host);
  return e ? e.key : null;
}

test('S1: adding a second server keeps the first connected; both answer', async () => {
  fs.writeFileSync(path.join(SERVER_HOME, 'server-id'), 'aaaaaaaaaaaaaaaa\n');
  installRemote('9.0.0', REMOTE_HOME_B);
  fs.writeFileSync(path.join(REMOTE_HOME_B, '.frame-server', 'server-id'), 'bbbbbbbbbbbbbbbb\n');
  sc.connect('box');
  await waitFor(() => sc.of(keyOf('box')).isConnected(), 20000, 'box connected');
  const r = sc.connect('boxb');
  assert.equal(r.error, null);
  await waitFor(() => sc.of(keyOf('boxb')).isConnected(), 25000, 'boxb connected');
  assert.ok(sc.of(keyOf('box')).isConnected(), 'box is still connected');
  assert.equal(sc.of(keyOf('box')).getStatus().serverId, 'aaaaaaaaaaaaaaaa');
  assert.equal(sc.of(keyOf('boxb')).getStatus().serverId, 'bbbbbbbbbbbbbbbb');
  assert.equal((await sc.of(keyOf('box')).call('server.ping', {})).platform, 'linux');
  assert.equal((await sc.of(keyOf('boxb')).call('server.ping', {})).platform, 'linux');
  assert.deepEqual(sc.list().map((s) => s.serverId), ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'], 'ids are saved');
});

test('S2: one server dropping leaves the other connected, and it reconnects on its own', async () => {
  const a = sc.of(keyOf('box'));
  const b = sc.of(keyOf('boxb'));
  const events = [];
  const off = sc.on('disconnected', (payload, key) => events.push(key));
  try {
    const before = remotePid(REMOTE_HOME_B);
    process.kill(before, 'SIGKILL');
    await waitFor(() => !b.isConnected(), 5000, 'boxb loss to be noticed');
    assert.ok(a.isConnected(), 'box is untouched');
    assert.deepEqual(events, [keyOf('boxb')], 'the event names the server that dropped');
    await waitFor(() => b.isConnected() && remotePid(REMOTE_HOME_B) !== before, 25000, 'boxb back');
    assert.ok(a.isConnected());
  } finally {
    off();
  }
});

test('S6: disconnecting one server keeps the other set to reconnect on launch', () => {
  sc.disconnect(keyOf('boxb'), { forget: true });
  assert.equal(sc.of(keyOf('boxb')).getStatus().state, 'off');
  assert.ok(sc.of(keyOf('box')).isConnected());
  const saved = userSettings.get('servers');
  assert.deepEqual(saved.filter((s) => s.autoConnect).map((s) => s.host), ['box']);
});

test('the same machine through a second alias is refused, naming the first', async () => {
  const sent = [];
  sc.init({ isDestroyed: () => false, webContents: { send: (ch, p) => sent.push([ch, p]) } }, '9.0.0');
  sc.connect('box-alias');
  await waitFor(() => !keyOf('box-alias'), 25000, 'the duplicate entry to be removed');
  const notice = sent.map(([, p]) => p && p.notice).find(Boolean);
  assert.deepEqual({ kind: notice.kind, host: notice.host, existingHost: notice.existingHost }, { kind: 'duplicate', host: 'box-alias', existingHost: 'box' });
  assert.ok(sc.of(keyOf('box')).isConnected(), 'the first entry is untouched');
  sc.init(null, '9.0.0');
});

test('S10: updating one server asks only about its own agents and leaves the other connected', async () => {
  sc.connect('boxb');
  await waitFor(() => sc.of(keyOf('boxb')).isConnected() && sc.of(keyOf('box')).isConnected(), 25000, 'both connected');
  const agent = (id) => ({ terminalId: id, workspaceId: 'w1', process: { processName: 'claude', commandLine: 'claude' } });
  fs.writeFileSync(path.join(SERVER_HOME, 'fake-terminals'), JSON.stringify([agent('srv-a-1')]));
  fs.writeFileSync(path.join(REMOTE_HOME_B, '.frame-server', 'fake-terminals'), JSON.stringify([agent('srv-b-1'), agent('srv-b-2')]));
  const handlers = {};
  sc.setupIPC({ handle: (ch, fn) => { handlers[ch] = fn; }, removeHandler() {}, on() {} });
  try {
    const res = await handlers[IPC.SERVER_UPDATE]({}, { key: keyOf('boxb') });
    assert.equal(res.needsConsent, true);
    assert.deepEqual(res.agents.map((a) => a.terminalId), ['srv-b-1', 'srv-b-2'], "only boxb's agents");
    assert.ok(sc.of(keyOf('box')).isConnected() && sc.of(keyOf('boxb')).isConnected(), 'asking changes nothing');
    // Confirmed: an installer action runs on boxb only (a rollback: no
    // download in tests — whether it succeeds does not matter here); box
    // never drops while it runs.
    let boxDropped = false;
    const off = sc.on('disconnected', (p, k) => { if (k === keyOf('box')) boxDropped = true; });
    try {
      const states = [];
      const offS = sc.on('status', (st, k) => { if (k === keyOf('boxb')) states.push(st.state); });
      await handlers[IPC.SERVER_ROLLBACK]({}, { key: keyOf('boxb'), confirmAgents: true });
      offS();
      assert.ok(states.includes('installing'), `boxb ran the installer: ${states.join(',')}`);
      assert.equal(boxDropped, false, 'box stayed connected through boxb\'s install');
      assert.ok(sc.of(keyOf('box')).isConnected());
      sc.connect('boxb');
      await waitFor(() => sc.of(keyOf('boxb')).isConnected(), 30000, 'boxb back');
    } finally {
      off();
    }
  } finally {
    fs.rmSync(path.join(SERVER_HOME, 'fake-terminals'), { force: true });
    fs.rmSync(path.join(REMOTE_HOME_B, '.frame-server', 'fake-terminals'), { force: true });
  }
});

test('S8: removing a server closes only its link and forgets it', async () => {
  sc.connect('boxb');
  await waitFor(() => sc.of(keyOf('boxb')).isConnected(), 25000, 'boxb connected');
  const key = keyOf('boxb');
  const removed = [];
  const off = sc.on('removed', (p, k) => removed.push(k));
  try {
    const link = sc.of(key);
    sc.remove(key);
    assert.equal(link.isConnected(), false);
    assert.equal(sc.of(key), null);
    assert.equal(keyOf('boxb'), null);
    assert.deepEqual(removed, [key]);
    assert.ok(sc.of(keyOf('box')).isConnected(), 'box stays connected');
  } finally {
    off();
  }
});

// ─── server-first-connect: what an ssh failure means ─────────

test('T02: a first-connect ssh failure carries its kind in the status', async () => {
  const cases = { newhost: 'host-unknown', changedhost: 'host-changed', deniedhost: 'auth', nohost: 'no-resolve' };
  for (const [host, kind] of Object.entries(cases)) {
    sc.add(host);
    const key = keyOf(host);
    try {
      sc.connect(key);
      await waitFor(() => sc.of(key).getStatus().errorKind === kind, 15000, `${host} → ${kind}`);
      const s = sc.of(key).getStatus();
      assert.equal(s.state, 'error', host);
      assert.match(String(s.error), new RegExp(`ssh ${host}:`), 'ssh\'s own line stays as the fallback');
    } finally {
      sc.remove(key);
    }
  }
  assert.ok(sc.of(keyOf('box')).isConnected(), 'the other server is untouched');
});

test('T03: an access error waits for Connect; a network error keeps retrying', async () => {
  const log = path.join(SANDBOX, 'ssh-runs.log');
  const runs = (host) => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter((h) => h === host).length : 0);
  process.env.FAKE_SSH_LOG = log;
  try {
    sc.add('deniedhost');
    const denied = keyOf('deniedhost');
    sc.connect(denied);
    await waitFor(() => sc.of(denied).getStatus().errorKind === 'auth', 15000, 'the refused login');
    await new Promise((r) => setTimeout(r, 3500)); // backoff would have run ssh twice more by now
    assert.equal(runs('deniedhost'), 1, 'ssh ran once, then the loop waited');
    assert.equal(sc.of(denied).getStatus().state, 'error');
    sc.connect(denied);
    await waitFor(() => runs('deniedhost') === 2, 10000, 'Connect running ssh again');
    sc.remove(denied);

    sc.add('nohost');
    const nohost = keyOf('nohost');
    sc.connect(nohost);
    await waitFor(() => runs('nohost') >= 2, 10000, 'a second try at an unresolved host');
    assert.equal(sc.of(nohost).getStatus().errorKind, 'no-resolve');
    sc.remove(nohost);
  } finally {
    delete process.env.FAKE_SSH_LOG;
  }
});
