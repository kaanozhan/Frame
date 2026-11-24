/**
 * Tasks Manager Module
 * Handles task CRUD operations for Frame projects.
 *
 * Schema: tasks.json holds a single flat `tasks: []` array. Each task carries
 * a `status` field ('pending' | 'in_progress' | 'completed') which is the
 * single source of truth for its state. Older files using the nested
 * { pending, inProgress, completed } shape are migrated transparently on load.
 */

const fs = require('fs');
const fsSafe = require('./fsSafe');
const frameStore = require('./frameStore');
const activityLog = require('./activityLog');
const { IPC } = require('../shared/ipcChannels');
const { FRAME_FILES } = require('../shared/frameConstants');
const { mergeTaskLists, homeOf, splitOrder } = require('../shared/serverTasks');

const VALID_STATUSES = ['pending', 'in_progress', 'completed'];
const SELF_WRITE_GUARD_MS = 250;

let mainWindow = null;
let currentProjectPath = null;

let watcher = null;
let watchedPath = null;
let lastSelfWriteAt = 0;
let watchDebounceTimer = null;

// Parse-once cache: one tasks.json parse per on-disk version. Keyed on
// path+mtime+size so any external write invalidates it; saveTasks refreshes
// it after our own writes. A single spec push used to re-parse this file
// once per spec directory — with the cache every caller inside one change
// window shares the same parsed object. Safe because every mutation path
// in this module (and specManager's) mutates-then-saves synchronously.
let loadCache = { key: null, data: null };

function cacheKeyFor(tasksPath) {
  try {
    const st = fs.statSync(tasksPath);
    return `${tasksPath}:${st.mtimeMs}:${st.size}`;
  } catch (_) {
    return null; // missing file — never cached
  }
}

function init(window) {
  mainWindow = window;
}

function setProjectPath(projectPath) {
  currentProjectPath = projectPath;
}

// Where tasks.json lives is frameStore's answer, not ours: `.frame/tasks.json`
// for a migrated project, the root for one that has not migrated yet. Still a
// path here because the parse-once cache keys on the file's mtime+size.
function getTasksFilePath(projectPath) {
  return frameStore.resolvePath(projectPath || currentProjectPath, FRAME_FILES.TASKS);
}

/**
 * Migrate the old nested shape ({ pending, inProgress, completed }) into a
 * flat array. The per-task `status` field wins over array placement (this
 * fixes drift caused by external edits that updated status without moving
 * the task). Duplicates by id are collapsed, keeping the entry with the
 * latest updatedAt.
 */
function flattenLegacyTasks(legacy) {
  const arrayStatus = { pending: 'pending', inProgress: 'in_progress', completed: 'completed' };
  const flat = [];
  for (const key of Object.keys(arrayStatus)) {
    const arr = Array.isArray(legacy[key]) ? legacy[key] : [];
    for (const task of arr) {
      const status = VALID_STATUSES.includes(task.status) ? task.status : arrayStatus[key];
      flat.push({ ...task, status });
    }
  }
  return flat;
}

function dedupById(tasks) {
  const byId = new Map();
  for (const task of tasks) {
    if (!task || !task.id) continue;
    const existing = byId.get(task.id);
    if (!existing) {
      byId.set(task.id, task);
      continue;
    }
    const a = Date.parse(existing.updatedAt || existing.createdAt || 0) || 0;
    const b = Date.parse(task.updatedAt || task.createdAt || 0) || 0;
    if (b >= a) byId.set(task.id, task);
  }
  return Array.from(byId.values());
}

/**
 * Read tasks.json from disk, migrate/normalize, and return the canonical
 * shape. If migration or dedup changed anything, write the result back so
 * the file becomes self-healing.
 */
