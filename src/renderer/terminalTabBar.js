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
 * × on a terminal chip closes that terminal for good — its process is
 * killed, the same as the × on its pane in Terminals — after
 * terminalChipNotice asks for confirmation (until the user opts out).
 * Terminals itself carries an × only while the project has **no** terminals
 * — with terminals in it the breadcrumb beside it would be orphaned — and
 * that × only drops it from the bar.
 *
 * What earns a place here is a surface with *live state*. Terminals has
 * running processes; the Specs grid does not, so Specs, Tasks, Decisions and
 * the panels open from the sidebar and stay out. The one thing the grid
 * does pin is the spec its drawer shows: a single chip that outlives the
 * drawer and the view, replaced on every open, so leaving the grid never
 * loses the spec (multiTerminalUI.enterSpecDrawer). The Tasks board pins
 * its drawer's task the same way (multiTerminalUI.enterTaskDrawer).
 *
 * Controls you click live in the app header above (agent launcher, Start,
 * layout toggles, theme, update bell — shell-chrome-app-header-collapsible-
 * panels spec); ambient readouts live in the status bar at the foot of the
 * window (status-bar spec). This bar is navigation only.
 */

const { ipcRenderer } = require('electron');
const themes = require('./themes');
const { IPC } = require('../shared/ipcChannels');
const { Plus, CheckSquare, Home, X, FileText, FileDiff, FileBarChart, Bot } = require('lucide');
const { escapeHtml } = require('./htmlUtils');
const laneStatus = require('./laneStatus');
const notify = require('./notify');
const tooltip = require('./tooltip');

