/**
 * Project List UI Module — headless controller (project-dropdown spec).
 *
 * The visible project list is gone (the sidebar list → far-left rail →
 * retired); selection lives in the current-project switcher at the top of
 * the sidebar (wired in index.js). This module keeps everything that isn't
 * a row: the workspace projects array, selection flow, first-boot
 * auto-select, next/prev switching, add/remove, the per-project agent
 * status store the switcher menu reads, and the workspace nav block under
 * the Projects tab.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

let activeProjectPath = null;
let onProjectSelectCallback = null;
let projects = []; // Store projects list for navigation
// On first launch, open the first project automatically. One-shot so later
// workspace updates never yank the user to another project.
let didInitialAutoSelect = false;
// projectPath -> { approval, input } counts, from projectStatusBadges.
let agentStatusMap = new Map();
// Set by index.js's switcher so focus()/renders can drive the dropdown.
let switcherHooks = { open: null, refresh: null };

/**
 * Initialize. The old list container id is accepted and ignored so callers
 * didn't have to change.
 */
function init(_containerId, onSelectCallback) {
  onProjectSelectCallback = onSelectCallback;
  setupIPC();
}

/** index.js's switcher registers itself here. */
function setSwitcherHooks(hooks) {
  switcherHooks = { ...switcherHooks, ...hooks };
}

/**
 * Load projects from workspace
 */
function loadProjects() {
  ipcRenderer.send(IPC.LOAD_WORKSPACE);
}

/**
 * Workspace data arrived — refresh state (no rows to render anymore).
 */
function renderProjects(projectsList) {
  projects = [...(projectsList || [])];

  // First launch with nothing selected yet: open the top project so the app
  // doesn't start on an empty context. Skipped if a project is already
  // active (e.g. restored), and only ever runs once.
  if (!didInitialAutoSelect && !activeProjectPath && projects.length > 0) {
    didInitialAutoSelect = true;
    selectProject(projects[0].path);
  }

  placeWorkspaceNav();
  if (switcherHooks.refresh) switcherHooks.refresh();
}

/**
 * Confirmation + removal (also offered as the × in the switcher menu).
 */
function confirmRemoveProject(projectPath, projectName) {
  const confirmed = window.confirm(
    `Remove "${projectName}" from the project list?\n\nThis will only remove it from Frame's list. The project files will not be deleted.`
  );

  if (confirmed) {
    // If removing the active project, select another one
    if (projectPath === activeProjectPath) {
      const otherProject = projects.find(p => p.path !== projectPath);
      if (otherProject) {
        selectProject(otherProject.path);
      } else {
        activeProjectPath = null;
        if (onProjectSelectCallback) {
          onProjectSelectCallback(null);
        }
      }
    }
    removeProject(projectPath);
  }
}

/**
 * Select a project
 * Terminal session switching is handled by state.js via multiTerminalUI
 */
function selectProject(projectPath) {
  setActiveProject(projectPath);

  if (onProjectSelectCallback) {
    onProjectSelectCallback(projectPath);
  }
}

/**
 * Set active project (visual state lives in the switcher + workspace nav)
 */
function setActiveProject(projectPath) {
  activeProjectPath = projectPath;
  placeWorkspaceNav();
  if (switcherHooks.refresh) switcherHooks.refresh();
}

function getActiveProject() {
  return activeProjectPath;
}

/**
 * Add project to workspace
 */
function addProject(projectPath, projectName, isFrameProject = false) {
  ipcRenderer.send(IPC.ADD_PROJECT_TO_WORKSPACE, {
    projectPath,
    name: projectName,
    isFrameProject
  });
}

/**
 * Remove project from workspace
 */
function removeProject(projectPath) {
  // Drop the saved terminal session too — removed projects otherwise leave
  // a localStorage record behind forever. Lazy require avoids a load cycle.
  try {
    const ui = require('./terminal').getMultiTerminalUI();
    const manager = ui && ui.getManager && ui.getManager();
    if (manager) manager.clearProjectSession(projectPath);
  } catch (err) {
    console.error('Failed to clear terminal session for removed project:', err);
  }
  ipcRenderer.send(IPC.REMOVE_PROJECT_FROM_WORKSPACE, projectPath);
}

/**
 * Setup IPC listeners
 */
