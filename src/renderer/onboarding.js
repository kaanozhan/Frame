/**
 * First-run onboarding screen (first-run-onboarding-screen spec)
 *
 * The boot splash's second state. With no projects in the registry the
 * loader hands this module the surface instead of leaving: the mark and
 * wordmark stay where the intro put them, and `#onboarding` — three ways into
 * a project, the default agent, and Skip — arrives beneath them. With
 * projects, none of this runs.
 *
 * It carries no link to the guide: a first run is for getting a project open,
 * and How to Use Frame is a click away from the rail once the app is up.
 *
 * The screen outlives the pickers it opens. The three ways in are
 * `projectStart.js`, shared with Home's no-project state; they start a route
 * and leave the screen standing, and only an opened project — or Skip —
 * takes it down, so cancelling a dialog returns the user here instead of
 * stranding them in the empty app they were trying to leave.
 *
 * It replaced the welcome modal, which asked for a project from on top of the
 * empty app that needed one, and asked again on every launch until the user
 * found a checkbox. Nothing is persisted here: the project count is the whole
 * gate (see onboarding/onboardingGate.js), so the screen stops appearing the
 * moment a project exists and a skip lasts exactly one launch.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');
const notify = require('./notify');
const projectStart = require('./projectStart');
const { escapeHtml } = require('./htmlUtils');
const { decide, LAUNCH, COMMAND } = require('./onboarding/onboardingGate');

let surfaceEl = null;   // #app-loader — the whole surface, owned by appLoader
let panelEl = null;     // #onboarding — this module's half of it
let isOpen = false;
let dismissible = false;
let initialized = false;
let onLeave = null;     // appLoader's parker, set by init
let startEl = null;     // the shared three-ways-in block
let availableTools = {};
let activeToolId = null;

/**
 * @param {object} opts
 * @param {Function} opts.onLeave  called when the screen is done with the
 *                                 surface; appLoader parks it from here.
 */
function init({ onLeave: leave } = {}) {
  surfaceEl = document.getElementById('app-loader');
  panelEl = document.getElementById('onboarding');
  const mount = document.getElementById('onboarding-start');
  if (mount) {
    startEl = projectStart.create();
    mount.appendChild(startEl);
  } else {
    console.error('Onboarding: #onboarding-start not found — the three ways in will not render');
  }
  if (!surfaceEl || !panelEl) {
    console.error('Onboarding: surface or panel element not found');
    return;
  }
  // Init-once, like every other surface in the renderer: a reload must not
  // stack a second set of listeners (audit-q3-performance-resources T06).
  if (initialized) return;
  initialized = true;
  onLeave = leave;

  loadAITools();
  setupListeners();

  ipcRenderer.on(IPC.AI_TOOL_CHANGED, (event, tool) => {
    if (tool && tool.id) {
      activeToolId = tool.id;
      paintToolSelection();
    }
  });

  // The one thing that ends the screen besides Skip: a project is open. All
  // three boxes reach here — the folder picker and the new-project dialog
  // through PROJECT_SELECTED, the clone through its own result handler — so
  // the screen does not need to know which route the user took, only that one
  // of them arrived.
  state.onProjectChange((path) => {
    if (path) close();
  });
}

/**
 * The loader's hand-off at boot. Returns true when the screen took the
 * surface, so the caller knows not to park it.
 */
function takeOver(projects) {
  const { show, dismissible: canDismiss } = decide({ trigger: LAUNCH, projects });
  if (!show) return false;
  open(canDismiss);
  return true;
}

/** The palette's Show the Start Screen, at any project count. */
function open(canDismiss) {
  if (!surfaceEl || !panelEl) return;
  if (isOpen) return;
  // No argument means the palette asked; the loader passes the gate's answer.
  const fromCommand = typeof canDismiss !== 'boolean';
  const resolved = fromCommand
    ? decide({ trigger: COMMAND }).dismissible
    : canDismiss;

  isOpen = true;
  dismissible = resolved;
  surfaceEl.classList.remove('app-loader-parked', 'app-loader-hidden');
  surfaceEl.classList.add('app-loader-onboarding');
  // On the surface, not the panel: the × lives outside #onboarding so a
  // transformed panel cannot capture its fixed positioning.
  surfaceEl.classList.toggle('app-loader-dismissible', dismissible);
  surfaceEl.classList.add('app-loader-run', 'app-loader-reveal');
  // A summoned screen un-parks the surface, and leaving display:none restarts
  // every animation on it. Freeze them at their end state instead of making
  // the user watch the intro again.
  if (fromCommand) surfaceEl.classList.add('app-loader-complete');
  measureWordmark();
}

