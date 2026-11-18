/**
 * Workspace attention — pure (workspace-list-agent-alerts spec, T01).
 *
 * Which agents of one project wait on the user, in the order they should be
 * answered: a permission prompt before an input box, then the longest wait.
 * The workspace list reads its row labels, the folded header's "N waiting"
 * and "Go to next waiting agent" from this one queue.
 *
 * A waiting agent prints nothing, so a terminal's last activity is when its
 * wait began (plan T3): `since` is laneStatus's `lastActivityAt`.
 *
 * Pure by design: the caller passes terminal states and a status lookup
 * (laneStatus.getStatus in the app). Statuses map through rollup's
 * `bucketOf`, the one place that reads laneStatus values.
 */

const { MAIN_ID, bucketOf } = require('./rollup');

const WAITING = ['approval', 'input'];

/**
 * @param {Array<{id: string, projectPath: string, workspaceId?: string, name?: string}>} states
 * @param {string} projectPath
 * @param {(terminalId: string) => ({status: string, lastActivityAt?: number, agentName?: string}|string|null)} getStatus
 * @returns {Array<{terminalId, workspaceId, kind: 'approval'|'input', agentName, since}>}
 *   approval first, then the oldest `since`; a wait with no known start
 *   sorts after the ones that have one.
 */
function waitingQueue(states, projectPath, getStatus) {
  const queue = [];
  for (const s of states || []) {
    if (!s || s.projectPath !== projectPath) continue;
    const raw = getStatus ? getStatus(s.id) : null;
    const record = raw && typeof raw === 'object' ? raw : { status: raw };
    const kind = bucketOf(record.status);
    if (!WAITING.includes(kind)) continue;
    queue.push({
      terminalId: s.id,
      workspaceId: s.workspaceId || MAIN_ID,
      kind,
      agentName: record.agentName || s.name || null,
      since: Number.isFinite(record.lastActivityAt) ? record.lastActivityAt : null
    });
  }
  const age = (entry) => (entry.since === null ? Infinity : entry.since);
  return queue
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => WAITING.indexOf(a.entry.kind) - WAITING.indexOf(b.entry.kind)
      || age(a.entry) - age(b.entry)
      || a.index - b.index)
    .map((item) => item.entry);
}

/** The most urgent wait in one workspace (what its row's label shows), or null. */
function workspaceWait(queue, workspaceId) {
  const id = workspaceId || MAIN_ID;
  return (queue || []).find((entry) => entry.workspaceId === id) || null;
}

/** Waits outside the selected workspace: how many, and the most urgent kind (null when none). */
function othersWaiting(queue, selectedId) {
  const id = selectedId || MAIN_ID;
  const others = (queue || []).filter((entry) => entry.workspaceId !== id);
  return { count: others.length, kind: others.length ? others[0].kind : null };
}

/** The most urgent waiting agent that is not the terminal on screen, or null. */
function nextWaiting(queue, onScreenTerminalId) {
  return (queue || []).find((entry) => entry.terminalId !== onScreenTerminalId) || null;
}

const WAIT_LABELS = { approval: 'approval', input: 'waiting' };

/** What a wait is called on screen, without how long it has lasted: `approval` or `waiting`. */
function waitLabel(kind) {
  return WAIT_LABELS[kind] || kind;
}

module.exports = { waitingQueue, workspaceWait, othersWaiting, nextWaiting, waitLabel };
