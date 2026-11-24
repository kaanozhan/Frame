/**
 * leadRules — the rules behind the Chief (lead-agent spec, T01).
 *
 * Pure: no I/O, no clocks, no timers. The host (`src/main/leadHost.js`) and
 * both machine adapters call these with the facts they gathered, so the same
 * decisions hold on the desktop and on a Frame Server.
 *
 * - Status: what a terminal is doing, from Claude Code's own OSC 7501
 *   program-status report (plan D7) and, for plain shells, the foreground
 *   process. Anything we cannot tell is `unknown` — and a send to it is
 *   refused, never guessed.
 * - Scope: one project on one machine; never a home terminal, never the
 *   Chief itself (spec C3/C4).
 * - Refusals: hold in both modes (spec C7/C8). Full auto only removes the
 *   per-action approval.
 * - Approvals: generic `{ action, target, summary, payload }` records, so the
 *   work-queue spec can ask for "open a terminal" with the same card (D19).
 *   The first decision wins (D17).
 * - Delivery: per-target FIFO, gated on the target being ready and on the
 *   user not having typed there for a few seconds (D15).
 */

const STATUS = Object.freeze({
  READY: 'ready',       // agent at its input box, or a shell at its prompt
  WORKING: 'working',   // agent mid-turn — a send is queued until it's ready
  APPROVAL: 'approval', // agent waits on the user (permission, question, auth)
  BUSY: 'busy',         // a non-agent program owns the terminal (dev server, tests)
  UNKNOWN: 'unknown',   // an agent that reports nothing (old CLI, Codex, …)
  ENDED: 'ended'        // the terminal is gone
});

const MODES = Object.freeze({ USER_GUIDED: 'user-guided', FULL_AUTO: 'full-auto' });
const DEFAULT_MODE = MODES.USER_GUIDED;

/** CLIs that are agents: a terminal running one without a status report is `unknown`, not `busy`. */
const AGENT_PROCESSES = ['claude', 'codex', 'gemini', 'opencode'];

/** How long after the user's last keystroke a send waits (D15). */
const USER_QUIET_MS = 4000;

/**
 * An OSC 7501 report (`{ state, kind?, msg? }`, see shared/programStatus) →
 * `{ status, kind?, error? }`. idle / done / clear are all "at the input box";
 * error is too, with the failure carried along. A state this version does not
 * know is `unknown` — a newer CLI must not read as ready by accident.
 */
function mapProgramState(report) {
  const state = report && report.state;
  switch (state) {
    case 'idle':
    case 'done':
    case 'clear':
      return { status: STATUS.READY };
    case 'error':
      return { status: STATUS.READY, error: (report.msg || 'the last turn failed') };
    case 'working':
      return { status: STATUS.WORKING };
    case 'blocked':
      return { status: STATUS.APPROVAL, kind: report.kind || null };
    default:
      return { status: STATUS.UNKNOWN };
  }
}

function baseName(name) {
  return typeof name === 'string' ? name.split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase() : '';
}

// Claude Code's native installer runs `~/.local/share/claude/versions/<x.y.z>`,
// so the foreground process is named after its version, not "claude".
const NATIVE_CLAUDE_NAME = /^\d+\.\d+\.\d+$/;

function isAgentProcess(name) {
  const b = baseName(name);
  return !!b && (NATIVE_CLAUDE_NAME.test(b) || AGENT_PROCESSES.some((a) => b === a || b.startsWith(`${a}-`)));
}

/**
 * What a terminal is doing.
 *
 * @param {object} f
 * @param {boolean} f.alive            the PTY still exists
 * @param {string|null} f.foreground   foreground process name (null = cannot tell, e.g. Windows)
 * @param {string|null} f.shellName    the shell the terminal was spawned with
 * @param {object|null} f.agentState   last OSC 7501 report of the session in it, or null
 * @returns {{ status: string, agent: string|null, kind?: string|null, error?: string }}
 */
