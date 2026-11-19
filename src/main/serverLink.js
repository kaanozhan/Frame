/**
 * Server link — the desktop's connection to ONE Frame Server
 * (multi-server-connections spec; the loop itself is from server-workspaces
 * T2/B1, server-install-update and server-hardening).
 *
 * `createLink({ key, host, … })` returns one server's connection. Everything
 * that used to be module state in serverConnection.js — status, tunnel,
 * socket, pending calls, retry timer, the local socket dir, the install busy
 * flag — lives on the link, so several servers can be connected at once.
 * serverConnection.js keeps the list of links and the IPC.
 *
 * Connecting is a loop that runs the user's own `ssh`:
 *
 *   1. `ssh <host> cat ~/.frame-server/connection.json`  → socket/port + token
 *   2. `ssh -N -L <local>:<remote> <host>` (the tunnel; its own local socket dir)
 *   3. WebSocket through the tunnel with the Bearer token and the desktop
 *      Origin; both sides say hello (same protocol) → connected
 *   4. `server.info` → the server's permanent id (null from an older server)
 *
 * When the tunnel or socket drops, everything in flight fails, the status
 * becomes "reconnecting" and the loop starts again with backoff until the
 * user disconnects. Frame stores no SSH secrets: `BatchMode=yes` means a host
 * that needs a typed password cannot be used (keys, agent, Tailscale SSH can).
 *
 * Before the first attempt (and whenever the server is found not running) the
 * host is probed (serverInstaller): a missing or outdated Frame Server — or
 * one speaking another protocol — sets `needs-install` / `needs-update` and
 * the loop waits for the user instead of retrying; an installed but stopped
 * one is started. `runAction` installs, updates or rolls back this server.
 *
 * `FRAME_SSH` overrides the ssh binary (tests use a stand-in).
 */

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { execFile, spawn } = require('child_process');
const WebSocket = require('ws');
const P = require('../shared/serverProtocol');
const { DESKTOP_ORIGIN } = require('../shared/serverSecurity');
const { consentNeeded } = require('../shared/serverInstall');
const sshErrors = require('../shared/sshErrors');
const logger = require('./logger');

const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
const SSH_TIMEOUT_MS = 20000;
const TUNNEL_READY_MS = 15000;
const CALL_TIMEOUT_MS = 30000;
const HELLO_TIMEOUT_MS = 10000;
const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];
// The local end of the tunnel: a socket in a private temp folder, or a
// localhost port when that path would not fit sun_path.
const MAX_LOCAL_SOCKET = 100;

function sshBin() {
  return process.env.FRAME_SSH || 'ssh';
}

function installer() {
  return require('./serverInstaller');
}

