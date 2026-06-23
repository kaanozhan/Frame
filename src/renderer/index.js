/**
 * Renderer Entry Point
 * Initializes all UI modules and sets up event handlers
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const terminal = require('./terminal');
const fileTreeUI = require('./fileTreeUI');
const gitChangesPanel = require('./gitChangesPanel');
const diffSection = require('./diffSection');
const historyPanel = require('./historyPanel');
const tasksPanel = require('./tasksPanel');
const tasksDashboard = require('./tasksDashboard');
const taskConfirmModal = require('./taskConfirmModal');
const taskInfoModal = require('./taskInfoModal');
const taskRunModal = require('./taskRunModal');
const pluginsPanel = require('./pluginsPanel');
const githubPanel = require('./githubPanel');
const promptsPanel = require('./promptsPanel');
const specPanel = require('./specPanel');
const specPanelResize = require('./specPanelResize');
const specsDashboard = require('./specsDashboard');
const state = require('./state');
const projectListUI = require('./projectListUI');
const openProjectModal = require('./openProjectModal');
const projectSection = require('./projectSection');
const projectStatusBadges = require('./projectStatusBadges');
const agentPanel = require('./agentPanel');
const orchestrator = require('./orchestrator');
const editor = require('./editor');
const sidebarResize = require('./sidebarResize');
const aiToolSelector = require('./aiToolSelector');
const commandRegistry = require('./commandRegistry');
const commandPalette = require('./commandPalette');
const cheatSheet = require('./cheatSheet');
const welcomeOverlay = require('./welcomeOverlay');
const appLoader = require('./appLoader');
const settingsModal = require('./settingsModal');
const telemetryNotice = require('./telemetryNotice');
const sampleBanner = require('./sampleBanner');

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

  // Orchestrator (conductor-led parallel spec execution) — a section tab that
  // composes lanes + agentDispatch; opened from the command palette / Home.
  orchestrator.setHost(multiTerminalUI);

  // Initialize project list UI
  projectListUI.init('projects-list', (projectPath) => {
    state.setProjectPath(projectPath);
  });

  // Load projects from workspace
  projectListUI.loadProjects();

  // Surface background-project agent activity (needs-approval / waiting-for-input)
  // as badges on the project rows.
  projectStatusBadges.init(multiTerminalUI);

  // Agent rail view: live list of running agents across all projects.
  agentPanel.init(multiTerminalUI);

  // Initialize file tree UI
  fileTreeUI.init('file-tree', state.getProjectPath);
  fileTreeUI.setProjectPathGetter(state.getProjectPath);

  // Git Changes panel (Changes sidebar tab); a row click opens that file's
  // diff as a section tab (next to Home / Frames), navigable with ◀ / ▶.
  gitChangesPanel.init({
    onRowClick: ({ projectPath, relPath, staged }) => {
      if (!projectPath || !relPath) return;
      diffSection.open({ projectPath, relPath, staged });
    }
  });

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

  // Initialize tasks dashboard (Kanban view triggered from tasks panel header)
  tasksDashboard.init();

  // Initialize the shared task delete-confirm modal
  taskConfirmModal.init();

  // Initialize the shared task info modal (no-project guards, etc.)
  taskInfoModal.init();

  // Initialize the play-button run-config modal
  taskRunModal.init();

  // Initialize plugins panel
  pluginsPanel.init();

  // Initialize GitHub panel
  githubPanel.init();

  // Initialize prompts panel
  promptsPanel.init();

  // Initialize specs panel (spec-driven development)
  specPanel.init();
  specPanelResize.init();

  // Initialize specs dashboard (full-page card grid, opened from panel header)
  specsDashboard.init();

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

      // Start watching .frame/specs/ for the new project
      specPanel.startWatchingForProject(projectPath);
    } else {
      fileTreeUI.clearFileTree({ unwatch: true });
      specPanel.stopWatching();
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

  // Initialize the Open Project modal (shell over the existing open flows)
  openProjectModal.init();

  // Initialize the pinned Projects section (root-level project switcher)
  projectSection.init();

  // Setup button handlers
  setupButtonHandlers();

  // Initialize command palette + cheat sheet, register all commands, then bind keyboard
  // App loader registers its WORKSPACE_DATA listener first so it fades out
  // before welcomeOverlay's listener can open the welcome modal.
  appLoader.init();

  commandPalette.init();
  cheatSheet.init();
  welcomeOverlay.init();
  settingsModal.init();
  telemetryNotice.init(() => settingsModal.open());
  sampleBanner.init();
  setupUpdateDot();
  registerCommands();
  require('./supervisor-ui').init(); // supervisor-mod
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
  // Clone GitHub result. The clone request is sent from the Open Project modal
  // (openProjectModal.js); here we just route the result back to it: on success
  // open the project + close the modal, on failure show the error inline (or a
  // dialog if the modal isn't open).
  ipcRenderer.on(IPC.CLONE_GITHUB_REPO_RESULT, (event, result) => {
    if (result.cancelled) return;
    if (result.success) {
      state.setProjectPath(result.projectPath);
      openProjectModal.handleCloneResult(result);
      return;
    }
    const consumed = openProjectModal.handleCloneResult(result);
    if (!consumed) alert('Clone failed:\n' + result.error);
  });

  // Start AI Tool (Claude Code / Codex CLI / etc.)
  document.getElementById('btn-start-ai').addEventListener('click', async () => {
    const projectPath = state.getProjectPath();
    if (projectPath) {
      const newTerminalId = await terminal.restartTerminal(projectPath);

      if (newTerminalId) {
        // Ensure the new terminal is focused
        terminal.setActiveTerminal(newTerminalId);

        // Send start command for the selected AI tool. The board's agent
        // chip is derived live from the foreground process, not tagged here.
        const startCommand = aiToolSelector.getStartCommand();
        setTimeout(() => {
          terminal.sendCommand(startCommand, newTerminalId);
        }, 1000);
      }
    }
  });

  // Sidebar "Start default agent" shortcut — context decides whether it
  // starts in the focused Frame, a new Frame, or after a kill-and-restart
  // prompt (see agentDispatch.startDefaultAgent).
  document.getElementById('sidebar-agent-launch').addEventListener('click', () => {
    require('./agentDispatch').startDefaultAgent();
  });

  // Refresh file tree
  document.getElementById('btn-refresh-tree').addEventListener('click', () => {
    fileTreeUI.refreshFileTree();
  });

  // Close history panel
  document.getElementById('history-close').addEventListener('click', () => {
    historyPanel.toggleHistoryPanel();
  });

  // Initialize as Frame project
  document.getElementById('btn-initialize-frame').addEventListener('click', () => {
    state.initializeAsFrameProject();
  });

  // Sidebar activity rail (Projects / Files / Changes). Bound to the button,
  // not e.target — clicks land on the inner SVG/path otherwise.
  document.querySelectorAll('.sidebar-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => revealSidebarTab(btn.dataset.sidebarTab));
  });

  // Current-project switcher (Files / Changes views): reflects the active
  // project and opens a dropdown to switch project without leaving the view.
  const currentProjectNameEl = document.getElementById('sidebar-current-project-name');
  const renderCurrentProject = () => {
    if (!currentProjectNameEl) return;
    const path = state.getProjectPath();
    const name = path ? (path.split('/').pop() || path.split('\\').pop()) : null;
    currentProjectNameEl.textContent = name || 'No project';
  };
  state.onProjectChange(renderCurrentProject);
  renderCurrentProject();
  setupProjectSwitcher();
}

/**
 * Wire the current-project dropdown: build the project list on open, switch on
 * select (reuses projectListUI.selectProject, the same path as clicking a row),
 * and close on outside click / Escape.
 */