function deriveStatus({ alive = true, foreground = null, shellName = null, agentState = null } = {}) {
  if (!alive) return { status: STATUS.ENDED, agent: null };
  const fg = baseName(foreground);
  const shell = baseName(shellName);
  // Back at the shell prompt: whatever an agent reported before is stale —
  // the CLI has exited.
  if (fg && shell && fg === shell) return { status: STATUS.READY, agent: null };
  if (agentState) {
    return { ...mapProgramState(agentState), agent: fg && fg !== shell ? fg : 'claude' };
  }
  if (!fg) return { status: STATUS.UNKNOWN, agent: null };
  if (isAgentProcess(fg)) return { status: STATUS.UNKNOWN, agent: fg };
  return { status: STATUS.BUSY, agent: null };
}

/**
 * The terminals a Chief may see: same project, same machine, no home
 * terminals, not the Chief itself. Terminals carry `{ id, projectPath,
 * machine, home?, lead? }`; `machine` is the adapter's own key (the desktop or
 * a server key), so a list from one machine can never leak into another's
 * Chief even if both were merged by mistake.
 */
function scopeFilter(terminals, { projectPath, machine, chiefId = null } = {}) {
  if (!Array.isArray(terminals) || !projectPath) return [];
  return terminals.filter((t) => t
    && t.projectPath === projectPath
    && (machine === undefined || t.machine === machine)
    && !t.home
    && t.id !== chiefId
    && !t.lead);
}

function isMultiLine(text) {
  return typeof text === 'string' && /[\r\n]/.test(text.replace(/[\r\n]+$/, ''));
}

/**
 * Why a send must not go out, or null when it may (queued or not). Holds in
 * both modes (spec C8).
 *
 * @param {object|null} target  `{ id, status, kind?, pasteMode? }` with status from deriveStatus
 * @param {object} ctx          `{ chiefId, inScope, orchestrationIds: Set|Array, text }`
 * @returns {{ code: string, reason: string }|null}
 */
function sendRefusal(target, { chiefId = null, inScope = true, orchestrationIds = [], text = '' } = {}) {
  if (!target) return { code: 'not-found', reason: 'No such terminal on this machine.' };
  if (target.id === chiefId) return { code: 'self', reason: 'The Chief cannot send to itself.' };
  if (!inScope) return { code: 'out-of-scope', reason: 'That terminal is not part of this project on this machine.' };
  const orch = orchestrationIds instanceof Set ? orchestrationIds : new Set(orchestrationIds || []);
  if (orch.has(target.id)) return { code: 'conductor-lane', reason: 'That terminal belongs to a running conductor session; the Chief may read it but not write to it.' };
  if (typeof text !== 'string' || !text.trim()) return { code: 'empty', reason: 'Nothing to send.' };
  switch (target.status) {
    case STATUS.APPROVAL:
      return { code: 'awaiting-user', reason: `The agent there is waiting on the user (${target.kind || 'a prompt'}); the Chief never answers prompts.` };
    case STATUS.UNKNOWN:
      return { code: 'status-unknown', reason: 'That terminal reports no agent status (an older CLI, Codex, or a session started before Frame enabled status reports). Restart the session there or ask the user.' };
    case STATUS.BUSY:
      return { code: 'busy-process', reason: 'A program is running in that terminal; it is not waiting for input.' };
    case STATUS.ENDED:
      return { code: 'ended', reason: 'That terminal has closed.' };
    default:
      break;
  }
  if (isMultiLine(text) && !target.pasteMode) {
    return { code: 'multiline-no-paste', reason: 'Multi-line text can only go to a program that accepts pastes; send one line.' };
  }
  return null;
}

/** Whether `action` needs the user's approval in `mode` (D19: each action declares it). */
function needsApproval(action, mode = DEFAULT_MODE) {
  if (mode === MODES.FULL_AUTO) return false;
  return !(action && action.approval === false);
}

function normalizeMode(mode) {
  return mode === MODES.FULL_AUTO ? MODES.FULL_AUTO : MODES.USER_GUIDED;
}

// ─── approvals ─────────────────────────────────────────────

const DECISIONS = ['approved', 'rejected', 'edited'];

/**
 * A pure approval book. State is plain data so the host can persist or send
 * it; every transition returns `{ state, changed, record }`.
 */
