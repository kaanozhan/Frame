/**
 * Activity events — pure policy module.
 *
 * The registry below is the single source of truth for what Frame may record
 * about its own background work. It exists for the same reason
 * `telemetryEvents.js` does, applied to a different destination: an event
 * that is not declared here is dropped, and a field value outside its
 * declared enum is stripped. `perfMonitor.js` shows what the alternative
 * looks like — eight call sites scattered over five months with no registry
 * to hold them together.
 *
 * What belongs here is decided by one rule, from the spec:
 *
 *   Record it when Frame itself is the trigger — a timer, a watcher, a hook,
 *   a guard, a recovery. Do not record it when the user's gesture is the
 *   trigger and the result is already on screen.
 *
 * So opening a panel is absent, while the watcher cascade a click sets off
 * is present.
 *
 * Two kinds, and the difference matters:
 *   - `action`      — work that happened.
 *   - `suppression` — work a guard prevented. These are what separate
 *     "alive and nothing needed" from "dead"; without them silence is
 *     ambiguous and the panel cannot answer the question it exists for.
 *
 * `label` decides visibility: an event with a label shows in the panel's
 * default view (suppressions muted), one without is detail-only.
 *
 * Pure — no Electron, no filesystem — so it runs under `node --test`.
 */

'use strict';

// Watcher ids. One per fsSafe.safeWatch call site.
const WATCHERS = ['specs', 'spec-tasks', 'tasks-root', 'git-worktree', 'git-dir', 'orch-bus'];

// Poller ids. One per pollGate.gatedInterval call site.
const POLLERS = ['claude-usage', 'update-check', 'orch-status', 'pty-process'];

// Every quiet path in spec-hint.js gets its own code, so "ran and stayed
// quiet" is distinguishable from "never fired" and from its siblings.
const HINT_REASONS = [
  'no-index', // pre-edit: the index has no files map
  'no-path', // pre-edit: the hook payload carried no file path
  'outside-project', // pre-edit: resolved outside the project root
  'meta-path', // pre-edit: a .frame/ write needs no history lesson
  'no-history', // pre-edit: no spec ever touched this file
  'session-dedup', // pre-edit: already surfaced for this file this session
  'no-topics', // prompt: the index has no topics map
  'no-words', // prompt: nothing searchable in the prompt
  'no-match', // prompt: no spec scored
  'no-stale-free-match', // prompt: matches existed but none survived filtering
  'no-context' // emit: nothing composed to send
];

const HOSTS = ['app', 'claude-hook', 'git-precommit', 'orch-bus', 'cli'];

// Field types. Kept deliberately narrow: enums, numbers, and the two string
// shapes that are the point of the record (a project-relative path, a spec
// slug). No free-form text field exists, so no call site can introduce one.
const COUNT = { type: 'count' };
const MS = { type: 'ms' };
const PATH = { type: 'path' };
const SLUG = { type: 'slug' };
const enumOf = (values) => ({ type: 'enum', values });

// Two different counts, deliberately not one field:
//   `collapsed` — a domain fact the caller knows (a debounce folded N
//                 filesystem events into one refresh).
//   `repeats`   — the activity layer's own aggregation of N identical
//                 records inside its window. Every suppression declares it,
//                 because a suppression that repeats is the normal case and
//                 clipping it with the rate cap would report "one".
const REPEATS = { type: 'count' };

