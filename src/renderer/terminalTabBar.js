/**
 * Terminal Top Bar Module (historically the tab bar)
 *
 * Persistent bar above the terminal content area. Home is permanent. After
 * it comes Terminals and, as a breadcrumb beside it, a chip for **every live
 * terminal of the project** — enlarged or not, the terminals are always
 * reachable from up here. Terminals itself is the grid of all of them; a
 * chip is that one terminal enlarged. Then a chip per open section
 * (task / spec / diff / orchestrator).
 *
 * × means "drop from this bar", never "destroy" — on Terminals and on a
 * terminal chip alike. A dropped chip's terminal keeps running and Terminals
 * still holds it; going back to it there puts the chip back. That is how a
 * busy project's bar stays readable, and terminalChipNotice teaches it until
 * the user opts out. One departure from the rule: Terminals itself carries
 * an × only while the project has **no** terminals — with terminals in it
 * the breadcrumb beside it would be orphaned.
 *
 * What earns a place here is a surface with *live state*. Terminals has
 * running processes; the Specs grid does not, so Specs, Tasks, Decisions and
 * the panels open from the sidebar and stay out.
 *
 * The right action cluster (agent launcher, update, theme) is
 * mode-independent.
 *
 * Controls you click live here; ambient readouts live in the status bar at
 * the foot of the window — the Claude usage meters moved there
 * (status-bar spec).
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const { Plus, Bell, CheckSquare, Home, X, FileText, FileDiff, Bot } = require('lucide');
const { escapeHtml } = require('./htmlUtils');
const laneStatus = require('./laneStatus');
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
    this.onGoHome = null;          // Callback: return to Home
    this.onEnterTerminals = null;  // Callback: show the Terminals section
    this.onDropTerminals = null;   // Callback: drop Terminals from this strip
    this.onEnterTerminal = null;   // Callback: (terminalId) => enlarge that terminal
    this.onDropTerminal = null;    // Callback: (terminalId) => drop its chip from the bar
    this.onLaneCreated = null;    // Callback: (terminalId) => after + creates a lane
    this.onActivateSection = null; // Callback: (key) => focus an open section tab
    this.onCloseSection = null;    // Callback: (key) => close a section tab
    this._lastState = null;
    this._injectStyles();
    this._render();
    this._createShellMenu();
    this._loadAvailableShells();
    this._initTheme();
    this._watchLaneStatus();
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
        <button class="btn-update-notify" title="Check for updates" style="display:none;position:relative;">
          ${lucideIcon(Bell)}
          <span class="update-badge"></span>
        </button>
        <!-- Theme toggle: window-level control, so it sits at the far right
             of the top bar (status-bar spec). Wired here rather than in
             index.js because this element is rendered by this module — a
             listener attached elsewhere would bind before it exists. -->
        <button id="sidebar-theme-btn" class="btn-theme-toggle" tabindex="-1" title="Toggle light/dark theme" aria-label="Toggle theme">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>
          </svg>
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
  }

  /**
   * The left section: Home, then Terminals with its terminals as a
   * breadcrumb, then a chip per open section.
   *
   * Home is permanent. Terminals is the grid of every terminal; each chip
   * after it is that one terminal enlarged, and they are all listed whether
   * the user ever enlarged them or not. Whichever surface is on screen gets
   * the highlight — Terminals while the grid shows, the chip while its own
   * terminal fills the section.
   */
  _renderLeftSection(state) {
    const left = this.element.querySelector('.lane-bar-left');

    const sections = state.sections || [];
    const activeKey = state.activeSectionKey || null;
    const onSection = !!activeKey;
    const onHome = state.viewMode === 'board' && !onSection;
    const onTerminals = state.viewMode === 'terminals' && !onSection;
    const showTerminals = state.terminalsInStrip !== false;
    // Two different counts, and mixing them up is easy: the breadcrumb draws
    // what is left in the bar, while Terminals' own × asks whether the
    // *project* has terminals. Dropping every chip must not make Terminals
    // itself droppable while its terminals are still running.
    const liveCount = (state.terminals || []).length;
    const terminals = state.barTerminals || state.terminals || [];
    const shownId = state.shownTerminalId || null;

    left.innerHTML = `
      <button class="btn-lane-home ${onHome ? 'current' : ''}" title="Home (Cmd+Esc)">
        ${lucideIcon(Home, 15)}
        <span class="btn-lane-home-label">Home</span>
      </button>
      ${showTerminals || sections.length ? '<span class="lane-bar-divider"></span>' : ''}
      ${showTerminals ? `
        <button class="lane-bar-section lane-bar-terminals ${onTerminals && !shownId ? 'current' : ''}" title="All terminals">
          <span class="lane-bar-terminals-icon" aria-hidden="true">›_</span>
          <span class="lane-bar-section-label">Terminals</span>
          ${liveCount ? '' : `<span class="lane-bar-section-close" title="Remove from the bar">${lucideIcon(X, 12)}</span>`}
        </button>
        ${terminals.map(t => this._terminalChip(t, onTerminals && shownId === t.id)).join('')}
      ` : ''}
      ${sections.map(sec => `
        <button class="lane-bar-section ${sec.key === activeKey ? 'current' : ''}" data-key="${escapeHtml(sec.key)}" title="${escapeHtml(sec.title)}">
          ${lucideIcon(sec.type === 'spec' ? FileText : sec.type === 'diff' ? FileDiff : sec.type === 'orchestrator' ? Bot : CheckSquare, 13)}
          <span class="lane-bar-section-label">${escapeHtml(sec.title)}</span>
          <span class="lane-bar-section-close" title="Close tab">${lucideIcon(X, 12)}</span>
        </button>
      `).join('')}
    `;
  }

  /**
   * One terminal's breadcrumb chip. The dot is the same status signal the
   * pane header carries; `_watchLaneStatus` keeps it live between renders.
   */
  _terminalChip(state, current) {
    const name = state.customName || state.name;
    return `
      <button class="lane-bar-section lane-bar-terminal ${current ? 'current' : ''}" data-terminal-id="${escapeHtml(state.id)}" title="${escapeHtml(name)}">
        <span class="lane-status-dot ${laneStatus.getStatus(state.id).status}"></span>
        <span class="lane-bar-section-label">${escapeHtml(name)}</span>
        <span class="lane-bar-section-close" title="Remove from the bar — the terminal keeps running">${lucideIcon(X, 12)}</span>
      </button>
    `;
  }

  /**
   * A chip's dot follows its terminal without waiting for a state change —
   * the whole point of the breadcrumb is seeing an agent go red while you
   * are looking at something else.
   */
  _watchLaneStatus() {
    laneStatus.onChange((terminalId) => {
      const dot = this.element?.querySelector(`.lane-bar-terminal[data-terminal-id="${terminalId}"] .lane-status-dot`);
      if (dot) dot.className = `lane-status-dot ${laneStatus.getStatus(terminalId).status}`;
    });
  }

  _setupEventHandlers() {
    // Left section (delegated — content re-renders on every state update)
    this.element.addEventListener('click', (e) => {
      // Terminals wears a section chip but is not one — it has no key, and
      // its × drops it from the bar rather than closing anything.
      if (e.target.closest('.lane-bar-terminals')) {
        if (e.target.closest('.lane-bar-section-close')) {
          e.stopPropagation();
          if (this.onDropTerminals) this.onDropTerminals();
        } else if (this.onEnterTerminals) {
          this.onEnterTerminals();
        }
        return;
      }
      // A terminal's breadcrumb chip: the body goes to that terminal, and
      // its × takes the chip out of the bar, leaving the terminal alone.
      const termEl = e.target.closest('.lane-bar-terminal');
      if (termEl) {
        const id = termEl.dataset.terminalId;
        if (e.target.closest('.lane-bar-section-close')) {
          e.stopPropagation();
          if (this.onDropTerminal) this.onDropTerminal(id);
        } else if (this.onEnterTerminal) {
          this.onEnterTerminal(id);
        }
        return;
      }
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

    // Theme toggle — flipping data-theme is the whole contract
    // (terminalManager observes it for the xterm theme, CSS does the rest).
    this.element.querySelector('#sidebar-theme-btn')?.addEventListener('click', () => {
      const next = (document.documentElement.getAttribute('data-theme') || 'dark') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('frame-theme', next); } catch (_) { /* non-fatal */ }
    });
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
