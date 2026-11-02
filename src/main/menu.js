/**
 * Application Menu Module
 * Defines menu structure and handlers
 * Supports dynamic menu based on active AI tool
 *
 * Roots (macOS): Frame · File · Edit · View · Go · Project · Terminal ·
 * <AI tool> · Window · Help. Windows / Linux drop Frame and Window and
 * carry Settings / Exit under File, Check for Updates / About under Help.
 *
 * Every non-role item sends one command-registry id to the renderer over
 * RUN_APP_COMMAND (dock-panel-readonly-views spec, C6): the same ids the
 * status bar, the palette and the keyboard shortcuts run, registered in
 * src/renderer/index.js registerCommands(). The accelerators shown here
 * are copied from there — keep the two in step. The menu carries almost
 * no checkbox / radio state (main does not know the dock's state). Two
 * radio groups: the AI-tool switcher, whose state lives in main, and
 * View › Theme, whose state the renderer owns and reports over
 * THEME_CHANGED — the menu is rebuilt on each change so the check follows.
 */

const { Menu, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { IPC } = require('../shared/ipcChannels');
// Pure registry (no DOM / electron) — the one list of themes, shared with
// the renderer so the submenu and the theme.* commands can never disagree.
const themes = require('../renderer/themes');

let mainWindow = null;
let appPath = null;
let aiToolManager = null;
/** The theme the renderer last applied — drives the View › Theme radio. */
let currentTheme = themes.DEFAULT_THEME;

const isMac = process.platform === 'darwin';

/**
 * Initialize menu module
 */
function init(window, app, toolManager) {
  mainWindow = window;
  appPath = app.getPath('userData');
  aiToolManager = toolManager;

  ipcMain.removeAllListeners(IPC.THEME_CHANGED);
  ipcMain.on(IPC.THEME_CHANGED, (event, id) => {
    const next = themes.normalize(id);
    if (next === currentTheme) return;
    currentTheme = next;
    createMenu();
  });
}

/** Menu item that runs a command-registry id in the renderer. */
function cmd(label, commandId, accelerator) {
  const item = { label, click: () => sendAppCommand(commandId) };
  if (accelerator) item.accelerator = accelerator;
  return item;
}

const SEP = { type: 'separator' };

/**
 * Get menu template based on active AI tool
 */
function getMenuTemplate() {
  const activeTool = aiToolManager ? aiToolManager.getActiveTool() : {
    name: 'AI',
    command: 'claude',
    commands: {}
  };

  const template = [];

  // macOS app menu
  if (isMac) {
    template.push({
      label: 'Frame',
      submenu: [
        { role: 'about' },
        SEP,
        { label: 'Preferences…', accelerator: 'CmdOrCtrl+,', click: openSettings },
        cmd('Check for Updates…', 'app.checkForUpdate'),
        SEP,
        { role: 'services' },
        SEP,
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        SEP,
        { role: 'quit' }
      ]
    });
  }

  // File — workspace-level: opening and adding things. Current-project
  // actions live under Project.
  template.push({
    label: 'File',
    submenu: [
      cmd('Add Project to Workspace…', 'project.add'),
      cmd('Create New Project…', 'project.create'),
      SEP,
      { label: 'Open History File', accelerator: 'CmdOrCtrl+H', click: () => openHistoryFile() },
      ...(isMac ? [] : [
        SEP,
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: openSettings },
        SEP,
        { role: 'quit' }
      ])
    ]
  });

  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      SEP,
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' }
    ]
  });

  template.push({
    label: 'View',
    submenu: [
      cmd('Command Palette…', 'palette.toggle', 'CmdOrCtrl+Shift+P'),
      SEP,
      cmd('Toggle Sidebar', 'panel.toggleSidebar', 'CmdOrCtrl+B'),
      cmd('Toggle Panel', 'dock.toggle', 'CmdOrCtrl+J'),
      cmd('Move Panel Right', 'dock.moveRight'),
      cmd('Move Panel to Bottom', 'dock.moveBottom'),
      SEP,
      // One ⇧⌘ letter per dock tab — the renderer's source is
      // dockState.TAB_SHORTCUTS; the accelerator here is what the menu
      // shows beside the item and what makes it fire app-wide.
      cmd('Project Notes', 'dock.decisions', 'CmdOrCtrl+Shift+Y'),
      // 'Structure Map' (dock.structure) is parked — see dockState.HIDDEN_TABS.
      cmd('Prompts', 'dock.prompts', 'CmdOrCtrl+Shift+L'),
      cmd('Activity', 'dock.activity', 'CmdOrCtrl+Shift+A'),
      SEP,
      cmd('GitHub', 'sidebar.github', 'CmdOrCtrl+Shift+G'),
      cmd('Tasks Dashboard', 'panel.toggleTasksDashboard', 'CmdOrCtrl+Shift+D'),
      cmd('Specs Dashboard', 'panel.toggleSpecsDashboard', 'CmdOrCtrl+Shift+S'),
      cmd('Sessions', 'panel.toggleSessions', 'CmdOrCtrl+Shift+X'),
      SEP,
      {
        label: 'Theme',
        submenu: buildThemeSubmenu()
      },
      SEP,
      // Interface zoom (ui-zoom-steps spec): Frame's five-step ladder rather
      // than Electron's stock roles, so the palette, the cheat sheet and the
      // keyboard handler run the same ids. Zoom In is ⇧⌘0 by the user's
      // choice (2026-09-15), not the conventional ⌘=.
      cmd('Zoom In', 'view.zoomIn', 'CmdOrCtrl+Shift+0'),
      cmd('Zoom Out', 'view.zoomOut', 'CmdOrCtrl+-'),
      cmd('Reset Zoom', 'view.zoomReset', 'CmdOrCtrl+0'),
      { role: 'togglefullscreen' },
      SEP,
      {
        label: 'Developer',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' }
        ]
      }
    ]
  });

  template.push({
    label: 'Go',
    submenu: [
      cmd('Home', 'lane.home', 'CmdOrCtrl+Escape'),
      SEP,
      cmd('Next Project', 'project.next', 'CmdOrCtrl+Shift+]'),
      cmd('Previous Project', 'project.prev', 'CmdOrCtrl+Shift+['),
      SEP,
      cmd('Focus Project List', 'focus.projectList', 'CmdOrCtrl+E'),
      cmd('Focus File Tree', 'focus.fileTree', 'CmdOrCtrl+Shift+E')
    ]
  });

  template.push({
    label: 'Project',
    submenu: [
      cmd('Project Settings…', 'settings.openProject'),
      cmd('Initialize as Frame Project', 'project.initializeFrame')
      // Orchestrator hidden from the menu for now (see WORKSPACE_NAV_GROUPS in
      // projectListUI.js); the feature stays reachable from the command palette.
      // SEP,
      // cmd('Open Orchestrator (Beta)', 'orchestrator.open', 'CmdOrCtrl+Shift+O')
    ]
  });

  template.push({
    label: 'Terminal',
    submenu: [
      cmd('New Terminal', 'terminal.new', 'CmdOrCtrl+Shift+T'),
      cmd('Close Terminal', 'terminal.close', 'CmdOrCtrl+Shift+W'),
      SEP,
      cmd('Next Terminal', 'terminal.next', 'CmdOrCtrl+Tab'),
      cmd('Previous Terminal', 'terminal.prev', 'CmdOrCtrl+Shift+Tab'),
      {
        label: 'Switch To',
        submenu: Array.from({ length: 9 }, (_, i) =>
          cmd(`Terminal ${i + 1}`, `terminal.switch.${i + 1}`, `CmdOrCtrl+${i + 1}`)
        )
      }
    ]
  });

  template.push({
    label: activeTool.name,
    submenu: buildAICommandsSubmenu(activeTool)
  });

  if (isMac) {
    template.push({ role: 'window' });
  }

  // Help is its own root: Feedback is about Frame, not about what is on
  // screen. `role: 'help'` gives macOS its Help menu (with the search field).
  template.push({
    role: 'help',
    label: 'Help',
    submenu: [
      cmd('Start with a Project', 'help.welcome'),
      cmd('How to Use Frame', 'help.guide'),
      cmd('Take the Frame Tour', 'help.tour'),
      cmd('Keyboard Shortcuts', 'help.shortcuts', 'CmdOrCtrl+Shift+K'),
      SEP,
      cmd('Send Feedback…', 'feedback.open'),
      ...(isMac ? [] : [
        SEP,
        cmd('Check for Updates…', 'app.checkForUpdate'),
        { role: 'about' }
      ])
    ]
  });

  return template;
}

