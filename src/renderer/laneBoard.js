/**
 * Lane Board Module — Home
 *
 * The project board. Three cards, each a summary of one surface and the way
 * into it: Terminals, Active Specs, Active Tasks. The rule that decides what
 * belongs on a card: **a card is a summary and an entry point; the sidebar is
 * the full surface.** Cards do not replace the dashboards, they lead to them.
 * Orchestration is deliberately absent — it is a surface you open, and the
 * sidebar's Work group opens it as a top-bar tab.
 *
 * Rendered by MultiTerminalUI into its content container when
 * viewMode === 'board' — a view mode, not an overlay. Without a project there
 * is no Home: project selection takes priority and gets the whole area.
 *
 * Mount/update split (C2). Live data cards rebuilt on every state change
 * is precisely the shape of the IPC storm measured on 2026-08-20 (~100
 * round-trips/sec, 163% CPU), so `mount()` builds the DOM once and `update()`
 * patches text and small list bodies in place. The host's `_renderBoardView`
 * holds the matching guard.
 *
 * Specs and Tasks ride the SPEC_DATA / TASKS_DATA pushes the panels already
 * use — the subscriptions the retired laneRail owned, `!malformed` filter and
 * all (C6) — so no new IPC channel exists for Home.
 *
 * Naming convention (revised by the terminals-view spec, 2026-08-20;
 * overturns the 2026-06-11 rule): code, module names, and DOM ids still say
 * "lane" (laneBoard, btn-lane-home, _createLane); user-facing vocabulary
 * says "Terminal" for a work stream and "Home" for this board. Keep new
 * code on the same rule — don't half-rename in either direction.
 */

const laneStatus = require('./laneStatus');
const { statusLabel, attentionMark, formatRelativeTime, assignmentIcon, assignmentText } = laneStatus;
const { Plus, FolderOpen, Bot, ArrowRight, Boxes, GitBranch } = require('lucide');
const { escapeHtml } = require('./htmlUtils');
const notify = require('./notify');
const homeData = require('./home/homeData');
const { resolveLayout, sourcesFor } = require('./home/registry');
const { widgetShell } = require('./home/widgetShell');
// Home says the same thing about an empty project as the section does — from
// the section's own definition, so it can only ever be said one way.
const { EMPTY_TITLE, EMPTY_HINT } = require('./terminalsView');

