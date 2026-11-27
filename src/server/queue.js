/**
 * Frame Server — a server project's work queue (work-queue spec, T04).
 *
 * Each machine keeps its own queue (plan D5): a server project's queue lives
 * in the clone's `.frame/queue.json`, machine-local (D9), and this server is
 * its only writer. The desktop shows it next to the Mac's queue and sends
 * every change for a server item here; the server Chief's queue tools (T10)
 * write the same file through queueStore, so the queue keeps moving while
 * the Mac is away.
 *
 *   queue.list     { projectPath }                          → { queue }
 *   queue.add      { projectPath, source }                  → { item }
 *   queue.remove   { projectPath, itemId }                  → { ok }
 *   queue.reorder  { projectPath, ids }                     → { ok }
 *   queue.set      { projectPath, itemId, action, mode? }   → { item }
 *   queue.parallel { projectPath, parallel }                → { parallel }
 *   queue.confirm  { projectPath, confirm: 'ask'|'decide' } → { confirm }
 *   queue.watch    { projectPath } / queue.unwatch
 *   event: queue.changed { projectPath }
 *
 * The limits mirror `tasks.*` (server-tasks): registered projects only,
 * refused in local sharing mode, and a project without Frame lists an empty
 * queue and takes no change, so no `.frame` is ever written into it. The
 * watch is on `.frame/runtime/` (the file is written atomically), debounced.
 */

const path = require('path');
const crypto = require('crypto');

const CHANGE_DEBOUNCE_MS = 300;

const LOCAL_MODE = 'This project keeps Frame files out of git (local mode), so it has no queue on the server.';
const NO_FRAME = 'This project has no Frame setup on the server, so it has no queue there.';

function setup({ registerMethods, broadcast }) {
  const projectRegistry = require('../main/projectRegistry');
  const frameStore = require('../main/frameStore');
  const gitSharing = require('../main/gitSharing');
  const fsSafe = require('../main/fsSafe');
  const store = require('../main/queueStore');
  const rules = require('../shared/queueRules');
  const { isFrameProject } = require('./tooling');
  const watchers = new Map(); // projectPath → { watcher, timer }

  // The live queue worktrees of a clone (work-queue D16): specManager lists
  // their spec copies in place of main's, and specs.* accepts them as roots.
  try { require('../main/specManager').setQueueRootsProvider((checkout) => rules.worktreeRoots(store.load(checkout).items)); } catch (err) {
    console.warn(`[frame-server] queue worktrees not shared with specs: ${err.message}`);
  }

  function unwatch(projectPath) {
    const entry = watchers.get(projectPath);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    try { entry.watcher.close(); } catch (_) { /* already closed */ }
    watchers.delete(projectPath);
  }

  function unwatchAll() {
    for (const p of Array.from(watchers.keys())) unwatch(p);
  }

  function watch(projectPath) {
    if (watchers.has(projectPath)) return;
    const dir = path.dirname(store.queuePath(projectPath));
    const file = path.basename(store.queuePath(projectPath));
    try { require('fs').mkdirSync(dir, { recursive: true }); } catch (_) { /* the watch reports it */ }
    try {
      const entry = { watcher: null, timer: null };
      entry.watcher = fsSafe.safeWatch(dir, {}, (event, name) => {
        if (name && String(name) !== file) return;
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          entry.timer = null;
          if (typeof broadcast === 'function') broadcast('queue.changed', { projectPath });
        }, CHANGE_DEBOUNCE_MS);
      }, () => { watchers.delete(projectPath); });
      watchers.set(projectPath, entry);
    } catch (err) {
      console.warn(`[frame-server] could not watch the queue in ${projectPath}: ${err.message}`);
    }
  }

  function project(projectPath) {
    if (typeof projectPath !== 'string' || !projectPath || !projectRegistry.getProjects().some((p) => p.path === projectPath)) {
      throw new Error('This project is not on the server yet.');
    }
    let mode = 'repo';
    try { mode = gitSharing.getMode(projectPath); } catch (_) { mode = 'repo'; }
    if (mode === 'local') throw new Error(LOCAL_MODE);
    return projectPath;
  }

  function needFrame(projectPath) {
    if (!isFrameProject(projectPath)) throw new Error(NO_FRAME);
    return projectPath;
  }

  /** A rule's result, or the refusal as an error the desktop shows. */
  function apply(dir, fn) {
    const res = store.update(dir, fn);
    if (res.refused) {
      const err = new Error(rules.REFUSAL_TEXT[res.refused] || 'That did not work.');
      err.reason = res.refused;
      throw err;
    }
    return res;
  }

  const now = () => new Date().toISOString();

  registerMethods({
    'queue.list': async ({ projectPath } = {}) => {
      const dir = project(projectPath);
      if (!isFrameProject(dir)) return { queue: rules.emptyQueue() };
      return { queue: store.load(dir) };
    },
    'queue.add': async ({ projectPath, source } = {}) => {
      const dir = needFrame(project(projectPath));
      const res = apply(dir, (q) => rules.add(q, source, { id: `q_${crypto.randomBytes(4).toString('hex')}`, now: now() }));
      return { item: res.item };
    },
    'queue.remove': async ({ projectPath, itemId } = {}) => {
      const dir = needFrame(project(projectPath));
      apply(dir, (q) => rules.remove(q, itemId));
      return { ok: true };
    },
    'queue.reorder': async ({ projectPath, ids } = {}) => {
      const dir = needFrame(project(projectPath));
      if (!Array.isArray(ids)) throw new Error('Missing order.');
      apply(dir, (q) => rules.reorder(q, ids));
      return { ok: true };
    },
    'queue.set': async ({ projectPath, itemId, action, mode = null } = {}) => {
      const dir = needFrame(project(projectPath));
      const at = now();
      let fn;
      if (action === 'done') fn = (q) => rules.setState(q, itemId, rules.STATES.DONE, {}, { now: at });
      else if (action === 'continue' || action === 'reset') fn = (q) => rules.setState(q, itemId, rules.STATES.QUEUED, {}, { now: at });
      else if (action === 'flowMode') fn = (q) => rules.setFlowMode(q, itemId, mode);
      else throw new Error('Unknown action.');
      return { item: apply(dir, fn).item };
    },
    'queue.confirm': async ({ projectPath, confirm } = {}) => {
      const dir = needFrame(project(projectPath));
      return { confirm: apply(dir, (q) => rules.setConfirm(q, confirm)).queue.confirm };
    },
    'queue.parallel': async ({ projectPath, parallel } = {}) => {
      const dir = needFrame(project(projectPath));
      return { parallel: apply(dir, (q) => rules.setParallel(q, parallel)).queue.parallel };
    },
    // One project at a time, as tasks.watch: the desktop follows its project.
    'queue.watch': async ({ projectPath } = {}) => {
      const dir = project(projectPath);
      for (const p of Array.from(watchers.keys())) if (p !== dir) unwatch(p);
      if (isFrameProject(dir)) watch(dir);
      return { watching: Array.from(watchers.keys()) };
    },
    'queue.unwatch': async () => { unwatchAll(); return null; }
  });

  return { stop: unwatchAll, idle: unwatchAll };
}

module.exports = { setup, LOCAL_MODE, NO_FRAME };
