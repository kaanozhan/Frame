/**
 * Plugins Panel Module
 *
 * UI for browsing and toggling Claude Code plugins. A modal
 * (`#plugins-modal`, the shared `.modal-overlay` chrome) opened from the
 * Plugins button at the foot of the sidebar rail, just above Feedback — it
 * is about Claude, not about the project on screen, so it has no place
 * beside the terminals. This module owns the modal and `#plugins-panel`
 * inside it — the filter row and the list — and its data. It used to share
 * the center-hosted Claude panel with Sessions; Sessions is a Context row of
 * its own now (sessionsPanel.js).
 *
 * Opened by `show()` / `toggle()`, closed by its ×, the backdrop, Escape, or
 * `hide()`; Escape is gated on visibility so it never leaks to the terminal
 * (the feedbackPanel idiom). Installing a plugin hides the modal so the user
 * lands on the terminal that is running the install.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const { escapeHtml } = require('./htmlUtils');
const notify = require('./notify');

let isVisible = false;
let pluginsData = [];
let marketplaceInfo = null;
let currentFilter = 'all'; // all, installed, enabled

// DOM Elements
let modalElement = null;
let panelElement = null;
let contentElement = null;

/**
 * Initialize plugins panel
 */
function init() {
  modalElement = document.getElementById('plugins-modal');
  panelElement = document.getElementById('plugins-panel');
  contentElement = document.getElementById('plugins-content');

  if (!modalElement || !panelElement) {
    // A control that fails to bind must say so — the rail button would just
    // look like one that does nothing.
    console.error('pluginsPanel: #plugins-modal not found — Plugins will not open');
    return;
  }

  setupEventListeners();
  setupIPCListeners();
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // The modal's chrome: ×, backdrop, Escape (gated on visibility).
  const closeBtn = document.getElementById('plugins-modal-close');
  if (closeBtn) closeBtn.addEventListener('click', hide);

  modalElement.addEventListener('click', (e) => {
    if (e.target === modalElement) hide();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isVisible) hide();
  });

  // Refresh button
  const refreshBtn = document.getElementById('plugins-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', refreshPlugins);
  }

  // Filter buttons
  document.querySelectorAll('.plugins-filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const filter = e.target.dataset.filter;
      setFilter(filter);
    });
  });
}

/**
 * Setup IPC listeners
 */
function setupIPCListeners() {
  ipcRenderer.on(IPC.PLUGIN_TOGGLED, (event, result) => {
    if (result.success) {
      // Update local data
      const plugin = pluginsData.find(p => p.id === result.pluginId);
      if (plugin) {
        plugin.enabled = result.enabled;
        render();
      }
      notify.info(
        result.enabled ? 'Plugin enabled - restart Claude Code to apply' : 'Plugin disabled - restart Claude Code to apply'
      );
    }
  });

  ipcRenderer.on(IPC.TOGGLE_PLUGINS_PANEL, () => {
    toggle();
  });
}

/**
 * Load plugins
 */
async function loadPlugins() {
  try {
    const result = await ipcRenderer.invoke(IPC.LOAD_PLUGINS);
    // Main returns { plugins, marketplace }; tolerate the legacy plain array
    pluginsData = Array.isArray(result) ? result : (result.plugins || []);
    marketplaceInfo = Array.isArray(result) ? null : result.marketplace;
    render();
  } catch (err) {
    console.error('Error loading plugins:', err);
    pluginsData = [];
    marketplaceInfo = null;
    render();
  }
}

/**
 * Refresh plugins from marketplace
 */
async function refreshPlugins() {
  const refreshBtn = document.getElementById('plugins-refresh-btn');

  try {
    // Add spinning animation
    if (refreshBtn) {
      refreshBtn.classList.add('spinning');
      refreshBtn.disabled = true;
    }

    const result = await ipcRenderer.invoke(IPC.REFRESH_PLUGINS);

    if (result.error) {
      notify.error('Failed to refresh: ' + result.error);
    } else {
      pluginsData = Array.isArray(result) ? result : (result.plugins || []);
      marketplaceInfo = Array.isArray(result) ? null : result.marketplace;
      render();
      notify.success('Plugins refreshed');
    }
  } catch (err) {
    console.error('Error refreshing plugins:', err);
    notify.error('Failed to refresh plugins');
  } finally {
    // Remove spinning animation
    if (refreshBtn) {
      refreshBtn.classList.remove('spinning');
      refreshBtn.disabled = false;
    }
  }
}

/**
 * Open the modal and load the list.
 */
function show() {
  if (!modalElement) return;
  modalElement.classList.add('visible');
  isVisible = true;
  loadPlugins();
}

/**
 * Close the modal.
 */
function hide() {
  if (!modalElement) return;
  modalElement.classList.remove('visible');
  isVisible = false;
}

function toggle() {
  if (isVisible) hide();
  else show();
}

/**
 * Set filter
 */
