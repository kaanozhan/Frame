/**
 * scopeGuard — keep dialogs and follow-ups on the request that started them
 * (workspace-hardening R2, R7; T08 adds the scope helpers).
 *
 * Pure: no DOM, no IPC.
 */

/**
 * Wrap an async dialog flow so only one request runs at a time.
 *   - default: a call while one runs is refused — `onBusy()` is called (the
 *     dialog refocuses itself) and the call resolves null. Used for Create PR,
 *     whose second open would otherwise rebind the dialog to another workspace.
 *   - `queue: true`: calls take turns, each resolves with its own answer. Used
 *     for the conflict dialog, which two concurrent updates can both need.
 */
function exclusive(fn, { onBusy = null, queue = false } = {}) {
  let running = false;
  let tail = Promise.resolve();
  if (queue) {
    return (...args) => {
      const turn = tail.then(() => fn(...args));
      tail = turn.catch(() => {});
      return turn;
    };
  }
  return async (...args) => {
    if (running) {
      if (typeof onBusy === 'function') onBusy(...args);
      return null;
    }
    running = true;
    try {
      return await fn(...args);
    } finally {
      running = false;
    }
  };
}

module.exports = { exclusive };
