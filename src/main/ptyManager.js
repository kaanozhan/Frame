/**
 * PTY Manager Module
 * Manages multiple PTY instances for multi-terminal support
 */

const pty = require('node-pty');
const { IPC } = require('../shared/ipcChannels');

// Store multiple PTY instances
const ptyInstances = new Map(); // Map<terminalId, {pty, cwd, projectPath}>
let mainWindow = null;
let terminalCounter = 0;
const MAX_TERMINALS = 9;

/**
 * Initialize PTY manager with window reference
 */
function init(window) {
  mainWindow = window;
}

/**
 * Get shell based on platform
 */
function getShell() {
  if (process.platform === 'win32') {
    try {
      require('child_process').execSync('where pwsh', { stdio: 'ignore' });
      return 'pwsh.exe';
    } catch {
      return 'powershell.exe';
    }
  } else {
    return process.env.SHELL || '/bin/zsh';
  }
}

/**
 * Create a new terminal instance
 * @param {string|null} workingDir - Working directory (defaults to HOME)
 * @param {string|null} projectPath - Associated project path (null = global)
 * @returns {string} Terminal ID
 */
function createTerminal(workingDir = null, projectPath = null) {
  if (ptyInstances.size >= MAX_TERMINALS) {
    throw new Error(`Maximum terminal limit (${MAX_TERMINALS}) reached`);
  }

  const terminalId = `term-${++terminalCounter}`;
  const cwd = workingDir || process.env.HOME || process.env.USERPROFILE;
  const shell = getShell();
  const shellArgs = process.platform === 'win32' ? [] : ['-i', '-l'];

  const ptyProcess = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor'
    }
  });

  // Handle PTY output - send with terminal ID
  ptyProcess.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.TERMINAL_OUTPUT_ID, { terminalId, data });
    }
  });

  // Handle PTY exit
  ptyProcess.onExit(({ exitCode, signal }) => {
    console.log(`Terminal ${terminalId} exited:`, exitCode, signal);
    ptyInstances.delete(terminalId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.TERMINAL_DESTROYED, { terminalId, exitCode });
    }
  });

  ptyInstances.set(terminalId, { pty: ptyProcess, cwd, projectPath });
  console.log(`Created terminal ${terminalId} in ${cwd} (project: ${projectPath || 'global'})`);

  return terminalId;
}

/**
 * Get terminals for a specific project
 * @param {string|null} projectPath - Project path or null for global
 * @returns {string[]} Array of terminal IDs
 */
function getTerminalsByProject(projectPath) {
  const result = [];
  for (const [terminalId, instance] of ptyInstances) {
    if (instance.projectPath === projectPath) {
      result.push(terminalId);
    }
  }
  return result;
}

/**
 * Get terminal info
 * @param {string} terminalId - Terminal ID
 * @returns {Object|null} Terminal info (cwd, projectPath)
 */
function getTerminalInfo(terminalId) {
  const instance = ptyInstances.get(terminalId);
  if (instance) {
    return { cwd: instance.cwd, projectPath: instance.projectPath };
  }
  return null;
}

/**
 * Write data to specific terminal
 */
function writeToTerminal(terminalId, data) {
  const instance = ptyInstances.get(terminalId);
  if (instance) {
    instance.pty.write(data);
  }
}

/**
 * Resize specific terminal
 */
function resizeTerminal(terminalId, cols, rows) {
  const instance = ptyInstances.get(terminalId);
  if (instance) {
    instance.pty.resize(cols, rows);
  }
}

/**
 * Destroy specific terminal
 */
function destroyTerminal(terminalId) {
  const instance = ptyInstances.get(terminalId);
  if (instance) {
    instance.pty.kill();
    ptyInstances.delete(terminalId);
    console.log(`Destroyed terminal ${terminalId}`);
  }
}

/**
 * Destroy all terminals
 */
function destroyAll() {
  for (const [terminalId, instance] of ptyInstances) {
    instance.pty.kill();
    console.log(`Destroyed terminal ${terminalId}`);
  }
  ptyInstances.clear();
}

/**
 * Get terminal count
 */
function getTerminalCount() {
  return ptyInstances.size;
}

/**
 * Get all terminal IDs
 */
function getTerminalIds() {
  return Array.from(ptyInstances.keys());
}

/**
 * Check if terminal exists
 */
function hasTerminal(terminalId) {
  return ptyInstances.has(terminalId);
}

/**
 * Setup IPC handlers for multi-terminal
 */
function setupIPC(ipcMain) {
  // Create new terminal
  ipcMain.on(IPC.TERMINAL_CREATE, (event, data) => {
    try {
      // Support both old format (string) and new format (object)
      let workingDir = null;
      let projectPath = null;

      if (typeof data === 'string') {
        // Legacy format: just working directory
        workingDir = data;
      } else if (data && typeof data === 'object') {
        // New format: { cwd, projectPath }
        workingDir = data.cwd;
        projectPath = data.projectPath;
      }

      const terminalId = createTerminal(workingDir, projectPath);
      event.reply(IPC.TERMINAL_CREATED, { terminalId, success: true });
    } catch (error) {
      event.reply(IPC.TERMINAL_CREATED, { success: false, error: error.message });
    }
  });

  // Destroy terminal
  ipcMain.on(IPC.TERMINAL_DESTROY, (event, terminalId) => {
    destroyTerminal(terminalId);
  });

  // Input to specific terminal
  ipcMain.on(IPC.TERMINAL_INPUT_ID, (event, { terminalId, data }) => {
    writeToTerminal(terminalId, data);
  });

  // Resize specific terminal
  ipcMain.on(IPC.TERMINAL_RESIZE_ID, (event, { terminalId, cols, rows }) => {
    resizeTerminal(terminalId, cols, rows);
  });
}

module.exports = {
  init,
  createTerminal,
  writeToTerminal,
  resizeTerminal,
  destroyTerminal,
  destroyAll,
  getTerminalCount,
  getTerminalIds,
  hasTerminal,
  getTerminalsByProject,
  getTerminalInfo,
  setupIPC
};
