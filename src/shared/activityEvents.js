/**
 * Activity events — pure policy module.
 *
 * The registry below is the single source of truth for what Frame may record
 * about its own background work. It exists for the same reason
 * `analyticsEvents.js` does, applied to a different destination: an event
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
  'no-context', // emit: nothing composed to send
  'map-dirty', // search: STRUCTURE.json changes are still being applied (STR-02)
  'map-incomplete', // search: the last scan missed files, an answer could be wrong (STR-03)
  'index-oversize', // search: the lookup index or map is above the hook's 2 MiB cap (STR-03)
  'ambiguous-weak', // search: only path or description words matched — CLI evidence, not a hint (STR-03)
  'already-looked-up', // search: find-module already answered this in the session (STR-03b)
  'orchestrated', // spec-close: an orchestration run owns the spec — its close items live on the integration branch
  'closed-earlier', // spec-close: the spec was already closed when this session started — not its work
  'git-unavailable' // spec-close: git would not say whether orchestration owns the spec
];

// The hint hooks' modes. One list for both events: a mode that can speak can
// also stay quiet, and a mode declared on only one of them drops the other
// half of its record without a trace.
// `decision-edit` and `decision-prompt` are spec-hint's card deliveries
// before an edit and on a prompt (decision-cards-core): modes of their own,
// so cards and spec history can be counted apart.
const HINT_MODES = ['pre-edit', 'prompt', 'search', 'session-start', 'meta-write', 'spec-command', 'spec-close', 'decision-edit', 'decision-prompt'];

const HOSTS = ['app', 'claude-hook', 'codex-hook', 'git-precommit', 'orch-bus', 'cli'];

// Why the doc pass could not settle a document. Each is a distinct thing for
// the user to do, which is why they are separate codes rather than one
// "something is wrong".
const DOCS_DEGRADED_REASONS = [
  'missing-path', // the prose names a file that is not on disk
  'unmatched-section', // a section Frame cannot prove is its own — never written over
  'unreadable' // the document itself could not be read
];

// Why the structure lifecycle worker reconciled (STR-02): the first reason
// recorded for the job — a notification kind or an explicit request.
const LIFECYCLE_REASONS = [
  'attach', 'periodic', 'reopen', 'resume', 'reconcile', 'file-event', 'directory',
  'gitignore', 'config', 'curation', 'git-state', 'watcher-error', 'unknown-change'
];

// Why a structure update did not land within its bound.
const MISSED_BOUND_REASONS = ['changing-files', 'writer-busy', 'failed', 'timeout', 'scan-budget'];

// What `spec-close.js` concluded about one spec: every close item present and
// well-formed, one absent, or one present with named defects.
const CLOSE_VERDICTS = ['ok', 'missing', 'malformed'];

// What a decision card's story is (`spec:<slug>` or a PROJECT_NOTES.md
// entry), and how a new card relates to an older one.
const DECISION_SOURCES = ['spec', 'notes'];
const DECISION_RELATIONS = ['supersedes', 'extends', 'none'];

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
    fields: {
      host: enumOf(HOSTS), mode: enumOf(HINT_MODES),
      path: PATH, specs: COUNT, concept: SLUG, modules: COUNT, bytes: COUNT, cards: COUNT
    },
    label: (r) => {
      if (r.mode === 'decision-prompt') {
        return `Surfaced ${r.cards ?? 0} recorded decision${r.cards === 1 ? '' : 's'} for this request`;
      }
      if (r.mode === 'decision-edit') {
        return `Recorded decision${r.cards === 1 ? '' : 's'} delivered for ${r.path || 'a file'}` +
          `${r.cards ? ` (${r.cards} card${r.cards === 1 ? '' : 's'})` : ''}`;
      }
      if (r.mode === 'spec-close') {
        return `Reminded the agent that ${r.specs ?? 0} closed spec${r.specs === 1 ? '' : 's'} still ${r.specs === 1 ? 'owes' : 'owe'} close items`;
      }
      if (r.mode === 'session-start') {
        return `Frame project rules delivered at session start${r.bytes ? ` (${r.bytes} chars)` : ''}`;
      }
      if (r.mode === 'meta-write') {
        return `Frame's rules for this meta file delivered before the write${r.bytes ? ` (${r.bytes} chars)` : ''}`;
      }
      if (r.mode === 'spec-command') {
        return 'Spec command flow staged for a terminal session';
      }
      if (r.mode === 'search') {
        return `Module map answered "${r.concept || 'a search'}"${r.modules ? ` (${r.modules} file${r.modules === 1 ? '' : 's'})` : ''}`;
      }
      return r.mode === 'prompt'
        ? `Surfaced ${r.specs ?? 0} related spec${r.specs === 1 ? '' : 's'} for this request`
        : `Spec history injected for ${r.path || 'a file'}${r.specs ? ` (${r.specs} prior spec${r.specs === 1 ? '' : 's'})` : ''}`;
    }
  },
  'hint.quiet': {
    kind: 'suppression',
    fields: { host: enumOf(HOSTS), mode: enumOf(HINT_MODES), reason: enumOf(HINT_REASONS), path: PATH, repeats: REPEATS },
    label: (r) => (r.mode === 'spec-close'
      ? `Spec close reminder withheld — ${SPEC_CLOSE_REASON_TEXT[r.reason] || HINT_REASON_TEXT[r.reason] || r.reason}`
      : r.mode === 'spec-command'
      ? `Spec command flow not staged — ${SPEC_COMMAND_REASON_TEXT[r.reason] || HINT_REASON_TEXT[r.reason] || r.reason}`
      : r.mode === 'session-start' || r.mode === 'meta-write'
      ? `Frame rules not delivered — ${DOCS_HINT_REASON_TEXT[r.reason] || HINT_REASON_TEXT[r.reason] || r.reason}`
      : r.mode === 'search'
        ? `Module hint skipped — ${SEARCH_REASON_TEXT[r.reason] || HINT_REASON_TEXT[r.reason] || r.reason}`
      : `Spec history skipped${r.path ? ` for ${r.path}` : ''} — ${HINT_REASON_TEXT[r.reason] || r.reason}`)
  },

  // Hooks registered but never seen to run. Codex requires the user to trust
  // a hook in its TUI before it executes, and an untrusted hook does nothing
  // and says nothing — a Frame update that changes a script's hash un-trusts
  // them again, just as silently. Recorded so the quiet state is on the
  // record rather than indistinguishable from "nothing needed doing".
  'hooks.untrusted': {
    kind: 'suppression',
    fields: { tool: enumOf(['codex']), repeats: REPEATS },
    label: (r) => `${r.tool === 'codex' ? 'Codex' : r.tool} hooks are installed but have never run — they need trusting`
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

  // ─── the close step ─────────────────────────────────────
  //
  // `spec-close.js` is run by an agent, not by Frame — but it is run because
  // a Frame hook asked for it, and its verdict is the only evidence that the
  // reminder led anywhere. Without this row "reminded" and "reminded, and the
  // close items were checked" are the same line in the record.
  'spec.close_checked': {
    kind: 'action',
    fields: { host: enumOf(HOSTS), slug: SLUG, verdict: enumOf(CLOSE_VERDICTS), defects: COUNT },
    label: (r) => {
      const spec = `Spec ${r.slug || '?'}`;
      if (r.verdict === 'ok') return `${spec}: close check passed`;
      if (r.verdict === 'missing') return `${spec}: close check found a close item missing`;
      if (r.verdict === 'malformed') {
        return `${spec}: close check named ${r.defects ?? 0} defect${r.defects === 1 ? '' : 's'} in its close items`;
      }
      return `${spec}: close check ran`;
    }
  },

  // ─── decision cards ─────────────────────────────────────
  //
  // `decision.js add` is run by an agent, like spec-close.js, and for the same
  // reason it leaves a row: whether the instruction to record a decision led
  // to a card is not visible anywhere else. Kinds and counts only — never the
  // decision, its why, its keywords or its files.
  'decision.added': {
    kind: 'action',
    fields: {
      host: enumOf(HOSTS), source: enumOf(DECISION_SOURCES), slug: SLUG, relation: enumOf(DECISION_RELATIONS)
    },
    label: (r) => {
      const where = r.source === 'spec' ? ` for spec ${r.slug || '?'}` : r.source === 'notes' ? ' from a PROJECT_NOTES entry' : '';
      const rel = r.relation === 'supersedes' ? ', superseding an older decision' : r.relation === 'extends' ? ', extending an older decision' : '';
      return `Decision recorded${where}${rel}`;
    }
  },
  'decision.rejected': {
    kind: 'suppression',
    fields: { host: enumOf(HOSTS), defects: COUNT, repeats: REPEATS },
    label: (r) => `Decision refused — ${r.defects ?? 0} defect${r.defects === 1 ? '' : 's'} named`
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
    // `backupDir` is what makes this row answerable after the fact: a move
    // nobody agreed to beforehand has to say where the copies went.
    // `symlinks` is a count, not a list — the registry has no free-form
    // string field on purpose, and the banner names the files from the
    // receipt it already holds.
    fields: { moved: COUNT, backedUp: COUNT, review: COUNT, symlinks: COUNT, backupDir: PATH, ms: MS },
    label: (r) => {
      const files = `Moved ${r.moved ?? 0} Frame file${r.moved === 1 ? '' : 's'} into .frame/`;
      const where = r.backupDir ? ` — copies are in ${r.backupDir}` : '';
      const links = r.symlinks > 0
        ? `, and removed ${r.symlinks} Frame symlink${r.symlinks === 1 ? '' : 's'}`
        : '';
      return `${files}${where}${links}`;
    }
  },
  'migration.skipped': {
    kind: 'suppression',
    // `dirty-tree` stays in the enum for records already on disk, but nothing
    // writes it any more: only an unmerged path defers a migration now.
    fields: {
      reason: enumOf(['unmerged', 'dirty-tree', 'no-fingerprint', 'nothing-to-move']),
      repeats: REPEATS
    },
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

  // ─── the docs Frame keeps for the agent ─────────────────
  //
  // Project open rewrites the managed sections of AGENTS.md and REFERENCE.md
  // without the user watching, which is the trigger rule exactly. The pair
  // exists because the failure this records was invisible for a month: a
  // pointer written at a file nothing created, every layer returning quietly.
  // `docs.repaired` says the pass did something; `docs.degraded` says it
  // could not, and why.
  'docs.repaired': {
    kind: 'action',
    fields: { docs: COUNT, created: COUNT, appended: COUNT },
    label: (r) => {
      const parts = [];
      if (r.created) parts.push(`created ${r.created}`);
      if (r.appended) parts.push(`added a section to ${r.appended}`);
      const detail = parts.length ? ` (${parts.join(', ')})` : '';
      return `Brought ${r.docs ?? 0} agent doc${r.docs === 1 ? '' : 's'} up to date${detail}`;
    }
  },
  'docs.degraded': {
    kind: 'action',
    fields: { reason: enumOf(DOCS_DEGRADED_REASONS), path: PATH, count: COUNT },
    label: (r) => `${DOCS_DEGRADED_TEXT[r.reason] || r.reason}${r.path ? ` — ${r.path}` : ''}`
  },

  // ─── structure lifecycle (STR-02) ───────────────────────
  //
  // Written by the lifecycle worker itself (a child process, or a foreground
  // `--watch`) into its own project's record, so a worker for a project
  // that is not the one on screen still files under the right project.
  // A periodic check that changed nothing is not recorded: it runs every
  // minute and would bury everything else.
  'structure.reconciled': {
    kind: 'action',
    fields: { host: enumOf(HOSTS), reason: enumOf(LIFECYCLE_REASONS), ms: MS, changes: COUNT, coverage: enumOf(['complete', 'partial']) },
    label: (r) => {
      const changed = r.changes ? ` — ${r.changes} file${r.changes === 1 ? '' : 's'} changed` : '';
      const partial = r.coverage === 'partial' ? ' (partial coverage)' : '';
      return `Structure map updated${changed}${partial}${r.reason ? `, ${LIFECYCLE_REASON_TEXT[r.reason] || r.reason}` : ''}`;
    }
  },
  'structure.lifecycle': {
    kind: 'action',
    fields: { host: enumOf(HOSTS), state: enumOf(['attached', 'detached', 'missed-bound']), reason: enumOf(MISSED_BOUND_REASONS) },
    label: (r) => {
      if (r.state === 'attached') return 'Started keeping the structure map current';
      if (r.state === 'detached') return 'Stopped keeping the structure map current';
      return `A structure map update missed its time bound — ${MISSED_BOUND_TEXT[r.reason] || r.reason || 'unknown reason'}`;
    }
  },

  // ─── scripts running outside Frame's process ────────────
  'script.ran': {
    kind: 'action',
    fields: { script: enumOf(['update-structure', 'check-freshness', 'spec-index', 'find-module']), host: enumOf(HOSTS), ms: MS, changes: COUNT },
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

// The same reason codes read differently for the module-map hook: "no index"
// there means STRUCTURE.json has no intentIndex, not a missing spec index.
// Only the reasons `module-hint.js` can emit are overridden; anything else
// falls back to the spec wording.
const SEARCH_REASON_TEXT = {
  'map-dirty': 'the module map is being updated',
  'map-incomplete': 'the module map missed files in its last scan',
  'index-oversize': 'the module map is too large to read in a hook',
  'ambiguous-weak': 'only weak matches (path or description words)',
  'already-looked-up': 'find-module already answered it this session',
  'no-context': 'nothing fit in the hint',
  'no-index': 'no module map in STRUCTURE.json',
  'no-words': 'no concept word in the search',
  'no-match': 'no module matched the concept',
  'session-dedup': 'already answered this session'
};

// And again for the session-start delivery of REFERENCE.md.
const DOCS_HINT_REASON_TEXT = {
  'no-index': 'this project has no .frame/docs/REFERENCE.md',
  'no-match': 'REFERENCE.md carries no section for it',
  'no-context': 'REFERENCE.md is empty'
};

// And once more for the terminal-entry staging of a spec command.
const SPEC_COMMAND_REASON_TEXT = {
  'no-index': 'no command template is staged for this project',
  'no-match': 'no spec is in a phase the command acts on',
  'no-stale-free-match': 'several specs qualify — the agent was asked to pick',
  'no-context': 'the template or the spec status could not be read'
};

// And for the close reminder, where "no index" is tasks.json itself.
const SPEC_CLOSE_REASON_TEXT = {
  orchestrated: 'an orchestration run owns the spec',
  'closed-earlier': 'the spec was closed before this session started',
  'git-unavailable': 'git could not say whether orchestration owns the spec',
  'session-dedup': 'already said this session',
  'no-index': 'tasks.json could not be read'
};

const LIFECYCLE_REASON_TEXT = {
  attach: 'first check after opening',
  periodic: 'periodic check',
  reopen: 'project reopened',
  resume: 'window shown again',
  reconcile: 'requested',
  'file-event': 'files changed',
  directory: 'a folder changed',
  gitignore: 'ignore rules changed',
  config: 'project settings changed',
  curation: 'the concept map changed',
  'git-state': 'the checkout changed (branch, merge or rebase)',
  'watcher-error': 'file watching failed',
  'unknown-change': 'an unidentified change'
};

const MISSED_BOUND_TEXT = {
  'changing-files': 'files kept changing while being read',
  'writer-busy': 'another update held the map',
  failed: 'the update failed',
  timeout: 'the scan ran out of time',
  'scan-budget': 'the update took longer than the scan budget'
};

const DOCS_DEGRADED_TEXT = {
  'missing-path': 'An agent doc points at a file that is not there',
  'unmatched-section': 'A doc carries its own spec section — left untouched',
  unreadable: 'An agent doc could not be read'
};

const MIGRATION_SKIP_TEXT = {
  unmerged: 'a meta file is in an unresolved merge',
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
  'spec-index': 'Spec index build',
  'find-module': 'Module lookup'
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
 * `analyticsEvents.validateEvent` does.
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
  HINT_MODES,
  CLOSE_VERDICTS,
  DECISION_SOURCES,
  DECISION_RELATIONS,
  LIFECYCLE_REASONS,
  MISSED_BOUND_REASONS,
  HOSTS,
  isRegistered,
  kindOf,
  isSuppression,
  validateEvent,
  formatLabel,
  buildRecord
};