function lucideIcon(data, size = 18) {
  const children = data.map(([tag, attrs]) => {
    const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<${tag} ${attrStr}/>`;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0">${children}</svg>`;
}

/**
 * Apply a theme app-wide. Writing data-theme (the id) and data-scheme
 * (its light/dark family — see themes.js) is the whole contract:
 * terminalManager observes it for the xterm theme, CSS does the rest.
 * The choice persists under 'frame-theme' and is restored at boot by
 * appHeader.init. Shared by the header's theme picker and the theme.*
 * commands (View › Theme menu, palette).
 */
function applyTheme(name) {
  const next = themes.normalize(name);
  document.documentElement.setAttribute('data-theme', next);
  document.documentElement.setAttribute('data-scheme', themes.schemeOf(next));
  try { localStorage.setItem('frame-theme', next); } catch (_) { /* non-fatal */ }
  // Main keeps a copy so the native View › Theme submenu can check the
  // current entry (it rebuilds the menu on each change).
  ipcRenderer.send(IPC.THEME_CHANGED, next);
}

/** The theme currently applied — a themes.js id. */
function currentTheme() {
  return themes.normalize(document.documentElement.getAttribute('data-theme'));
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
    this.onCloseTerminal = null;   // Callback: (terminalId) => close that terminal
    this.onLaneCreated = null;    // Callback: (terminalId) => after + creates a lane
    this.onActivateSection = null; // Callback: (key) => focus an open section tab
    this.onCloseSection = null;    // Callback: (key) => close a section tab
    this.onEnterSpecDrawer = null; // Callback: reopen the pinned spec in the Specs grid's drawer
    this.onDropSpecDrawer = null;  // Callback: drop the pinned spec chip
    this.onEnterTaskDrawer = null; // Callback: reopen the pinned task in the Tasks board's drawer
    this.onDropTaskDrawer = null;  // Callback: drop the pinned task chip
    this._lastState = null;
    this._injectStyles();
    this._render();
    this._createShellMenu();
    this._loadAvailableShells();
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
          padding: 8px 12px;
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
          padding: 8px 12px;
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
    // The strip alone. The window-level controls that used to sit at the
    // right end (agent picker, Start, update bell, theme) live in the app
    // header now (shell-chrome-app-header-collapsible-panels spec).
    this.element.innerHTML = `
      <div class="lane-bar-left"></div>
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
    const specDrawer = state.specDrawer || null;
    const taskDrawer = state.taskDrawer || null;
    // Pages (a terminal enlarged, a spec / task drawer, a section tab) are a
    // second kind of tab: bordered chips after their own divider, apart from
    // the filled Home / Terminals.
    const hasPages = (showTerminals && terminals.length) || specDrawer || taskDrawer || sections.length;
    const pagesDivider = hasPages && showTerminals ? '<span class="lane-bar-divider"></span>' : '';

    left.innerHTML = `
      <button class="btn-lane-home ${onHome ? 'current' : ''}" title="Home (Cmd+Esc)">
        ${lucideIcon(Home, 15)}
        <span class="btn-lane-home-label">Home</span>
      </button>
      ${showTerminals || sections.length || specDrawer || taskDrawer ? '<span class="lane-bar-divider"></span>' : ''}
      ${showTerminals ? `
        <button class="lane-bar-section lane-bar-terminals ${onTerminals && !shownId ? 'current' : ''}" title="All terminals">
          <span class="lane-bar-terminals-icon" aria-hidden="true">›_</span>
          <span class="lane-bar-section-label">Terminals</span>
          ${liveCount ? '' : `<span class="lane-bar-section-close" title="Remove from the bar">${lucideIcon(X, 12)}</span>`}
        </button>
      ` : ''}
      ${pagesDivider}
      ${showTerminals ? terminals.map(t => this._terminalChip(t, onTerminals && shownId === t.id)).join('') : ''}
      <button class="lane-bar-new-terminal" type="button">${lucideIcon(Plus, 14)}</button>
      ${specDrawer ? `
        <button class="lane-bar-section lane-bar-page lane-bar-spec-drawer ${state.specDrawerShown ? 'current' : ''}" data-slug="${escapeHtml(specDrawer.slug)}" title="${escapeHtml(specDrawer.title)}">
          ${lucideIcon(FileText, 13)}
          <span class="lane-bar-section-label">${escapeHtml(specDrawer.title)}</span>
          <span class="lane-bar-section-close" title="Remove from the bar">${lucideIcon(X, 12)}</span>
        </button>
      ` : ''}
      ${taskDrawer ? `
        <button class="lane-bar-section lane-bar-page lane-bar-task-drawer ${state.taskDrawerShown ? 'current' : ''}" data-task-id="${escapeHtml(String(taskDrawer.id))}" title="${escapeHtml(taskDrawer.title)}">
          ${lucideIcon(CheckSquare, 13)}
          <span class="lane-bar-section-label">${escapeHtml(taskDrawer.title)}</span>
          <span class="lane-bar-section-close" title="Remove from the bar">${lucideIcon(X, 12)}</span>
        </button>
      ` : ''}
      ${sections.map(sec => `
        <button class="lane-bar-section lane-bar-page ${sec.key === activeKey ? 'current' : ''}" data-key="${escapeHtml(sec.key)}" title="${escapeHtml(sec.title)}">
          ${lucideIcon(sec.type === 'spec' ? FileText : sec.type === 'diff' ? FileDiff : sec.type === 'report' ? FileBarChart : sec.type === 'orchestrator' ? Bot : CheckSquare, 13)}
          <span class="lane-bar-section-label">${escapeHtml(sec.title)}</span>
          <span class="lane-bar-section-close" title="Close tab">${lucideIcon(X, 12)}</span>
        </button>
      `).join('')}
    `;

    // New terminal, at the end of the terminal group: opens one in the
    // default shell and enlarges it — no detour through the Terminals grid.
    tooltip.attach(left.querySelector('.lane-bar-new-terminal'), 'New terminal', { placement: 'bottom' });
  }

  /**
   * One terminal's breadcrumb chip. The dot is the same status signal the
   * pane header carries; `_watchLaneStatus` keeps it live between renders.
   */
  _terminalChip(state, current) {
    const name = state.customName || state.name;
    return `
      <button class="lane-bar-section lane-bar-page lane-bar-terminal ${current ? 'current' : ''}" data-terminal-id="${escapeHtml(state.id)}" title="${escapeHtml(name)}">
        <span class="lane-status-dot ${laneStatus.getStatus(state.id).status}"></span>
        <span class="lane-bar-section-label">${escapeHtml(name)}</span>
        <span class="lane-bar-section-close" title="Close terminal">${lucideIcon(X, 12)}</span>
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
      if (e.target.closest('.lane-bar-new-terminal')) {
        this._createLane();
        return;
      }
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
      // its × closes the terminal (after a confirmation).
      const termEl = e.target.closest('.lane-bar-terminal');
      if (termEl) {
        const id = termEl.dataset.terminalId;
        if (e.target.closest('.lane-bar-section-close')) {
          e.stopPropagation();
          if (this.onCloseTerminal) this.onCloseTerminal(id);
        } else if (this.onEnterTerminal) {
          this.onEnterTerminal(id);
        }
        return;
      }
      // The spec pinned by the Specs grid's drawer: body reopens it there,
      // × drops the chip.
      if (e.target.closest('.lane-bar-spec-drawer')) {
        if (e.target.closest('.lane-bar-section-close')) {
          e.stopPropagation();
          if (this.onDropSpecDrawer) this.onDropSpecDrawer();
        } else if (this.onEnterSpecDrawer) {
          this.onEnterSpecDrawer();
        }
        return;
      }
      // The task pinned by the Tasks board's drawer: same contract.
      if (e.target.closest('.lane-bar-task-drawer')) {
        if (e.target.closest('.lane-bar-section-close')) {
          e.stopPropagation();
          if (this.onDropTaskDrawer) this.onDropTaskDrawer();
        } else if (this.onEnterTaskDrawer) {
          this.onEnterTaskDrawer();
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
}

module.exports = { TerminalTabBar, applyTheme, currentTheme };