function setupIPC() {
  ipcRenderer.on(IPC.WORKSPACE_DATA, (event, projects) => {
    renderProjects(projects);
  });

  ipcRenderer.on(IPC.WORKSPACE_UPDATED, (event, projects) => {
    renderProjects(projects);
  });

  // Workspace-nav counts: same pushes the panels/lane rail consume. Both are
  // scoped to the current project by the senders, which is exactly the nav's
  // scope (it only exists under the selected project).
  ipcRenderer.on(IPC.SPEC_DATA, (event, { specs }) => {
    // Active specs only — same semantics as the lane rail's count
    navSpecsCount = (specs || []).filter(s => s.phase !== 'done').length;
    refreshWorkspaceNav();
  });
  ipcRenderer.on(IPC.TASKS_DATA, (event, { tasks }) => {
    const list = (tasks && Array.isArray(tasks.tasks)) ? tasks.tasks : [];
    navTasksCount = list.filter(t => t.status !== 'completed').length;
    refreshWorkspaceNav();
  });

  // Running-agent indicator on the Terminals row tracks live lane status
  require('./laneStatus').onChange(() => refreshWorkspaceNav());
}

/**
 * Per-project agent status counts (from projectStatusBadges). Stored for the
 * switcher menu's attention dots.
 */
function applyAgentStatuses(map) {
  agentStatusMap = map || new Map();
  if (switcherHooks.refresh) switcherHooks.refresh();
}

/** { approval, input } counts for one project, or undefined. */
function getAgentStatus(projectPath) {
  return agentStatusMap.get(projectPath);
}

/**
 * Select next project in list
 */
function selectNextProject() {
  if (projects.length === 0) return;

  const currentIndex = projects.findIndex(p => p.path === activeProjectPath);
  const nextIndex = currentIndex < projects.length - 1 ? currentIndex + 1 : 0;
  selectProject(projects[nextIndex].path);
}

/**
 * Select previous project in list
 */
function selectPrevProject() {
  if (projects.length === 0) return;

  const currentIndex = projects.findIndex(p => p.path === activeProjectPath);
  const prevIndex = currentIndex > 0 ? currentIndex - 1 : projects.length - 1;
  selectProject(projects[prevIndex].path);
}

/**
 * "Focus Project List" now means: open the switcher dropdown.
 */
function focus() {
  if (switcherHooks.open) switcherHooks.open();
}

/** No list rows to blur anymore — kept for callers. */
function blur() {}

/**
 * Snapshot of the workspace projects (switcher menu, file panels). Copy so
 * callers can't mutate internal state.
 */
function getProjects() {
  return [...projects];
}

// ─── Workspace nav (terminals-view spec) ─────────────────────
// A prototype-style nav block under the selected project. One row per
// workspace destination; counts ride existing data pushes.

let workspaceNavEl = null;
let navSpecsCount = 0;
let navTasksCount = 0;

// Workspace destinations, grouped (sidebar-nav-groups spec). Ten flat rows
// read as a list of everything; three named groups say what each row is for:
// Work is where you act, Context is what the project knows about itself,
// Frame is the tool watching itself. `open` receives the multiTerminalUI
// instance. `surfaces` are the getActiveSurface() values that light the row.
const WORKSPACE_NAV_GROUPS = [
  {
    key: 'work',
    label: 'Work',
    items: [
      { view: 'terminals', icon: '›_', label: 'Terminals', open: ui => ui.showTerminals(), surfaces: ['terminals'] },
      { view: 'orchestrator', icon: '⚙', label: 'Orchestration', open: () => require('./orchestrator').open(), surfaces: ['section:orchestrator'] },
      { view: 'github', icon: '◇', label: 'GitHub', open: ui => ui.togglePanel('github'), surfaces: ['panel:github'] },
      { view: 'claude', icon: '✦', label: 'Claude', open: ui => ui.togglePanel('claude'), surfaces: ['panel:claude'] }
    ]
  },
  {
    key: 'context',
    label: 'Context',
    items: [
      { view: 'specs', icon: '≡', label: 'Specs', count: true, open: ui => ui.showSpecs(), surfaces: ['specs', 'section:spec'] },
      { view: 'tasks', icon: '✓', label: 'Tasks', count: true, open: ui => ui.showTasksBoard(), surfaces: ['tasks', 'section:task'] },
      { view: 'decisions', icon: '◈', label: 'Decisions', open: ui => ui.showDecisions(), surfaces: ['decisions'] },
      { view: 'structure', icon: '◎', label: 'Structure', open: ui => ui.showStructureMap(), surfaces: [] },
      { view: 'prompts', icon: '❯', label: 'Prompts', open: ui => ui.togglePanel('prompts'), surfaces: ['panel:prompts'] }
    ]
  },
  {
    key: 'frame',
    label: 'Frame',
    items: [
      { view: 'activity', icon: '∿', label: 'Activity', open: ui => ui.togglePanel('activity'), surfaces: ['panel:activity'] }
    ]
  }
];