function loadTasks(projectPath) {
  const tasksPath = getTasksFilePath(projectPath);

  const cacheKey = cacheKeyFor(tasksPath);
  if (cacheKey && loadCache.key === cacheKey && loadCache.data) {
    return loadCache.data;
  }

  const { data, source, error } = frameStore.getTasks(projectPath || currentProjectPath);
  if (!data && !error) return null; // no tasks.json — not a Frame project yet

  if (source === 'bak') {
    console.error('tasksManager: tasks.json was corrupt — restored from .bak');
    sendTasksFileError(projectPath, { recovered: true });
  } else if (!data) {
    // Unrecoverable corruption. The broken file is already preserved as
    // .corrupt-<ts>, so writing a fresh empty file destroys nothing — and
    // keeps CRUD alive (without it, the moved-aside file would read as "no
    // tasks.json" and every mutation would no-op like the old silent null).
    // The `corrupt` flag gives the panel and dashboard one consistent error
    // state; it lives only in memory, never on disk.
    console.error('tasksManager: tasks.json corrupt with no usable .bak (corrupt copy preserved):', error.message);
    sendTasksFileError(projectPath, { recovered: false });
    const fresh = { version: '2.0', tasks: [] };
    saveTasks(projectPath, fresh);
    return { ...fresh, corrupt: true };
  }

  const raw = data;

  let mutated = false;
  let tasks;

  if (Array.isArray(raw.tasks)) {
    tasks = raw.tasks;
  } else if (raw.tasks && typeof raw.tasks === 'object') {
    tasks = flattenLegacyTasks(raw.tasks);
    mutated = true;
  } else {
    tasks = [];
    mutated = true;
  }

  const deduped = dedupById(tasks);
  if (deduped.length !== tasks.length) mutated = true;
  tasks = deduped;

  for (const task of tasks) {
    if (!VALID_STATUSES.includes(task.status)) {
      task.status = 'pending';
      mutated = true;
    }
  }

  raw.tasks = tasks;

  if (mutated) {
    raw.version = '2.0';
    saveTasks(projectPath, raw); // refreshes the cache on success
  } else {
    loadCache = { key: cacheKeyFor(tasksPath), data: raw };
  }

  return raw;
}

function saveTasks(projectPath, tasksData) {
  try {
    tasksData.lastUpdated = new Date().toISOString();
    delete tasksData.corrupt; // in-memory flag only — never persisted
    lastSelfWriteAt = Date.now();
    frameStore.saveTasks(projectPath || currentProjectPath, tasksData);
    loadCache = { key: cacheKeyFor(getTasksFilePath(projectPath)), data: tasksData };
    return true;
  } catch (err) {
    console.error('Error saving tasks:', err);
    loadCache = { key: null, data: null };
    return false;
  }
}

/**
 * Tell the renderer tasks.json is corrupt (or was auto-recovered from .bak)
 * so the tasks panel and dashboard render one consistent error state.
 */
function sendTasksFileError(projectPath, info) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(IPC.TASKS_FILE_ERROR, {
    projectPath: projectPath || currentProjectPath,
    ...info
  });
}

