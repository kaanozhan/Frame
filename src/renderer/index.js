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
  terminal.initTerminal('terminal');

  // Initialize state management
  state.init({
    pathElement: document.getElementById('project-path'),
    startClaudeBtn: document.getElementById('btn-start-claude'),
    fileExplorerHeader: document.getElementById('file-explorer-header'),
    initializeFrameBtn: document.getElementById('btn-initialize-frame')
  });

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
  fileTreeUI.setOnFileClick((filePath) => {
    editor.openFile(filePath);
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
  state.onProjectChange((projectPath) => {
    if (projectPath) {
      fileTreeUI.loadFileTree(projectPath);
      terminal.writelnToTerminal(`\x1b[1;32m✓ Project selected:\x1b[0m ${projectPath}`);

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
    // Ctrl+Shift+H - Toggle history panel
    if (e.ctrlKey && e.shiftKey && e.key === 'H') {
      e.preventDefault();
      historyPanel.toggleHistoryPanel();
    }
    // Ctrl+Shift+T - Toggle tasks panel
    if (e.ctrlKey && e.shiftKey && e.key === 'T') {
      e.preventDefault();
      tasksPanel.toggle();
    }
    // Ctrl+Shift+P - Toggle plugins panel
    if (e.ctrlKey && e.shiftKey && e.key === 'P') {
      e.preventDefault();
      pluginsPanel.toggle();
    }
    // Ctrl+Shift+G - Toggle GitHub panel
    if (e.ctrlKey && e.shiftKey && e.key === 'G') {
      e.preventDefault();
      githubPanel.toggle();
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
