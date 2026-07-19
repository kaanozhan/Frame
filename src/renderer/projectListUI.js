/**
 * Project List UI Module
 * Renders project list in sidebar
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const { Bot } = require('lucide');

let projectsListElement = null;
let activeProjectPath = null;
let onProjectSelectCallback = null;
let projects = []; // Store projects list for navigation
let focusedIndex = -1; // Currently focused project index
// On first launch, open the first project automatically. One-shot so later
// workspace updates never yank the user to the top of the list.
let didInitialAutoSelect = false;
// projectPath -> { approval, input } counts, from projectStatusBadges.
let agentStatusMap = new Map();

function lucideIcon(data, size = 12) {
  const children = data.map(([tag, attrs]) => {
    const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<${tag} ${attrStr}/>`;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0">${children}</svg>`;
}

/**
 * Initialize project list UI
 */
function init(containerId, onSelectCallback) {
  projectsListElement = document.getElementById(containerId);
  onProjectSelectCallback = onSelectCallback;
  setupStatusTooltip();
  setupIPC();
}

// ---- Custom hover tooltip for the agent-status badges ----
// The native `title` tooltip is slow and faint; a fixed-positioned element
// reads clearly and escapes the list's `overflow-y: auto` clipping.
let statusTooltipEl = null;

function ensureStatusTooltip() {
  if (!statusTooltipEl) {
    statusTooltipEl = document.createElement('div');
    statusTooltipEl.className = 'project-status-tooltip';
    document.body.appendChild(statusTooltipEl);
  }
  return statusTooltipEl;
}

function showStatusTooltip(badge) {
  const text = badge.dataset.tip;
  if (!text) return;
  const tip = ensureStatusTooltip();
  tip.textContent = text;
  tip.classList.add('visible');

  const r = badge.getBoundingClientRect();
  const tr = tip.getBoundingClientRect();
  // Right-align to the badge, clamped to the viewport; sit above when there's
  // room, otherwise flip below.
  let left = Math.max(8, Math.min(r.right - tr.width, window.innerWidth - tr.width - 8));
  let top = r.top - tr.height - 6;
  if (top < 8) top = r.bottom + 6;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function hideStatusTooltip() {
  if (statusTooltipEl) statusTooltipEl.classList.remove('visible');
}

function setupStatusTooltip() {
  if (!projectsListElement) return;
  projectsListElement.addEventListener('mouseover', (e) => {
    const badge = e.target.closest('.project-status-badge');
    if (badge && projectsListElement.contains(badge)) showStatusTooltip(badge);
  });
  projectsListElement.addEventListener('mouseout', (e) => {
    const badge = e.target.closest('.project-status-badge');
    if (badge && !badge.contains(e.relatedTarget)) hideStatusTooltip();
  });
  // The hovered badge may scroll out or be re-rendered without a mouseout.
  projectsListElement.addEventListener('scroll', hideStatusTooltip, { passive: true });
}

/**
 * Load projects from workspace
 */
function loadProjects() {
  ipcRenderer.send(IPC.LOAD_WORKSPACE);
}

/**
 * Render project list
 */
function renderProjects(projectsList) {
  if (!projectsListElement) return;

  projectsListElement.innerHTML = '';

  if (!projectsList || projectsList.length === 0) {
    projects = [];
    const noProjectsMsg = document.createElement('div');
    noProjectsMsg.className = 'no-projects-message';
    noProjectsMsg.textContent = 'No projects yet. Add a project to get started.';
    projectsListElement.appendChild(noProjectsMsg);
    return;
  }

  // Render in the workspace's stored order — the user controls it by dragging
  // (persisted via REORDER_WORKSPACE_PROJECTS). No recency auto-sort.
  projects = [...projectsList];

  projects.forEach((project, index) => {
    const projectItem = createProjectItem(project, index);
    projectsListElement.appendChild(projectItem);
  });

  // First launch with nothing selected yet: open the top project so the app
  // doesn't start on an empty context. Skipped if a project is already active
  // (e.g. restored), and only ever runs once.
  if (!didInitialAutoSelect && !activeProjectPath && projects.length > 0) {
    didInitialAutoSelect = true;
    selectProject(projects[0].path);
  }

  // Keep the active project visible even if it sits below the 3-row fold.
  scrollActiveIntoView();

  // Update focused index based on active project
  focusedIndex = projects.findIndex(p => p.path === activeProjectPath);
}

/**
 * Create a project item element
 */
function createProjectItem(project, index) {
  const item = document.createElement('div');
  item.className = 'project-item';
  item.dataset.path = project.path;
  item.dataset.index = index;
  item.tabIndex = 0; // Make focusable
  item.draggable = true; // Reorderable via drag

  if (project.path === activeProjectPath) {
    item.classList.add('active');
  }

  attachDragHandlers(item);

  // Leading marker: Frame projects get a FRAME tag in place of the icon;
  // everything else keeps the file icon. (No separate right-side badge.)
  if (project.isFrameProject) {
    const tag = document.createElement('span');
    tag.className = 'project-frame-tag';
    tag.textContent = 'FRAME';
    item.appendChild(tag);
  } else {
    const icon = document.createElement('span');
    icon.className = 'project-icon';
    icon.textContent = '📁';
    item.appendChild(icon);
  }

  // Project name
  const name = document.createElement('span');
  name.className = 'project-name';
  name.textContent = project.name;
  name.title = project.path;
  item.appendChild(name);

  // Agent status badges (needs-approval / waiting-for-input in this project's
  // background terminals). Populated from the latest status map.
  const status = document.createElement('span');
  status.className = 'project-status';
  renderItemStatus(status, agentStatusMap.get(project.path));
  item.appendChild(status);

  // Remove button (visible on hover)
  const removeBtn = document.createElement('button');
  removeBtn.className = 'project-remove-btn';
  removeBtn.title = 'Remove from list';
  removeBtn.innerHTML = '&times;';
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent project selection
    confirmRemoveProject(project.path, project.name);
  });
  item.appendChild(removeBtn);

  // Click handler
  item.addEventListener('click', () => {
    selectProject(project.path);
  });

  return item;
}