const EVENTS = {
  // ─── spec-knowledge hook ────────────────────────────────
  'hint.injected': {
    kind: 'action',
    fields: { host: enumOf(HOSTS), mode: enumOf(['pre-edit', 'prompt']), path: PATH, specs: COUNT },
    label: (r) =>
      r.mode === 'prompt'
        ? `Surfaced ${r.specs ?? 0} related spec${r.specs === 1 ? '' : 's'} for this request`
        : `Spec history injected for ${r.path || 'a file'}${r.specs ? ` (${r.specs} prior spec${r.specs === 1 ? '' : 's'})` : ''}`
  },
  'hint.quiet': {
    kind: 'suppression',
    fields: { host: enumOf(HOSTS), mode: enumOf(['pre-edit', 'prompt']), reason: enumOf(HINT_REASONS), path: PATH, repeats: REPEATS },
    label: (r) => `Spec history skipped${r.path ? ` for ${r.path}` : ''} — ${HINT_REASON_TEXT[r.reason] || r.reason}`
  },

  // ─── watchers ───────────────────────────────────────────
  'watch.fired': {
    kind: 'action',
    fields: { watcher: enumOf(WATCHERS), changes: COUNT, collapsed: COUNT, triggered: enumOf(['reconcile', 'push', 'refresh', 'dispatch', 'none']) },
    label: (r) => {
      const what = r.changes === 1 ? '1 change' : `${r.changes ?? 0} changes`;
      const collapsed = r.collapsed > 1 ? `, ${r.collapsed} fires collapsed` : '';
      return `${WATCHER_TEXT[r.watcher] || r.watcher} saw ${what}${collapsed}`;
    }
  },
  'watch.suppressed': {
    kind: 'suppression',
    fields: { watcher: enumOf(WATCHERS), reason: enumOf(['self-write', 'debounce']), collapsed: COUNT, repeats: REPEATS },
    label: (r) =>
      r.reason === 'self-write'
        ? `${WATCHER_TEXT[r.watcher] || r.watcher} ignored Frame's own write`
        : `${WATCHER_TEXT[r.watcher] || r.watcher} collapsed ${r.collapsed ?? 0} fires into one`
  },

  // ─── spec state Frame changes on its own ────────────────
  'spec.phase_reconciled': {
    kind: 'action',
    fields: { slug: SLUG, from: enumOf(['draft', 'specified', 'planned', 'tasks_generated', 'implementing', 'done']), to: enumOf(['draft', 'specified', 'planned', 'tasks_generated', 'implementing', 'done']) },
    label: (r) => `Spec ${r.slug}: ${r.from} → ${r.to}`
  },

  // ─── derived spec index ─────────────────────────────────
  'index.rebuilt': {
    kind: 'action',
    fields: { ms: MS, specs: COUNT },
    label: (r) => `Spec index rebuilt${r.ms != null ? ` in ${r.ms}ms` : ''}`
  },
  'index.fresh': {
    kind: 'suppression',
    fields: { reason: enumOf(['already-fresh']), repeats: REPEATS },
    label: () => 'Spec index already current — rebuild skipped'
  },

  // ─── self-healing nobody sees ───────────────────────────
  'state.recovered': {
    kind: 'action',
    fields: { path: PATH, source: enumOf(['bak', 'none']) },
    label: (r) =>
      r.source === 'bak'
        ? `Recovered ${r.path || 'a state file'} from its backup`
        : `${r.path || 'A state file'} was corrupt with no usable backup`
  },
  'state.corrupt_preserved': {
    kind: 'action',
    fields: { path: PATH },
    label: (r) => `Preserved the corrupt copy of ${r.path || 'a state file'}`
  },

  // ─── polling guards ─────────────────────────────────────
  'poll.skipped': {
    kind: 'suppression',
    fields: { poller: enumOf(POLLERS), reason: enumOf(['window-hidden']), repeats: REPEATS },
    // `poller` is optional: pollGate pauses gates without knowing which
    // caller owns each one, and teaching it would mean editing four modules
    // outside this spec's footprint. The aggregated count carries the
    // information that matters — how many polls actually stopped.
    label: (r) =>
      r.poller
        ? `${POLLER_TEXT[r.poller] || r.poller} paused while the window is hidden`
        : 'Background polling paused while the window is hidden'
  },

  // ─── layout migration + sharing mode ────────────────────
  //
  // Frame moving a project's own files is exactly the kind of work this
  // record exists for: the user consented once in a modal, and everything
  // after that happens without them watching.
  'migration.completed': {
    kind: 'action',
    fields: { moved: COUNT, backedUp: COUNT, review: COUNT, ms: MS },
    label: (r) => `Moved ${r.moved ?? 0} Frame file${r.moved === 1 ? '' : 's'} into .frame/`
  },
  'migration.skipped': {
    kind: 'suppression',
    fields: { reason: enumOf(['dirty-tree', 'no-fingerprint', 'nothing-to-move']), repeats: REPEATS },
    label: (r) => `Layout migration skipped — ${MIGRATION_SKIP_TEXT[r.reason] || r.reason}`
  },
  'migration.conflict': {
    kind: 'action',
    fields: { path: PATH },
    label: (r) => `${r.path || 'A file'} differed from its .frame/ copy — kept in migration-backup/`
  },
  'sharing.mode_changed': {
    kind: 'action',
    fields: { from: enumOf(['repo', 'local']), to: enumOf(['repo', 'local']) },
    label: (r) => (r.to === 'local'
      ? 'Frame\'s files are now local to this machine'
      : 'Frame\'s files are now shared with the repo')
  },

  // ─── scripts running outside Frame's process ────────────
  'script.ran': {
    kind: 'action',
    fields: { script: enumOf(['update-structure', 'check-freshness', 'spec-index']), host: enumOf(HOSTS), ms: MS, changes: COUNT },
    label: (r) => `${SCRIPT_TEXT[r.script] || r.script} ran${r.host === 'git-precommit' ? ' on commit' : ''}`
  }
};