function generateTaskId() {
  return `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function addTask(projectPath, task) {
  const tasksData = loadTasks(projectPath);
  if (!tasksData) return null;

  const newTask = {
    id: generateTaskId(),
    title: task.title || 'Untitled Task',
    description: task.description || '',
    // The New Task form's request text, kept exactly as typed
    // (tasks-list-view spec, D14). A blank request records none.
    ...(typeof task.userRequest === 'string' && task.userRequest.trim()
      ? { userRequest: task.userRequest }
      : {}),
    status: 'pending',
    priority: task.priority || 'medium',
    category: task.category || 'feature',
    context: task.context || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null
  };

  tasksData.tasks.push(newTask);
  tasksData.metadata = tasksData.metadata || {};
  tasksData.metadata.totalCreated = (tasksData.metadata.totalCreated || 0) + 1;

  return saveTasks(projectPath, tasksData) ? newTask : null;
}

function updateTask(projectPath, taskId, updates) {
  const tasksData = loadTasks(projectPath);
  if (!tasksData) return null;

  const task = tasksData.tasks.find(t => t.id === taskId);
  if (!task) return null;

  const incomingStatus = updates.status;
  Object.assign(task, updates, { updatedAt: new Date().toISOString() });

  if (incomingStatus && VALID_STATUSES.includes(incomingStatus)) {
    task.status = incomingStatus;
    if (incomingStatus === 'completed') {
      task.completedAt = new Date().toISOString();
      tasksData.metadata = tasksData.metadata || {};
      tasksData.metadata.totalCompleted = (tasksData.metadata.totalCompleted || 0) + 1;
      // Lazy require, same reason as frameProject: analytics pulls
      // posthog-node and electron, and CI runs the suite with no
      // node_modules. Keep this module's load graph Electron-free.
      // Nothing about the task is sent — not its title, not its id.
      try {
        require('./analytics').track('task_completed');
      } catch (_) { /* analytics is never allowed to break a task write */ }
    }
  }

  return saveTasks(projectPath, tasksData) ? task : null;
}

function deleteTask(projectPath, taskId) {
  const tasksData = loadTasks(projectPath);
  if (!tasksData) return false;

  const idx = tasksData.tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return false;

  tasksData.tasks.splice(idx, 1);
  return saveTasks(projectPath, tasksData);
}

/**
 * Reorder tasks. The renderer sends an ordered list of { id, status? }
 * describing the new arrangement, and the backend rebuilds tasks.json so
 * array position follows it. An entry that carries a valid status moves the
 * task to it; an entry with no status keeps the task's own, so an order
 * write that sends ids only can never change a status.
 * Tasks not present in the order list are appended at the end (defensive —
 * should not happen in normal flow but keeps any concurrent additions from
 * being dropped).
 */
function reorderTasks(projectPath, order) {
  const tasksData = loadTasks(projectPath);
  if (!tasksData || !Array.isArray(order)) return false;

  const byId = new Map(tasksData.tasks.map(t => [t.id, t]));
  const seen = new Set();
  const reordered = [];
  const now = new Date().toISOString();

  for (const entry of order) {
    if (!entry || !entry.id) continue;
    const task = byId.get(entry.id);
    if (!task) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);

    const newStatus = VALID_STATUSES.includes(entry.status) ? entry.status : task.status;
    if (newStatus !== task.status) {
      task.status = newStatus;
      task.updatedAt = now;
      if (newStatus === 'completed' && !task.completedAt) {
        task.completedAt = now;
        tasksData.metadata = tasksData.metadata || {};
        tasksData.metadata.totalCompleted = (tasksData.metadata.totalCompleted || 0) + 1;
      } else if (newStatus !== 'completed') {
        task.completedAt = null;
      }
    }
    reordered.push(task);
  }

  for (const task of tasksData.tasks) {
    if (!seen.has(task.id)) reordered.push(task);
  }

  tasksData.tasks = reordered;
  return saveTasks(projectPath, tasksData);
}

/**
 * Watch the directory that holds tasks.json for changes. External edits
 * (CLI / manual edit) trigger a re-read and a TASKS_DATA push to the renderer
 * so the UI stays in sync without requiring the panel to be reopened.
 *
 * The directory is frameStore.metaDir() — `.frame/` for a migrated project,
 * the project root for one that has not migrated yet — so a layout change
 * moves the watcher with the file (call restartWatching() after migrating).
 *
 * We watch the directory (not the file) because tools that write atomically
 * via rename — Claude Code, vim, prettier — replace the inode that a
 * file-level fs.watch is bound to, silently killing the watcher. A directory
 * watcher survives renames and reports both `change` and `rename` events.
 *
 * `lastSelfWriteAt` suppresses the watcher event that fires from our own
 * saveTasks() call to avoid a feedback loop.
 */
let tasksFires = 0;

function startWatching(projectPath) {
  if (!projectPath || !fs.existsSync(projectPath)) return;

  const dir = frameStore.metaDir(projectPath);
  if (watcher && watchedPath === dir) return;
  stopWatching();

  if (!fs.existsSync(dir)) return;

  try {
    watcher = fsSafe.safeWatch(dir, { persistent: false }, (eventType, filename) => {
      if (!filename) return;
      notifyMetaChange(projectPath, filename);
      if (filename !== FRAME_FILES.TASKS) return;
      if (Date.now() - lastSelfWriteAt < SELF_WRITE_GUARD_MS) {
        activityLog.record('watch.suppressed', { watcher: 'tasks-root', reason: 'self-write' });
        return;
      }

      tasksFires += 1;
      clearTimeout(watchDebounceTimer);
      watchDebounceTimer = setTimeout(() => {
        activityLog.record('watch.fired', {
          watcher: 'tasks-root',
          changes: 1,
          collapsed: tasksFires,
          triggered: 'push'
        });
        tasksFires = 0;
        pushTasks(projectPath);
      }, 50);
    });
    watchedPath = dir;
  } catch (err) {
    console.error('Error watching project dir:', err);
    watcher = null;
    watchedPath = null;
  }
}

/**
 * Other modules care about the meta directory too — frameProject keeps the
 * generated `.claude/rules/frame.md` in step with `AGENTS.md`. They register
 * here rather than opening a second watcher on the same directory.
 */
const metaChangeListeners = [];

function onMetaFileChange(listener) {
  if (typeof listener === 'function') metaChangeListeners.push(listener);
}

function notifyMetaChange(projectPath, filename) {
  for (const listener of metaChangeListeners) {
    try {
      listener(projectPath, filename);
    } catch (err) {
      console.error('tasksManager: meta-change listener failed', err);
    }
  }
}

/**
 * Re-arm the watcher on the project's current meta directory. Migration moves
 * tasks.json from the root into `.frame/`, which leaves the old directory
 * watcher pointing at a file that no longer changes.
 */
function restartWatching(projectPath) {
  stopWatching();
  startWatching(projectPath);
}

function stopWatching() {
  if (watcher) {
    try { watcher.close(); } catch (_) { /* ignore */ }
  }
  watcher = null;
  watchedPath = null;
  clearTimeout(watchDebounceTimer);
  watchDebounceTimer = null;
}

// ─── Server projects' tasks (server-tasks T04) ────────────────
//
// A project on a Frame Server keeps its task state in that clone's
// tasks.json (server-specs B1). The desktop lists those tasks next to the
// Mac's: one cache entry per server and server project — every workspace of
// the project on that server shares the clone's file — read with
// `tasks.list`, followed with `tasks.watch` / `tasks.changed`, and merged
// into every TASKS_DATA push by tasksPayload (shared/serverTasks). A down
// server keeps its last list, tagged offline; a Frame Server without
// `tasks.list` gets an "update" note instead of tasks. Desktop only: Frame
// Server runs this module for the clone and never reaches this section.

// `${serverKey}\u0000${serverProjectPath}` → { projectPath, serverKey, serverProjectPath, host, tasksPath, tasks, offline, unsupported }
const serverTasks = new Map();
let serverTasksWired = false;
let serverRowsTimer = null;
const SERVER_ROWS_SETTLE_MS = 1500;
const SERVER_CALL_MS = 30 * 1000;

const serverEntryKey = (serverKey, serverProjectPath) => `${serverKey}\u0000${serverProjectPath}`;

function serverConn() {
  return require('./serverConnection');
}

/** The connected link of a server key, or null (down, removed, or no key). */
function linkOf(serverKey) {
  try {
    const link = serverKey ? serverConn().of(serverKey) : null;
    return link && link.isConnected() ? link : null;
  } catch (_) {
    return null;
  }
}

/** The server projects holding `projectPath`: one per server and server project, from the server workspace rows. */
function serverProjectsOf(projectPath) {
  let roots = [];
  try { roots = require('./workspaceManager').serverRoots() || []; } catch (_) { roots = []; }
  const out = new Map();
  for (const r of roots) {
    if (!r || r.projectPath !== projectPath || !r.serverKey || !r.serverProjectPath) continue;
    const key = serverEntryKey(r.serverKey, r.serverProjectPath);
    if (!out.has(key)) out.set(key, { key, serverKey: r.serverKey, serverProjectPath: r.serverProjectPath, host: r.host || null });
  }
  return [...out.values()];
}

/** The cached server lists of `projectPath`, in the shape mergeTaskLists takes. */
function serverListsOf(projectPath) {
  const out = [];
  for (const e of serverTasks.values()) {
    if (e.projectPath !== projectPath || e.unsupported) continue;
    out.push({ host: e.host, serverKey: e.serverKey, serverProjectPath: e.serverProjectPath, tasksPath: e.tasksPath, offline: e.offline, tasks: e.tasks });
  }
  return out;
}

/** `[{ host, kind: 'offline' | 'update' }]` for the board's notices. */
function serverNotesOf(projectPath) {
  const out = [];
  for (const e of serverTasks.values()) {
    if (e.projectPath !== projectPath) continue;
    if (e.unsupported) out.push({ host: e.host, kind: 'update' });
    else if (e.offline) out.push({ host: e.host, kind: 'offline' });
  }
  return out;
}

/**
 * What every TASKS_DATA push carries: the Mac's file with its tasks merged
 * with the cached server tasks, the Mac's tasks.json path (Play names it),
 * and the server notes. A project without server workspaces gets the Mac's
 * tasks exactly as before, plus `tasksPath` and an empty `serverNotes`.
 */
function tasksPayload(projectPath, macData) {
  const lists = serverListsOf(projectPath);
  const tasks = macData && Array.isArray(macData.tasks)
    ? { ...macData, tasks: mergeTaskLists(macData.tasks, lists) }
    : macData;
  let tasksPath = null;
  try { tasksPath = projectPath ? frameStore.resolvePath(projectPath, FRAME_FILES.TASKS) : null; } catch (_) { tasksPath = null; }
  return { projectPath, tasks, tasksPath, serverNotes: serverNotesOf(projectPath) };
}

/** Push the merged list of `projectPath` to the window. */
function pushTasks(projectPath) {
  if (!projectPath || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(IPC.TASKS_DATA, tasksPayload(projectPath, loadTasks(projectPath)));
}

/** Tag one server's entries (or every server's) offline. Returns whether anything changed. */
function markServerTasksOffline(serverKey = null) {
  let changed = false;
  for (const e of serverTasks.values()) {
    if (serverKey && e.serverKey !== serverKey) continue;
    if (!e.offline && !e.unsupported) { e.offline = true; changed = true; }
  }
  return changed;
}

/**
 * Re-read the server tasks of `projectPath` (only `onlyKey`'s server when
 * given), ask each server to watch the project, and push when anything
 * changed. Never throws: a server that fails keeps its last list.
 */
async function refreshServerTasks(projectPath, { onlyKey = null } = {}) {
  if (!projectPath) return;
  wireServerTasks();
  const projects = serverProjectsOf(projectPath);
  const wanted = new Set(projects.map((p) => p.key));
  let changed = false;
  // Server projects that left (workspace archived, server removed) leave the list.
  for (const [key, e] of serverTasks) {
    if (e.projectPath === projectPath && !wanted.has(key)) { serverTasks.delete(key); changed = true; }
  }
  for (const p of projects) {
    if (onlyKey && p.serverKey !== onlyKey) continue;
    const known = serverTasks.get(p.key);
    const link = linkOf(p.serverKey);
    if (!link) {
      if (known) { if (!known.offline && !known.unsupported) { known.offline = true; changed = true; } }
      else { serverTasks.set(p.key, { projectPath, ...p, tasksPath: null, tasks: [], offline: true, unsupported: false }); changed = true; }
      continue;
    }
    try {
      const res = await link.call('tasks.list', { projectPath: p.serverProjectPath }, SERVER_CALL_MS);
      serverTasks.set(p.key, { projectPath, ...p, tasksPath: (res && res.tasksPath) || null, tasks: (res && Array.isArray(res.tasks)) ? res.tasks : [], offline: false, unsupported: false });
      changed = true;
      link.call('tasks.watch', { projectPath: p.serverProjectPath }).catch(() => { /* gone meanwhile — the next connect retries */ });
    } catch (err) {
      const msg = String((err && err.message) || err);
      if (/Unknown method/i.test(msg)) {
        serverTasks.set(p.key, { projectPath, ...p, tasksPath: null, tasks: [], offline: false, unsupported: true });
      } else if (!link.isConnected()) {
        if (known) known.offline = true;
        else serverTasks.set(p.key, { projectPath, ...p, tasksPath: null, tasks: [], offline: true, unsupported: false });
      } else {
        // The server answered with a refusal (local mode, not a Frame
        // project there): no tasks of its to list.
        serverTasks.delete(p.key);
        console.warn('tasksManager: tasks.list on', p.host, 'refused:', msg);
      }
      changed = true;
    }
  }
  if (changed) pushTasks(projectPath);
}

// One refresh per project at a time; LOAD_TASKS (sent by several surfaces as
// they open) refreshes at most every LOAD_REFRESH_MS. Server pushes, connects
// and workspace changes are not throttled.
const refreshing = new Map(); // projectPath → Promise
const lastLoadRefresh = new Map(); // projectPath → ms
const LOAD_REFRESH_MS = 2000;

function refreshOnce(projectPath, opts) {
  if (refreshing.has(projectPath)) return refreshing.get(projectPath);
  const run = refreshServerTasks(projectPath, opts).finally(() => refreshing.delete(projectPath));
  refreshing.set(projectPath, run);
  return run;
}

/** A surface asked for the tasks: refresh the servers' unless that just happened. */
function refreshOnLoad(projectPath) {
  if (!projectPath) return null;
  const last = lastLoadRefresh.get(projectPath) || 0;
  if (Date.now() - last < LOAD_REFRESH_MS || refreshing.has(projectPath)) return refreshing.get(projectPath) || null;
  lastLoadRefresh.set(projectPath, Date.now());
  return refreshOnce(projectPath);
}

/** Follow the servers: their pushes, connects, drops and removal, and the server workspace set. */
function wireServerTasks() {
  if (serverTasksWired) return;
  let sc;
  try { sc = serverConn(); } catch (_) { return; }
  serverTasksWired = true;
  sc.on('tasks.changed', ({ projectPath: serverProjectPath } = {}, key) => {
    if (!currentProjectPath) return;
    const known = [...serverTasks.values()].some((e) => e.projectPath === currentProjectPath && e.serverKey === key && e.serverProjectPath === serverProjectPath);
    if (known) refreshServerTasks(currentProjectPath, { onlyKey: key }).catch(() => { /* reported inside */ });
  });
  sc.on('connected', (status, key) => {
    if (currentProjectPath) refreshServerTasks(currentProjectPath, { onlyKey: key || null }).catch(() => { /* reported inside */ });
  });
  sc.on('disconnected', (status, key) => {
    if (markServerTasksOffline(key || null) && currentProjectPath) pushTasks(currentProjectPath);
  });
  sc.on('removed', (payload, key) => {
    let changed = false;
    for (const [k, e] of [...serverTasks]) if (e.serverKey === key) { serverTasks.delete(k); changed = true; }
    if (changed && currentProjectPath) pushTasks(currentProjectPath);
  });
  // Server workspace rows reach workspaceManager when the renderer re-lists
  // after this event; give that a moment, then follow the new set.
  sc.on('workspaces.updated', () => {
    if (serverRowsTimer) clearTimeout(serverRowsTimer);
    serverRowsTimer = setTimeout(() => {
      serverRowsTimer = null;
      if (currentProjectPath) refreshServerTasks(currentProjectPath).catch(() => { /* reported inside */ });
    }, SERVER_ROWS_SETTLE_MS);
    if (typeof serverRowsTimer.unref === 'function') serverRowsTimer.unref();
  });
}

// ─── Routing a change to the task's home (server-tasks T05) ─────
//
// The renderer keeps its IPC: update, delete and reorder name task ids, and
// main finds each task's home in the merged list (homeOf / splitOrder); add
// names the selected workspace. A server task's change goes to that server
// only, through its own link; while the server is down the change is refused
// with its host named — it never falls back to the Mac or another server.

const offlineText = (host) => `${host || 'The server'} is offline — reconnect to change its tasks.`;

function mergedOf(projectPath) {
  const mac = loadTasks(projectPath);
  return mergeTaskLists(mac && mac.tasks, serverListsOf(projectPath));
}

/** The connected link for a server home, or `{ error }` with the host named. */
function serverHome(home) {
  const link = !home.offline ? linkOf(home.serverKey) : null;
  return link ? { link } : { error: offlineText(home.host) };
}

/** After a server change: re-read that server's list and push, so the board shows it at once. */
async function settleServer(projectPath, serverKey) {
  try { await refreshServerTasks(projectPath, { onlyKey: serverKey }); } catch (_) { /* reported inside */ }
}

/** `{ success, task?, error? }` — an update for whichever home holds `taskId`. */
async function routeUpdate(projectPath, taskId, updates) {
  const home = homeOf(taskId, mergedOf(projectPath));
  if (!home || home.location === 'mac') {
    const task = updateTask(projectPath, taskId, updates);
    return { success: !!task, task };
  }
  const { link, error } = serverHome(home);
  if (error) return { success: false, error };
  try {
    const res = await link.call('tasks.update', { projectPath: home.serverProjectPath, taskId, updates }, SERVER_CALL_MS);
    await settleServer(projectPath, home.serverKey);
    return { success: true, task: res && res.task };
  } catch (err) {
    return { success: false, error: `${home.host || 'The server'}: ${err.message}` };
  }
}

async function routeDelete(projectPath, taskId) {
  const home = homeOf(taskId, mergedOf(projectPath));
  if (!home || home.location === 'mac') return { success: !!deleteTask(projectPath, taskId) };
  const { link, error } = serverHome(home);
  if (error) return { success: false, error };
  try {
    const res = await link.call('tasks.delete', { projectPath: home.serverProjectPath, taskId }, SERVER_CALL_MS);
    await settleServer(projectPath, home.serverKey);
    return { success: !!(res && res.success) };
  } catch (err) {
    return { success: false, error: `${home.host || 'The server'}: ${err.message}` };
  }
}

/** Each home gets its part of the order; a down server's part is refused, the rest still applies. */
async function routeReorder(projectPath, order) {
  if (!Array.isArray(order)) return { success: false };
  const split = splitOrder(order, mergedOf(projectPath));
  let success = true;
  const errors = [];
  if (split.mac.length || !split.servers.length) success = !!reorderTasks(projectPath, split.mac) && success;
  for (const part of split.servers) {
    const { link, error } = serverHome(part);
    if (error) { success = false; errors.push(error); continue; }
    try {
      const res = await link.call('tasks.reorder', { projectPath: part.serverProjectPath, order: part.order }, SERVER_CALL_MS);
      if (!(res && res.success)) success = false;
      await settleServer(projectPath, part.serverKey);
    } catch (err) {
      success = false;
      errors.push(`${part.host || 'The server'}: ${err.message}`);
    }
  }
  return errors.length ? { success, error: errors.join(' ') } : { success };
}

/** An add lands where the selected workspace lives: its server's clone, or the Mac. */
async function routeAdd(projectPath, task, workspaceId) {
  let loc = null;
  if (workspaceId && workspaceId !== 'main') {
    try { loc = require('./workspaceManager').serverLocation(workspaceId); } catch (_) { loc = null; }
  }
  if (!loc || loc.projectPath !== projectPath) {
    const added = addTask(projectPath, task);
    return { success: !!added, task: added };
  }
  const { link, error } = serverHome({ serverKey: loc.serverKey, host: loc.host, offline: false });
  if (error) return { success: false, error };
  try {
    const res = await link.call('tasks.add', { projectPath: loc.serverProjectPath, task }, SERVER_CALL_MS);
    await settleServer(projectPath, loc.serverKey);
    return { success: !!(res && res.task), task: res && res.task };
  } catch (err) {
    return { success: false, error: `${loc.host || 'The server'}: ${err.message}` };
  }
}

/** Test hook: forget every server entry and subscription. */
function resetServerTasksForTests() {
  serverTasks.clear();
  refreshing.clear();
  lastLoadRefresh.clear();
  serverTasksWired = false;
  if (serverRowsTimer) clearTimeout(serverRowsTimer);
  serverRowsTimer = null;
}

function setupIPC(ipcMain) {
  ipcMain.on(IPC.LOAD_TASKS, (event, projectPath) => {
    const tasks = loadTasks(projectPath);
    event.sender.send(IPC.TASKS_DATA, tasksPayload(projectPath, tasks));
    startWatching(projectPath);
    // The server workspaces' tasks follow (server-tasks): pushed when they change.
    const run = refreshOnLoad(projectPath);
    if (run) run.catch(() => { /* reported inside */ });
  });

  // Each change goes to the task's home — the Mac's file or its server's
  // clone (server-tasks T05). `error` names why a change was refused.
  ipcMain.on(IPC.ADD_TASK, async (event, { projectPath, task, workspaceId = null }) => {
    const res = await routeAdd(projectPath, task, workspaceId);
    event.sender.send(IPC.TASK_UPDATED, {
      projectPath,
      action: 'add',
      task: res.task || null,
      success: res.success,
      ...(res.error ? { error: res.error } : {})
    });
    event.sender.send(IPC.TASKS_DATA, tasksPayload(projectPath, loadTasks(projectPath)));
  });

  ipcMain.on(IPC.UPDATE_TASK, async (event, { projectPath, taskId, updates }) => {
    const res = await routeUpdate(projectPath, taskId, updates);
    event.sender.send(IPC.TASK_UPDATED, {
      projectPath,
      action: 'update',
      task: res.task || null,
      success: res.success,
      ...(res.error ? { error: res.error } : {})
    });
    event.sender.send(IPC.TASKS_DATA, tasksPayload(projectPath, loadTasks(projectPath)));
  });

  ipcMain.on(IPC.DELETE_TASK, async (event, { projectPath, taskId }) => {
    const res = await routeDelete(projectPath, taskId);
    event.sender.send(IPC.TASK_UPDATED, {
      projectPath,
      action: 'delete',
      taskId,
      success: res.success,
      ...(res.error ? { error: res.error } : {})
    });
    event.sender.send(IPC.TASKS_DATA, tasksPayload(projectPath, loadTasks(projectPath)));
  });

  ipcMain.on(IPC.REORDER_TASKS, async (event, { projectPath, order }) => {
    const res = await routeReorder(projectPath, order);
    event.sender.send(IPC.TASK_UPDATED, {
      projectPath,
      action: 'reorder',
      success: res.success,
      ...(res.error ? { error: res.error } : {})
    });
    event.sender.send(IPC.TASKS_DATA, tasksPayload(projectPath, loadTasks(projectPath)));
  });
}

/**
 * Timestamp of this module's last tasks.json write — exported so other
 * watchers of the same file (specManager) can suppress the event our own
 * save fires, exactly like this module's watcher does.
 */
function getLastSelfWriteAt() {
  return lastSelfWriteAt;
}

module.exports = {
  init,
  tasksPayload,
  refreshServerTasks,
  routeAdd,
  routeUpdate,
  routeDelete,
  routeReorder,
  resetServerTasksForTests,
  setProjectPath,
  loadTasks,
  saveTasks,
  addTask,
  updateTask,
  deleteTask,
  reorderTasks,
  setupIPC,
  stopWatching,
  restartWatching,
  onMetaFileChange,
  getLastSelfWriteAt
};
