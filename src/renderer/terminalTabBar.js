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
const tasksDashboard = require('./tasksDashboard');
const pluginsPanel = require('./pluginsPanel');
const githubPanel = require('./githubPanel');
const promptsPanel = require('./promptsPanel');
const specsDashboard = require('./specsDashboard');
const { Plus, MoreHorizontal, Bell, CheckSquare, Home, X, Boxes, FileText, FileDiff, Bot } = require('lucide');

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
    this.moreMenu = null;
    this.availableShells = [];
    this.onOverviewToggle = null; // Callback for overview toggle
    this.onGoHome = null;         // Callback: return to lane board
    this.onEnterFrames = null;    // Callback: enter the active Frame (detail view)
    this.onLaneCreated = null;    // Callback: (terminalId) => after + creates a lane
    this.onActivateSection = null; // Callback: (key) => focus an open section tab
    this.onCloseSection = null;    // Callback: (key) => close a section tab
    this._lastState = null;
    this._injectStyles();
    this._render();
    this._createShellMenu();
    this._createMoreMenu();
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
        .more-menu {
          min-width: 160px;
        }
        .more-menu-item {
          padding: 7px 12px;
          font-size: 12px;
          color: var(--text-primary);
          cursor: pointer;
          border-radius: var(--radius-sm);
          display: flex;
          align-items: center;
          gap: 8px;
          transition: background var(--transition-fast);
          font-weight: 500;
        }
        .more-menu-item:hover {
          background: var(--bg-hover);
        }
        .more-menu-item svg {
          opacity: 0.7;
          flex-shrink: 0;
        }
        .more-menu-item.active {
          color: var(--accent-primary);
        }
        .more-menu-item.active svg {
          opacity: 1;
        }
        .more-menu-divider {
          height: 1px;
          background: var(--border-subtle);
          margin: 4px 0;
        }
        .btn-more-toggle {
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .btn-more-toggle.active {
          color: var(--accent-primary) !important;
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
        <button class="btn-more-toggle" title="More panels">
          ${lucideIcon(MoreHorizontal)}
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
   * once at least one Frame is open, a Frames tab carrying the Active Frames
   * count — always inserted right after Home. Whichever surface is on screen
   * gets the highlight. Each open detail section (task or spec) appears after
   * those as its own chip — multiple can be open at once; the active one is
   * highlighted and every chip has a close button.
   */
  _renderLeftSection(state) {
    const left = this.element.querySelector('.lane-bar-left');

    const sections = state.sections || [];
    const activeKey = state.activeSectionKey || null;
    const onSection = !!activeKey;
    const onHome = state.viewMode === 'board' && !onSection;
    const onFrames = state.viewMode !== 'board' && !onSection;

    const count = state.terminals.length;
    const hasFrames = count > 0;

    left.innerHTML = `
      <button class="btn-lane-home ${onHome ? 'current' : ''}" title="Home (Cmd+Esc)">
        ${lucideIcon(Home, 15)}
        <span class="btn-lane-home-label">Home</span>
      </button>
      ${hasFrames ? `
        <span class="lane-bar-divider"></span>
        <button class="btn-lane-frames ${onFrames ? 'current' : ''}" title="Frames">
          ${lucideIcon(Boxes, 15)}
          <span class="btn-lane-frames-label">Frames</span>
          <span class="lane-bar-count" title="Active Frames">${count}</span>
        </button>
      ` : ''}
      ${sections.length ? `
        <span class="lane-bar-divider"></span>
        ${sections.map(sec => `
          <button class="lane-bar-section ${sec.key === activeKey ? 'current' : ''}" data-key="${this._escapeHtml(sec.key)}" title="${this._escapeHtml(sec.title)}">
            ${lucideIcon(sec.type === 'spec' ? FileText : sec.type === 'diff' ? FileDiff : sec.type === 'orchestrator' ? Bot : CheckSquare, 13)}
            <span class="lane-bar-section-label">${this._escapeHtml(sec.title)}</span>
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
      if (e.target.closest('.btn-lane-frames')) {
        if (this.onEnterFrames) this.onEnterFrames();
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

    // More menu toggle button
    const moreBtn = this.element.querySelector('.btn-more-toggle');
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.moreMenu.classList.contains('visible')) {
        this._hideMoreMenu();
      } else {
        moreBtn.classList.add('active');
        const rect = moreBtn.getBoundingClientRect();
        this._showMoreMenu(rect.right, rect.bottom + 4);
        // Reposition to align right edge
        requestAnimationFrame(() => {
          const menuRect = this.moreMenu.getBoundingClientRect();
          this.moreMenu.style.left = `${rect.right - menuRect.width}px`;
        });
      }
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

    if (data.error) {
      // Show error state
      this._updateUsageItem(sessionItem, 0, 'N/A', '');
      this._updateUsageItem(weeklyItem, 0, 'N/A', '');
      container.title = `Error: ${data.error}\nClick to refresh`;
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

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Create a lane (optionally with a specific shell) and enter it.
   */
  async _createLane(shellPath = null) {
    const options = shellPath ? { shell: shellPath } : {};
    const id = await this.manager.createTerminal(options);
    if (id && this.onLaneCreated) this.onLaneCreated(id);
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

  _createMoreMenu() {
    this.moreMenu = document.createElement('div');
    this.moreMenu.className = 'terminal-context-menu more-menu';
    document.body.appendChild(this.moreMenu);

    document.addEventListener('click', (e) => {
      if (!this.moreMenu.contains(e.target) && !e.target.closest('.btn-more-toggle')) {
        this._hideMoreMenu();
      }
    });

    document.addEventListener('scroll', () => {
      this._hideMoreMenu();
    }, true);
  }

  _showMoreMenu(x, y) {
    this.moreMenu.innerHTML = '';

    const items = [
      {
        label: 'Specs',
        icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>`,
        action: () => specsDashboard.toggle(),
        key: 'specs'
      },
      {
        label: 'Tasks',
        icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
        action: () => tasksDashboard.toggle(),
        key: 'tasks'
      },
      {
        label: 'Claude',
        icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
        action: () => pluginsPanel.toggle(),
        key: 'claude'
      },
      {
        label: 'GitHub',
        icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>`,
        action: () => githubPanel.toggle(),
        key: 'github'
      },
      {
        label: 'Prompts',
        icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
        action: () => promptsPanel.toggle(),
        key: 'prompts'
      },
      {
        label: 'Overview',
        icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
        action: () => { if (this.onOverviewToggle) this.onOverviewToggle(); },
        key: 'overview'
      },
    ];

    items.forEach(({ label, icon, action }) => {
      const item = document.createElement('div');
      item.className = 'more-menu-item';
      item.innerHTML = `${icon}<span>${label}</span>`;
      item.addEventListener('click', () => {
        action();
        this._hideMoreMenu();
      });
      this.moreMenu.appendChild(item);
    });

    // Divider + Theme toggle
    const divider = document.createElement('div');
    divider.className = 'more-menu-divider';
    this.moreMenu.appendChild(divider);

    const themeItem = document.createElement('div');
    themeItem.className = 'more-menu-item';
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const themeLabel = currentTheme === 'dark' ? 'Light Mode' : 'Dark Mode';
    const themeIcon = currentTheme === 'dark'
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
    themeItem.innerHTML = `${themeIcon}<span>${themeLabel}</span>`;
    themeItem.addEventListener('click', () => {
      this._toggleTheme();
      this._hideMoreMenu();
    });
    this.moreMenu.appendChild(themeItem);

    this.moreMenu.style.left = `${x}px`;
    this.moreMenu.style.top = `${y}px`;
    this.moreMenu.classList.add('visible');

    // Adjust if out of bounds
    const rect = this.moreMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      this.moreMenu.style.left = `${window.innerWidth - rect.width - 5}px`;
    }
    if (rect.bottom > window.innerHeight) {
      this.moreMenu.style.top = `${y - rect.height}px`;
    }
  }

  _hideMoreMenu() {
    if (this.moreMenu) {
      this.moreMenu.classList.remove('visible');
    }
    const btn = this.element && this.element.querySelector('.btn-more-toggle');
    if (btn) btn.classList.remove('active');
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
   * Initialize theme from localStorage
   */
  _initTheme() {
    const saved = localStorage.getItem('frame-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    this._updateThemeButton(saved);
  }

  /**
   * Toggle between dark and light theme
   */
  _toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('frame-theme', next);
    this._updateThemeButton(next);
  }

  /**
   * Update theme button icon based on current theme (no-op: theme icon is in the more menu)
   */
  _updateThemeButton(_theme) {
    // Theme icon is rendered dynamically in the more menu; nothing to update here
  }

  /**
   * Set overview button active state
   * @param {boolean} active - Whether overview is active
   */
  setOverviewActive(_active) {
    // Overview is now in the more menu; no persistent button to update
  }
}

module.exports = { TerminalTabBar };
