/**
 * Renderer Entry Point
 * Initializes all UI modules and sets up event handlers
 */

const terminal = require('./terminal');
const fileTreeUI = require('./fileTreeUI');
const historyPanel = require('./historyPanel');
const tasksPanel = require('./tasksPanel');
const pluginsPanel = require('./pluginsPanel');
const githubPanel = require('./githubPanel');
const state = require('./state');
const projectListUI = require('./projectListUI');
const editor = require('./editor');
const sidebarResize = require('./sidebarResize');

/**
 * Initialize all modules
 */
function init() {
  // Initialize terminal
  const multiTerminalUI = terminal.initTerminal('terminal');

  // Initialize state management
  state.init({
    pathElement: document.getElementById('project-path'),
    startClaudeBtn: document.getElementById('btn-start-claude'),
    fileExplorerHeader: document.getElementById('file-explorer-header'),
    initializeFrameBtn: document.getElementById('btn-initialize-frame')
  });

  // Connect state with multiTerminalUI for project-terminal session management
  state.setMultiTerminalUI(multiTerminalUI);

  // Initialize project list UI
  projectListUI.init('projects-list', (projectPath) => {
    state.setProjectPath(projectPath);
  });

  // Load projects from workspace
  projectListUI.loadProjects();

  // Initialize file tree UI
  fileTreeUI.init('file-tree', state.getProjectPath);
  fileTreeUI.setProjectPathGetter(state.getProjectPath);

  // Initialize editor with file tree refresh callback
  editor.init(() => {
    fileTreeUI.refreshFileTree();
  });

  // Connect file tree clicks to editor
  fileTreeUI.setOnFileClick((filePath, source) => {
    editor.openFile(filePath, source);
  });

  // Initialize history panel with terminal resize callback
  historyPanel.init('history-panel', 'history-content', () => {
    setTimeout(() => terminal.fitTerminal(), 50);
  });

  // Initialize tasks panel
  tasksPanel.init();

  // Initialize plugins panel
  pluginsPanel.init();

  // Initialize GitHub panel
  githubPanel.init();

  // Initialize sidebar resize
  sidebarResize.init(() => {
    terminal.fitTerminal();
  });

  // Setup state change listeners
  state.onProjectChange((projectPath, previousPath) => {
    if (projectPath) {
      fileTreeUI.loadFileTree(projectPath);

      // Add to workspace and update project list
      const projectName = projectPath.split('/').pop() || projectPath.split('\\').pop();
      projectListUI.addProject(projectPath, projectName, state.getIsFrameProject());
      projectListUI.setActiveProject(projectPath);

      // Load tasks if tasks panel is visible
      if (tasksPanel.isVisible()) {
        tasksPanel.loadTasks();
      }
    } else {
      fileTreeUI.clearFileTree();
    }
  });

  // Setup Frame status change listener
  state.onFrameStatusChange((isFrame) => {
    // Refresh project list when Frame status changes
    projectListUI.loadProjects();
  });

  // Setup Frame initialized listener
  state.onFrameInitialized((projectPath) => {
    terminal.writelnToTerminal(`\x1b[1;32m✓ Frame project initialized!\x1b[0m`);
    terminal.writelnToTerminal(`  Created: .frame/, CLAUDE.md, STRUCTURE.json, PROJECT_NOTES.md, tasks.json, QUICKSTART.md`);
    // Refresh file tree to show new files
    fileTreeUI.refreshFileTree();
    // Load tasks for the new project
    tasksPanel.loadTasks();
  });

  // Setup button handlers
  setupButtonHandlers();

  // Setup keyboard shortcuts
  setupKeyboardShortcuts();

  // Setup window resize handler
  window.addEventListener('resize', () => {
    terminal.fitTerminal();
  });
}

/**
 * Setup button click handlers
 */
function setupButtonHandlers() {
  // Select project folder
  document.getElementById('btn-select-project').addEventListener('click', () => {
    state.selectProjectFolder();
  });

  // Create new project
  document.getElementById('btn-create-project').addEventListener('click', () => {
    state.createNewProject();
  });

  // Start Claude Code
  document.getElementById('btn-start-claude').addEventListener('click', () => {
    const projectPath = state.getProjectPath();
    if (projectPath) {
      terminal.restartTerminal(projectPath);
      setTimeout(() => {
        terminal.sendCommand('claude');
      }, 1000);
    }
  });

  // Refresh file tree
  document.getElementById('btn-refresh-tree').addEventListener('click', () => {
    fileTreeUI.refreshFileTree();
  });

  // Close history panel
  document.getElementById('history-close').addEventListener('click', () => {
    historyPanel.toggleHistoryPanel();
  });

  // Add project to workspace
  document.getElementById('btn-add-project').addEventListener('click', () => {
    state.selectProjectFolder();
  });

  // Initialize as Frame project
  document.getElementById('btn-initialize-frame').addEventListener('click', () => {
    state.initializeAsFrameProject();
  });
}

/**
 * Setup keyboard shortcuts
 */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const modKey = e.ctrlKey || e.metaKey; // Support both Ctrl (Windows/Linux) and Cmd (macOS)
    const key = e.key.toLowerCase(); // Normalize key to lowercase

    // Ctrl/Cmd+Shift+H - Toggle history panel
    if (modKey && e.shiftKey && key === 'h') {
      e.preventDefault();
      historyPanel.toggleHistoryPanel();
    }
    // Ctrl/Cmd+Shift+P - Toggle plugins panel
    if (modKey && e.shiftKey && key === 'p') {
      e.preventDefault();
      pluginsPanel.toggle();
    }
    // Ctrl/Cmd+Shift+G - Toggle GitHub panel
    if (modKey && e.shiftKey && key === 'g') {
      e.preventDefault();
      githubPanel.toggle();
    }
    // Ctrl/Cmd+B - Toggle sidebar
    if (modKey && !e.shiftKey && key === 'b') {
      e.preventDefault();
      sidebarResize.toggle();
      terminal.fitTerminal();
    }
    // Ctrl/Cmd+Shift+[ - Previous project
    if (modKey && e.shiftKey && e.key === '[') {
      e.preventDefault();
      projectListUI.selectPrevProject();
    }
    // Ctrl/Cmd+Shift+] - Next project
    if (modKey && e.shiftKey && e.key === ']') {
      e.preventDefault();
      projectListUI.selectNextProject();
    }
    // Ctrl/Cmd+E - Focus project list
    if (modKey && !e.shiftKey && key === 'e') {
      e.preventDefault();
      fileTreeUI.blur();
      projectListUI.focus();
    }
    // Ctrl/Cmd+Shift+E - Focus file tree
    if (modKey && e.shiftKey && key === 'e') {
      e.preventDefault();
      projectListUI.blur();
      fileTreeUI.focus();
    }
    // Ctrl/Cmd+T - Toggle tasks panel
    if (modKey && !e.shiftKey && key === 't') {
      e.preventDefault();
      tasksPanel.toggle()
    }
  });
}

/**
 * Start application when DOM is ready
 */
window.addEventListener('load', () => {
  init();

  // Give a moment for terminal to fully render, then start PTY
  setTimeout(() => {
    terminal.startTerminal();
  }, 100);
});
