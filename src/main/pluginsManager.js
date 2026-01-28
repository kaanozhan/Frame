/**
 * Plugins Manager Module
 * Handles Claude Code plugins - reading marketplace, installed, and enabled status
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { IPC } = require('../shared/ipcChannels');

let mainWindow = null;

// Claude Code paths
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PLUGINS_DIR = path.join(CLAUDE_DIR, 'plugins');
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');
const INSTALLED_PLUGINS_FILE = path.join(PLUGINS_DIR, 'installed_plugins.json');
const MARKETPLACES_DIR = path.join(PLUGINS_DIR, 'marketplaces');

/**
 * Initialize plugins manager
 */
function init(window) {
  mainWindow = window;
}

/**
 * Read JSON file safely
 */
function readJsonFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
  }
  return null;
}

/**
 * Write JSON file safely
 */
function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err);
    return false;
  }
}

/**
 * Get enabled plugins from settings
 */
function getEnabledPlugins() {
  const settings = readJsonFile(SETTINGS_FILE);
  return settings?.enabledPlugins || {};
}

/**
 * Get installed plugins
 */
function getInstalledPlugins() {
  const data = readJsonFile(INSTALLED_PLUGINS_FILE);
  return data?.plugins || {};
}

/**
 * Get all available plugins from marketplace
 */
function getMarketplacePlugins() {
  const plugins = [];
  const officialMarketplace = path.join(MARKETPLACES_DIR, 'claude-plugins-official', 'plugins');

  if (!fs.existsSync(officialMarketplace)) {
    return plugins;
  }

  try {
    const pluginDirs = fs.readdirSync(officialMarketplace);

    for (const pluginName of pluginDirs) {
      const pluginPath = path.join(officialMarketplace, pluginName);
      const configPath = path.join(pluginPath, '.claude-plugin', 'plugin.json');

      if (fs.existsSync(configPath)) {
        const config = readJsonFile(configPath);
        if (config) {
          plugins.push({
            id: `${pluginName}@claude-plugins-official`,
            name: config.name || pluginName,
            description: config.description || '',
            author: config.author?.name || 'Unknown',
            path: pluginPath
          });
        }
      }
    }
  } catch (err) {
    console.error('Error reading marketplace plugins:', err);
  }

  return plugins;
}

/**
 * Get all plugins with their status
 */
function getAllPlugins() {
  const marketplacePlugins = getMarketplacePlugins();
  const installedPlugins = getInstalledPlugins();
  const enabledPlugins = getEnabledPlugins();

  return marketplacePlugins.map(plugin => {
    const isInstalled = !!installedPlugins[plugin.id];
    const isEnabled = enabledPlugins[plugin.id] === true;
    const installInfo = installedPlugins[plugin.id]?.[0];

    return {
      ...plugin,
      installed: isInstalled,
      enabled: isEnabled,
      installedAt: installInfo?.installedAt || null
    };
  });
}

/**
 * Toggle plugin enabled/disabled status
 */
function togglePlugin(pluginId) {
  const settings = readJsonFile(SETTINGS_FILE) || {};

  if (!settings.enabledPlugins) {
    settings.enabledPlugins = {};
  }

  // Toggle the status
  const currentStatus = settings.enabledPlugins[pluginId] === true;
  settings.enabledPlugins[pluginId] = !currentStatus;

  const success = writeJsonFile(SETTINGS_FILE, settings);

  return {
    success,
    pluginId,
    enabled: !currentStatus
  };
}

/**
 * Refresh marketplace plugins (git pull)
 */
function refreshMarketplace() {
  const officialMarketplace = path.join(MARKETPLACES_DIR, 'claude-plugins-official');

  if (!fs.existsSync(officialMarketplace)) {
    console.log('Marketplace not found, attempting to clone...');
    try {
      // Ensure marketplaces directory exists
      if (!fs.existsSync(MARKETPLACES_DIR)) {
        fs.mkdirSync(MARKETPLACES_DIR, { recursive: true });
      }

      // Clone the repository
      execSync('git clone https://github.com/anthropics/claude-plugins-official.git', {
        cwd: MARKETPLACES_DIR,
        stdio: 'pipe',
        timeout: 60000
      });
      
      return { success: true };
    } catch (err) {
      console.error('Error cloning marketplace:', err);
      return { success: false, error: 'Failed to clone marketplace: ' + err.message };
    }
  }

  try {
    execSync('git pull', {
      cwd: officialMarketplace,
      stdio: 'pipe',
      timeout: 30000
    });
    return { success: true };
  } catch (err) {
    console.error('Error refreshing marketplace:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Setup IPC handlers
 */
function setupIPC(ipcMain) {
  // Load all plugins
  ipcMain.handle(IPC.LOAD_PLUGINS, async () => {
    return getAllPlugins();
  });

  // Toggle plugin
  ipcMain.handle(IPC.TOGGLE_PLUGIN, async (event, pluginId) => {
    const result = togglePlugin(pluginId);

    // Notify renderer of the change
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.PLUGIN_TOGGLED, result);
    }

    return result;
  });

  // Refresh plugins marketplace
  ipcMain.handle(IPC.REFRESH_PLUGINS, async () => {
    const result = refreshMarketplace();
    if (result.success) {
      return getAllPlugins();
    }
    return { error: result.error };
  });
}

module.exports = {
  init,
  setupIPC,
  getAllPlugins,
  togglePlugin
};
