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
 */

const crypto = require('crypto');
const { IPC } = require('../shared/ipcChannels');
const rules = require('../shared/queueRules');
const store = require('./queueStore');
const logger = require('./logger');

let mainWindow = null;

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
  if (!res.refused) push(projectPath);
  return res;
}

/** What every QUEUE_DATA push carries. The servers' queues join in T04. */
function queuePayload(projectPath) {
  const mac = macQueue(projectPath);
  const shown = rules.deriveMissing(mac.items, macSources(projectPath));
  return {
    projectPath,
    items: rules.mergeQueues(shown, []),
    parallel: mac.parallel,
    parallels: { mac: mac.parallel, servers: {} },
    serverNotes: []
  };
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

/** `source` = { kind, ref, title, status?, source?, phase?, malformed? } (+ location fields from T04). */
function addSource(projectPath, source) {
  const res = macChange(projectPath, (q) => rules.add(q, source, { id: newId(), now: nowIso() }));
  return reply(res, { item: res.item });
}

function removeItem(projectPath, itemId) {
  return reply(macChange(projectPath, (q) => rules.remove(q, itemId)));
}

function reorderItems(projectPath, ids) {
  return reply(macChange(projectPath, (q) => rules.reorder(q, ids)));
}

/** Done (review → done), Continue (needs-you → queued), Reset (→ queued), flow mode. */
function setItem(projectPath, itemId, action, mode = null) {
  const now = nowIso();
  switch (action) {
    case 'done': return reply(macChange(projectPath, (q) => rules.setState(q, itemId, rules.STATES.DONE, {}, { now })));
    case 'continue':
    case 'reset': return reply(macChange(projectPath, (q) => rules.setState(q, itemId, rules.STATES.QUEUED, {}, { now })));
    case 'flowMode': return reply(macChange(projectPath, (q) => rules.setFlowMode(q, itemId, mode)));
    default: return { ok: false, error: 'Unknown action.' };
  }
}

function setParallel(projectPath, n) {
  const res = macChange(projectPath, (q) => rules.setParallel(q, n));
  return { ok: true, parallel: res.queue.parallel };
}

// ─── wiring ─────────────────────────────────────────────────

function init(window) {
  mainWindow = window;
}

function setupIPC(ipcMain) {
  ipcMain.handle(IPC.QUEUE_LOAD, (event, { projectPath } = {}) => queuePayload(projectPath));
  ipcMain.handle(IPC.QUEUE_ADD, (event, { projectPath, source } = {}) => addSource(projectPath, source));
  ipcMain.handle(IPC.QUEUE_REMOVE, (event, { projectPath, itemId } = {}) => removeItem(projectPath, itemId));
  ipcMain.handle(IPC.QUEUE_REORDER, (event, { projectPath, ids } = {}) => reorderItems(projectPath, ids));
  ipcMain.handle(IPC.QUEUE_SET, (event, { projectPath, itemId, action, mode } = {}) => setItem(projectPath, itemId, action, mode));
  ipcMain.handle(IPC.QUEUE_PARALLEL, (event, { projectPath, parallel } = {}) => setParallel(projectPath, parallel));
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
  setParallel
};
