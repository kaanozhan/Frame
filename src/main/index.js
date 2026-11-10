/**
 * Main Process Entry Point
 * Initializes Electron app, creates window, loads modules
 */

const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const { IPC } = require('../shared/ipcChannels');

// Import modules
const logger = require('./logger');
const envPath = require('./envPath');
const perfMonitor = require('./perfMonitor');
const activityLog = require('./activityLog');
const crashGuard = require('./crashGuard');
const pty = require('./pty');
const ptyManager = require('./ptyManager');
const sessionRestore = require('./sessionRestore');
const menu = require('./menu');
const dialogs = require('./dialogs');
const fileTree = require('./fileTree');
const promptLogger = require('./promptLogger');
const projectRegistry = require('./projectRegistry');
const frameProject = require('./frameProject');
const frameStore = require('./frameStore');
const gitSharing = require('./gitSharing');
const layoutMigration = require('./layoutMigration');
const fileEditor = require('./fileEditor');
const tasksManager = require('./tasksManager');
const pluginsManager = require('./pluginsManager');
const githubManager = require('./githubManager');
const claudeUsageManager = require('./claudeUsageManager');
const projectInsights = require('./projectInsights');
const gitBranchesManager = require('./gitBranchesManager');
const workspaceManager = require('./workspaceManager');
const workspaceGitState = require('./workspaceGitState');
const aiToolManager = require('./aiToolManager');
const claudeSessionsManager = require('./claudeSessionsManager');
const codexSessionsManager = require('./codexSessionsManager');
const updateChecker = require('./updateChecker');
const userSettings = require('./userSettings');
const uiZoom = require('./uiZoom');
const gitStatusManager = require('./gitStatusManager');
const gitDiffManager = require('./gitDiffManager');
const analytics = require('./analytics');
const specManager = require('./specManager');
const orchestrationManager = require('./orchestrationManager');
const structureLifecycle = require('./structureLifecycle');

// The running app keeps each open Frame checkout's STRUCTURE.json current
// (in projects that opt in — scripts/structure-switch.js).
structureLifecycle.configure({ enabled: true });

