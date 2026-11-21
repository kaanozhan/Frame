/**
 * Project List UI Module — headless controller (project-dropdown spec).
 *
 * The visible project list is gone (the sidebar list → far-left rail →
 * retired); selection lives in the current-project switcher at the top of
 * the sidebar (wired in index.js). This module keeps everything that isn't
 * a row: the registered projects array, selection flow, first-boot
 * auto-select, next/prev switching, add/remove, the per-project agent
 * status store the switcher menu reads, and the project nav block under
 * the Projects tab.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

let activeProjectPath = null;
let onProjectSelectCallback = null;
let projects = []; // Store projects list for navigation
// On first launch, open the first project automatically. One-shot so later
// registry updates never yank the user to another project.
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
 * Load projects from the registry
 */
function loadProjects() {
  ipcRenderer.send(IPC.LOAD_PROJECT_REGISTRY);
}

/**
 * Registry data arrived — refresh state (no rows to render anymore).
 */
function renderProjects(projectsList) {
  projects = [...(projectsList || [])];

  // First launch with nothing selected yet: open a project so the app
  // doesn't start on an empty context. Skipped if a project is already
  // active, and only ever runs once.
  if (!didInitialAutoSelect && !activeProjectPath && projects.length > 0) {
    didInitialAutoSelect = true;
    selectLaunchProject();
  }

  placeProjectNav();
  if (switcherHooks.refresh) switcherHooks.refresh();
}

/**
 * Open the launch project: the one the user left, when it had AI sessions
 * running that Frame will resume (restore-ai-sessions-on-relaunch);
 * otherwise the default project, the front of the list.
 */
async function selectLaunchProject() {
  let last = null;
  try {
    last = await ipcRenderer.invoke(IPC.SESSION_RESTORE_GET_LAST_PROJECT);
  } catch (_) { /* no restore store — open the default */ }
  // Something may have selected a project while main answered.
  if (activeProjectPath) return;
  const target = projects.find(p => p.path === last) || projects[0];
  if (target) selectProject(target.path);
}

/**
 * Is this the default project?
 *
 * There is no stored "default" flag: launch opens `projects[0]` unless the
 * project left last has AI sessions to resume — so the front of the list
 * *is* the default, always.
 */
function isDefaultProject(projectPath) {
  return projects.length > 0 && !!projectPath && projects[0].path === projectPath;
}

/**
 * Make a project the one Frame opens on launch, by moving it to the front.
 *
 * Two things this has to know. The reorder channel keeps every path it is not
 * told about in its existing relative order, so the whole message could be one
 * path — the full list is sent anyway, because a partial order is harder to
 * read in a log than a complete one. And main deliberately sends no
 * PROJECT_REGISTRY_UPDATED echo for a reorder (it was built for drag, where
 * re-rendering mid-gesture fights the user), so the local order is updated
 * here or the switcher keeps showing the old one until a reload.
 *
 * @returns {boolean} false when it was already first, or is not in the list.
 */
function setDefaultProject(projectPath) {
  const index = projects.findIndex(p => p.path === projectPath);
  if (index <= 0) return false;
  const [moved] = projects.splice(index, 1);
  projects.unshift(moved);
  ipcRenderer.send(IPC.REORDER_REGISTRY_PROJECTS, projects.map(p => p.path));
  if (switcherHooks.refresh) switcherHooks.refresh();
  return true;
}

/**
 * Confirmation + removal (also offered as the × in the switcher menu).
 */
