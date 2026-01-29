/**
 * Terminal Manager Module
 * Manages multiple terminal instances in the renderer
 */

const { ipcRenderer } = require('electron');
const { Terminal } = require('xterm');
const { FitAddon } = require('xterm-addon-fit');
const { IPC } = require('../shared/ipcChannels');

// Terminal theme (VS Code dark)
const terminalTheme = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#ffffff',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5'
};

// Session storage key
const SESSION_STORAGE_KEY = 'frame-terminal-sessions';
const GLOBAL_PROJECT_KEY = '__global__';

class TerminalManager {
  constructor() {
    this.terminals = new Map(); // Map<id, {terminal, fitAddon, element, state}>
    this.activeTerminalId = null;
    this.viewMode = 'tabs'; // 'tabs' or 'grid'
    this.gridLayout = '2x2';
    this.maxTerminals = 9;
    this.terminalCounter = 0;
    this.onStateChange = null;
    this.currentProjectPath = null; // Current active project (null = global)
    this._setupIPC();
  }

  /**
   * Set current project context
   * @param {string|null} projectPath - Project path or null for global
   */
  setCurrentProject(projectPath) {
    // Save current project session before switching
    if (this.currentProjectPath !== projectPath) {
      this.saveProjectSession(this.currentProjectPath);
    }

    this.currentProjectPath = projectPath;

    // Restore session for new project
    this.restoreProjectSession(projectPath);

    this._notifyStateChange();
  }

  /**
   * Get current project path
   */
  getCurrentProject() {
    return this.currentProjectPath;
  }

  /**
   * Get terminals for a specific project
   * @param {string|null} projectPath - Project path or null for global
   */
  getTerminalsByProject(projectPath) {
    return Array.from(this.terminals.values())
      .filter(t => t.state.projectPath === projectPath)
      .map(t => ({ ...t.state }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Save project session to localStorage
   * @param {string|null} projectPath - Project path or null for global
   */
  saveProjectSession(projectPath) {
    const sessionKey = projectPath || GLOBAL_PROJECT_KEY;
    const projectTerminals = this.getTerminalsByProject(projectPath);

    if (projectTerminals.length === 0) {
      return; // Nothing to save
    }

    const sessionData = {
      activeTerminalId: this.activeTerminalId,
      viewMode: this.viewMode,
      gridLayout: this.gridLayout,
      terminalNames: {} // Map of terminalId -> customName
    };

    // Save custom names
    projectTerminals.forEach(t => {
      if (t.customName) {
        sessionData.terminalNames[t.id] = t.customName;
      }
    });

    try {
      const allSessions = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || '{}');
      allSessions[sessionKey] = sessionData;
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(allSessions));
    } catch (err) {
      console.error('Failed to save terminal session:', err);
    }
  }

  /**
   * Restore project session from localStorage
   * @param {string|null} projectPath - Project path or null for global
   */
  restoreProjectSession(projectPath) {
    const sessionKey = projectPath || GLOBAL_PROJECT_KEY;

    try {
      const allSessions = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || '{}');
      const sessionData = allSessions[sessionKey];

      if (sessionData) {
        // Restore view settings
        if (sessionData.viewMode) {
          this.viewMode = sessionData.viewMode;
        }
        if (sessionData.gridLayout) {
          this.gridLayout = sessionData.gridLayout;
        }

        // Restore custom names for existing terminals
        const projectTerminals = this.getTerminalsByProject(projectPath);
        projectTerminals.forEach(t => {
          if (sessionData.terminalNames && sessionData.terminalNames[t.id]) {
            const instance = this.terminals.get(t.id);
            if (instance) {
              instance.state.customName = sessionData.terminalNames[t.id];
              instance.state.name = sessionData.terminalNames[t.id];
            }
          }
        });

        // Restore active terminal if it belongs to current project
        if (sessionData.activeTerminalId) {
          const terminal = this.terminals.get(sessionData.activeTerminalId);
          if (terminal && terminal.state.projectPath === projectPath) {
            this.setActiveTerminal(sessionData.activeTerminalId);
            return;
          }
        }
      }

      // If no valid active terminal found, select first terminal of current project
      const projectTerminals = this.getTerminalsByProject(projectPath);
      if (projectTerminals.length > 0) {
        this.setActiveTerminal(projectTerminals[0].id);
      } else {
        this.activeTerminalId = null;
      }
    } catch (err) {
      console.error('Failed to restore terminal session:', err);
    }
  }

