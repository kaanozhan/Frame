/**
 * Home Board Module
 *
 * The project board's **host**. It owns the header, the no-project state, the
 * shell menu and one flat grid; what goes in the grid is the registry's
 * business, and each widget owns its own card. The rule that decides what
 * belongs on a widget: **a widget is a summary and an entry point; the
 * sidebar is the full surface.** Widgets do not replace the dashboards, they
 * lead to them.
 *
 * Naming (D1, 2026-08-27). This module and its stylesheet say "home"; the
 * lane vocabulary elsewhere — laneStatus, laneDetailRail, #btn-lane-home,
 * the .lane-board DOM class — is untouched. That narrows the terminals-view
 * convention of 2026-08-20 rather than reversing it: the convention governs
 * *terminal* naming, and a board that no longer holds a terminal falls
 * outside it.
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
 */

const { FolderOpen } = require('lucide');
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

class HomeBoard {
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
    // Resolved at mount: [{ widget, span }] plus the unsubscribes that feed them.
    this._layout = null;
    this._widgetUnsubs = [];

    this._createShellMenu();
    this._loadAvailableShells();

    // Every subscription the board used to install itself now lives in
    // homeData, behind its own init-once guard (C1, C2).
    homeData.init();
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

    // One grid of independent widgets, split in two halves: the first widget
    // (the prompt composer) takes the whole top half, the rest share the
    // bottom half in equal columns. The registry decides what is shown and in what order;
    // the grid's stylesheet decides where each order slot lands.
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

    this._updateWidgets();
  }

  /** True when this container already holds a mounted board for this project. */
  isMountedIn(container, state) {
    return !!this.boardEl
      && this.boardEl.isConnected
      && this.boardEl.parentNode === container
      && !!this.gridEl === !!state.currentProjectPath;
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

  /**
   * Nothing to show until a project exists, so Home asks for one the same way
   * the first-run screen does — the shared projectStart block, not the lone
   * "Add New Project" button into the Open a Project modal that used to sit
   * here. That button was a differently-worded third answer to a question the
   * screen and the switcher already answer.
   */
  _renderNoProjectState() {
    const empty = document.createElement('div');
    empty.className = 'lane-board-empty lane-board-empty-start';
    empty.innerHTML = `
      <div class="lane-board-empty-icon">${lucideIcon(FolderOpen, 26)}</div>
      <p class="lane-board-empty-title">No project added yet</p>
      <p class="lane-board-empty-hint">Start with a folder you already have, an empty project, or a repository to clone.</p>
    `;
    // Lazy-required to avoid load-order coupling, like the modal it replaces.
    empty.appendChild(require('./projectStart').create());
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
      if (!this.shellMenu.contains(e.target) && !e.target.closest('.home-card-action, .home-composer')) {
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

  /**
   * Every open re-reads the list for the current workspace — a server
   * workspace lists the server's shells (server-linux-readiness) — showing
   * the list in hand meanwhile. The re-read happens once per open: the
   * re-render it triggers (`refreshed`) never asks again, so an empty answer
   * cannot turn into a request loop.
   */
  _showShellMenu(x, y, refreshed = false) {
    if (!refreshed) {
      const before = JSON.stringify(this.availableShells);
      this._loadAvailableShells().then(() => {
        if (!this.shellMenu.classList.contains('visible')) return;
        if (JSON.stringify(this.availableShells) !== before || this.availableShells.length === 0) this._showShellMenu(x, y, true);
      });
    }
    this.shellMenu.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'shell-menu-header';
    header.textContent = 'Select Shell';
    this.shellMenu.appendChild(header);

    if (this.availableShells.length === 0) {
      const loading = document.createElement('div');
      loading.className = 'terminal-context-menu-item';
      loading.textContent = refreshed ? 'No shells found' : 'Loading...';
      loading.style.opacity = '0.5';
      this.shellMenu.appendChild(loading);
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

module.exports = { HomeBoard };
