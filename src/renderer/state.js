/**
 * Application State Module
 * Manages project path, Frame status, and UI state
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

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
    const projectName = currentProjectPath.split('/').pop() || currentProjectPath.split('\\').pop();
    ipcRenderer.send(IPC.INITIALIZE_FRAME_PROJECT, {
      projectPath: currentProjectPath,
      projectName: projectName
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