function confirmRemoveProject(projectPath, projectName) {
  // Workspaces stay on disk, holding their branches; say where before removal.
  // Their records are kept and come back if the project is added again (L6).
  const record = projects.find(p => p.path === projectPath);
  const folders = ((record && record.workspaces) || []).filter(w => w && !w.archivedAt && w.path).map(w => w.path);
  const workspaceNote = folders.length
    ? `\n\nIts ${folders.length} workspace folder${folders.length === 1 ? ' stays' : 's stay'} on disk (Frame keeps track and lists ${folders.length === 1 ? 'it' : 'them'} again if you add the project back):\n${folders.slice(0, 8).map(f => `  ${f}`).join('\n')}${folders.length > 8 ? `\n  …and ${folders.length - 8} more` : ''}`
    : '';
  const confirmed = window.confirm(
    `Remove "${projectName}" from the project list?\n\nThis will only remove it from Frame's list. The project files will not be deleted.${workspaceNote}`
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
 * Set active project (visual state lives in the switcher + project nav)
 */
function setActiveProject(projectPath) {
  activeProjectPath = projectPath;
  placeProjectNav();
  if (switcherHooks.refresh) switcherHooks.refresh();
}

function getActiveProject() {
  return activeProjectPath;
}

/**
 * Add project to the registry
 */
function addProject(projectPath, projectName) {
  // Main reads the Frame status from disk itself.
  ipcRenderer.send(IPC.ADD_PROJECT_TO_REGISTRY, {
    projectPath,
    name: projectName
  });
}

/**
 * Remove project from the registry
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
  ipcRenderer.send(IPC.REMOVE_PROJECT_FROM_REGISTRY, projectPath);
}

/**
 * Setup IPC listeners
 */
function setupIPC() {
  ipcRenderer.on(IPC.PROJECT_REGISTRY_DATA, (event, projects) => {
    renderProjects(projects);
  });

  ipcRenderer.on(IPC.PROJECT_REGISTRY_UPDATED, (event, projects) => {
    renderProjects(projects);
  });

  // Project-nav counts: same pushes the panels/lane rail consume. Both are
  // scoped to the current project by the senders, which is exactly the nav's
  // scope (it only exists under the selected project).
  ipcRenderer.on(IPC.SPEC_DATA, (event, { specs }) => {
    // Active specs only — same semantics as the lane rail's count
    navSpecsCount = (specs || []).filter(s => s.phase !== 'done').length;
    refreshProjectNav();
  });
  ipcRenderer.on(IPC.TASKS_DATA, (event, { tasks }) => {
    const list = (tasks && Array.isArray(tasks.tasks)) ? tasks.tasks : [];
    navTasksCount = list.filter(t => t.status !== 'completed').length;
    refreshProjectNav();
  });

  // Running-agent indicator on the Terminals row tracks live lane status
  require('./laneStatus').onChange(() => refreshProjectNav());
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
 * Snapshot of the registered projects (switcher menu, file panels). Copy so
 * callers can't mutate internal state.
 */
function getProjects() {
  return [...projects];
}

// ─── Project nav (terminals-view spec) ─────────────────────
// A prototype-style nav block under the selected project. One row per
// project destination; counts ride existing data pushes.

let projectNavEl = null;
let navSpecsCount = 0;
let navTasksCount = 0;

// Project destinations, grouped (sidebar-nav-groups spec): Work is where
// you act, Context is what the project knows about itself. The read-only
// surfaces — Decisions, Structure, Prompts, Activity — and Feedback left for
// the dock (status bar, View menu, palette), and GitHub for the icon rail,
// so the Frame group retired with its rows (dock-panel-readonly-views spec).
// The Work group's Claude row retired too: its Sessions tab is the Sessions
// row under Context — a session list is project history, like Specs and
// Tasks — and its Plugins tab is a modal behind its own button at the foot
// of the rail, above Feedback.
// `open` receives the multiTerminalUI instance. `surfaces` are the
// getActiveSurface() values that light the row.
const PROJECT_NAV_GROUPS = [
  {
    key: 'work',
    label: 'Work',
    items: [
      { view: 'terminals', icon: '›_', label: 'Terminals', open: ui => ui.showTerminals(), surfaces: ['terminals'] }
      // Orchestration is hidden from navigation for now — new users landed on
      // it first, and it is not where Frame's value is. The feature and its
      // palette command (orchestrator.open) stay; restore this row to re-expose it:
      // { view: 'orchestrator', icon: '⚙', label: 'Orchestration', beta: true, open: () => require('./orchestrator').open(), surfaces: ['section:orchestrator'] }
    ]
  },
  {
    key: 'context',
    label: 'Context',
    items: [
      { view: 'specs', icon: '≡', label: 'Specs', count: true, open: ui => ui.showSpecs(), surfaces: ['specs', 'section:spec'] },
      { view: 'tasks', icon: '✓', label: 'Tasks', count: true, open: ui => ui.showTasksBoard(), surfaces: ['tasks', 'section:task'] },
      { view: 'sessions', icon: '↺', label: 'Sessions', open: ui => ui.showPanel('sessions'), surfaces: ['panel:sessions'] },
      // Frame Cloud briefs, read-only (frame-cloud-briefs-read-only spec).
      // Rendered only while the open folder is connected to a cloud project:
      // no count, no teaser, no Connect hint. Its key is `cloud-briefs`, not
      // `briefs` — local briefs (brief-capture-and-shaping) own that one.
      {
        view: 'cloud-briefs', icon: '◇', label: 'Briefs',
        open: ui => ui.showPanel('cloudBriefs'), surfaces: ['panel:cloudBriefs'],
        available: () => require('./cloudBriefsPanel').isAvailable()
      }
    ]
  }
];

// Project Settings: one ungrouped row pinned at the foot of the nav, below
// Context (dock-panel-readonly-views spec, D1 — a group header for one row
// is furniture). It opens a modal, which is never the active surface, so
// it never lights. It runs the same registered command the View menu and
// the palette run.
const PROJECT_NAV_FOOT = {
  view: 'project-settings',
  icon: '⚙',
  label: 'Project Settings',
  open: () => require('./commandRegistry').runById('settings.openProject'),
  surfaces: []
};

/** Every row, flat — for the passes that don't care about grouping. */
const PROJECT_NAV_ITEMS = [...PROJECT_NAV_GROUPS.flatMap(g => g.items), PROJECT_NAV_FOOT];

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

function buildProjectNav() {
  const collapsed = loadCollapsedGroups();
  const nav = document.createElement('div');
  nav.className = 'project-nav';
  nav.innerHTML = PROJECT_NAV_GROUPS.map(group => `
    <div class="project-nav-group${collapsed[group.key] ? ' collapsed' : ''}" data-group="${group.key}">
      <div class="project-nav-group-header" tabindex="0" role="button" aria-expanded="${!collapsed[group.key]}">
        <span class="project-nav-group-chevron" aria-hidden="true"></span>
        <span class="project-nav-group-label">${group.label}</span>
      </div>
      <div class="project-nav-group-items">
        <div class="project-nav-group-rows">
        ${group.items.map(item => `
          <div class="project-nav-item" data-view="${item.view}" tabindex="0" role="button">
            <span class="project-nav-label">${item.label}</span>
            ${item.beta ? '<span class="project-nav-beta" title="Orchestration is in beta">Beta</span>' : ''}
            <span class="project-nav-right">
              ${item.view === 'terminals' ? '<span class="project-nav-agents" style="display:none"></span>' : ''}
              ${item.view === 'orchestrator' ? '<span class="project-nav-running" style="display:none" title="A conductor session is running">running</span>' : ''}
              ${item.view === 'terminals' || item.count ? `<span class="project-nav-count" data-count="${item.view}"></span>` : ''}
            </span>
          </div>`).join('')}
        </div>
      </div>
    </div>`).join('') + `
    <div class="project-nav-foot">
      <div id="project-settings-btn" class="project-nav-item" data-view="${PROJECT_NAV_FOOT.view}" tabindex="0" role="button">
        <span class="project-nav-label">${PROJECT_NAV_FOOT.label}</span>
      </div>
    </div>`;

  PROJECT_NAV_ITEMS.forEach((item) => {
    nav.querySelector(`[data-view="${item.view}"]`).addEventListener('click', () => {
      try {
        item.open(require('./terminal').getMultiTerminalUI());
      } catch (err) {
        console.error(`Failed to open ${item.view} view:`, err);
      }
    });
  });

  nav.querySelectorAll('.project-nav-group-header').forEach((header) => {
    const toggle = () => {
      const group = header.closest('.project-nav-group');
      const key = group.dataset.group;
      const nowCollapsed = !group.classList.contains('collapsed');
      group.classList.toggle('collapsed', nowCollapsed);
      header.setAttribute('aria-expanded', String(!nowCollapsed));
      const state = loadCollapsedGroups();
      state[key] = nowCollapsed;
      saveCollapsedGroups(state);
      refreshProjectNav();
    };
    header.addEventListener('click', toggle);
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  });

  return nav;
}

/**
 * Make a nav row reachable without changing the user's saved layout: expand
 * the group that holds it if that group is collapsed, but do not write
 * `frame-nav-groups` — a reload shows the groups as the user left them. Used
 * by the guided tour to point at a row. Returns the row, or null when there
 * is no project nav (or no such row).
 */
function revealNavItem(view) {
  if (!projectNavEl || !projectNavEl.isConnected) return null;
  const row = projectNavEl.querySelector(`.project-nav-item[data-view="${view}"]`);
  if (!row) return null;
  const group = row.closest('.project-nav-group');
  if (group && group.classList.contains('collapsed')) {
    group.classList.remove('collapsed');
    const header = group.querySelector('.project-nav-group-header');
    if (header) header.setAttribute('aria-expanded', 'true');
  }
  return row;
}

function placeProjectNav() {
  const panel = document.getElementById('project-panel');
  if (!panel) return;
  if (!activeProjectPath) {
    if (projectNavEl) projectNavEl.remove();
    return;
  }
  if (!projectNavEl) projectNavEl = buildProjectNav();
  if (projectNavEl.parentNode !== panel) panel.appendChild(projectNavEl);
  refreshProjectNav();
}

function refreshProjectNav() {
  if (!projectNavEl || !projectNavEl.isConnected) return;
  let count = 0;
  let agents = 0;
  let waiting = { approval: 0, input: 0 };
  let surface = '';
  try {
    const ui = require('./terminal').getMultiTerminalUI();
    const manager = ui && ui.getManager && ui.getManager();
    if (manager) {
      const laneStatus = require('./laneStatus');
      // The selected workspace's terminals — what the Terminals view shows
      // (workspaces spec); other workspaces have their own row dots.
      const terminals = manager.getTerminalStates();
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

  const termItem = projectNavEl.querySelector('[data-view="terminals"]');
  termItem.querySelector('.project-nav-count').textContent = String(count);
  PROJECT_NAV_ITEMS.forEach((item) => {
    const row = projectNavEl.querySelector(`[data-view="${item.view}"]`);
    row.classList.toggle('on', item.surfaces.includes(surface));
    // A row with `available` exists only while it answers true; one whose
    // module is not ready yet stays hidden. The inline display wins over the
    // row's own `display: flex`, which a bare [hidden] would not.
    if (item.available) {
      let available = false;
      try { available = Boolean(item.available()); } catch (_) { /* not ready */ }
      row.hidden = !available;
      row.style.display = available ? '' : 'none';
    }
  });

  // A collapsed group hides its rows, and with them the active-surface
  // highlight. The header carries it instead, so "where am I" survives
  // collapsing (sidebar-nav-groups spec).
  PROJECT_NAV_GROUPS.forEach((group) => {
    const el = projectNavEl.querySelector(`[data-group="${group.key}"]`);
    if (!el) return;
    const holdsActive = group.items.some(item => item.surfaces.includes(surface));
    el.querySelector('.project-nav-group-header')
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
  const agentsEl = termItem.querySelector('.project-nav-agents');
  agentsEl.style.display = agents > 0 ? '' : 'none';
  agentsEl.className = `project-nav-agents${attention ? ` ${attention}` : ''}`;
  agentsEl.textContent = `◆ ${agents}${mark ? ` ${mark}` : ''}`;
  agentsEl.title = [
    `${agents} agent${agents === 1 ? '' : 's'} running`,
    waiting.approval ? `${waiting.approval} needs approval` : null,
    waiting.input ? `${waiting.input} awaiting input` : null
  ].filter(Boolean).join(' · ');

  const orchEl = projectNavEl.querySelector('.project-nav-running');
  if (orchEl) {
    let orchActive = false;
    try {
      const orchestrator = require('./orchestrator');
      orchActive = !!(orchestrator.isActive && orchestrator.isActive());
    } catch (_) { /* orchestrator not loaded yet */ }
    orchEl.style.display = orchActive ? '' : 'none';
  }

  projectNavEl.querySelector('[data-count="specs"]').textContent = String(navSpecsCount);
  projectNavEl.querySelector('[data-count="tasks"]').textContent = String(navTasksCount);
}

/**
 * Called by multiTerminalUI on every manager state change so the Terminals
 * count and active highlight track reality without polling.
 */
function updateProjectNav() {
  if (!projectNavEl || !projectNavEl.isConnected) {
    placeProjectNav();
    return;
  }
  refreshProjectNav();
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
  isDefaultProject,
  setDefaultProject,
  getAgentStatus,
  addProject,
  removeProject,
  confirmRemoveProject,
  selectNextProject,
  selectPrevProject,
  focus,
  blur,
  applyAgentStatuses,
  updateProjectNav,
  revealNavItem
};
