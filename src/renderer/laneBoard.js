/**
 * Lane Board Module — Home
 *
 * The project board's **host**. It owns the header, the no-project state, the
 * shell menu and one flat grid; what goes in the grid is the registry's
 * business, and each widget owns its own card. The rule that decides what
 * belongs on a widget: **a widget is a summary and an entry point; the
 * sidebar is the full surface.** Widgets do not replace the dashboards, they
 * lead to them.
 *
 * Rendered by MultiTerminalUI into its content container when
 * viewMode === 'board' — a view mode, not an overlay. Without a project there
 * is no Home: project selection takes priority and gets the whole area.
 *
 * Mount/update split (C1). Live data cards rebuilt on every state change
 * is precisely the shape of the IPC storm measured on 2026-08-20 (~100
 * round-trips/sec, 163% CPU), so `mount()` builds the DOM once and `update()`
 * patches in place. The host's `_renderBoardView` holds the matching guard,
 * and `homeData` holds the single subscription set feeding every widget.
 *
 * Naming convention (revised by the terminals-view spec, 2026-08-20;
 * overturns the 2026-06-11 rule): code, module names, and DOM ids still say
 * "lane" (laneBoard, btn-lane-home, _createLane); user-facing vocabulary
 * says "Terminal" for a work stream and "Home" for this board. Keep new
 * code on the same rule — don't half-rename in either direction.
 */

const { FolderOpen, GitBranch } = require('lucide');
const { escapeHtml } = require('./htmlUtils');
const notify = require('./notify');
const homeData = require('./home/homeData');
const { resolveLayout, sourcesFor } = require('./home/registry');

