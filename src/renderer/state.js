/**
 * Application State Module
 * Manages project path, Frame status, and UI state
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

const SPOTLIGHT_SEEN_KEY = 'frame-init-spotlight-seen';

let currentProjectPath = null;
let isCurrentProjectFrame = false;
let sampleProjectPath = null;     // cached from main on init
let isCurrentProjectSample = false;
let onProjectChangeCallbacks = [];
let onFrameStatusChangeCallbacks = [];
let onFrameInitializedCallbacks = [];
let onSampleChangeCallbacks = [];
let multiTerminalUI = null; // Reference to MultiTerminalUI instance

// Project paths the user chose to stop being prompted about ("Don't ask again").
// In-memory only — cleared on restart, so the prompt returns next launch.
const frameInitPromptSuppressed = new Set();

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

  // Render the initial (no-project) state so the section shows its empty-state
  // CTA and hides the body until a project is opened.
  updateProjectUI();

  // Cache the sample project path so we can detect when the user is
  // inside the sample without an IPC round-trip on every project switch.
  ipcRenderer
    .invoke(IPC.GET_SAMPLE_PROJECT_PATH)
    .then((p) => {
      sampleProjectPath = p || null;
    })
    .catch(() => {
      sampleProjectPath = null;
    });
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

  // Detect sample-project mode. Compared as strings — main resolved the
  // canonical path on startup, so any project opened at exactly that path
  // is the bundled sample.
  const wasSample = isCurrentProjectSample;
  isCurrentProjectSample = !!(path && sampleProjectPath && path === sampleProjectPath);
  if (wasSample !== isCurrentProjectSample) {
    onSampleChangeCallbacks.forEach((cb) => cb(isCurrentProjectSample));
  }

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

  // When we land on a non-Frame project, offer to initialize it — unless it's
  // the bundled sample or the user already said "Don't ask again" this session.
  if (!isFrame && currentProjectPath
      && !isCurrentProjectSample
      && !frameInitPromptSuppressed.has(currentProjectPath)) {
    showInitializeFrameModal();
  }
}

/**
 * Frame was removed from this project (Settings → Workflow). Flip the flag so
 * the spec panel and the workflow toggles stop acting on a project that has no
 * `.frame/` any more, and ask main to re-answer — the workspace record follows
 * from that. The init prompt is suppressed first: removing Frame is a
 * decision, and offering to initialize it again in the same second is not an
 * answer to it.
 */
function noteFrameRemoved(projectPath) {
  if (!projectPath) return;
  frameInitPromptSuppressed.add(projectPath);
  if (projectPath !== currentProjectPath) return;
  setIsFrameProject(false);
  ipcRenderer.send(IPC.CHECK_IS_FRAME_PROJECT, projectPath);
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
    // Reset the "Don't ask again" checkbox each time the prompt opens.
    const dontAsk = document.getElementById('init-frame-dontask');
    if (dontAsk) dontAsk.checked = false;
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
 * Dismiss the prompt without initializing ("Not Now" / close / Escape /
 * backdrop). If "Don't ask again" is checked, suppress the prompt for the
 * current project for the rest of this session.
 */
function dismissInitPrompt() {
  const dontAsk = document.getElementById('init-frame-dontask');
  if (dontAsk && dontAsk.checked && currentProjectPath) {
    frameInitPromptSuppressed.add(currentProjectPath);
  }
  hideInitializeFrameModal();
}

/**
 * Handle initialize Frame confirmation
 */
function handleInitializeFrame() {
  // Read the sharing choice before the modal is hidden — `repo` is
  // pre-selected in the markup, so this is what the user actually saw.
  const selected = document.querySelector('input[name="init-frame-sharing"]:checked');
  const gitSharing = selected ? selected.value : 'repo';

  hideInitializeFrameModal();
  if (currentProjectPath) {
    const projectName = currentProjectPath.split('/').pop() || currentProjectPath.split('\\').pop();
    ipcRenderer.send(IPC.INITIALIZE_FRAME_PROJECT, {
      projectPath: currentProjectPath,
      projectName: projectName,
      gitSharing,
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

  if (closeBtn) closeBtn.addEventListener('click', dismissInitPrompt);
  if (cancelBtn) cancelBtn.addEventListener('click', dismissInitPrompt);
  if (confirmBtn) confirmBtn.addEventListener('click', handleInitializeFrame);

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) dismissInitPrompt();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('visible')) {
        dismissInitPrompt();
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
  // The init-frame button is currently parked in a hidden holder; don't try to
  // spotlight an off-screen element (offsetParent is null when hidden).
  if (!initializeFrameBtn.offsetParent) return;

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
  const filesEmpty = document.getElementById('files-empty-state');
  if (currentProjectPath) {
    if (startClaudeBtn) {
      startClaudeBtn.disabled = false;
    }
    if (fileExplorerHeader) {
      fileExplorerHeader.style.display = 'block';
    }
    if (filesEmpty) filesEmpty.style.display = 'none';
  } else {
    if (startClaudeBtn) {
      startClaudeBtn.disabled = true;
    }
    if (fileExplorerHeader) {
      fileExplorerHeader.style.display = 'none';
    }
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
 * Open the bundled sample project. Main copies it into the user-data
 * directory on first use, then emits PROJECT_SELECTED — the same flow
 * the folder-picker uses, so all downstream wiring (file tree, tasks,
 * specs) is reused unchanged.
 */
function openSampleProject() {
  ipcRenderer.send(IPC.OPEN_SAMPLE_PROJECT);
}

/**
 * Check whether the current project is the bundled sample.
 */
function getIsSampleProject() {
  return isCurrentProjectSample;
}

/**
 * Register a callback fired whenever the current project's
 * "is sample" flag changes (opens or leaves the sample).
 */
function onSampleChange(callback) {
  onSampleChangeCallbacks.push(callback);
}

/**
 * Setup IPC listeners
 */
function setupIPC() {
  ipcRenderer.on(IPC.PROJECT_SELECTED, (event, projectPath) => {
    setProjectPath(projectPath);
    // Terminal session switching is now handled by setProjectPath via multiTerminalUI
  });

  ipcRenderer.on(IPC.IS_FRAME_PROJECT_RESULT, (event, { projectPath, isFrame, layout }) => {
    if (projectPath === currentProjectPath) {
      setIsFrameProject(isFrame);
      // A project still carrying Frame's old root layout gets the offer to
      // move it into .frame/ — once per session, and only for the project
      // the user is actually looking at.
      if (layout === 'legacy') {
        require('./migrationModal').offer(projectPath);
      }
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
  openSampleProject,
  getIsSampleProject,
  onSampleChange,
  getIsFrameProject,
  setIsFrameProject,
  noteFrameRemoved,
  onFrameStatusChange,
  onFrameInitialized,
  initializeAsFrameProject
};