  /**
   * Create a new terminal
   * @param {Object} options - Options for terminal creation
   * @param {string} options.cwd - Working directory
   * @param {string} options.projectPath - Associated project path (undefined = use current)
   * @param {string} options.name - Custom terminal name
   */
  async createTerminal(options = {}) {
    if (this.terminals.size >= this.maxTerminals) {
      console.error('Maximum terminal limit reached');
      return null;
    }

    // Use provided projectPath or current project
    const projectPath = options.projectPath !== undefined
      ? options.projectPath
      : this.currentProjectPath;

    // Working directory: use provided cwd, or project path, or home directory
    const workingDir = options.cwd || projectPath || null;

    return new Promise((resolve, reject) => {
      const handler = (event, response) => {
        ipcRenderer.removeListener(IPC.TERMINAL_CREATED, handler);
        if (response.success) {
          this._initializeTerminal(response.terminalId, {
            ...options,
            projectPath,
            cwd: workingDir
          });
          resolve(response.terminalId);
        } else {
          reject(new Error(response.error));
        }
      };

      ipcRenderer.on(IPC.TERMINAL_CREATED, handler);
      ipcRenderer.send(IPC.TERMINAL_CREATE, {
        cwd: workingDir,
        projectPath
      });
    });
  }

  /**
   * Initialize xterm.js instance for a terminal
   */
  _initializeTerminal(terminalId, options) {
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: terminalTheme,
      allowTransparency: false,
      scrollback: 10000
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    // Create container element
    const element = document.createElement('div');
    element.id = `terminal-${terminalId}`;
    element.className = 'terminal-instance';
    element.style.height = '100%';
    element.style.width = '100%';

    // Focus terminal on click anywhere in the container
    element.addEventListener('click', () => {
      terminal.focus();
    });

    const state = {
      id: terminalId,
      name: options.name || `Terminal ${++this.terminalCounter}`,
      customName: null,
      isActive: false,
      createdAt: Date.now(),
      projectPath: options.projectPath !== undefined ? options.projectPath : this.currentProjectPath
    };

    this.terminals.set(terminalId, { terminal, fitAddon, element, state });

    // Allow app-level shortcuts to pass through when terminal has focus
    terminal.attachCustomKeyEventHandler((event) => {
      const modKey = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      // Ctrl/Cmd + Shift combinations → pass to app
      if (modKey && event.shiftKey) {
        return false;
      }
      // Ctrl/Cmd + 1-9 → pass to app
      if (modKey && event.key >= '1' && event.key <= '9') {
        return false;
      }
      // Ctrl/Cmd + K (Start Claude) → pass to app
      if (modKey && key === 'k') {
        return false;
      }
      // Ctrl/Cmd + I (/init) → pass to app
      if (modKey && key === 'i') {
        return false;
      }
      // Ctrl/Cmd + H (history) → pass to app
      if (modKey && key === 'h') {
        return false;
      }
      // Ctrl/Cmd + B (sidebar toggle) → pass to app
      if (modKey && key === 'b') {
        return false;
      }
      // Ctrl/Cmd + E (project/file focus) → pass to app
      if (modKey && key === 'e') {
        return false;
      }
      // Ctrl/Cmd + T (tasks panel) → pass to app (without shift)
      if (modKey && !event.shiftKey && key === 't') {
        return false;
      }
      // Ctrl/Cmd + [ or ] (project navigation) → pass to app
      if (modKey && (event.key === '[' || event.key === ']')) {
        return false;
      }
      // Ctrl/Cmd + Tab → pass to app
      if (modKey && event.key === 'Tab') {
        return false;
      }
      // Let terminal handle everything else
      return true;
    });

    // Handle input
    terminal.onData((data) => {
      ipcRenderer.send(IPC.TERMINAL_INPUT_ID, { terminalId, data });
    });

    // If first terminal or no active terminal, make it active
    if (this.terminals.size === 1 || !this.activeTerminalId) {
      this.setActiveTerminal(terminalId);
    }

    this._notifyStateChange();
    return terminalId;
  }

  /**
   * Mount terminal in a container
   */
  mountTerminal(terminalId, container) {
    const instance = this.terminals.get(terminalId);
    if (instance && container) {
      // Clear container first
      container.innerHTML = '';

      // Ensure element has proper sizing
      instance.element.style.height = '100%';
      instance.element.style.width = '100%';

      container.appendChild(instance.element);

      // Open terminal if not already opened
      if (!instance.opened) {
        instance.terminal.open(instance.element);
        instance.opened = true;
      }

      // Fit after a short delay to ensure container is sized
      setTimeout(() => {
        instance.fitAddon.fit();
        this._sendResize(terminalId);
        // Focus if this is the active terminal
        if (this.activeTerminalId === terminalId) {
          instance.terminal.focus();
        }
      }, 50);
    }
  }

  /**
   * Set active terminal
   */
  setActiveTerminal(terminalId) {
    // Update previous active
    if (this.activeTerminalId) {
      const prev = this.terminals.get(this.activeTerminalId);
      if (prev) prev.state.isActive = false;
    }

    // Set new active
    this.activeTerminalId = terminalId;
    const current = this.terminals.get(terminalId);
    if (current) {
      current.state.isActive = true;
      current.terminal.focus();
    }

    this._notifyStateChange();
  }

