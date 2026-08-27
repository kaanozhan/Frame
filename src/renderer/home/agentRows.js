/**
 * Which agents Home lists, and in what order.
 *
 * Pure by contract: no `electron`, no `lucide`, no `laneStatus` (C8). CI runs
 * `npm test` with no `npm ci`, so a test that reaches into `node_modules`
 * passes locally and fails there. This module takes plain data and returns
 * plain data; formatting a status into a label or a mark stays in the widget,
 * which may require whatever it likes.
 *
 * The two decisions that live here are the ones worth a regression test: what
 * counts as an agent, and which one you should look at first.
 */

/**
 * The three statuses that mean an agent. Anything else — `idle`, `running` —
 * is a shell doing shell things, and the widget is called Agents.
 *
 * The order of the keys is the order of the board: approval first because it
 * is blocking on you, then input because it is waiting on you, then working
 * because it is not waiting at all. That is what `laneStatus`'s
 * ATTENTION_MARKS already implies — the first two carry a mark, the third
 * does not.
 */
const ATTENTION_ORDER = {
  'agent-approval': 0,
  'agent-input': 1,
  'agent-working': 2
};

/**
 * @param {Array<{terminal: Object, status: Object}>} lanes - homeData's `lanes`
 * @returns {Array<{id, name, status, agentName, lastActivityAt, assignment}>}
 */
function agentRows(lanes) {
  return (lanes || [])
    .filter(l => l && l.terminal && l.status && ATTENTION_ORDER[l.status.status] !== undefined)
    .map(({ terminal, status }) => ({
      id: terminal.id,
      name: terminal.customName || terminal.name || '',
      status: status.status,
      agentName: status.agentName || null,
      lastActivityAt: status.lastActivityAt || null,
      assignment: terminal.assignment || null
    }))
    .sort((a, b) => {
      const rank = ATTENTION_ORDER[a.status] - ATTENTION_ORDER[b.status];
      if (rank !== 0) return rank;
      // Within one status, the one that spoke most recently is the one you
      // were just looking at. A lane that has never reported sorts last.
      return (Date.parse(b.lastActivityAt) || 0) - (Date.parse(a.lastActivityAt) || 0);
    });
}

module.exports = { agentRows, ATTENTION_ORDER };
