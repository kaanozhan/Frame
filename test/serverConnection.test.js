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
require('../src/main/userSettings').init();
const sc = require('../src/main/serverConnection');
const installer = require('../src/main/serverInstaller');
const { IPC } = require('../src/shared/ipcChannels');
sc.init(null, '9.0.0');

const SERVER_HOME = path.join(REMOTE_HOME, '.frame-server');

function remotePid() {
  try { return JSON.parse(fs.readFileSync(path.join(SERVER_HOME, 'connection.json'), 'utf8')).pid; } catch (_) { return null; }
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

function installRemote(version) {
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
    env: { ...process.env, HOME: REMOTE_HOME, PATH: `${BIN}:${process.env.PATH}`, FRAME_SERVER_HOME: '' }, encoding: 'utf8'
  });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
}

after(() => {
  sc.disconnect({ forget: true, quiet: true });
  const pid = remotePid();
  if (pid && alive(pid)) process.kill(pid, 'SIGTERM');
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

installRemote('9.0.0');

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
    const p = await installer.probe('box');
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
  const ping = await sc.call('server.ping', {});
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