/** Every row, flat — for the passes that don't care about grouping. */
const WORKSPACE_NAV_ITEMS = WORKSPACE_NAV_GROUPS.flatMap(g => g.items);

const NAV_GROUPS_KEY = 'frame-nav-groups';

function loadCollapsedGroups() {
  try {
    const raw = JSON.parse(localStorage.getItem(NAV_GROUPS_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch (_) {
    return {};
  }
}

function saveCollapsedGroups(state) {
  try {
    localStorage.setItem(NAV_GROUPS_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Failed to save nav group state:', err);
  }
}

function buildWorkspaceNav() {
  const collapsed = loadCollapsedGroups();
  const nav = document.createElement('div');
  nav.className = 'project-workspace-nav';
  nav.innerHTML = WORKSPACE_NAV_GROUPS.map(group => `
    <div class="workspace-nav-group${collapsed[group.key] ? ' collapsed' : ''}" data-group="${group.key}">
      <div class="workspace-nav-group-header" tabindex="0" role="button" aria-expanded="${!collapsed[group.key]}">
        <span class="workspace-nav-group-chevron">&#8250;</span>
        <span class="workspace-nav-group-label">${group.label}</span>
      </div>
      <div class="workspace-nav-group-items">
        ${group.items.map(item => `
          <div class="workspace-nav-item" data-view="${item.view}" tabindex="0" role="button">
            <span class="workspace-nav-icon">${item.icon}</span>
            <span class="workspace-nav-label">${item.label}</span>
            <span class="workspace-nav-right">
              ${item.view === 'terminals' ? '<span class="workspace-nav-agents" style="display:none"></span>' : ''}
              ${item.view === 'orchestrator' ? '<span class="workspace-nav-running" style="display:none" title="A conductor session is running">running</span>' : ''}
              ${item.view === 'terminals' || item.count ? `<span class="workspace-nav-count" data-count="${item.view}"></span>` : ''}
            </span>
          </div>`).join('')}
      </div>
    </div>`).join('');

  WORKSPACE_NAV_ITEMS.forEach((item) => {
    nav.querySelector(`[data-view="${item.view}"]`).addEventListener('click', () => {
      try {
        item.open(require('./terminal').getMultiTerminalUI());
      } catch (err) {
        console.error(`Failed to open ${item.view} view:`, err);
      }
    });
  });

  nav.querySelectorAll('.workspace-nav-group-header').forEach((header) => {
    const toggle = () => {
      const group = header.closest('.workspace-nav-group');
      const key = group.dataset.group;
      const nowCollapsed = !group.classList.contains('collapsed');
      group.classList.toggle('collapsed', nowCollapsed);
      header.setAttribute('aria-expanded', String(!nowCollapsed));
      const state = loadCollapsedGroups();
      state[key] = nowCollapsed;
      saveCollapsedGroups(state);
      refreshWorkspaceNav();
    };
    header.addEventListener('click', toggle);
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  });

  return nav;
}

function placeWorkspaceNav() {
  const panel = document.getElementById('workspace-panel');
  if (!panel) return;
  if (!activeProjectPath) {
    if (workspaceNavEl) workspaceNavEl.remove();
    return;
  }
  if (!workspaceNavEl) workspaceNavEl = buildWorkspaceNav();
  if (workspaceNavEl.parentNode !== panel) panel.appendChild(workspaceNavEl);
  refreshWorkspaceNav();
}

function refreshWorkspaceNav() {
  if (!workspaceNavEl || !workspaceNavEl.isConnected) return;
  let count = 0;
  let agents = 0;
  let waiting = { approval: 0, input: 0 };
  let surface = '';
  try {
    const ui = require('./terminal').getMultiTerminalUI();
    const manager = ui && ui.getManager && ui.getManager();
    if (manager) {
      const laneStatus = require('./laneStatus');
      const terminals = manager.getTerminalsByProject(activeProjectPath);
      count = terminals.length;
      agents = terminals.filter(t => laneStatus.getStatus(t.id).agentName).length;
      // Same tally the project badges and the status bar slot use (D8) —
      // computed here rather than read from agentStatusMap so the chip is
      // never a frame behind its own laneStatus.onChange.
      waiting = require('./projectStatusBadges').computeCounts(terminals)
        .get(activeProjectPath) || waiting;
      surface = ui.getActiveSurface ? ui.getActiveSurface() : manager.viewMode;
    }
  } catch (_) { /* terminal UI not initialized yet */ }

  const termItem = workspaceNavEl.querySelector('[data-view="terminals"]');
  termItem.querySelector('.workspace-nav-count').textContent = String(count);
  WORKSPACE_NAV_ITEMS.forEach((item) => {
    workspaceNavEl.querySelector(`[data-view="${item.view}"]`)
      .classList.toggle('on', item.surfaces.includes(surface));
  });

  // A collapsed group hides its rows, and with them the active-surface
  // highlight. The header carries it instead, so "where am I" survives
  // collapsing (sidebar-nav-groups spec).
  WORKSPACE_NAV_GROUPS.forEach((group) => {
    const el = workspaceNavEl.querySelector(`[data-group="${group.key}"]`);
    if (!el) return;
    const holdsActive = group.items.some(item => item.surfaces.includes(surface));
    el.querySelector('.workspace-nav-group-header')
      .classList.toggle('on', holdsActive && el.classList.contains('collapsed'));
  });
  // The ◆ chip counts this project's running agents and, from here on, says
  // when one of them is waiting — the gap it closes is an agent blocked on
  // approval while you are off on Specs, Tasks, Decisions or a panel. Colour
  // and symbol come from the shared vocabulary, so the sidebar and the status
  // bar say the same thing at two different scopes (§5c, §7).
  const laneStatus = require('./laneStatus');
  const attention = waiting.approval ? 'agent-approval' : waiting.input ? 'agent-input' : null;
  const mark = attention ? laneStatus.attentionMark(attention) : '';
  const agentsEl = termItem.querySelector('.workspace-nav-agents');
  agentsEl.style.display = agents > 0 ? '' : 'none';
  agentsEl.className = `workspace-nav-agents${attention ? ` ${attention}` : ''}`;
  agentsEl.textContent = `◆ ${agents}${mark ? ` ${mark}` : ''}`;
  agentsEl.title = [
    `${agents} agent${agents === 1 ? '' : 's'} running`,
    waiting.approval ? `${waiting.approval} needs approval` : null,
    waiting.input ? `${waiting.input} awaiting input` : null
  ].filter(Boolean).join(' · ');

  const orchEl = workspaceNavEl.querySelector('.workspace-nav-running');
  if (orchEl) {
    let orchActive = false;
    try {
      const orchestrator = require('./orchestrator');
      orchActive = !!(orchestrator.isActive && orchestrator.isActive());
    } catch (_) { /* orchestrator not loaded yet */ }
    orchEl.style.display = orchActive ? '' : 'none';
  }

  workspaceNavEl.querySelector('[data-count="specs"]').textContent = String(navSpecsCount);
  workspaceNavEl.querySelector('[data-count="tasks"]').textContent = String(navTasksCount);
}

/**
 * Called by multiTerminalUI on every manager state change so the Terminals
 * count and active highlight track reality without polling.
 */
function updateWorkspaceNav() {
  if (!workspaceNavEl || !workspaceNavEl.isConnected) {
    placeWorkspaceNav();
    return;
  }
  refreshWorkspaceNav();
}

module.exports = {
  init,
  setSwitcherHooks,
  loadProjects,
  renderProjects,
  selectProject,
  setActiveProject,
  getActiveProject,
  getProjects,
  getAgentStatus,
  addProject,
  removeProject,
  confirmRemoveProject,
  selectNextProject,
  selectPrevProject,
  focus,
  blur,
  applyAgentStatuses,
  updateWorkspaceNav
};
