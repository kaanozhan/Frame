/**
 * PTY Manager Module
 * Manages multiple PTY instances for multi-terminal support
 */

const fs = require('fs');
const path = require('path');
const pty = require('node-pty');
const { IPC } = require('../shared/ipcChannels');
const { FRAME_DIR } = require('../shared/frameConstants');
const logger = require('./logger');
const promptLogger = require('./promptLogger');
const telemetry = require('./telemetry');
const pollGate = require('./pollGate');
const launchEnv = require('./launchEnv');
const shellSetup = require('./shellSetup');

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

// Shell setup: how long one attempt may stay invisible, and how much output
// may pile up behind it. The timeout is generous next to a warm shell's
// startup and short enough that a lane which will never confirm does not sit
// blank while the user waits. The cap is the same promise from the other side:
// a shell that floods (an rc file printing a banner, an MOTD) stops being
// suppressed rather than swallowing megabytes nobody will ever see.
const SETUP_TIMEOUT_MS = 4000;
const SETUP_BUFFER_MAX_BYTES = 256 * 1024;
const SETUP_MAX_ATTEMPTS = 2;

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
 * Hand data to the coalescing pipeline.
 *
 * The one door into it, so the setup buffer can flush through exactly the same
 * backpressure the PTY's own output goes through.
 */
function pushOutput(terminalId, data) {
  const inst = ptyInstances.get(terminalId);
  if (!inst || !data) return;
  inst.outputChunks.push(data);
  inst.outputBytes += data.length;
  // Backpressure: past the high-water mark, pause the PTY until the next
  // flush drains the buffer — a runaway `yes`-style stream can no longer
  // grow the buffer faster than the renderer consumes it.
  if (inst.outputBytes >= OUTPUT_HIGH_WATER_BYTES && !inst.paused) {
    try { inst.pty.pause(); inst.paused = true; } catch (_) { /* older node-pty */ }
  }
  if (!inst.flushTimer) {
    inst.flushTimer = setTimeout(() => flushOutput(terminalId), FLUSH_INTERVAL_MS);
  }
}

/**
 * Tell the renderer what this lane's context state is.
 *
 * `command` rides along on the payload because the failure row offers the user
 * the one-liner they could run themselves, and only this side knows which
 * shell the lane actually got. It is '' for every state but `failed`, where
 * there is nothing to suggest.
 */
function emitContextState(terminalId, state) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const inst = ptyInstances.get(terminalId);
  const shell = inst && inst.setup ? inst.setup.shell : '';
  mainWindow.webContents.send(IPC.TERMINAL_CONTEXT_STATE, {
    terminalId,
    state,
    ready: state === 'installed',
    command: state === 'failed' ? shellSetup.manualCommand(shell) : ''
  });
}

/**
 * End a lane's setup, whatever the outcome.
 *
 * Every exit path runs through here, because every exit path owes the user the
 * same two things: the input they typed into the invisible window, in the order
 * they typed it, and a terminal that is not left blank. Returns the output that
 * should reach the renderer.
 */
function finishSetup(terminalId, state, forward = '') {
  const inst = ptyInstances.get(terminalId);
  if (!inst || !inst.setup) return forward;
  const setup = inst.setup;

  if (setup.timer) {
    clearTimeout(setup.timer);
    setup.timer = null;
  }
  setup.state = state;
  setup.suppress = false;
  setup.buffer = [];
  setup.bytes = 0;

  const queued = setup.inputQueue;
  setup.inputQueue = [];
  for (const data of queued) {
    try { inst.pty.write(data); } catch (err) {
      logger.warn('ptyManager', `queued input lost for ${terminalId}:`, err.message);
    }
  }

  emitContextState(terminalId, state);
  return forward;
}

/**
 * An attempt did not confirm in time — or flooded the buffer, which amounts to
 * the same thing.
 *
 * The held output goes out verbatim first: whatever went wrong, the user is
 * looking at a terminal that must not be blank. Then one retry with a fresh
 * marker, typed visibly this time, and a second silence is `failed` — a
 * working terminal with no Frame context, which is exactly what a lane had
 * before this feature existed.
 *
 * Returns the buffered output to flush.
 */
