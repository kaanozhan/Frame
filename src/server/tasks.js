/**
 * Frame Server — a server project's tasks (server-tasks).
 *
 * A project on the server keeps its task state in the clone's
 * `.frame/tasks.json` (server-specs B1): the file `/spec.tasks` and Play's
 * agents write there, and the only writer. The desktop lists it next to the
 * Mac's tasks and sends each change for a server task here, through
 * `tasksManager` on the clone — the same code that owns the Mac's file.
 *
 *   tasks.list    { projectPath }                  → { tasks, tasksPath }
 *   tasks.add     { projectPath, task }            → { task }
 *   tasks.update  { projectPath, taskId, updates } → { task }
 *   tasks.delete  { projectPath, taskId }          → { success }
 *   tasks.reorder { projectPath, order }           → { success }
 *   tasks.insert  { projectPath, rows }            → { tasksPath }
 *   tasks.watch   { projectPath } / tasks.unwatch
 *   event: tasks.changed { projectPath }
 *
 * The watch mirrors `specs.watch`: the server watches the clone's `.frame`
 * folder (tasks.json is written atomically — tmp file, then rename — so the
 * file itself cannot be watched) and pushes a debounced `tasks.changed` when
 * tasks.json changes, whoever wrote it: an agent, `/spec.tasks`' sync, or a
 * change sent from the desktop. The desktop never polls. Watching follows the
 * desktop's project (a new watch replaces the old one) and stops on unwatch
 * and when the last desktop disconnects.
 *
 * Every call names a project in the server's registry. A project without
 * Frame (no `.frame/config.json`) lists no tasks and takes no change, so the
 * server never writes a `.frame` into it. A project in local sharing mode is
 * refused, as `specs.stage` refuses it: its `.frame` never reaches git, so
 * the clone holds no task file worth trusting.
 */

const fs = require('fs');
const path = require('path');

const CHANGE_DEBOUNCE_MS = 300;

const LOCAL_MODE = 'This project keeps Frame files out of git (local mode), so its tasks cannot live on the server — keep them in a local workspace.';
const NO_FRAME = 'This project has no Frame setup on the server, so it has no tasks there.';

function setup({ registerMethods, broadcast }) {
  const tasksManager = require('../main/tasksManager');
  const projectRegistry = require('../main/projectRegistry');
  const frameStore = require('../main/frameStore');
  const gitSharing = require('../main/gitSharing');
  const { FRAME_FILES } = require('../shared/frameConstants');
  const { isFrameProject } = require('./tooling');
  const fsSafe = require('../main/fsSafe');
  const watchers = new Map(); // projectPath → { watcher, timer }

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
    const dir = frameStore.metaDir(projectPath);
    const file = path.basename(frameStore.resolvePath(projectPath, FRAME_FILES.TASKS));
    try {
      const entry = { watcher: null, timer: null };
      entry.watcher = fsSafe.safeWatch(dir, {}, (event, name) => {
        // No name (some platforms) may be tasks.json too; a tmp file is not.
        if (name && String(name) !== file) return;
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          entry.timer = null;
          if (typeof broadcast === 'function') broadcast('tasks.changed', { projectPath });
        }, CHANGE_DEBOUNCE_MS);
      }, () => { watchers.delete(projectPath); });
      watchers.set(projectPath, entry);
    } catch (err) {
      console.warn(`[frame-server] could not watch tasks in ${projectPath}: ${err.message}`);
    }
  }

  /** The project a call names, once it is known to be a server project of Frame's, not in local mode. */
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

  function needTaskId(taskId) {
    if (typeof taskId !== 'string' || !taskId) throw new Error('Missing task id.');
    return taskId;
  }

  const tasksPathOf = (projectPath) => path.resolve(frameStore.resolvePath(projectPath, FRAME_FILES.TASKS));

  registerMethods({
    'tasks.list': async ({ projectPath } = {}) => {
      const dir = project(projectPath);
      if (!isFrameProject(dir)) return { tasks: [], tasksPath: null };
      const data = tasksManager.loadTasks(dir);
      return { tasks: (data && Array.isArray(data.tasks)) ? data.tasks : [], tasksPath: tasksPathOf(dir) };
    },
    'tasks.add': async ({ projectPath, task } = {}) => {
      const dir = needFrame(project(projectPath));
      if (!task || typeof task !== 'object') throw new Error('Missing task.');
      const added = tasksManager.addTask(dir, task);
      if (!added) throw new Error('The task could not be saved on the server.');
      return { task: added };
    },
    'tasks.update': async ({ projectPath, taskId, updates } = {}) => {
      const dir = needFrame(project(projectPath));
      const updated = tasksManager.updateTask(dir, needTaskId(taskId), updates && typeof updates === 'object' ? updates : {});
      if (!updated) throw new Error('No such task on the server, or it could not be saved.');
      return { task: updated };
    },
    'tasks.delete': async ({ projectPath, taskId } = {}) => {
      const dir = needFrame(project(projectPath));
      return { success: !!tasksManager.deleteTask(dir, needTaskId(taskId)) };
    },
    'tasks.reorder': async ({ projectPath, order } = {}) => {
      const dir = needFrame(project(projectPath));
      if (!Array.isArray(order)) throw new Error('Missing order.');
      return { success: !!tasksManager.reorderTasks(dir, order) };
    },
    // Start Work's task part, begun on this server (frame-cloud-start-on-server
    // D11): the rows go in whole — reserved id, acceptance criteria, notes —
    // in one load and save. Any id clash refuses the call and writes nothing.
    'tasks.insert': async ({ projectPath, rows } = {}) => {
      const dir = needFrame(project(projectPath));
      if (!Array.isArray(rows) || !rows.length || rows.some((r) => !r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id)) {
        throw new Error('Missing task rows.');
      }
      const data = tasksManager.loadTasks(dir);
      if (!data || !Array.isArray(data.tasks)) throw new Error('.frame/tasks.json could not be read on the server.');
      const taken = new Set(data.tasks.map((t) => t && t.id));
      const clash = rows.find((r, i) => taken.has(r.id) || rows.findIndex((o) => o.id === r.id) !== i);
      if (clash) throw new Error(`${clash.id} already exists in .frame/tasks.json on the server`);
      data.tasks.push(...rows);
      data.metadata = data.metadata || {};
      data.metadata.totalCreated = (data.metadata.totalCreated || 0) + rows.length;
      if (!tasksManager.saveTasks(dir, data)) throw new Error('.frame/tasks.json could not be written on the server.');
      return { tasksPath: tasksPathOf(dir) };
    },
    // Watch this project's tasks.json, and only this one: the desktop
    // follows one project at a time.
    'tasks.watch': async ({ projectPath } = {}) => {
      const dir = project(projectPath);
      for (const p of Array.from(watchers.keys())) if (p !== dir) unwatch(p);
      if (isFrameProject(dir)) watch(dir);
      return { watching: Array.from(watchers.keys()) };
    },
    'tasks.unwatch': async () => { unwatchAll(); return null; }
  });

  return {
    stop: unwatchAll,
    // No desktop is connected: nobody receives tasks.changed.
    idle: unwatchAll
  };
}

module.exports = { setup, LOCAL_MODE, NO_FRAME };
