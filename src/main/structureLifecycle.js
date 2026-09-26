/**
 * Structure lifecycle supervisor (STR-02).
 *
 * Keeps one `structure-lifecycle.js --supervised` child per attached Frame
 * checkout, so each project's STRUCTURE.json follows its working tree while
 * the app is open. The children do the scanning; this module only starts,
 * drives and stops them, and never blocks the main process.
 *
 *   attach(projectPath)            start (or reuse) the checkout's worker
 *   requestReconcile(path, reason) ask it for a full check (re-attaching a
 *                                  worker that exited)
 *   detach(projectPath)            stop it (workspace removal, Remove Frame)
 *   disposeAll()                   stop every worker (app shutdown)
 *
 * Disabled until `configure({ enabled: true })` — the app does that at
 * startup. Workers are keyed by real path, so two routes to one checkout share one
 * child. Periodic reconciliation ticks go to every worker through one
 * pollGate interval: hidden windows pause them (freshness then expires
 * honestly) and showing a window ticks immediately. File-change handling
 * inside the children keeps running regardless — agents edit while the
 * window is hidden too.
 *
 * Children run on the app's own runtime (`process.execPath` with
 * ELECTRON_RUN_AS_NODE), so no system `node` is required. A child that
 * finds another live coordinator (a foreground `--watch`) exits with
 * `busy`; that checkout is then simply not ours to drive.
 */

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { FRAME_DIR, FRAME_BIN_DIR } = require('../shared/frameConstants');

const PERIODIC_MS = 60000;
const STOP_GRACE_MS = 3000;

const settings = {
  // Off until the app turns it on (index.js): library users and tests that
  // initialize projects must not spawn long-lived children by accident.
  enabled: false,
  spawn: childProcess.spawn,
  execPath: process.execPath,
  ticker: null, // (fn, ms) → { dispose() } — defaults to pollGate.gatedInterval
  periodicMs: PERIODIC_MS,
  onReport: null
};

const workers = new Map(); // real path → record
let ticks = null;

/** Tests and app wiring override the defaults here. */
function configure(overrides = {}) {
  Object.assign(settings, overrides);
}

function realPath(projectPath) {
  try {
    return fs.realpathSync(projectPath);
  } catch (e) {
    return path.resolve(projectPath);
  }
}

function workerScript(projectPath) {
  return path.join(projectPath, FRAME_DIR, FRAME_BIN_DIR, 'structure-lifecycle.js');
}

function report(record, value) {
  if (typeof settings.onReport !== 'function') return;
  try {
    settings.onReport({ projectPath: record.projectPath, ...value });
  } catch (e) {
    /* reporting never affects the worker */
  }
}

function send(record, message) {
  if (!record.child || record.closed || !record.child.stdin || record.child.stdin.destroyed) return false;
  try {
    record.child.stdin.write(`${JSON.stringify(message)}\n`);
    return true;
  } catch (e) {
    return false;
  }
}

function defaultTicker(fn, ms) {
  try {
    return require('./pollGate').gatedInterval(fn, ms);
  } catch (e) {
    // No Electron window layer (tests, early boot): an unref'd interval.
    const timer = setInterval(fn, ms);
    if (typeof timer.unref === 'function') timer.unref();
    return { dispose: () => clearInterval(timer) };
  }
}

function ensureTicks() {
  if (ticks || workers.size === 0) return;
  const ticker = settings.ticker || defaultTicker;
  ticks = ticker(() => {
    for (const record of workers.values()) send(record, { cmd: 'tick' });
  }, settings.periodicMs);
}

function stopTicksIfIdle() {
  if (ticks && workers.size === 0) {
    ticks.dispose();
    ticks = null;
  }
}

/**
 * Start the checkout's worker, or return the running one. Returns null when
 * the project has no staged worker script (tooling unavailable) or the
 * process cannot be started.
 */
function attach(projectPath) {
  if (!settings.enabled) return null;
  const key = realPath(projectPath);
  const existing = workers.get(key);
  if (existing && !existing.closed) return existing;

  const script = workerScript(key);
  if (!fs.existsSync(script)) return null;

  let child;
  try {
    child = settings.spawn(settings.execPath, [script, '--supervised'], {
      cwd: key,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', FRAME_PROJECT_ROOT: key },
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (e) {
    return null;
  }

  const record = { projectPath: key, child, closed: false, stopping: false, busy: false, exited: null };
  record.exited = new Promise((resolve) => {
    let buffer = '';
    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          let value;
          try {
            value = JSON.parse(line);
          } catch (e) {
            continue;
          }
          if (value.type === 'busy') record.busy = true;
          report(record, value);
        }
      });
    }
    if (child.stderr) child.stderr.resume(); // drain; diagnostics are not ours to show
    if (child.stdin) child.stdin.on('error', () => { /* child gone: EPIPE */ });
    const settle = (code, signal) => {
      if (record.closed) return;
      record.closed = true;
      clearTimeout(record.killTimer);
      if (workers.get(key) === record) workers.delete(key);
      stopTicksIfIdle();
      report(record, { type: 'exited', code, signal, expected: record.stopping, foreignOwner: record.busy });
      resolve();
    };
    child.on('error', () => settle(null, null));
    child.on('close', settle);
  });

  workers.set(key, record);
  ensureTicks();
  return record;
}

/** Ask for a full reconciliation; a worker that exited is started again. */
function requestReconcile(projectPath, reason = 'reopen') {
  const record = workers.get(realPath(projectPath));
  if (record && !record.closed) return send(record, { cmd: 'reconcile', reason });
  return Boolean(attach(projectPath)); // a fresh worker reconciles on attach
}

/** Stop the checkout's worker. Resolves once it has exited. */
function detach(projectPath) {
  const record = workers.get(realPath(projectPath));
  if (!record) return Promise.resolve(false);
  if (!record.stopping) {
    record.stopping = true;
    send(record, { cmd: 'stop' });
    try { record.child.stdin.end(); } catch (e) { /* ignore */ }
    record.killTimer = setTimeout(() => {
      try { record.child.kill('SIGKILL'); } catch (e) { /* ignore */ }
    }, STOP_GRACE_MS);
    if (typeof record.killTimer.unref === 'function') record.killTimer.unref();
  }
  return record.exited.then(() => true);
}

/** Stop every worker (app shutdown). */
function disposeAll() {
  const pending = [...workers.keys()].map((key) => detach(key));
  if (ticks) {
    ticks.dispose();
    ticks = null;
  }
  return Promise.all(pending);
}

function list() {
  return [...workers.keys()];
}

module.exports = { configure, attach, detach, requestReconcile, disposeAll, list, PERIODIC_MS };
