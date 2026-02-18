/**
 * Prompt Logger Module
 * Logs terminal input to history file
 */

const fs = require('fs');
const path = require('path');
const { IPC } = require('../shared/ipcChannels');

let logFilePath = null;
let inputBuffer = '';

/**
 * Initialize prompt logger
 */
function init(app) {
  logFilePath = path.join(app.getPath('userData'), 'prompts-history.txt');
}

/**
 * Get log file path
 */
function getLogFilePath() {
  return logFilePath;
}

/**
 * Process and log input data
 * @param {string} data - Input data from terminal
 */
function logInput(data) {
  for (let char of data) {
    if (char === '\r' || char === '\n') {
      // Enter pressed - save the line
      if (inputBuffer.trim().length > 0) {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${inputBuffer}\n`;
        fs.appendFileSync(logFilePath, logEntry, 'utf8');
      }
      inputBuffer = '';
    } else if (char === '\x7f' || char === '\b') {
      // Backspace - remove last char
      inputBuffer = inputBuffer.slice(0, -1);
    } else if (char.charCodeAt(0) >= 32 && char !== '\x7f') {
      // Printable character (including Unicode)
      inputBuffer += char;
    }
  }
}

/**
 * Get prompt history
 * @returns {string} History file contents
 */
function getHistory() {
  try {
    if (fs.existsSync(logFilePath)) {
      return fs.readFileSync(logFilePath, 'utf8');
    }
  } catch (err) {
    console.error('Error reading prompt history:', err);
  }
  return '';
}

/**
 * Setup IPC handlers
 */
function setupIPC(ipcMain) {
  ipcMain.on(IPC.LOAD_PROMPT_HISTORY, (event) => {
    const data = getHistory();
    event.sender.send(IPC.PROMPT_HISTORY_DATA, data);
  });
}

module.exports = {
  init,
  logInput,
  getHistory,
  getLogFilePath,
  setupIPC
};