/**
 * Render the agent status badges for one project into its status container.
 * `counts` is { approval, input } or undefined (no attention-worthy agents).
 */
function renderItemStatus(container, counts) {
  const approval = counts ? counts.approval : 0;
  const input = counts ? counts.input : 0;
  let html = '';
  if (approval > 0) {
    const label = `${approval} agent${approval > 1 ? 's' : ''} need approval`;
    html += `<span class="project-status-badge approval" data-tip="${label}" aria-label="${label}">`
      + `${lucideIcon(Bot, 12)}<span class="project-status-count">${approval}</span></span>`;
  }
  if (input > 0) {
    const label = `${input} agent${input > 1 ? 's' : ''} waiting for input`;
    html += `<span class="project-status-badge input" data-tip="${label}" aria-label="${label}">`
      + `${lucideIcon(Bot, 12)}<span class="project-status-count">${input}</span></span>`;
  }
  container.innerHTML = html;
}

/**
 * Apply per-project agent status counts (from projectStatusBadges) to the
 * currently-rendered items. Stored so re-renders keep the badges.
 */
function applyAgentStatuses(map) {
  agentStatusMap = map || new Map();
  if (!projectsListElement) return;
  hideStatusTooltip();
  projectsListElement.querySelectorAll('.project-item').forEach((item) => {
    const status = item.querySelector('.project-status');
    if (status) renderItemStatus(status, agentStatusMap.get(item.dataset.path));
  });
}

/**
 * Wire HTML5 drag-and-drop reordering onto a project item. Dragging an item
 * live-reorders the DOM; on drop the new order is persisted to the workspace.
 */
function attachDragHandlers(item) {
  item.addEventListener('dragstart', (e) => {
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    // setData is required for the drag to initiate in some Chromium builds.
    try { e.dataTransfer.setData('text/plain', item.dataset.path); } catch (_) {}
  });

  item.addEventListener('dragend', () => {
    item.classList.remove('dragging');
    persistOrder();
  });

  item.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const dragging = projectsListElement.querySelector('.project-item.dragging');
    if (!dragging || dragging === item) return;
    const rect = item.getBoundingClientRect();
    const after = (e.clientY - rect.top) / rect.height > 0.5;
    if (after) {
      item.after(dragging);
    } else {
      item.before(dragging);
    }
  });
}

