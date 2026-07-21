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

let mainWindow = null;
let configPath = null;

// Default AI tools configuration
const AI_TOOLS = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    description: 'Anthropic Claude Code CLI',
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
    description: 'OpenAI Codex CLI (with AGENTS.md injection)',
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
    command: 'gemini',
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
    const ok = (command, name) => ({
      available: true, resolvedCommand: composeLaunchCommand(command, launchFlags), name
    });

    const primary = await isCommandAvailable(tool.command, projectPath);

    // When the primary is a path-based wrapper script and the tool
    // declares a fallback, the wrapper almost always `exec`s the
    // fallback (see .frame/bin/codex). Treat the fallback as a hard
    // dependency in that case — wrapper presence alone isn't enough.
    if (primary.found && tool.fallbackCommand && isPathLike(tool.command)) {
      const fallback = await isCommandAvailable(tool.fallbackCommand, projectPath);
      if (fallback.found) {
        return ok(tool.command, tool.name);
      }
      trackProbeFailure(fallback.reason);
      return { available: false, resolvedCommand: null, name: tool.name, reason: fallback.reason };
    }

    if (primary.found) {
      return ok(tool.command, tool.name);
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

module.exports = {
  init,
  getAvailableTools,
  getActiveTool,
  setActiveTool,
  getConfig,
  getCommand,
  getStartCommand,
  composeLaunchCommand,
  addCustomTool,
  removeCustomTool,
  AI_TOOLS
};
