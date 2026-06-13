/**
 * Multi-Terminal UI Module
 * Orchestrates the lane board (home), the detail view and the terminal manager.
 *
 * View modes:
 *   'board'  — Lane Orchestrator home screen (lane cards, default on launch)
 *   'detail' — entered by clicking a lane card; has its own layout:
 *              1x1 = one mounted terminal, larger layouts (1x2, 2x2, ...) =
 *              assignable grid cells with New Lane placeholders
 */

const { TerminalManager } = require('./terminalManager');
const { TerminalTabBar } = require('./terminalTabBar');
const { TerminalGrid } = require('./terminalGrid');
const { LaneBoard } = require('./laneBoard');
const laneStatus = require('./laneStatus');
const agentDispatch = require('./agentDispatch');
const laneDetailRail = require('./laneDetailRail');
const overviewPanel = require('./overviewPanel');
const taskSection = require('./taskSection');
const specSection = require('./specSection');

class MultiTerminalUI {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.manager = new TerminalManager();
    this.tabBar = null;
    this.grid = null;
    this.board = null;
    this.contentContainer = null;
    this.initialized = false;
    this.isOverviewVisible = false; // Track if overview is shown
    this.sections = [];             // Open section tabs (task/spec detail instances)
    this.activeSectionKey = null;   // Which section tab is focused
    this.isSectionVisible = false;  // A section tab is currently the on-screen surface
    this._mountedTerminalId = null; // Track which terminal is currently mounted to avoid unnecessary remounts
    this._lastViewMode = null;

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
    this.grid = new TerminalGrid(this.manager, {
      onAssign: (cellIndex, terminalId) => this._assignCell(cellIndex, terminalId),
      onNewLane: (cellIndex) => this._newLaneInCell(cellIndex),
      onMaximize: (terminalId) => {
        this.manager.setActiveTerminal(terminalId);
        this.manager.setGridLayout('1x1');
      }
    });
    this._cellAssignments = [];
    this.board = new LaneBoard(this.manager, {
      onEnterLane: (terminalId) => this.enterLane(terminalId)
    });

    // Initialize overview panel (creates structure map overlay)
    overviewPanel.init();

    // Wire up top bar callbacks
    this.tabBar.onOverviewToggle = () => this.toggleOverview();
    this.tabBar.onGoHome = () => this.goHome();
    this.tabBar.onEnterFrames = () => this.enterFrames();
    this.tabBar.onEnterLane = (terminalId) => this.enterLane(terminalId);
    this.tabBar.onLaneCreated = (terminalId) => this.enterLane(terminalId);
    this.tabBar.onActivateSection = (key) => this.activateSection(key);
    this.tabBar.onCloseSection = (key) => this.closeSection(key);

    // Detail sections (task / spec) open through us — we own the tab
    // collection and what the content area shows. Several can be open at once.
    taskSection.setHost(this);
    specSection.setHost(this);

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
      gridLayout: this.manager.gridLayout,
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
   * Enter a lane: make it active and show its full terminal view.
   * A pinned section stays open (chip in the bar) but leaves the screen.
   */
  enterLane(terminalId) {
    this.isSectionVisible = false; // section tabs stay open, just leave the screen
    this.manager.setActiveTerminal(terminalId);
    this.manager.setViewMode('detail');
    this._onStateChange(this._currentState());
  }

  /**
   * Enter the Frames surface from the top-bar tab: open the active Frame's
   * detail view (falling back to the first open lane). No-op with no lanes.
   */
  enterFrames() {
    const terminals = this.manager.getTerminalStates();
    if (terminals.length === 0) return;
    const activeId = this.manager.activeTerminalId;
    const target = terminals.some(t => t.id === activeId) ? activeId : terminals[0].id;
    this.enterLane(target);
  }

  /**
   * Return to the lane board.
   */
  goHome() {
    if (this.isOverviewVisible) this.hideOverview();
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
    // Closing the last lane while inside detail/grid lands the user back on the board
    if (state.viewMode !== 'board' && state.terminals.length === 0) {
      this.manager.setViewMode('board');
      return;
    }

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
    } else {
      this._renderDetailView(state);
    }
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

  _detailRailCallbacks() {
    return {
      onEnterLane: (terminalId) => this.enterLane(terminalId),
      onLayoutChange: () => setTimeout(() => this.manager.fitAll(), 60)
    };
  }

