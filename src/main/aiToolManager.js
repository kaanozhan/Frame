/**
 * AI Tool Manager
 * Manages switching between different AI coding tools (Claude Code, Codex CLI, etc.)
 */

const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
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
 * Load configuration from file
 */
function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      const loaded = JSON.parse(data);
      config = { ...config, ...loaded };
    }
  } catch (error) {
    console.error('Error loading AI tool config:', error);
  }
}

/**
 * Save configuration to file
 */
function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
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
 */
async function isCommandAvailable(command, projectPath) {
  if (!command) return false;

  // Path-based command: check the binary actually exists & is executable.
  if (isPathLike(command)) {
    const target = command.startsWith('/')
      ? command
      : (projectPath ? path.resolve(projectPath, command) : command);
    try {
      fs.accessSync(target, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  // PATH-based command: probe via the user's login shell so PATH
  // additions from .zshrc/.bashrc and shim managers (asdf, nvm, brew)
  // are visible — same reason we run the PTY shell with -l.
  const isWin = process.platform === 'win32';
  const shell = isWin
    ? (process.env.COMSPEC || 'cmd.exe')
    : (process.env.SHELL || '/bin/sh');
  const args = isWin
    ? ['/c', `where ${command}`]
    : ['-lc', `command -v ${command}`];

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    let child;
    try {
      child = spawn(shell, args, { stdio: 'ignore' });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch {}
      finish(false);
    }, 3000);
    child.on('exit', (code) => finish(code === 0));
    child.on('error', () => finish(false));
  });
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
    const { toolId, projectPath } = payload;
    const tools = getAvailableTools();
    const tool = tools[toolId];
    if (!tool) {
      return { available: false, resolvedCommand: null, name: toolId || null };
    }

    const primaryOk = await isCommandAvailable(tool.command, projectPath);

    // When the primary is a path-based wrapper script and the tool
    // declares a fallback, the wrapper almost always `exec`s the
    // fallback (see .frame/bin/codex). Treat the fallback as a hard
    // dependency in that case — wrapper presence alone isn't enough.
    if (primaryOk && tool.fallbackCommand && isPathLike(tool.command)) {
      const fallbackOk = await isCommandAvailable(tool.fallbackCommand, projectPath);
      if (fallbackOk) {
        return { available: true, resolvedCommand: tool.command, name: tool.name };
      }
      return { available: false, resolvedCommand: null, name: tool.name };
    }

    if (primaryOk) {
      return { available: true, resolvedCommand: tool.command, name: tool.name };
    }

    if (tool.fallbackCommand && await isCommandAvailable(tool.fallbackCommand, projectPath)) {
      return { available: true, resolvedCommand: tool.fallbackCommand, name: tool.name };
    }

    return { available: false, resolvedCommand: null, name: tool.name };
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
  addCustomTool,
  removeCustomTool,
  AI_TOOLS
};
