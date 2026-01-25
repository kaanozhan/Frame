/**
 * Terminal UI Module
 * Now integrates with MultiTerminalUI for multi-terminal support
 * Maintains backward compatibility with existing API
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const { MultiTerminalUI } = require('./multiTerminalUI');

let multiTerminalUI = null;

/**
 * Initialize terminal (now creates MultiTerminalUI)
 */
function initTerminal(containerId) {
  multiTerminalUI = new MultiTerminalUI(containerId);
  return multiTerminalUI;
}

/**
 * Write to active terminal
 */
function writeToTerminal(data) {
  if (multiTerminalUI) {
    multiTerminalUI.getManager().writeToActive(data);
  }
}

/**
 * Write line to active terminal
 */
function writelnToTerminal(data) {
  if (multiTerminalUI) {
    multiTerminalUI.writelnToTerminal(data);
  }
}

/**
 * Fit all terminals
 */
function fitTerminal() {
  if (multiTerminalUI) {
    multiTerminalUI.fitTerminal();
  }
}

/**
 * Get terminal manager
 */
function getTerminal() {
  if (multiTerminalUI) {
    return multiTerminalUI.getManager();
  }
  return null;
}

/**
 * Start terminal (no longer needed - auto-starts)
 */
function startTerminal() {
  // Multi-terminal auto-creates first terminal
  // This is kept for backward compatibility
}

/**
 * Restart terminal with new path (creates new terminal in path)
 */
function restartTerminal(projectPath) {
  if (multiTerminalUI) {
    multiTerminalUI.getManager().createTerminal({ cwd: projectPath });
  }
}

/**
 * Send command to active terminal
 */
function sendCommand(command) {
  if (multiTerminalUI) {
    multiTerminalUI.sendCommand(command);
  }
}

// Expose sendCommand globally for modules that can't import terminal directly (circular dependency)
window.terminalSendCommand = sendCommand;

/**
 * Get MultiTerminalUI instance
 */
function getMultiTerminalUI() {
  return multiTerminalUI;
}

module.exports = {
  initTerminal,
  writeToTerminal,
  writelnToTerminal,
  fitTerminal,
  getTerminal,
  startTerminal,
  restartTerminal,
  sendCommand,
  getMultiTerminalUI
};
