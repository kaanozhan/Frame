/**
 * PTY Manager Module
 * Manages multiple PTY instances for multi-terminal support
 */

const pty = require('node-pty');
const { IPC } = require('../shared/ipcChannels');
const logger = require('./logger');
const promptLogger = require('./promptLogger');
const telemetry = require('./telemetry');
const pollGate = require('./pollGate');

// Store multiple PTY instances
const ptyInstances = new Map(); // Map<terminalId, {pty, cwd, projectPath}>
let mainWindow = null;
let terminalCounter = 0;
const MAX_TERMINALS = 9;

// Output flow control: chunks coalesce per terminal and flush once per
// display frame; past the high-water mark the PTY is paused until the next
// flush drains it (see onData in createTerminal).
const FLUSH_INTERVAL_MS = 16;
const OUTPUT_HIGH_WATER_BYTES = 1024 * 1024;

/** Flush a terminal's buffered output as one coalesced send. */
function flushOutput(terminalId) {
  const inst = ptyInstances.get(terminalId);
  if (!inst) return;
  inst.flushTimer = null;
  if (inst.outputChunks.length === 0) return;
  const data = inst.outputChunks.join('');
  inst.outputChunks = [];
  inst.outputBytes = 0;
  if (inst.paused) {
    try { inst.pty.resume(); } catch (_) { /* older node-pty */ }
    inst.paused = false;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.TERMINAL_OUTPUT_ID, { terminalId, data });
  }
}

/**
 * Initialize PTY manager with window reference
 */
function init(window) {
  mainWindow = window;
}

/**
 * Get default shell based on platform
 */
/**
 * Resolve the full command line of the terminal's foreground process.
 * Unix only: `ps -o tpgid= -p <shellPid>` gives the foreground process
 * group of the controlling tty; its leader's `command=` is what the user
 * actually typed ("npm run dev", "python manage.py runserver", ...).
 * Windows has no tpgid concept — callback gets null and the renderer
 * falls back to the bare process name.
 */
function getForegroundCommand(shellPid, callback) {
  if (process.platform === 'win32') {
    callback(null);
    return;
  }
  const { execFile } = require('child_process');
  execFile('ps', ['-o', 'tpgid=', '-p', String(shellPid)], (err, out) => {
    const tpgid = (out || '').trim();
    if (err || !tpgid || !/^\d+$/.test(tpgid)) {
      callback(null);
      return;
    }
    execFile('ps', ['-o', 'command=', '-p', tpgid], (err2, out2) => {
      const command = (out2 || '').trim();
      callback(err2 || !command ? null : command);
    });
  });
}

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
function createTerminal(workingDir = null, projectPath = null, shellPath = null, extraEnv = null) {
  // Per-project cap. The renderer keeps terminals from inactive projects
  // alive in its Map for fast switch-back, so a global count would surface
  // here as a confusing "you have 3 visible but can't open a 4th" because
  // 6 hidden ones from a previous project are eating the global slot.
  const projectCount = Array.from(ptyInstances.values())
    .filter(p => p.projectPath === projectPath).length;
  if (projectCount >= MAX_TERMINALS) {
    throw new Error(`Maximum terminal limit (${MAX_TERMINALS}) reached for this project`);
  }

  const terminalId = `term-${++terminalCounter}`;
  const cwd = workingDir || process.env.HOME || process.env.USERPROFILE;
  const shell = shellPath || getDefaultShell();

  // Determine shell arguments based on shell type
  let shellArgs = [];
  if (process.platform !== 'win32') {
    // For Unix shells, use interactive login shell
    const shellName = shell.split('/').pop();
    if (shellName === 'fish') {
      shellArgs = ['-i'];
    } else if (shellName === 'nu') {
      shellArgs = ['-l'];
    } else {
      shellArgs = ['-i', '-l'];
    }
  }

  const ptyProcess = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      // Orchestration: FRAME_ORCH_BUS / FRAME_ORCH_SLUG let conductor + worker
      // terminals reach Frame's command bus from any worktree (see
      // orchestrationManager). Null for normal terminals.
      ...(extraEnv || {})
    }
  });

  // Handle PTY output — coalesced. Chunks buffer per terminal and flush as
  // one TERMINAL_OUTPUT_ID send every FLUSH_INTERVAL_MS (one display frame),
  // instead of one webContents.send per chunk for up to 9 PTYs. Stamp
  // lastOutputAt so the orchestrator can tell a quiet (idle) worker from an
  // active one and drive its soft-done / long-idle heuristics.
  ptyProcess.onData((data) => {
    const inst = ptyInstances.get(terminalId);
    if (!inst) return;
    inst.lastOutputAt = Date.now();
    inst.outputChunks.push(data);
    inst.outputBytes += data.length;
    // Backpressure: past the high-water mark, pause the PTY until the next
    // flush drains the buffer — a runaway `yes`-style stream can no longer
    // grow the buffer faster than the renderer consumes it.
    if (inst.outputBytes >= OUTPUT_HIGH_WATER_BYTES && !inst.paused) {
      try { ptyProcess.pause(); inst.paused = true; } catch (_) { /* older node-pty */ }
    }
    if (!inst.flushTimer) {
      inst.flushTimer = setTimeout(() => flushOutput(terminalId), FLUSH_INTERVAL_MS);
    }
  });

  // Handle PTY exit
  ptyProcess.onExit(({ exitCode, signal }) => {
    console.log(`Terminal ${terminalId} exited:`, exitCode, signal);
    const inst = ptyInstances.get(terminalId);
    if (inst) {
      if (inst.processPoll) inst.processPoll.dispose();
      flushOutput(terminalId); // trailing output must land before DESTROYED
      if (inst.flushTimer) clearTimeout(inst.flushTimer);
    }
    ptyInstances.delete(terminalId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.TERMINAL_DESTROYED, { terminalId, exitCode });
    }
  });

  // Poll the PTY's foreground process name (what node-pty uses for tab
  // titles). The renderer compares it against the spawned shell to tell a
  // quiet-but-running server ("node", "expo") from a truly idle prompt.
  // Pushed only on change, so steady state costs one syscall per tick.
  // On change we also resolve the full command line ("npm run dev") via
  // the terminal's foreground process group — see getForegroundCommand.
  const spawnedShellName = shell.split(/[\\/]/).pop();
  let lastProcessName = null;
  const processPoll = pollGate.gatedInterval(() => {
    let name = null;
    try {
      name = ptyProcess.process || null;
    } catch {
      return;
    }
    if (name !== lastProcessName) {
      lastProcessName = name;
      getForegroundCommand(ptyProcess.pid, (commandLine) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC.TERMINAL_PROCESS_DATA, {
            terminalId,
            processName: name,
            shellName: spawnedShellName,
            commandLine
          });
        }
      });
    }
  }, 2500); // visibility-gated: paused while all windows are hidden

  ptyInstances.set(terminalId, {
    pty: ptyProcess,
    cwd,
    projectPath,
    processPoll,
    lastOutputAt: Date.now(),
    outputChunks: [],
    outputBytes: 0,
    flushTimer: null,
    paused: false
  });
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
    return { cwd: instance.cwd, projectPath: instance.projectPath, lastOutputAt: instance.lastOutputAt };
  }
  return null;
}

