/**
 * Server connection — the desktop's links to Frame Servers
 * (server-workspaces T2/B1; multi-server-connections T04).
 *
 * The registry of servers. The saved list lives in user settings under
 * `servers` (src/shared/serverList.js owns its rules; the old single
 * `server` setting migrates once). Each saved server has one link
 * (serverLink.js), which runs that server's own connect loop — its ssh
 * tunnel, socket, backoff and installs — so any number of servers stay
 * connected at once and one dropping never touches the others.
 *
 * Main-process modules use:
 *   - `of(key)`  → that server's link (`call`, `send`, `isConnected`, `getStatus`)
 *   - `all()`    → every link
 *   - `on(name, fn(payload, key))` → a server event (`terminal.output`, …) or
 *     `connected` / `disconnected` / `status` / `removed`, from any server
 * Every server call goes through a link (`of(key)`): there is no keyless
 * call. `getStatus` / `isConnected` without a key report the default server
 * (the first connected one, else the first saved) for the parts of the UI that
 * still show one status.
 *
 * A server that reports a `serverId` another entry already holds is the same
 * machine reached through a second alias: the new entry is removed and the
 * renderer is told which entry it duplicates.
 *
 * The renderer sees SERVER_STATUS_CHANGED `{ servers: [...] }` (plus the
 * default server's status fields, which the single-server UI still reads)
 * and the SERVER_* invokes, which take `{ key }`.
 * `FRAME_SSH` overrides the ssh binary (tests use a stand-in).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { IPC } = require('../shared/ipcChannels');
const { parseSshConfigHosts } = require('../shared/serverRouting');
const L = require('../shared/serverList');
const { createLink } = require('./serverLink');
const userSettings = require('./userSettings');
const logger = require('./logger');

const SETTING = 'servers';
const LEGACY_SETTING = 'server';
const OFF = { state: 'off', host: null, error: null, frameVersion: null, platform: null, install: null, serverId: null };

let mainWindow = null;
let frameVersion = '0.0.0';
const bus = new EventEmitter();
bus.setMaxListeners(100);

const links = new Map(); // key → link
let notice = null;       // { kind: 'duplicate', host, existingHost } — sent once with the next status

function toWindow(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

// ─── The saved list ───────────────────────────────────────────

function load() {
  const { servers, migrated } = L.migrate({ servers: userSettings.get(SETTING), server: userSettings.get(LEGACY_SETTING) });
  if (migrated) userSettings.set(SETTING, servers);
  return servers;
}

function save(list) {
  userSettings.set(SETTING, L.sanitize(list));
}

function entries() {
  return load();
}

/** The saved servers with their live status, in list order. */
function list() {
  return entries().map((e) => ({ ...e, status: links.has(e.key) ? links.get(e.key).getStatus() : { ...OFF, host: e.host } }));
}

// ─── Links ────────────────────────────────────────────────────

function broadcast() {
  const payload = { ...getStatus(), servers: list() };
  if (notice) { payload.notice = notice; notice = null; }
  toWindow(IPC.SERVER_STATUS_CHANGED, payload);
}

/** A newly connected server that turns out to be one already listed. */
function checkDuplicate(link, status) {
  if (status.state !== 'connected' || !status.serverId) return false;
  const saved = entries();
  const dup = L.findByServerId(saved, status.serverId, link.key);
  if (!dup) {
    const mine = saved.find((e) => e.key === link.key);
    if (mine && mine.serverId !== status.serverId) save(L.updateServer(saved, link.key, { serverId: status.serverId }));
    return false;
  }
  logger.warn('server', `${link.host} is the same server as ${dup.host} — removing the new entry`);
  notice = { kind: 'duplicate', host: link.host, existingHost: dup.host, existingKey: dup.key };
  setImmediate(() => remove(link.key));
  return true;
}

function linkOf(entry) {
  if (links.has(entry.key)) return links.get(entry.key);
  const link = createLink({
    key: entry.key,
    host: entry.host,
    frameVersion: () => frameVersion,
    onStatus: (status, prev, l) => {
      if (links.get(l.key) !== l) return;
      if (checkDuplicate(l, status) && status.state === 'connected') return;
      bus.emit('status', status, l.key);
      broadcast();
    },
    onEvent: (name, payload, l) => {
      if (links.get(l.key) !== l) return;
      bus.emit(name, payload, l.key);
    },
    onProgress: (line, l) => toWindow(IPC.SERVER_INSTALL_PROGRESS, { key: l.key, host: l.host, line })
  });
  links.set(entry.key, link);
  return link;
}

/** That server's link, or null. */
function of(key) {
  if (!key) return null;
  if (links.has(key)) return links.get(key);
  const entry = entries().find((e) => e.key === key);
  return entry ? linkOf(entry) : null;
}

/** Every saved server's link, in list order. */
function all() {
  return entries().map(linkOf);
}

/** The server keyless callers use: the first connected one, else the first saved. */
function defaultLink() {
  const ls = all();
  return ls.find((l) => l.isConnected()) || ls[0] || null;
}

/** The key for `keyOrHost`: a saved key, a saved host, or null. */
function resolveKey(keyOrHost) {
  const v = String(keyOrHost || '').trim();
  if (!v) return null;
  const saved = entries();
  const byKey = saved.find((e) => e.key === v);
  if (byKey) return byKey.key;
  const byHost = saved.find((e) => e.host.toLowerCase() === v.toLowerCase());
  return byHost ? byHost.key : null;
}

// ─── Add / remove / connect / disconnect ──────────────────────

/** Save a new server (not connected yet). `{ error, entry }`. */
function add(host) {
  const res = L.addServer(entries(), host);
  if (res.error) return { error: res.error, existing: res.existing || null };
  save(res.list);
  linkOf(res.entry);
  broadcast();
  return { error: null, entry: res.entry };
}

