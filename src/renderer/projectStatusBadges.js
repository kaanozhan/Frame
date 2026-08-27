/**
 * Project Status Badges
 *
 * Surfaces background-project agent activity in the sidebar's project list.
 * `laneStatus` already classifies every terminal across every project
 * (terminals of non-active projects stay alive, so their status keeps
 * updating). Here we roll those per-terminal statuses up per project and hand
 * the counts to `projectListUI`, which renders the badges:
 *
 *   - agent-approval → "needs approval"      (red, most urgent)
 *   - agent-input    → "waiting for input"   (amber)
 *
 * Other statuses (working / running / idle) are intentionally not surfaced —
 * the list only flags projects that need the user's attention.
 *
 * The tally itself is `computeCounts()`, exported because three surfaces want
 * the same numbers: the project list's badges, the sidebar's ◆ chip (this
 * project) and the status bar's left slot (the other projects). One
 * implementation, no new IPC (D8).
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const laneStatus = require('./laneStatus');
const projectListUI = require('./projectListUI');

let getStates = null;
let scheduled = false;

/**
 * @param {object} multiTerminalUI - the live MultiTerminalUI (for getManager()).
 */
function init(multiTerminalUI) {
  getStates = () => multiTerminalUI.getManager().getTerminalStates(true);

  // Status transitions emit through laneStatus; a destroyed terminal does not,
  // so recompute on destroy too. Both paths are debounced to one rAF.
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

/**
 * Tally attention-worthy agent statuses per project.
 *
 * @param {Array} states - terminal states across every project
 * @returns {Map<string, {approval: number, input: number}>} - only projects
 *   with something waiting appear; a project absent from the map is quiet.
 */
function computeCounts(states) {
  const map = new Map();
  for (const s of states) {
    const projectPath = s.projectPath;
    if (!projectPath) continue; // global/unscoped terminals have no row
    const status = laneStatus.getStatus(s.id).status;
    if (status !== 'agent-approval' && status !== 'agent-input') continue;

    const counts = map.get(projectPath) || { approval: 0, input: 0 };
    if (status === 'agent-approval') counts.approval += 1;
    else counts.input += 1;
    map.set(projectPath, counts);
  }
  return map;
}

/**
 * Recompute the tally and hand it to both surfaces that draw it. One pass,
 * one rAF — a second traversal per surface is exactly the churn C2 warns
 * about.
 */
function recompute() {
  if (!getStates) return;

  let states;
  try {
    states = getStates();
  } catch (_) {
    states = [];
  }

  const counts = computeCounts(states);
  projectListUI.applyAgentStatuses(counts);
  try {
    require('./statusBar').updateAgents(states, counts);
  } catch (_) { /* status bar not initialized yet */ }
}

module.exports = { init, recompute, computeCounts };
