/**
 * Terminal Manager Module
 * Manages multiple terminal instances in the renderer
 */

const { ipcRenderer, clipboard } = require('electron');
const { pruneScopes } = require('../shared/reviewModel');
const { Terminal } = require('xterm');
const { FitAddon } = require('xterm-addon-fit');
const { IPC } = require('../shared/ipcChannels');
const { isServerTerminalId, adoptPlan } = require('../shared/serverRouting');
const terminalInput = require('./terminalInput');
const themes = require('./themes');

// Terminal theme for the current app theme (themes.js owns the palettes).
function getTerminalTheme() {
  return themes.terminalTheme(document.documentElement.getAttribute('data-theme'));
}

// Session storage key
const SESSION_STORAGE_KEY = 'frame-terminal-sessions';
const GLOBAL_PROJECT_KEY = '__global__';
// Saved sessions are pruned to this many project records (MRU)
const MAX_SAVED_SESSIONS = 20;

// Format a dropped file's path the way the host's native terminals do
// for drag-drop, so AI TUIs (Claude Code, Codex) recognize it as one
// token.
// - macOS/Linux: backslash-escape special chars (iTerm/gnome-terminal
//   convention). POSIX single-quoting would break Claude's image regex.
// - Windows: leave backslashes alone (path separator!) and double-quote
//   only when needed — that's Windows Terminal / PowerShell behavior.
const IS_WINDOWS = typeof process !== 'undefined' && process.platform === 'win32';
function escapePathForShell(p) {
  const str = String(p);
  if (IS_WINDOWS) {
    if (/[ \t"&|<>^]/.test(str)) {
      return `"${str.replace(/"/g, '\\"')}"`;
    }
    return str;
  }
  return str.replace(/([ \t\n"'`\\$|&;<>()*?[\]{}!#~])/g, '\\$1');
}

// Electron exposes a non-standard `path` property on File objects from
// dataTransfer, giving the absolute filesystem path of dropped files.
// Without this, dropped images/screenshots can't be referenced by the
// AI CLIs (Claude Code, Codex, Gemini) that live inside the terminal.
let globalDropGuardInstalled = false;
function installGlobalDropGuard() {
  if (globalDropGuardInstalled) return;
  globalDropGuardInstalled = true;
  // Without these, dropping a file anywhere in the window makes Electron
  // navigate to file:// — replacing the app with the file's contents.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}


/**
 * A terminal's default name, number first ("1st Terminal", "2nd Terminal"):
 * when the bar's chips shrink and the name is cut with an ellipsis, the
 * number is what stays visible.
 */
function terminalName(n) {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return `${n}${suffix} Terminal`;
}

class TerminalManager {
  constructor() {
    this._createSeq = 0; // request ids for TERMINAL_CREATE
    this.terminals = new Map(); // Map<id, {terminal, fitAddon, element, state}>
    this.activeTerminalId = null;
    this.viewMode = 'board'; // 'board' (default) | 'terminals' | 'specs' | 'tasks' | 'panel'
    this.maxTerminals = 9;
    this.terminalCounter = 0;
    this.onStateChange = null;
    this.currentProjectPath = null; // Current active project (null = global)
    // The selected workspace within it (workspaces spec): terminals carry a
    // workspaceId, and only the selected workspace's terminals are "current".
    // 'main' is the project's own checkout.
    this.currentWorkspaceId = 'main';
    this.currentWorkspaceRoot = null;
    // Frame Server link (server-workspaces): server terminals (srv- ids) are
    // adopted on connect and show a banner while the link is down.
    this.serverState = { state: 'off', host: null };
    this._setupIPC();
    this._setupServer();
    this._setupThemeObserver();
    installGlobalDropGuard();
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
    // A project opens on main; the workspace list re-selects the remembered one.
    this.currentWorkspaceId = 'main';
    this.currentWorkspaceRoot = projectPath;

    // Restore session for new project (custom names)
    this.restoreProjectSession(projectPath);
    // Its terminals on the server (they outlive this window).
    if (this.serverState.state === 'connected') this.adoptServerTerminals(projectPath);

    // Land where the work is: a project with running terminals opens on its
    // Terminals section, one with none opens on Home. This also settles the
    // launch case without a first-run flag — PTYs die with the main process,
    // so at startup no project has a terminal and a fresh window always opens
    // on Home.
    //
    // Overturns the terminals-view spec's "selecting a project always lands on
    // its terminals view" (2026-08-26): landing on an empty terminals grid
    // says nothing about the project, and Home now does.
    this.viewMode = this.getTerminalStates().length > 0 ? 'terminals' : 'board';

    this._notifyStateChange();
  }

  /**
   * Select a workspace of the current project (workspaces spec). Saves the
   * outgoing workspace's session, restores the incoming one's, and lands on
   * its terminals when it has any — the same rule as a project switch.
   * @param {string} workspaceId - 'main' or a workspace id
   * @param {string|null} root - the workspace's folder (main: the project)
   */
  setCurrentWorkspace(workspaceId, root) {
    const id = workspaceId || 'main';
    const nextRoot = root || this.currentProjectPath;
    if (id === this.currentWorkspaceId && nextRoot === this.currentWorkspaceRoot) return;
    this.saveProjectSession(this.currentProjectPath);
    this.currentWorkspaceId = id;
    this.currentWorkspaceRoot = nextRoot;
    this.restoreProjectSession(this.currentProjectPath);
    this.viewMode = this.getTerminalStates().length > 0 ? 'terminals' : 'board';
    this._notifyStateChange();
  }

  getCurrentWorkspaceId() {
    return this.currentWorkspaceId;
  }

  /** Is this terminal state in the current project and selected workspace? */
  _inScope(state) {
    return state.projectPath === this.currentProjectPath
      && (state.workspaceId || 'main') === this.currentWorkspaceId;
  }

  /** Terminals of one project + workspace, oldest first. */
  getTerminalsInScope(projectPath, workspaceId) {
    const ws = workspaceId || 'main';
    return Array.from(this.terminals.values())
      .filter(t => t.state.projectPath === projectPath && (t.state.workspaceId || 'main') === ws)
      .map(t => ({ ...t.state }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * localStorage key for the current project's selected workspace. Main keeps
   * the bare project path — exactly today's key, so nothing migrates.
   */
  _sessionKey(projectPath) {
    const base = projectPath || GLOBAL_PROJECT_KEY;
    return this.currentWorkspaceId && this.currentWorkspaceId !== 'main' ? `${base}#${this.currentWorkspaceId}` : base;
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
    const sessionKey = this._sessionKey(projectPath);
    const projectTerminals = this.getTerminalsInScope(projectPath, this.currentWorkspaceId);

    if (projectTerminals.length === 0) {
      return; // Nothing to save
    }

    const sessionData = {
      activeTerminalId: this.activeTerminalId,
      terminalNames: {}, // Map of terminalId -> customName
      savedAt: Date.now() // MRU pruning key
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
      this._pruneSessions(allSessions, sessionKey);
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(allSessions));
    } catch (err) {
      console.error('Failed to save terminal session:', err);
    }
  }

  /**
   * Keep at most MAX_SAVED_SESSIONS project records (most-recently-used by
   * savedAt; legacy records without a stamp count as oldest). The global
   * session and the record just written are never pruned. Without this,
   * one record per project path accumulated forever.
   */
  _pruneSessions(allSessions, keepKey) {
    const prunable = Object.keys(allSessions)
      .filter(k => k !== GLOBAL_PROJECT_KEY && k !== keepKey);
    const excess = prunable.length - (MAX_SAVED_SESSIONS - 1);
    if (excess <= 0) return;
    prunable
      .sort((a, b) => (allSessions[a].savedAt || 0) - (allSessions[b].savedAt || 0))
      .slice(0, excess)
      .forEach(k => delete allSessions[k]);
  }

  /**
   * Restore project session from localStorage
   * @param {string|null} projectPath - Project path or null for global
   */
  restoreProjectSession(projectPath) {
    const sessionKey = this._sessionKey(projectPath);

    try {
      const allSessions = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || '{}');
      const sessionData = allSessions[sessionKey];

      if (sessionData) {
        // Custom names are all a saved session carries now. The viewMode it
        // used to restore was overwritten two lines later by setCurrentProject
        // ("selecting a project always lands on its terminals view"), so it
        // never took effect; gridLayout belonged to the retired detail view.
        // Terminal ids never survive a restart (PTYs die with the main
        // process), so id-keyed entries are only honored for terminals that
        // still exist in this process and are pruned otherwise.

        // Restore custom names for existing terminals
        const projectTerminals = this.getTerminalsInScope(projectPath, this.currentWorkspaceId);
        projectTerminals.forEach(t => {
          if (sessionData.terminalNames && sessionData.terminalNames[t.id]) {
            const instance = this.terminals.get(t.id);
            if (instance) {
              instance.state.customName = sessionData.terminalNames[t.id];
              instance.state.name = sessionData.terminalNames[t.id];
            }
          }
        });

        // Prune dead-id entries (previous-process terminals) so localStorage
        // doesn't accumulate cosmetic ghosts across restarts.
        let pruned = false;
        if (sessionData.terminalNames) {
          for (const id of Object.keys(sessionData.terminalNames)) {
            if (!this.terminals.has(id)) {
              delete sessionData.terminalNames[id];
              pruned = true;
            }
          }
        }
        if (sessionData.activeTerminalId && !this.terminals.has(sessionData.activeTerminalId)) {
          sessionData.activeTerminalId = null;
          pruned = true;
        }
        if (pruned) {
          allSessions[sessionKey] = sessionData;
          localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(allSessions));
        }

        // Restore active terminal if it belongs to current project
        if (sessionData.activeTerminalId) {
          const terminal = this.terminals.get(sessionData.activeTerminalId);
          if (terminal && terminal.state.projectPath === projectPath
              && (terminal.state.workspaceId || 'main') === this.currentWorkspaceId) {
            this.setActiveTerminal(sessionData.activeTerminalId);
            return;
          }
        }
      }

      // If no valid active terminal found, select first terminal of current project
      const projectTerminals = this.getTerminalsInScope(projectPath, this.currentWorkspaceId);
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
   * @param {string} options.shell - Shell path to use (optional)
   */
  async createTerminal(options = {}) {
    // Use provided projectPath or current project
    const projectPath = options.projectPath !== undefined
      ? options.projectPath
      : this.currentProjectPath;

    // Which workspace the terminal belongs to (workspaces spec): explicit,
    // else the selected one when it is for the current project, else main.
    const inCurrentProject = projectPath === this.currentProjectPath;
    const workspaceId = options.workspaceId || (inCurrentProject ? this.currentWorkspaceId : 'main');

    // Per-workspace cap (main counts as one workspace). It was per project,
    // and before that global — terminals from other projects/workspaces stay
    // alive in memory for fast switch-back, so a wider count silently locked
    // users out at far fewer visible terminals.
    const scopeCount = Array.from(this.terminals.values())
      .filter(t => t.state.projectPath === projectPath && (t.state.workspaceId || 'main') === workspaceId).length;
    if (scopeCount >= this.maxTerminals) {
      console.error(`Maximum terminal limit (${this.maxTerminals}) reached for this workspace`);
      return null;
    }

    // Working directory: the provided cwd, else the selected workspace's
    // folder (for its own terminals), else the project, else home.
    const defaultDir = inCurrentProject && workspaceId === this.currentWorkspaceId
      ? (this.currentWorkspaceRoot || projectPath)
      : projectPath;
    const workingDir = options.cwd || defaultDir || null;

    // Replies are matched by request id: overlapping creates (two local, or a
    // local one and a slower server one) each get their own terminal
    // (server-hardening T1).
    const requestId = `tc-${Date.now().toString(36)}-${++this._createSeq}`;
    return new Promise((resolve, reject) => {
      const handler = (event, response) => {
        if (!response || response.requestId !== requestId) return;
        ipcRenderer.removeListener(IPC.TERMINAL_CREATED, handler);
        if (response.success) {
          this._initializeTerminal(response.terminalId, {
            ...options,
            projectPath,
            workspaceId,
            cwd: workingDir
          });
          resolve(response.terminalId);
        } else {
          reject(new Error(response.error));
        }
      };

      ipcRenderer.on(IPC.TERMINAL_CREATED, handler);
      ipcRenderer.send(IPC.TERMINAL_CREATE, {
        requestId,
        cwd: workingDir,
        projectPath,
        workspaceId,
        shell: options.shell || null,
        extraEnv: options.extraEnv || null, // orchestration worker lanes pass FRAME_ORCH_* env
        ...(options.location ? { location: options.location } : {}) // 'server-home' (server-onboarding)
      });
    });
  }

  /**
   * A terminal on the connected server, in the user's home folder, shown in
   * the current project and view (server-onboarding). `command`, when given,
   * is typed once the shell has printed something — without Enter: the user
   * runs it (sign-ins are interactive). Resolves the terminal id, or throws.
   */
  async createServerHomeTerminal({ command = null } = {}) {
    const id = await this.createTerminal({ location: 'server-home' });
    if (!id) throw new Error('Could not open a terminal on the server.');
    const host = this.serverState.host || 'server';
    this.renameTerminal(id, `Server · ${host}`);
    if (command) {
      const type = () => ipcRenderer.send(IPC.TERMINAL_INPUT_ID, { terminalId: id, data: String(command) });
      let done = false;
      const onOutput = (event, p) => {
        if (done || !p || p.terminalId !== id) return;
        done = true;
        ipcRenderer.removeListener(IPC.TERMINAL_OUTPUT_ID, onOutput);
        setTimeout(type, 150); // let the prompt finish drawing
      };
      ipcRenderer.on(IPC.TERMINAL_OUTPUT_ID, onOutput);
      setTimeout(() => { if (!done) { done = true; ipcRenderer.removeListener(IPC.TERMINAL_OUTPUT_ID, onOutput); type(); } }, 2000);
    }
    return id;
  }

  /**
   * Get available shells from main process
   * @returns {Promise<Array<{id: string, name: string, path: string}>>}
   */
  async getAvailableShells() {
    return new Promise((resolve, reject) => {
      const handler = (event, response) => {
        ipcRenderer.removeListener(IPC.AVAILABLE_SHELLS_DATA, handler);
        if (response.success) {
          resolve(response.shells);
        } else {
          reject(new Error(response.error || 'Failed to get available shells'));
        }
      };

      ipcRenderer.on(IPC.AVAILABLE_SHELLS_DATA, handler);
      ipcRenderer.send(IPC.GET_AVAILABLE_SHELLS);
    });
  }

  /**
   * Initialize xterm.js instance for a terminal
   */
  _initializeTerminal(terminalId, options) {
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", Consolas, "Courier New", monospace',
      theme: getTerminalTheme(),
      allowTransparency: false,
      scrollback: 10000,
      scrollOnUserInput: false
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
      name: options.name || terminalName(++this.terminalCounter),
      customName: null,
      isActive: false,
      createdAt: Date.now(),
      projectPath: options.projectPath !== undefined ? options.projectPath : this.currentProjectPath,
      workspaceId: options.workspaceId || 'main',
      // What this lane is working on (set by agentDispatch):
      // { kind: 'task'|'spec', label, ref } — presentation metadata only,
      // session-scoped, dies with the lane (never persisted).
      assignment: null
    };

    this.terminals.set(terminalId, { terminal, fitAddon, element, state });

    // Allow app-level shortcuts to pass through when terminal has focus
    terminal.attachCustomKeyEventHandler((event) => {
      const modKey = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      // Copy: Ctrl+Shift+C (Win/Linux) or Cmd+C (macOS)
      if (event.type === 'keydown') {
        if ((event.ctrlKey && event.shiftKey && key === 'c') || (event.metaKey && key === 'c')) {
          if (terminal.hasSelection()) {
            clipboard.writeText(terminal.getSelection());
            terminal.clearSelection();
          }
          return false;
        }

        // Paste: Ctrl+Shift+V (Win/Linux) or Cmd+V (macOS)
        // Block key event only — xterm handles paste natively via DOM paste event
        if ((event.ctrlKey && event.shiftKey && key === 'v') || (event.metaKey && key === 'v')) {
          return false;
        }
      }

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
      // Ctrl/Cmd + - / 0 (zoom out / reset, ui-zoom-steps spec) → pass to
      // app. Zoom in (Ctrl/Cmd + Shift + 0) already passes via the Shift rule
      // above. On macOS the native accelerator fires first anyway; this is
      // what lets the chord reach the registry on Windows / Linux.
      if (modKey && (event.key === '-' || event.key === '0')) {
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
      // Ctrl/Cmd + Escape (back to lane board) → pass to app
      if (modKey && key === 'escape') {
        return false;
      }
      // Let terminal handle everything else
      return true;
    });

    // Right-click paste
    element.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const text = clipboard.readText();
      if (text) terminal.paste(text);
    });

    // File drag-and-drop: insert quoted absolute paths at the cursor.
    // xterm renders many nested DOM nodes, so dragenter/leave fire for
    // each child crossing — use a depth counter to keep the visual state
    // stable while hovering. dropEffect 'copy' shows the OS '+' cursor.
    let dragDepth = 0;
    element.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      e.preventDefault();
      dragDepth++;
      element.classList.add('drag-over');
    });
    element.addEventListener('dragover', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    element.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) element.classList.remove('drag-over');
    });
    element.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDepth = 0;
      element.classList.remove('drag-over');
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      const paths = files.map(f => f.path).filter(Boolean).map(escapePathForShell);
      if (paths.length === 0) return;
      this.setActiveTerminal(terminalId);
      // Route through xterm's paste API instead of raw stdin: when the
      // TUI (Claude Code, etc.) has bracketed paste mode enabled, xterm
      // wraps the payload with \e[200~ / \e[201~ so the TUI sees it as
      // one atomic paste — that's the signal Claude needs to turn an
      // image path into an [Image #N] chip instead of just typed text.
      terminal.paste(paths.join(' '));
    });

    // Handle input. Routed through terminalInput so xterm's answers to the
    // foreground TUI (cursor-position reports, mouse, focus) coalesce with
    // whatever else this tick produced instead of costing one IPC each.
    terminal.onData((data) => {
      terminalInput.send(terminalId, data);
    });

    // If first terminal or no active terminal, make it active
    if (this.terminals.size === 1 || !this.activeTerminalId) {
      this.setActiveTerminal(terminalId);
    }

    this._renumberTerminals(state.projectPath);
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
    if (this.activeTerminalId === terminalId) {
      // Already active, just ensure focus
      const current = this.terminals.get(terminalId);
      if (current) {
        current.terminal.focus();
      }
      return;
    }

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
      // Session restore focuses this one again after a relaunch.
      ipcRenderer.send(IPC.SESSION_RESTORE_META, { terminalId, active: true });
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
      // Saved with the terminal's session, so a restored lane keeps its name.
      ipcRenderer.send(IPC.SESSION_RESTORE_META, { terminalId, name: newName || null });
      this._notifyStateChange();
    }
  }

  /**
   * Set what a lane is working on (most recent dispatch wins the label).
   * @param {string} terminalId
   * @param {{kind: 'task'|'spec', label: string, ref: string}|null} assignment
   */
  setAssignment(terminalId, assignment) {
    const instance = this.terminals.get(terminalId);
    if (instance) {
      instance.state.assignment = assignment;
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

      if (this.activeTerminalId === terminalId) {
        const remaining = Array.from(this.terminals.keys());
        this.activeTerminalId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
        if (this.activeTerminalId) {
          this.setActiveTerminal(this.activeTerminalId);
        }
      }

      this._renumberTerminals(instance.state.projectPath);
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
   * Get all terminal states (filtered by current project)
   * @param {boolean} allProjects - If true, return all terminals regardless of project
   */
  getTerminalStates(allProjects = false) {
    let terminals = Array.from(this.terminals.values());

    if (!allProjects) {
      // Filter by current project and selected workspace
      terminals = terminals.filter(t => this._inScope(t.state));
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
  scrollActiveToBottom() {
    if (this.activeTerminalId) {
      const instance = this.terminals.get(this.activeTerminalId);
      if (instance) {
        instance.terminal.scrollToBottom();
      }
    }
  }

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
   * Send command to active terminal or specific terminal
   * @param {string} command - Command to send
   * @param {string} [terminalId] - Optional specific terminal ID
   */
  sendCommand(command, terminalId = null) {
    const targetId = terminalId || this.activeTerminalId;
    
    if (targetId) {
      terminalInput.send(targetId, command + '\r');
    }
  }

  // Private methods
  _sendResize(terminalId) {
    const instance = this.terminals.get(terminalId);
    if (!instance) return;
    const { cols, rows } = instance.terminal;
    // A fit that lands on the same grid is not a resize. Fitting makes xterm
    // rewrite its own DOM, which re-fires the pane's ResizeObserver, which
    // fits again — so an unguarded send turned a settled layout into a
    // steady stream of no-op messages (seen as out:terminal-resize-id ×30
    // in one 5s watchdog window). The PTY only cares about changes.
    if (instance.lastSentCols === cols && instance.lastSentRows === rows) return;
    instance.lastSentCols = cols;
    instance.lastSentRows = rows;
    ipcRenderer.send(IPC.TERMINAL_RESIZE_ID, { terminalId, cols, rows });
  }

  _notifyStateChange() {
    if (this.onStateChange) {
      this.onStateChange({
        terminals: this.getTerminalStates(),
        activeTerminalId: this.activeTerminalId,
        viewMode: this.viewMode,
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
      // The project's workspace sessions (`<path>#<id>`) go with it (R14).
      const allSessions = pruneScopes(JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || '{}'), sessionKey, []);
      delete allSessions[sessionKey];
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(allSessions));
    } catch (err) {
      console.error('Failed to clear terminal session:', err);
    }
  }

  /**
   * Forget saved sessions of `projectPath`'s workspaces that no longer exist
   * (R14) — stale keys otherwise take slots in the 20-session cap and evict
   * live ones.
   */
  pruneWorkspaceSessions(projectPath, liveIds) {
    if (!projectPath) return;
    try {
      const allSessions = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || '{}');
      const next = pruneScopes(allSessions, projectPath, liveIds);
      if (Object.keys(next).length !== Object.keys(allSessions).length) {
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(next));
      }
    } catch (err) {
      console.error('Failed to prune terminal sessions:', err);
    }
  }

  _setupThemeObserver() {
    const observer = new MutationObserver(() => {
      const theme = getTerminalTheme();
      for (const instance of this.terminals.values()) {
        instance.terminal.options.theme = theme;
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  _setupIPC() {
    // Init-once across instances: TerminalManager is a singleton; a second
    // construction must not silently double every IPC handler.
    if (TerminalManager._ipcBound) {
      console.warn('TerminalManager: _setupIPC called twice — listeners not re-registered');
      return;
    }
    TerminalManager._ipcBound = true;

    // Receive output from specific terminal
    ipcRenderer.on(IPC.TERMINAL_OUTPUT_ID, (event, { terminalId, data }) => {
      const instance = this.terminals.get(terminalId);
      if (instance) {
        const term = instance.terminal;

        term.write(data, () => {
          const buf = term.buffer.active;
          // If viewport is at the very top but there's content below,
          // escape codes (e.g. Claude Code's \033[2J\033[H) forced the scroll.
          // Auto-scroll back to bottom.
          if (buf.viewportY === 0 && buf.baseY > 5) {
            term.scrollToBottom();
          }
        });
      }
    });

    // Handle terminal destroyed from main process
    ipcRenderer.on(IPC.TERMINAL_DESTROYED, (event, { terminalId }) => {
      if (this.terminals.has(terminalId)) {
        this.closeTerminal(terminalId);
      }
    });
  }

  // ─── Server terminals (server-workspaces) ──────────────────

  _setupServer() {
    const apply = (s) => {
      const prev = this.serverState.state;
      this.serverState = { state: (s && s.state) || 'off', host: (s && s.host) || this.serverState.host };
      if (this.serverState.state === 'connected') {
        // With no project selected too: home terminals opened there come back (server-onboarding).
        if (prev !== 'connected') this.adoptServerTerminals(this.currentProjectPath || null);
      } else {
        this._setServerBanners();
      }
    };
    ipcRenderer.on(IPC.SERVER_STATUS_CHANGED, (event, s) => apply(s));
    ipcRenderer.invoke(IPC.SERVER_STATUS).then(apply).catch(() => {});
  }

  /**
   * Bring the server's live terminals of `projectPath` into this window:
   * new ones get an xterm, known ones are reset; each is redrawn from the
   * server's screen snapshot (exact, full-screen TUIs included).
   */
  async adoptServerTerminals(projectPath) {
    let list = [];
    try {
      list = await ipcRenderer.invoke(IPC.TERMINAL_ADOPT, { projectPath });
    } catch (err) {
      console.error('terminalManager: adopting server terminals failed', err);
      return;
    }
    if (!Array.isArray(list)) { this._setServerBanners(); return; } // main cannot tell: keep the lanes
    // Lanes of this project's server terminals that the server no longer
    // has (it restarted, or they were closed elsewhere) go; a lane whose
    // terminal now belongs to another workspace is rebuilt for it (T3).
    const known = [...this.terminals]
      .filter(([id, inst]) => isServerTerminalId(id) && inst.state.projectPath === projectPath)
      .map(([id, inst]) => ({ terminalId: id, workspaceId: inst.state.workspaceId || 'main' }));
    const plan = adoptPlan(known, list || []);
    let added = false;
    for (const id of [...plan.dispose, ...plan.recreate]) this._disposeLocalLane(id);
    for (const t of list || []) {
      let inst = this.terminals.get(t.terminalId);
      if (!inst) {
        this._initializeTerminal(t.terminalId, { projectPath: t.projectPath, workspaceId: t.workspaceId });
        inst = this.terminals.get(t.terminalId);
        added = true;
        if (inst && t.home && !inst.state.customName) inst.state.customName = `Server · ${this.serverState.host || 'server'}`;
      }
      if (!inst) continue;
      inst.terminal.reset();
      if (t.screen) inst.terminal.write(t.screen);
    }
    this._setServerBanners();
    if (added || plan.dispose.length || plan.recreate.length) {
      this.restoreProjectSession(this.currentProjectPath);
      this._renumberTerminals(projectPath);
    }
    this._notifyStateChange();
    // Fit to this window; the resize reaches the server PTY and its app redraws.
    setTimeout(() => this.fitAll(), 50);
  }

  /** Drop a server terminal's lane in this window only — the server is not told. */
  _disposeLocalLane(terminalId) {
    const inst = this.terminals.get(terminalId);
    if (!inst) return;
    try { inst.terminal.dispose(); } catch (_) { /* gone */ }
    if (inst.element && inst.element.parentNode) inst.element.remove();
    this.terminals.delete(terminalId);
    if (this.activeTerminalId === terminalId) this.activeTerminalId = null;
  }

  /** "Reconnecting to <host>…" over every server terminal while the link is down. */
  _setServerBanners() {
    const down = this.serverState.state !== 'connected';
    const host = this.serverState.host || 'the server';
    const text = this.serverState.state === 'off'
      ? `Disconnected from ${host} — the terminal keeps running there. Connect to Server to continue.`
      : `Reconnecting to ${host}… The terminal keeps running on the server; typing is paused.`;
    for (const [id, inst] of this.terminals) {
      if (!isServerTerminalId(id)) continue;
      let banner = inst.element.querySelector(':scope > .srv-banner');
      if (!down) {
        if (banner) banner.remove();
        continue;
      }
      if (!banner) {
        banner = document.createElement('div');
        banner.className = 'srv-banner';
        inst.element.style.position = 'relative';
        inst.element.appendChild(banner);
      }
      banner.textContent = text;
    }
  }

  /**
   * Renumber terminals for a project to ensure sequential naming (1st Terminal, 2nd Terminal, ...)
   * Only affects terminals without custom names.
   */
  _renumberTerminals(projectPath) {
    const terminals = this.getTerminalsByProject(projectPath);
    
    terminals.forEach((tState, index) => {
      const instance = this.terminals.get(tState.id);
      if (instance && !instance.state.customName) {
        const newName = terminalName(index + 1);
        if (instance.state.name !== newName) {
          instance.state.name = newName;
        }
      }
    });
    
    // Notify change since names might have changed
    this._notifyStateChange();
  }
}

module.exports = { TerminalManager };
