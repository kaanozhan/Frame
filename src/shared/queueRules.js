/**
 * queueRules — the rules behind the work queue (work-queue spec, T01).
 *
 * Pure: no I/O, no clocks, no ids minted here — callers pass `now` and `id`.
 * The desktop (queueManager), Frame Server (src/server/queue.js) and the
 * Chief's queue tools (leadHost) all decide with these, so a queue behaves the
 * same on every machine.
 *
 * A queue is one machine's list (plan D5): `{ version, parallel, items }`.
 * An item is a *reference* to a task id or a spec slug, never a copy (spec
 * C1); `title` is only a snapshot so a vanished source still reads.
 */

const VERSION = 1;
const MAX_PARALLEL = 9; // the terminal cap; the Chief itself is outside it
const DEFAULT_PARALLEL = MAX_PARALLEL; // plan D3: the cap is the only limit until lowered

const KINDS = Object.freeze({ TASK: 'task', SPEC: 'spec' });

const STATES = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  NEEDS_YOU: 'needs-you',    // a step-by-step phase ended, or the agent waits on the user
  REVIEW: 'review',          // finished; worktree and branch wait for the user (D4)
  DONE: 'done',
  FAILED: 'failed',
  INTERRUPTED: 'interrupted', // its terminal went away mid-run (D19)
  MISSING: 'missing'         // derived on read, never stored: the source is gone
});

const FLOW_MODES = Object.freeze({ FULL_AUTO: 'full-auto', STEP: 'step-by-step' });
const DEFAULT_FLOW_MODE = FLOW_MODES.FULL_AUTO; // plan D6

/** Legal moves between stored states. */
const TRANSITIONS = Object.freeze({
  queued: ['running', 'done'],
  running: ['review', 'failed', 'needs-you', 'interrupted', 'queued'],
  'needs-you': ['queued', 'running', 'review', 'done', 'failed'],
  review: ['done', 'queued'],
  failed: ['queued', 'done'],
  interrupted: ['running', 'queued', 'done', 'failed'],
  done: ['queued']
});

/** States the Chief may start (or resume) an item from. */
const STARTABLE = new Set([STATES.QUEUED, STATES.INTERRUPTED]);
/** States an item holds a terminal in. */
const ACTIVE = new Set([STATES.RUNNING]);

function list(x) {
  return Array.isArray(x) ? x : [];
}

function clampParallel(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_PARALLEL;
  return Math.min(MAX_PARALLEL, Math.max(1, v));
}

function normalizeFlowMode(m) {
  return m === FLOW_MODES.STEP ? FLOW_MODES.STEP : FLOW_MODES.FULL_AUTO;
}

const STORED_STATES = new Set(Object.keys(TRANSITIONS));

/** One stored item, cleaned; null when it cannot be an item. */
function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind !== KINDS.TASK && raw.kind !== KINDS.SPEC) return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (typeof raw.ref !== 'string' || !raw.ref) return null;
  const item = {
    id: raw.id,
    kind: raw.kind,
    ref: raw.ref,
    title: typeof raw.title === 'string' ? raw.title : raw.ref,
    addedAt: raw.addedAt || null,
    state: STORED_STATES.has(raw.state) ? raw.state : STATES.QUEUED,
    worktree: raw.worktree && typeof raw.worktree.path === 'string' ? { path: raw.worktree.path, branch: raw.worktree.branch || null } : null,
    terminalId: typeof raw.terminalId === 'string' ? raw.terminalId : null,
    startedAt: raw.startedAt || null,
    finishedAt: raw.finishedAt || null,
    note: typeof raw.note === 'string' ? raw.note : null
  };
  if (item.kind === KINDS.SPEC) item.flowMode = normalizeFlowMode(raw.flowMode);
  return item;
}

/** A queue file's contents, cleaned: unknown fields dropped, bad items skipped. */
function normalizeQueue(raw) {
  const q = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const items = [];
  for (const r of list(q.items)) {
    const it = normalizeItem(r);
    if (!it || seen.has(it.id)) continue;
    seen.add(it.id);
    items.push(it);
  }
  return { version: VERSION, parallel: clampParallel(q.parallel == null ? DEFAULT_PARALLEL : q.parallel), items };
}

function emptyQueue() {
  return normalizeQueue({});
}

function sameSource(a, kind, ref) {
  return a.kind === kind && a.ref === ref;
}

/**
 * Why a source cannot be queued, or null. `source` is what the caller knows:
 *   task: { kind:'task', ref, title, status, source }   (source = tasks.json `source`)
 *   spec: { kind:'spec', ref, title, phase, malformed }
 */
function refusal(queue, source) {
  if (!source || (source.kind !== KINDS.TASK && source.kind !== KINDS.SPEC) || !source.ref) return 'malformed';
  if (source.kind === KINDS.TASK) {
    if (typeof source.source === 'string' && source.source.startsWith('spec:')) return 'spec-task';
    if (source.status === 'completed') return 'completed';
  } else {
    if (source.malformed) return 'malformed';
    if (source.phase === 'done') return 'spec-done';
  }
  const existing = list(queue && queue.items).find((it) => sameSource(it, source.kind, source.ref) && it.state !== STATES.DONE);
  if (existing) return 'duplicate';
  return null;
}