function setupProjectSwitcher() {
  const btn = document.getElementById('sidebar-current-project');
  const menu = document.getElementById('sidebar-project-menu');
  if (!btn || !menu) return;

  const CHECK = '<svg class="sidebar-project-menu-item-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  const close = () => {
    if (menu.hidden) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onKeydown, true);
  };

  const onDocClick = (e) => {
    if (!menu.contains(e.target) && !btn.contains(e.target)) close();
  };
  const onKeydown = (e) => {
    if (e.key === 'Escape') close();
  };

  const open = () => {
    const projects = projectListUI.getProjects();
    const active = projectListUI.getActiveProject();
    menu.innerHTML = '';

    if (!projects.length) {
      const empty = document.createElement('div');
      empty.className = 'sidebar-project-menu-empty';
      empty.textContent = 'No projects yet';
      menu.appendChild(empty);
    } else {
      projects.forEach((p) => {
        const isActive = p.path === active;
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'sidebar-project-menu-item' + (isActive ? ' active' : '');
        item.setAttribute('role', 'menuitem');
        item.innerHTML = '<span class="sidebar-project-menu-item-name"></span>'
          + (p.isFrameProject ? '<span class="sidebar-project-menu-tag">Frame</span>' : '')
          + (isActive ? CHECK : '');
        item.querySelector('.sidebar-project-menu-item-name').textContent = p.name;
        item.addEventListener('click', () => {
          close();
          if (!isActive) projectListUI.selectProject(p.path);
        });
        menu.appendChild(item);
      });
    }

    const sep = document.createElement('div');
    sep.className = 'sidebar-project-menu-sep';
    menu.appendChild(sep);

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'sidebar-project-menu-item sidebar-project-menu-add';
    add.setAttribute('role', 'menuitem');
    add.innerHTML = '<span class="sidebar-project-menu-item-name">+ Open a project…</span>';
    add.addEventListener('click', () => {
      close();
      openProjectModal.open();
    });
    menu.appendChild(add);

    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    // Defer so this opening click doesn't immediately close via the doc listener.
    setTimeout(() => {
      document.addEventListener('click', onDocClick, true);
      document.addEventListener('keydown', onKeydown, true);
    }, 0);
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.hidden) open(); else close();
  });
}

