/**
 * Server connection — the desktop's link to Frame Server
 * (server-workspaces spec, T2/B1).
 *
 * One server at a time. Connecting is a loop that runs the user's own `ssh`:
 *
 *   1. `ssh <host> cat ~/.frame-server/connection.json`  → port + token
 *   2. `ssh -N -L 127.0.0.1:<local>:127.0.0.1:<port> <host>` (the tunnel)
 *   3. WebSocket through the tunnel with the Bearer token and the desktop
 *      Origin; both sides say hello (same protocol) → connected
 *
 * When the tunnel or socket drops, everything in flight fails, the status
 * becomes "reconnecting" and the loop starts again with backoff until the
 * user disconnects. Frame stores no SSH secrets: `BatchMode=yes` means a host
 * that needs a typed password cannot be used (keys, agent, Tailscale SSH can).
 *
 * Before the first attempt of a session (and whenever the server is found
 * not running) the host is probed (serverInstaller): a missing or outdated
 * Frame Server — or one speaking another protocol — sets `needs-install` /
 * `needs-update` and the loop waits for the user instead of retrying; an
 * installed but stopped one is started. Install, update and rollback run
 * through SERVER_INSTALL / SERVER_UPDATE / SERVER_ROLLBACK with progress on
 * SERVER_INSTALL_PROGRESS (server-install-update spec).
 *
 * Main-process modules use `call(method, params)` and `on(channel, fn)`;
 * the renderer sees SERVER_STATUS_CHANGED and the SERVER_* invokes.
 * `FRAME_SSH` overrides the ssh binary (tests use a stand-in).
 */

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { EventEmitter } = require('events');
const WebSocket = require('ws');
const { IPC } = require('../shared/ipcChannels');
const P = require('../shared/serverProtocol');
const { DESKTOP_ORIGIN } = require('../shared/serverSecurity');
const { consentNeeded } = require('../shared/serverInstall');
const { parseSshConfigHosts } = require('../shared/serverRouting');
const userSettings = require('./userSettings');
const logger = require('./logger');

const SETTING = 'server';
const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
const SSH_TIMEOUT_MS = 20000;
const TUNNEL_READY_MS = 15000;
const CALL_TIMEOUT_MS = 30000;
const HELLO_TIMEOUT_MS = 10000;
const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];

let mainWindow = null;
let frameVersion = '0.0.0';
const bus = new EventEmitter();
bus.setMaxListeners(50);

let status = { state: 'off', host: null, error: null, frameVersion: null, platform: null, install: null };
let preflighted = false;  // the host was probed in this session
let session = 0;          // bumps on every connect/disconnect; stale loops stop
let tunnel = null;        // ChildProcess
let socket = null;        // WebSocket
let pending = P.createPending();
let attempt = 0;
let retryTimer = null;

function sshBin() {
  return process.env.FRAME_SSH || 'ssh';
}

function setStatus(next) {
  status = { ...status, ...next };
  bus.emit('status', status);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.SERVER_STATUS_CHANGED, status);
}

function getStatus() {
  return status;
}

function isConnected() {
  return status.state === 'connected';
}

/** Close the socket and the tunnel of the current attempt. */
function teardown() {
  if (socket) {
    try { socket.removeAllListeners(); socket.terminate(); } catch (_) { /* gone */ }
    socket = null;
  }
  if (tunnel) {
    try { tunnel.removeAllListeners(); tunnel.kill(); } catch (_) { /* gone */ }
    tunnel = null;
  }
  removeLocalSocketDir();
  pending.rejectAll('Disconnected from the server.');
  pending = P.createPending();
}

// ─── The loop ─────────────────────────────────────────────────

