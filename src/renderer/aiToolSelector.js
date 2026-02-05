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
 * Get the start command for current tool
 */
function getStartCommand() {
  return currentTool ? currentTool.command : 'claude';
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
  getStartCommand,
  getCommand,
  supportsFeature
};