  /**
   * Render detail view: a layout of assignable cells (1x1 = one cell, every
   * cell carries its own header bar) + the collapsible lanes rail. The cell
   * header is the single home of the lane name/switcher — the top bar only
   * keeps Home, so nothing is duplicated between layouts.
   */
  _renderDetailView(state) {
    this.contentContainer.className = 'terminal-content detail-view';
    this._clearGridInlineStyles();

    const gridLayout = state.gridLayout || '1x1';
    this._lastViewMode = 'detail';
    this._mountedTerminalId = null;
    this.contentContainer.innerHTML = '';

    const layout = document.createElement('div');
    layout.className = 'detail-layout';
    this.contentContainer.appendChild(layout);

    const contentArea = document.createElement('div');
    contentArea.className = 'detail-content-area';
    contentArea.style.position = 'relative';
    layout.appendChild(contentArea);

    this._detailRailEl = document.createElement('div');
    layout.appendChild(this._detailRailEl);
    laneDetailRail.render(this._detailRailEl, state, this._detailRailCallbacks());

    this._ensureAssignments(state, gridLayout);
    this.grid.render(contentArea, this._cellAssignments, gridLayout);

    setTimeout(() => this.manager.fitAll(), 100);
  }

  /**
   * Keep cell assignments valid for the current layout: drop closed lanes,
   * guarantee the active lane occupies a cell, fill fresh layouts with the
   * open lanes in order. Empty cells stay null → "New Lane" placeholders.
   */
  _ensureAssignments(state, gridLayout) {
    const { GRID_LAYOUTS } = require('./terminalGrid');
    const config = GRID_LAYOUTS[gridLayout] || { rows: 2, cols: 2 };
    const cellCount = config.rows * config.cols;
    const openIds = state.terminals.map(t => t.id);

    // Drop stale ids, resize to cell count
    const cells = this._cellAssignments
      .slice(0, cellCount)
      .map(id => (id && openIds.includes(id) ? id : null));
    while (cells.length < cellCount) cells.push(null);

    // Active lane must be visible — first empty cell, else take over cell 0
    if (state.activeTerminalId && !cells.includes(state.activeTerminalId)) {
      const slot = cells.indexOf(null);
      cells[slot >= 0 ? slot : 0] = state.activeTerminalId;
    }

    // Auto-fill remaining empty cells with open lanes that aren't shown yet —
    // "New Lane" placeholders only appear once every open lane has a cell.
    const unassigned = openIds.filter(id => !cells.includes(id));
    for (let i = 0; i < cells.length && unassigned.length > 0; i++) {
      if (cells[i] === null) cells[i] = unassigned.shift();
    }

    this._cellAssignments = cells;
  }

  _assignCell(cellIndex, terminalId) {
    // If the lane already lives in another cell, swap the two cells
    const existingIndex = this._cellAssignments.indexOf(terminalId);
    if (existingIndex >= 0 && existingIndex !== cellIndex) {
      this._cellAssignments[existingIndex] = this._cellAssignments[cellIndex];
    }
    this._cellAssignments[cellIndex] = terminalId;
    this.manager.setActiveTerminal(terminalId);
    this._onStateChange(this._currentState());
  }

  async _newLaneInCell(cellIndex) {
    const newId = await this.createTerminalForCurrentProject();
    if (!newId) return;
    this._cellAssignments[cellIndex] = newId;
    this.manager.setActiveTerminal(newId);
    this._onStateChange(this._currentState());
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

    if (this.manager.viewMode === 'board' && !this.isOverviewVisible) {
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
   * Show overview panel
   */
  showOverview() {
    this.isOverviewVisible = true;
    this._mountedTerminalId = null;
    this._lastViewMode = 'overview';
    this.contentContainer.innerHTML = '';
    this.contentContainer.className = 'terminal-content overview-view';
    this._clearGridInlineStyles();

    // Render overview
    overviewPanel.render(this.contentContainer);

    // Update tab bar to show overview as active
    this.tabBar.setOverviewActive(true);
  }

  /**
   * Hide overview panel and return to the current view mode
   */
  hideOverview() {
    this.isOverviewVisible = false;
    this.tabBar.setOverviewActive(false);

    // Re-render current view
    this._onStateChange(this._currentState());
  }

  /**
   * Toggle overview panel
   */
  toggleOverview() {
    if (this.isOverviewVisible) {
      this.hideOverview();
    } else {
      this.showOverview();
    }
  }
}

module.exports = { MultiTerminalUI };