/**
 * Last time this terminal produced output (epoch ms), or null if unknown.
 * Used by the orchestrator's idle / soft-done detection.
 */
function getLastOutputAt(terminalId) {
  const instance = ptyInstances.get(terminalId);
  return instance ? (instance.lastOutputAt || null) : null;
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
    if (instance.processPoll) instance.processPoll.dispose();
    if (instance.flushTimer) clearTimeout(instance.flushTimer);
    try {
      instance.pty.kill();
    } catch (e) {
      logger.warn('ptyManager', `kill failed for terminal ${terminalId}:`, e.message);
    }
    ptyInstances.delete(terminalId);
    logger.info('ptyManager', `Destroyed terminal ${terminalId}`);
  }
}

/**
 * Destroy all terminals
 */
function destroyAll() {
  for (const [terminalId, instance] of ptyInstances) {
    if (instance.processPoll) instance.processPoll.dispose();
    if (instance.flushTimer) clearTimeout(instance.flushTimer);
    try {
      instance.pty.kill();
    } catch (e) {
      logger.warn('ptyManager', `kill failed for terminal ${terminalId}:`, e.message);
    }
    logger.info('ptyManager', `Destroyed terminal ${terminalId}`);
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
 * Destroy every PTY the renderer doesn't know about. A renderer reload
 * (Cmd-R / did-fail-load) doesn't fire the window `closed` event, so
 * without this the fresh renderer loses its handles while the underlying
 * agents keep running invisibly. Returns the destroyed ids.
 */
function destroyExcept(knownIds) {
  const keep = new Set(knownIds);
  const orphans = getTerminalIds().filter((id) => !keep.has(id));
  for (const id of orphans) destroyTerminal(id);
  return orphans;
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
      let extraEnv = null;

      if (typeof data === 'string') {
        // Legacy format: just working directory
        workingDir = data;
      } else if (data && typeof data === 'object') {
        // New format: { cwd, projectPath, shell, extraEnv }
        workingDir = data.cwd;
        projectPath = data.projectPath;
        shellPath = data.shell;
        extraEnv = data.extraEnv || null; // orchestration worker lanes pass FRAME_ORCH_* here
      }

      const terminalId = createTerminal(workingDir, projectPath, shellPath, extraEnv);
      event.reply(IPC.TERMINAL_CREATED, { terminalId, success: true });
    } catch (error) {
      telemetry.track('error_occurred', { category: 'terminal_create_failed' });
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
}

module.exports = {
  init,
  createTerminal,
  writeToTerminal,
  resizeTerminal,
  destroyTerminal,
  destroyAll,
  destroyExcept,
  getTerminalCount,
  getTerminalIds,
  hasTerminal,
  getTerminalsByProject,
  getTerminalInfo,
  getLastOutputAt,
  getAvailableShells,
  setupIPC
};