const REFUSAL_TEXT = Object.freeze({
  malformed: 'That cannot be queued.',
  'spec-task': 'A spec\'s own task runs with its spec — queue the spec instead.',
  completed: 'That task is already completed.',
  'spec-done': 'That spec is already done.',
  duplicate: 'Already in the queue.',
  running: 'It is running — wait for it to finish first.',
  'not-found': 'That item is no longer in the queue.',
  'bad-state': 'That change does not apply in its current state.',
  'not-spec': 'Only a spec has a flow mode.'
});

/** `{ queue, item }` with the source appended, or `{ queue, refused }` unchanged. */
function add(queue, source, { id, now = null, flowMode = DEFAULT_FLOW_MODE } = {}) {
  const q = normalizeQueue(queue);
  const why = refusal(q, source);
  if (why) return { queue: q, refused: why };
  if (!id) return { queue: q, refused: 'malformed' };
  const item = normalizeItem({ id, kind: source.kind, ref: source.ref, title: source.title || source.ref, addedAt: now, state: STATES.QUEUED, flowMode });
  return { queue: { ...q, items: [...q.items, item] }, item };
}

function find(queue, id) {
  return list(queue && queue.items).find((it) => it.id === id) || null;
}

/** Removes an item; a running one is refused (stop its terminal first). */
function remove(queue, id) {
  const q = normalizeQueue(queue);
  const it = find(q, id);
  if (!it) return { queue: q, refused: 'not-found' };
  if (ACTIVE.has(it.state)) return { queue: q, refused: 'running' };
  return { queue: { ...q, items: q.items.filter((x) => x.id !== id) }, removed: it };
}

/** Puts the named ids first, in that order; the rest keep their order after them. */
function reorder(queue, ids) {
  const q = normalizeQueue(queue);
  const byId = new Map(q.items.map((it) => [it.id, it]));
  const out = [];
  const used = new Set();
  for (const id of list(ids)) {
    if (byId.has(id) && !used.has(id)) { out.push(byId.get(id)); used.add(id); }
  }
  for (const it of q.items) if (!used.has(it.id)) out.push(it);
  return { queue: { ...q, items: out } };
}

function canMove(from, to) {
  return from === to || list(TRANSITIONS[from]).includes(to);
}

/**
 * Moves an item to `state`, merging `patch` (worktree, terminalId, note, …).
 * Leaving `running` clears the terminal; reaching review/done/failed stamps
 * `finishedAt`; entering `running` stamps `startedAt`.
 */
function setState(queue, id, state, patch = {}, { now = null } = {}) {
  const q = normalizeQueue(queue);
  const it = find(q, id);
  if (!it) return { queue: q, refused: 'not-found' };
  if (!STORED_STATES.has(state) || !canMove(it.state, state)) return { queue: q, refused: 'bad-state' };
  const next = { ...it, ...pick(patch, ['worktree', 'terminalId', 'note']), state };
  if (state === STATES.RUNNING && it.state !== STATES.RUNNING) { next.startedAt = now; next.finishedAt = null; }
  if (state !== STATES.RUNNING && !('terminalId' in patch)) next.terminalId = null;
  if ([STATES.REVIEW, STATES.DONE, STATES.FAILED].includes(state)) next.finishedAt = now;
  if (state === STATES.QUEUED) { next.finishedAt = null; if (!('note' in patch)) next.note = null; }
  const item = normalizeItem(next);
  return { queue: { ...q, items: q.items.map((x) => (x.id === id ? item : x)) }, item };
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  return out;
}

function setParallel(queue, n) {
  const q = normalizeQueue(queue);
  return { queue: { ...q, parallel: clampParallel(n) } };
}

/** A spec item's flow mode; not while it runs (the running agent already has its command). */
function setFlowMode(queue, id, mode) {
  const q = normalizeQueue(queue);
  const it = find(q, id);
  if (!it) return { queue: q, refused: 'not-found' };
  if (it.kind !== KINDS.SPEC) return { queue: q, refused: 'not-spec' };
  if (ACTIVE.has(it.state)) return { queue: q, refused: 'running' };
  const item = { ...it, flowMode: normalizeFlowMode(mode) };
  return { queue: { ...q, items: q.items.map((x) => (x.id === id ? item : x)) }, item };
}

/** How many items hold a terminal now. */
function activeCount(items) {
  return list(items).filter((it) => ACTIVE.has(it.state)).length;
}

/**
 * The items to start now, in queue order: queued or interrupted, not missing,
 * at most `min(parallel − running, freeSlots)` of them (plan D3).
 */
function nextRunnable(items, { parallel = DEFAULT_PARALLEL, freeSlots = MAX_PARALLEL } = {}) {
  const room = Math.max(0, Math.min(clampParallel(parallel) - activeCount(items), Math.floor(Number(freeSlots) || 0)));
  if (!room) return [];
  return list(items).filter((it) => STARTABLE.has(it.state)).slice(0, room);
}

