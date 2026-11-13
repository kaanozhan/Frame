/**
 * electronShim — lets Frame's main-process managers run headless inside
 * Frame Server (server-workspaces spec, T1).
 *
 * The managers (ptyManager, workspaceManager, gitBranchesManager, …) were
 * written for Electron's main process. Here they run under plain Node:
 *
 *   - `require('electron')` returns small stubs (app paths under
 *     ~/.frame-server, an always-visible window list so visibility-gated
 *     pollers keep running, no-op ipcMain/dialog/shell);
 *   - analytics and the prompt log are replaced by no-ops — the server sends
 *     no telemetry and keeps no prompt history;
 *   - a **fake window** stands in for the BrowserWindow the managers send
 *     to: every `webContents.send(channel, payload)` goes to the listeners
 *     registered with `onSend`, which turn it into protocol events.
 *
 * `install()` must run before any manager is required.
 */

const Module = require('module');
const path = require('path');
const os = require('os');
const fs = require('fs');

const sendListeners = new Set();

const fakeWindow = {
  isDestroyed: () => false,
  isVisible: () => true,
  isMinimized: () => false,
  isFocused: () => false,
  on() { return fakeWindow; },
  once() { return fakeWindow; },
  removeListener() { return fakeWindow; },
  webContents: {
    isDestroyed: () => false,
    on() {},
    send(channel, payload) {
      for (const fn of sendListeners) {
        try { fn(channel, payload); } catch (err) { console.error('[server] send listener failed:', err); }
      }
    }
  }
};

const noop = () => {};
const noopModule = new Proxy({}, { get: () => noop });

let installed = false;

/**
 * Install the hooks. `home` is the server's state folder (~/.frame-server),
 * `version` the Frame version reported by `app.getVersion()`.
 */
function install({ home = path.join(os.homedir(), '.frame-server'), version = '0.0.0' } = {}) {
  if (installed) return { fakeWindow, onSend };
  installed = true;
  const userData = path.join(home, 'userData');
  fs.mkdirSync(userData, { recursive: true });

  const app = {
    getPath: (name) => (name === 'home' ? os.homedir() : name === 'temp' ? os.tmpdir() : userData),
    getVersion: () => version,
    getName: () => 'Frame Server',
    isPackaged: false,
    isReady: () => true,
    whenReady: () => Promise.resolve(),
    on: noop,
    once: noop,
    quit: () => process.exit(0)
  };
  const electron = {
    app,
    BrowserWindow: { getAllWindows: () => [fakeWindow], getFocusedWindow: () => null },
    ipcMain: { on: noop, once: noop, handle: noop, removeHandler: noop, removeAllListeners: noop },
    dialog: { showMessageBox: async () => ({ response: 0 }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    shell: { openExternal: async () => {}, openPath: async () => '' },
    Notification: function Notification() { return { show: noop, on: noop }; },
    nativeTheme: { shouldUseDarkColors: true, on: noop }
  };

  const stubs = new Map([
    [path.resolve(__dirname, '../main/analytics.js'), noopModule],
    [path.resolve(__dirname, '../main/promptLogger.js'), noopModule]
  ]);

  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electron;
    if (request === 'electron-log/main' || request === 'electron-log') return null;
    if (request.startsWith('.') && parent && parent.filename) {
      let resolved = null;
      try { resolved = Module._resolveFilename(request, parent, isMain); } catch (_) { resolved = null; }
      if (resolved && stubs.has(resolved)) return stubs.get(resolved);
    }
    return originalLoad.apply(this, arguments);
  };
  return { fakeWindow, onSend };
}

/** Listen to everything the managers send to "the window". Returns an unsubscribe. */
function onSend(fn) {
  sendListeners.add(fn);
  return () => sendListeners.delete(fn);
}

module.exports = { install, onSend, fakeWindow };