function readConnectionInfo(host) {
  return new Promise((resolve, reject) => {
    execFile(sshBin(), [...SSH_OPTS, host, 'cat ~/.frame-server/connection.json'], { timeout: SSH_TIMEOUT_MS, maxBuffer: 64 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const text = String(stderr || err.message || '').trim();
        if (/No such file/i.test(text)) {
          const e = new Error(`Frame Server is not running on ${host}.`);
          e.notRunning = true;
          return reject(e);
        }
        if (/Permission denied|Host key verification|Could not resolve|Connection refused|timed out/i.test(text)) return reject(new Error(`ssh ${host}: ${text.split('\n').pop()}`));
        return reject(new Error(text ? `ssh ${host}: ${text.split('\n').pop()}` : `ssh ${host} failed`));
      }
      try {
        const info = JSON.parse(stdout);
        // A socket (server-hardening S8) or, from an older or --port server, a TCP port.
        const where = (typeof info.socket === 'string' && info.socket.startsWith('/')) || Number.isInteger(info.port);
        if (!info || !where || typeof info.token !== 'string') throw new Error('incomplete');
        resolve(info);
      } catch (_) {
        reject(new Error(`Frame Server on ${host} left an unreadable connection.json — restart it.`));
      }
    });
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// The local end of the tunnel: a socket in a private temp folder, or a
// localhost port when that path would not fit sun_path.
const MAX_LOCAL_SOCKET = 100;
let localSocketDir = null;

function removeLocalSocketDir() {
  if (!localSocketDir) return;
  try { fs.rmSync(localSocketDir, { recursive: true, force: true }); } catch (_) { /* gone */ }
  localSocketDir = null;
}

/** `{ args, target }`: ssh -L arguments and where the desktop then connects. */
async function forwardFor(info) {
  if (!info.socket) {
    const port = await freePort();
    return { args: ['-L', `127.0.0.1:${port}:127.0.0.1:${info.port}`], target: { port } };
  }
  removeLocalSocketDir();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-ssh-'));
  fs.chmodSync(dir, 0o700);
  const sock = path.join(dir, 's');
  if (sock.length <= MAX_LOCAL_SOCKET) {
    localSocketDir = dir;
    return { args: ['-o', 'StreamLocalBindUnlink=yes', '-L', `${sock}:${info.socket}`], target: { path: sock } };
  }
  fs.rmSync(dir, { recursive: true, force: true });
  const port = await freePort();
  return { args: ['-L', `127.0.0.1:${port}:${info.socket}`], target: { port } };
}

/** The sshd refused to forward to a socket: say what to change (S8). */
function forwardRefused(text) {
  return /administratively prohibited/i.test(text || '')
    ? new Error('The server\'s sshd does not allow forwarding to Frame Server\'s socket. Set `AllowStreamLocalForwarding yes` in /etc/ssh/sshd_config (or a Match block for your user) and restart sshd.')
    : null;
}

function waitForPort(port, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    let done = false;
    const exit = (code) => { if (!done) { done = true; reject(new Error(`The SSH tunnel closed (exit ${code}).`)); } };
    child.once('exit', exit);
    const tryOnce = () => {
      if (done) return;
      const s = typeof port === 'object' ? (port.path ? net.connect(port.path) : net.connect(port.port, '127.0.0.1')) : net.connect(port, '127.0.0.1');
      s.once('connect', () => { s.destroy(); done = true; child.removeListener('exit', exit); resolve(); });
      s.once('error', () => {
        s.destroy();
        if (Date.now() > deadline) { done = true; child.removeListener('exit', exit); reject(new Error('The SSH tunnel did not come up in time.')); }
        else setTimeout(tryOnce, 150);
      });
    };
    tryOnce();
  });
}

function openSocket(target, token) {
  return new Promise((resolve, reject) => {
    const url = target && target.path ? `ws+unix://${target.path}:/` : `ws://127.0.0.1:${target && target.port != null ? target.port : target}`;
    const ws = new WebSocket(url, {
      headers: { Authorization: `Bearer ${token}`, Origin: DESKTOP_ORIGIN },
      handshakeTimeout: 10000,
      maxPayload: 16 * 1024 * 1024
    });
    let greeted = false;
    // Settle even when the socket closes after the upgrade but before the
    // server's hello, or the hello never comes (server-hardening S11).
    const helloTimer = setTimeout(() => {
      if (greeted) return;
      try { ws.terminate(); } catch (_) { /* gone */ }
      reject(new Error('Frame Server did not say hello in time.'));
    }, HELLO_TIMEOUT_MS);
    ws.once('unexpected-response', (req, res) => { clearTimeout(helloTimer); reject(new Error(res.statusCode === 401 ? 'The server refused the token — restart Frame Server or reconnect.' : `The server answered HTTP ${res.statusCode}.`)); });
    ws.once('error', (err) => { if (!greeted) { clearTimeout(helloTimer); reject(err); } });
    ws.once('close', (code) => { if (!greeted) { clearTimeout(helloTimer); reject(new Error(`The server closed the connection before saying hello (${code}).`)); } });
    ws.on('message', (data) => {
      const decoded = P.decode(data.toString());
      if (!decoded.ok) return;
      const msg = decoded.msg;
      if (!greeted) {
        const check = P.checkHello(msg, frameVersion);
        if (!check.ok) {
          ws.close();
          const e = new Error(check.error);
          e.protocol = true;
          reject(e);
          return;
        }
        greeted = true;
        clearTimeout(helloTimer);
        ws.send(P.encode(P.hello(frameVersion)));
        resolve({ ws, serverVersion: msg.frameVersion });
        return;
      }
      if (msg.type === 'res') pending.settle(msg);
      else if (msg.type === 'event') bus.emit(`event:${msg.channel}`, msg.payload);
    });
  });
}

