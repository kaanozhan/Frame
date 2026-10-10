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
const tasksPanel = require('./tasksPanel');
const tasksDashboard = require('./tasksDashboard');
const taskConfirmModal = require('./taskConfirmModal');
const taskInfoModal = require('./taskInfoModal');
const taskRunModal = require('./taskRunModal');
const pluginsPanel = require('./pluginsPanel');
const sessionsPanel = require('./sessionsPanel');
const githubPanel = require('./githubPanel');
const notify = require('./notify');
const promptsPanel = require('./promptsPanel');
const activityPanel = require('./activityPanel');
const specPanel = require('./specPanel');
const specPanelResize = require('./specPanelResize');
const specsDashboard = require('./specsDashboard');
const state = require('./state');
const projectListUI = require('./projectListUI');
const openProjectModal = require('./openProjectModal');
const projectSection = require('./projectSection');
const projectStatusBadges = require('./projectStatusBadges');
const orchestrator = require('./orchestrator');
const editor = require('./editor');
const sidebarResize = require('./sidebarResize');
const appHeader = require('./appHeader');
const aiToolSelector = require('./aiToolSelector');
const selectMenu = require('./selectMenu');
const commandRegistry = require('./commandRegistry');
const commandPalette = require('./commandPalette');
const cheatSheet = require('./cheatSheet');
const { applyTheme, currentTheme } = require('./terminalTabBar');
const themes = require('./themes');
const uiZoom = require('../shared/uiZoom');
const onboarding = require('./onboarding');
const projectStart = require('./projectStart');
const guideModal = require('./guideModal');
const guidedTour = require('./guidedTour');
const appLoader = require('./appLoader');
const projectSettingsModal = require('./projectSettingsModal');
const doneWindow = require('./doneWindow');
const frameSettingsModal = require('./frameSettingsModal');
const feedbackPanel = require('./feedbackPanel');
const analyticsNotice = require('./analyticsNotice');
const healthNotice = require('./healthNotice');
const specDrivenHint = require('./specDrivenHint');
const docsHealthHint = require('./docsHealthHint');
const migrationModal = require('./migrationModal');
const sampleBanner = require('./sampleBanner');
const dock = require('./dock');
const dockState = require('./dock/dockState');
const tooltip = require('./tooltip');

/**
 * Initialize all modules
 */
