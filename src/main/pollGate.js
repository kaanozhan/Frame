/**
 * pollGate — visibility-gated intervals + TTL caching for polling loops.
 *
 * Every recurring poll in the main process (usage, update check,
 * orchestration status, per-PTY foreground process) runs through
 * gatedInterval so a hidden/minimized app spends zero timer wakeups on
 * them. Semantics: while any window is visible, identical to a plain
 * setInterval; when the last window hides, the interval pauses; when a
 * window shows again, the callback fires once immediately (so the user
 * never sees staler data than before) and the cadence resumes.
 *
 * Small-utility pattern, in the spirit of fsSafe.js.
 */

const { app, BrowserWindow } = require('electron');

const gates = new Set();
let wired = false;

function anyWindowVisible() {
  return BrowserWindow.getAllWindows().some(
    (w) => !w.isDestroyed() && w.isVisible() && !w.isMinimized()
  );
}

function reevaluateAll() {
  // Defer one tick: visibility state settles after the event fires.
  setImmediate(() => {
    for (const gate of gates) gate._reevaluate(false);
  });
}

function watchWindow(win) {
  win.on('show', reevaluateAll);
  win.on('restore', reevaluateAll);
  win.on('hide', reevaluateAll);
  win.on('minimize', reevaluateAll);
  win.on('closed', reevaluateAll);
}

function ensureWiring() {
  if (wired) return;
  wired = true;
  app.on('browser-window-created', (_event, win) => watchWindow(win));
  for (const win of BrowserWindow.getAllWindows()) watchWindow(win);
}

/**
 * Visibility-gated setInterval. Returns a handle with dispose().
 * On creation while visible the first run happens after `ms` (plain
 * setInterval semantics); the immediate run only happens on hidden→visible
 * transitions. Pass { refreshOnShow: false } for slow cadences (e.g. the
 * 6h update recheck) where a run per show-transition would over-poll —
 * those just pause and resume.
 */
function gatedInterval(fn, ms, { refreshOnShow = true } = {}) {
  ensureWiring();
  let timer = null;
  let disposed = false;

  const safeRun = () => {
    try {
      fn();
    } catch (err) {
      console.error('pollGate: tick failed:', err);
    }
  };

  const gate = {
    _reevaluate(isCreation) {
      if (disposed) return;
      const visible = anyWindowVisible();
      if (visible && !timer) {
        if (!isCreation && refreshOnShow) safeRun();
        timer = setInterval(safeRun, ms);
        if (typeof timer.unref === 'function') timer.unref();
      } else if (!visible && timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    dispose() {
      disposed = true;
      if (timer) clearInterval(timer);
      timer = null;
      gates.delete(gate);
    }
  };

  gates.add(gate);
  gate._reevaluate(true);
  return gate;
}

/**
 * Memoize an async fn's result for ttlMs. Concurrent callers share the
 * in-flight promise; errors are not cached.
 */
function ttlCache(fn, ttlMs) {
  let value;
  let cachedAt = 0;
  let pending = null;
  return function cached(...args) {
    if (pending) return pending;
    if (value !== undefined && Date.now() - cachedAt < ttlMs) {
      return Promise.resolve(value);
    }
    pending = Promise.resolve(fn(...args))
      .then((v) => {
        value = v;
        cachedAt = Date.now();
        pending = null;
        return v;
      })
      .catch((err) => {
        pending = null;
        throw err;
      });
    return pending;
  };
}

module.exports = { gatedInterval, ttlCache, anyWindowVisible };
