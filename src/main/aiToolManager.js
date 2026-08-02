/**
 * AI Tool Manager
 * Manages switching between different AI coding tools (Claude Code, Codex CLI, etc.)
 */

const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const fsSafe = require('./fsSafe');
const logger = require('./logger');
const telemetry = require('./telemetry');

// The user's real login shell. In a GUI-launched (packaged) app, process.env.SHELL
// is often unset, so fall back to the passwd entry — never to /bin/sh, which
// doesn't source the shell configs where PATH (claude/codex/gemini) usually
// lives. Last resort is platform-aware: zsh is macOS's default, bash Linux's.
function loginShell() {
  try {
    const s = os.userInfo().shell;
    if (s) return s;
  } catch (e) {
    logger.warn('aiToolManager', 'userInfo shell lookup failed:', e.message);
  }
  return process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
}
const { IPC } = require('../shared/ipcChannels');
const { FRAME_DIR, FRAME_BIN_DIR } = require('../shared/frameConstants');
const templates = require('../shared/frameTemplates');
const contextPreamble = require('../shared/contextPreamble');
const frameStore = require('./frameStore');
const globalLayer = require('./globalLayer');
const instructionDiscovery = require('./instructionDiscovery');
const launchEnv = require('./launchEnv');

let mainWindow = null;
let configPath = null;

/**
 * How each tool receives Frame's launch context.
 *
 * Since the overlay, Frame plants no root instruction file, so the context is
 * handed over when the tool starts. Declaratively per tool, because the
 * alternative is per-tool branching leaking across modules:
 *
 *   type 'flag'    — the CLI can take a system-prompt append and a settings
 *                    file on the command line. `promptFlag`/`settingsFlag`
 *                    name them.
 *   type 'wrapper' — no such flag, so `.frame/bin/<id>` execs the CLI with the
 *                    preamble as its initial prompt.
 *
 * Claude Code's flags are `--append-system-prompt <prompt>` and
 * `--settings <file-or-json>`, verified against the shipping CLI. A build that
 * does not know them degrades to the wrapper path rather than passing an
 * unknown flag, which would make the CLI refuse to start at all.
 */
const INJECTION_FLAG = 'flag';
const INJECTION_WRAPPER = 'wrapper';

// Default AI tools configuration
const AI_TOOLS = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    // Same value as `command`, and it earns its place: once a launch goes
    // through `.frame/bin/claude`, the availability probe would find the
    // wrapper and stop there. `fallbackCommand` is what it probes *behind* a
    // wrapper, so this is how "is Claude Code actually installed" keeps being
    // asked. Same reason codex and gemini carry it.
    fallbackCommand: 'claude',
    description: 'Anthropic Claude Code CLI',
    injection: {
      type: INJECTION_FLAG,
      promptFlag: '--append-system-prompt',
      settingsFlag: '--settings'
    },
    commands: {
      init: '/init',
      commit: '/commit',
      review: '/review-pr',
      help: '/help'
    },
    menuLabel: 'Claude Commands',
    supportsPlugins: true
  },
  codex: {
    id: 'codex',
    name: 'Codex CLI',
    command: './.frame/bin/codex',
    fallbackCommand: 'codex',
    injection: { type: INJECTION_WRAPPER },
    description: 'OpenAI Codex CLI (with Frame context injection)',
    commands: {
      review: '/review',
      model: '/model',
      permissions: '/permissions',
      help: '/help'
    },
    menuLabel: 'Codex Commands',
    supportsPlugins: false
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini CLI',
    command: './.frame/bin/gemini',
    fallbackCommand: 'gemini',
    injection: { type: INJECTION_WRAPPER },
    description: 'Google Gemini CLI (reads GEMINI.md natively)',
    commands: {
      init: '/init',
      model: '/model',
      memory: '/memory',
      compress: '/compress',
      settings: '/settings',
      help: '/help'
    },
    menuLabel: 'Gemini Commands',
    supportsPlugins: false
  }
};

// Current configuration
let config = {
  activeTool: 'claude',
  customTools: {}
};