function openSettings() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.OPEN_SETTINGS);
  }
}

/**
 * Build the AI-tool root's submenu: Start first, then the tool's slash
 * commands, then the tool switcher. Slash commands go to the active
 * terminal over RUN_COMMAND.
 */
function buildAICommandsSubmenu(tool) {
  const submenu = [];

  submenu.push({
    label: `Start ${tool.name}`,
    accelerator: 'CmdOrCtrl+K',
    click: () => sendCommand(tool.command)
  });

  // Tool-specific commands, in a fixed order across tools.
  const slash = [
    ['init', 'Initialize Project', 'CmdOrCtrl+I'],
    ['commit', 'Commit Changes', 'CmdOrCtrl+Shift+C'],
    ['review', 'Review'],
    ['model', 'Switch Model'],
    ['permissions', 'Permissions'],
    ['memory', 'Memory'],
    ['compress', 'Compress Context'],
    ['settings', 'Settings'],
    ['help', 'Help']
  ].filter(([key]) => tool.commands[key]);

  if (slash.length) {
    submenu.push(SEP);
    for (const [key, label, accelerator] of slash) {
      const item = {
        label: `${label} (${tool.commands[key]})`,
        click: () => sendCommand(tool.commands[key])
      };
      if (accelerator) item.accelerator = accelerator;
      submenu.push(item);
    }
  }

  // AI Tool switcher
  if (aiToolManager) {
    submenu.push(SEP);
    submenu.push({
      label: 'Switch AI Tool',
      submenu: buildToolSwitcherSubmenu()
    });
  }

  return submenu;
}