/**
 * Read the current DOM order, sync the in-memory list, and persist it.
 */
function persistOrder() {
  if (!projectsListElement) return;
  const order = [...projectsListElement.querySelectorAll('.project-item')]
    .map((el) => el.dataset.path);
  if (order.length === 0) return;

  // Re-sync the local `projects` array (used for keyboard nav) to the new order.
  const rank = new Map(order.map((p, i) => [p, i]));
  projects.sort((a, b) => (rank.get(a.path) ?? 0) - (rank.get(b.path) ?? 0));
  projects.forEach((p, i) => {
    const el = projectsListElement.querySelector(`.project-item[data-path="${CSS.escape(p.path)}"]`);
    if (el) el.dataset.index = i;
  });
  focusedIndex = projects.findIndex((p) => p.path === activeProjectPath);

  ipcRenderer.send(IPC.REORDER_WORKSPACE_PROJECTS, order);
}

/**
 * Scroll the active project item into view within the (max-3-row) list.
 */
function scrollActiveIntoView() {
  if (!projectsListElement || !activeProjectPath) return;
  const el = projectsListElement.querySelector(
    `.project-item[data-path="${CSS.escape(activeProjectPath)}"]`
  );
  if (el) el.scrollIntoView({ block: 'nearest' });
}

/**
 * Show confirmation dialog and remove project
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
 * Set active project (visual only)
 */
function setActiveProject(projectPath) {
  activeProjectPath = projectPath;

  // Update visual state
  if (projectsListElement) {
    const items = projectsListElement.querySelectorAll('.project-item');
    items.forEach(item => {
      if (item.dataset.path === projectPath) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  scrollActiveIntoView();
}

/**
 * Get active project path
 */
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
 * Focus project list for keyboard navigation
 */
function focus() {
  if (!projectsListElement || projects.length === 0) return;

  // Focus current active project or first project
  const currentIndex = projects.findIndex(p => p.path === activeProjectPath);
  focusedIndex = currentIndex >= 0 ? currentIndex : 0;

  const items = projectsListElement.querySelectorAll('.project-item');
  if (items[focusedIndex]) {
    items[focusedIndex].focus();
    items[focusedIndex].classList.add('focused');
  }

  // Setup keyboard navigation (one-time)
  if (!projectsListElement.dataset.keyboardSetup) {
    projectsListElement.dataset.keyboardSetup = 'true';
    projectsListElement.addEventListener('keydown', handleKeydown);
  }
}

/**
 * Handle keyboard navigation in project list
 */
function handleKeydown(e) {
  const items = projectsListElement.querySelectorAll('.project-item');

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    items[focusedIndex]?.classList.remove('focused');

    if (e.key === 'ArrowDown') {
      focusedIndex = focusedIndex < projects.length - 1 ? focusedIndex + 1 : 0;
    } else {
      focusedIndex = focusedIndex > 0 ? focusedIndex - 1 : projects.length - 1;
    }

    items[focusedIndex]?.focus();
    items[focusedIndex]?.classList.add('focused');
  }

  if (e.key === 'Enter' && focusedIndex >= 0) {
    e.preventDefault();
    selectProject(projects[focusedIndex].path);
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    items[focusedIndex]?.classList.remove('focused');
    // Return focus to terminal
    if (typeof window.terminalFocus === 'function') {
      window.terminalFocus();
    }
  }
}

/**
 * Blur/unfocus project list
 */
function blur() {
  const items = projectsListElement?.querySelectorAll('.project-item');
  items?.forEach(item => item.classList.remove('focused'));
}

/**
 * Snapshot of the workspace projects (used by the current-project dropdown in
 * the Files/Changes panel). Copy so callers can't mutate internal state.
 */
function getProjects() {
  return [...projects];
}

module.exports = {
  init,
  loadProjects,
  renderProjects,
  selectProject,
  setActiveProject,
  getActiveProject,
  getProjects,
  addProject,
  removeProject,
  selectNextProject,
  selectPrevProject,
  focus,
  blur,
  applyAgentStatuses
};
