/**
 * Application State Module
 * Manages project path, Frame status, and UI state
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

const SPOTLIGHT_SEEN_KEY = 'frame-init-spotlight-seen';

let currentProjectPath = null;
let isCurrentProjectFrame = false;
let onProjectChangeCallbacks = [];
let onFrameStatusChangeCallbacks = [];
let onFrameInitializedCallbacks = [];
let multiTerminalUI = null; // Reference to MultiTerminalUI instance

// UI Elements
let pathElement = null;
let startClaudeBtn = null;
let fileExplorerHeader = null;
let initializeFrameBtn = null;

/**
 * Initialize state module
 */
function init(elements) {
  pathElement = elements.pathElement || document.getElementById('project-path');
  startClaudeBtn = elements.startClaudeBtn || document.getElementById('btn-start-claude');
  fileExplorerHeader = elements.fileExplorerHeader || document.getElementById('file-explorer-header');
  initializeFrameBtn = elements.initializeFrameBtn || document.getElementById('btn-initialize-frame');

  setupIPC();
  setupInitFrameModalListeners();
  setupSpotlightListeners();
}

/**
 * Get current project path
 */
function getProjectPath() {
  return currentProjectPath;
}

/**
 * Set MultiTerminalUI reference for terminal session management
 */
function setMultiTerminalUI(ui) {
  multiTerminalUI = ui;
}

/**
 * Set project path and switch terminal session
 */
function setProjectPath(path) {
  const previousPath = currentProjectPath;
  currentProjectPath = path;
  updateProjectUI();

  // Switch terminal session if MultiTerminalUI is available
  if (multiTerminalUI) {
    // Switch to the new project's terminals
    multiTerminalUI.setCurrentProject(path);
  }

  // Check if it's a Frame project
  if (path) {
    ipcRenderer.send(IPC.CHECK_IS_FRAME_PROJECT, path);
  } else {
    setIsFrameProject(false);
  }

  // Notify listeners
  onProjectChangeCallbacks.forEach(cb => cb(path, previousPath));
}

/**
 * Register callback for project change
 */
function onProjectChange(callback) {
  onProjectChangeCallbacks.push(callback);
}

/**
 * Get Frame project status
 */
function getIsFrameProject() {
  return isCurrentProjectFrame;
}

/**
 * Set Frame project status
 */
function setIsFrameProject(isFrame) {
  isCurrentProjectFrame = isFrame;
  updateFrameUI();

  // Notify listeners
  onFrameStatusChangeCallbacks.forEach(cb => cb(isFrame));
}

/**
 * Register callback for Frame status change
 */
function onFrameStatusChange(callback) {
  onFrameStatusChangeCallbacks.push(callback);
}

/**
 * Register callback for Frame project initialized
 */
function onFrameInitialized(callback) {
  onFrameInitializedCallbacks.push(callback);
}

/**
 * Update Frame-related UI
 */
function updateFrameUI() {
  if (initializeFrameBtn) {
    // Show "Initialize as Frame" button only for non-Frame projects
    if (currentProjectPath && !isCurrentProjectFrame) {
      initializeFrameBtn.style.display = 'block';
      showInitSpotlight();
    } else {
      initializeFrameBtn.style.display = 'none';
    }
  }
}

/**
 * Initialize current project as Frame project
 */
function initializeAsFrameProject() {
  if (currentProjectPath) {
    showInitializeFrameModal();
  }
}

/**
 * Show custom initialize Frame modal
 */
function showInitializeFrameModal() {
  const modal = document.getElementById('initialize-frame-modal');
  if (modal) {
    modal.classList.add('visible');
  }
}

/**
 * Hide initialize Frame modal
 */
function hideInitializeFrameModal() {
  const modal = document.getElementById('initialize-frame-modal');
  if (modal) {
    modal.classList.remove('visible');
  }
}

/**
 * Handle initialize Frame confirmation
 */
function handleInitializeFrame() {
  hideInitializeFrameModal();
  if (currentProjectPath) {
    const projectName = currentProjectPath.split('/').pop() || currentProjectPath.split('\\').pop();
    ipcRenderer.send(IPC.INITIALIZE_FRAME_PROJECT, {
      projectPath: currentProjectPath,
      projectName: projectName,
      confirmed: true
    });
  }
}

/**
 * Setup initialize Frame modal listeners
 */
function setupInitFrameModalListeners() {
  const modal = document.getElementById('initialize-frame-modal');
  const closeBtn = document.getElementById('init-frame-modal-close');
  const cancelBtn = document.getElementById('init-frame-cancel');
  const confirmBtn = document.getElementById('init-frame-confirm');

  if (closeBtn) closeBtn.addEventListener('click', hideInitializeFrameModal);
  if (cancelBtn) cancelBtn.addEventListener('click', hideInitializeFrameModal);
  if (confirmBtn) confirmBtn.addEventListener('click', handleInitializeFrame);

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) hideInitializeFrameModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('visible')) {
        hideInitializeFrameModal();
      }
    });
  }
}