/** Running items whose terminal is not in `liveIds` become interrupted (D19). */
function markInterrupted(queue, liveIds) {
  const q = normalizeQueue(queue);
  const live = liveIds instanceof Set ? liveIds : new Set(list(liveIds));
  let changed = false;
  const items = q.items.map((it) => {
    if (it.state !== STATES.RUNNING || (it.terminalId && live.has(it.terminalId))) return it;
    changed = true;
    return { ...it, state: STATES.INTERRUPTED, terminalId: null };
  });
  return { queue: { ...q, items }, changed };
}

/**
 * Items as shown: an unfinished item whose task id or spec slug no longer
 * exists reads `missing` (C1, S18). `known` = `{ taskIds, specSlugs }`
 * (Sets or arrays); a kind without a known set is left alone.
 */
function deriveMissing(items, { taskIds = null, specSlugs = null } = {}) {
  const asSet = (x) => (x == null ? null : x instanceof Set ? x : new Set(list(x)));
  const tasks = asSet(taskIds);
  const specs = asSet(specSlugs);
  return list(items).map((it) => {
    if (it.state === STATES.DONE || ACTIVE.has(it.state)) return it;
    const known = it.kind === KINDS.TASK ? tasks : specs;
    if (!known || known.has(it.ref)) return it;
    return { ...it, state: STATES.MISSING, storedState: it.state };
  });
}

/**
 * The project's queues as one list: the Mac's first, then each server's,
 * every item tagged with its home (as tasksPayload does for tasks).
 * `servers` = [{ serverKey, serverProjectPath, host, offline, items }].
 */
function mergeQueues(macItems, servers = []) {
  const out = list(macItems).map((it) => ({ ...it, location: 'mac' }));
  for (const s of list(servers)) {
    for (const it of list(s && s.items)) {
      out.push({ ...it, location: 'server', serverKey: s.serverKey, serverProjectPath: s.serverProjectPath, host: s.host || 'server', offline: !!s.offline });
    }
  }
  return out;
}

/** Where an item of the merged list lives: `{ location:'mac' }`, a server home, or null. */
function homeOf(itemId, merged) {
  const it = list(merged).find((x) => x && x.id === itemId);
  if (!it) return null;
  if (it.location !== 'server') return { location: 'mac' };
  return { location: 'server', serverKey: it.serverKey, serverProjectPath: it.serverProjectPath, host: it.host, offline: !!it.offline };
}

function slugPart(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 48).replace(/-$/, '');
}

/**
 * The worktree key of an item (plan D14): the spec slug, or `task-<id>`, with
 * `-2`, `-3`… while `frame/queue/<key>` is in `takenBranches`.
 */
function worktreeKey(item, takenBranches = []) {
  const taken = takenBranches instanceof Set ? takenBranches : new Set(list(takenBranches));
  const base = (item && item.kind === KINDS.TASK ? `task-${slugPart(item.ref)}` : slugPart(item && item.ref)) || 'item';
  let key = base;
  for (let n = 2; taken.has(queueBranch(key)); n++) key = `${base}-${n}`;
  return key;
}

function queueBranch(key) {
  return `frame/queue/${key}`;
}

/** `.frame/worktrees/queue-<key>`, relative to the checkout (posix). */
function queueWorktreeRel(key) {
  return `.frame/worktrees/queue-${key}`;
}

/** The next single phase for step-by-step (D20); null when nothing is left. */
function nextPhaseCommand(phase) {
  switch (phase) {
    case 'specified': return 'spec.plan';
    case 'planned': return 'spec.tasks';
    case 'tasks_generated':
    case 'implementing': return 'spec.implement';
    default: return null;
  }
}

/**
 * The spec command an item starts with: `spec.auto` in full auto, the next
 * phase in step by step; null for a task or a spec with nothing left.
 */
function startCommand(item, phase) {
  if (!item || item.kind !== KINDS.SPEC) return null;
  const next = nextPhaseCommand(phase);
  if (!next) return null;
  return normalizeFlowMode(item.flowMode) === FLOW_MODES.FULL_AUTO ? 'spec.auto' : next;
}

module.exports = {
  VERSION,
  MAX_PARALLEL,
  DEFAULT_PARALLEL,
  KINDS,
  STATES,
  FLOW_MODES,
  DEFAULT_FLOW_MODE,
  TRANSITIONS,
  REFUSAL_TEXT,
  normalizeQueue,
  normalizeItem,
  emptyQueue,
  clampParallel,
  refusal,
  add,
  find,
  remove,
  reorder,
  canMove,
  setState,
  setParallel,
  setFlowMode,
  activeCount,
  nextRunnable,
  markInterrupted,
  deriveMissing,
  mergeQueues,
  homeOf,
  worktreeKey,
  queueBranch,
  queueWorktreeRel,
  nextPhaseCommand,
  startCommand
};