  /**
   * Rename terminal
   */
  renameTerminal(terminalId, newName) {
    const instance = this.terminals.get(terminalId);
    if (instance) {
      instance.state.customName = newName;
      instance.state.name = newName;
      this._notifyStateChange();
    }
  }

  /**
   * Close terminal
   */
  closeTerminal(terminalId) {
    const instance = this.terminals.get(terminalId);
    if (instance) {
      instance.terminal.dispose();
      instance.element.remove();
      this.terminals.delete(terminalId);
      ipcRenderer.send(IPC.TERMINAL_DESTROY, terminalId);

      // Switch to another terminal if closing active
      if (this.activeTerminalId === terminalId) {
        const remaining = Array.from(this.terminals.keys());
        this.activeTerminalId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
        if (this.activeTerminalId) {
          this.setActiveTerminal(this.activeTerminalId);
        }
      }

      this._notifyStateChange();
    }
  }

  /**
   * Set view mode
   */
  setViewMode(mode) {
    this.viewMode = mode;
    this._notifyStateChange();
  }

  /**
   * Set grid layout
   */
  setGridLayout(layout) {
    this.gridLayout = layout;
    this._notifyStateChange();
  }

  /**
   * Get all terminal states (filtered by current project)
   * @param {boolean} allProjects - If true, return all terminals regardless of project
   */
  getTerminalStates(allProjects = false) {
    let terminals = Array.from(this.terminals.values());

    if (!allProjects) {
      // Filter by current project
      terminals = terminals.filter(t => t.state.projectPath === this.currentProjectPath);
    }

    return terminals
      .map(t => ({ ...t.state }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Get terminal instance
   */
  getTerminal(terminalId) {
    return this.terminals.get(terminalId);
  }

  /**
   * Fit all terminals
   */
  fitAll() {
    for (const [id, instance] of this.terminals) {
      if (instance.opened) {
        instance.fitAddon.fit();
        this._sendResize(id);
      }
    }
  }

  /**
   * Fit specific terminal
   */
  fitTerminal(terminalId) {
    const instance = this.terminals.get(terminalId);
    if (instance && instance.opened) {
      instance.fitAddon.fit();
      this._sendResize(terminalId);
    }
  }

  /**
   * Write to active terminal
   */
  writeToActive(data) {
    if (this.activeTerminalId) {
      const instance = this.terminals.get(this.activeTerminalId);
      if (instance) {
        instance.terminal.write(data);
      }
    }
  }

  /**
   * Send command to active terminal
   */
  sendCommand(command) {
    if (this.activeTerminalId) {
      ipcRenderer.send(IPC.TERMINAL_INPUT_ID, {
        terminalId: this.activeTerminalId,
        data: command + '\r'
      });
    }
  }

  // Private methods
  _sendResize(terminalId) {
    const instance = this.terminals.get(terminalId);
    if (instance) {
      ipcRenderer.send(IPC.TERMINAL_RESIZE_ID, {
        terminalId,
        cols: instance.terminal.cols,
        rows: instance.terminal.rows
      });
    }
  }

  _notifyStateChange() {
    if (this.onStateChange) {
      this.onStateChange({
        terminals: this.getTerminalStates(),
        activeTerminalId: this.activeTerminalId,
        viewMode: this.viewMode,
        gridLayout: this.gridLayout,
        currentProjectPath: this.currentProjectPath
      });
    }
  }

  /**
   * Check if there are terminals for the current project
   */
  hasTerminalsForCurrentProject() {
    return this.getTerminalStates().length > 0;
  }

  /**
   * Clear session storage for a project (used when app restarts)
   * @param {string|null} projectPath - Project path or null for global
   */
  clearProjectSession(projectPath) {
    const sessionKey = projectPath || GLOBAL_PROJECT_KEY;
    try {
      const allSessions = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || '{}');
      delete allSessions[sessionKey];
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(allSessions));
    } catch (err) {
      console.error('Failed to clear terminal session:', err);
    }
  }

  _setupIPC() {
    // Receive output from specific terminal
    ipcRenderer.on(IPC.TERMINAL_OUTPUT_ID, (event, { terminalId, data }) => {
      const instance = this.terminals.get(terminalId);
      if (instance) {
        instance.terminal.write(data);
      }
    });

    // Handle terminal destroyed from main process
    ipcRenderer.on(IPC.TERMINAL_DESTROYED, (event, { terminalId }) => {
      if (this.terminals.has(terminalId)) {
        this.closeTerminal(terminalId);
      }
    });
  }
}

module.exports = { TerminalManager };
