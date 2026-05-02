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
 * Restart terminal with new path (creates new terminal in path for current project)
 */
async function restartTerminal(projectPath) {
  if (multiTerminalUI) {
    // Set the project first, then create terminal
    multiTerminalUI.setCurrentProject(projectPath);
    return await multiTerminalUI.createTerminalForCurrentProject();
  }
  return null;
}

/**
 * Send command to active terminal or specific terminal
 */
function sendCommand(command, terminalId = null) {
  if (multiTerminalUI) {
    multiTerminalUI.sendCommand(command, terminalId);
  }
}

/**
 * Set active terminal
 */
function setActiveTerminal(terminalId) {
  if (multiTerminalUI) {
    multiTerminalUI.setActiveTerminal(terminalId);
  }
}

// Expose sendCommand globally for modules that can't import terminal directly (circular dependency)
window.terminalSendCommand = sendCommand;

// Expose new-terminal orchestration so tasksPanel can spawn a fresh terminal
// and (optionally) launch an AI CLI inside it without importing terminal.js
// directly. Returns the new terminal id, or null on failure.
window.terminalCreateAndStart = async function(projectPath, toolStartCommand) {
  if (!multiTerminalUI) return null;
  if (projectPath) multiTerminalUI.setCurrentProject(projectPath);
  const newTerminalId = await multiTerminalUI.createTerminalForCurrentProject();
  if (!newTerminalId) return null;
  multiTerminalUI.setActiveTerminal(newTerminalId);
  if (toolStartCommand) {
    setTimeout(() => {
      multiTerminalUI.sendCommand(toolStartCommand, newTerminalId);
    }, 1000);
  }
  return newTerminalId;
};

// Send a prompt as raw text first, then a separate Enter keystroke after
// a short delay. AI CLIs (Claude Code, Codex, Gemini) buffer pasted
// chunks differently from real keyboard input — a trailing \r in the
// same write often gets absorbed into the input buffer instead of
// submitting. Splitting the two writes mirrors how a human would type
// then press Enter, and reliably triggers submit.
window.terminalSendPromptThenEnter = function(prompt, terminalId = null) {
  if (!multiTerminalUI) return;
  const manager = multiTerminalUI.getManager();
  const targetId = terminalId || (manager && manager.activeTerminalId);
  if (!targetId) return;
  ipcRenderer.send(IPC.TERMINAL_INPUT_ID, {
    terminalId: targetId,
    data: prompt
  });
  setTimeout(() => {
    ipcRenderer.send(IPC.TERMINAL_INPUT_ID, {
      terminalId: targetId,
      data: '\r'
    });
  }, 300);
};

// Expose focus function globally for returning focus from other panels
window.terminalFocus = function() {
  if (multiTerminalUI) {
    const manager = multiTerminalUI.getManager();
    if (manager && manager.activeTerminalId) {
      const instance = manager.terminals.get(manager.activeTerminalId);
      if (instance) {
        instance.terminal.focus();
      }
    }
  }
};

// Handle RUN_COMMAND IPC from menu accelerators (Cmd+K, Cmd+I, etc.)
ipcRenderer.on(IPC.RUN_COMMAND, (event, command) => {
  if (multiTerminalUI) {
    multiTerminalUI.sendCommand(command);
  }
});

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
  setActiveTerminal,
  getMultiTerminalUI
};
