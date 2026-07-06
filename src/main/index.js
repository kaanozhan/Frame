/**
 * Main Process Entry Point
 * Initializes Electron app, creates window, loads modules
 */

const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const { IPC } = require('../shared/ipcChannels');

// Import modules
const logger = require('./logger');
const crashGuard = require('./crashGuard');
const pty = require('./pty');
const ptyManager = require('./ptyManager');
const menu = require('./menu');
const dialogs = require('./dialogs');
const fileTree = require('./fileTree');
const promptLogger = require('./promptLogger');
const workspace = require('./workspace');
const frameProject = require('./frameProject');
const fileEditor = require('./fileEditor');
const tasksManager = require('./tasksManager');
const pluginsManager = require('./pluginsManager');
const githubManager = require('./githubManager');
const claudeUsageManager = require('./claudeUsageManager');
const overviewManager = require('./overviewManager');
const gitBranchesManager = require('./gitBranchesManager');
const aiToolManager = require('./aiToolManager');
const claudeSessionsManager = require('./claudeSessionsManager');
const updateChecker = require('./updateChecker');
const userSettings = require('./userSettings');
const gitStatusManager = require('./gitStatusManager');
const gitDiffManager = require('./gitDiffManager');
const telemetry = require('./telemetry');
const specManager = require('./specManager');
const orchestrationManager = require('./orchestrationManager');

let mainWindow = null;
let quitConfirmed = false;

/**
 * Quitting (or closing the window) tears down every PTY — killing running
 * agents with no warning. Prompt when lanes are still alive; return true to
 * proceed.
 */
function confirmQuitWithLiveAgents() {
  const count = ptyManager.getTerminalCount();
  if (count === 0) return true;
  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'warning',
    title: 'Frame',
    message: count === 1 ? 'A lane is still running.' : `${count} lanes are still running.`,
    detail: 'Quitting will kill the agents and terminals running in them. Quit anyway?',
    buttons: ['Quit', 'Cancel'],
    defaultId: 1,
    cancelId: 1
  });
  return choice === 0;
}

/**
 * Create main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    backgroundColor: '#1e1e1e',
    title: 'Frame'
  });

  mainWindow.loadFile('index.html');

  // Open DevTools only in development mode
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Guard Cmd-W / the red button: closing the window destroys all PTYs.
  // `quitConfirmed` avoids a double prompt when the close came from a quit
  // that before-quit already confirmed.
  mainWindow.on('close', (e) => {
    if (quitConfirmed) return;
    if (!confirmQuitWithLiveAgents()) {
      e.preventDefault();
      return;
    }
    // On Win/Linux this close leads straight into window-all-closed → quit;
    // don't prompt a second time there. On macOS the app outlives the
    // window, so a later Cmd-Q must get its own prompt.
    if (process.platform !== 'darwin') quitConfirmed = true;
  });

  mainWindow.on('closed', () => {
    pty.killPTY();
    ptyManager.destroyAll();
    mainWindow = null;
  });

  // Initialize modules with window reference
  crashGuard.attachWindow(mainWindow);
  pty.init(mainWindow);
  ptyManager.init(mainWindow);
  aiToolManager.init(mainWindow, app);
  menu.init(mainWindow, app, aiToolManager);
  dialogs.init(mainWindow, (projectPath) => {
    pty.setProjectPath(projectPath);
    promptLogger.setProject(projectPath);
  });
  updateChecker.init(mainWindow);
  initModulesWithWindow(mainWindow);

  // Create application menu
  menu.createMenu();

  // Check for updates after window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    updateChecker.checkForUpdate();
    probeCoreDeps();
  });

  return mainWindow;
}

/**
 * One-time startup probe for the external CLIs Frame degrades without.
 * Missing tools surface as a health-notice banner (and a log line) instead
 * of panels that silently render empty — the per-manager ENOENT
 * short-circuits handle the ongoing behavior.
 */
let depsProbed = false;
function probeCoreDeps() {
  if (depsProbed) return;
  depsProbed = true;
  const { execFile } = require('child_process');
  const probes = [
    ['git', 'Changes, Branches and orchestration are unavailable.'],
    ['gh', 'The GitHub panel is unavailable.']
  ];
  for (const [bin, consequence] of probes) {
    execFile(bin, ['--version'], { timeout: 5000 }, (err) => {
      if (!err) return;
      logger.warn('deps', `${bin} not found on PATH:`, err.message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.MAIN_PROCESS_ERROR, {
          source: 'dependency',
          severity: 'warning',
          message: `${bin} was not found on this system — ${consequence}`
        });
      }
    });
  }
}

/**
 * Setup all IPC handlers
 */
