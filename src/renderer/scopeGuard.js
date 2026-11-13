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

/**
 * A follow-up that runs after an await (setup script, create, conflict
 * choice) belongs to the project and workspace it started in (R3, R6).
 * `current()` returns `{ projectPath, workspaceId }` of the live selection.
 */
function scopeGuard(scope, current) {
  const now = () => current() || {};
  return {
    projectPath: scope.projectPath,
    workspaceId: scope.workspaceId,
    /** Still on the same project and workspace? */
    still: () => now().projectPath === scope.projectPath && now().workspaceId === scope.workspaceId,
    /** Still on the same project (the workspace may differ)? */
    sameProject: () => now().projectPath === scope.projectPath
  };
}

/**
 * How a selection differs from the next one (R11): `same`, `meta` (same
 * workspace, its branch or name changed — update in place) or `switch`.
 */
function selectionChange(prev, next) {
  if (!prev && !next) return 'same';
  if (!prev || !next) return 'switch';
  if (prev.id !== next.id || prev.root !== next.root) return 'switch';
  if ((prev.branch || null) !== (next.branch || null) || (prev.name || null) !== (next.name || null)) return 'meta';
  return 'same';
}

module.exports = { exclusive, scopeGuard, selectionChange };
