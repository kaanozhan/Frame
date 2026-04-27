/**
 * Renderer Entry Point
 * Initializes all UI modules and sets up event handlers
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const terminal = require('./terminal');
const fileTreeUI = require('./fileTreeUI');
const historyPanel = require('./historyPanel');
const tasksPanel = require('./tasksPanel');
const pluginsPanel = require('./pluginsPanel');
const githubPanel = require('./githubPanel');
const promptsPanel = require('./promptsPanel');
const state = require('./state');
const projectListUI = require('./projectListUI');
const editor = require('./editor');
const sidebarResize = require('./sidebarResize');
const aiToolSelector = require('./aiToolSelector');
const commandRegistry = require('./commandRegistry');
const commandPalette = require('./commandPalette');
const cheatSheet = require('./cheatSheet');

/**
 * Initialize all modules
 */
function init() {
  // Show app version
  const version = require('../../package.json').version;
  const versionEl = document.getElementById('app-version');
  if (versionEl) versionEl.textContent = `v${version}`;

  // Initialize terminal
  const multiTerminalUI = terminal.initTerminal('terminal');

  // Initialize state management
  state.init({
    pathElement: document.getElementById('project-path'),
    startClaudeBtn: document.getElementById('btn-start-ai'),
    fileExplorerHeader: document.getElementById('file-explorer-header'),
    initializeFrameBtn: document.getElementById('btn-initialize-frame')
  });

  // Initialize AI tool selector
  aiToolSelector.init((tool) => {
    console.log('AI tool changed to:', tool.name);
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

  // Initialize prompts panel
  promptsPanel.init();

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
    terminal.writelnToTerminal(`  Created: .frame/, AGENTS.md, CLAUDE.md (symlink), STRUCTURE.json, PROJECT_NOTES.md, tasks.json, QUICKSTART.md`);
    // Refresh file tree to show new files
    fileTreeUI.refreshFileTree();
    // Load tasks for the new project
    tasksPanel.loadTasks();
  });

  // Setup button handlers
  setupButtonHandlers();

  // Initialize command palette + cheat sheet, register all commands, then bind keyboard
  commandPalette.init();
  cheatSheet.init();
  registerCommands();
  commandRegistry.bindKeyboard();

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

  // Clone GitHub repo
  const cloneInputRow = document.getElementById('clone-github-input-row');
  const cloneUrlInput = document.getElementById('clone-github-url');

  document.getElementById('btn-clone-github').addEventListener('click', () => {
    cloneInputRow.style.display = 'flex';
    cloneUrlInput.focus();
  });

  document.getElementById('btn-clone-github-cancel').addEventListener('click', () => {
    cloneInputRow.style.display = 'none';
    cloneUrlInput.value = '';
  });

  document.getElementById('btn-clone-github-confirm').addEventListener('click', () => {
    const url = cloneUrlInput.value.trim();
    if (!url) return;
    cloneInputRow.style.display = 'none';
    cloneUrlInput.value = '';
    ipcRenderer.send(IPC.CLONE_GITHUB_REPO, url);
  });

  cloneUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('btn-clone-github-confirm').click();
    } else if (e.key === 'Escape') {
      document.getElementById('btn-clone-github-cancel').click();
    }
  });

  ipcRenderer.on(IPC.CLONE_GITHUB_REPO_RESULT, (event, result) => {
    if (result.cancelled) return;
    if (!result.success) {
      alert('Clone failed:\n' + result.error);
      return;
    }
    state.setProjectPath(result.projectPath);
  });

  // Start AI Tool (Claude Code / Codex CLI / etc.)
  document.getElementById('btn-start-ai').addEventListener('click', async () => {
    const projectPath = state.getProjectPath();
    if (projectPath) {
      const newTerminalId = await terminal.restartTerminal(projectPath);

      if (newTerminalId) {
        // Ensure the new terminal is focused
        terminal.setActiveTerminal(newTerminalId);

        // Send start command for the selected AI tool
        const startCommand = aiToolSelector.getStartCommand();
        setTimeout(() => {
          terminal.sendCommand(startCommand, newTerminalId);
        }, 1000);
      }
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

  // Sidebar tabs
  document.querySelectorAll('.sidebar-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tab = e.target.dataset.sidebarTab;
      document.querySelectorAll('.sidebar-tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.sidebarTab === tab);
      });
      document.querySelectorAll('[data-sidebar-tab-content]').forEach(el => {
        el.style.display = el.dataset.sidebarTabContent === tab ? '' : 'none';
      });
    });
  });
}

