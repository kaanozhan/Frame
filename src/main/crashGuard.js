/**
 * Crash Guard — global error handlers for the main process.
 *
 * Before this module, a single uncaught exception killed the whole main
 * process silently and renderer/child crashes went unobserved. Everything
 * here logs (rotating, redacted file via logger) and degrades instead of
 * dying: uncaught errors surface as a renderer health notice, a dead
 * renderer offers reload, and Electron's built-in crashReporter collects
 * **local-only** minidumps (uploadToServer: false — nothing ever leaves the
 * machine; see PRIVACY.md). Dump collection is optional via the Settings
 * toggle (`crashDumpsEnabled`, default on; applies on next launch).
 */

const { app, dialog, crashReporter } = require('electron');
const logger = require('./logger');
const { IPC } = require('../shared/ipcChannels');
const userSettings = require('./userSettings');

let mainWindow = null;

function init() {
  process.on('uncaughtException', (err) => {
    logger.error('crash', 'uncaughtException:', err);
    notify('uncaught-exception', `Main process error: ${err.message}`);
  });

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error('crash', 'unhandledRejection:', err);
    notify('unhandled-rejection', `Unhandled rejection: ${err.message}`);
  });

  app.on('child-process-gone', (event, details) => {
    logger.error('crash', 'child-process-gone:', details.type, details.reason, `exit=${details.exitCode}`);
  });

  app.on('render-process-gone', (event, webContents, details) => {
    logger.error('crash', 'render-process-gone:', details.reason, `exit=${details.exitCode}`);
    if (details.reason === 'clean-exit') return;
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      title: 'Frame',
      message: 'The Frame window crashed.',
      detail: `Reason: ${details.reason}. Reload to continue — running agents in the main process are unaffected.`,
      buttons: ['Reload', 'Quit'],
      defaultId: 0
    });
    if (choice === 0 && !webContents.isDestroyed()) {
      webContents.reload();
    } else if (choice === 1) {
      app.quit();
    }
  });

  // Local-only minidumps. Consent model: collection is on by default (no
  // data is transmitted), the Settings toggle turns it off, and any future
  // *upload* would be a separate opt-in (PRIVACY.md).
  if (userSettings.get('crashDumpsEnabled') !== false) {
    try {
      crashReporter.start({ uploadToServer: false });
      logger.info('crash', 'local crash dumps enabled at', app.getPath('crashDumps'));
    } catch (err) {
      logger.warn('crash', 'crashReporter start failed:', err.message);
    }
  } else {
    logger.info('crash', 'local crash dumps disabled by setting');
  }
}

/** Wire per-window signals; called from createWindow. */
function attachWindow(window) {
  mainWindow = window;
  window.webContents.on('unresponsive', () => {
    logger.warn('crash', 'renderer unresponsive');
  });
  window.webContents.on('responsive', () => {
    logger.info('crash', 'renderer responsive again');
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
}

/** Surface a degraded/error state as a dismissible renderer banner. */
function notify(source, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.MAIN_PROCESS_ERROR, { source, message });
  }
}

module.exports = { init, attachWindow, notify };