async function runOnce(host, mySession) {
  const info = await readConnectionInfo(host);
  if (mySession !== session) return;
  try {
    await openLink(host, mySession, info);
  } catch (err) {
    // connection.json was read but nothing answered behind it: the server
    // may have died and left the file (kill -9, OOM, reboot). Probe again,
    // which starts an installed server (server-hardening S4).
    if (!err.protocol) err.unreachable = true;
    throw err;
  }
}

async function openLink(host, mySession, info) {
  const forward = await forwardFor(info);
  const child = spawn(sshBin(), [...SSH_OPTS, '-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
    ...forward.args, host], { stdio: ['ignore', 'ignore', 'pipe'] });
  tunnel = child;
  let tunnelErr = '';
  child.stderr.on('data', (d) => { tunnelErr = (tunnelErr + d.toString()).slice(-2000); });
  try {
    await waitForPort(forward.target, child, TUNNEL_READY_MS);
  } catch (err) {
    throw forwardRefused(tunnelErr) || new Error(tunnelErr.trim() ? `${err.message} ${tunnelErr.trim().split('\n').pop()}` : err.message);
  }
  if (mySession !== session) return;
  let opened;
  try {
    opened = await openSocket(forward.target, info.token);
  } catch (err) {
    // ssh reports a refused socket forward only when a connection is made.
    await new Promise((r) => setTimeout(r, 100));
    throw forwardRefused(tunnelErr) || err;
  }
  const { ws, serverVersion } = opened;
  if (mySession !== session) { ws.terminate(); return; }
  socket = ws;
  // Watch the link from the moment it exists: a close during the ping below
  // used to leave nothing listening (server-hardening S11).
  let up = false;
  let gone = false;
  const lost = (why) => {
    if (mySession !== session || gone) return;
    gone = true;
    logger.warn('server', `connection to ${host} lost: ${why}`);
    teardown();
    if (up) bus.emit('disconnected', status);
    preflighted = false; // probe again: the server may have to be started (S4)
    scheduleRetry(host, mySession, `Connection lost (${why}).`);
  };
  ws.on('close', (code) => lost(`socket closed ${code}`));
  ws.on('error', (err) => lost(err.message));
  child.on('exit', (code) => lost(`tunnel exited ${code}`));
  let ping = null;
  try {
    ping = await call('server.ping', {}, 10000);
  } catch (_) { /* the hello already proved the link */ }
  if (mySession !== session || gone) return;
  up = true;
  attempt = 0;
  setStatus({ state: 'connected', error: null, frameVersion: serverVersion || null, platform: ping ? `${ping.platform}-${ping.arch}` : null });
  logger.info('server', `connected to ${host} (Frame ${serverVersion})`);
  bus.emit('connected', status);
}

function scheduleRetry(host, mySession, error) {
  if (mySession !== session) return;
  const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
  attempt += 1;
  // A link that never came up stays "error" (still retrying); a lost one is "reconnecting".
  setStatus({ state: status.state === 'error' ? 'error' : 'reconnecting', error });
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => loop(host, mySession), delay);
}

function installer() {
  return require('./serverInstaller');
}

function progress(line) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.SERVER_INSTALL_PROGRESS, { host: status.host, line });
}

/**
 * Probe the host before connecting: 'go', or 'wait' after setting
 * needs-install / needs-update. Starts an installed but stopped server.
 */