/**
 * Build tool switcher submenu
 */
function buildToolSwitcherSubmenu() {
  const tools = aiToolManager.getAvailableTools();
  const activeTool = aiToolManager.getActiveTool();

  return Object.values(tools).map(tool => ({
    label: tool.name,
    type: 'radio',
    checked: tool.id === activeTool.id,
    click: () => {
      aiToolManager.setActiveTool(tool.id);
      // Rebuild menu with new tool
      createMenu();
    }
  }));
}

/**
 * View › Theme: one radio item per registry entry, the current one checked.
 * Clicking runs the theme.* command in the renderer like any other item;
 * the check is confirmed when the renderer reports back over THEME_CHANGED.
 */
function buildThemeSubmenu() {
  return themes.THEME_IDS.map((id) => {
    const t = themes.THEMES[id];
    return {
      label: t.label,
      type: 'radio',
      checked: id === currentTheme,
      click: () => sendAppCommand(t.command)
    };
  });
}

/**
 * Send command to terminal
 */
function sendCommand(command) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.RUN_COMMAND, command);
  }
}

/**
 * Run a renderer command by its command-registry id (the menu's one
 * channel to the renderer — never a channel per item).
 */
function sendAppCommand(commandId) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.RUN_APP_COMMAND, commandId);
  }
}

/**
 * Open history file in default editor
 */
function openHistoryFile() {
  const logPath = path.join(appPath, 'prompts-history.txt');

  // Create file if it doesn't exist
  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, '# Prompt History\n\n', 'utf8');
  }

  shell.openPath(logPath);
}

/**
 * Create and set application menu
 */
function createMenu() {
  const template = getMenuTemplate();
  console.log('Creating menu with', template.length, 'items. First item:', template[0]?.label);
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  console.log('Menu applied successfully');
  return menu;
}

module.exports = {
  init,
  createMenu,
  getMenuTemplate
};
