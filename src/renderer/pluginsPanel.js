/**
 * Plugins Panel Module
 * UI for displaying and managing Claude Code plugins
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

let isVisible = false;
let pluginsData = [];
let currentFilter = 'all'; // all, installed, enabled
let currentTab = 'plugins';

// DOM Elements
let panelElement = null;
let contentElement = null;

/**
 * Initialize plugins panel
 */
function init() {
  panelElement = document.getElementById('plugins-panel');
  contentElement = document.getElementById('plugins-content');

  if (!panelElement) {
    console.error('Plugins panel element not found');
    return;
  }

  setupEventListeners();
  setupIPCListeners();
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Close button
  const closeBtn = document.getElementById('plugins-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', hide);
  }

  // Collapse button
  const collapseBtn = document.getElementById('plugins-collapse-btn');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', hide);
  }

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

  // Tab buttons
  document.querySelectorAll('.claude-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tab = e.target.dataset.tab;
      setTab(tab);
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
      showToast(
        result.enabled ? 'Plugin enabled - restart Claude Code to apply' : 'Plugin disabled - restart Claude Code to apply',
        'info'
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
    pluginsData = await ipcRenderer.invoke(IPC.LOAD_PLUGINS);
    render();
  } catch (err) {
    console.error('Error loading plugins:', err);
    pluginsData = [];
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
      showToast('Failed to refresh: ' + result.error, 'error');
    } else {
      pluginsData = result;
      render();
      showToast('Plugins refreshed', 'success');
    }
  } catch (err) {
    console.error('Error refreshing plugins:', err);
    showToast('Failed to refresh plugins', 'error');
  } finally {
    // Remove spinning animation
    if (refreshBtn) {
      refreshBtn.classList.remove('spinning');
      refreshBtn.disabled = false;
    }
  }
}

/**
 * Show plugins panel
 */
function show() {
  if (panelElement) {
    panelElement.classList.add('visible');
    isVisible = true;
    loadPlugins();
  }
}

/**
 * Hide plugins panel
 */
function hide() {
  if (panelElement) {
    panelElement.classList.remove('visible');
    isVisible = false;
  }
}

/**
 * Toggle plugins panel visibility
 */
function toggle() {
  if (isVisible) {
    hide();
  } else {
    show();
  }
}

/**
 * Set active tab
 */
function setTab(tab) {
  currentTab = tab;

  // Update active tab button
  document.querySelectorAll('.claude-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Show/hide tab content
  document.querySelectorAll('[data-tab-content]').forEach(el => {
    el.style.display = el.dataset.tabContent === tab ? '' : 'none';
  });
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
    contentElement.innerHTML = `
      <div class="plugins-empty">
        <div class="plugins-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
          </svg>
        </div>
        <p>No plugins found</p>
        <span>${currentFilter === 'all' ? 'Claude Code plugins will appear here' : `No ${currentFilter} plugins`}</span>
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
      const pluginName = btn.dataset.pluginName;
      installPlugin(pluginName);
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
    showToast('Failed to toggle plugin', 'error');
  }
}

/**
 * Install plugin via terminal command
 */
function installPlugin(pluginName) {
  const command = `claude plugin install ${pluginName}`;

  // Send command to terminal
  if (typeof window.terminalSendCommand === 'function') {
    window.terminalSendCommand(command);
    showToast(`Installing ${pluginName}...`, 'info');
    // Hide panel so user can see terminal
    hide();
  } else {
    showToast('Terminal not available', 'error');
  }
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
  // Remove existing toast
  const existingToast = document.querySelector('.plugins-toast');
  if (existingToast) {
    existingToast.remove();
  }

  // Create toast element
  const toast = document.createElement('div');
  toast.className = `plugins-toast plugins-toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${getToastIcon(type)}</span>
    <span class="toast-message">${message}</span>
  `;

  // Add to panel
  if (panelElement) {
    panelElement.appendChild(toast);
  }

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  // Remove after delay
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

/**
 * Get toast icon based on type
 */
function getToastIcon(type) {
  switch (type) {
    case 'success':
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
    case 'error':
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    default:
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  }
}

/**
 * Escape HTML for safe rendering
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

module.exports = {
  init,
  show,
  hide,
  toggle,
  loadPlugins,
  isVisible: () => isVisible
};
