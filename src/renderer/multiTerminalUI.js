/**
 * Multi-Terminal UI Module
 * Orchestrates Home, the Terminals section and the terminal manager.
 *
 * View modes:
 *   'terminals' — default on project selection: the Terminals section, which
 *                 owns its own tab strip (Overview + one tab per opened
 *                 terminal) inside terminalsView
 *   'board'     — Home (via the top bar's Home)
 *   'specs'     — specs card-grid dashboard mounted inline in the center
 *   'tasks'     — tasks kanban dashboard mounted inline in the center
 *                 (both: center-specs-tasks-views spec)
 *   'panel'     — a legacy side panel (GitHub/Claude/Prompts/Activity/
 *                 History) mounted inline in the center; which one is in
 *                 _activePanelKey (retire-rail-and-panels spec)
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

const { TerminalManager } = require('./terminalManager');
const { TerminalTabBar } = require('./terminalTabBar');
const { TerminalsView } = require('./terminalsView');
const { LaneBoard } = require('./laneBoard');
const laneStatus = require('./laneStatus');
const agentDispatch = require('./agentDispatch');
const decisionsView = require('./decisionsView');
const taskSection = require('./taskSection');
const specSection = require('./specSection');
const diffSection = require('./diffSection');
const notify = require('./notify');

// Legacy side panels hosted inline in the center (retire-rail-and-panels
// spec). Each entry keeps the module's own show()/hide() as the data/close
// contract — the host only re-parents the element and watches for closes.
const PANEL_REGISTRY = {
  github:   { elementId: 'github-panel',   module: () => require('./githubPanel') },
  claude:   { elementId: 'plugins-panel',  module: () => require('./pluginsPanel') },
  prompts:  { elementId: 'prompts-panel',  module: () => require('./promptsPanel') },
  activity: { elementId: 'activity-panel', module: () => require('./activityPanel') }
};

class MultiTerminalUI {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.manager = new TerminalManager();
    this.tabBar = null;
    this.board = null;
    this.contentContainer = null;
    this.initialized = false;
    this.isDecisionsVisible = false; // Track if the decisions view is shown
    this.terminalsInStrip = true;   // Terminals sits in the top bar until dropped
    this.sections = [];             // Open section tabs (task/spec detail instances)
    this.activeSectionKey = null;   // Which section tab is focused
    this.isSectionVisible = false;  // A section tab is currently the on-screen surface
    this._mountedTerminalId = null; // Track which terminal is currently mounted to avoid unnecessary remounts
    this._lastViewMode = null;
    this._activePanelKey = null;    // Which PANEL_REGISTRY entry the 'panel' view shows
    this._mountedPanelKey = null;   // Which panel element currently lives in the center
    this._panelHome = new Map();    // panel key -> original DOM parent
    this._panelObserver = null;     // watches the mounted panel's own close

    this._setup();
  }

  /**
   * Setup UI structure
   */
  _setup() {
    // Clear container
    this.container.innerHTML = '';
    this.container.className = 'multi-terminal-wrapper';

    // Create wrapper structure
    const tabBarContainer = document.createElement('div');
    tabBarContainer.className = 'terminal-tab-bar-container';

    this.contentContainer = document.createElement('div');
    this.contentContainer.className = 'terminal-content';

    this.container.appendChild(tabBarContainer);
    this.container.appendChild(this.contentContainer);

    // Lane activity detection needs the manager to read xterm buffers
    laneStatus.init(this.manager);

    // Agent dispatch delivers prompts into lanes through us
    agentDispatch.init(this);

    // Initialize components
    this.tabBar = new TerminalTabBar(tabBarContainer, this.manager);
    this.board = new LaneBoard(this.manager, {
      onEnterLane: (terminalId) => this.enterLane(terminalId)
    });
    this.terminalsView = new TerminalsView(this.manager, {
      onNewTerminal: () => this._createLaneOrNotify()
    });

    // Structure map overlay (its own sidebar item since Overview retired)
    require('./structureMap').init();

    // Wire up top bar callbacks
    this.tabBar.onGoHome = () => this.goHome();
    this.tabBar.onEnterTerminals = () => this.showTerminals();
    this.tabBar.onDropTerminals = () => this.dropTerminalsFromStrip();
    this.tabBar.onLaneCreated = (terminalId) => this.enterLane(terminalId);
    this.tabBar.onActivateSection = (key) => this.activateSection(key);
    this.tabBar.onCloseSection = (key) => this.closeSection(key);

    // Detail sections (task / spec) open through us — we own the tab
    // collection and what the content area shows. Several can be open at once.
    taskSection.setHost(this);
    specSection.setHost(this);
    diffSection.setHost(this);

    // Dashboards render inline in the center; every legacy entry point
    // (show/toggle, deep links, palette) routes through these hosts.
    require('./specsDashboard').setInlineHost({
      open: () => this.showSpecsGrid(),
      close: () => this.showTerminals()
    });
    require('./tasksDashboard').setInlineHost({
      open: () => this.showTasksBoard(),
      close: () => this.showTerminals()
    });

    // Listen for state changes
    this.manager.onStateChange = (state) => this._onStateChange(state);

    // No terminal is auto-created anymore — the app launches on the lane
    // board, which shows its empty state until the user creates a lane.
    this.initialized = true;
    this._onStateChange(this._currentState());
  }

  _currentState() {
    return {
      terminals: this.manager.getTerminalStates(),
      activeTerminalId: this.manager.activeTerminalId,
      viewMode: this.manager.viewMode,
      terminalsInStrip: this.terminalsInStrip,
      currentProjectPath: this.manager.getCurrentProject()
    };
  }

  /**
   * Set current project and switch terminal view
   * @param {string|null} projectPath - Project path or null for global
   */
  setCurrentProject(projectPath) {
    // Pinned section tabs belong to the previous project — drop them all
    this._disposeAllSections();

    this.manager.setCurrentProject(projectPath);

    // Update UI to show terminals for current project
    this._onStateChange(this._currentState());
  }

  /**
   * Create a new terminal for the current project
   * @param {Object} options - Terminal options
   * @param {string} options.shell - Shell path to use (optional)
   */
  async createTerminalForCurrentProject(options = {}) {
    const projectPath = this.manager.getCurrentProject();
    return this.manager.createTerminal({
      ...options,
      projectPath
    });
  }

  /**
   * Create a terminal for the current project, surfacing both failure
   * routes (per-project cap → null, backend failure → rejection) as an
   * error toast. Returns the new terminal id, or null on failure.
   */
  async _createLaneOrNotify() {
    let id = null;
    try {
      id = await this.createTerminalForCurrentProject();
    } catch (err) {
      notify.error(`Could not create a new terminal: ${err.message || 'terminal creation failed'}`);
      return null;
    }
    if (!id) {
      notify.error(`Could not create a new terminal — maximum (${this.manager.maxTerminals}) reached for this project`);
      return null;
    }
    return id;
  }

  /**
   * Get available shells
   * @returns {Promise<Array<{id: string, name: string, path: string}>>}
   */
  async getAvailableShells() {
    return this.manager.getAvailableShells();
  }

  /**
   * Check if there are terminals for the current project
   */
  hasTerminalsForCurrentProject() {
    return this.manager.hasTerminalsForCurrentProject();
  }

  /**
   * Get current project path
   */
  getCurrentProject() {
    return this.manager.getCurrentProject();
  }

  // ─── Lane navigation ────────────────────────────────────

  /**
   * Enter a terminal: go to the Terminals section and open — or focus — that
   * terminal's own tab. The single choke point every caller routes through:
   * Home's cards, the rail, agentDispatch, the palette, the orchestrator.
   *
   * A pinned section stays open (chip in the bar) but leaves the screen.
   */
  enterLane(terminalId) {
    this.isSectionVisible = false; // section tabs stay open, just leave the screen
    this.terminalsInStrip = true;  // going there restores it to the strip
    // Write the tab into the prefs before the render, so the section draws
    // its strip and body once, already showing this terminal.
    this.terminalsView.openTab(terminalId, { render: false });
    this.manager.setActiveTerminal(terminalId);
    this.manager.setViewMode('terminals');
    this._onStateChange(this._currentState());
  }

  /**
   * Return to the lane board.
   */
  goHome() {
    if (this.isDecisionsVisible) this.hideDecisions();
    this.isSectionVisible = false; // section tabs stay open, just leave the screen
    this.manager.setViewMode('board');
    this._onStateChange(this._currentState());
  }

  // ─── Pinned section tabs (task / spec detail surfaces) ───
  //
  // Several sections can be open at once; each is an independent instance
  // (taskSection/specSection) tracked here as a tab. Only the active one is
  // rendered into the content area, and only while isSectionVisible is true.

  /**
   * Open a detail item (task/spec) in a section viewport. By default this
   * reuses an existing viewport of the same type — navigating it in place so
   * browsing doesn't spawn tabs. `newTab` forces a fresh viewport.
   * @param {'task'|'spec'} type
   * @param {*} itemRef   id (task) or slug (spec)
   * @param {object} factory  the section module ({ createViewport })
   */
  openSection(type, itemRef, factory, { newTab = false } = {}) {
    let vp = null;
    if (!newTab) {
      // Prefer the active viewport if it's the right type, else the first one
      const active = this._activeSection();
      vp = (active && active.type === type)
        ? active
        : this.sections.find(s => s.type === type) || null;
    }
    if (!vp) {
      vp = factory.createViewport();
      this.sections.push(vp);
    }
    this.activeSectionKey = vp.key;
    this.isSectionVisible = true;
    vp.navigate(itemRef); // sets the item + triggers notifySectionChanged → re-render
  }

  /** Focus an already-open section tab and show it. */
  activateSection(key) {
    if (!this.sections.some(s => s.key === key)) return;
    this.activeSectionKey = key;
    this.isSectionVisible = true;
    this._onStateChange(this._currentState());
  }

  /** Close a section tab. Closing the active one drops back to the view beneath. */
  closeSection(key) {
    const idx = this.sections.findIndex(s => s.key === key);
    if (idx === -1) return;
    const [removed] = this.sections.splice(idx, 1);
    removed.dispose();
    if (this.activeSectionKey === key) {
      this.activeSectionKey = null;
      this.isSectionVisible = false; // reveal the board/detail surface underneath
    }
    this._onStateChange(this._currentState());
  }

  /** Leave the section surface without closing any tab (e.g. command sent). */
  hideSections() {
    this.isSectionVisible = false;
    this._onStateChange(this._currentState());
  }

  /** A section's data changed — refresh the bar + active surface. */
  notifySectionChanged() {
    this._onStateChange(this._currentState());
  }

  _activeSection() {
    return this.sections.find(s => s.key === this.activeSectionKey) || null;
  }

  _disposeAllSections() {
    this.sections.forEach(s => s.dispose());
    this.sections = [];
    this.activeSectionKey = null;
    this.isSectionVisible = false;
  }

  /**
   * Handle state changes
   */
  _onStateChange(state) {
    // Keep the sidebar's workspace nav (Terminals count / active state) fresh
    try {
      require('./projectListUI').updateWorkspaceNav(state);
    } catch (_) { /* sidebar not initialized yet */ }

    // The inline dashboards live inside contentContainer — whenever the
    // center is about to show anything else, hand their elements back to the
    // overlay parent before the render below wipes the container.
    const surface = (this.isSectionVisible && this._activeSection()) ? 'section' : state.viewMode;
    if (surface !== 'specs') require('./specsDashboard').notifyDetached();
    if (surface !== 'tasks') require('./tasksDashboard').notifyDetached();
    if (surface !== 'panel') this._detachPanel();

    // Top bar needs the open section tabs (chips) + which one is active
    const active = this.isSectionVisible ? this._activeSection() : null;
    state.sections = this.sections.map(s => ({ key: s.key, ...s.getChip() }));
    state.activeSectionKey = active ? active.key : null;

    // Update top bar
    this.tabBar.update(state);

    // The active section takes over the content area while visible
    if (active) {
      this._renderSectionView(active);
      return;
    }

    // Render based on view mode
    if (state.viewMode === 'board') {
      this._renderBoardView(state);
    } else if (state.viewMode === 'specs') {
      this._renderDashView('specs', require('./specsDashboard'));
    } else if (state.viewMode === 'tasks') {
      this._renderDashView('tasks', require('./tasksDashboard'));
    } else if (state.viewMode === 'panel') {
      this._renderPanelView(state);
    } else {
      // 'terminals', and anything unrecognised — the default surface is the
      // one place it is always safe to land.
      this._renderTerminalsView(state);
    }
  }

  // ─── Inline panel hosting (retire-rail-and-panels spec) ───

  /** Show a legacy side panel as the center view. */
  showPanel(key) {
    if (!PANEL_REGISTRY[key]) return;
    if (this.isDecisionsVisible) this.hideDecisions();
    this.isSectionVisible = false;
    this._activePanelKey = key;
    if (this.manager.viewMode === 'panel') {
      this._onStateChange(this._currentState());
    } else {
      this.manager.setViewMode('panel');
    }
  }

  /** Toggle a panel: showing it again returns to the terminals view. */
  togglePanel(key) {
    const onIt = this.manager.viewMode === 'panel'
      && this._activePanelKey === key
      && !this.isSectionVisible
      && !this.isDecisionsVisible;
    if (onIt) this.showTerminals();
    else this.showPanel(key);
  }

  _renderPanelView() {
    const key = this._activePanelKey;
    const entry = PANEL_REGISTRY[key];
    const el = entry && document.getElementById(entry.elementId);
    if (!el) {
      this.showTerminals();
      return;
    }
    if (this._mountedPanelKey && this._mountedPanelKey !== key) this._detachPanel();

    this._lastViewMode = 'panel';
    this._mountedTerminalId = null;

    // Same idempotence as _renderDashView: an already-mounted panel keeps
    // itself fresh; remounting would re-run its show() (data reload) on
    // every state change.
    if (this._mountedPanelKey === key && this.contentContainer.contains(el)) return;
    this.contentContainer.className = 'terminal-content panel-view';
    this._clearGridInlineStyles();
    this.contentContainer.innerHTML = '';

    if (!this._panelHome.has(key)) this._panelHome.set(key, el.parentNode);
    el.classList.add('panel-inline');
    this.contentContainer.appendChild(el);
    this._mountedPanelKey = key;

    // The module's own show() keeps owning data loading and the .visible flag
    try {
      entry.module().show();
    } catch (err) {
      console.error(`Failed to open panel '${key}':`, err);
    }

    // The panel's own close paths (× button, internal hide calls) only drop
    // its .visible class — watch for that and route back to the terminals
    // view, so no per-module host awareness is needed.
    if (this._panelObserver) this._panelObserver.disconnect();
    this._panelObserver = new MutationObserver(() => {
      if (this._mountedPanelKey === key
        && this.manager.viewMode === 'panel'
        && !el.classList.contains('visible')) {
        this.showTerminals();
      }
    });
    this._panelObserver.observe(el, { attributes: true, attributeFilter: ['class'] });
  }

  /** Return the mounted panel element to its original DOM slot. */
  _detachPanel() {
    if (this._panelObserver) {
      this._panelObserver.disconnect();
      this._panelObserver = null;
    }
    const key = this._mountedPanelKey;
    if (!key) return;
    this._mountedPanelKey = null;
    const entry = PANEL_REGISTRY[key];
    const el = entry && document.getElementById(entry.elementId);
    if (!el) return;
    try { entry.module().hide(); } catch (_) { /* already hidden */ }
    el.classList.remove('panel-inline');
    const home = this._panelHome.get(key);
    if (home && el.parentNode !== home) home.appendChild(el);
  }

  /**
   * Mount an inline dashboard (specs grid / tasks kanban) as the center view.
   */
  _renderDashView(mode, dashboard) {
    this._lastViewMode = mode;
    this._mountedTerminalId = null;
    // Already mounted → its own IPC listeners keep it fresh. Remounting here
    // would re-run the load (WATCH_SPECS/LOAD_TASKS) on every state change;
    // with a spec/task section chip open, those pushes feed back through
    // notifySectionChanged into this render — an IPC storm that pegged the
    // CPU. The guard breaks that cycle.
    if (dashboard.isInlineMounted() && this.contentContainer.contains(document.querySelector(`.${mode}-dashboard.inline`))) {
      return;
    }
    this.contentContainer.className = `terminal-content ${mode}-dash-view`;
    this._clearGridInlineStyles();
    this.contentContainer.innerHTML = '';
    dashboard.mountInline(this.contentContainer);
  }

  /**
   * Specs entry point (sidebar nav): lifecycle-first. Opens the most relevant
   * active spec in the linear detail surface (specSection, with its list
   * rail); a project with no specs lands on the inline grid, which owns the
   * New Spec flow.
   */
  async showSpecs() {
    const projectPath = this.manager.getCurrentProject();
    if (!projectPath) {
      this.showSpecsGrid(); // surfaces the "no project" notice
      return;
    }
    let specs = [];
    try {
      specs = await ipcRenderer.invoke(IPC.LIST_SPECS, projectPath) || [];
    } catch (_) { /* fall through to the grid */ }
    const order = ['implementing', 'tasks_generated', 'planned', 'specified', 'draft'];
    const top = specs
      .filter(s => s.phase !== 'done' && !s.malformed)
      .sort((a, b) => order.indexOf(a.phase) - order.indexOf(b.phase))[0]
      || specs.find(s => !s.malformed)
      || specs[0];
    if (top) {
      require('./specSection').open(top.slug);
    } else {
      this.showSpecsGrid();
    }
  }

  /** Show the specs card grid inline (dashboard's own switch also lands here). */
  showSpecsGrid() {
    if (this.isDecisionsVisible) this.hideDecisions();
    this.isSectionVisible = false;
    this.manager.setViewMode('specs');
  }

  /** Show the tasks kanban inline as the center view. */
  showTasksBoard() {
    if (this.isDecisionsVisible) this.hideDecisions();
    this.isSectionVisible = false;
    this.manager.setViewMode('tasks');
  }

  /**
   * What the center currently shows: 'terminals' | 'board' | 'specs' |
   * 'tasks' | 'decisions' | 'section:<type>'. Drives the sidebar
   * nav's active states.
   */
  getActiveSurface() {
    if (this.isDecisionsVisible) return 'decisions';
    if (this.isSectionVisible) {
      const s = this._activeSection();
      return s ? `section:${s.type}` : 'section';
    }
    if (this.manager.viewMode === 'panel') {
      return `panel:${this._activePanelKey || ''}`;
    }
    return this.manager.viewMode;
  }

  /**
   * Render the Terminals section (default): terminalsView owns the tab strip,
   * the Overview grid, the single-terminal body and their persistence.
   */
  _renderTerminalsView(state) {
    this._lastViewMode = 'terminals';
    this._mountedTerminalId = null;
    this.contentContainer.className = 'terminal-content terminals-view-mode';
    this._clearGridInlineStyles();
    this.terminalsView.render(this.contentContainer);
    setTimeout(() => this.manager.fitAll(), 100);
  }

  /**
   * Show the Terminals section (the sidebar's Work → Terminals entry point,
   * and the top bar's own chip). Dropped from the strip, this is what puts
   * it back — exactly as it was left, since nothing about the section was
   * touched by dropping it.
   */
  showTerminals() {
    if (this.isDecisionsVisible) this.hideDecisions();
    this.isSectionVisible = false;
    this.terminalsInStrip = true;
    this.manager.setViewMode('terminals');
  }

  /**
   * The × on the top bar's Terminals chip: drop it from the strip and
   * nothing else. The section, its open tabs, the Overview layout and every
   * running agent live on. Dropping it while looking at it lands the user on
   * Home; dropping it from elsewhere leaves them where they are.
   */
  dropTerminalsFromStrip() {
    this.terminalsInStrip = false;
    const onIt = this.manager.viewMode === 'terminals'
      && !this.isSectionVisible
      && !this.isDecisionsVisible;
    if (onIt) this.goHome();
    else this._onStateChange(this._currentState());
  }

  /**
   * Render the active pinned section (task or spec) as a full content view.
   */
  _renderSectionView(active) {
    if (!active) return;
    this._lastViewMode = 'section';
    this._mountedTerminalId = null;
    const viewClass = active.viewClass || 'section-view';
    this.contentContainer.className = `terminal-content ${viewClass}`;
    this._clearGridInlineStyles();
    this.contentContainer.innerHTML = '';
    active.render(this.contentContainer);
  }

  /**
   * Render the lane board (home screen)
   */
  _renderBoardView(state) {
    this._lastViewMode = 'board';
    this._mountedTerminalId = null;
    this.contentContainer.className = 'terminal-content board-view';
    this._clearGridInlineStyles();
    this.board.render(this.contentContainer, state);
  }

  _clearGridInlineStyles() {
    this.contentContainer.style.display = '';
    this.contentContainer.style.gridTemplateRows = '';
    this.contentContainer.style.gridTemplateColumns = '';
    this.contentContainer.style.gap = '';
    this.contentContainer.style.backgroundColor = '';
  }

  /**
   * Switch to next/previous lane. Public so command registry can call it.
   */
  switchTerminal(direction) {
    return this._switchTerminal(direction);
  }

  /**
   * Enter lane at index (0-based). No-op if out of range.
   */
  setActiveTerminalByIndex(index) {
    const terminals = this.manager.getTerminalStates();
    if (index >= 0 && index < terminals.length) {
      this.enterLane(terminals[index].id);
    }
  }

  /**
   * Close currently active terminal (only if more than one exists).
   */
  closeActiveTerminal() {
    if (this.manager.activeTerminalId && this.manager.terminals.size > 1) {
      this.manager.closeTerminal(this.manager.activeTerminalId);
    }
  }

  _switchTerminal(direction) {
    const terminals = this.manager.getTerminalStates();
    if (terminals.length === 0) return;
    if (terminals.length === 1) {
      this.enterLane(terminals[0].id);
      return;
    }

    const currentIndex = terminals.findIndex(t => t.id === this.manager.activeTerminalId);
    let newIndex = currentIndex + direction;

    // Wrap around
    if (newIndex < 0) newIndex = terminals.length - 1;
    if (newIndex >= terminals.length) newIndex = 0;

    this.enterLane(terminals[newIndex].id);
  }

  // Public API for backward compatibility

  /**
   * Fit all terminals
   */
  fitTerminal() {
    this.manager.fitAll();
  }

  /**
   * Send command to active terminal or specific terminal.
   * From the board, the target lane is revealed so the user sees the effect;
   * when no lane exists at all, one is created first.
   */
  sendCommand(command, terminalId = null) {
    const targetId = terminalId || this.manager.activeTerminalId;

    if (!targetId) {
      // Lanes belong to a project — without one there is nowhere to send
      if (!this.manager.getCurrentProject()) return;
      this.createTerminalForCurrentProject().then((newId) => {
        if (!newId) return;
        this.enterLane(newId);
        // Give the shell a moment to be ready before the first command
        setTimeout(() => this.manager.sendCommand(command, newId), 300);
      });
      return;
    }

    if (this.manager.viewMode === 'board' && !this.isDecisionsVisible) {
      this.enterLane(targetId);
    }
    this.manager.sendCommand(command, targetId);
  }

  /**
   * Set active terminal
   */
  setActiveTerminal(terminalId) {
    this.manager.setActiveTerminal(terminalId);
  }

  /**
   * Write to active terminal
   */
  writelnToTerminal(text) {
    this.manager.writeToActive(text + '\r\n');
  }

  /**
   * Get terminal manager
   */
  getManager() {
    return this.manager;
  }

  /**
   * True when the Terminals section is the surface on screen and a terminal is
   * focused — in an Overview pane or in its own tab. Not Home, not an open
   * section (task/spec) viewport, not the decisions list. Used by the sidebar
   * launch shortcut to decide between "start in the focused terminal" and
   * "open a new one".
   *
   * It was bound to the retired 'detail' mode, so it answered false on the
   * default view every single time and Start never used the focused terminal.
   */
  isViewingFrame() {
    return this.manager.viewMode === 'terminals'
      && !this.isSectionVisible
      && !this.isDecisionsVisible
      && !!this.manager.activeTerminalId;
  }

  /**
   * Show the Decisions view (decisions-view spec — replaces Overview)
   */
  showDecisions() {
    // Rendering bypasses _onStateChange — park inline surfaces first so the
    // container wipe below can't destroy their elements.
    require('./specsDashboard').notifyDetached();
    require('./tasksDashboard').notifyDetached();
    this._detachPanel();

    this.isDecisionsVisible = true;
    this._mountedTerminalId = null;
    this._lastViewMode = 'decisions';
    this.contentContainer.innerHTML = '';
    this.contentContainer.className = 'terminal-content decisions-view-host';
    this._clearGridInlineStyles();

    decisionsView.render(this.contentContainer);

    // Rendering bypassed _onStateChange — refresh the sidebar nav ourselves
    try {
      require('./projectListUI').updateWorkspaceNav();
    } catch (_) { /* sidebar not initialized yet */ }
  }

  /**
   * Hide the Decisions view and return to the current view mode
   */
  hideDecisions() {
    this.isDecisionsVisible = false;
    this._onStateChange(this._currentState());
  }

  toggleDecisions() {
    if (this.isDecisionsVisible) this.hideDecisions(); else this.showDecisions();
  }

  /**
   * Open the interactive structure map. It is an overlay, not a center view,
   * and since Overview retired this is its only entry point besides ⌘K.
   */
  showStructureMap() {
    const projectPath = require('./state').getProjectPath();
    if (!projectPath) {
      require('./taskInfoModal').open({
        title: 'No project selected',
        message: 'Select a project from the switcher to open its structure map.'
      });
      return;
    }
    require('./structureMap').show(projectPath);
  }

}

module.exports = { MultiTerminalUI };