/**
 * Show update indicators when a new version is available:
 * - Small pulsing dot in the sidebar header (peripheral signal)
 * - Sidebar footer banner with version + arrow (primary, click-to-act signal)
 *
 * Both are hidden when the user has dismissed that same version (Settings
 * → About → "Dismiss this version"). Both click open Settings → About.
 */
function setupUpdateDot() {
  const dot = document.getElementById('update-dot');
  const banner = document.getElementById('sidebar-update-banner');
  const bannerVersionEl = document.getElementById('sidebar-update-banner-version');

  ipcRenderer.on(IPC.UPDATE_AVAILABLE, async (event, info) => {
    if (!info || !info.latestVersion) return;
    const dismissed = await ipcRenderer.invoke(
      IPC.GET_USER_SETTING,
      'dismissedUpdateVersion'
    );
    if (dismissed === info.latestVersion) return;
    if (dot) dot.style.display = '';
    if (banner) {
      if (bannerVersionEl) bannerVersionEl.textContent = `v${info.latestVersion}`;
      banner.style.display = '';
    }
  });

  if (dot) {
    dot.addEventListener('click', () => settingsModal.open());
  }
  if (banner) {
    banner.addEventListener('click', () => settingsModal.open());
  }
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
  // The current-project switcher shows (and changes) the active project for
  // Files / Changes and the Agent view's Start target. It's hidden only on
  // Projects, which highlights its own active row. (The Agent view's Running
  // Agents list stays cross-project regardless of this selection.)
  const cp = document.getElementById('sidebar-current-project-wrap');
  if (cp) cp.style.display = tabName === 'projects' ? 'none' : '';
  if (tabName === 'changes') ipcRenderer.send(IPC.REFRESH_GIT_STATUS);
  if (tabName === 'agent') agentPanel.recompute();
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
  r({
    id: 'help.welcome',
    title: 'Show Welcome Screen',
    category: 'Help',
    run: () => welcomeOverlay.reopen()
  });
  r({
    id: 'settings.open',
    title: 'Open Settings',
    category: 'Help',
    shortcut: 'CmdOrCtrl+,',
    run: () => settingsModal.open()
  });
  r({
    id: 'app.checkForUpdate',
    title: 'Check for Updates',
    category: 'Help',
    run: async () => {
      settingsModal.open();
      // Settings modal's own check button can be triggered via the IPC handler
      // that already exists; opening Settings is sufficient because the About
      // section auto-runs a check if no cached status is available.
      await ipcRenderer.invoke(IPC.CHECK_FOR_UPDATE);
    }
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
  // Tasks/Specs side panels are retired — Home's lane rail covers the
  // at-a-glance view, and these entry points now open the full dashboards.
  r({
    id: 'panel.toggleTasksDashboard',
    title: 'Toggle Tasks Dashboard',
    category: 'Panel',
    shortcut: 'CmdOrCtrl+Shift+D',
    run: () => tasksDashboard.toggle()
  });
  r({
    id: 'panel.toggleSpecsDashboard',
    title: 'Toggle Specs Dashboard',
    category: 'Panel',
    shortcut: 'CmdOrCtrl+Shift+S',
    run: () => specsDashboard.toggle()
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
      // Projects is its own rail view now — reveal it, then focus the list.
      revealSidebarTab('projects');
      fileTreeUI.blur();
      projectSection.focusList();
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
    run: () => openProjectModal.open()
  });
  r({
    id: 'project.create',
    title: 'Create New Project…',
    category: 'Project',
    run: () => openProjectModal.open()
  });
  r({
    id: 'project.initializeFrame',
    title: 'Initialize as Frame Project',
    category: 'Project',
    when: () => !!state.getProjectPath() && !state.getIsFrameProject(),
    run: () => state.initializeAsFrameProject()
  });

  // ---------- Lanes / Terminal ----------
  r({
    id: 'lane.home',
    title: 'Back to Mainframe',
    category: 'Frames',
    shortcut: 'CmdOrCtrl+Escape',
    run: () => {
      const ui = terminal.getMultiTerminalUI();
      if (ui) ui.goHome();
    }
  });
  r({
    id: 'terminal.new',
    title: 'New Frame',
    category: 'Frames',
    shortcut: 'CmdOrCtrl+Shift+T',
    when: () => !!state.getProjectPath(),
    run: () => {
      const ui = terminal.getMultiTerminalUI();
      if (ui) {
        ui.createTerminalForCurrentProject().then((id) => {
          if (id) ui.enterLane(id);
        });
      }
    }
  });
  r({
    id: 'terminal.close',
    title: 'Close Frame',
    category: 'Frames',
    shortcut: 'CmdOrCtrl+Shift+W',
    run: () => {
      const ui = terminal.getMultiTerminalUI();
      if (ui) ui.closeActiveTerminal();
    }
  });
  r({
    id: 'terminal.next',
    title: 'Next Frame',
    category: 'Frames',
    shortcut: 'CmdOrCtrl+Tab',
    run: () => {
      const ui = terminal.getMultiTerminalUI();
      if (ui) ui.switchTerminal(1);
    }
  });
  r({
    id: 'terminal.prev',
    title: 'Previous Frame',
    category: 'Frames',
    shortcut: 'CmdOrCtrl+Shift+Tab',
    run: () => {
      const ui = terminal.getMultiTerminalUI();
      if (ui) ui.switchTerminal(-1);
    }
  });
  for (let i = 1; i <= 9; i++) {
    r({
      id: `terminal.switch.${i}`,
      title: `Switch to Frame ${i}`,
      category: 'Frames',
      shortcut: `CmdOrCtrl+${i}`,
      run: () => {
        const ui = terminal.getMultiTerminalUI();
        if (ui) ui.setActiveTerminalByIndex(i - 1);
      }
    });
  }

  // ---------- Orchestrator ----------
  r({
    id: 'orchestrator.open',
    title: 'Open Orchestrator',
    category: 'Orchestrator',
    shortcut: 'CmdOrCtrl+Shift+O',
    when: () => !!state.getProjectPath(),
    run: () => orchestrator.open()
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