async function preflight(host, mySession, { protocolOk = true } = {}) {
  const d = await installer().decide(host, { protocolOk });
  if (mySession !== session) return 'stale';
  if (d.action === 'error') throw new Error(d.reason);
  const inst = d.probe && d.probe.installed;
  const info = { action: d.action, reason: d.reason, desktopVersion: d.desktopVersion, dev: d.dev, current: inst ? inst.current : null, previous: inst ? inst.previous : null, manual: !!(inst && inst.manual) };
  // Nothing to talk to (not installed), or a server this Frame cannot talk
  // to (another protocol): wait for the user. An older but compatible server
  // is connected to, so its running agents can be named before any update.
  if (d.action === 'install' || (d.action !== 'none' && !protocolOk)) {
    setStatus({ state: d.action === 'install' ? 'needs-install' : 'needs-update', error: null, install: info });
    return 'wait';
  }
  setStatus({ install: info });
  if (inst && inst.manual && !inst.running) {
    // Started by hand (no managed install) and since stopped: Frame cannot
    // start it; say so instead of retrying a dead port (S4).
    throw new Error(`Frame Server on ${host} was started by hand and is not running — start it again there.`);
  }
  if (inst && !inst.running && !inst.manual) {
    progress(`Starting Frame Server ${inst.current}`);
    const r = await installer().start(host, { onProgress: progress });
    if (!r.ok) throw new Error(r.message || 'Frame Server did not start.');
  }
  return 'go';
}

async function loop(host, mySession) {
  if (mySession !== session) return;
  try {
    if (!preflighted) {
      const go = await preflight(host, mySession);
      if (go !== 'go') return;
      preflighted = true;
    }
    await runOnce(host, mySession);
  } catch (err) {
    if (mySession !== session) return;
    teardown();
    if (err.protocol) {
      // The server speaks another protocol: that is an update, not a retry.
      try { await preflight(host, mySession, { protocolOk: false }); } catch (_) { /* reported below */ }
      if (status.state === 'needs-update') return;
    }
    if (err.notRunning || err.unreachable) preflighted = false; // probe again: it may need starting or installing
    logger.warn('server', `connect to ${host} failed: ${err.message}`);
    // Never connected yet in this session → error state, still retrying.
    if (status.state === 'connecting') setStatus({ state: 'error', error: err.message });
    scheduleRetry(host, mySession, err.message);
  }
}

// ─── Public API ───────────────────────────────────────────────

/** Connect to `host` (an ssh alias or user@host), remember it, auto-connect next launch. */
function connect(host) {
  const h = String(host || '').trim();
  if (!h || /\s/.test(h) || h.startsWith('-')) return { error: 'Enter an SSH host such as "myserver" or "me@server.example.com".' };
  disconnect({ forget: false, quiet: true });
  session += 1;
  attempt = 0;
  preflighted = false;
  userSettings.set(SETTING, { host: h, autoConnect: true });
  setStatus({ state: 'connecting', host: h, error: null, frameVersion: null, platform: null, install: null });
  loop(h, session);
  return { error: null, status };
}

/** Stop and close everything; `forget` drops auto-connect for next launch. */
function disconnect({ forget = true, quiet = false } = {}) {
  const wasUp = status.state === 'connected';
  session += 1;
  clearTimeout(retryTimer);
  teardown();
  if (forget) {
    const saved = userSettings.get(SETTING);
    if (saved && saved.host) userSettings.set(SETTING, { host: saved.host, autoConnect: false });
  }
  if (!quiet) setStatus({ state: 'off', error: null, frameVersion: null, platform: null });
  if (wasUp) bus.emit('disconnected', status);
  return { error: null, status };
}

/** A request to the server. Rejects when not connected or on timeout. */
function call(method, params = {}, timeoutMs = CALL_TIMEOUT_MS) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error(status.host ? `Not connected to ${status.host}.` : 'Not connected to a server.'));
  }
  const id = pending.nextId();
  const p = pending.add(id, timeoutMs);
  socket.send(P.encode(P.request(id, method, params)));
  return p;
}

/** Fire-and-forget request (terminal input): errors are only logged. */
function send(method, params = {}) {
  call(method, params).catch((err) => logger.warn('server', `${method} failed: ${err.message}`));
}

