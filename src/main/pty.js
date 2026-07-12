/**
 * PTY Management Module
 * Handles shell spawning, input/output, and resize
 */

const pty = require('node-pty');
const { IPC } = require('../shared/ipcChannels');

let ptyProcess = null;
let mainWindow = null;
let currentProjectPath = null;

/**
 * Initialize PTY module with window reference
 */
function init(window) {
  mainWindow = window;
}

/**
 * Get current project path
 */
function getProjectPath() {
  return currentProjectPath;
}

/**
 * Set current project path
 */
function setProjectPath(path) {
  currentProjectPath = path;
}

/**
 * Determine shell based on platform
 */
function getShell() {
  if (process.platform === 'win32') {
    try {
      require('child_process').execSync('where pwsh', { stdio: 'ignore' });
      console.log('Using PowerShell Core (pwsh)');
      return 'pwsh.exe';
    } catch {
      console.log('Using Windows PowerShell');
      return 'powershell.exe';
    }
  } else {
    // zsh is the macOS default; Linux distros default to bash and often
    // don't ship /bin/zsh at all
    const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
    console.log('Using shell:', shell);
    return shell;
  }
}

/**
 * Start PTY process
 */
function startPTY(workingDir = null) {
  // Kill existing process if any
  if (ptyProcess) {
    ptyProcess.kill();
  }

  const shell = getShell();
  const cwd = workingDir || currentProjectPath || process.env.HOME || process.env.USERPROFILE;

  // Spawn PTY with interactive and login flags
  const shellArgs = process.platform === 'win32' ? [] : ['-i', '-l'];

  ptyProcess = pty.spawn(shell, shellArgs, {
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

  // Send PTY output to renderer
  ptyProcess.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.TERMINAL_OUTPUT, data);
    }
  });

  // Handle PTY exit
  ptyProcess.onExit(({ exitCode, signal }) => {
    console.log('PTY exited:', exitCode, signal);
  });

  return ptyProcess;
}

/**
 * Write data to PTY
 */
function writeToPTY(data) {
  if (ptyProcess) {
    ptyProcess.write(data);
  }
}

/**
 * Resize PTY
 */
function resizePTY(cols, rows) {
  if (ptyProcess) {
    ptyProcess.resize(cols, rows);
  }
}

/**
 * Kill PTY process
 */
function killPTY() {
  if (ptyProcess) {
    ptyProcess.kill();
    ptyProcess = null;
  }
}

/**
 * Get current PTY process
 */
function getCurrentPTY() {
  return ptyProcess;
}

/**
 * Setup IPC handlers
 */
function setupIPC(ipcMain) {
  ipcMain.on(IPC.START_TERMINAL, () => {
    startPTY();
  });

  ipcMain.on(IPC.RESTART_TERMINAL, (event, projectPath) => {
    currentProjectPath = projectPath;
    startPTY(projectPath);
  });

  ipcMain.on(IPC.TERMINAL_RESIZE, (event, { cols, rows }) => {
    resizePTY(cols, rows);
  });
}

module.exports = {
  init,
  startPTY,
  writeToPTY,
  resizePTY,
  killPTY,
  getCurrentPTY,
  getProjectPath,
  setProjectPath,
  setupIPC
};