function setFilter(filter) {
  currentFilter = filter;

  // Update active button
  document.querySelectorAll('.plugins-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });

  render();
}

/**
 * Get filtered plugins
 */
function getFilteredPlugins() {
  if (!pluginsData || pluginsData.length === 0) return [];

  switch (currentFilter) {
    case 'installed':
      return pluginsData.filter(p => p.installed);
    case 'enabled':
      return pluginsData.filter(p => p.enabled);
    default:
      return pluginsData;
  }
}

/**
 * Render plugins list
 */
function render() {
  if (!contentElement) return;

  const plugins = getFilteredPlugins();

  if (plugins.length === 0) {
    // An unavailable marketplace explains itself — never a bare empty state
    const reasonMessages = {
      'git-missing': 'Marketplace needs git — install git, then refresh',
      'network': 'Could not reach the plugin marketplace — check your connection, then refresh',
      'other': 'Marketplace could not be loaded — check the logs, then refresh'
    };
    const marketplaceDown = marketplaceInfo && marketplaceInfo.available === false;
    const emptyHint = marketplaceDown
      ? reasonMessages[marketplaceInfo.reason] || reasonMessages.other
      : (currentFilter === 'all' ? 'Claude Code plugins will appear here' : `No ${currentFilter} plugins`);
    contentElement.innerHTML = `
      <div class="plugins-empty">
        <div class="plugins-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
          </svg>
        </div>
        <p>No plugins found</p>
        <span>${emptyHint}</span>
      </div>
    `;
    return;
  }

  contentElement.innerHTML = plugins.map(plugin => renderPluginItem(plugin)).join('');

  // Add event listeners to toggle buttons
  contentElement.querySelectorAll('.plugin-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const pluginId = btn.dataset.pluginId;
      await togglePlugin(pluginId);
    });
  });

  // Add event listeners to install buttons
  contentElement.querySelectorAll('.plugin-install-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      installPlugin(btn.dataset.pluginId, btn.dataset.pluginName);
    });
  });
}

/**
 * Render single plugin item
 */
function renderPluginItem(plugin) {
  const statusClass = plugin.enabled ? 'enabled' : plugin.installed ? 'installed' : 'available';
  const statusLabel = plugin.enabled ? 'Enabled' : plugin.installed ? 'Installed' : 'Available';

  // Icon based on plugin type/name
  const icon = getPluginIcon(plugin.name);

  return `
    <div class="plugin-item ${statusClass}" data-plugin-id="${plugin.id}">
      <div class="plugin-icon">
        ${icon}
      </div>
      <div class="plugin-content">
        <div class="plugin-header">
          <span class="plugin-name">${escapeHtml(plugin.name)}</span>
          <span class="plugin-status status-${statusClass}">${statusLabel}</span>
        </div>
        <div class="plugin-description">${escapeHtml(plugin.description)}</div>
        <div class="plugin-meta">
          <span class="plugin-author">by ${escapeHtml(plugin.author)}</span>
        </div>
      </div>
      <div class="plugin-actions">
        ${plugin.installed ? `
          <button class="plugin-toggle-btn ${plugin.enabled ? 'enabled' : ''}"
                  data-plugin-id="${plugin.id}"
                  title="${plugin.enabled ? 'Disable' : 'Enable'}">
            <div class="toggle-track">
              <div class="toggle-thumb"></div>
            </div>
          </button>
        ` : `
          <button class="plugin-install-btn"
                  data-plugin-id="${plugin.id}"
                  data-plugin-name="${plugin.name}"
                  title="Install plugin">
            Install
          </button>
        `}
      </div>
    </div>
  `;
}

/**
 * Get icon for plugin based on name
 */
function getPluginIcon(name) {
  // Return different icons based on plugin category
  if (name.includes('lsp') || name.includes('typescript') || name.includes('python')) {
    // Language/LSP icon
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
    </svg>`;
  }

  if (name.includes('commit') || name.includes('pr') || name.includes('review')) {
    // Git icon
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>
    </svg>`;
  }

  if (name.includes('security')) {
    // Security icon
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>`;
  }

  if (name.includes('frontend') || name.includes('design')) {
    // Design icon
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>
    </svg>`;
  }

  // Default plugin icon
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
  </svg>`;
}

/**
 * Toggle plugin enabled/disabled
 */
async function togglePlugin(pluginId) {
  try {
    await ipcRenderer.invoke(IPC.TOGGLE_PLUGIN, pluginId);
  } catch (err) {
    console.error('Error toggling plugin:', err);
    notify.error('Failed to toggle plugin');
  }
}

/**
 * Install plugin via terminal command
 */
function installPlugin(pluginId, pluginName) {
  // The id is `<marketplace dir>@<marketplace>` — what `/plugin install`
  // needs. The display name can differ from the dir and has no marketplace (#3).
  const command = `/plugin install ${pluginId}`;

  // Send command to terminal
  if (typeof window.terminalSendCommand === 'function') {
    window.terminalSendCommand(command);
    notify.info(`Installing ${pluginName}...`);
    // Hide panel so user can see terminal
    hide();
  } else {
    notify.error('Terminal not available');
  }
}

module.exports = {
  init,
  show,
  hide,
  toggle,
  loadPlugins,
  isVisible: () => isVisible
};