function init() {
  // IPC watchdog first, so it observes every module's traffic from boot
  require('./ipcWatchdog').init();

  // Show app version
  const version = require('../../package.json').version;
  const versionEl = document.getElementById('app-version');
  if (versionEl) versionEl.textContent = `v${version}`;

  // Initialize terminal
  const multiTerminalUI = terminal.initTerminal('terminal');

  // Reload reconcile: report the terminal ids this renderer actually holds
  // (none on a fresh boot or Cmd-R) so main kills orphaned PTYs instead of
  // leaving agents running invisibly with no attached view.
  const knownTerminalIds =
    multiTerminalUI && multiTerminalUI.manager && multiTerminalUI.manager.terminals
      ? Array.from(multiTerminalUI.manager.terminals.keys())
      : [];
  ipcRenderer
    .invoke(IPC.RECONCILE_TERMINALS, knownTerminalIds)
    .catch((err) => console.error('Terminal reconcile failed:', err));

  // Initialize state management
  state.init({
    fileExplorerHeader: document.getElementById('file-explorer-header')
  });

  // Initialize AI tool selector
  aiToolSelector.init((tool) => {
    console.log('AI tool changed to:', tool.name);
  });

  // Every <select> opens Frame's dropdown instead of the OS popup
  selectMenu.init();

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


  // Status bar at the foot of the window: Claude usage meters today
  // (status-bar spec).
  tooltip.init();
  require('./statusBar').init();

  // Initialize file tree UI
  fileTreeUI.init('file-tree', state.getProjectPath);
  fileTreeUI.setProjectPathGetter(state.getProjectPath);

  // Git Changes panel (Changes sidebar tab); a row click opens that file's
  // diff as a section tab (next to Home / Terminals), navigable with ◀ / ▶.
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

  // Initialize tasks panel
  tasksPanel.init();

  // The boards' done window (project setting) — loaded before either board
  // renders, re-loaded on project change; boards subscribe on their own.
  doneWindow.init();

  // Initialize tasks dashboard (Kanban view triggered from tasks panel header)
  tasksDashboard.init();

  // Initialize the shared task delete-confirm modal
  taskConfirmModal.init();

  // Initialize the shared task info modal (no-project guards, etc.)
  taskInfoModal.init();

  // Initialize the play-button run-config modal
  taskRunModal.init();

  // Plugins (a modal from the foot of the sidebar rail) and Sessions (a
  // center-hosted Context view).
  pluginsPanel.init();
  sessionsPanel.init();

  // Initialize GitHub panel. Terminal lanes (Sign in to GitHub, Open
  // terminal here) come through this hook (github-view-tree-layout D11):
  // the panel never requires multiTerminalUI itself — that would be a
  // require cycle through terminal.js — and index.js already holds the
  // instance.
  githubPanel.init({
    openLane: async ({ cwd, command } = {}) => {
      let id = null;
      try {
        id = await multiTerminalUI.createTerminalForCurrentProject(cwd ? { cwd } : {});
      } catch (err) {
        notify.error(`Could not create a new terminal: ${err.message || 'terminal creation failed'}`);
        return null;
      }
      if (!id) {
        notify.error('Could not create a new terminal: per-project limit reached');
        return null;
      }
      multiTerminalUI.enterLane(id);
      if (command) {
        // Give the shell a moment to be ready before the first command
        setTimeout(() => multiTerminalUI.sendCommand(command, id), 300);
      }
      return id;
    }
  });

  // Initialize prompts panel
  promptsPanel.init();
  activityPanel.init();

  // Initialize specs panel (spec-driven development)
  specPanel.init();
  specPanelResize.init();

  // Initialize specs dashboard (full-page card grid, opened from panel header)
  specsDashboard.init();

  // The dock beside the center (dock-panel-readonly-views spec): hosts the
  // read-only surfaces; restores its last position / tab / size.
  // After the panels it hosts have initialized, so a dock restored open at
  // boot mounts a panel whose show() can already load.
  dock.init();

  // Initialize sidebar resize
  sidebarResize.init(() => {
    terminal.fitTerminal();
  });

  // The app header (shell-chrome-app-header-collapsible-panels spec): theme
  // restore, the update bell, the agent select. After the sidebar and dock
  // have restored their states so its layout toggles can read them.
  appHeader.init();

  // Setup state change listeners
  state.onProjectChange((projectPath, previousPath) => {
    if (projectPath) {
      fileTreeUI.loadFileTree(projectPath);

      // Add to workspace and update project list
      const projectName = projectPath.split('/').pop() || projectPath.split('\\').pop();
      projectListUI.addProject(projectPath, projectName);
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
    // An open dock tab follows the switcher the way the workspace nav does:
    // Decisions and Structure re-render for the new project, the
    // re-parented panels reload through their own show().
    dock.remountActive();
  });

  // Setup Frame status change listener
  state.onFrameStatusChange((isFrame) => {
    // Refresh project list when Frame status changes
    projectListUI.loadProjects();
  });

  // Setup Frame initialized listener
  state.onFrameInitialized((projectPath) => {
    terminal.writelnToTerminal(`\x1b[1;32m✓ Frame project initialized!\x1b[0m`);
    terminal.writelnToTerminal(`  Created: .frame/ (AGENTS.md, STRUCTURE.json, PROJECT_NOTES.md, tasks.json, QUICKSTART.md, bin/) and .claude/rules/frame.md`);
    // Refresh file tree to show new files
    fileTreeUI.refreshFileTree();
    // Load tasks for the new project
    tasksPanel.loadTasks();
    // The spec watch skipped this project while it had no .frame/ — start it
    // now (this also stages the spec commands).
    specPanel.startWatchingForProject(projectPath);
  });

  // Initialize the Open Project modal (shell over the existing open flows)
  openProjectModal.init();

  // Initialize the pinned Projects section (root-level project switcher)
  projectSection.init();

  // Setup button handlers
  setupButtonHandlers();

  // Initialize command palette + cheat sheet, register all commands, then bind
  // keyboard. appLoader also initializes onboarding: on a first run the boot
  // surface becomes the onboarding screen instead of fading to an empty app.
  // The guided tour initializes first: it waits on the loader's exit.
  guidedTour.init({ revealProjectsTab: () => revealSidebarTab('projects') });
  appLoader.init();

  commandPalette.init();
  require('./paletteSources').init(multiTerminalUI); // dynamic ⌘K jump targets
  cheatSheet.init();
  guideModal.init();
  projectSettingsModal.init();
  frameSettingsModal.init();
  feedbackPanel.init();
  // The notice is about what Frame sends home — Privacy lives in Frame's
  // own settings, not the project's.
  analyticsNotice.init(() => frameSettingsModal.open());
  healthNotice.init();
  sampleBanner.init();
  specDrivenHint.init();
  docsHealthHint.init();
  migrationModal.init();
  setupUpdateDot();
  registerCommands();
  commandRegistry.bindKeyboard();

  // Window resize → refit every terminal, but only once the drag settles.
  // Undebounced this fired per frame and each frame sent one resize IPC per
  // open terminal — 363 messages in 2.2s with three terminals, enough to trip
  // the IPC watchdog (resize-storm-watchdog spec). The PTY only needs the
  // final size. 80ms matches the terminals view's own ResizeObserver, so both
  // resize paths settle alike.
  let resizeSettleTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeSettleTimer);
    resizeSettleTimer = setTimeout(() => terminal.fitTerminal(), 80);
  });
}

