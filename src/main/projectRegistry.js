/**
 * Project Registry Module
 * Manages the list of projects Frame knows about, in ~/.frame/workspaces.json.
 *
 * The file name and its on-disk keys (`activeWorkspace`, `workspaces.default`)
 * predate this module's name and are kept as-is so existing installs need no
 * migration. In code, "workspace" now means a branch + worktree (the workspaces
 * spec); this module is only the project registry.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const fsSafe = require('./fsSafe');
const { IPC } = require('../shared/ipcChannels');
const { FRAME_HOME_DIR, PROJECT_REGISTRY_FILE, FRAME_VERSION } = require('../shared/frameConstants');

let registryDir = null;
let registryPath = null;
let mainWindow = null;

/**
 * Initialize the project registry
 */
function init(app, window) {
  mainWindow = window;
  registryDir = path.join(os.homedir(), FRAME_HOME_DIR);
  registryPath = path.join(registryDir, PROJECT_REGISTRY_FILE);
  ensureRegistryFile();
}

/**
 * Ensure the registry directory and file exist
 */
function ensureRegistryFile() {
  if (!fs.existsSync(registryDir)) {
    fs.mkdirSync(registryDir, { recursive: true });
  }
  if (!fs.existsSync(registryPath)) {
    saveRegistry(createDefaultRegistry());
  }
}

/**
 * Create the default registry structure (on-disk shape unchanged)
 */
function createDefaultRegistry() {
  return {
    version: FRAME_VERSION,
    activeWorkspace: 'default',
    workspaces: {
      default: {
        name: 'Default Workspace',
        createdAt: new Date().toISOString(),
        projects: []
      }
    }
  };
}

/**
 * Load the registry from file.
 *
 * On corruption, readJsonWithRecovery has already moved the broken file
 * aside and restored `.bak` when one exists — so falling back to the empty
 * default here can no longer destroy a recoverable project list (the next
 * saveRegistry writes a fresh file, not over the user's data).
 */
function loadRegistry() {
  const { data, source, error } = fsSafe.readJsonWithRecovery(registryPath);
  if (data) {
    if (source === 'bak') {
      console.error('projectRegistry: workspaces.json was corrupt — restored from .bak');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.STATE_FILE_RECOVERED, { file: 'workspaces.json' });
      }
    }
    return data;
  }
  if (error) {
    console.error(
      'projectRegistry: workspaces.json corrupt with no usable .bak — starting fresh (corrupt copy preserved):',
      error.message
    );
  }
  return createDefaultRegistry();
}

/**
 * Save the registry to file
 */