let mainWindow = null;
let quitConfirmed = false;
let analyticsFlushed = false;

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
      contextIsolation: false,
      // The stored interface scale, so the first paint is already at the
      // user's step (ui-zoom-steps spec); uiZoom re-applies it on load.
      zoomFactor: uiZoom.currentFactor()
    },
    backgroundColor: '#0c0b09',
    title: 'Frame',
    // Windows and Linux read the window icon; macOS takes its icon from the
    // bundle (assets/icon.icns) once packaged, and from app.dock below while
    // running unpackaged. Icons live in assets/ because build/ is gitignored —
    // an icon path under it is missing on any fresh clone.
    icon: path.join(__dirname, '../../assets/icon.png')
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

  // Reload teardown (destroy-and-recreate policy): a main-frame navigation —
  // menu Reload included — tears the renderer down, so destroy its PTYs (and
  // their processPoll intervals) immediately instead of leaving them
  // streaming until the fresh renderer's RECONCILE_TERMINALS sweep. On the
  // initial load this is a no-op (no PTYs exist yet).
  mainWindow.webContents.on('did-start-navigation', (event, _url, _isInPlace, legacyIsMainFrame) => {
    const isMainFrame = typeof event.isMainFrame === 'boolean' ? event.isMainFrame : legacyIsMainFrame;
    const isSameDocument = typeof event.isSameDocument === 'boolean' ? event.isSameDocument : false;
    if (!isMainFrame || isSameDocument) return;
    if (ptyManager.getTerminalCount() > 0) {
      logger.warn('ptyManager', `main-frame navigation — destroying ${ptyManager.getTerminalCount()} PTY(s)`);
    }
    pty.killPTY();
    ptyManager.destroyAll();
  });

  // Initialize modules with window reference
  crashGuard.attachWindow(mainWindow);
  uiZoom.attachWindow(mainWindow);
  pty.init(mainWindow);
  ptyManager.init(mainWindow);
  aiToolManager.init(mainWindow, app);
  menu.init(mainWindow, app, aiToolManager);
  dialogs.init(mainWindow, (projectPath) => {
    pty.setProjectPath(projectPath);
    promptLogger.setProject(projectPath);
    activityLog.setProject(projectPath);
  });
  updateChecker.init(mainWindow);
  initModulesWithWindow(mainWindow);

  // Create application menu
  menu.createMenu();

  // Check for updates after window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    perfMonitor.mark('did-finish-load');
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
  // Same repaired PATH as githubManager, or a Finder-launched app shows the
  // "gh was not found" banner while the panel one click later finds it.
  envPath.childEnv().then((env) => {
    for (const [bin, consequence] of probes) {
      execFile(bin, ['--version'], { timeout: 5000, env }, (err) => {
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
  });
}

/**
 * Setup all IPC handlers
 */
function setupAllIPC() {
  // Setup module IPC handlers
  pty.setupIPC(ipcMain);
  ptyManager.setupIPC(ipcMain);
  // Before any PTY exists: terminals get the report env from it.
  sessionRestore.init();
  sessionRestore.setupIPC(ipcMain);
  dialogs.setupIPC(ipcMain);
  fileTree.setupIPC(ipcMain);
  promptLogger.setupIPC(ipcMain);
  projectRegistry.setupIPC(ipcMain);
  frameProject.setupIPC(ipcMain);
  frameStore.setupIPC(ipcMain);
  fileEditor.setupIPC(ipcMain);
  tasksManager.setupIPC(ipcMain);
  pluginsManager.setupIPC(ipcMain);
  githubManager.setupIPC(ipcMain);
  claudeUsageManager.setupIPC(ipcMain);
  projectInsights.setupIPC(ipcMain);
  gitBranchesManager.setupIPC(ipcMain);
  workspaceManager.setupIPC(ipcMain);
  workspaceGitState.setupIPC(ipcMain);
  claudeSessionsManager.setupIPC(ipcMain);
  codexSessionsManager.setupIPC(ipcMain);
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

  // Analytics — toggle from Settings
  ipcMain.handle(IPC.ANALYTICS_SET_ENABLED, (event, enabled) =>
    analytics.setEnabled(enabled)
  );

  // Analytics — renderer-originated events; track() validates (name, props)
  // against the registry, so the renderer cannot bypass the allowlist
  ipcMain.on(IPC.ANALYTICS_TRACK, (event, name, props) => {
    analytics.track(name, props);
  });

  // Analytics — renderer exceptions. The renderer forwards the raw shape and
  // captureException sanitizes here, for the same reason ANALYTICS_TRACK
  // revalidates here: the main process is the only place the guarantee can
  // be enforced, whatever a renderer module sends.
  ipcMain.on(IPC.ANALYTICS_EXCEPTION, (event, err) => {
    analytics.captureException(err);
  });

  // Analytics — is the disclosure notice due? The renderer draws it; the
  // decision stays here, beside the settings it reads.
  ipcMain.handle(IPC.ANALYTICS_NOTICE_STATE, () => analytics.noticeState());

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

  // Perf instrumentation right after logging (dev-gated; no-op otherwise).
  perfMonitor.init();
  perfMonitor.mark('app-ready');

  // Activity record — the work Frame does on its own. Always on and always
  // filling its ring; the panel reads it, nothing is transmitted.
  activityLog.init();

  // Sharing mode + layout migration record what they do (mode changes,
  // migration steps) into the activity ring.
  gitSharing.init({ activityLog });
  layoutMigration.init({ activityLog });

  // Initialize prompt logger with app paths
  promptLogger.init(app);

  // Initialize user settings (must run after app is ready so userData path resolves)
  userSettings.init();
  // Before anything can write a setting: an unreadable settings file must
  // leave analytics durably off, not just off until the next write.
  analytics.migrateLegacySettings();
  analytics.enforceFailClosed();
  // The interface scale reads its step from user settings, and createWindow
  // reads the factor from it — so it sits between the two.
  uiZoom.init();

  // Global crash handlers + local-only crash dumps. After userSettings
  // (reads the crashDumpsEnabled toggle), before everything else so no
  // later init runs unguarded.
  crashGuard.init();

  // Send the launch event after userSettings is loaded so the opt-out
  // check uses the correct state, and so the install id resolves against
  // the user's real choice rather than an empty cache.
  analytics.trackAppStarted();
  analytics.startActiveTimer();

  // Setup IPC handlers
  setupAllIPC();
}

/**
 * Initialize modules that need window reference
 */
function initModulesWithWindow(window) {
  projectRegistry.init(app, window);
  frameProject.init(window);
  fileEditor.init(window);
  tasksManager.init(window);
  pluginsManager.init(window);
  githubManager.init(window);
  claudeUsageManager.init(window);
  projectInsights.init(window);
  gitBranchesManager.init(window);
  workspaceManager.init(window);
  workspaceGitState.init(window);
  claudeSessionsManager.init(window);
  gitStatusManager.init(window);
  specManager.init(window);
  orchestrationManager.init(window);
  activityLog.attachWindow(window);
}

// Initialize Aptabase and build the PostHog client. Aptabase MUST run before
// app.whenReady() because its SDK registers a privileged protocol scheme.
// Neither sends anything here; the app_started event is fired after
// userSettings loads, from app.whenReady below.
analytics.init();

// App lifecycle
app.whenReady().then(() => {
  // macOS'ta menü bar'da "Frame" görünsün
  app.setName('Frame');

  // Ask the login shell for the real PATH now, in the background, so the first
  // child process that needs it doesn't pay for a shell startup. Safe to skip
  // — callers resolve it on demand — this only moves the cost off the click.
  envPath.primeLoginPath();

  // Unpackaged, macOS shows Electron's own icon in the dock — the bundle's
  // icns only applies once built. Set it explicitly so `npm start` looks like
  // the product. Never fatal: a missing file just leaves the default.
  if (process.platform === 'darwin' && app.dock) {
    try {
      app.dock.setIcon(path.join(__dirname, '../../assets/icon.png'));
    } catch (err) {
      console.error('Could not set the dock icon:', err.message);
    }
  }

  init();
  createWindow();
  perfMonitor.mark('window-created');
});

// Confirm-on-quit: Cmd-Q / app menu / OS shutdown with live agents, then
// flush analytics. posthog-node batches, so a session's last events — the
// ones that say what the user did just before leaving — would otherwise die
// with the process. The flush borrows the same preventDefault-then-re-quit
// shape the confirmation already uses, and analytics.shutdown() carries its
// own timeout so a dead network cannot hold the app open.
app.on('before-quit', (e) => {
  if (!quitConfirmed) {
    if (!confirmQuitWithLiveAgents()) {
      e.preventDefault();
      return;
    }
    quitConfirmed = true;
  }
  if (analyticsFlushed) return;
  analyticsFlushed = true;
  e.preventDefault();
  analytics.shutdown().finally(() => app.quit());
});

// Structure lifecycle workers (STR-02) stop once quitting is certain —
// will-quit only fires after before-quit's live-agent confirmation passed.
app.on('will-quit', () => {
  structureLifecycle.disposeAll();
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