function createApprovals() {
  return { seq: 0, records: [] };
}

function requestApproval(state, { id = null, action, target = null, summary = '', payload = null, chiefId = null, at = 0 } = {}) {
  const seq = state.seq + 1;
  const record = { id: id || `ap-${seq}`, action, target, summary, payload, chiefId, status: 'pending', at, decidedAt: null, text: null };
  return { state: { seq, records: [...state.records, record] }, changed: true, record };
}

/**
 * Apply a decision. The first one wins: a record that is no longer pending
 * is left alone (two desktops answering the same server approval).
 */
function decideApproval(state, id, { decision, text = null, at = 0 } = {}) {
  const i = state.records.findIndex((r) => r.id === id);
  const current = i >= 0 ? state.records[i] : null;
  if (!current || current.status !== 'pending' || !DECISIONS.includes(decision)) {
    return { state, changed: false, record: current };
  }
  const record = { ...current, status: decision, decidedAt: at, text: decision === 'edited' ? (text || '') : null };
  const records = state.records.slice();
  records[i] = record;
  return { state: { ...state, records }, changed: true, record };
}

/** Cancel every pending record matching `pred` (its target or its Chief went away). */
function cancelApprovals(state, pred, { at = 0 } = {}) {
  const cancelled = [];
  const records = state.records.map((r) => {
    if (r.status !== 'pending' || !pred(r)) return r;
    const next = { ...r, status: 'cancelled', decidedAt: at };
    cancelled.push(next);
    return next;
  });
  return { state: cancelled.length ? { ...state, records } : state, changed: cancelled.length > 0, cancelled };
}

function pendingApprovals(state) {
  return state.records.filter((r) => r.status === 'pending');
}

/** Drop decided records, keeping the book small; pending ones always stay. */
function pruneApprovals(state, keep = 50) {
  const pending = state.records.filter((r) => r.status === 'pending');
  const decided = state.records.filter((r) => r.status !== 'pending').slice(-keep);
  return { ...state, records: [...decided, ...pending].sort((a, b) => a.at - b.at) };
}

// ─── delivery ──────────────────────────────────────────────

/**
 * Whether the head of a target's queue may go out now, and if not, how long
 * to wait before asking again (null = wait for a status change).
 */
function deliveryGate({ status, lastUserInputAt = null, now = 0, quietMs = USER_QUIET_MS } = {}) {
  if (status !== STATUS.READY) return { ok: false, waitMs: null, why: status };
  if (lastUserInputAt && now - lastUserInputAt < quietMs) {
    return { ok: false, waitMs: quietMs - (now - lastUserInputAt), why: 'user-typing' };
  }
  return { ok: true, waitMs: 0, why: null };
}

/** FIFO per target: enqueue keeps order; the head is the only deliverable item. */
function enqueue(queues, targetId, item) {
  const next = new Map(queues);
  next.set(targetId, [...(queues.get(targetId) || []), item]);
  return next;
}

function head(queues, targetId) {
  const q = queues.get(targetId);
  return q && q.length ? q[0] : null;
}

function dequeue(queues, targetId) {
  const next = new Map(queues);
  const q = (queues.get(targetId) || []).slice(1);
  if (q.length) next.set(targetId, q); else next.delete(targetId);
  return next;
}

/** Remove every queued item for a target (it closed); returns the dropped items too. */
function dropTarget(queues, targetId) {
  const dropped = queues.get(targetId) || [];
  const next = new Map(queues);
  next.delete(targetId);
  return { queues: next, dropped };
}

module.exports = {
  STATUS,
  MODES,
  DEFAULT_MODE,
  AGENT_PROCESSES,
  USER_QUIET_MS,
  mapProgramState,
  isAgentProcess,
  deriveStatus,
  scopeFilter,
  isMultiLine,
  sendRefusal,
  needsApproval,
  normalizeMode,
  createApprovals,
  requestApproval,
  decideApproval,
  cancelApprovals,
  pendingApprovals,
  pruneApprovals,
  deliveryGate,
  enqueue,
  head,
  dequeue,
  dropTarget
};
