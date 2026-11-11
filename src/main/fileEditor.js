/**
 * File Editor Module
 * Handles file reading and writing for the editor overlay
 */

const fs = require('fs');
const path = require('path');
const { IPC } = require('../shared/ipcChannels');

let mainWindow = null;

/**
 * Initialize file editor module
 */
function init(window) {
  mainWindow = window;
}

/**
 * Read file contents
 */
function readFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return { success: true, content, filePath };
  } catch (err) {
    return { success: false, error: err.message, filePath };
  }
}

/**
 * Write file contents
 */
function writeFile(filePath, content) {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message, filePath };
  }
}

/**
 * Get file extension
 */
function getFileExtension(filePath) {
  return path.extname(filePath).toLowerCase().slice(1);
}

/**
 * Setup IPC handlers
 */
function setupIPC(ipcMain) {
  const serverPanels = require('./serverPanels');
  ipcMain.on(IPC.READ_FILE, async (event, filePath, ctx) => {
    // A server workspace's file is read on the server, read-only
    // (server-workspace-panels), routed by the opener's workspace id (T6).
    const remote = serverPanels.resolve(filePath, serverPanels.ctxOf(ctx));
    if (remote) {
      let result;
      try {
        result = await serverPanels.call(remote, 'files.read', { filePath });
      } catch (err) {
        result = { success: false, error: err.message, filePath, readOnly: true, extension: getFileExtension(filePath), fileName: path.basename(filePath) };
      }
      if (!event.sender.isDestroyed()) event.sender.send(IPC.FILE_CONTENT, result);
      return;
    }
    const result = readFile(filePath);
    result.extension = getFileExtension(filePath);
    result.fileName = path.basename(filePath);
    event.sender.send(IPC.FILE_CONTENT, result);
  });

  ipcMain.on(IPC.WRITE_FILE, (event, { filePath, content, workspaceId }) => {
    if (serverPanels.resolve(filePath, serverPanels.ctxOf({ workspaceId }))) {
      event.sender.send(IPC.FILE_SAVED, { success: false, error: serverPanels.READ_ONLY_FILES, filePath });
      return;
    }
    const result = writeFile(filePath, content);
    event.sender.send(IPC.FILE_SAVED, result);
  });
}

module.exports = {
  init,
  readFile,
  writeFile,
  setupIPC
};