function onSetupTimeout(terminalId) {
  const inst = ptyInstances.get(terminalId);
  if (!inst || !inst.setup || inst.setup.state !== 'pending') return '';
  const setup = inst.setup;

  const buffered = setup.buffer.join('');
  setup.buffer = [];
  setup.bytes = 0;
  setup.suppress = false;
  if (setup.timer) {
    clearTimeout(setup.timer);
    setup.timer = null;
  }

  // Only a typed line can be typed again. fish took its setup as a spawn flag,
  // so there is nothing to retry — a silent `-C` is a failure straight away.
  if (setup.mode !== 'type' || setup.attempt >= SETUP_MAX_ATTEMPTS) {
    return finishSetup(terminalId, 'failed', buffered);
  }

  const attempt = setup.attempt + 1;
  const retry = resolveSetup(terminalId, setup.shell, setup.projectPath, attempt);
  if (retry.mode !== 'type') return finishSetup(terminalId, 'failed', buffered);

  setup.attempt = attempt;
  setup.marker = retry.marker;
  try {
    inst.pty.write(`${retry.line}\n`);
  } catch (err) {
    logger.warn('ptyManager', `shell setup retry failed for ${terminalId}:`, err.message);
    return finishSetup(terminalId, 'failed', buffered);
  }
  armSetupTimer(terminalId);
  return buffered;
}

function armSetupTimer(terminalId) {
  const inst = ptyInstances.get(terminalId);
  if (!inst || !inst.setup) return;
  if (inst.setup.timer) clearTimeout(inst.setup.timer);
  inst.setup.timer = setTimeout(() => {
    const flushed = onSetupTimeout(terminalId);
    if (flushed) pushOutput(terminalId, flushed);
  }, SETUP_TIMEOUT_MS);
}

/**
 * Filter one chunk of output through a pending setup. Returns what the
 * renderer should see — '' while setup is still invisible.
 *
 * The marker is looked for in the accumulated buffer rather than the chunk,
 * because a PTY will happily split it across two reads and a per-chunk scan
 * would then miss it and time out a lane that had actually worked.
 */
