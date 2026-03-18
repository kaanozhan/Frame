/**
 * Prompt Logger Module
 * Logs terminal input to history file
 */

const fs = require('fs');
const path = require('path');
const { IPC } = require('../shared/ipcChannels');

let logFilePath = null;
let inputBuffer = '';
let framePromptsDir = null;

/**
 * Initialize prompt logger
 */
function init(app) {
  // Global fallback: userData/prompts-history.txt (backward compat)
  logFilePath = path.join(app.getPath('userData'), 'prompts-history.txt');

  // Project-based logs go to ~/.frame/prompts/
  framePromptsDir = path.join(app.getPath('home'), '.frame', 'prompts');
  if (!fs.existsSync(framePromptsDir)) {
    fs.mkdirSync(framePromptsDir, { recursive: true });
  }
}

/**
 * Set active project — switches log file to project-specific path
 * @param {string} projectPath - Absolute path of the selected project
 */
function setProject(projectPath) {
  if (!framePromptsDir || !projectPath) return;
  const projectName = path.basename(projectPath);
  logFilePath = path.join(framePromptsDir, `${projectName}.log`);
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
  setProject,
  logInput,
  getHistory,
  getLogFilePath,
  setupIPC
};
