/**
 * AI Tool Selector Module
 * Manages UI for switching between AI coding tools (Claude Code, Codex CLI, etc.)
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

let currentTool = null;
let availableTools = {};
let onToolChangeCallback = null;

/**
 * Initialize the AI tool selector
 */
async function init(onToolChange) {
  onToolChangeCallback = onToolChange;

  // Get initial config
  const config = await ipcRenderer.invoke(IPC.GET_AI_TOOL_CONFIG);
  currentTool = config.activeTool;
  availableTools = config.availableTools;

  // Setup UI
  setupSelector();
  updateUI();

  // Listen for tool changes from main process
  ipcRenderer.on(IPC.AI_TOOL_CHANGED, (event, tool) => {
    currentTool = tool;
    updateUI();
    if (onToolChangeCallback) {
      onToolChangeCallback(tool);
    }
  });
}

/**
 * Setup the selector dropdown
 */
function setupSelector() {
  const selector = document.getElementById('ai-tool-selector');
  if (!selector) return;

  // Populate options
  selector.innerHTML = '';
  Object.values(availableTools).forEach(tool => {
    const option = document.createElement('option');
    option.value = tool.id;
    option.textContent = tool.name.replace(' Code', '').replace(' CLI', '');
    selector.appendChild(option);
  });

  // Set current value
  if (currentTool) {
    selector.value = currentTool.id;
  }

  // Handle change
  selector.addEventListener('change', async (e) => {
    const toolId = e.target.value;
    const success = await ipcRenderer.invoke(IPC.SET_AI_TOOL, toolId);
    if (!success) {
      // Revert to previous value
      selector.value = currentTool.id;
    }
  });
}

/**
 * Update UI to reflect current tool
 */
function updateUI() {
  if (!currentTool) return;

  // Update selector
  const selector = document.getElementById('ai-tool-selector');
  if (selector) {
    selector.value = currentTool.id;
  }

  // Update start button text
  const startBtn = document.getElementById('btn-start-ai');
  if (startBtn) {
    startBtn.textContent = `Start ${currentTool.name}`;
  }

  // Show/hide plugins panel based on tool support
  const pluginsPanel = document.getElementById('plugins-panel');
  if (pluginsPanel && !currentTool.supportsPlugins) {
    // Could hide or show a message - for now just leave it
  }
}

/**
 * Get the current active tool
 */
function getCurrentTool() {
  return currentTool;
}

/**
 * Get all available AI tools (keyed by id).
 */
function getAvailableTools() {
  return availableTools;
}

/**
 * Get the start command for current tool.
 *
 * The bare CLI, with no Frame context attached. Kept for the places that only
 * need to know *what* would run; anything that actually launches a session
 * uses `getLaunchCommand` below, or the agent starts with no idea Frame exists.
 */
function getStartCommand() {
  return currentTool ? currentTool.command : 'claude';
}

/**
 * The command to actually type into a lane: the CLI plus Frame's launch
 * context, composed in the main process (it needs the filesystem — discovery,
 * the project's spec-driven flag, the global layer's path).
 *
 * Falls back to the bare command if the main process cannot compose one, so a
 * failure here costs the context, never the session.
 *
 * @param {string} projectPath
 * @param {string[]} [launchFlags] - extra flags this particular run needs
 * @returns {Promise<string>}
 */
async function getLaunchCommand(projectPath, launchFlags) {
  const fallback = getStartCommand();
  try {
    const result = await ipcRenderer.invoke(IPC.GET_LAUNCH_COMMAND, {
      projectPath,
      toolId: currentTool ? currentTool.id : null,
      launchFlags: launchFlags || null
    });
    return (result && result.resolvedCommand) || fallback;
  } catch (err) {
    console.error('aiToolSelector: launch command composition failed', err);
    return fallback;
  }
}

/**
 * Get a specific command for current tool
 */
function getCommand(action) {
  if (!currentTool || !currentTool.commands) return null;
  return currentTool.commands[action] || null;
}

/**
 * Check if current tool supports a feature
 */
function supportsFeature(feature) {
  if (!currentTool) return false;

  switch (feature) {
    case 'plugins':
      return currentTool.supportsPlugins;
    case 'init':
      return !!currentTool.commands.init;
    case 'commit':
      return !!currentTool.commands.commit;
    default:
      return false;
  }
}

module.exports = {
  init,
  getCurrentTool,
  getAvailableTools,
  getStartCommand,
  getLaunchCommand,
  getCommand,
  supportsFeature
};