/**
 * Setup button click handlers
 */
function setupButtonHandlers() {
  // Clone GitHub result. Every clone is sent by a projectStart block — the
  // first-run screen, Home's no-project state or the Open a Project modal —
  // and the block answers for the one it sent, so a failure is reported where
  // the user is looking. Success opens the project; each host leaves on
  // state.onProjectChange.
  ipcRenderer.on(IPC.CLONE_GITHUB_REPO_RESULT, (event, result) => {
    if (result.success) state.setProjectPath(result.projectPath);
    const consumed = projectStart.handleCloneResult(result);
    if (result.cancelled || result.success) return;
    // Was a bare alert(), which blocks the renderer and every IPC behind it.
    if (!consumed) notify.error('Clone failed: ' + (result.error || 'unknown error'));
  });

  // The native View menu's one channel to the renderer: a command-registry
  // id, run through the same registry the palette, the status bar and the
  // shortcuts use (dock-panel-readonly-views spec, C6 / D12).
  // A zoom step changes every pane's CSS-px size: the terminals' own
  // ResizeObserver fits them too, but a fit on the next frame — after
  // layout has settled at the new factor — is what makes the PTY grid
  // certain to match (ui-zoom-steps spec, C6). _sendResize dedupes.
  ipcRenderer.on(IPC.UI_ZOOM_CHANGED, () => {
    requestAnimationFrame(() => terminal.fitTerminal());
  });

  ipcRenderer.on(IPC.RUN_APP_COMMAND, (event, commandId) => {
    if (!commandRegistry.runById(commandId)) {
      console.error(`Menu command '${commandId}' did not run — unknown id or unavailable right now`);
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

  // Sidebar activity rail (Projects / Files / Changes / GitHub). Bound to the
  // button, not e.target — clicks land on the inner SVG/path otherwise.
  document.querySelectorAll('.sidebar-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => revealSidebarTab(btn.dataset.sidebarTab));
  });

  // The foot of the sidebar rail — Plugins, Feedback, then Frame Settings:
  // each a modal (pluginsPanel, feedbackPanel, frameSettingsModal), not a
  // view — hence no .sidebar-tab-btn on the buttons. All three toggle.
  const pluginsBtn = document.getElementById('plugins-btn');
  if (pluginsBtn) {
    pluginsBtn.addEventListener('click', () => pluginsPanel.toggle());
    tooltip.attach(pluginsBtn, 'Plugins', { placement: 'right' });
  }
  const feedbackBtn = document.getElementById('feedback-btn');
  if (feedbackBtn) {
    feedbackBtn.addEventListener('click', () => feedbackPanel.toggle());
    // Outboard of the rail, like the spec-driven hint anchors.
    tooltip.attach(feedbackBtn, 'Send Feedback', { placement: 'right' });
  }

  // Frame's own settings, from the gear at the foot of the rail (where the
  // app menu entry and Cmd+, also land); toggles, so a second click closes
  // it. The project's settings are a row under the project in the workspace
  // nav (dock-panel-readonly-views spec), running `settings.openProject`.
  const frameSettingsBtn = document.getElementById('frame-settings-btn');
  if (frameSettingsBtn) {
    frameSettingsBtn.addEventListener('click', () => frameSettingsModal.toggle());
    tooltip.attach(frameSettingsBtn, 'Frame Settings (Cmd+,)', { placement: 'right' });
  }

  // How to Use Frame, the last button at the rail's foot (under the gear).
  // Runs the same registered command as Help › How to Use Frame and the
  // palette (how-to-use-frame-guide spec).
  const guideBtn = document.getElementById('guide-btn');
  if (guideBtn) {
    guideBtn.addEventListener('click', () => commandRegistry.runById('help.guide'));
    tooltip.attach(guideBtn, 'How to Use Frame', { placement: 'right' });
  }

  // Theme toggle now lives in the top bar and is wired by terminalTabBar,
  // which renders it and already owns the boot-time theme restore
  // (status-bar spec). Binding it from here would attach a listener before
  // the element exists.

  // Current-project switcher (above the rail and the panel): reflects the
  // active project and opens a dropdown to switch project without leaving
  // the view.
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

  // Always visible now — it is the one project selector (project-dropdown spec)
  const wrap = document.getElementById('sidebar-current-project-wrap');
  if (wrap) wrap.style.display = '';

  const CHECK = '<svg class="sidebar-project-menu-item-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  // Small mark after the name of a project Frame isn't set up in; its
  // tooltip says where to fix that (Project Settings' top banner).
  const NOT_SET_UP = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17" stroke-width="2.4"/></svg>';

  const close = () => {
    // Rows are rebuilt on every open, so a label left on one would never see
    // its mouseleave.
    tooltip.hide();
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
    const wasOpen = !menu.hidden;
    tooltip.hide();
    menu.innerHTML = '';

    // "Add a project" leads the menu: with a long list at the end it sat
    // below a scroll.
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'sidebar-project-menu-item sidebar-project-menu-add';
    add.setAttribute('role', 'menuitem');
    add.innerHTML = '<span class="sidebar-project-menu-item-name">+ Add a project…</span>';
    add.addEventListener('click', () => {
      close();
      openProjectModal.open();
    });
    menu.appendChild(add);

    const sep = document.createElement('div');
    sep.className = 'sidebar-project-menu-sep';
    menu.appendChild(sep);

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
        const counts = projectListUI.getAgentStatus(p.path);
        const attention = counts && (counts.approval || counts.input)
          ? `<span class="sidebar-project-menu-dot ${counts.approval ? 'approval' : 'input'}" title="${counts.approval ? 'agents need approval' : 'agents waiting for input'}"></span>`
          : '';
        item.innerHTML = '<span class="sidebar-project-menu-item-name"></span>'
          + (p.isFrameProject ? '' : `<span class="sidebar-project-menu-unset">${NOT_SET_UP}</span>`)
          + attention
          + (isActive ? CHECK : '')
          + '<span class="sidebar-project-menu-remove" title="Remove from list">×</span>';
        item.querySelector('.sidebar-project-menu-item-name').textContent = p.name;
        const unset = item.querySelector('.sidebar-project-menu-unset');
        if (unset) {
          tooltip.attach(unset, 'Frame not set up — initialize it in Project Settings');
        }
        item.addEventListener('click', (e) => {
          if (e.target.closest('.sidebar-project-menu-remove')) {
            close();
            projectListUI.confirmRemoveProject(p.path, p.name);
            return;
          }
          close();
          if (!isActive) projectListUI.selectProject(p.path);
        });
        menu.appendChild(item);
      });
    }

    menu.hidden = false;
    // Open at the top, where "Add a project" is — a refresh while open keeps
    // the user's scroll.
    if (!wasOpen) menu.scrollTop = 0;
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

  // Headless projectListUI drives us: focus() opens the menu, data changes
  // rebuild it while open.
  projectListUI.setSwitcherHooks({
    open,
    refresh: () => { if (!menu.hidden) open(); }
  });
}

