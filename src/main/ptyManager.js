/**
 * PTY Manager Module
 * Manages multiple PTY instances for multi-terminal support
 */

const pty = require('node-pty');
const { IPC } = require('../shared/ipcChannels');
const promptLogger = require('./promptLogger');
const tmuxManager = require('./tmuxManager');
const terminalPersistence = require('./terminalPersistence');

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
 * Get default shell based on platform
 */
function getDefaultShell() {
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
 * Get available shells on the system
 * @returns {Array<{id: string, name: string, path: string}>}
 */
function getAvailableShells() {
  const shells = [];
  const { execSync } = require('child_process');
  const fs = require('fs');
  const defaultShell = getDefaultShell();

  if (process.platform === 'win32') {
    // Windows shells
    const windowsShells = [
      { id: 'powershell', name: 'PowerShell', path: 'powershell.exe' },
      { id: 'cmd', name: 'Command Prompt', path: 'cmd.exe' }
    ];

    // Check for PowerShell Core (pwsh)
    try {
      execSync('where pwsh', { stdio: 'ignore' });
      windowsShells.unshift({ id: 'pwsh', name: 'PowerShell Core', path: 'pwsh.exe' });
    } catch {}

    // Check for Git Bash
    const gitBashPaths = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe'
    ];
    for (const gitBash of gitBashPaths) {
      if (fs.existsSync(gitBash)) {
        windowsShells.push({ id: 'gitbash', name: 'Git Bash', path: gitBash });
        break;
      }
    }

    // Check for WSL
    try {
      execSync('where wsl', { stdio: 'ignore' });
      windowsShells.push({ id: 'wsl', name: 'WSL', path: 'wsl.exe' });
    } catch {}

    shells.push(...windowsShells);
  } else {
    // Unix-like shells (macOS, Linux)
    const unixShells = [
      { id: 'zsh', name: 'Zsh', path: '/bin/zsh' },
      { id: 'bash', name: 'Bash', path: '/bin/bash' },
      { id: 'sh', name: 'Shell', path: '/bin/sh' }
    ];

    // Check for fish shell
    try {
      execSync('which fish', { stdio: 'ignore' });
      const fishPath = execSync('which fish', { encoding: 'utf8' }).trim();
      unixShells.push({ id: 'fish', name: 'Fish', path: fishPath });
    } catch {}

    // Check for nushell
    try {
      execSync('which nu', { stdio: 'ignore' });
      const nuPath = execSync('which nu', { encoding: 'utf8' }).trim();
      unixShells.push({ id: 'nu', name: 'Nushell', path: nuPath });
    } catch {}

    // Filter to only existing shells and mark default
    for (const shell of unixShells) {
      if (fs.existsSync(shell.path)) {
        shell.isDefault = shell.path === defaultShell;
        shells.push(shell);
      }
    }
  }

  // Sort so default shell is first
  shells.sort((a, b) => {
    if (a.isDefault) return -1;
    if (b.isDefault) return 1;
    return 0;
  });

  return shells;
}

/**
 * Create a new terminal instance
 * @param {string|null} workingDir - Working directory (defaults to HOME)
 * @param {string|null} projectPath - Associated project path (null = global)
 * @param {string|null} shellPath - Shell to use (defaults to system default)
 * @returns {string} Terminal ID
 */
function createTerminal(workingDir = null, projectPath = null, shellPath = null) {
  if (ptyInstances.size >= MAX_TERMINALS) {
    throw new Error(`Maximum terminal limit (${MAX_TERMINALS}) reached`);
  }

  const terminalId = `term-${++terminalCounter}`;
  const cwd = workingDir || process.env.HOME || process.env.USERPROFILE;

  let ptyProcess;

  if (tmuxManager.isTmuxAvailable()) {
    // Create a tmux session so the terminal survives app restarts
    const sessionName = tmuxManager.sessionNameFor(terminalId);
    tmuxManager.createSession(sessionName, cwd);

    const tmuxBin = tmuxManager.findTmux();
    ptyProcess = pty.spawn(tmuxBin, ['attach-session', '-t', sessionName], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
    });

    terminalPersistence.add(terminalId, { sessionName, cwd, projectPath: projectPath || null, customName: null });
    console.log(`Created terminal ${terminalId} via tmux session ${sessionName} in ${cwd}`);
  } else {
    // Fallback: plain PTY (no persistence)
    const shell = shellPath || getDefaultShell();
    let shellArgs = [];
    if (process.platform !== 'win32') {
      const shellName = shell.split('/').pop();
      if (shellName === 'fish') {
        shellArgs = ['-i'];
      } else if (shellName === 'nu') {
        shellArgs = ['-l'];
      } else {
        shellArgs = ['-i', '-l'];
      }
    }

    ptyProcess = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
    });

    console.log(`Created terminal ${terminalId} (plain PTY, tmux unavailable) in ${cwd}`);
  }

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

  return terminalId;
}