function readConnectionInfo(host) {
  return new Promise((resolve, reject) => {
    execFile(sshBin(), [...SSH_OPTS, host, 'cat ~/.frame-server/connection.json'], { timeout: SSH_TIMEOUT_MS, maxBuffer: 64 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const text = String(stderr || err.message || '').trim();
        const sshKind = sshErrors.classify(stderr, err.code);
        if (/No such file/i.test(text)) {
          const e = new Error(`Frame Server is not running on ${host}.`);
          e.notRunning = true;
          return reject(e);
        }
        return reject(Object.assign(new Error(text ? `ssh ${host}: ${text.split('\n').pop()}` : `ssh ${host} failed`), { sshKind }));
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

/**
 * One server's link.
 *
 * @param {object} o
 * @param {string} o.key        the desktop's key for this server (serverList)
 * @param {string} o.host       SSH host or alias
 * @param {() => string} o.frameVersion  the desktop's version, read at hello
 * @param {(status, prev, link) => void} [o.onStatus]   every status change
 * @param {(name, payload, link) => void} [o.onEvent]   'connected' |
 *        'disconnected' | 'event:<channel>' (server events)
 * @param {(line, link) => void} [o.onProgress]         installer progress
 */
function createLink({ key, host, frameVersion = () => '0.0.0', onStatus = () => {}, onEvent = () => {}, onProgress = () => {} }) {
  let status = { state: 'off', host, error: null, errorKind: null, frameVersion: null, platform: null, install: null, serverId: null };
  let preflighted = false;  // the host was probed in this session
  let session = 0;          // bumps on every connect/disconnect; stale loops stop
  let tunnel = null;        // ChildProcess
  let socket = null;        // WebSocket
  let pending = P.createPending();
  let attempt = 0;
  let retryTimer = null;
  let localSocketDir = null;
  let busy = false;         // one install / update / rollback at a time on this server

  const link = {};

  function setStatus(next) {
    const prev = status;
    status = { ...status, ...next };
    try { onStatus(status, prev, link); } catch (err) { logger.warn('server', `status listener failed: ${err.message}`); }
  }

  function emit(name, payload) {
    try { onEvent(name, payload, link); } catch (err) { logger.warn('server', `${name} listener failed: ${err.message}`); }
  }

  function getStatus() {
    return status;
  }

  function isConnected() {
    return status.state === 'connected';
  }

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
          const check = P.checkHello(msg, frameVersion());
          if (!check.ok) {
            ws.close();
            const e = new Error(check.error);
            e.protocol = true;
            reject(e);
            return;
          }
          greeted = true;
          clearTimeout(helloTimer);
          ws.send(P.encode(P.hello(frameVersion())));
          resolve({ ws, serverVersion: msg.frameVersion });
          return;
        }
        if (msg.type === 'res') pending.settle(msg);
        else if (msg.type === 'event') emit(`event:${msg.channel}`, msg.payload);
      });
    });
  }

  async function runOnce(mySession) {
    const info = await readConnectionInfo(host);
    if (mySession !== session) return;
    try {
      await openLink(mySession, info);
    } catch (err) {
      // connection.json was read but nothing answered behind it: the server
      // may have died and left the file (kill -9, OOM, reboot). Probe again,
      // which starts an installed server (server-hardening S4).
      if (!err.protocol) err.unreachable = true;
      throw err;
    }
  }

  async function openLink(mySession, info) {
    const forward = await forwardFor(info);
    const child = spawn(sshBin(), [...SSH_OPTS, '-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
      ...forward.args, host], { stdio: ['ignore', 'ignore', 'pipe'] });
    tunnel = child;
    let tunnelErr = '';
    child.stderr.on('data', (d) => { tunnelErr = (tunnelErr + d.toString()).slice(-2000); });
    try {
      await waitForPort(forward.target, child, TUNNEL_READY_MS);
    } catch (err) {
      throw forwardRefused(tunnelErr) || Object.assign(new Error(tunnelErr.trim() ? `${err.message} ${tunnelErr.trim().split('\n').pop()}` : err.message), { sshKind: sshErrors.classify(tunnelErr, child.exitCode) });
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
      if (up) emit('disconnected', status);
      preflighted = false; // probe again: the server may have to be started (S4)
      scheduleRetry(mySession, `Connection lost (${why}).`);
    };
    ws.on('close', (code) => lost(`socket closed ${code}`));
    ws.on('error', (err) => lost(err.message));
    child.on('exit', (code) => lost(`tunnel exited ${code}`));
    let ping = null;
    try {
      ping = await call('server.ping', {}, 10000);
    } catch (_) { /* the hello already proved the link */ }
    if (mySession !== session || gone) return;
    // The server's permanent id (multi-server-connections): an older server
    // answers "Unknown method" and is told apart by its alias only.
    let serverId = null;
    try {
      const res = await call('server.info', {}, 10000);
      if (res && typeof res.serverId === 'string' && res.serverId) serverId = res.serverId;
    } catch (_) { /* older server */ }
    if (mySession !== session || gone) return;
    up = true;
    attempt = 0;
    setStatus({ state: 'connected', error: null, errorKind: null, frameVersion: serverVersion || null, platform: ping ? `${ping.platform}-${ping.arch}` : null, serverId });
    logger.info('server', `connected to ${host} (Frame ${serverVersion})`);
    emit('connected', status);
  }

  function scheduleRetry(mySession, error, errorKind = null) {
    if (mySession !== session) return;
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    // A link that never came up stays "error" (still retrying); a lost one is "reconnecting".
    setStatus({ state: status.state === 'error' ? 'error' : 'reconnecting', error, errorKind });
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => loop(mySession), delay);
  }

  function progress(line) {
    try { onProgress(line, link); } catch (_) { /* best effort */ }
  }

  /**
   * Probe the host before connecting: 'go', or 'wait' after setting
   * needs-install / needs-update. Starts an installed but stopped server.
   */
  async function preflight(mySession, { protocolOk = true } = {}) {
    const d = await installer().decide(host, { protocolOk });
    if (mySession !== session) return 'stale';
    if (d.action === 'error') throw Object.assign(new Error(d.reason), { sshKind: d.sshKind || null });
    const inst = d.probe && d.probe.installed;
    const info = { action: d.action, reason: d.reason, desktopVersion: d.desktopVersion, dev: d.dev, current: inst ? inst.current : null, previous: inst ? inst.previous : null, manual: !!(inst && inst.manual) };
    // Nothing to talk to (not installed), or a server this Frame cannot talk
    // to (another protocol): wait for the user. An older but compatible server
    // is connected to, so its running agents can be named before any update.
    if (d.action === 'install' || (d.action !== 'none' && !protocolOk)) {
      setStatus({ state: d.action === 'install' ? 'needs-install' : 'needs-update', error: null, errorKind: null, install: info });
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

  async function loop(mySession) {
    if (mySession !== session) return;
    try {
      if (!preflighted) {
        const go = await preflight(mySession);
        if (go !== 'go') return;
        preflighted = true;
      }
      await runOnce(mySession);
    } catch (err) {
      if (mySession !== session) return;
      teardown();
      if (err.protocol) {
        // The server speaks another protocol: that is an update, not a retry.
        try { await preflight(mySession, { protocolOk: false }); } catch (_) { /* reported below */ }
        if (status.state === 'needs-update') return;
      }
      if (err.notRunning || err.unreachable) preflighted = false; // probe again: it may need starting or installing
      logger.warn('server', `connect to ${host} failed: ${err.message}`);
      // Never connected yet in this session → error state, still retrying.
      // `errorKind`: what an ssh failure means (server-first-connect), or null.
      const errorKind = err.sshKind || null;
      // A host key not accepted or a login refused: only the user can fix it,
      // so the loop waits for Connect instead of rerunning ssh on a backoff.
      if (sshErrors.needsUser(errorKind)) {
        setStatus({ state: 'error', error: err.message, errorKind });
        return;
      }
      if (status.state === 'connecting') setStatus({ state: 'error', error: err.message, errorKind });
      scheduleRetry(mySession, err.message, errorKind);
    }
  }

  /** Start (or restart) the connect loop. */
  function connect() {
    stop({ quiet: true });
    session += 1;
    attempt = 0;
    preflighted = false;
    setStatus({ state: 'connecting', host, error: null, errorKind: null, frameVersion: null, platform: null, install: null });
    loop(session);
  }

  /** Stop the loop and close everything. `quiet` keeps the status as it is. */
  function stop({ quiet = false } = {}) {
    const wasUp = status.state === 'connected';
    session += 1;
    clearTimeout(retryTimer);
    teardown();
    if (!quiet) setStatus({ state: 'off', error: null, errorKind: null, frameVersion: null, platform: null });
    if (wasUp) emit('disconnected', status);
  }

  /** A request to the server. Rejects when not connected or on timeout. */
  function call(method, params = {}, timeoutMs = CALL_TIMEOUT_MS) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`Not connected to ${host}.`));
    }
    const id = pending.nextId();
    const p = pending.add(id, timeoutMs);
    socket.send(P.encode(P.request(id, method, params)));
    return p;
  }

  /** Fire-and-forget request (terminal input): errors are only logged. */
  function send(method, params = {}) {
    call(method, params).catch((err) => logger.warn('server', `${method} on ${host} failed: ${err.message}`));
  }

  /**
   * Install, update or roll back this server with progress, then connect
   * again. Update and rollback first ask about running agents: without
   * `confirmAgents` they return `{ needsConsent, agents }`.
   */
  async function runAction(kind, { confirmAgents = false } = {}) {
    if (busy) return { error: 'An install is already running.' };
    // Taken before the first await: two clicks can no longer both pass the
    // check while the agent list loads (server-hardening S10).
    busy = true;
    let result;
    try {
      if (kind !== 'install' && !confirmAgents) {
        const connected = isConnected();
        const agents = connected ? await installer().runningAgents(key) : null;
        const installed = !!(status.install && status.install.current);
        // Unknown (unreadable list, or not connected) asks in general (S9).
        if (consentNeeded({ connected, agents, installed })) return { error: null, needsConsent: true, agents };
      }
      stop({ quiet: true });
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
      connect();
      return { error: null, result };
    }
    setStatus({ state: 'error', errorKind: null, error: (result && result.message) || 'The install failed.' });
    return { error: (result && result.message) || 'The install failed.', result };
  }

  Object.assign(link, {
    key,
    host,
    getStatus,
    isConnected,
    connect,
    stop,
    call,
    send,
    runAction,
    get serverId() { return status.serverId || null; }
  });
  return link;
}

module.exports = { createLink };