function setupAllIPC() {
  // Setup module IPC handlers
  pty.setupIPC(ipcMain);
  ptyManager.setupIPC(ipcMain);
  dialogs.setupIPC(ipcMain);
  fileTree.setupIPC(ipcMain);
  promptLogger.setupIPC(ipcMain);
  workspace.setupIPC(ipcMain);
  frameProject.setupIPC(ipcMain);
  fileEditor.setupIPC(ipcMain);
  tasksManager.setupIPC(ipcMain);
  pluginsManager.setupIPC(ipcMain);
  githubManager.setupIPC(ipcMain);
  claudeUsageManager.setupIPC(ipcMain);
  overviewManager.setupIPC(ipcMain);
  gitBranchesManager.setupIPC(ipcMain);
  claudeSessionsManager.setupIPC(ipcMain);
  updateChecker.setupIPC();

  // User settings (renderer-side preferences persisted to userData JSON)
  ipcMain.handle(IPC.GET_USER_SETTING, (event, key) => userSettings.get(key));
  ipcMain.handle(IPC.SET_USER_SETTING, (event, key, value) => userSettings.set(key, value));

  // Git status (file tree decoration polling)
  gitStatusManager.setupIPC(ipcMain);

  // Git diff (Changes panel → Diff Viewer overlay)
  gitDiffManager.setupIPC(ipcMain);

  // Spec-Driven Development — .frame/specs/<slug>/ CRUD + watcher
  specManager.setupIPC(ipcMain);

  // Orchestration — conductor-led parallel spec execution
  orchestrationManager.setupIPC(ipcMain);

  // Telemetry — toggle from Settings
  ipcMain.handle(IPC.TELEMETRY_SET_ENABLED, (event, enabled) =>
    telemetry.setEnabled(enabled)
  );

  // Diagnostics — Settings "Open Logs Folder"
  ipcMain.handle(IPC.GET_LOG_INFO, () => ({
    logPath: logger.getLogPath(),
    logsDir: app.getPath('logs'),
    crashDumpsDir: app.getPath('crashDumps')
  }));

  // Terminal input handler (needs prompt logger integration)
  ipcMain.on(IPC.TERMINAL_INPUT, (event, data) => {
    pty.writeToPTY(data);
    promptLogger.logInput(data);
  });

  // Reload reconcile: the renderer reports the terminal ids it actually has
  // instances for (empty on a fresh boot/reload); every other PTY is an
  // orphan from a previous renderer and gets killed instead of running
  // invisibly. The legacy single-PTY module is recreated on demand, so it's
  // simply killed.
  ipcMain.handle(IPC.RECONCILE_TERMINALS, (event, knownIds) => {
    const destroyed = ptyManager.destroyExcept(Array.isArray(knownIds) ? knownIds : []);
    pty.killPTY();
    if (destroyed.length > 0) {
      logger.warn('ptyManager', `reload reconcile: destroyed ${destroyed.length} orphaned PTY(s):`, destroyed.join(', '));
    }
    return { destroyed };
  });
}

/**
 * Initialize application
 */
function init() {
  // Initialize logging first so everything after has somewhere to write.
  logger.init();

  // Initialize prompt logger with app paths
  promptLogger.init(app);

  // Initialize user settings (must run after app is ready so userData path resolves)
  userSettings.init();

  // Global crash handlers + local-only crash dumps. After userSettings
  // (reads the crashDumpsEnabled toggle), before everything else so no
  // later init runs unguarded.
  crashGuard.init();

  // Send the launch event after userSettings is loaded so the opt-out
  // check uses the correct state. Aptabase itself was initialized earlier
  // (before app.whenReady) — see app lifecycle below.
  telemetry.trackAppStarted();

  // Setup IPC handlers
  setupAllIPC();
}

/**
 * Initialize modules that need window reference
 */
function initModulesWithWindow(window) {
  workspace.init(app, window);
  frameProject.init(window);
  fileEditor.init(window);
  tasksManager.init(window);
  pluginsManager.init(window);
  githubManager.init(window);
  claudeUsageManager.init(window);
  overviewManager.init(window);
  gitBranchesManager.init(window);
  claudeSessionsManager.init(window);
  gitStatusManager.init(window);
  specManager.init(window);
  orchestrationManager.init(window);
}

// Aptabase MUST be initialized before app.whenReady() because the SDK
// internally calls protocol.registerSchemesAsPrivileged, which is only
// allowed pre-ready. Initialization itself doesn't send anything; the
// actual app_started event is fired from init() after userSettings loads.
telemetry.init();

// App lifecycle
app.whenReady().then(() => {
  // macOS'ta menü bar'da "Frame" görünsün
  app.setName('Frame');

  init();
  createWindow();
});

// Confirm-on-quit: Cmd-Q / app menu / OS shutdown with live agents.
app.on('before-quit', (e) => {
  if (quitConfirmed) return;
  if (!confirmQuitWithLiveAgents()) {
    e.preventDefault();
    return;
  }
  quitConfirmed = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

module.exports = { createWindow };
