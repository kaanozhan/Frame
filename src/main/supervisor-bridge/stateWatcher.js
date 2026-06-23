// Supervisor state watcher (main) — Phase C reactive replacement for polling.
//
// fs.watch on heartbeat.json + tail of audit.jsonl + (when present) the
// queue/pending|done|failed directories. On any signal it pushes a payload
// {kind, data} to the renderer via webContents.send(SUPERVISOR_STATE, ...).
//
// Started lazily: register(ipcMain) installs the SUPERVISOR_STATE_INIT
// handler, and the watcher only spins up once the renderer announces the
// supervisor root (which it has to discover from /api/meta.audit_path anyway).
// Idempotent — re-calling start() with the same root is a no-op; a different
// root tears down + restarts.
//
// All filesystem errors are best-effort: a missing file or unreadable dir
// degrades to "no events for that signal" rather than crashing Frame. The
// supervisor isn't always running; we shouldn't pretend it is.

const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');
const SUP = require('../../shared/supervisor-ipc');

const AUDIT_THROTTLE_MS = 250;

let started = false;
let currentRoot = null;
let heartbeatWatcher = null;
let auditWatcher = null;
let auditOffset = 0;
let auditBuffer = '';
let auditPending = []; // collapsed events flushed on throttle window
let auditFlushTimer = null;
let queueWatchers = []; // [{dir, status, watcher}]

function send(channel, payload) {
  // Resolve the push-target lazily — Frame's main window is created in
  // src/main/index.js but module load order means we don't have a reference
  // here. There is only ever one window, so getAllWindows()[0] is safe.
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

function emit(kind, data) {
  send(SUP.SUPERVISOR_STATE, { kind, data });
}

function readHeartbeat(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function flushAuditPending() {
  auditFlushTimer = null;
  if (!auditPending.length) return;
  const batch = auditPending;
  auditPending = [];
  emit('audit', { events: batch });
}

function scheduleAuditFlush() {
  if (auditFlushTimer) return;
  auditFlushTimer = setTimeout(flushAuditPending, AUDIT_THROTTLE_MS);
}

function processAuditDelta(filePath) {
  let stat;
  try { stat = fs.statSync(filePath); } catch { return; }
  // File rotated/truncated — reset and start reading from 0.
  if (stat.size < auditOffset) {
    auditOffset = 0;
    auditBuffer = '';
  }
  if (stat.size === auditOffset) return;

  const stream = fs.createReadStream(filePath, {
    start: auditOffset,
    end: stat.size - 1,
    encoding: 'utf8',
  });
  stream.on('data', (chunk) => {
    auditBuffer += chunk;
    let nl;
    while ((nl = auditBuffer.indexOf('\n')) !== -1) {
      const line = auditBuffer.slice(0, nl);
      auditBuffer = auditBuffer.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        auditPending.push(JSON.parse(line));
      } catch {
        // Partial / malformed line — skip. The next chunk usually completes
        // the partial JSON, but we've already committed to a line split here.
      }
    }
  });
  stream.on('end', () => {
    auditOffset = stat.size;
    if (auditPending.length) scheduleAuditFlush();
  });
  stream.on('error', () => {
    // Best-effort
  });
}

function watchHeartbeat(filePath) {
  if (!fs.existsSync(filePath)) return null;
  // Emit the current value immediately so the renderer doesn't have to wait
  // for the next daemon tick.
  const hb = readHeartbeat(filePath);
  if (hb) emit('heartbeat', hb);
  try {
    return fs.watch(filePath, { persistent: false }, () => {
      const next = readHeartbeat(filePath);
      if (next) emit('heartbeat', next);
    });
  } catch (e) {
    return null;
  }
}

function watchAudit(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    auditOffset = fs.statSync(filePath).size;
  } catch {
    auditOffset = 0;
  }
  auditBuffer = '';
  try {
    return fs.watch(filePath, { persistent: false }, () => {
      processAuditDelta(filePath);
    });
  } catch (e) {
    return null;
  }
}

function watchQueueDir(dir, status) {
  if (!fs.existsSync(dir)) return null;
  try {
    return fs.watch(dir, { persistent: false }, (eventType, name) => {
      // Best-effort directory signal — the renderer's existing kanban refresh
      // pulls /api/workspace, which is authoritative. We just nudge it.
      emit('queue', { status, eventType, name: name || '' });
    });
  } catch (e) {
    return null;
  }
}

function stop() {
  if (heartbeatWatcher) { try { heartbeatWatcher.close(); } catch {} heartbeatWatcher = null; }
  if (auditWatcher) { try { auditWatcher.close(); } catch {} auditWatcher = null; }
  for (const qw of queueWatchers) { try { qw.watcher.close(); } catch {} }
  queueWatchers = [];
  if (auditFlushTimer) { clearTimeout(auditFlushTimer); auditFlushTimer = null; }
  auditPending = [];
  auditBuffer = '';
  auditOffset = 0;
  currentRoot = null;
  started = false;
}

/**
 * Start watching the supervisor's run-state. Idempotent; if called with the
 * same supervisorRoot it's a no-op. A different root triggers stop()+start().
 *
 * @param {object} opts
 * @param {string} opts.supervisorRoot — absolute path to the supervisor repo
 *   root (the parent of run-state/, the same value kanban derives from
 *   /api/meta.audit_path). Must be set; without it we have nothing to watch.
 */
function start(opts) {
  const root = opts && opts.supervisorRoot;
  if (!root) return;
  if (started && currentRoot === root) return;
  if (started) stop();

  const hbPath = path.join(root, 'run-state', 'heartbeat.json');
  const auditPath = path.join(root, 'run-state', 'audit.jsonl');

  heartbeatWatcher = watchHeartbeat(hbPath);
  auditWatcher = watchAudit(auditPath);

  for (const status of ['pending', 'done', 'failed']) {
    const dir = path.join(root, 'queue', status);
    const watcher = watchQueueDir(dir, status);
    if (watcher) queueWatchers.push({ dir, status, watcher });
  }

  currentRoot = root;
  started = true;
}

function registerHandlers(ipcMain) {
  ipcMain.handle(SUP.SUPERVISOR_STATE_INIT, async (_evt, payload) => {
    start(payload || {});
    return { ok: true, started, root: currentRoot };
  });
}

module.exports = { start, stop, registerHandlers };