/**
 * Show the sidebar (if hidden) and switch to the given tab. Used by focus
 * commands so they don't try to focus an element inside a hidden container.
 */
function revealSidebarTab(tabName) {
  if (!sidebarResize.isVisible()) {
    sidebarResize.show();
    terminal.fitTerminal();
  }
  document.querySelectorAll('.sidebar-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.sidebarTab === tabName);
  });
  document.querySelectorAll('[data-sidebar-tab-content]').forEach((el) => {
    el.style.display = el.dataset.sidebarTabContent === tabName ? '' : 'none';
  });
}

/**
 * Register every app command with the central registry. Commands are the
 * single source of truth for title, shortcut, and behavior — consumed by the
 * Command Palette and the global keyboard handler.
 */
function registerCommands() {
  const r = commandRegistry.register;

  // ---------- Command Palette ----------
  r({
    id: 'palette.toggle',
    title: 'Show All Commands',
    category: 'Palette',
    shortcut: 'CmdOrCtrl+Shift+P',
    run: () => commandPalette.toggle()
  });
  r({
    id: 'palette.open',
    title: 'Command Palette',
    category: 'Palette',
    shortcut: 'CmdOrCtrl+P',
    run: () => commandPalette.open()
  });

  // ---------- Help ----------
  r({
    id: 'help.shortcuts',
    title: 'Keyboard Shortcuts',
    category: 'Help',
    shortcut: 'CmdOrCtrl+Shift+K',
    run: () => cheatSheet.toggle()
  });

  // ---------- Sidebar / Panels ----------
  r({
    id: 'panel.toggleSidebar',
    title: 'Toggle Sidebar (Projects & Files)',
    category: 'Panel',
    shortcut: 'CmdOrCtrl+B',
    run: () => {
      sidebarResize.toggle();
      terminal.fitTerminal();
    }
  });
  r({
    id: 'panel.showSidebar',
    title: 'Show Sidebar',
    category: 'Panel',
    run: () => {
      sidebarResize.show();
      terminal.fitTerminal();
    }
  });
  r({
    id: 'panel.toggleHistory',
    title: 'Toggle Prompt History Panel',
    category: 'Panel',
    shortcut: 'CmdOrCtrl+Shift+H',
    run: () => historyPanel.toggleHistoryPanel()
  });
  r({
    id: 'panel.toggleTasks',
    title: 'Toggle Tasks Panel',
    category: 'Panel',
    shortcut: 'CmdOrCtrl+T',
    run: () => tasksPanel.toggle()
  });
  r({
    id: 'panel.togglePlugins',
    title: 'Toggle Plugins Panel',
    category: 'Panel',
    shortcut: 'CmdOrCtrl+Shift+X',
    run: () => pluginsPanel.toggle()
  });
  r({
    id: 'panel.toggleGitHub',
    title: 'Toggle GitHub Panel',
    category: 'Panel',
    shortcut: 'CmdOrCtrl+Shift+G',
    run: () => githubPanel.toggle()
  });
  r({
    id: 'panel.togglePrompts',
    title: 'Toggle Prompts Panel',
    category: 'Panel',
    shortcut: 'CmdOrCtrl+Shift+L',
    run: () => promptsPanel.toggle()
  });

  // ---------- Focus ----------
  r({
    id: 'focus.projectList',
    title: 'Focus Project List',
    category: 'Focus',
    shortcut: 'CmdOrCtrl+E',
    run: () => {
      revealSidebarTab('projects');
      fileTreeUI.blur();
      projectListUI.focus();
    }
  });
  r({
    id: 'focus.fileTree',
    title: 'Focus File Tree',
    category: 'Focus',
    shortcut: 'CmdOrCtrl+Shift+E',
    run: () => {
      revealSidebarTab('files');
      projectListUI.blur();
      fileTreeUI.focus();
    }
  });

  // ---------- Project Navigation ----------
  r({
    id: 'project.next',
    title: 'Next Project',
    category: 'Project',
    shortcut: 'CmdOrCtrl+Shift+]',
    run: () => projectListUI.selectNextProject()
  });
  r({
    id: 'project.prev',
    title: 'Previous Project',
    category: 'Project',
    shortcut: 'CmdOrCtrl+Shift+[',
    run: () => projectListUI.selectPrevProject()
  });
  r({
    id: 'project.add',
    title: 'Add Project to Workspace…',
    category: 'Project',
    run: () => state.selectProjectFolder()
  });
  r({
    id: 'project.create',
    title: 'Create New Project…',
    category: 'Project',
    run: () => state.createNewProject()
  });
  r({
    id: 'project.initializeFrame',
    title: 'Initialize as Frame Project',
    category: 'Project',
    when: () => !!state.getProjectPath() && !state.getIsFrameProject(),
    run: () => state.initializeAsFrameProject()
  });

  // ---------- Terminal ----------
  r({
    id: 'terminal.new',
    title: 'New Terminal',
    category: 'Terminal',
    shortcut: 'CmdOrCtrl+Shift+T',
    run: () => {
      const ui = terminal.getMultiTerminalUI();
      if (ui) ui.createTerminalForCurrentProject();
    }
  });
  r({
    id: 'terminal.close',
    title: 'Close Terminal',
    category: 'Terminal',
    shortcut: 'CmdOrCtrl+Shift+W',
    run: () => {
      const ui = terminal.getMultiTerminalUI();
      if (ui) ui.closeActiveTerminal();
    }
  });
  r({
    id: 'terminal.next',
    title: 'Next Terminal',
    category: 'Terminal',
    shortcut: 'CmdOrCtrl+Tab',
    run: () => {
      const ui = terminal.getMultiTerminalUI();
      if (ui) ui.switchTerminal(1);
    }
  });
  r({
    id: 'terminal.prev',
    title: 'Previous Terminal',
    category: 'Terminal',
    shortcut: 'CmdOrCtrl+Shift+Tab',
    run: () => {
      const ui = terminal.getMultiTerminalUI();
      if (ui) ui.switchTerminal(-1);
    }
  });
  for (let i = 1; i <= 9; i++) {
    r({
      id: `terminal.switch.${i}`,
      title: `Switch to Terminal ${i}`,
      category: 'Terminal',
      shortcut: `CmdOrCtrl+${i}`,
      run: () => {
        const ui = terminal.getMultiTerminalUI();
        if (ui) ui.setActiveTerminalByIndex(i - 1);
      }
    });
  }
  r({
    id: 'terminal.toggleGridView',
    title: 'Toggle Terminal Grid View',
    category: 'Terminal',
    // Cmd+Shift+G previously bound here too — moved to Panel:GitHub.
    // Grid view is reachable via tab bar and palette.
    run: () => {
      const ui = terminal.getMultiTerminalUI();
      if (ui) ui.toggleViewMode();
    }
  });

  // ---------- AI Tool ----------
  r({
    id: 'ai.startSession',
    title: 'Start AI Session',
    category: 'AI',
    when: () => !!state.getProjectPath(),
    run: () => {
      const btn = document.getElementById('btn-start-ai');
      if (btn) btn.click();
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