// Six cells, 3×2. The cap is a legibility budget, not a data limit: past it
// the last cell becomes "+N more" rather than nine boxes shrunk to fit.
const MAX_TILES = 6;

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
    this.cards = null;
    this.shellMenu = null;
    this.availableShells = [];
    this._lastState = null;
    this.headerEl = null;
    // Resolved at mount: [{ widget, span }] plus the unsubscribes that feed them.
    this._layout = null;
    this._widgetUnsubs = [];

    this._createShellMenu();
    this._loadAvailableShells();

    // Live agent state on the Terminals card.
    laneStatus.onChange(() => {
      if (this._isVisible() && this._lastState) this._updateTerminalsCard(this._lastState);
    });

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
      this.cards = null;
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

    this.cards = { terminals: this._buildTerminalsCard() };
    this.gridEl.appendChild(this.cards.terminals.el);

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
    if (!this.cards) return;

    this._updateHeader();
    this._updateTerminalsCard(state);
    this._updateWidgets();
  }

  /** True when this container already holds a mounted board for this project. */
  isMountedIn(container, state) {
    return !!this.boardEl
      && this.boardEl.isConnected
      && this.boardEl.parentNode === container
      && !!this.cards === !!state.currentProjectPath;
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
      createLane: (shellPath) => this._createLane(shellPath)
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

  // ─── Cards ──────────────────────────────────────────────

  _buildTerminalsCard() {
    const card = widgetShell({
      id: 'terminals',
      icon: Boxes,
      title: 'Terminals',
      // Creating a terminal lives in the grid now, as a tile in the first
      // free slot — so the footer is free to be the way out to the full grid.
      actionLabel: 'See Overview',
      actionIcon: ArrowRight,
      onOpen: () => this.onOpenTerminals && this.onOpenTerminals(),
      onAction: () => this.onOpenTerminals && this.onOpenTerminals()
    });
    card.action.title = 'Open the Terminals section on Overview';
    return card;
  }

  // ─── Card contents ──────────────────────────────────────

  /**
   * Terminals as tiles, six at a time in a 3×2 grid. The tiles are large on
   * purpose, so they carry what you would otherwise open a terminal to find
   * out: what it is running, what it was assigned, and how long since it last
   * said anything. Past six the last cell says how many are not shown and
   * leads to Overview — never a silent truncation.
   */
  _updateTerminalsCard(state) {
    const card = this.cards && this.cards.terminals;
    if (!card) return;

    const terminals = state.terminals || [];
    card.count.textContent = String(terminals.length);

    if (terminals.length === 0) {
      // An empty project deserves the middle of the card, not a lone dashed
      // box in the top-left corner of a lot of nothing.
      card.body.innerHTML = `
        <div class="home-tiles-empty">
          <p class="home-tiles-empty-title">${EMPTY_TITLE}</p>
          <p class="home-tiles-empty-hint">${EMPTY_HINT}</p>
          <button type="button" class="home-tile-new home-tiles-empty-cta">
            ${lucideIcon(Plus, 14)}<span>New terminal</span>
          </button>
        </div>
      `;
      this._wireTerminalTiles(card);
      return;
    }

    // Waiting agents first: the card exists to answer "is anything asking
    // for me?" before it answers "what is open".
    const rows = terminals
      .map(t => ({ t, s: laneStatus.getStatus(t.id) }))
      .sort((a, b) => _attentionRank(a.s.status) - _attentionRank(b.s.status));

    // The overflow tile costs a slot, so what it hides is one more than the
    // count over the cap — get that wrong and the label quietly lies.
    const overflow = rows.length > MAX_TILES ? rows.length - (MAX_TILES - 1) : 0;
    const shown = overflow > 0 ? rows.slice(0, MAX_TILES - 1) : rows.slice(0, MAX_TILES);

    const tiles = shown.map(({ t, s }) => {
      const mark = attentionMark(s.status);
      const full = statusLabel(s.status, { agentName: s.agentName, foreground: s.foreground, commandLine: s.commandLine });
      return `
        <button type="button" class="home-tile ${s.status}" data-id="${escapeHtml(t.id)}" title="${escapeHtml(full)}">
          <span class="home-tile-top">
            <span class="lane-status-dot ${s.status}"></span>
            <span class="home-tile-name">${escapeHtml(t.customName || t.name)}</span>
            ${mark ? `<span class="home-tile-mark">${mark}</span>` : ''}
          </span>
          <span class="home-tile-status">${escapeHtml(full)}</span>
          ${t.assignment ? `
          <span class="lane-assignment-chip home-tile-assign${s.agentName ? '' : ' dimmed'}"
                role="button" tabindex="0"
                data-assign-kind="${escapeHtml(t.assignment.kind || '')}"
                data-assign-ref="${escapeHtml(t.assignment.ref || '')}"
                title="Open ${escapeHtml(t.assignment.label)}">
            ${lucideIcon(assignmentIcon(t.assignment), 11)}<span class="lane-assignment-chip-label">${escapeHtml(assignmentText(t.assignment))}</span>
          </span>` : ''}
          <span class="home-tile-time">${escapeHtml(formatRelativeTime(s.lastActivityAt))}</span>
        </button>
      `;
    });

    if (overflow > 0) {
      tiles.push(`<button type="button" class="home-tile home-tile-more">+${overflow} more</button>`);
    } else if (terminals.length < this.manager.maxTerminals && tiles.length < MAX_TILES) {
      // New terminal takes the next free cell, when the project and the grid
      // both have room.
      tiles.push(`<button type="button" class="home-tile home-tile-new">${lucideIcon(Plus, 16)}<span>New terminal</span></button>`);
    }

    card.body.innerHTML = `<div class="home-tiles">${tiles.join('')}</div>`;
    this._wireTerminalTiles(card);
  }

  /**
   * A tile lands you in that terminal; its assignment chip opens the spec or
   * task it is working on instead — reusing that section's tab when one is
   * already open, rather than stacking duplicates. New makes a terminal
   * (right-click picks the shell); +N more goes to Overview.
   */
  _wireTerminalTiles(card) {
    card.body.querySelectorAll('.home-tile[data-id]').forEach((tile) => {
      tile.addEventListener('click', () => this.onEnterLane(tile.dataset.id));
    });
    card.body.querySelectorAll('.home-tile-assign').forEach((chip) => {
      const go = (e) => {
        // The chip sits inside the tile, and the tile means "go to this
        // terminal" — without this the chip would do both.
        e.stopPropagation();
        const { assignKind, assignRef } = chip.dataset;
        if (!assignRef) return;
        if (assignKind === 'spec') require('./specSection').open(assignRef);
        else require('./taskSection').open(assignRef);
      };
      chip.addEventListener('click', go);
      chip.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); }
      });
    });

    const add = card.body.querySelector('.home-tile-new');
    if (add) {
      add.title = 'New Terminal — right-click to pick a shell';
      add.addEventListener('click', () => this._createLane());
      add.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this._showShellMenu(e.clientX, e.clientY);
      });
    }
    const more = card.body.querySelector('.home-tile-more');
    if (more) more.addEventListener('click', () => this.onOpenTerminals && this.onOpenTerminals());
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

// Waiting on the user first, then working, then busy, then idle.
function _attentionRank(status) {
  return { 'agent-approval': 0, 'agent-input': 1, 'agent-working': 2, running: 3, idle: 4 }[status] ?? 4;
}

module.exports = { LaneBoard };
