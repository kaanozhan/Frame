/**
 * Other projects' agents — pure (workspace-list-agent-alerts spec, T09).
 *
 * What the status bar's agent slot shows: the agents running in the user's
 * other projects, grouped by project and, inside each, by workspace. This
 * project is left out on purpose — its own workspaces are answered by the
 * sidebar's workspace list.
 *
 * A terminal state carries only a `workspaceId`, so a workspace is labelled
 * by its name when the caller knows it (`names`, filled when the popover
 * opens) and by its id otherwise.
 *
 * Pure by design: the caller passes terminal states, the per-project waiting
 * tally (projectStatusBadges.computeCounts — one tally for every surface)
 * and a status lookup (laneStatus.getStatus in the app).
 */

const { MAIN_ID } = require('./rollup');

function projectName(path) {
  return String(path).split(/[\\/]/).filter(Boolean).pop() || String(path);
}

/** The label of one workspace: its known name, else its id. */
function workspaceLabel(names, path, id) {
  const known = names && typeof names.get === 'function' ? names.get(path) : null;
  const label = known && typeof known.get === 'function' ? known.get(id) : null;
  return label || id;
}

/**
 * @param {Array<{id: string, projectPath: string, workspaceId?: string, name?: string, customName?: string}>} states
 * @param {object} opts
 * @param {string|null} opts.currentProject - left out of the result
 * @param {Map<string, {approval: number, input: number}>} [opts.counts]
 * @param {(terminalId: string) => ({status: string, agentName?: string}|null)} opts.getStatus
 * @param {Map<string, Map<string, string>>} [opts.names] - project path → workspace id → label
 * @returns {Array<{path, name, approval, input, agentCount, workspaces: Array<{id, label, agents: Array<{id, agentName, status, terminalName}>}>}>}
 *   projects with something waiting first, then by how many agents they run;
 *   in a project, main first, then workspaces in the order their agents appear.
 */
function group(states, { currentProject = null, counts = null, getStatus = null, names = null } = {}) {
  const byProject = new Map();
  for (const s of states || []) {
    const path = s && s.projectPath;
    if (!path || path === currentProject) continue; // this project speaks for itself
    const st = (getStatus && getStatus(s.id)) || {};
    if (!st.agentName) continue; // a plain shell is not an agent
    if (!byProject.has(path)) {
      const c = (counts && counts.get(path)) || { approval: 0, input: 0 };
      byProject.set(path, { path, name: projectName(path), approval: c.approval, input: c.input, agentCount: 0, workspaces: [] });
    }
    const project = byProject.get(path);
    const id = s.workspaceId || MAIN_ID;
    let workspace = project.workspaces.find((w) => w.id === id);
    if (!workspace) {
      workspace = { id, label: workspaceLabel(names, path, id), agents: [] };
      if (id === MAIN_ID) project.workspaces.unshift(workspace);
      else project.workspaces.push(workspace);
    }
    workspace.agents.push({ id: s.id, agentName: st.agentName, status: st.status, terminalName: s.customName || s.name });
    project.agentCount += 1;
  }
  return [...byProject.values()].sort((a, b) => {
    const wa = a.approval * 2 + a.input;
    const wb = b.approval * 2 + b.input;
    if (wa !== wb) return wb - wa;
    return b.agentCount - a.agentCount;
  });
}

/** The slot's face: `Other projects · 3 agents`, and `· 1 waiting` when any wait. */
function slotFace(total, waiting) {
  const parts = ['Other projects', `${total} agent${total === 1 ? '' : 's'}`];
  if (waiting > 0) parts.push(`${waiting} waiting`);
  return parts.join(' · ');
}

module.exports = { group, slotFace };
