/**
 * Multi-Terminal UI Module
 * Orchestrates tab bar, grid, and terminal manager
 */

const { TerminalManager } = require('./terminalManager');
const { TerminalTabBar } = require('./terminalTabBar');
const { TerminalGrid } = require('./terminalGrid');

class MultiTerminalUI {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.manager = new TerminalManager();
    this.tabBar = null;
    this.grid = null;
    this.contentContainer = null;
    this.initialized = false;
    this.autoCreateInitialTerminal = true; // Flag to control initial terminal creation

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

    // Listen for state changes
    this.manager.onStateChange = (state) => this._onStateChange(state);

    // Setup keyboard shortcuts
    this._setupKeyboardShortcuts();

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
   */
  async createTerminalForCurrentProject(options = {}) {
    const projectPath = this.manager.getCurrentProject();
    return this.manager.createTerminal({
      ...options,
      projectPath
    });
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
    // Clear container and reset inline styles from grid
    this.contentContainer.innerHTML = '';
    this.contentContainer.className = 'terminal-content tab-view';
    this.contentContainer.style.display = '';
    this.contentContainer.style.gridTemplateRows = '';
    this.contentContainer.style.gridTemplateColumns = '';
    this.contentContainer.style.gap = '';
    this.contentContainer.style.backgroundColor = '';

    const contentArea = document.createElement('div');
    contentArea.className = 'tab-content-area';
    contentArea.style.height = '100%';
    contentArea.style.width = '100%';
    this.contentContainer.appendChild(contentArea);

    // Check if there are any terminals for current project
    if (state.terminals.length === 0) {
      // Show empty state message
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

    // Mount only active terminal
    if (state.activeTerminalId) {
      this.manager.mountTerminal(state.activeTerminalId, contentArea);
    }

    // Fit after render with slight delay
    setTimeout(() => this.manager.fitAll(), 100);
  }

  /**
   * Render grid view (multiple terminals)
   */
  _renderGridView(state) {
    this.contentContainer.className = 'terminal-content grid-view';
    this.grid.render(state.terminals, state.gridLayout);

    // Fit after render
    setTimeout(() => this.manager.fitAll(), 50);
  }

  /**
   * Setup keyboard shortcuts
   */
  _setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const modKey = e.ctrlKey || e.metaKey; // Support both Ctrl (Windows/Linux) and Cmd (macOS)
      const key = e.key.toLowerCase(); // Normalize key to lowercase

      // Ctrl/Cmd+Shift+T - New terminal for current project
      if (modKey && e.shiftKey && key === 't') {
        e.preventDefault();
        this.createTerminalForCurrentProject();
      }

      // Ctrl/Cmd+Shift+W - Close current terminal
      if (modKey && e.shiftKey && key === 'w') {
        e.preventDefault();
        if (this.manager.activeTerminalId && this.manager.terminals.size > 1) {
          this.manager.closeTerminal(this.manager.activeTerminalId);
        }
      }

      // Ctrl/Cmd+Tab - Next terminal
      if (modKey && e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        this._switchTerminal(1);
      }

      // Ctrl/Cmd+Shift+Tab - Previous terminal
      if (modKey && e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        this._switchTerminal(-1);
      }

      // Ctrl/Cmd+1-9 - Switch to terminal by number
      if (modKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        const terminals = this.manager.getTerminalStates();
        if (index < terminals.length) {
          this.manager.setActiveTerminal(terminals[index].id);
        }
      }

      // Ctrl/Cmd+Shift+G - Toggle grid view
      if (modKey && e.shiftKey && key === 'g') {
        e.preventDefault();
        const newMode = this.manager.viewMode === 'tabs' ? 'grid' : 'tabs';
        this.manager.setViewMode(newMode);
      }
    });
  }

  /**
   * Switch to next/previous terminal
   */
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
   * Send command to active terminal
   */
  sendCommand(command) {
    this.manager.sendCommand(command);
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
}

module.exports = { MultiTerminalUI };