/**
 * Initialize the AI Tool Manager
 */
function init(window, app) {
  mainWindow = window;
  configPath = path.join(app.getPath('userData'), 'ai-tool-config.json');
  loadConfig();
  setupIPC();
}

/**
 * First run only: default the active tool to a CLI that is actually
 * installed (claude → codex → gemini), using the same interactive-login
 * probe as the terminal preflight. A hard "claude" default on a machine
 * that only has gemini presents a broken terminal as the first experience.
 * Async and non-blocking — until it lands, the "claude" default stands.
 */
async function detectDefaultTool() {
  for (const id of ['claude', 'codex', 'gemini']) {
    const command = AI_TOOLS[id].fallbackCommand || AI_TOOLS[id].command;
    const probe = await isCommandAvailable(command);
    if (probe.found) {
      logger.info('aiToolManager', `first run: defaulting active tool to installed CLI "${id}"`);
      return id;
    }
  }
  logger.info('aiToolManager', 'first run: no AI CLI found on PATH — keeping "claude" default');
  return 'claude';
}

/**
 * Load configuration from file
 */
function loadConfig() {
  const { data, source, error } = fsSafe.readJsonWithRecovery(configPath);
  if (source === 'bak') {
    console.error('aiToolManager: ai-tool-config.json was corrupt — restored from .bak');
  } else if (error) {
    console.error('aiToolManager: config load failed (corrupt copy preserved):', error.message);
  }
  if (data) {
    config = { ...config, ...data };
  } else if (!error) {
    // Fresh install, no saved choice yet — probe installed CLIs once in the
    // background and persist the result
    detectDefaultTool().then((toolId) => {
      config.activeTool = toolId;
      saveConfig();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.AI_TOOL_CHANGED, getActiveTool());
      }
    }).catch((err) => {
      logger.warn('aiToolManager', 'default tool detection failed:', err.message);
    });
  }
}

/**
 * Save configuration to file
 */
function saveConfig() {
  try {
    fsSafe.writeFileAtomic(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('Error saving AI tool config:', error);
  }
}

/**
 * Get all available AI tools
 */
function getAvailableTools() {
  return { ...AI_TOOLS, ...config.customTools };
}

/**
 * Get the currently active tool
 */
function getActiveTool() {
  const tools = getAvailableTools();
  return tools[config.activeTool] || tools.claude;
}

/**
 * Set the active AI tool
 */
function setActiveTool(toolId) {
  const tools = getAvailableTools();
  if (tools[toolId]) {
    config.activeTool = toolId;
    saveConfig();
    telemetry.track('ai_tool_selected', { tool: toolId });

    // Notify renderer about the change
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.AI_TOOL_CHANGED, getActiveTool());
    }

    return true;
  }
  return false;
}

/**
 * Get full configuration for renderer
 */
function getConfig() {
  return {
    activeTool: getActiveTool(),
    availableTools: getAvailableTools()
  };
}

/**
 * Add a custom AI tool
 */
function addCustomTool(tool) {
  if (tool.id && tool.name && tool.command) {
    config.customTools[tool.id] = {
      ...tool,
      commands: tool.commands || {},
      menuLabel: tool.menuLabel || `${tool.name} Commands`,
      supportsPlugins: tool.supportsPlugins || false
    };
    saveConfig();
    return true;
  }
  return false;
}

/**
 * Remove a custom AI tool
 */
function removeCustomTool(toolId) {
  if (config.customTools[toolId]) {
    delete config.customTools[toolId];
    if (config.activeTool === toolId) {
      config.activeTool = 'claude';
    }
    saveConfig();
    return true;
  }
  return false;
}

/**
 * Compose the command line a lane actually types: the resolved CLI plus any
 * flags the dispatch asked for. Flags are opaque here — the caller decides
 * what a given run needs (spec.implement passes --settings/--permission-mode
 * for its autonomous mode); this only owns the quoting, because a packaged
 * macOS path arrives with spaces in it and an unquoted one would be read as
 * two arguments.
 */