/** Forget a server: its link stops, its entry goes. Nothing on the server is touched. */
function remove(key) {
  const link = links.get(key);
  links.delete(key);
  if (link) link.stop();
  const had = entries().some((e) => e.key === key);
  save(L.removeServer(entries(), key));
  if (had) bus.emit('removed', { key }, key);
  broadcast();
  return { error: null };
}

/**
 * Connect a saved server by key, or a host (added when not listed yet).
 * The server reconnects on the next launch until it is disconnected.
 */
function connect(keyOrHost) {
  let key = resolveKey(keyOrHost);
  if (!key) {
    const res = add(keyOrHost);
    if (res.error) return { error: res.error };
    key = res.entry.key;
  }
  save(L.updateServer(entries(), key, { autoConnect: true }));
  const link = of(key);
  link.connect();
  return { error: null, key, status: link.getStatus() };
}

/**
 * Disconnect one server (`key`), or every server when no key is given.
 * `forget` drops auto-connect for the next launch; `quiet` keeps the status.
 */
function disconnect(keyOrOpts, maybeOpts) {
  const key = typeof keyOrOpts === 'string' ? resolveKey(keyOrOpts) : null;
  const { forget = true, quiet = false } = (typeof keyOrOpts === 'object' && keyOrOpts) || maybeOpts || {};
  const targets = key ? [key] : entries().map((e) => e.key);
  let saved = entries();
  for (const k of targets) {
    const link = links.get(k);
    if (link) link.stop({ quiet });
    if (forget) saved = L.updateServer(saved, k, { autoConnect: false });
  }
  if (forget) save(saved);
  broadcast();
  return { error: null, status: getStatus() };
}

// ─── The default server's status (single-status UI) ───────────

function getStatus() {
  const link = defaultLink();
  return link ? link.getStatus() : OFF;
}

function isConnected() {
  const link = defaultLink();
  return !!(link && link.isConnected());
}

/**
 * Subscribe to a server event channel (`terminal.output`, …) or `connected` /
 * `disconnected` / `status` / `removed`. `fn(payload, key)` — from every server.
 */
function on(name, fn) {
  const key = ['connected', 'disconnected', 'status', 'removed'].includes(name) ? name : `event:${name}`;
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

/** Attach the (re)created window; on the first call, reconnect every server left connected. */
let started = false;
function init(window, version) {
  mainWindow = window;
  if (version) frameVersion = version;
  if (started) return;
  started = true;
  for (const key of L.autoConnectKeys(entries())) of(key).connect();
}

// ─── Install / update / rollback (server-install-update) ───────

/**
 * Run an installer action on one server (`key`, or `host`, else the default
 * one) with progress, then connect it again. Update and rollback first ask
 * about running agents: without `confirmAgents` they return
 * `{ needsConsent, agents }`.
 */
async function runAction(kind, { key: givenKey, host: givenHost, confirmAgents = false } = {}) {
  let key = resolveKey(givenKey) || resolveKey(givenHost);
  if (!key && givenHost) {
    const res = add(givenHost);
    if (res.error) return { error: res.error };
    key = res.entry.key;
  }
  const link = key ? of(key) : defaultLink();
  if (!link) return { error: 'Choose a server first.' };
  return link.runAction(kind, { confirmAgents });
}

function setupIPC(ipcMain) {
  for (const ch of [IPC.SERVER_INSTALL, IPC.SERVER_UPDATE, IPC.SERVER_ROLLBACK, IPC.SERVER_DOCTOR, IPC.SERVER_STATUS,
    IPC.SERVER_CONNECT, IPC.SERVER_DISCONNECT, IPC.SERVER_SSH_HOSTS, IPC.SERVERS_LIST, IPC.SERVER_ADD, IPC.SERVER_REMOVE]) {
    ipcMain.removeHandler(ch);
  }
  ipcMain.handle(IPC.SERVER_INSTALL, (event, opts = {}) => runAction('install', opts));
  ipcMain.handle(IPC.SERVER_UPDATE, (event, opts = {}) => runAction('update', opts));
  ipcMain.handle(IPC.SERVER_ROLLBACK, (event, opts = {}) => runAction('rollback', opts));
  ipcMain.handle(IPC.SERVER_DOCTOR, async (event, { key } = {}) => {
    const link = key ? of(resolveKey(key)) : defaultLink();
    if (!link || !link.isConnected()) return { error: 'Not connected.', items: [] };
    try { return { error: null, ...(await link.call('server.doctor', {}, 30000)) }; } catch (err) { return { error: err.message, items: [] }; }
  });
  ipcMain.handle(IPC.SERVER_STATUS, () => {
    const first = entries()[0];
    return { ...getStatus(), saved: first ? { host: first.host, autoConnect: first.autoConnect } : null, servers: list() };
  });
  ipcMain.handle(IPC.SERVERS_LIST, () => list());
  ipcMain.handle(IPC.SERVER_ADD, (event, { host } = {}) => add(host));
  ipcMain.handle(IPC.SERVER_REMOVE, (event, { key } = {}) => remove(resolveKey(key)));
  ipcMain.handle(IPC.SERVER_CONNECT, (event, { key, host } = {}) => connect(key || host));
  ipcMain.handle(IPC.SERVER_DISCONNECT, (event, { key } = {}) => (key ? disconnect(key, { forget: true }) : disconnect({ forget: true })));
  ipcMain.handle(IPC.SERVER_SSH_HOSTS, () => sshHosts());
}

module.exports = {
  init, setupIPC, add, remove, connect, disconnect, of, all, list,
  on, getStatus, isConnected, sshHosts, runAction
};