/**
 * Restore terminals from persisted tmux sessions
 * @returns {Array<{terminalId, cwd, projectPath, customName}>} Restored terminal metadata
 */
function restoreTerminals() {
  if (!tmuxManager.isTmuxAvailable()) return [];

  const sessions = terminalPersistence.load();
  const restored = [];
  const tmuxBin = tmuxManager.findTmux();

  for (const [terminalId, data] of Object.entries(sessions)) {
    const { sessionName, cwd, projectPath, customName } = data;

    if (!tmuxManager.sessionExists(sessionName)) {
      // Session no longer exists, clean up
      terminalPersistence.remove(terminalId);
      continue;
    }

    // Update terminalCounter so new terminals don't collide with restored IDs
    const match = terminalId.match(/term-(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > terminalCounter) terminalCounter = num;
    }

    const ptyProcess = pty.spawn(tmuxBin, ['attach-session', '-t', sessionName], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
    });

    ptyProcess.onData((d) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.TERMINAL_OUTPUT_ID, { terminalId, data: d });
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      console.log(`Terminal ${terminalId} (restored) exited:`, exitCode);
      ptyInstances.delete(terminalId);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.TERMINAL_DESTROYED, { terminalId, exitCode });
      }
    });

    ptyInstances.set(terminalId, { pty: ptyProcess, cwd, projectPath: projectPath || null });
    restored.push({ terminalId, cwd, projectPath: projectPath || null, customName: customName || null });
    console.log(`Restored terminal ${terminalId} from tmux session ${sessionName}`);
  }

  return restored;
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

    // Kill associated tmux session and remove from persistence
    if (tmuxManager.isTmuxAvailable()) {
      const sessionName = tmuxManager.sessionNameFor(terminalId);
      tmuxManager.killSession(sessionName);
      terminalPersistence.remove(terminalId);
    }

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
  // Get available shells
  ipcMain.on(IPC.GET_AVAILABLE_SHELLS, (event) => {
    try {
      const shells = getAvailableShells();
      event.reply(IPC.AVAILABLE_SHELLS_DATA, { shells, success: true });
    } catch (error) {
      event.reply(IPC.AVAILABLE_SHELLS_DATA, { shells: [], success: false, error: error.message });
    }
  });

  // Create new terminal
  ipcMain.on(IPC.TERMINAL_CREATE, (event, data) => {
    try {
      // Support both old format (string) and new format (object)
      let workingDir = null;
      let projectPath = null;
      let shellPath = null;

      if (typeof data === 'string') {
        // Legacy format: just working directory
        workingDir = data;
      } else if (data && typeof data === 'object') {
        // New format: { cwd, projectPath, shell }
        workingDir = data.cwd;
        projectPath = data.projectPath;
        shellPath = data.shell;
      }

      const terminalId = createTerminal(workingDir, projectPath, shellPath);
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
    promptLogger.logInput(data);
  });

  // Resize specific terminal
  ipcMain.on(IPC.TERMINAL_RESIZE_ID, (event, { terminalId, cols, rows }) => {
    resizeTerminal(terminalId, cols, rows);
  });

  // Restore persisted terminals from tmux sessions
  ipcMain.on(IPC.TERMINALS_RESTORE, (event) => {
    try {
      const restored = restoreTerminals();
      event.reply(IPC.TERMINALS_RESTORED, { success: true, terminals: restored });
    } catch (error) {
      console.error('[ptyManager] Failed to restore terminals:', error);
      event.reply(IPC.TERMINALS_RESTORED, { success: false, terminals: [], error: error.message });
    }
  });
}

module.exports = {
  init,
  createTerminal,
  restoreTerminals,
  writeToTerminal,
  resizeTerminal,
  destroyTerminal,
  destroyAll,
  getTerminalCount,
  getTerminalIds,
  hasTerminal,
  getTerminalsByProject,
  getTerminalInfo,
  getAvailableShells,
  setupIPC
};
