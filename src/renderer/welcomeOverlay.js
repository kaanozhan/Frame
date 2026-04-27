/**
 * Welcome Overlay (Launch Greeting)
 *
 * Single-screen welcome shown on every launch unless the user explicitly
 * opts out via the "Don't show this again" checkbox. Pitches the value
 * prop, lets them pick a default AI tool, and routes to the existing
 * project-creation actions.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');

const DISMISSED_KEY = 'onboardingDismissed';

let overlayEl = null;
let dontShowEl = null;
let isOpen = false;
let launchTriggerFired = false;
let availableTools = {};
let activeToolId = null;

function init() {
  overlayEl = document.getElementById('welcome-overlay');
  dontShowEl = document.getElementById('welcome-dont-show');
  if (!overlayEl) {
    console.error('Welcome overlay element not found');
    return;
  }

  loadAITools();
  setupListeners();

  // Trigger on launch — wait for workspace data so we don't race with the
  // initial sidebar render, but otherwise show regardless of project count.
  ipcRenderer.on(IPC.WORKSPACE_DATA, () => {
    if (launchTriggerFired) return;
    launchTriggerFired = true;
    maybeShowOnLaunch().catch((err) =>
      console.error('Welcome: launch trigger failed', err)
    );
  });

  // Keep selected tool in sync if changed elsewhere
  ipcRenderer.on(IPC.AI_TOOL_CHANGED, (event, tool) => {
    if (tool && tool.id) {
      activeToolId = tool.id;
      updateToolSelection();
    }
  });
}

async function loadAITools() {
  try {
    const config = await ipcRenderer.invoke(IPC.GET_AI_TOOL_CONFIG);
    availableTools = config.availableTools || {};
    activeToolId = config.activeTool ? config.activeTool.id : null;
    renderToolOptions();
  } catch (e) {
    console.error('Welcome: failed to load AI tool config', e);
  }
}

async function maybeShowOnLaunch() {
  const dismissed = await ipcRenderer.invoke(IPC.GET_USER_SETTING, DISMISSED_KEY);
  if (dismissed !== true) {
    open();
  }
}

function setupListeners() {
  document
    .getElementById('welcome-open-folder')
    .addEventListener('click', () => {
      close();
      state.selectProjectFolder();
    });

  document
    .getElementById('welcome-create-project')
    .addEventListener('click', () => {
      close();
      state.createNewProject();
    });

  document
    .getElementById('welcome-clone-github')
    .addEventListener('click', () => {
      close();
      const cloneBtn = document.getElementById('btn-clone-github');
      if (cloneBtn) cloneBtn.click();
    });

  document.getElementById('welcome-close').addEventListener('click', () => {
    close();
  });

  document.getElementById('welcome-skip').addEventListener('click', () => {
    close();
  });

  // Persist checkbox state immediately on change so Cmd+Q while the modal
  // is still open also captures the user's preference.
  if (dontShowEl) {
    dontShowEl.addEventListener('change', persistDismissPreference);
  }

  overlayEl.addEventListener('mousedown', (e) => {
    if (e.target === overlayEl) close();
  });

  document.addEventListener('keydown', (e) => {
    if (isOpen && e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
}

function persistDismissPreference() {
  if (!dontShowEl) return;
  const value = dontShowEl.checked ? true : null;
  ipcRenderer
    .invoke(IPC.SET_USER_SETTING, DISMISSED_KEY, value)
    .catch((err) => console.error('Welcome: failed to persist setting', err));
}

function renderToolOptions() {
  const container = document.getElementById('welcome-tool-options');
  if (!container) return;

  const tools = Object.values(availableTools);
  if (tools.length === 0) {
    container.innerHTML =
      '<div class="welcome-tool-empty">No AI tools detected.</div>';
    return;
  }

  container.innerHTML = tools
    .map((tool) => {
      const checked = tool.id === activeToolId;
      return `
      <label class="welcome-tool-option ${checked ? 'selected' : ''}" data-tool-id="${escapeAttr(tool.id)}">
        <input type="radio" name="welcome-tool" value="${escapeAttr(tool.id)}" ${checked ? 'checked' : ''}>
        <span class="welcome-tool-name">${escapeHtml(tool.name)}</span>
      </label>
    `;
    })
    .join('');

  container.querySelectorAll('.welcome-tool-option').forEach((el) => {
    el.addEventListener('change', async () => {
      const toolId = el.dataset.toolId;
      const success = await ipcRenderer.invoke(IPC.SET_AI_TOOL, toolId);
      if (success) {
        activeToolId = toolId;
        updateToolSelection();
      }
    });
  });
}

function updateToolSelection() {
  const container = document.getElementById('welcome-tool-options');
  if (!container) return;
  container.querySelectorAll('.welcome-tool-option').forEach((el) => {
    const isActive = el.dataset.toolId === activeToolId;
    el.classList.toggle('selected', isActive);
    const radio = el.querySelector('input[type="radio"]');
    if (radio) radio.checked = isActive;
  });
}

function open() {
  if (isOpen) return;
  isOpen = true;
  overlayEl.classList.add('visible');
}

function close() {
  if (!isOpen) return;
  isOpen = false;
  // Persist whatever the checkbox state currently is (idempotent with the
  // change handler, kept here for paths that don't go through change).
  persistDismissPreference();
  overlayEl.classList.remove('visible');
}

/**
 * Reopen welcome from Command Palette. Resets the dismissed flag so the
 * user can see the modal again from the same session forward (otherwise
 * the checkbox state from a prior session would silently re-dismiss).
 */
function reopen() {
  ipcRenderer
    .invoke(IPC.SET_USER_SETTING, DISMISSED_KEY, null)
    .catch((err) => console.error('Welcome: failed to reset setting', err));
  if (dontShowEl) dontShowEl.checked = false;
  open();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s) {
  return escapeHtml(s);
}

module.exports = { init, open, close, reopen };
