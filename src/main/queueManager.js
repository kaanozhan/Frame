/**
 * queueManager — the desktop side of the work queue (work-queue spec, T03).
 *
 * The Mac's queue lives in the project's main checkout (`.frame/queue.json`,
 * plan D5). Every change goes through here so the window gets one QUEUE_DATA
 * push per change, whoever made it: the user (IPC) or the local Chief's queue
 * tools (leadHost, same process).
 *
 * Items are references (spec C1). The facts that decide whether something can
 * be queued (a task's status and source, a spec's phase) come with the
 * request; the rules in shared/queueRules decide.
 *
 * Servers (T04): each server project holding this project's workspaces has
 * its own queue on that server (src/server/queue.js). The desktop caches each
 * one, merges it after the Mac's (tagged with its host), follows its
 * `queue.changed` pushes, and routes every change of a server item to that
 * server only. A down server keeps its last list, tagged offline, and its
 * items cannot be changed; nothing falls back to the Mac (server-tasks).
 */

const crypto = require('crypto');
const { IPC } = require('../shared/ipcChannels');
const rules = require('../shared/queueRules');
const store = require('./queueStore');
const logger = require('./logger');

let mainWindow = null;
let currentProjectPath = null;

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function newId() {
  return `q_${crypto.randomBytes(4).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

/** The Mac's task ids and spec slugs, for deriving `missing` (S18); null when unknown. */
function macSources(projectPath) {
  let taskIds = null;
  let specSlugs = null;
  try {
    const data = require('./tasksManager').loadTasks(projectPath);
    if (data && Array.isArray(data.tasks)) taskIds = new Set(data.tasks.map((t) => t && t.id).filter(Boolean));
  } catch (_) { /* unknown → leave alone */ }
  try {
    const specs = require('./specManager').listSpecs(projectPath);
    if (Array.isArray(specs)) specSlugs = new Set(specs.map((s) => s && s.slug).filter(Boolean));
  } catch (_) { /* unknown → leave alone */ }
  return { taskIds, specSlugs };
}

/** The Mac's queue as stored. */
function macQueue(projectPath) {
  return store.load(projectPath);
}

/** Applies one rule to the Mac's queue, saves, pushes. Returns the rule result. */
function macChange(projectPath, fn) {
  if (!projectPath) return { refused: 'not-found' };
  const res = store.update(projectPath, fn);
  if (!res.refused) {
    push(projectPath);
    followWorktrees(projectPath, res.queue);
  }
  return res;
}

// ─── spec visibility (T09, plan D16) ────────────────────────
// specManager asks which queue worktrees are live; when that set changes it
// re-reads where each spec lives and watches the new worktrees.

const worktreeSig = new Map(); // projectPath → signature of its live worktree roots

function liveRoots(projectPath) {
  return rules.worktreeRoots(macQueue(projectPath).items);
}

function followWorktrees(projectPath, queue) {
  const sig = rules.worktreeRoots(queue.items).map((r) => r.root).sort().join('\n');
  if (worktreeSig.get(projectPath) === sig) return;
  worktreeSig.set(projectPath, sig);
  try { require('./specManager').refreshWorkspaceWatchers(projectPath); } catch (e) { logger.warn('queue', `spec watch refresh failed: ${e.message}`); }
}

/** What every QUEUE_DATA push carries: the Mac's queue, then each server's. */
function queuePayload(projectPath) {
  const mac = macQueue(projectPath);
  const shown = rules.deriveMissing(mac.items, macSources(projectPath));
  const lists = serverListsOf(projectPath);
  const servers = {};
  for (const l of lists) servers[l.serverKey] = l.parallel;
  return {
    projectPath,
    items: rules.mergeQueues(shown, lists),
    parallel: mac.parallel,
    parallels: { mac: mac.parallel, servers },
    confirm: mac.confirm,
    serverNotes: serverNotesOf(projectPath)
  };
}

// ─── server queues (T04) ────────────────────────────────────

// `${serverKey}\u0000${serverProjectPath}` → { projectPath, serverKey, serverProjectPath, host, items, parallel, offline, unsupported }
const serverQueues = new Map();
let serverWired = false;
let serverRowsTimer = null;
const SERVER_ROWS_SETTLE_MS = 1500;
const SERVER_CALL_MS = 30 * 1000;
const entryKey = (serverKey, serverProjectPath) => `${serverKey}\u0000${serverProjectPath}`;

function serverConn() {
  return require('./serverConnection');
}

function linkOf(serverKey) {
  try {
    const link = serverKey ? serverConn().of(serverKey) : null;
    return link && link.isConnected() ? link : null;
  } catch (_) {
    return null;
  }
}

/** The server projects holding `projectPath`, one per server and server project. */
function serverProjectsOf(projectPath) {
  let roots = [];
  try { roots = require('./workspaceManager').serverRoots() || []; } catch (_) { roots = []; }
  const out = new Map();
  for (const r of roots) {
    if (!r || r.projectPath !== projectPath || !r.serverKey || !r.serverProjectPath) continue;
    const key = entryKey(r.serverKey, r.serverProjectPath);
    if (!out.has(key)) out.set(key, { key, serverKey: r.serverKey, serverProjectPath: r.serverProjectPath, host: r.host || null });
  }
  return [...out.values()];
}

function serverListsOf(projectPath) {
  const out = [];
  for (const e of serverQueues.values()) {
    if (e.projectPath !== projectPath || e.unsupported) continue;
    out.push({ serverKey: e.serverKey, serverProjectPath: e.serverProjectPath, host: e.host, offline: e.offline, parallel: e.parallel, items: e.items });
  }
  return out;
}

function serverNotesOf(projectPath) {
  const out = [];
  for (const e of serverQueues.values()) {
    if (e.projectPath !== projectPath) continue;
    if (e.unsupported) out.push({ host: e.host, kind: 'update' });
    else if (e.offline) out.push({ host: e.host, kind: 'offline' });
  }
  return out;
}

function markOffline(serverKey = null) {
  let changed = false;
  for (const e of serverQueues.values()) {
    if (serverKey && e.serverKey !== serverKey) continue;
    if (!e.offline && !e.unsupported) { e.offline = true; changed = true; }
  }
  return changed;
}

/** Re-read the server queues of `projectPath` (only `onlyKey`'s when given), watch them, push. Never throws. */
async function refreshServerQueues(projectPath, { onlyKey = null } = {}) {
  if (!projectPath) return;
  wireServers();
  const projects = serverProjectsOf(projectPath);
  const wanted = new Set(projects.map((p) => p.key));
  let changed = false;
  for (const [key, e] of serverQueues) {
    if (e.projectPath === projectPath && !wanted.has(key)) { serverQueues.delete(key); changed = true; }
  }
  for (const p of projects) {
    if (onlyKey && p.serverKey !== onlyKey) continue;
    const known = serverQueues.get(p.key);
    const link = linkOf(p.serverKey);
    const blank = { projectPath, ...p, items: [], parallel: rules.DEFAULT_PARALLEL, offline: false, unsupported: false };
    if (!link) {
      if (known) { if (!known.offline && !known.unsupported) { known.offline = true; changed = true; } }
      else { serverQueues.set(p.key, { ...blank, offline: true }); changed = true; }
      continue;
    }
    try {
      const res = await link.call('queue.list', { projectPath: p.serverProjectPath }, SERVER_CALL_MS);
      const q = rules.normalizeQueue(res && res.queue);
      serverQueues.set(p.key, { ...blank, items: q.items, parallel: q.parallel, confirm: q.confirm });
      changed = true;
      link.call('queue.watch', { projectPath: p.serverProjectPath }).catch(() => { /* gone meanwhile — the next connect retries */ });
    } catch (err) {
      const msg = String((err && err.message) || err);
      if (/Unknown method/i.test(msg)) serverQueues.set(p.key, { ...blank, unsupported: true });
      else if (!link.isConnected()) { if (known) known.offline = true; else serverQueues.set(p.key, { ...blank, offline: true }); }
      else { serverQueues.delete(p.key); logger.warn('queue', `queue.list on ${p.host} refused: ${msg}`); }
      changed = true;
    }
  }
  if (changed) push(projectPath);
}

function wireServers() {
  if (serverWired) return;
  let sc;
  try { sc = serverConn(); } catch (_) { return; }
  serverWired = true;
  sc.on('queue.changed', ({ projectPath: serverProjectPath } = {}, key) => {
    if (!currentProjectPath) return;
    const known = [...serverQueues.values()].some((e) => e.projectPath === currentProjectPath && e.serverKey === key && e.serverProjectPath === serverProjectPath);
    if (known) {
      refreshServerQueues(currentProjectPath, { onlyKey: key }).catch(() => {});
      // A server item's spec runs in a queue worktree there; its phase reaches
      // the server's main listing (D16) — re-read it.
      try { require('./specManager').refreshServerSpecs(currentProjectPath).catch(() => {}); } catch (_) { /* not loaded */ }
    }
  });
  sc.on('connected', (status, key) => {
    if (currentProjectPath) refreshServerQueues(currentProjectPath, { onlyKey: key || null }).catch(() => {});
  });
  sc.on('disconnected', (status, key) => {
    if (markOffline(key || null) && currentProjectPath) push(currentProjectPath);
  });
  sc.on('removed', (payload, key) => {
    let changed = false;
    for (const [k, e] of [...serverQueues]) if (e.serverKey === key) { serverQueues.delete(k); changed = true; }
    if (changed && currentProjectPath) push(currentProjectPath);
  });
  sc.on('workspaces.updated', () => {
    if (serverRowsTimer) clearTimeout(serverRowsTimer);
    serverRowsTimer = setTimeout(() => {
      serverRowsTimer = null;
      if (currentProjectPath) refreshServerQueues(currentProjectPath).catch(() => {});
    }, SERVER_ROWS_SETTLE_MS);
    if (typeof serverRowsTimer.unref === 'function') serverRowsTimer.unref();
  });
}

const offlineText = (host) => `${host || 'The server'} is offline — reconnect to change its queue.`;

/** The home of an item id in the merged list: `{ location:'mac' }`, a server home, or null. */
function itemHome(projectPath, itemId) {
  return rules.homeOf(itemId, rules.mergeQueues(macQueue(projectPath).items, serverListsOf(projectPath)));
}

/** Calls `method` on a server home and re-reads that server's queue; `{ ok, res }` or `{ ok:false, error }`. */
async function onServer(projectPath, home, method, args) {
  const link = !home.offline ? linkOf(home.serverKey) : null;
  if (!link) return { ok: false, error: offlineText(home.host) };
  try {
    const res = await link.call(method, { projectPath: home.serverProjectPath, ...args }, SERVER_CALL_MS);
    try { await refreshServerQueues(projectPath, { onlyKey: home.serverKey }); } catch (_) { /* reported inside */ }
    return { ok: true, res };
  } catch (err) {
    return { ok: false, error: `${home.host || 'The server'}: ${err.message}` };
  }
}

/** The server home a source names (its task or spec lives on that server), or null for the Mac. */
function sourceHome(source) {
  const h = source && source.home;
  if (!h || h.location !== 'server' || !h.serverKey || !h.serverProjectPath) return null;
  const known = [...serverQueues.values()].find((e) => e.serverKey === h.serverKey && e.serverProjectPath === h.serverProjectPath);
  return { location: 'server', serverKey: h.serverKey, serverProjectPath: h.serverProjectPath, host: h.host || (known && known.host) || null, offline: known ? !!known.offline : !linkOf(h.serverKey) };
}

function cleanSource(source) {
  const { home, ...rest } = source || {};
  return rest;
}

function push(projectPath) {
  if (!projectPath) return;
  try {
    send(IPC.QUEUE_DATA, queuePayload(projectPath));
  } catch (e) {
    logger.warn('queue', `push failed: ${e.message}`);
  }
}

function errorOf(res) {
  return rules.REFUSAL_TEXT[res.refused] || 'That did not work.';
}

function reply(res, extra = {}) {
  return res.refused ? { ok: false, error: errorOf(res), reason: res.refused } : { ok: true, ...extra };
}

// ─── the user's actions ────────────────────────────────────

/**
 * `source` = { kind, ref, title, status?, source?, phase?, malformed?, home? }.
 * `home` = { location:'server', serverKey, serverProjectPath, host } for a task
 * or spec that lives on a server: the item goes into that server's queue.
 */
async function addSource(projectPath, source) {
  const home = sourceHome(source);
  if (home) {
    const r = await onServer(projectPath, home, 'queue.add', { source: cleanSource(source) });
    return r.ok ? { ok: true, item: r.res && r.res.item } : r;
  }
  const res = macChange(projectPath, (q) => rules.add(q, cleanSource(source), { id: newId(), now: nowIso() }));
  return reply(res, { item: res.item });
}

async function removeItem(projectPath, itemId) {
  const home = itemHome(projectPath, itemId);
  if (home && home.location === 'server') return okOnly(await onServer(projectPath, home, 'queue.remove', { itemId }));
  return reply(macChange(projectPath, (q) => rules.remove(q, itemId)));
}

/** Each home gets its own part of the order; a move never crosses homes. */
async function reorderItems(projectPath, ids) {
  if (!Array.isArray(ids)) return { ok: false, error: 'Missing order.' };
  const merged = rules.mergeQueues(macQueue(projectPath).items, serverListsOf(projectPath));
  const mac = [];
  const parts = new Map();
  for (const id of ids) {
    const home = rules.homeOf(id, merged);
    if (!home) continue;
    if (home.location === 'mac') { mac.push(id); continue; }
    const k = entryKey(home.serverKey, home.serverProjectPath);
    if (!parts.has(k)) parts.set(k, { home, ids: [] });
    parts.get(k).ids.push(id);
  }
  const errors = [];
  if (mac.length) { const r = reply(macChange(projectPath, (q) => rules.reorder(q, mac))); if (!r.ok) errors.push(r.error); }
  for (const { home, ids: part } of parts.values()) {
    const r = await onServer(projectPath, home, 'queue.reorder', { ids: part });
    if (!r.ok) errors.push(r.error);
  }
  return errors.length ? { ok: false, error: errors.join(' ') } : { ok: true };
}

/** Done (review → done), Continue (needs-you → queued), Reset (→ queued), flow mode. */
async function setItem(projectPath, itemId, action, mode = null) {
  if (!['done', 'continue', 'reset', 'flowMode'].includes(action)) return { ok: false, error: 'Unknown action.' };
  const home = itemHome(projectPath, itemId);
  if (home && home.location === 'server') return okOnly(await onServer(projectPath, home, 'queue.set', { itemId, action, mode }));
  const now = nowIso();
  if (action === 'done') return reply(macChange(projectPath, (q) => rules.setState(q, itemId, rules.STATES.DONE, {}, { now })));
  if (action === 'flowMode') return reply(macChange(projectPath, (q) => rules.setFlowMode(q, itemId, mode)));
  return reply(macChange(projectPath, (q) => rules.setState(q, itemId, rules.STATES.QUEUED, {}, { now })));
}

/** One machine's parallel limit: the Mac's, or `serverKey`'s for its server project. */
async function setParallel(projectPath, n, serverKey = null) {
  if (serverKey) {
    const e = [...serverQueues.values()].find((x) => x.projectPath === projectPath && x.serverKey === serverKey);
    if (!e) return { ok: false, error: 'That server holds no queue of this project.' };
    const r = await onServer(projectPath, { serverKey, serverProjectPath: e.serverProjectPath, host: e.host, offline: e.offline }, 'queue.parallel', { parallel: n });
    return r.ok ? { ok: true, parallel: r.res && r.res.parallel } : r;
  }
  const res = macChange(projectPath, (q) => rules.setParallel(q, n));
  return { ok: true, parallel: res.queue.parallel };
}

/**
 * "Before starting" for the whole project: this Mac's queue and every
 * connected server's (an offline one keeps its own until it is back).
 */
async function setConfirm(projectPath, confirm) {
  const value = rules.normalizeConfirm(confirm);
  macChange(projectPath, (q) => rules.setConfirm(q, value));
  const errors = [];
  for (const e of serverQueues.values()) {
    if (e.projectPath !== projectPath || e.unsupported || e.offline) continue;
    const r = await onServer(projectPath, { serverKey: e.serverKey, serverProjectPath: e.serverProjectPath, host: e.host, offline: e.offline }, 'queue.confirm', { confirm: value });
    if (!r.ok) errors.push(r.error);
  }
  return errors.length ? { ok: false, error: errors.join(' '), confirm: value } : { ok: true, confirm: value };
}

function okOnly(r) {
  return r.ok ? { ok: true } : r;
}

// ─── wiring ─────────────────────────────────────────────────

function init(window) {
  mainWindow = window;
  try { require('./specManager').setQueueRootsProvider(liveRoots); } catch (e) { logger.warn('queue', `spec provider not set: ${e.message}`); }
}

function setupIPC(ipcMain) {
  ipcMain.handle(IPC.QUEUE_LOAD, (event, { projectPath } = {}) => {
    if (projectPath) {
      currentProjectPath = projectPath;
      // After a restart the running items' terminals are gone: interrupted (D19).
      try {
        const live = new Set((require('./ptyManager').listTerminals(projectPath) || []).map((t) => t.id));
        const before = macQueue(projectPath);
        const after = store.reconcile(projectPath, live);
        if (after.items.some((it, i) => it.state !== (before.items[i] && before.items[i].state))) followWorktrees(projectPath, after);
      } catch (e) { logger.warn('queue', `reconcile failed: ${e.message}`); }
      refreshServerQueues(projectPath).catch(() => {});
    }
    return queuePayload(projectPath);
  });
  ipcMain.handle(IPC.QUEUE_ADD, (event, { projectPath, source } = {}) => addSource(projectPath, source));
  ipcMain.handle(IPC.QUEUE_REMOVE, (event, { projectPath, itemId } = {}) => removeItem(projectPath, itemId));
  ipcMain.handle(IPC.QUEUE_REORDER, (event, { projectPath, ids } = {}) => reorderItems(projectPath, ids));
  ipcMain.handle(IPC.QUEUE_SET, (event, { projectPath, itemId, action, mode } = {}) => setItem(projectPath, itemId, action, mode));
  ipcMain.handle(IPC.QUEUE_CONFIRM, (event, { projectPath, confirm } = {}) => setConfirm(projectPath, confirm));
  ipcMain.handle(IPC.QUEUE_PARALLEL, (event, { projectPath, parallel, serverKey = null } = {}) => setParallel(projectPath, parallel, serverKey));
}

module.exports = {
  init,
  setupIPC,
  push,
  queuePayload,
  macQueue,
  macChange,
  addSource,
  removeItem,
  reorderItems,
  setItem,
  setParallel,
  setConfirm,
  refreshServerQueues,
  serverListsOf,
  _resetForTests: () => { serverQueues.clear(); serverWired = false; currentProjectPath = null; }
};
