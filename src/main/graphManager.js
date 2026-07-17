/**
 * Graph Manager
 *
 * Owns the code-graph build lifecycle: forks src/main/graphWorker.js as an
 * Electron utilityProcess (asar-aware require, off the main thread), relays
 * its progress to the renderer over the CODE_GRAPH_STATUS push channel, and
 * answers status/rebuild IPC from the Overview panel.
 *
 * Single-flight: a rebuild request while a build is running returns the
 * current build's status instead of starting a second worker.
 */

const fs = require('fs');
const path = require('path');
const { app, utilityProcess } = require('electron');
const { IPC } = require('../shared/ipcChannels');

let mainWindow = null;
let activeBuild = null; // { projectPath, worker, startedAt, lastProgress }

/**
 * Initialize graph manager
 */
function init(window) {
  mainWindow = window;
}

/**
 * Vendored wasm directory: extraResources ships resources/tree-sitter to
 * <resources>/tree-sitter in the packaged app; in dev it's the repo folder.
 * Resolved HERE (not in the worker) so graphWorker.js never requires
 * 'electron' and stays drivable as a plain Node child in tests.
 */
function getWasmDir() {
  if (app && app.isPackaged) {
    return path.join(process.resourcesPath, 'tree-sitter');
  }
  return path.join(__dirname, '..', '..', 'resources', 'tree-sitter');
}

/** Push a status payload to the renderer (no-op before the window exists). */
function pushStatus(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.CODE_GRAPH_STATUS, payload);
  }
}

/**
 * Start a graph build for a project. Returns the initial status payload.
 * Non-fatal by contract: any failure is reported through status/meta, never
 * thrown at the caller (frameProject init must not break).
 */
function startBuild(projectPath) {
  if (activeBuild) {
    // Single-flight: never two workers at once.
    return getStatus(activeBuild.projectPath);
  }

  const workerPath = path.join(__dirname, 'graphWorker.js');
  let worker;
  try {
    worker = utilityProcess.fork(workerPath, [projectPath, getWasmDir()], {
      serviceName: 'frame-graph-worker'
    });
  } catch (err) {
    console.warn('[frame] graph worker fork failed:', err.message);
    const payload = { projectPath, status: 'error', error: err.message };
    pushStatus(payload);
    return payload;
  }

  activeBuild = { projectPath, worker, startedAt: Date.now(), lastProgress: null };
  pushStatus({ projectPath, status: 'building', progress: null });

  worker.on('message', (msg) => {
    if (!msg || activeBuild === null) return;
    if (msg.type === 'progress') {
      activeBuild.lastProgress = { parsed: msg.parsed, total: msg.total };
      pushStatus({ projectPath, status: 'building', progress: activeBuild.lastProgress });
    } else if (msg.type === 'done') {
      pushStatus({ projectPath, status: msg.meta.status, meta: msg.meta });
    } else if (msg.type === 'error') {
      pushStatus({ projectPath, status: 'error', error: msg.message });
    }
  });

  worker.on('exit', (code) => {
    const wasActive = activeBuild && activeBuild.projectPath === projectPath;
    activeBuild = null;
    // A non-zero exit without a 'done'/'error' message (hard crash) still
    // gets reported — the worker writes meta.json best-effort on its way out.
    if (wasActive && code !== 0) {
      pushStatus({ projectPath, status: 'error', error: `graph worker exited with code ${code}` });
    }
  });

  return { projectPath, status: 'building' };
}

/**
 * Current status for a project: the running build if there is one, else
 * whatever .frame/graph/meta.json records, else 'not-built'.
 */
function getStatus(projectPath) {
  if (activeBuild && activeBuild.projectPath === projectPath) {
    return {
      projectPath,
      status: 'building',
      progress: activeBuild.lastProgress
    };
  }
  try {
    const meta = JSON.parse(
      fs.readFileSync(path.join(projectPath, '.frame', 'graph', 'meta.json'), 'utf-8')
    );
    return { projectPath, status: meta.status, meta };
  } catch (e) {
    return { projectPath, status: 'not-built' };
  }
}

/**
 * Setup IPC handlers
 */
function setupIPC(ipcMain) {
  ipcMain.handle(IPC.LOAD_CODE_GRAPH_STATUS, (event, projectPath) => getStatus(projectPath));
  ipcMain.handle(IPC.REBUILD_CODE_GRAPH, (event, projectPath) => startBuild(projectPath));
}

module.exports = {
  init,
  setupIPC,
  startBuild,
  getStatus
};