function saveRegistry(data) {
  try {
    fsSafe.writeFileAtomic(registryPath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error saving project registry:', err);
  }
}

/**
 * Get the registered projects
 */
function getProjects() {
  const registry = loadRegistry();
  const active = registry.activeWorkspace;
  return registry.workspaces[active]?.projects || [];
}

/**
 * Add a project to the registry
 */
function addProject(projectPath, name, isFrameProject = false) {
  const registry = loadRegistry();
  const active = registry.activeWorkspace;

  // Check if already exists
  const exists = registry.workspaces[active].projects.some(
    p => p.path === projectPath
  );
  if (exists) return false;

  // Workspace records kept when the project was removed come back with it
  // (workspace-hardening L6, decision B3).
  const detached = registry.detachedWorkspaceRecords && registry.detachedWorkspaceRecords[projectPath];
  registry.workspaces[active].projects.push({
    path: projectPath,
    name: name || path.basename(projectPath),
    isFrameProject: isFrameProject,
    addedAt: new Date().toISOString(),
    lastOpenedAt: null,
    ...(Array.isArray(detached) && detached.length ? { workspaces: detached } : {})
  });
  if (detached) delete registry.detachedWorkspaceRecords[projectPath];

  saveRegistry(registry);
  return true;
}

/**
 * Remove a project from the registry
 */
function removeProject(projectPath) {
  const registry = loadRegistry();
  const active = registry.activeWorkspace;

  // Keep its workspace records under an additive key: the worktrees stay on
  // disk holding their branches, and re-adding the project restores them (L6).
  const removed = registry.workspaces[active].projects.find(p => p.path === projectPath);
  if (removed && Array.isArray(removed.workspaces) && removed.workspaces.length) {
    registry.detachedWorkspaceRecords = registry.detachedWorkspaceRecords || {};
    registry.detachedWorkspaceRecords[projectPath] = removed.workspaces;
  }
  registry.workspaces[active].projects =
    registry.workspaces[active].projects.filter(p => p.path !== projectPath);

  saveRegistry(registry);
}

/**
 * Reorder the registered projects to match the given list of paths.
 * Paths not present in `orderedPaths` keep their relative order at the end, so a
 * stale/partial order never drops projects.
 */
function reorderProjects(orderedPaths) {
  if (!Array.isArray(orderedPaths)) return;
  const registry = loadRegistry();
  const active = registry.activeWorkspace;
  const projects = registry.workspaces[active].projects;

  const rank = new Map(orderedPaths.map((p, i) => [p, i]));
  const next = orderedPaths.length;
  registry.workspaces[active].projects = [...projects].sort((a, b) => {
    const ra = rank.has(a.path) ? rank.get(a.path) : next;
    const rb = rank.has(b.path) ? rank.get(b.path) : next;
    return ra - rb;
  });

  saveRegistry(registry);
}

/**
 * Update project's last opened timestamp
 */
function updateProjectLastOpened(projectPath) {
  const registry = loadRegistry();
  const active = registry.activeWorkspace;

  const project = registry.workspaces[active].projects.find(
    p => p.path === projectPath
  );
  if (project) {
    project.lastOpenedAt = new Date().toISOString();
    saveRegistry(registry);
  }
}

/**
 * Update project's Frame status
 */
function updateProjectFrameStatus(projectPath, isFrame) {
  const registry = loadRegistry();
  const active = registry.activeWorkspace;

  const project = registry.workspaces[active].projects.find(
    p => p.path === projectPath
  );
  if (project) {
    project.isFrameProject = isFrame;
    saveRegistry(registry);
  }
}

/**
 * A project's workspace records (workspaces spec). Stored on the project's
 * own registry record (`projects[i].workspaces`): worktree paths are
 * machine-local, and so is this file. Unknown project → [].
 */
function getWorkspaceRecords(projectPath) {
  const project = getProjects().find(p => p.path === projectPath);
  return project && Array.isArray(project.workspaces) ? project.workspaces : [];
}

/** Replace a project's workspace records. Returns false when the project is not registered. */
function setWorkspaceRecords(projectPath, records) {
  const registry = loadRegistry();
  const active = registry.activeWorkspace;
  const project = registry.workspaces[active]?.projects.find(p => p.path === projectPath);
  if (!project) return false;
  project.workspaces = Array.isArray(records) ? records : [];
  saveRegistry(registry);
  return true;
}

/**
 * Setup IPC handlers
 */
function setupIPC(ipcMain) {
  ipcMain.on(IPC.LOAD_PROJECT_REGISTRY, (event) => {
    const projects = getProjects();
    event.sender.send(IPC.PROJECT_REGISTRY_DATA, projects);
  });

  ipcMain.on(IPC.ADD_PROJECT_TO_REGISTRY, (event, { projectPath, name }) => {
    // The Frame status is read from disk here, not taken from the renderer:
    // the renderer adds the project the moment its path changes, before its
    // own status check has answered, so what it would send is the previous
    // project's status. Lazily required: frameProject requires this module.
    const isFrame = require('./frameProject').isFrameProject(projectPath);
    addProject(projectPath, name, isFrame);
    const projects = getProjects();
    event.sender.send(IPC.PROJECT_REGISTRY_UPDATED, projects);
  });

  ipcMain.on(IPC.REMOVE_PROJECT_FROM_REGISTRY, (event, projectPath) => {
    // A project that leaves the registry stops being maintained (STR-02).
    // Lazily required: the registry loads before the structure modules.
    try {
      require('./structureLifecycle').detach(projectPath);
    } catch (err) {
      console.warn('[frame] could not stop the structure lifecycle worker:', err.message);
    }
    removeProject(projectPath);
    const projects = getProjects();
    event.sender.send(IPC.PROJECT_REGISTRY_UPDATED, projects);
  });

  ipcMain.on(IPC.REORDER_REGISTRY_PROJECTS, (event, orderedPaths) => {
    reorderProjects(orderedPaths);
    // No PROJECT_REGISTRY_UPDATED echo: the renderer already applied the new
    // order optimistically, and re-rendering mid-drag would fight the user.
  });
}

module.exports = {
  init,
  loadRegistry,
  getProjects,
  addProject,
  removeProject,
  reorderProjects,
  updateProjectLastOpened,
  updateProjectFrameStatus,
  getWorkspaceRecords,
  setWorkspaceRecords,
  setupIPC
};
