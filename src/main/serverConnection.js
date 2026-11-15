/**
 * Server connection — the desktop's link to Frame Server
 * (server-workspaces spec, T2/B1).
 *
 * The connection loop itself lives in serverLink.js (one link per server,
 * multi-server-connections T03); this module owns the saved setting, the
 * window and the IPC. One server at a time until T04. Connecting runs the
 * user's own `ssh`:
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
const path = require('path');
const { EventEmitter } = require('events');
const { IPC } = require('../shared/ipcChannels');
const { parseSshConfigHosts } = require('../shared/serverRouting');
const { createLink } = require('./serverLink');
const userSettings = require('./userSettings');

const SETTING = 'server';
const OFF = { state: 'off', host: null, error: null, frameVersion: null, platform: null, install: null, serverId: null };

let mainWindow = null;
let frameVersion = '0.0.0';
const bus = new EventEmitter();
bus.setMaxListeners(50);

// The one server this build connects to. multi-server-connections T04 turns
// this into a list of links; until then the module keeps its single-server API.
let link = null;

function toWindow(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

/** The link for `host`, made (not connected) when it is not the current one. */
function linkFor(host) {
  if (link && link.host === host) return link;
  if (link) link.stop({ quiet: true });
  link = createLink({
    key: host,
    host,
    frameVersion: () => frameVersion,
    onStatus: (status, prev, l) => {
      if (l !== link) return;
      bus.emit('status', status);
      toWindow(IPC.SERVER_STATUS_CHANGED, status);
    },
    onEvent: (name, payload, l) => {
      if (l !== link) return;
      bus.emit(name, payload, l.key);
    },
    onProgress: (line, l) => toWindow(IPC.SERVER_INSTALL_PROGRESS, { host: l.host, line })
  });
  return link;
}

function getStatus() {
  return link ? link.getStatus() : OFF;
}

function isConnected() {
  return !!(link && link.isConnected());
}

function connect(host) {
  const h = String(host || '').trim();
  if (!h || /\s/.test(h) || h.startsWith('-')) return { error: 'Enter an SSH host such as "myserver" or "me@server.example.com".' };
  userSettings.set(SETTING, { host: h, autoConnect: true });
  linkFor(h).connect();
  return { error: null, status: getStatus() };
}

/** Stop and close everything; `forget` drops auto-connect for next launch. */
function disconnect({ forget = true, quiet = false } = {}) {
  if (link) link.stop({ quiet });
  if (forget) {
    const saved = userSettings.get(SETTING);
    if (saved && saved.host) userSettings.set(SETTING, { host: saved.host, autoConnect: false });
  }
  return { error: null, status: getStatus() };
}

/** A request to the server. Rejects when not connected or on timeout. */
function call(method, params = {}, timeoutMs) {
  if (!link) return Promise.reject(new Error('Not connected to a server.'));
  return link.call(method, params, timeoutMs);
}

/** Fire-and-forget request (terminal input): errors are only logged. */
function send(method, params = {}) {
  if (link) link.send(method, params);
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

/**
 * Run an installer action for the current (or given) host with progress,
 * then connect again. Update and rollback first ask about running agents:
 * without `confirmAgents` they return `{ needsConsent, agents }`.
 */
async function runAction(kind, { host: given, confirmAgents = false } = {}) {
  const host = given || (link && link.host) || (userSettings.get(SETTING) || {}).host;
  if (!host) return { error: 'Choose a server first.' };
  return linkFor(host).runAction(kind, { confirmAgents });
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
  ipcMain.handle(IPC.SERVER_STATUS, () => ({ ...getStatus(), saved: userSettings.get(SETTING) }));
  ipcMain.handle(IPC.SERVER_CONNECT, (event, { host } = {}) => connect(host));
  ipcMain.handle(IPC.SERVER_DISCONNECT, () => disconnect({ forget: true }));
  ipcMain.handle(IPC.SERVER_SSH_HOSTS, () => sshHosts());
}

module.exports = { init, setupIPC, connect, disconnect, call, send, on, getStatus, isConnected, sshHosts, runAction };