/**
 * Show the sidebar's update banner (version + arrow, click-to-act) when a
 * new version is available. Hidden when the user has dismissed that same
 * version (Settings → About → "Dismiss this version"); click opens
 * Settings → About. The header's bell (appHeader.js) is the other signal;
 * the pulsing dot beside the mark was removed on 2026-09-14.
 */
function setupUpdateDot() {
  const banner = document.getElementById('sidebar-update-banner');
  const bannerVersionEl = document.getElementById('sidebar-update-banner-version');

  ipcRenderer.on(IPC.UPDATE_AVAILABLE, async (event, info) => {
    if (!info || !info.latestVersion) return;
    const dismissed = await ipcRenderer.invoke(
      IPC.GET_USER_SETTING,
      'dismissedUpdateVersion'
    );
    if (dismissed === info.latestVersion) return;
    if (banner) {
      if (bannerVersionEl) bannerVersionEl.textContent = `v${info.latestVersion}`;
      banner.style.display = '';
    }
  });

  if (banner) {
    banner.addEventListener('click', () => frameSettingsModal.open());
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
  // The current-project switcher is THE project selector on every tab
  // (project-dropdown spec) — the list/rail it used to defer to is gone.
  const cp = document.getElementById('sidebar-current-project-wrap');
  if (cp) cp.style.display = '';
  if (tabName === 'changes') ipcRenderer.send(IPC.REFRESH_GIT_STATUS);
  // GitHub loads on reveal the way Changes refreshes on reveal (D8); the
  // panel's own show() owns the data and the .visible flag.
  if (tabName === 'github') githubPanel.show();
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
    id: 'help.guide',
    title: 'How to Use Frame',
    category: 'Help',
    run: () => guideModal.open()
  });
  r({
    id: 'help.tour',
    title: 'Take the Frame Tour',
    category: 'Help',
    run: () => guidedTour.start()
  });
  r({
    id: 'help.welcome',
    title: 'Show the Start Screen',
    category: 'Help',
    run: () => onboarding.open()
  });
  r({
    id: 'settings.open',
    title: 'Frame Settings',
    category: 'Help',
    shortcut: 'CmdOrCtrl+,',
    run: () => frameSettingsModal.open()
  });
  r({
    id: 'settings.openProject',
    title: 'Project Settings',
    category: 'Help',
    run: () => projectSettingsModal.open()
  });
  r({
    id: 'app.checkForUpdate',
    title: 'Check for Updates',
    category: 'Help',
    run: async () => {
      frameSettingsModal.open();
      // The About panel's own check button can be triggered via the IPC handler
      // that already exists; opening Frame Settings is sufficient because the
      // About section auto-runs a check if no cached status is available.
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
  // 'panel.toggleHistory' retired with the History panel: it and
  // 'panel.togglePrompts' now pointed at the same surface, and one prompt
  // history belongs behind one command (sidebar-nav-groups spec).
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
    // Was 'panel.togglePlugins' / "Toggle Claude Panel": the Claude panel
    // split into the Sessions view (Context row) and the Plugins modal
    // behind the rail's foot button. The shortcut stays with the
    // center-hosted half.
    id: 'panel.toggleSessions',
    title: 'Toggle Sessions',
    category: 'Panel',
    shortcut: 'CmdOrCtrl+Shift+X',
    run: () => require('./terminal').getMultiTerminalUI()?.togglePanel('sessions')
  });
  // 'panel.toggleGitHub' became 'sidebar.github' (View) when GitHub moved
  // to the icon rail; the shortcut travelled with it.
  // 'panel.togglePrompts' became 'dock.prompts' (below) when Prompts moved
  // into the dock; the shortcut travelled with it.

  // ---------- View: the dock ----------
  // Every entry point — status bar, native View menu, palette, shortcut —
  // runs these same ids (dock-panel-readonly-views spec, D12). The per-tab
  // shortcuts come from dockState.TAB_SHORTCUTS (the status bar and the
  // strip read the same table for their tooltips). The View menu in
  // src/main/menu.js lists the same ids and accelerators; keep it in step.
  r({
    id: 'dock.toggle',
    title: 'Toggle Panel',
    category: 'View',
    shortcut: 'CmdOrCtrl+J',
    run: () => dock.toggle()
  });
  r({
    id: 'dock.decisions',
    title: 'Toggle Decisions',
    category: 'View',
    shortcut: dockState.TAB_SHORTCUTS.decisions,
    run: () => dock.toggleTab('decisions')
  });
  // 'dock.structure' (Toggle Structure Map) is parked with the tab — see
  // dockState.HIDDEN_TABS for what to restore when it ships.
  r({
    id: 'dock.prompts',
    title: 'Toggle Prompts',
    category: 'View',
    shortcut: dockState.TAB_SHORTCUTS.prompts,
    run: () => dock.toggleTab('prompts')
  });
  r({
    id: 'dock.activity',
    title: 'Toggle Activity',
    category: 'View',
    shortcut: dockState.TAB_SHORTCUTS.activity,
    run: () => dock.toggleTab('activity')
  });
  // Plugins has no menu item; the command exists so the How to Use Frame
  // guide can link to it the way the rail's foot button opens it.
  r({
    id: 'plugins.open',
    title: 'Plugins',
    category: 'Help',
    run: () => pluginsPanel.toggle()
  });
  // Feedback is a modal, not a dock tab: the rail's foot button, the Help
  // menu and the palette all run this.
  r({
    id: 'feedback.open',
    title: 'Send Feedback',
    category: 'Help',
    run: () => feedbackPanel.toggle()
  });
  r({
    id: 'sidebar.github',
    title: 'Show GitHub',
    category: 'View',
    shortcut: 'CmdOrCtrl+Shift+G',
    run: () => revealSidebarTab('github')
  });
  r({
    id: 'dock.moveRight',
    title: 'Move Panel Right',
    category: 'View',
    when: () => dock.position() !== 'right',
    run: () => dock.setPosition('right')
  });
  r({
    id: 'dock.moveBottom',
    title: 'Move Panel to Bottom',
    category: 'View',
    when: () => dock.position() !== 'bottom',
    run: () => dock.setPosition('bottom')
  });

  // ---------- View: theme ----------
  // Same contract as the top-bar toggle (terminalTabBar.applyTheme); one
  // command per registry entry, whose ids back the View › Theme submenu in
  // src/main/menu.js.
  for (const id of themes.THEME_IDS) {
    const t = themes.THEMES[id];
    r({
      id: t.command,
      title: `Theme: ${t.label}`,
      category: 'View',
      when: () => currentTheme() !== id,
      run: () => applyTheme(id)
    });
  }

  // ---------- View: zoom ----------
  // Five-step interface scale (ui-zoom-steps spec). The factor is owned by
  // main (src/main/uiZoom.js): these commands read the current step, move it
  // along the shared ladder and ask main to apply it. The View menu in
  // src/main/menu.js carries the same ids and accelerators; keep it in step.
  // A press at the end of the ladder is a no-op — main returns early.
  const stepZoom = async (delta) => {
    const { step } = await ipcRenderer.invoke(IPC.UI_ZOOM_GET);
    await ipcRenderer.invoke(IPC.UI_ZOOM_SET, uiZoom.clampStep(step + delta));
  };
  r({
    id: 'view.zoomIn',
    title: 'Zoom In',
    category: 'View',
    shortcut: 'CmdOrCtrl+Shift+0',
    run: () => stepZoom(1)
  });
  r({
    id: 'view.zoomOut',
    title: 'Zoom Out',
    category: 'View',
    shortcut: 'CmdOrCtrl+-',
    run: () => stepZoom(-1)
  });
  r({
    id: 'view.zoomReset',
    title: 'Reset Zoom',
    category: 'View',
    shortcut: 'CmdOrCtrl+0',
    run: () => ipcRenderer.invoke(IPC.UI_ZOOM_SET, uiZoom.DEFAULT_STEP)
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

  // ---------- Home / Terminals ----------
  r({
    id: 'lane.home',
    // The palette's own idiom for a surface ("Go to Terminals", "Go to
    // Specs"). This command *is* the palette's Go to Home — a second entry in
    // paletteSources' viewItems would put two identical rows in one list.
    title: 'Go to Home',
    category: 'Terminals',
    shortcut: 'CmdOrCtrl+Escape',
    run: () => {
      const ui = terminal.getMultiTerminalUI();
      if (ui) ui.goHome();
    }
  });
  r({
    id: 'terminal.new',
    title: 'New Terminal',
    category: 'Terminals',
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
    title: 'Close Terminal',
    category: 'Terminals',
    shortcut: 'CmdOrCtrl+Shift+W',
    run: () => {
      const ui = terminal.getMultiTerminalUI();
      if (ui) ui.closeActiveTerminal();
    }
  });
  r({
    id: 'terminal.next',
    title: 'Next Terminal',
    category: 'Terminals',
    shortcut: 'CmdOrCtrl+Tab',
    run: () => {
      const ui = terminal.getMultiTerminalUI();
      if (ui) ui.switchTerminal(1);
    }
  });
  r({
    id: 'terminal.prev',
    title: 'Previous Terminal',
    category: 'Terminals',
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
      category: 'Terminals',
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
    run: () => startAiSession()
  });
}

/**
 * Start the selected AI tool (Claude Code / Codex CLI / etc.) in a fresh
 * terminal for the current project. Palette-only entry point — the old
 * sidebar "Start" button was parked and has been removed.
 */
async function startAiSession() {
  const projectPath = state.getProjectPath();
  if (!projectPath) return;

  const newTerminalId = await terminal.restartTerminal(projectPath);
  if (!newTerminalId) return;

  // Ensure the new terminal is focused
  terminal.setActiveTerminal(newTerminalId);

  // Send start command for the selected AI tool. The board's agent
  // chip is derived live from the foreground process, not tagged here.
  const startCommand = aiToolSelector.getStartCommand();
  setTimeout(() => {
    terminal.sendCommand(startCommand, newTerminalId);
  }, 1000);
}

/**
 * Start application when DOM is ready
 */
// Renderer exceptions reach the same opt-in channel the main process uses.
// Only the three fields are forwarded — an Error does not survive structured
// cloning intact, and sending anything wider would hand the main process
// fields nobody has sanitized. captureException does the stripping there.
function forwardException(err) {
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    ipcRenderer.send(IPC.ANALYTICS_EXCEPTION, {
      name: e.name,
      message: e.message,
      stack: e.stack
    });
  } catch (_) {
    // Reporting a failure must never become one.
  }
}

window.addEventListener('error', (event) => {
  forwardException(event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  forwardException(event.reason);
});

window.addEventListener('load', () => {
  init();

  // Give a moment for terminal to fully render, then start PTY
  setTimeout(() => {
    terminal.startTerminal();
  }, 100);
});