function close() {
  if (!isOpen) return;
  isOpen = false;
  surfaceEl.classList.remove('app-loader-onboarding', 'app-loader-dismissible', 'app-loader-complete');
  if (typeof onLeave === 'function') onLeave();
}

/**
 * The wordmark's width is a measurement, not a constant, and the palette path
 * reveals it without the intro ever running — so it is measured here too.
 */
function measureWordmark() {
  const wordmark = surfaceEl.querySelector('.app-loader-wordmark');
  const text = surfaceEl.querySelector('.app-loader-wordmark-text');
  if (!wordmark || !text) return;
  wordmark.style.setProperty('--app-loader-wordmark-w', `${Math.ceil(text.scrollWidth)}px`);
}

function setupListeners() {
  // The three ways in are projectStart's own buttons (mounted in init), which
  // wire themselves. None of them closes the screen: a folder picker the user
  // cancels, or a clone form they back out of, has to land them back here
  // rather than in the empty app they were trying to leave. The screen goes
  // when a project actually opens — see the onProjectChange handler in init.
  bind('onboarding-skip', close);
  bind('onboarding-close', close);

  document.addEventListener('keydown', (e) => {
    // Only the summoned screen answers to Escape. At boot this surface is the
    // app's state rather than a dialog over one, and Skip is the way past it.
    if (!isOpen || !dismissible || e.key !== 'Escape') return;
    // One keypress closes one thing: while the clone row is open, Escape
    // belongs to it (its input handles that itself and stops the event).
    if (projectStart.isCloneOpen(startEl)) return;
    e.preventDefault();
    close();
  });
}

function bind(id, handler) {
  const el = document.getElementById(id);
  if (!el) {
    console.error(`Onboarding: #${id} not found`);
    return;
  }
  el.addEventListener('click', handler);
}

async function loadAITools() {
  try {
    const config = await ipcRenderer.invoke(IPC.GET_AI_TOOL_CONFIG);
    availableTools = config.availableTools || {};
    activeToolId = config.activeTool ? config.activeTool.id : null;
    renderToolOptions();
  } catch (e) {
    console.error('Onboarding: failed to load AI tool config', e);
    notify.error('Could not read the agent list. You can still open a project and pick one later.');
    renderToolOptions();
  }
}

function renderToolOptions() {
  const container = document.getElementById('onboarding-tool-options');
  if (!container) return;

  const tools = Object.values(availableTools);
  if (tools.length === 0) {
    container.innerHTML = '<div class="onboarding-tool-empty">No AI tools detected.</div>';
    return;
  }

  container.innerHTML = tools
    .map((tool) => {
      const checked = tool.id === activeToolId;
      return `
      <label class="onboarding-tool-option ${checked ? 'selected' : ''}" data-tool-id="${escapeHtml(tool.id)}">
        <input type="radio" name="onboarding-tool" value="${escapeHtml(tool.id)}" ${checked ? 'checked' : ''}>
        <span class="onboarding-tool-name">${escapeHtml(tool.name)}</span>
      </label>`;
    })
    .join('');

  container.querySelectorAll('.onboarding-tool-option').forEach((el) => {
    el.addEventListener('change', () => selectTool(el.dataset.toolId));
  });
}

/**
 * The selection does not move until main confirms it. A chip that lit up on a
 * failed write would tell the user they chose something they did not.
 */
async function selectTool(toolId) {
  try {
    const success = await ipcRenderer.invoke(IPC.SET_AI_TOOL, toolId);
    if (success) {
      activeToolId = toolId;
      paintToolSelection();
      return;
    }
    notify.error('Could not set that as the default agent.');
  } catch (e) {
    console.error('Onboarding: failed to set AI tool', e);
    notify.error('Could not set that as the default agent.');
  }
  paintToolSelection();
}

function paintToolSelection() {
  const container = document.getElementById('onboarding-tool-options');
  if (!container) return;
  container.querySelectorAll('.onboarding-tool-option').forEach((el) => {
    const isActive = el.dataset.toolId === activeToolId;
    el.classList.toggle('selected', isActive);
    const radio = el.querySelector('input[type="radio"]');
    if (radio) radio.checked = isActive;
  });
}

module.exports = { init, takeOver, open, close, isOpen: () => isOpen };