function quoteArg(arg) {
  const str = String(arg);
  if (!/[\s"']/.test(str)) return str;
  return process.platform === 'win32'
    ? `"${str.replace(/"/g, '\\"')}"`
    : `'${str.replace(/'/g, `'\\''`)}'`;
}

function composeLaunchCommand(command, launchFlags) {
  if (!command || !Array.isArray(launchFlags) || launchFlags.length === 0) return command;
  return [command, ...launchFlags.map(quoteArg)].join(' ');
}

function isPathLike(command) {
  return !!command && (
    command.startsWith('./') ||
    command.startsWith('../') ||
    command.startsWith('/')
  );
}

/**
 * Check whether a CLI command can actually be launched on this system.
 * Used as a pre-flight before spawning a terminal so we don't hand the
 * user a "command not found" + an injected prompt sitting in a bare
 * shell. Tries the tool's primary command first, then its fallback.
 *
 * Resolves `{ found, reason }` — reason ('not-found' | 'timeout' |
 * 'spawn-error') distinguishes "the CLI isn't installed" from "the probe
 * itself failed", which need different guidance.
 */
async function isCommandAvailable(command, projectPath) {
  if (!command) return { found: false, reason: 'not-found' };

  // Path-based command: check the binary actually exists & is executable.
  if (isPathLike(command)) {
    const target = command.startsWith('/')
      ? command
      : (projectPath ? path.resolve(projectPath, command) : command);
    try {
      fs.accessSync(target, fs.constants.X_OK);
      return { found: true };
    } catch {
      return { found: false, reason: 'not-found' };
    }
  }

  // PATH-based command: probe via the user's **interactive login** shell so
  // PATH additions from .zshrc/.bashrc and shim managers (asdf, nvm, brew) are
  // visible — exactly like the PTY, which runs the shell with `-i -l`. A
  // packaged app launched from Finder has a minimal PATH and often no $SHELL,
  // and a non-interactive login (`-lc`) skips .zshrc — that's why the bundled
  // app reported "CLI not found" while the terminal could run it fine.
  const isWin = process.platform === 'win32';
  const shell = isWin
    ? (process.env.COMSPEC || 'cmd.exe')
    : (process.env.SHELL || loginShell());
  const args = isWin
    ? ['/c', `where ${command}`]
    : ['-ilc', `command -v ${command}`];

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!result.found) {
        logger.warn('aiToolManager', `CLI probe for "${command}" failed (${result.reason}) via ${shell}`);
      }
      resolve(result);
    };
    let child;
    try {
      child = spawn(shell, args, { stdio: 'ignore' });
    } catch (err) {
      logger.warn('aiToolManager', `CLI probe spawn failed for "${command}":`, err.message);
      resolve({ found: false, reason: 'spawn-error' });
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch (e) { logger.warn('aiToolManager', 'probe kill failed:', e.message); }
      finish({ found: false, reason: 'timeout' });
    }, 6000);
    child.on('exit', (code) => finish(code === 0 ? { found: true } : { found: false, reason: 'not-found' }));
    child.on('error', () => finish({ found: false, reason: 'spawn-error' }));
  });
}

// A failed CLI probe is the "agent launch failed" signal — count it by
// coarse category only (never the command or path involved).
const PROBE_FAILURE_CATEGORIES = {
  'not-found': 'agent_cli_not_found',
  timeout: 'agent_cli_timeout',
  'spawn-error': 'agent_spawn_error'
};

function trackProbeFailure(reason) {
  const category = PROBE_FAILURE_CATEGORIES[reason];
  if (category) telemetry.track('error_occurred', { category });
}

/**
 * Setup IPC handlers
 */
function setupIPC() {
  ipcMain.removeHandler(IPC.GET_AI_TOOL_CONFIG);
  ipcMain.handle(IPC.GET_AI_TOOL_CONFIG, () => {
    return getConfig();
  });

  ipcMain.removeHandler(IPC.SET_AI_TOOL);
  ipcMain.handle(IPC.SET_AI_TOOL, (event, toolId) => {
    return setActiveTool(toolId);
  });

  ipcMain.removeHandler(IPC.GET_LAUNCH_COMMAND);
  ipcMain.handle(IPC.GET_LAUNCH_COMMAND, (event, payload = {}) => {
    const { projectPath = null, toolId = null, launchFlags = null } = payload;
    return getLaunchCommand(projectPath, toolId, launchFlags);
  });

  ipcMain.removeHandler(IPC.CHECK_AI_TOOL_AVAILABLE);
  ipcMain.handle(IPC.CHECK_AI_TOOL_AVAILABLE, async (event, payload = {}) => {
    const { toolId, projectPath, launchFlags = null } = payload;
    const tools = getAvailableTools();
    const tool = tools[toolId];
    if (!tool) {
      return { available: false, resolvedCommand: null, name: toolId || null };
    }

    // Availability is probed on the bare command; the flags only ever reach
    // the composed line the lane types.
    // bareCommand is the same launch without the flags — the caller retries
    // with it when a flagged launch never comes up, since flag support
    // cannot be probed from out here.
    const ok = (command, name) => ({
      available: true,
      resolvedCommand: composeLaunchCommand(command, launchFlags),
      bareCommand: command,
      name
    });

    // The dispatch types what a launch types: the project's wrapper where one
    // exists, the tool's own command otherwise. Composed here rather than
    // taken from `tool.command` so the dispatched line and `getLaunchCommand`
    // can never disagree about which of the two is running.
    const primaryCommand = wrapperLaunchCommand(projectPath, tool) || tool.command;
    const primary = await isCommandAvailable(primaryCommand, projectPath);

    // When the primary is a path-based wrapper script and the tool
    // declares a fallback, the wrapper almost always `exec`s the
    // fallback (see .frame/bin/codex). Treat the fallback as a hard
    // dependency in that case — wrapper presence alone isn't enough.
    if (primary.found && tool.fallbackCommand && isPathLike(primaryCommand)) {
      const fallback = await isCommandAvailable(tool.fallbackCommand, projectPath);
      if (fallback.found) {
        return ok(primaryCommand, tool.name);
      }
      trackProbeFailure(fallback.reason);
      return { available: false, resolvedCommand: null, name: tool.name, reason: fallback.reason };
    }

    if (primary.found) {
      return ok(primaryCommand, tool.name);
    }

    if (tool.fallbackCommand) {
      const fallback = await isCommandAvailable(tool.fallbackCommand, projectPath);
      if (fallback.found) {
        return ok(tool.fallbackCommand, tool.name);
      }
    }

    trackProbeFailure(primary.reason);
    return { available: false, resolvedCommand: null, name: tool.name, reason: primary.reason };
  });
}

/**
 * Get command for specific action
 */
function getCommand(action) {
  const tool = getActiveTool();
  return tool.commands[action] || null;
}

/**
 * Get the start command for active tool
 */
function getStartCommand() {
  return getActiveTool().command;
}

// ─── Launch-time context injection ────────────────────────────

const RUNTIME_DIR = 'runtime';

function runtimeDir(projectPath) {
  return path.join(projectPath, FRAME_DIR, RUNTIME_DIR);
}

/**
 * Runtime files are named per tool, not shared.
 *
 * The preamble differs by tool — a native reader is only pointed at Frame's
 * layers, a tool without that convention is told to read the repo's file too
 * — so one `preamble.txt` meant whichever tool launched last decided what the
 * next one read. Harmless while Frame composed every launch; not harmless now
 * that any tool can be typed by hand at any moment, with no launch to
 * rewrite the file first.
 *
 * `claude` keeps the settings name it already had (`claude-settings.json`),
 * so nothing that grew to expect that path notices the generalization.
 */
function preambleFileName(toolId) {
  return `preamble-${toolId}.txt`;
}

function settingsFileName(toolId) {
  return `${toolId}-settings.json`;
}

function runtimeRelPath(name) {
  return `${FRAME_DIR}/${RUNTIME_DIR}/${name}`;
}

/**
 * Build the preamble for this project and tool.
 *
 * `features.specDriven` is read from `.frame/config.json` at every launch and
 * never cached: the user can flip the toggle in Settings between two launches,
 * and a cached value would keep injecting the activation paragraph into a
 * project that has turned the workflow off.
 */
function buildPreamble(projectPath, toolId) {
  const config = frameStore.readConfig(projectPath).data || {};
  const specDriven = !!(config.features && config.features.specDriven);
  const projectLayer = frameStore.agentsPath(projectPath);

  return contextPreamble.compose({
    globalPath: safeGlobalPath(),
    projectLayerPath: fs.existsSync(projectLayer) ? projectLayer : '',
    nativeFiles: instructionDiscovery.get(projectPath).nativeFiles,
    toolId,
    specDriven
  });
}

function safeGlobalPath() {
  try {
    return globalLayer.agentsPath();
  } catch (_) {
    return ''; // no global layer yet — compose() returns '' and we inject nothing
  }
}

/**
 * Write only when the content differs.
 *
 * These files are regenerated on every project open as well as every launch,
 * and an unconditional write would touch mtimes — and wake the watchers that
 * hang off `.frame/` — on each one. Same reasoning, same shape as
 * `commandStaging.copyIfChanged`.
 */
function writeIfChanged(target, content, mode) {
  let existing = null;
  try { existing = fs.readFileSync(target, 'utf8'); } catch (_) { /* new file */ }
  if (existing === content) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
  if (mode) fs.chmodSync(target, mode);
  return true;
}

function writeRuntimeFile(projectPath, name, content) {
  const target = path.join(runtimeDir(projectPath), name);
  writeIfChanged(target, content);
  return target;
}

/**
 * The spec-hint hooks, as a settings file inside Frame's own footprint.
 *
 * They used to be merged into the project's tracked `.claude/settings.json`,
 * which the overlay forbids. Passing them by flag also makes them removable:
 * stop passing the flag and the hooks are gone, with nothing left behind in
 * the repo to clean up.
 */
function writeToolSettings(projectPath, tool, extraSettings) {
  let payload = templates.getSpecHintSettings();
  for (const source of extraSettings || []) {
    payload = mergeSettings(payload, readSettingsSource(source));
  }
  return writeRuntimeFile(
    projectPath,
    settingsFileName(tool.id),
    JSON.stringify(payload, null, 2) + '\n'
  );
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Deep-merge a settings payload. Objects merge key by key, arrays concatenate
 * (two hook lists are both wanted, not one instead of the other), scalars take
 * the incoming value.
 */
function mergeSettings(base, incoming) {
  if (!isPlainObject(incoming)) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    if (Array.isArray(value) && Array.isArray(out[key])) out[key] = [...out[key], ...value];
    else if (isPlainObject(value) && isPlainObject(out[key])) out[key] = mergeSettings(out[key], value);
    else out[key] = value;
  }
  return out;
}

/**
 * A `--settings` value is either a path or inline JSON — the CLI takes both,
 * so both are read here. An unreadable one merges nothing rather than failing
 * the launch: losing a payload costs the run its permissions, losing the
 * launch costs the user the session.
 */
function readSettingsSource(source) {
  if (!source) return null;
  const text = String(source).trim();
  if (text.startsWith('{')) {
    try { return JSON.parse(text); } catch (_) { return null; }
  }
  try { return JSON.parse(fs.readFileSync(text, 'utf8')); } catch (err) {
    logger.warn('aiToolManager', `settings payload at ${text} could not be merged:`, err.message);
    return null;
  }
}

/**
 * Split a dispatch's extra flags into the `--settings` payloads to merge and
 * everything else.
 *
 * The autonomous implement launch passes its permissions this way, and the
 * wrapper (or the inline composition, off-POSIX) already passes Frame's own
 * settings file. Two `--settings` on one command line means the last one wins
 * and the spec-hint hooks vanish for exactly the runs nobody is watching —
 * so the payload is merged into the file Frame writes and the duplicate pair
 * is dropped.
 */
function takeSettingsFlags(extra, settingsFlag) {
  const rest = [];
  const payloads = [];
  if (!settingsFlag) return { rest: [...extra], payloads };
  for (let i = 0; i < extra.length; i += 1) {
    if (extra[i] === settingsFlag && i + 1 < extra.length) {
      payloads.push(extra[i + 1]);
      i += 1;
      continue;
    }
    rest.push(extra[i]);
  }
  return { rest, payloads };
}

/**
 * Regenerate `.frame/bin/<id>` for a tool.
 *
 * Written for **every** tool since `terminal-context-boundary`, not only the
 * ones with no prompt flag. With `.frame/bin` first on the terminal's `PATH`,
 * a hand-typed `claude` has to find something there or the boundary is only
 * enforced for the tools Frame happened to wrap; and a dispatch that composed
 * flags itself would then inject them a second time on top of the wrapper's.
 * One path, not two guarded ones — which is why `injection` is now data the
 * wrapper reads rather than a switch between two mechanisms.
 */
function writeWrapper(projectPath, tool) {
  const target = path.join(projectPath, FRAME_DIR, FRAME_BIN_DIR, tool.id);
  const realCommand = tool.fallbackCommand || tool.command || tool.id;
  const injection = tool.injection || {};
  writeIfChanged(
    target,
    templates.getWrapperTemplate(realCommand, {
      promptFlag: injection.promptFlag || '',
      settingsFlag: injection.settingsFlag || '',
      preambleFile: runtimeRelPath(preambleFileName(tool.id)),
      settingsFile: runtimeRelPath(settingsFileName(tool.id))
    }),
    0o755
  );
  return target;
}

/**
 * Everything a launch of `tool` reads: its preamble, its settings file when it
 * declares one, and its wrapper. Returns the composed preamble so a caller
 * that still injects inline (a platform with no wrappers) can use it.
 */
function prepareLaunchAssets(projectPath, tool, extraSettings) {
  let preamble = '';
  try {
    preamble = buildPreamble(projectPath, tool.id);
  } catch (err) {
    logger.warn('aiToolManager', 'preamble composition failed (launching without it):', err.message);
  }

  let settingsPath = '';
  if (preamble) writeRuntimeFile(projectPath, preambleFileName(tool.id), preamble);
  if (tool.injection && tool.injection.settingsFlag) {
    settingsPath = writeToolSettings(projectPath, tool, extraSettings);
  }

  const wrapperPath = launchEnv.supportsWrappers() ? writeWrapper(projectPath, tool) : '';
  return { preamble, settingsPath, wrapperPath };
}

/**
 * Regenerate every configured tool's launch assets for a project.
 *
 * Called on project open, beside `gitSharing.ensureOnOpen`. Generation used to
 * happen only when Frame launched a given tool, which is exactly why a wrapper
 * written by a Frame from three months ago could still be sitting in
 * `.frame/bin/` — unreachable then, shadowing the real CLI the moment
 * `.frame/bin` joined `PATH`. Refreshing on open makes a stale wrapper
 * impossible rather than unlikely.
 *
 * Non-fatal per tool: a read-only checkout costs the user their context, never
 * their project.
 */
/**
 * The command a launch types for this tool — the wrapper wherever Frame can
 * write one, the bare CLI otherwise.
 *
 * Relative on purpose (`./.frame/bin/<id>`). A dispatch that typed the bare
 * name would resolve through `PATH` to the same wrapper, and Frame's own flags
 * would then land on top of the ones the wrapper emits; a relative path can
 * only ever mean this project's wrapper, so there is no window in which both
 * are applied.
 *
 * Falls back the moment the file is not there: the availability probe can run
 * before anything has been written, and a path that does not exist reads as
 * "CLI not installed" — a wrong and very confusing answer.
 */
function wrapperLaunchCommand(projectPath, tool) {
  if (!projectPath || !launchEnv.supportsWrappers()) return '';
  const rel = `./${FRAME_DIR}/${FRAME_BIN_DIR}/${tool.id}`;
  return fs.existsSync(path.join(projectPath, FRAME_DIR, FRAME_BIN_DIR, tool.id)) ? rel : '';
}

function bareCommandFor(tool) {
  // `command` is the wrapper path for the pre-unification wrapper tools, so
  // the fallback is the only reliable bare name for them.
  return tool.fallbackCommand || tool.command;
}

function refreshLaunchAssets(projectPath) {
  const written = [];
  if (!projectPath) return { written };
  if (!fs.existsSync(path.join(projectPath, FRAME_DIR))) return { written };

  for (const tool of Object.values(getAvailableTools())) {
    try {
      prepareLaunchAssets(projectPath, tool);
      written.push(tool.id);
    } catch (err) {
      logger.warn('aiToolManager', `launch asset refresh failed for "${tool.id}":`, err.message);
    }
  }
  return { written };
}

/**
 * The command a lane should actually type, with Frame's context attached.
 *
 * Replaces the bare `getStartCommand()` at every launch site. Composition
 * happens here, main-side, because it needs the filesystem (discovery, the
 * config flag, the global layer path) — the renderer receives a finished
 * string.
 *
 * Returns `{ command, launchFlags, resolvedCommand, injection }`.
 * `launchFlags` stays separate from `resolvedCommand` so a caller with its own
 * flags (spec.implement's autonomous mode) can compose on top.
 */
function getLaunchCommand(projectPath, toolId, extraFlags) {
  const tools = getAvailableTools();
  const tool = (toolId && tools[toolId]) || getActiveTool();
  const extra = Array.isArray(extraFlags) ? extraFlags : [];

  if (!projectPath) {
    const command = tool.command;
    return {
      command,
      launchFlags: extra,
      resolvedCommand: composeLaunchCommand(command, extra),
      injection: 'none'
    };
  }

  const declared = (tool.injection && tool.injection.type) || INJECTION_WRAPPER;
  const flags = [];
  let command = bareCommandFor(tool);
  let injection = 'none';
  let preamble = '';

  // A caller's own `--settings` is merged into the file Frame writes, not
  // passed a second time; `remaining` is what is left to append verbatim.
  const { rest: remaining, payloads } = takeSettingsFlags(
    extra,
    (tool.injection && tool.injection.settingsFlag) || ''
  );

  try {
    // Written immediately before the command is composed, so a dispatched
    // launch is never staler than a hand-typed one.
    const assets = prepareLaunchAssets(projectPath, tool, payloads);
    preamble = assets.preamble;

    const viaWrapper = wrapperLaunchCommand(projectPath, tool);
    if (viaWrapper) {
      // The wrapper emits this tool's flags from the files just written, so
      // Frame contributes none of its own here — that is what keeps the two
      // injection paths from stacking now that both exist for every tool.
      command = viaWrapper;
      injection = preamble ? INJECTION_WRAPPER : 'none';
    } else if (preamble && declared === INJECTION_FLAG) {
      // No wrapper on this platform: compose inline, exactly as before.
      flags.push(tool.injection.promptFlag, preamble);
      if (assets.settingsPath) {
        flags.push(tool.injection.settingsFlag, assets.settingsPath);
      }
      injection = INJECTION_FLAG;
    }
  } catch (err) {
    // A read-only or full disk must not cost the user their agent; drop the
    // injection and launch the bare CLI.
    logger.warn('aiToolManager', 'context injection failed (launching without it):', err.message);
    return {
      command: tool.fallbackCommand || tool.command,
      launchFlags: extra,
      resolvedCommand: composeLaunchCommand(tool.fallbackCommand || tool.command, extra),
      injection: 'none'
    };
  }

  const launchFlags = [...flags, ...remaining];
  return {
    command,
    launchFlags,
    resolvedCommand: composeLaunchCommand(command, launchFlags),
    injection
  };
}

module.exports = {
  init,
  getAvailableTools,
  getActiveTool,
  setActiveTool,
  getConfig,
  getCommand,
  getStartCommand,
  getLaunchCommand,
  refreshLaunchAssets,
  composeLaunchCommand,
  addCustomTool,
  removeCustomTool,
  AI_TOOLS
};