/** Subscribe to a server event channel (`terminal.output`, …) or `connected` / `disconnected` / `status`. */
function on(name, fn) {
  const key = ['connected', 'disconnected', 'status'].includes(name) ? name : `event:${name}`;
  bus.on(key, fn);
  return () => bus.removeListener(key, fn);
}

/** Host aliases from ~/.ssh/config for the Connect dialog. */
function sshHosts() {
  try {
    return parseSshConfigHosts(fs.readFileSync(path.join(os.homedir(), '.ssh', 'config'), 'utf8'));
  } catch (_) {
    return [];
  }
}

/** Attach the (re)created window; on the first call, auto-connect when the user left it connected. */
let started = false;
function init(window, version) {
  mainWindow = window;
  if (version) frameVersion = version;
  if (started) return;
  started = true;
  const saved = userSettings.get(SETTING);
  if (saved && saved.host && saved.autoConnect) connect(saved.host);
}

// ─── Install / update / rollback (server-install-update) ───────

let busy = false;

/**
 * Run an installer action for the current (or given) host with progress,
 * then connect again. Update and rollback first ask about running agents:
 * without `confirmAgents` they return `{ needsConsent, agents }`.
 */
async function runAction(kind, { host: given, confirmAgents = false } = {}) {
  const host = given || status.host || (userSettings.get(SETTING) || {}).host;
  if (!host) return { error: 'Choose a server first.' };
  if (busy) return { error: 'An install is already running.' };
  // Taken before the first await: two clicks can no longer both pass the
  // check while the agent list loads (server-hardening S10).
  busy = true;
  let result;
  try {
    if (kind !== 'install' && !confirmAgents) {
      const connected = isConnected();
      const agents = connected ? await installer().runningAgents() : null;
      const installed = !!(status.install && status.install.current);
      // Unknown (unreadable list, or not connected) asks in general (S9).
      if (consentNeeded({ connected, agents, installed })) return { error: null, needsConsent: true, agents };
    }
    disconnect({ forget: false, quiet: true });
    setStatus({ state: 'installing', host, error: null });
    try {
      result = kind === 'rollback'
        ? await installer().rollback(host, { onProgress: progress })
        : await installer().install(host, { onProgress: progress });
    } catch (err) {
      result = { ok: false, message: err.message };
    }
  } finally {
    busy = false;
  }
  if (result && result.ok) {
    connect(host);
    return { error: null, result };
  }
  setStatus({ state: 'error', error: (result && result.message) || 'The install failed.' });
  return { error: (result && result.message) || 'The install failed.', result };
}

function setupIPC(ipcMain) {
  ipcMain.removeHandler(IPC.SERVER_INSTALL);
  ipcMain.removeHandler(IPC.SERVER_UPDATE);
  ipcMain.removeHandler(IPC.SERVER_ROLLBACK);
  ipcMain.removeHandler(IPC.SERVER_DOCTOR);
  ipcMain.handle(IPC.SERVER_INSTALL, (event, opts = {}) => runAction('install', opts));
  ipcMain.handle(IPC.SERVER_UPDATE, (event, opts = {}) => runAction('update', opts));
  ipcMain.handle(IPC.SERVER_ROLLBACK, (event, opts = {}) => runAction('rollback', opts));
  ipcMain.handle(IPC.SERVER_DOCTOR, async () => {
    if (!isConnected()) return { error: 'Not connected.', items: [] };
    try { return { error: null, ...(await call('server.doctor', {}, 30000)) }; } catch (err) { return { error: err.message, items: [] }; }
  });
  ipcMain.removeHandler(IPC.SERVER_STATUS);
  ipcMain.removeHandler(IPC.SERVER_CONNECT);
  ipcMain.removeHandler(IPC.SERVER_DISCONNECT);
  ipcMain.removeHandler(IPC.SERVER_SSH_HOSTS);
  ipcMain.handle(IPC.SERVER_STATUS, () => ({ ...status, saved: userSettings.get(SETTING) }));
  ipcMain.handle(IPC.SERVER_CONNECT, (event, { host } = {}) => connect(host));
  ipcMain.handle(IPC.SERVER_DISCONNECT, () => disconnect({ forget: true }));
  ipcMain.handle(IPC.SERVER_SSH_HOSTS, () => sshHosts());
}

module.exports = { init, setupIPC, connect, disconnect, call, send, on, getStatus, isConnected, sshHosts, runAction };
