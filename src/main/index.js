/**
 * Main Process Entry Point
 * Initializes Electron app, creates window, loads modules
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { IPC } = require('../shared/ipcChannels');

// Import modules
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
const telemetry = require('./telemetry');
const specManager = require('./specManager');

let mainWindow = null;

/**
 * Create main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
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

  mainWindow.on('closed', () => {
    pty.killPTY();
    ptyManager.destroyAll();
    mainWindow = null;
  });

  // Initialize modules with window reference
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
  });

  return mainWindow;
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

  // Spec-Driven Development — .frame/specs/<slug>/ CRUD + watcher
  specManager.setupIPC(ipcMain);

  // Telemetry — toggle from Settings
  ipcMain.handle(IPC.TELEMETRY_SET_ENABLED, (event, enabled) =>
    telemetry.setEnabled(enabled)
  );

  // Terminal input handler (needs prompt logger integration)
  ipcMain.on(IPC.TERMINAL_INPUT, (event, data) => {
    pty.writeToPTY(data);
    promptLogger.logInput(data);
  });
}

/**
 * Initialize application
 */
function init() {
  // Initialize prompt logger with app paths
  promptLogger.init(app);

  // Initialize user settings (must run after app is ready so userData path resolves)
  userSettings.init();

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
