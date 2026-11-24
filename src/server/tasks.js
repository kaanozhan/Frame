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
 *
 * Every call names a project in the server's registry. A project without
 * Frame (no `.frame/config.json`) lists no tasks and takes no change, so the
 * server never writes a `.frame` into it. A project in local sharing mode is
 * refused, as `specs.stage` refuses it: its `.frame` never reaches git, so
 * the clone holds no task file worth trusting.
 */

const path = require('path');

const LOCAL_MODE = 'This project keeps Frame files out of git (local mode), so its tasks cannot live on the server — keep them in a local workspace.';
const NO_FRAME = 'This project has no Frame setup on the server, so it has no tasks there.';

function setup({ registerMethods }) {
  const tasksManager = require('../main/tasksManager');
  const projectRegistry = require('../main/projectRegistry');
  const frameStore = require('../main/frameStore');
  const gitSharing = require('../main/gitSharing');
  const { FRAME_FILES } = require('../shared/frameConstants');
  const { isFrameProject } = require('./tooling');

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
    }
  });

  return { stop() {} };
}

module.exports = { setup, LOCAL_MODE, NO_FRAME };