function lucideIcon(data, size = 14) {
  const children = data.map(([tag, attrs]) => {
    const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<${tag} ${attrStr}/>`;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0">${children}</svg>`;
}

class LaneBoard {
  /**
   * @param {TerminalManager} manager
   * @param {Object} callbacks
   * @param {Function} callbacks.onEnterLane - (terminalId) => void
   * @param {Function} callbacks.onOpenTerminals - () => show the Terminals section
   */
  constructor(manager, { onEnterLane, onOpenTerminals }) {
    this.manager = manager;
    this.onEnterLane = onEnterLane;
    this.onOpenTerminals = onOpenTerminals;
    this.container = null;
    this.boardEl = null;
    this.gridEl = null;
    this.shellMenu = null;
    this.availableShells = [];
    this._lastState = null;
    this.headerEl = null;
    // Resolved at mount: [{ widget, span }] plus the unsubscribes that feed them.
    this._layout = null;
    this._widgetUnsubs = [];

    this._createShellMenu();
    this._loadAvailableShells();

    // Every subscription the board used to install itself now lives in
    // homeData, behind its own init-once guard (C1, C2). What is left here is
    // the one source the board reads directly: the header's branch.
    homeData.init();
    if (!LaneBoard._dataListenersBound) {
      LaneBoard._dataListenersBound = true;
      homeData.subscribe('git', () => {
        const b = LaneBoard._instance;
        if (b && b._isVisible()) b._updateHeader();
      });
    }
    LaneBoard._instance = this;
  }

  // ─── Mount / update (C2) ────────────────────────────────

  /**
   * Build the board's DOM. Called once per visit to Home; every state change
   * after that goes through update().
   */
  mount(container, state) {
    this.container = container;
    container.innerHTML = '';

    this.boardEl = document.createElement('div');
    this.boardEl.className = 'lane-board';
    container.appendChild(this.boardEl);

    if (!state.currentProjectPath) {
      // Terminals, specs and tasks are all project-scoped — asking for a
      // project is the only thing Home can usefully do without one, and Home
      // has no no-project widgets (C6).
      this.gridEl = null;
      // The previous mount's widgets hold detached DOM and live
      // subscriptions; without a grid to draw into they must go.
      this._disposeWidgets();
      this._layout = null;
      this.boardEl.appendChild(this._renderNoProjectState());
      return;
    }

    this.headerEl = this._buildHeader();
    this.boardEl.appendChild(this.headerEl);

    // One flat grid of independent widgets. The named groups are gone: they
    // imposed a reading order the widgets do not have, and every new card
    // meant deciding which group it belonged to. The registry decides what
    // is shown and in what order; the grid decides how many fit per row.
    this.gridEl = document.createElement('div');
    this.gridEl.className = 'home-grid';
    this.boardEl.appendChild(this.gridEl);

    this._layout = resolveLayout(this._widgetCtx());
    this._mountWidgets(this.gridEl);

    this.update(state);
  }

  /** Patch the cards in place. Never rebuilds the board. */
  update(state) {
    this._lastState = state;
    // The data layer needs the host's state whether or not there is a board
    // to draw it into — a project change has to invalidate its caches either
    // way.
    homeData.setHostState(state);
    if (!this.gridEl) return;

    this._updateHeader();
    this._updateWidgets();
  }

  /** True when this container already holds a mounted board for this project. */
  isMountedIn(container, state) {
    return !!this.boardEl
      && this.boardEl.isConnected
      && this.boardEl.parentNode === container
      && !!this.gridEl === !!state.currentProjectPath;
  }

  // ─── Header ─────────────────────────────────────────────

  /**
   * Home opens on a project, so it should say which one: the name and the
   * branch it is on. The path is not repeated here — the sidebar already
   * carries it, and Home is not where you go to check a directory.
   */
  _buildHeader() {
    const el = document.createElement('div');
    el.className = 'home-header';
    el.innerHTML = `
      <div class="home-header-top">
        <h1 class="home-header-name"></h1>
        <span class="home-header-branch">${lucideIcon(GitBranch, 12)}<span class="home-header-branch-name"></span></span>
      </div>
    `;
    return el;
  }

  _updateHeader() {
    if (!this.headerEl) return;
    const path = this._lastState && this._lastState.currentProjectPath;
    if (!path) return;

    this.headerEl.querySelector('.home-header-name').textContent = _projectName(path);

    // The watcher reports per project — a branch from the project you just
    // left is not this project's branch.
    const git = homeData.get('git');
    const branch = (git && git.projectPath === path) ? git.branch : null;
    const chip = this.headerEl.querySelector('.home-header-branch');
    chip.style.display = branch ? '' : 'none';
    if (branch) this.headerEl.querySelector('.home-header-branch-name').textContent = branch;
  }

  // ─── Widgets ────────────────────────────────────────────

  /**
   * What a widget is handed besides its data: the host's affordances, never
   * `ipcRenderer` (D3, S6).
   */
  _widgetCtx() {
    return {
      state: this._lastState,
      enterLane: (id) => this.onEnterLane(id),
      openTerminals: () => this.onOpenTerminals && this.onOpenTerminals(),
      createLane: (shellPath) => this._createLane(shellPath),
      showShellMenu: (x, y) => this._showShellMenu(x, y)
    };
  }

  /**
   * Mount the resolved layout, then wire one subscription per source the
   * layout actually reads — not one per widget. Ten widgets on `lanes` cost
   * one listener, which is the property C1 turns on.
   */
  _mountWidgets(hostEl) {
    this._disposeWidgets();

    const ctx = this._widgetCtx();
    for (const { widget, span } of this._layout) {
      widget.mount(hostEl, ctx);
      // A span wider than one is the grid's business, not the widget's — it
      // never has to know how many columns it was given.
      if (span > 1 && hostEl.lastElementChild) {
        hostEl.lastElementChild.style.gridColumn = `span ${span}`;
      }
    }

    for (const source of sourcesFor(this._layout)) {
      this._widgetUnsubs.push(homeData.subscribe(source, () => this._updateWidgets(source)));
    }
  }

  /**
   * Patch the widgets. With a source name, only the widgets that read it —
   * a spec push must not repaint the ones that never asked for specs.
   */
  _updateWidgets(source) {
    if (!this._layout || !this._isVisible()) return;

    const ctx = this._widgetCtx();
    for (const { widget } of this._layout) {
      const sources = widget.sources || [];
      if (source && !sources.includes(source)) continue;

      const data = {};
      for (const s of sources) data[s] = homeData.get(s);
      // One widget throwing must not leave the rest of the board unpainted.
      try {
        widget.update(data, ctx);
      } catch (err) {
        console.error(`Home widget "${widget.id}" failed to update:`, err);
      }
    }
  }

  _disposeWidgets() {
    this._widgetUnsubs.forEach(off => off());
    this._widgetUnsubs = [];
    if (this._layout) {
      for (const { widget } of this._layout) {
        if (typeof widget.dispose === 'function') widget.dispose();
      }
    }
  }

  _renderNoProjectState() {
    const empty = document.createElement('div');
    empty.className = 'lane-board-empty';
    empty.innerHTML = `
      <div class="lane-board-empty-icon">${lucideIcon(FolderOpen, 26)}</div>
      <p class="lane-board-empty-title">No project added yet</p>
      <p class="lane-board-empty-hint">Add a project to get started — open a folder, create a new project, or clone a repo.</p>
      <button class="lane-board-empty-cta">Add New Project</button>
    `;
    empty.querySelector('.lane-board-empty-cta').addEventListener('click', () => {
      // Same flow as the sidebar Projects "Add new Project" button — the Open
      // Project modal (open folder / create / clone). Lazy-required to avoid
      // load-order coupling.
      require('./openProjectModal').open();
    });
    return empty;
  }

  // ─── Data ───────────────────────────────────────────────

  async _createLane(shellPath = null) {
    const options = shellPath ? { shell: shellPath } : {};
    let id = null;
    try {
      id = await this.manager.createTerminal({
        ...options,
        projectPath: this.manager.getCurrentProject()
      });
    } catch (err) {
      notify.error(`Could not create a new terminal: ${err.message || 'terminal creation failed'}`);
      return;
    }
    if (!id) {
      notify.error(`Could not create a new terminal — maximum (${this.manager.maxTerminals}) reached for this project`);
      return;
    }
    this.onEnterLane(id);
  }

  _isVisible() {
    return !!(this.boardEl && this.boardEl.isConnected);
  }

  // ─── Shell menu (same idiom as terminalTabBar's) ────────

  _createShellMenu() {
    this.shellMenu = document.createElement('div');
    this.shellMenu.className = 'terminal-context-menu shell-menu lane-shell-menu';
    document.body.appendChild(this.shellMenu);

    document.addEventListener('click', (e) => {
      if (!this.shellMenu.contains(e.target) && !e.target.closest('.home-card-action')) {
        this._hideShellMenu();
      }
    });
    document.addEventListener('scroll', () => this._hideShellMenu(), true);
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
    this.shellMenu.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'shell-menu-header';
    header.textContent = 'Select Shell';
    this.shellMenu.appendChild(header);

    if (this.availableShells.length === 0) {
      const loading = document.createElement('div');
      loading.className = 'terminal-context-menu-item';
      loading.textContent = 'Loading...';
      loading.style.opacity = '0.5';
      this.shellMenu.appendChild(loading);
      this._loadAvailableShells().then(() => {
        if (this.shellMenu.classList.contains('visible')) this._showShellMenu(x, y);
      });
    } else {
      this.availableShells.forEach((shell) => {
        const item = document.createElement('div');
        item.className = 'terminal-context-menu-item';
        if (shell.isDefault) item.classList.add('default');
        item.innerHTML = `
          <span>${escapeHtml(shell.name)}</span>
          ${shell.isDefault ? '<span class="shell-default-badge">default</span>' : ''}
        `;
        item.addEventListener('click', () => {
          this._hideShellMenu();
          this._createLane(shell.path);
        });
        this.shellMenu.appendChild(item);
      });
    }

    this.shellMenu.style.left = `${x}px`;
    this.shellMenu.style.top = `${y}px`;
    this.shellMenu.classList.add('visible');

    const rect = this.shellMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      this.shellMenu.style.left = `${window.innerWidth - rect.width - 5}px`;
    }
    if (rect.bottom > window.innerHeight) {
      this.shellMenu.style.top = `${y - rect.height}px`;
    }
  }

  _hideShellMenu() {
    if (this.shellMenu) this.shellMenu.classList.remove('visible');
  }

}

function _projectName(p) {
  return p.split(/[\\/]/).filter(Boolean).pop() || p;
}

module.exports = { LaneBoard };