function consumeSetupOutput(terminalId, chunk) {
  const inst = ptyInstances.get(terminalId);
  if (!inst || !inst.setup) return chunk;
  const setup = inst.setup;

  if (!setup.suppress) {
    // Past the first timeout: output flows, but the marker can still land and
    // turn the lane `installed`.
    const seen = shellSetup.splitOnMarker(chunk, setup.marker);
    return seen.found ? finishSetup(terminalId, 'installed', seen.rest) : chunk;
  }

  setup.buffer.push(chunk);
  setup.bytes += chunk.length;

  const joined = setup.buffer.join('');
  const { found, rest } = shellSetup.splitOnMarker(joined, setup.marker);
  if (found) {
    // Everything through the marker's own line is setup noise the user never
    // asked to see; what follows is their real first prompt.
    return finishSetup(terminalId, 'installed', rest);
  }
  if (setup.bytes >= SETUP_BUFFER_MAX_BYTES) return onSetupTimeout(terminalId);
  return '';
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
 * Whether this lane's folder is a Frame project.
 *
 * The fs half of the setup gate — `shellSetup` is pure and cannot answer it.
 * A folder with no `.frame/` has no init file to source and no wrappers to
 * route to, so nothing is sent and no function or variable is defined.
 */
function isFrameProject(projectPath) {
  if (!projectPath) return false;
  try {
    return fs.existsSync(path.join(projectPath, FRAME_DIR));
  } catch (_) {
    return false;
  }
}

/**
 * How this lane's shell gets set up, and with which marker.
 *
 * Never throws: a resolution failure returns `none`, which leaves the spawn
 * exactly as it was before this existed — `.frame/bin` on `PATH` and nothing
 * else. Losing context is acceptable; losing the terminal is not.
 */
function resolveSetup(terminalId, shell, projectPath, attempt) {
  try {
    const marker = shellSetup.mintMarker(terminalId, attempt);
    const delivery = shellSetup.deliveryFor(shell, process.platform, projectPath, {
      marker,
      isFrameProject: isFrameProject(projectPath)
    });
    return delivery;
  } catch (err) {
    logger.warn('ptyManager', `shell setup resolution failed for ${terminalId}:`, err.message);
    return { mode: 'none', reason: 'error' };
  }
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

  // Frame configures the session it creates. `.frame/bin` first on PATH (below)
  // is set *before* the user's rc files run, and those files reorder PATH
  // afterwards — which is how a `codex` from nvm's bin came to win. The init
  // file this delivers runs last and defines a function per tool, resolved
  // before any PATH search, so the ordering stops mattering. Nothing of the
  // user's own configuration is touched or rerouted.
  const setupProjectPath = projectPath || workingDir;
  const setup = resolveSetup(terminalId, shell, setupProjectPath, 1);
  if (setup.mode === 'flag') {
    // fish takes it at spawn: nothing is typed into the terminal at all.
    shellArgs = [...shellArgs, ...setup.args];
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
      // Frame's own binary, so a dispatched command can run Node without
      // depending on the user's PATH. Use it as
      // `ELECTRON_RUN_AS_NODE=1 "$FRAME_NODE" script.mjs` — quote it, the
      // packaged macOS path contains spaces.
      FRAME_NODE: process.execPath,
      // Frame's terminal carries Frame's context: `.frame/bin` goes first on
      // PATH, so a hand-typed `claude`, `codex` or `gemini` resolves to the
      // same wrapper a dispatch runs. Scoped to this child process — nothing
      // machine-wide is touched, and `command claude` still runs the real CLI
      // for anyone who wants it unwrapped.
      PATH: launchEnv.prependFrameBin(process.env.PATH, projectPath || workingDir),
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
    // Setup is held in front of the pipeline, not inside it: the user's first
    // prompt should be the one that follows setup, so none of it may reach the
    // renderer even coalesced.
    if (inst.setup && inst.setup.state === 'pending') {
      const visible = consumeSetupOutput(terminalId, data);
      if (!visible) return;
      pushOutput(terminalId, visible);
      return;
    }
    pushOutput(terminalId, data);
  });

  // Handle PTY exit
  ptyProcess.onExit(({ exitCode, signal }) => {
    console.log(`Terminal ${terminalId} exited:`, exitCode, signal);
    const inst = ptyInstances.get(terminalId);
    if (inst) {
      if (inst.processPoll) inst.processPoll.dispose();
      // A shell that died during setup still owes the user whatever it printed
      // on the way out — an rc-file error, most likely, which is the one thing
      // worth reading here.
      if (inst.setup && inst.setup.state === 'pending') {
        const held = inst.setup.buffer.join('');
        finishSetup(terminalId, 'failed');
        if (held) pushOutput(terminalId, held);
      }
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
    paused: false,
    // Per-lane setup state. `pending` until the marker confirms it (or a
    // timeout gives up); `unsupported` the moment there was nothing to send.
    setup: {
      state: setup.mode === 'none' ? 'unsupported' : 'pending',
      mode: setup.mode,
      reason: setup.reason || '',
      marker: setup.marker || '',
      attempt: 1,
      shell,
      projectPath: setupProjectPath,
      // While `suppress` holds, output is buffered here instead of forwarded
      // and input is queued instead of written — the window in which setup is
      // invisible. Both are flushed by `finishSetup`, in order.
      suppress: setup.mode !== 'none',
      buffer: [],
      bytes: 0,
      inputQueue: [],
      timer: null
    }
  });
  console.log(`Created terminal ${terminalId} in ${cwd} (project: ${projectPath || 'global'})`);

  // zsh, bash and sh have no post-startup flag that does not reroute the
  // user's own startup files, so the line is typed instead. It goes in
  // immediately: the tty holds type-ahead until the shell reads it, and a line
  // that does get lost is what the retry exists for.
  if (setup.mode === 'type') {
    try {
      ptyProcess.write(`${setup.line}\n`);
    } catch (err) {
      logger.warn('ptyManager', `shell setup delivery failed for ${terminalId}:`, err.message);
      finishSetup(terminalId, 'failed');
    }
  }

  if (setup.mode === 'none') {
    // Nothing to wait for. Emitted a tick late so the renderer has its
    // TERMINAL_CREATED reply — and therefore the lane — before its state.
    setImmediate(() => emitContextState(terminalId, 'unsupported'));
  } else if (ptyInstances.get(terminalId)?.setup.state === 'pending') {
    armSetupTimer(terminalId);
  }

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
 * This lane's context state: `pending`, `installed`, `failed` or `unsupported`.
 * Null for a terminal that no longer exists.
 */
function getSetupState(terminalId) {
  const instance = ptyInstances.get(terminalId);
  return instance && instance.setup ? instance.setup.state : null;
}

/**
 * Write data to specific terminal
 */
function writeToTerminal(terminalId, data) {
  const instance = ptyInstances.get(terminalId);
  if (!instance) return;
  // Held, not passed through, while setup is invisible: the buffer in front of
  // it is about to be discarded, so a keystroke written now would be echoed
  // into output the user never sees — they would watch their own typing
  // vanish. The queue goes through in order the moment setup resolves.
  const setup = instance.setup;
  if (setup && setup.state === 'pending' && setup.suppress) {
    setup.inputQueue.push(data);
    return;
  }
  instance.pty.write(data);
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
    if (instance.setup && instance.setup.timer) clearTimeout(instance.setup.timer);
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
    if (instance.setup && instance.setup.timer) clearTimeout(instance.setup.timer);
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
  getSetupState,
  getAvailableShells,
  setupIPC
};