/**
 * Show spotlight tour for the initialize button (first time only)
 */
function showInitSpotlight() {
  if (localStorage.getItem(SPOTLIGHT_SEEN_KEY)) return;

  const overlay = document.getElementById('spotlight-overlay');
  if (!overlay || !initializeFrameBtn) return;

  // Wait for button to render and be positioned
  setTimeout(() => {
    const rect = initializeFrameBtn.getBoundingClientRect();
    const padding = 6;

    // Create/reuse backdrop element
    let backdrop = overlay.querySelector('.spotlight-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'spotlight-backdrop';
      overlay.appendChild(backdrop);
    }

    backdrop.style.top = (rect.top - padding) + 'px';
    backdrop.style.left = (rect.left - padding) + 'px';
    backdrop.style.width = (rect.width + padding * 2) + 'px';
    backdrop.style.height = (rect.height + padding * 2) + 'px';

    // Position card to the right of the button
    const card = document.getElementById('spotlight-card');
    if (card) {
      card.style.top = (rect.top - padding) + 'px';
      card.style.left = (rect.right + 16) + 'px';
    }

    overlay.classList.add('visible');
  }, 400);
}

/**
 * Dismiss spotlight and mark as seen
 */
function dismissSpotlight() {
  const overlay = document.getElementById('spotlight-overlay');
  if (overlay) {
    overlay.classList.remove('visible');
  }
  localStorage.setItem(SPOTLIGHT_SEEN_KEY, 'true');
}

/**
 * Setup spotlight tour listeners
 */
function setupSpotlightListeners() {
  const overlay = document.getElementById('spotlight-overlay');
  const dismissBtn = document.getElementById('spotlight-dismiss');

  if (dismissBtn) {
    dismissBtn.addEventListener('click', dismissSpotlight);
  }

  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) dismissSpotlight();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('visible')) {
        dismissSpotlight();
      }
    });
  }

  // Hover tooltip for initialize button
  const tooltip = document.getElementById('init-frame-tooltip');
  if (initializeFrameBtn && tooltip) {
    initializeFrameBtn.addEventListener('mouseenter', () => {
      // Don't show tooltip while spotlight is active
      if (overlay && overlay.classList.contains('visible')) return;

      const rect = initializeFrameBtn.getBoundingClientRect();
      tooltip.style.top = rect.top + 'px';
      tooltip.style.left = (rect.right + 12) + 'px';
      tooltip.classList.add('visible');
    });

    initializeFrameBtn.addEventListener('mouseleave', () => {
      tooltip.classList.remove('visible');
    });
  }
}

/**
 * Update project UI elements
 */
function updateProjectUI() {
  if (currentProjectPath) {
    if (pathElement) {
      pathElement.textContent = currentProjectPath;
      pathElement.style.color = '#569cd6';
    }
    if (startClaudeBtn) {
      startClaudeBtn.disabled = false;
    }
    if (fileExplorerHeader) {
      fileExplorerHeader.style.display = 'block';
    }
    const filesEmpty = document.getElementById('files-empty-state');
    if (filesEmpty) filesEmpty.style.display = 'none';
  } else {
    if (pathElement) {
      pathElement.textContent = 'No project selected';
      pathElement.style.color = '#666';
    }
    if (startClaudeBtn) {
      startClaudeBtn.disabled = true;
    }
    if (fileExplorerHeader) {
      fileExplorerHeader.style.display = 'none';
    }
    const filesEmpty = document.getElementById('files-empty-state');
    if (filesEmpty) filesEmpty.style.display = '';
  }
}

/**
 * Request folder selection
 */
function selectProjectFolder() {
  ipcRenderer.send(IPC.SELECT_PROJECT_FOLDER);
}

/**
 * Request new project creation
 */
function createNewProject() {
  ipcRenderer.send(IPC.CREATE_NEW_PROJECT);
}

/**
 * Setup IPC listeners
 */
function setupIPC() {
  ipcRenderer.on(IPC.PROJECT_SELECTED, (event, projectPath) => {
    setProjectPath(projectPath);
    // Terminal session switching is now handled by setProjectPath via multiTerminalUI
  });

  ipcRenderer.on(IPC.IS_FRAME_PROJECT_RESULT, (event, { projectPath, isFrame }) => {
    if (projectPath === currentProjectPath) {
      setIsFrameProject(isFrame);
    }
  });

  ipcRenderer.on(IPC.FRAME_PROJECT_INITIALIZED, (event, { projectPath, success }) => {
    if (success && projectPath === currentProjectPath) {
      setIsFrameProject(true);
      // Notify listeners
      onFrameInitializedCallbacks.forEach(cb => cb(projectPath));
    }
  });
}

module.exports = {
  init,
  getProjectPath,
  setProjectPath,
  setMultiTerminalUI,
  onProjectChange,
  updateProjectUI,
  selectProjectFolder,
  createNewProject,
  getIsFrameProject,
  setIsFrameProject,
  onFrameStatusChange,
  onFrameInitialized,
  initializeAsFrameProject
};
