/**
 * Terminal Top Bar Module (historically the tab bar)
 *
 * Persistent bar above the terminal content area. The left section is
 * single-state — identical on the Mainframe and inside a Frame: the
 * Mainframe button (highlighted when you're on it), the Active Frames
 * count, and a chip for any pinned section (e.g. a task detail) that can
 * re-open or close it from either view. The right action cluster (usage
 * bars, new frame, layout select, panels, more menu) is mode-independent
 * except the layout select, which only shows in detail.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const { Plus, Bell, CheckSquare, Home, X, Boxes, FileText, FileDiff, Bot } = require('lucide');
const { escapeHtml } = require('./htmlUtils');
const notify = require('./notify');

function lucideIcon(data, size = 18) {
  const children = data.map(([tag, attrs]) => {
    const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<${tag} ${attrStr}/>`;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0">${children}</svg>`;
}

class TerminalTabBar {
  constructor(container, manager) {
    this.container = container;
    this.manager = manager;
    this.element = null;
    this.shellMenu = null;
    this.availableShells = [];
    this.onGoHome = null;         // Callback: return to lane board
    this.onEnterFrames = null;    // Callback: enter the active Frame (detail view)
    this.onEnterLane = null;      // Callback: (terminalId) => enter a specific Frame's detail view
    this.onLaneCreated = null;    // Callback: (terminalId) => after + creates a lane
    this.onActivateSection = null; // Callback: (key) => focus an open section tab
    this.onCloseSection = null;    // Callback: (key) => close a section tab
    this._lastState = null;
    this._injectStyles();
    this._render();
    this._createShellMenu();
    this._loadAvailableShells();
    this._initTheme();
  }

  _injectStyles() {
    const styleId = 'terminal-tab-context-menu-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        .terminal-context-menu {
          position: fixed;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          box-shadow: var(--shadow-md);
          padding: 4px;
          z-index: 1000;
          display: none;
          min-width: 120px;
          animation: fadeIn 0.1s ease-out;
        }
        .terminal-context-menu.visible {
          display: block;
        }
        .terminal-context-menu-item {
          padding: 6px 12px;
          font-size: 12px;
          color: var(--text-primary);
          cursor: pointer;
          border-radius: var(--radius-sm);
          display: flex;
          align-items: center;
          gap: 8px;
          transition: background var(--transition-fast);
        }
        .terminal-context-menu-item:hover {
          background: var(--bg-hover);
        }
        .terminal-context-menu-item svg {
          opacity: 0.7;
        }
        .terminal-context-menu-item.default {
          font-weight: 500;
        }
        .terminal-context-menu-item .shell-default-badge {
          font-size: 10px;
          color: var(--text-secondary);
          margin-left: auto;
        }
        .terminal-context-menu-divider {
          height: 1px;
          background: var(--border-subtle);
          margin: 4px 0;
        }
        .shell-menu {
          min-width: 160px;
        }
        .shell-menu-header {
          padding: 6px 12px;
          font-size: 11px;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
      `;
      document.head.appendChild(style);
    }
  }

  _render() {
    this.element = document.createElement('div');
    this.element.className = 'terminal-tab-bar';
    this.element.innerHTML = `
      <div class="lane-bar-left"></div>
      <div class="terminal-tab-actions">
        <!-- Live agent chips across all projects (topbar-presence spec) -->
        <div id="presence-bar" class="presence-bar" style="display:none"></div>
        <!-- Default Agent launcher — moved from the retired sidebar Agent
             tab; IDs preserved so aiToolSelector/index.js bindings survive -->
        <div class="lane-bar-launcher">
          <select id="ai-tool-selector" class="ai-tool-select" tabindex="-1" title="Default agent">
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
          </select>
          <button id="sidebar-agent-launch" class="sidebar-agent-launch" tabindex="-1" title="Start default agent">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
              <path d="M8 5v14l11-7z"/>
            </svg>
            <span>Start</span>
          </button>
        </div>
        <div class="claude-usage-bars" title="Click to refresh">
          <div class="usage-item session">
            <span class="usage-label">Session</span>
            <div class="usage-bar-container">
              <div class="usage-bar-fill"></div>
            </div>
            <span class="usage-percent">--</span>
            <span class="usage-reset"></span>
          </div>
          <div class="usage-item weekly">
            <span class="usage-label">Weekly</span>
            <div class="usage-bar-container">
              <div class="usage-bar-fill"></div>
            </div>
            <span class="usage-percent">--</span>
            <span class="usage-reset"></span>
          </div>
        </div>
        <select class="grid-layout-select" title="Layout">
          <option value="1x1" selected>1×1</option>
          <option value="1x2">1×2</option>
          <option value="1x3">1×3</option>
          <option value="1x4">1×4</option>
          <option value="2x1">2×1</option>
          <option value="2x2">2×2</option>
          <option value="3x1">3×1</option>
          <option value="3x2">3×2</option>
          <option value="3x3">3×3</option>
        </select>
        <button class="btn-update-notify" title="Check for updates" style="display:none;position:relative;">
          ${lucideIcon(Bell)}
          <span class="update-badge"></span>
        </button>
      </div>
    `;

    this.container.appendChild(this.element);
    this._setupEventHandlers();
  }

  /**
   * Update top bar based on state
   */
  update(state) {
    this._lastState = state;

    this._renderLeftSection(state);

    // Layout selector lives in the detail view: 1×1 is the plain single
    // terminal, larger layouts split the view into assignable cells.
    const layoutSelect = this.element.querySelector('.grid-layout-select');
    layoutSelect.style.display = state.viewMode === 'detail' ? 'inline-block' : 'none';
    layoutSelect.value = state.gridLayout || '1x1';
  }

  /**
   * Render the single-state left section: the Home tab (the lane board) and,
   * once at least one Frame is open, one tab per open Frame — spread out right
   * after Home, each carrying the Frame's name. Whichever surface is on screen
   * gets the highlight (in detail view that's the active Frame). Each open
   * detail section (task or spec) appears after those as its own chip —
   * multiple can be open at once; the active one is highlighted and every chip
   * has a close button.
   */
  _renderLeftSection(state) {
    const left = this.element.querySelector('.lane-bar-left');

    const sections = state.sections || [];
    const activeKey = state.activeSectionKey || null;
    const onSection = !!activeKey;
    const onHome = state.viewMode === 'board' && !onSection;
    const onFrames = state.viewMode === 'detail' && !onSection;

    const terminals = state.terminals || [];
    const hasFrames = terminals.length > 0;

    left.innerHTML = `
      <button class="btn-lane-home ${onHome ? 'current' : ''}" title="Home (Cmd+Esc)">
        ${lucideIcon(Home, 15)}
        <span class="btn-lane-home-label">Home</span>
      </button>
      ${hasFrames ? `
        <span class="lane-bar-divider"></span>
        ${terminals.map(t => `
          <button class="btn-lane-frame ${onFrames && t.id === state.activeTerminalId ? 'current' : ''}" data-id="${escapeHtml(t.id)}" title="${escapeHtml(t.name || 'Terminal')}">
            ${lucideIcon(Boxes, 15)}
            <span class="btn-lane-frame-label">${escapeHtml(t.name || 'Terminal')}</span>
          </button>
        `).join('')}
      ` : ''}
      ${sections.length ? `
        <span class="lane-bar-divider"></span>
        ${sections.map(sec => `
          <button class="lane-bar-section ${sec.key === activeKey ? 'current' : ''}" data-key="${escapeHtml(sec.key)}" title="${escapeHtml(sec.title)}">
            ${lucideIcon(sec.type === 'spec' ? FileText : sec.type === 'diff' ? FileDiff : sec.type === 'orchestrator' ? Bot : CheckSquare, 13)}
            <span class="lane-bar-section-label">${escapeHtml(sec.title)}</span>
            <span class="lane-bar-section-close" title="Close tab">${lucideIcon(X, 12)}</span>
          </button>
        `).join('')}
      ` : ''}
    `;
  }

  _setupEventHandlers() {
    // Left section (delegated — content re-renders on every state update)
    this.element.addEventListener('click', (e) => {
      const sectionEl = e.target.closest('.lane-bar-section');
      if (e.target.closest('.lane-bar-section-close')) {
        e.stopPropagation();
        if (this.onCloseSection && sectionEl) this.onCloseSection(sectionEl.dataset.key);
        return;
      }
      if (sectionEl) {
        if (this.onActivateSection) this.onActivateSection(sectionEl.dataset.key);
        return;
      }
      if (e.target.closest('.btn-lane-home')) {
        if (this.onGoHome) this.onGoHome();
        return;
      }
      const frameEl = e.target.closest('.btn-lane-frame');
      if (frameEl) {
        if (this.onEnterLane) this.onEnterLane(frameEl.dataset.id);
        return;
      }
    });

    // Layout selector (1×1 single terminal ↔ multi-cell layouts)
    this.element.querySelector('.grid-layout-select').addEventListener('change', (e) => {
      this.manager.setGridLayout(e.target.value);
    });

    // Usage bars click to refresh
    this.element.querySelector('.claude-usage-bars').addEventListener('click', () => {
      ipcRenderer.send(IPC.REFRESH_CLAUDE_USAGE);
    });

    // Update notification button
    const updateBtn = this.element.querySelector('.btn-update-notify');
    updateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._updateInfo) {
        const { shell } = require('electron');
        shell.openExternal(this._updateInfo.releaseUrl);
      }
    });

    // Listen for update available from main process
    ipcRenderer.on(IPC.UPDATE_AVAILABLE, (event, info) => {
      this._updateInfo = info;
      updateBtn.style.display = '';
      updateBtn.title = `New version available: v${info.latestVersion}`;
    });

    // Setup usage bar IPC listener
    this._setupUsageListener();
  }

  /**
   * Setup IPC listener for Claude usage updates
   */
  _setupUsageListener() {
    ipcRenderer.on(IPC.CLAUDE_USAGE_DATA, (event, data) => {
      this._updateUsageBar(data);
    });

    // Request initial usage data
    ipcRenderer.send(IPC.LOAD_CLAUDE_USAGE);
  }

  /**
   * Update usage bar UI with new data
   */
  _updateUsageBar(data) {
    const container = this.element.querySelector('.claude-usage-bars');
    if (!container) return;

    const sessionItem = container.querySelector('.usage-item.session');
    const weeklyItem = container.querySelector('.usage-item.weekly');

    container.style.display = '';

    if (data.error) {
      // Show error state with the reason from main (e.g. "sign in via the
      // claude CLI") so the user knows what's degraded and why.
      this._updateUsageItem(sessionItem, 0, 'N/A', '');
      this._updateUsageItem(weeklyItem, 0, 'N/A', '');
      container.title = `${data.error}\nClick to refresh`;
      return;
    }

    // Update session (5-hour) bar
    const sessionUsage = data.fiveHour?.utilization || 0;
    const sessionReset = data.fiveHour?.resetsAt
      ? this._formatResetTime(data.fiveHour.resetsAt)
      : '';
    this._updateUsageItem(sessionItem, sessionUsage, `${Math.round(sessionUsage)}%`, sessionReset);

    // Update weekly (7-day) bar
    const weeklyUsage = data.sevenDay?.utilization || 0;
    const weeklyReset = data.sevenDay?.resetsAt
      ? this._formatResetTime(data.sevenDay.resetsAt)
      : '';
    this._updateUsageItem(weeklyItem, weeklyUsage, `${Math.round(weeklyUsage)}%`, weeklyReset);

    container.title = 'Click to refresh';
  }

  /**
   * Update a single usage item
   */
  _updateUsageItem(item, usage, percentText, resetText) {
    if (!item) return;

    const fill = item.querySelector('.usage-bar-fill');
    const percent = item.querySelector('.usage-percent');
    const reset = item.querySelector('.usage-reset');

    if (fill) {
      fill.style.width = `${Math.min(usage, 100)}%`;
      fill.className = 'usage-bar-fill';
      if (usage >= 80) {
        fill.classList.add('critical');
      } else if (usage >= 50) {
        fill.classList.add('warning');
      }
    }

    if (percent) {
      percent.textContent = percentText;
    }

    if (reset && resetText) {
      reset.textContent = `(${resetText})`;
    } else if (reset) {
      reset.textContent = '';
    }
  }

  /**
   * Format reset time
   */
  _formatResetTime(isoString) {
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = date - now;

      if (diffMs < 0) return 'soon';

      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 60) {
        return `${diffMins}m`;
      }

      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) {
        const remainingMins = diffMins % 60;
        return `${diffHours}h ${remainingMins}m`;
      }

      const diffDays = Math.floor(diffHours / 24);
      const remainingHours = diffHours % 24;
      return `${diffDays}d ${remainingHours}h`;
    } catch {
      return '';
    }
  }

  /**
   * Create a lane (optionally with a specific shell) and enter it.
   */
  async _createLane(shellPath = null) {
    const options = shellPath ? { shell: shellPath } : {};
    let id = null;
    try {
      id = await this.manager.createTerminal(options);
    } catch (err) {
      notify.error(`Could not create a new terminal: ${err.message || 'terminal creation failed'}`);
      return;
    }
    if (!id) {
      notify.error(`Could not create a new terminal — maximum (${this.manager.maxTerminals}) reached for this project`);
      return;
    }
    if (this.onLaneCreated) this.onLaneCreated(id);
  }

  _createShellMenu() {
    this.shellMenu = document.createElement('div');
    this.shellMenu.className = 'terminal-context-menu shell-menu';
    document.body.appendChild(this.shellMenu);

    // Hide menu on click elsewhere
    document.addEventListener('click', (e) => {
      if (!this.shellMenu.contains(e.target) && !e.target.classList.contains('btn-new-terminal')) {
        this._hideShellMenu();
      }
    });

    // Hide menu on scroll
    document.addEventListener('scroll', () => {
      this._hideShellMenu();
    }, true);
  }

  async _loadAvailableShells() {
    try {
      this.availableShells = await this.manager.getAvailableShells();
    } catch (err) {
      console.error('Failed to load available shells:', err);
      this.availableShells = [];
    }
  }

  _showShellMenu(x, y) {
    // Clear previous items
    this.shellMenu.innerHTML = '';

    // Add header
    const header = document.createElement('div');
    header.className = 'shell-menu-header';
    header.textContent = 'Select Shell';
    this.shellMenu.appendChild(header);

    // Add shell options
    if (this.availableShells.length === 0) {
      const noShells = document.createElement('div');
      noShells.className = 'terminal-context-menu-item';
      noShells.textContent = 'Loading...';
      noShells.style.opacity = '0.5';
      this.shellMenu.appendChild(noShells);

      // Try to reload shells
      this._loadAvailableShells().then(() => {
        if (this.shellMenu.classList.contains('visible')) {
          this._showShellMenu(x, y);
        }
      });
    } else {
      this.availableShells.forEach((shell, index) => {
        const item = document.createElement('div');
        item.className = 'terminal-context-menu-item';
        if (shell.isDefault) {
          item.classList.add('default');
        }

        // Shell icon based on type
        const icon = this._getShellIcon(shell.id);
        item.innerHTML = `
          ${icon}
          <span>${shell.name}</span>
          ${shell.isDefault ? '<span class="shell-default-badge">default</span>' : ''}
        `;

        item.addEventListener('click', () => {
          this._hideShellMenu();
          this._createLane(shell.path);
        });

        this.shellMenu.appendChild(item);
      });
    }

    // Position and show
    this.shellMenu.style.left = `${x}px`;
    this.shellMenu.style.top = `${y}px`;
    this.shellMenu.classList.add('visible');

    // Adjust position if out of bounds
    const rect = this.shellMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      this.shellMenu.style.left = `${window.innerWidth - rect.width - 5}px`;
    }
    if (rect.bottom > window.innerHeight) {
      this.shellMenu.style.top = `${y - rect.height}px`;
    }
  }

  _hideShellMenu() {
    if (this.shellMenu) {
      this.shellMenu.classList.remove('visible');
    }
  }

  _getShellIcon(shellId) {
    const icons = {
      'zsh': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>',
      'bash': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>',
      'fish': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"></path><path d="M8 12h8"></path></svg>',
      'nu': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>',
      'powershell': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="18" rx="2"></rect><polyline points="6 9 10 12 6 15"></polyline></svg>',
      'pwsh': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="18" rx="2"></rect><polyline points="6 9 10 12 6 15"></polyline></svg>',
      'cmd': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="18" rx="2"></rect><line x1="6" y1="12" x2="18" y2="12"></line></svg>',
      'gitbash': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>',
      'wsl': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>',
      'sh': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>'
    };
    return icons[shellId] || icons['sh'];
  }

  /**
   * Restore the saved theme at boot.
   *
   * The *toggle* now lives in the instrument rail, but the restore stays
   * here because this runs during tab-bar construction — moving it to the
   * rail's later init would flash the default theme first. Setting the
   * attribute is the whole contract: terminalManager observes it and the
   * rail reads it when it renders.
   */
  _initTheme() {
    const saved = localStorage.getItem('frame-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
  }

}

module.exports = { TerminalTabBar };
