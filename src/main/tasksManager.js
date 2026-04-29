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
const path = require('path');
const { IPC } = require('../shared/ipcChannels');
const { FRAME_FILES } = require('../shared/frameConstants');

const VALID_STATUSES = ['pending', 'in_progress', 'completed'];
const SELF_WRITE_GUARD_MS = 250;

let mainWindow = null;
let currentProjectPath = null;

let watcher = null;
let watchedPath = null;
let lastSelfWriteAt = 0;
let watchDebounceTimer = null;

function init(window) {
  mainWindow = window;
}

function setProjectPath(projectPath) {
  currentProjectPath = projectPath;
}

function getTasksFilePath(projectPath) {
  return path.join(projectPath || currentProjectPath, FRAME_FILES.TASKS);
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

  let raw;
  try {
    if (!fs.existsSync(tasksPath)) return null;
    raw = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
  } catch (err) {
    console.error('Error loading tasks:', err);
    return null;
  }

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
    saveTasks(projectPath, raw);
  }

  return raw;
}

function saveTasks(projectPath, tasksData) {
  const tasksPath = getTasksFilePath(projectPath);
  try {
    tasksData.lastUpdated = new Date().toISOString();
    lastSelfWriteAt = Date.now();
    fs.writeFileSync(tasksPath, JSON.stringify(tasksData, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving tasks:', err);
    return false;
  }
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
 * Watch the active project's directory for tasks.json changes. External
 * edits (CLI / manual edit) trigger a re-read and a TASKS_DATA push to the
 * renderer so the UI stays in sync without requiring the panel to be reopened.
 *
 * We watch the directory (not the file) because tools that write atomically
 * via rename — Claude Code, vim, prettier — replace the inode that a
 * file-level fs.watch is bound to, silently killing the watcher. A directory
 * watcher survives renames and reports both `change` and `rename` events.
 *
 * `lastSelfWriteAt` suppresses the watcher event that fires from our own
 * saveTasks() call to avoid a feedback loop.
 */
function startWatching(projectPath) {
  if (watcher && watchedPath === projectPath) return;
  stopWatching();

  if (!projectPath || !fs.existsSync(projectPath)) return;

  try {
    watcher = fs.watch(projectPath, { persistent: false }, (eventType, filename) => {
      if (!filename || filename !== FRAME_FILES.TASKS) return;
      if (Date.now() - lastSelfWriteAt < SELF_WRITE_GUARD_MS) return;

      clearTimeout(watchDebounceTimer);
      watchDebounceTimer = setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const tasks = loadTasks(projectPath);
        mainWindow.webContents.send(IPC.TASKS_DATA, { projectPath, tasks });
      }, 50);
    });
    watchedPath = projectPath;
  } catch (err) {
    console.error('Error watching project dir:', err);
    watcher = null;
    watchedPath = null;
  }
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

function setupIPC(ipcMain) {
  ipcMain.on(IPC.LOAD_TASKS, (event, projectPath) => {
    const tasks = loadTasks(projectPath);
    event.sender.send(IPC.TASKS_DATA, { projectPath, tasks });
    startWatching(projectPath);
  });

  ipcMain.on(IPC.ADD_TASK, (event, { projectPath, task }) => {
    const newTask = addTask(projectPath, task);
    event.sender.send(IPC.TASK_UPDATED, {
      projectPath,
      action: 'add',
      task: newTask,
      success: !!newTask
    });
    const tasks = loadTasks(projectPath);
    event.sender.send(IPC.TASKS_DATA, { projectPath, tasks });
  });

  ipcMain.on(IPC.UPDATE_TASK, (event, { projectPath, taskId, updates }) => {
    const updatedTask = updateTask(projectPath, taskId, updates);
    event.sender.send(IPC.TASK_UPDATED, {
      projectPath,
      action: 'update',
      task: updatedTask,
      success: !!updatedTask
    });
    const tasks = loadTasks(projectPath);
    event.sender.send(IPC.TASKS_DATA, { projectPath, tasks });
  });

  ipcMain.on(IPC.DELETE_TASK, (event, { projectPath, taskId }) => {
    const success = deleteTask(projectPath, taskId);
    event.sender.send(IPC.TASK_UPDATED, {
      projectPath,
      action: 'delete',
      taskId,
      success
    });
    const tasks = loadTasks(projectPath);
    event.sender.send(IPC.TASKS_DATA, { projectPath, tasks });
  });
}

module.exports = {
  init,
  setProjectPath,
  loadTasks,
  saveTasks,
  addTask,
  updateTask,
  deleteTask,
  setupIPC,
  stopWatching
};
