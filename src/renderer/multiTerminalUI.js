/**
 * Multi-Terminal UI Module
 * Orchestrates tab bar, grid, and terminal manager
 */

const { TerminalManager } = require('./terminalManager');
const { TerminalTabBar } = require('./terminalTabBar');
const { TerminalGrid } = require('./terminalGrid');
const overviewPanel = require('./overviewPanel');

class MultiTerminalUI {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.manager = new TerminalManager();
    this.tabBar = null;
    this.grid = null;
    this.contentContainer = null;
    this.initialized = false;
    this.autoCreateInitialTerminal = true; // Flag to control initial terminal creation
    this.isOverviewVisible = false; // Track if overview is shown
    this._mountedTerminalId = null; // Track which terminal is currently mounted to avoid unnecessary remounts

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

    // Initialize components
    this.tabBar = new TerminalTabBar(tabBarContainer, this.manager);
    this.grid = new TerminalGrid(this.contentContainer, this.manager);

    // Initialize overview panel (creates structure map overlay)
    overviewPanel.init();

    // Wire up overview toggle callback
    this.tabBar.onOverviewToggle = () => this.toggleOverview();

    // Listen for state changes
    this.manager.onStateChange = (state) => this._onStateChange(state);

    // Keyboard shortcuts are now registered centrally via commandRegistry
    // (see src/renderer/index.js). Terminal actions are exposed as public
    // methods on this class for the registry to invoke.

    // Create first terminal (global terminal for initial state)
    if (this.autoCreateInitialTerminal) {
      this.manager.createTerminal({ projectPath: null }).then(() => {
        this.initialized = true;
      });
    } else {
      this.initialized = true;
    }
  }

  /**
   * Set current project and switch terminal view
   * @param {string|null} projectPath - Project path or null for global
   */
  setCurrentProject(projectPath) {
    this.manager.setCurrentProject(projectPath);

    // Update UI to show terminals for current project
    this._onStateChange({
      terminals: this.manager.getTerminalStates(),
      activeTerminalId: this.manager.activeTerminalId,
      viewMode: this.manager.viewMode,
      gridLayout: this.manager.gridLayout,
      currentProjectPath: projectPath
    });
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

  /**
   * Handle state changes
   */
  _onStateChange(state) {
    // Update tab bar
    this.tabBar.update(state);

    // Render based on view mode
    if (state.viewMode === 'tabs') {
      this._renderTabView(state);
    } else {
      this._renderGridView(state);
    }
  }

  /**
   * Render tab view (single terminal)
   */
  _renderTabView(state) {
    // Reset grid styles if switching from grid view
    this.contentContainer.className = 'terminal-content tab-view';
    this.contentContainer.style.display = '';
    this.contentContainer.style.gridTemplateRows = '';
    this.contentContainer.style.gridTemplateColumns = '';
    this.contentContainer.style.gap = '';
    this.contentContainer.style.backgroundColor = '';

    // If the active terminal hasn't changed and we're not switching from grid, skip remount
    const switchingFromGrid = this._lastViewMode === 'grid';
    this._lastViewMode = 'tabs';
    if (!switchingFromGrid && this._mountedTerminalId === state.activeTerminalId && state.terminals.length > 0) {
      return;
    }

    // Active terminal changed — full remount
    this._mountedTerminalId = state.activeTerminalId;
    this.contentContainer.innerHTML = '';

    const contentArea = document.createElement('div');
    contentArea.className = 'tab-content-area';
    contentArea.style.height = '100%';
    contentArea.style.width = '100%';
    contentArea.style.position = 'relative';
    this.contentContainer.appendChild(contentArea);

    // Check if there are any terminals for current project
    if (state.terminals.length === 0) {
      this._mountedTerminalId = null;
      const emptyState = document.createElement('div');
      emptyState.className = 'terminal-empty-state';
      emptyState.innerHTML = `
        <div class="empty-state-content">
          <p>No terminals for this project</p>
          <p class="shortcut-hint">Press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd> to create a new terminal</p>
        </div>
      `;
      contentArea.appendChild(emptyState);
      return;
    }

    if (state.activeTerminalId) {
      this.manager.mountTerminal(state.activeTerminalId, contentArea);
    }

    // Add scroll-to-bottom button after mount (mountTerminal clears container)
    const scrollBtn = document.createElement('button');
    scrollBtn.className = 'btn-scroll-bottom-overlay';
    scrollBtn.title = 'Scroll to bottom';
    scrollBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    scrollBtn.addEventListener('click', () => this.manager.scrollActiveToBottom());
    contentArea.appendChild(scrollBtn);

    setTimeout(() => this.manager.fitAll(), 100);
  }

  /**
   * Render grid view (multiple terminals)
   */
  _renderGridView(state) {
    this._lastViewMode = 'grid';
    this.contentContainer.className = 'terminal-content grid-view';
    this.grid.render(state.terminals, state.gridLayout);

    // Fit after render
    setTimeout(() => this.manager.fitAll(), 50);
  }

  /**
   * Switch to next/previous terminal. Public so command registry can call it.
   */
  switchTerminal(direction) {
    return this._switchTerminal(direction);
  }

  /**
   * Switch to terminal at index (0-based). No-op if out of range.
   */
  setActiveTerminalByIndex(index) {
    const terminals = this.manager.getTerminalStates();
    if (index >= 0 && index < terminals.length) {
      this.manager.setActiveTerminal(terminals[index].id);
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

  /**
   * Toggle between tabs and grid view modes.
   */
  toggleViewMode() {
    const newMode = this.manager.viewMode === 'tabs' ? 'grid' : 'tabs';
    this.manager.setViewMode(newMode);
  }

  _switchTerminal(direction) {
    const terminals = this.manager.getTerminalStates();
    if (terminals.length <= 1) return;

    const currentIndex = terminals.findIndex(t => t.id === this.manager.activeTerminalId);
    let newIndex = currentIndex + direction;

    // Wrap around
    if (newIndex < 0) newIndex = terminals.length - 1;
    if (newIndex >= terminals.length) newIndex = 0;

    this.manager.setActiveTerminal(terminals[newIndex].id);
  }

  // Public API for backward compatibility

  /**
   * Fit all terminals
   */
  fitTerminal() {
    this.manager.fitAll();
  }

  /**
   * Send command to active terminal or specific terminal
   */
  sendCommand(command, terminalId = null) {
    this.manager.sendCommand(command, terminalId);
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
    this.contentContainer.innerHTML = '';
    this.contentContainer.className = 'terminal-content overview-view';
    this.contentContainer.style.display = '';
    this.contentContainer.style.gridTemplateRows = '';
    this.contentContainer.style.gridTemplateColumns = '';
    this.contentContainer.style.gap = '';
    this.contentContainer.style.backgroundColor = '';

    // Render overview
    overviewPanel.render(this.contentContainer);

    // Update tab bar to show overview as active
    this.tabBar.setOverviewActive(true);
  }

  /**
   * Hide overview panel and return to terminals
   */
  hideOverview() {
    this.isOverviewVisible = false;
    this.tabBar.setOverviewActive(false);

    // Re-render terminal view
    this._onStateChange({
      terminals: this.manager.getTerminalStates(),
      activeTerminalId: this.manager.activeTerminalId,
      viewMode: this.manager.viewMode,
      gridLayout: this.manager.gridLayout,
      currentProjectPath: this.manager.getCurrentProject()
    });
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