// Human-readable fragments, kept beside the registry so a label never has to
// be reconstructed at a call site.
const HINT_REASON_TEXT = {
  'no-index': 'no spec index yet',
  'no-path': 'no file path in the hook payload',
  'outside-project': 'the file is outside this project',
  'meta-path': 'Frame meta files need no history',
  'no-history': 'no spec has touched it',
  'session-dedup': 'already surfaced this session',
  'no-topics': 'no spec topics indexed',
  'no-words': 'nothing searchable in the request',
  'no-match': 'no spec matched',
  'no-stale-free-match': 'matches were filtered out',
  'no-context': 'nothing to send'
};

const MIGRATION_SKIP_TEXT = {
  'dirty-tree': 'the files have uncommitted changes',
  'no-fingerprint': 'this project already uses the .frame/ layout',
  'nothing-to-move': 'nothing was left at the project root'
};

const WATCHER_TEXT = {
  specs: 'Specs watcher',
  'spec-tasks': 'Spec tasks watcher',
  'tasks-root': 'Tasks watcher',
  'git-worktree': 'Git worktree watcher',
  'git-dir': 'Git directory watcher',
  'orch-bus': 'Orchestration bus watcher'
};

const POLLER_TEXT = {
  'claude-usage': 'Claude usage check',
  'update-check': 'Update check',
  'orch-status': 'Orchestration status poll',
  'pty-process': 'Terminal process poll'
};

const SCRIPT_TEXT = {
  'update-structure': 'Structure map update',
  'check-freshness': 'Freshness check',
  'spec-index': 'Spec index build'
};

function isRegistered(name) {
  return Object.prototype.hasOwnProperty.call(EVENTS, name);
}

function kindOf(name) {
  return isRegistered(name) ? EVENTS[name].kind : null;
}

function isSuppression(name) {
  return kindOf(name) === 'suppression';
}

function fieldPasses(spec, value) {
  switch (spec.type) {
    case 'enum':
      return spec.values.includes(value);
    case 'count':
    case 'ms':
      return typeof value === 'number' && Number.isFinite(value) && value >= 0;
    case 'path':
    case 'slug':
      return typeof value === 'string' && value.length > 0 && value.length <= 200;
    default:
      return false;
  }
}

/**
 * Validate an (event, fields) pair against the registry.
 *
 * Returns null for an unregistered event — the caller must drop it entirely.
 * Otherwise the subset of fields that are declared and carry an acceptable
 * value; unknown keys and bad values are stripped silently, exactly as
 * `telemetryEvents.validateEvent` does.
 */
function validateEvent(name, fields) {
  if (!isRegistered(name)) return null;
  const schema = EVENTS[name].fields;
  const out = {};
  for (const key of Object.keys(schema)) {
    const value = fields ? fields[key] : undefined;
    if (value === undefined) continue;
    if (fieldPasses(schema[key], value)) out[key] = value;
  }
  return out;
}

/**
 * The one-line sentence the panel's default view shows, or null when the
 * event is detail-only. Never throws: a label that fails on an unexpected
 * shape must not take a record — or the panel — down with it.
 */
function formatLabel(name, fields) {
  if (!isRegistered(name)) return null;
  const { label } = EVENTS[name];
  if (typeof label !== 'function') return null;
  try {
    const text = label(fields || {});
    if (typeof text !== 'string' || !text.length) return null;
    // Aggregated repeats are suffixed centrally so no individual label has to
    // remember to report them — a suppression that silently reads as one fire
    // when it was twelve is the failure this whole layer exists to avoid.
    const repeats = fields && fields.repeats;
    return repeats > 1 ? `${text} ×${repeats}` : text;
  } catch {
    return null;
  }
}

/**
 * Build the record the append contract writes: the validated fields plus the
 * event name and kind. Returns null when the event is unregistered.
 */
function buildRecord(name, fields) {
  const validated = validateEvent(name, fields);
  if (validated === null) return null;
  return { ev: name, kind: EVENTS[name].kind, ...validated };
}

module.exports = {
  EVENTS,
  WATCHERS,
  POLLERS,
  HINT_REASONS,
  HOSTS,
  isRegistered,
  kindOf,
  isSuppression,
  validateEvent,
  formatLabel,
  buildRecord
};
