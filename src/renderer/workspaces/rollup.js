/**
 * Workspace rollup — pure (workspaces spec, T07 / G2 / S5).
 *
 * Folds the terminals of one project into a per-workspace summary the
 * sidebar rows draw: how many agents are waiting on a permission prompt, how
 * many sit at their input box, how many are working, and the single status
 * the row's dot shows. Terminals of other projects are ignored; a terminal
 * without a workspaceId belongs to main.
 *
 * Pure by design: the caller passes terminal states and a status lookup
 * (laneStatus.getStatus in the app), so no DOM or electron is reached.
 */

const MAIN_ID = 'main';

/** Dot priority, most urgent first — the same order the project switcher uses. */
const PRIORITY = ['approval', 'input', 'working', 'idle'];

function emptySummary() {
  return { terminals: 0, approval: 0, input: 0, working: 0, dot: 'idle' };
}

function bucketOf(status) {
  if (status === 'agent-approval') return 'approval';
  if (status === 'agent-input') return 'input';
  if (status === 'agent-working' || status === 'running') return 'working';
  return 'idle';
}

/**
 * @param {Array<{id: string, projectPath: string, workspaceId?: string}>} states
 * @param {string} projectPath
 * @param {(terminalId: string) => ({status: string}|string|null)} getStatus
 * @returns {Map<string, {terminals, approval, input, working, dot}>} keyed by
 *   workspace id; a workspace with no terminals is absent (read it as idle).
 */
function summarize(states, projectPath, getStatus) {
  const map = new Map();
  for (const s of states || []) {
    if (!s || s.projectPath !== projectPath) continue;
    const id = s.workspaceId || MAIN_ID;
    const summary = map.get(id) || emptySummary();
    summary.terminals += 1;
    const raw = getStatus ? getStatus(s.id) : null;
    const bucket = bucketOf(raw && typeof raw === 'object' ? raw.status : raw);
    if (bucket !== 'idle') summary[bucket] += 1;
    map.set(id, summary);
  }
  for (const summary of map.values()) {
    summary.dot = PRIORITY.find((p) => p === 'idle' || summary[p] > 0);
  }
  return map;
}

/** The summary for one workspace, idle when it has no terminals. */
function summaryFor(map, workspaceId) {
  return (map && map.get(workspaceId || MAIN_ID)) || emptySummary();
}

module.exports = { MAIN_ID, PRIORITY, summarize, summaryFor };
