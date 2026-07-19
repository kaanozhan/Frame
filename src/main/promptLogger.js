/**
 * Prompt Logger Module
 * Logs terminal input to history file
 */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { IPC } = require('../shared/ipcChannels');
const { redact } = require('./logger');

// Prompt history is a feature, not a debug log — but it must never persist
// secrets typed into a terminal (API keys, tokens, passwords), and it must
// not grow unbounded. Every line is redacted before append (async, through
// a serialized queue so lines never interleave); past MAX_LOG_SIZE the live
// file rotates to <name>.log.1 (single generation), so ~2× the cap of
// recent history survives while the live file stays bounded.
const MAX_LOG_SIZE = 5 * 1024 * 1024;

let logFilePath = null;
let inputBuffer = '';
let framePromptsDir = null;
// Serialized append queue — keeps line order without blocking the loop.
let writeQueue = Promise.resolve();

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
        const logEntry = `[${timestamp}] ${redact(inputBuffer)}\n`;
        const targetPath = logFilePath; // capture — project may switch mid-queue
        writeQueue = writeQueue
          .then(() => appendAndRotate(targetPath, logEntry))
          .catch((err) => console.error('promptLogger: append failed:', err.message));
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
 * Append a line, then rotate past the cap: the live file moves to
 * <name>.log.1 (replacing the previous archive) and the next append starts
 * a fresh live file. Bounded at ~2× MAX_LOG_SIZE total per project.
 */
async function appendAndRotate(filePath, entry) {
  await fsp.appendFile(filePath, entry, 'utf8');
  const { size } = await fsp.stat(filePath);
  if (size <= MAX_LOG_SIZE) return;
  const archivePath = `${filePath}.1`;
  await fsp.rm(archivePath, { force: true }); // Windows can't rename onto an existing file
  await fsp.rename(filePath, archivePath);
}

/**
 * Get prompt history (live file only — bounded by MAX_LOG_SIZE)
 * @returns {Promise<string>} History file contents
 */
async function getHistory() {
  try {
    if (fs.existsSync(logFilePath)) {
      return await fsp.readFile(logFilePath, 'utf8');
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
  ipcMain.on(IPC.LOAD_PROMPT_HISTORY, async (event) => {
    const data = await getHistory();
    if (!event.sender.isDestroyed()) {
      event.sender.send(IPC.PROMPT_HISTORY_DATA, data);
    }
  });
}

/** Await all queued appends — tests and shutdown ordering. */
function flush() {
  return writeQueue;
}

module.exports = {
  init,
  setProject,
  logInput,
  getHistory,
  getLogFilePath,
  setupIPC,
  flush
};
