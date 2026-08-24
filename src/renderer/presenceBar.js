/**
 * Presence Bar (topbar-presence spec)
 *
 * The prototype's presence model: one chip per live agent, across ALL
 * projects, rendered into the top bar's action cluster. Clicking a chip
 * focuses that agent's terminal — switching project first when the agent
 * runs elsewhere. Replaces the sidebar Agent tab's "Running agents" list.
 *
 * Derived state only (agentPanel's idiom, which this module supersedes):
 * recomputed from laneStatus + the open-terminal set on every change, so a
 * crashed agent or a closed terminal can never leave a stale chip.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const laneStatus = require('./laneStatus');
const state = require('./state');
const { escapeHtml } = require('./htmlUtils');

const MAX_CHIPS = 8;

// status → chip flavor; anything else reads as "ready"
const STATUS_META = {
  'agent-working': { flavor: 'working', label: 'Working' },
  'agent-approval': { flavor: 'approval', label: 'Needs approval' },
  'agent-input': { flavor: 'input', label: 'Awaiting input' }
};

let multiTerminalUI = null;
let containerEl = null;
let scheduled = false;

/**
 * @param {object} ui - the live MultiTerminalUI (for getManager()/enterLane).
 * @param {HTMLElement} container - static element inside the top bar.
 */
function init(ui, container) {
  multiTerminalUI = ui;
  containerEl = container;

  laneStatus.onChange(() => schedule());
  ipcRenderer.on(IPC.TERMINAL_DESTROYED, () => schedule());

  recompute();
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    recompute();
  });
}

function recompute() {
  if (!containerEl || !multiTerminalUI) return;

  let states;
  try {
    states = multiTerminalUI.getManager().getTerminalStates(true);
  } catch (_) {
    states = [];
  }

  const agents = [];
  for (const s of states) {
    const st = laneStatus.getStatus(s.id);
    if (!st.agentName) continue;
    agents.push({
      id: s.id,
      agentName: st.agentName,
      status: st.status,
      terminalName: s.customName || s.name,
      projectPath: s.projectPath || null
    });
  }

  if (agents.length === 0) {
    containerEl.innerHTML = '';
    containerEl.style.display = 'none';
    return;
  }
  containerEl.style.display = '';

  const shown = agents.slice(0, MAX_CHIPS);
  containerEl.innerHTML = shown.map((a) => {
    const meta = STATUS_META[a.status] || { flavor: 'ready', label: 'Ready' };
    const project = a.projectPath
      ? (a.projectPath.split('/').pop() || a.projectPath.split('\\').pop())
      : 'no project';
    const tip = `${a.agentName} · ${a.terminalName} · ${project} — ${meta.label}`;
    return `<button type="button" class="presence-chip ${meta.flavor}" data-id="${escapeHtml(a.id)}" title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}">◆</button>`;
  }).join('')
    + (agents.length > MAX_CHIPS
      ? `<span class="presence-overflow" title="${agents.length - MAX_CHIPS} more agents">+${agents.length - MAX_CHIPS}</span>`
      : '');

  containerEl.querySelectorAll('.presence-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const agent = agents.find(a => a.id === chip.dataset.id);
      if (agent) _focus(agent);
    });
  });
}

// Focus the agent's terminal. When it lives in another project, switch to
// that project first (state.setProjectPath drives setCurrentProject).
function _focus(a) {
  if (!multiTerminalUI) return;
  if (a.projectPath && a.projectPath !== state.getProjectPath()) {
    state.setProjectPath(a.projectPath);
  }
  multiTerminalUI.enterLane(a.id);
}

module.exports = { init, recompute };
