/**
 * Project List UI Module
 * Renders project list in sidebar
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

let projectsListElement = null;
let activeProjectPath = null;
let onProjectSelectCallback = null;
let projects = []; // Store projects list for navigation
let focusedIndex = -1; // Currently focused project index

/**
 * Initialize project list UI
 */
function init(containerId, onSelectCallback) {
  projectsListElement = document.getElementById(containerId);
  onProjectSelectCallback = onSelectCallback;
  setupIPC();
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

  // Sort by lastOpenedAt (most recent first), then by name
  const sortedProjects = [...projectsList].sort((a, b) => {
    if (a.lastOpenedAt && b.lastOpenedAt) {
      return new Date(b.lastOpenedAt) - new Date(a.lastOpenedAt);
    }
    if (a.lastOpenedAt) return -1;
    if (b.lastOpenedAt) return 1;
    return a.name.localeCompare(b.name);
  });

  // Store sorted projects for navigation
  projects = sortedProjects;

  sortedProjects.forEach((project, index) => {
    const projectItem = createProjectItem(project, index);
    projectsListElement.appendChild(projectItem);
  });

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

  if (project.path === activeProjectPath) {
    item.classList.add('active');
  }

  // Project icon
  const icon = document.createElement('span');
  icon.className = 'project-icon';
  icon.textContent = project.isFrameProject ? '📦' : '📁';
  item.appendChild(icon);

  // Project name
  const name = document.createElement('span');
  name.className = 'project-name';
  name.textContent = project.name;
  name.title = project.path;
  item.appendChild(name);

  // Frame badge
  if (project.isFrameProject) {
    const badge = document.createElement('span');
    badge.className = 'frame-badge';
    badge.textContent = 'Frame';
    item.appendChild(badge);
  }

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

module.exports = {
  init,
  loadProjects,
  renderProjects,
  selectProject,
  setActiveProject,
  getActiveProject,
  addProject,
  removeProject,
  selectNextProject,
  selectPrevProject,
  focus,
  blur
};
