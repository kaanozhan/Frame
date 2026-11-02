/**
 * Activity event registry — the gate between a call site and the record.
 *
 * The properties under test are the ones that keep the record honest years
 * from now: an undeclared event cannot be written, a field value outside its
 * enum cannot ride along, suppressions stay distinguishable from actions,
 * and no label can throw hard enough to take a record down.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const events = require('../src/shared/activityEvents');

// ─── the gate ─────────────────────────────────────────────

test('an unregistered event is dropped entirely', () => {
  assert.equal(events.validateEvent('panel.opened', { path: 'x' }), null);
  assert.equal(events.buildRecord('totally.made.up', {}), null);
  assert.equal(events.formatLabel('totally.made.up', {}), null);
  assert.equal(events.kindOf('totally.made.up'), null);
});

test('unknown fields and out-of-enum values are stripped, good ones survive', () => {
  const out = events.validateEvent('watch.fired', {
    watcher: 'specs',
    changes: 3,
    triggered: 'launch-missiles', // not in the enum
    smuggled: 'free text' // not declared
  });
  assert.deepEqual(out, { watcher: 'specs', changes: 3 });
});

test('field types are enforced, not merely present', () => {
  assert.deepEqual(events.validateEvent('watch.fired', { watcher: 'nope' }), {});
  assert.deepEqual(events.validateEvent('index.rebuilt', { ms: -1 }), {});
  assert.deepEqual(events.validateEvent('index.rebuilt', { ms: 'fast' }), {});
  assert.deepEqual(events.validateEvent('spec.phase_reconciled', { slug: '' }), {});
  assert.deepEqual(events.validateEvent('state.recovered', { path: 'x'.repeat(500) }), {});
});

test('buildRecord carries the event name and its kind', () => {
  const rec = events.buildRecord('hint.quiet', { mode: 'pre-edit', reason: 'session-dedup', path: 'src/main/specManager.js' });
  assert.equal(rec.ev, 'hint.quiet');
  assert.equal(rec.kind, 'suppression');
  assert.equal(rec.reason, 'session-dedup');
});

// ─── suppressions are first-class ─────────────────────────

test('every registered event declares a valid kind', () => {
  for (const [name, spec] of Object.entries(events.EVENTS)) {
    assert.ok(['action', 'suppression'].includes(spec.kind), `${name} has kind ${spec.kind}`);
  }
});

test('the guard events are classified as suppressions, not actions', () => {
  for (const name of ['hint.quiet', 'watch.suppressed', 'index.fresh', 'poll.skipped']) {
    assert.equal(events.isSuppression(name), true, `${name} must be a suppression`);
  }
  for (const name of ['hint.injected', 'watch.fired', 'spec.phase_reconciled', 'state.recovered']) {
    assert.equal(events.isSuppression(name), false, `${name} must be an action`);
  }
});

// ─── the hook's quiet paths ───────────────────────────────

test('every spec-hint quiet path has its own reason code', () => {
  // eleven quiet returns in spec-hint.js, plus module-hint's `map-dirty` (STR-02)
  // and `map-incomplete`, `index-oversize`, `ambiguous-weak` (STR-03), `already-looked-up` (STR-03b),
  // plus the close reminder's `orchestrated`, `closed-earlier`, `git-unavailable`
  assert.equal(events.HINT_REASONS.length, 19, 'one code per quiet return in the hint hooks');
  assert.equal(new Set(events.HINT_REASONS).size, 19, 'codes are distinct');
  for (const reason of events.HINT_REASONS) {
    const out = events.validateEvent('hint.quiet', { reason });
    assert.equal(out.reason, reason, `${reason} must pass the enum`);
  }
});

test('reason codes are distinguishable in the label, not collapsed into one sentence', () => {
  const labels = events.HINT_REASONS.map((reason) => events.formatLabel('hint.quiet', { reason }));
  assert.equal(new Set(labels).size, events.HINT_REASONS.length, 'each reason reads differently');
});

// ─── watcher and poller coverage ──────────────────────────

test('every watcher and poller id is accepted by its event', () => {
  for (const watcher of events.WATCHERS) {
    assert.equal(events.validateEvent('watch.fired', { watcher }).watcher, watcher);
  }
  for (const poller of events.POLLERS) {
    assert.equal(events.validateEvent('poll.skipped', { poller }).poller, poller);
  }
});

// ─── labels ───────────────────────────────────────────────

test('labels read as sentences and pluralize their counts', () => {
  assert.match(events.formatLabel('hint.injected', { mode: 'pre-edit', path: 'src/main/logger.js', specs: 1 }), /1 prior spec\b/);
  assert.match(events.formatLabel('hint.injected', { mode: 'pre-edit', path: 'src/main/logger.js', specs: 3 }), /3 prior specs/);
  assert.match(events.formatLabel('watch.fired', { watcher: 'specs', changes: 1 }), /1 change\b/);
  assert.match(events.formatLabel('spec.phase_reconciled', { slug: 'activity-monitor', from: 'planned', to: 'implementing' }), /planned → implementing/);
});

test('a label never throws on a partial or empty record', () => {
  for (const name of Object.keys(events.EVENTS)) {
    assert.doesNotThrow(() => events.formatLabel(name, {}), `${name} threw on an empty record`);
    assert.doesNotThrow(() => events.formatLabel(name, undefined), `${name} threw on undefined`);
  }
});

test('every suppression can carry an aggregated repeat count', () => {
  for (const [name, spec] of Object.entries(events.EVENTS)) {
    if (spec.kind !== 'suppression') continue;
    assert.ok('repeats' in spec.fields, `${name} must declare repeats or its bursts report as one`);
    assert.equal(events.validateEvent(name, { repeats: 7 }).repeats, 7);
  }
});

test('an aggregated suppression says how many times it repeated', () => {
  const once = events.formatLabel('poll.skipped', { poller: 'update-check', reason: 'window-hidden' });
  const many = events.formatLabel('poll.skipped', { poller: 'update-check', reason: 'window-hidden', repeats: 5 });
  assert.ok(!once.includes('×'), 'a single occurrence carries no multiplier');
  assert.equal(many, `${once} ×5`);
});

test('a collapsed burst is reported with its true count, not as a single fire', () => {
  const label = events.formatLabel('watch.fired', { watcher: 'specs', changes: 2, collapsed: 12 });
  assert.match(label, /12 fires collapsed/);
  assert.ok(!events.formatLabel('watch.fired', { watcher: 'specs', changes: 2, collapsed: 1 }).includes('collapsed'));
});

// ─── layout migration ─────────────────────────────────────

test('a completed migration says where the copies went', () => {
  const fields = events.validateEvent('migration.completed', {
    moved: 5, backedUp: 5, review: 0, symlinks: 2, backupDir: '.frame/migration-backup', ms: 42
  });
  assert.equal(fields.backupDir, '.frame/migration-backup');
  assert.equal(fields.symlinks, 2);

  const label = events.formatLabel('migration.completed', fields);
  assert.match(label, /Moved 5 Frame files into \.frame\//);
  assert.match(label, /copies are in \.frame\/migration-backup/, 'a move nobody agreed to must say where the backup is');
  assert.match(label, /removed 2 Frame symlinks/);

  // A run that removed nothing does not claim it did, and one with no backup
  // directory recorded still reads as a sentence.
  const noLinks = events.formatLabel('migration.completed', { moved: 1, symlinks: 0, backupDir: '.frame/migration-backup' });
  assert.match(noLinks, /Moved 1 Frame file into/);
  assert.ok(!noLinks.includes('symlink'));
  assert.match(events.formatLabel('migration.completed', { moved: 2 }), /^Moved 2 Frame files into \.frame\/$/);
});

test('a skipped migration names the merge, and the old reason still reads', () => {
  assert.equal(events.validateEvent('migration.skipped', { reason: 'unmerged' }).reason, 'unmerged');
  assert.match(
    events.formatLabel('migration.skipped', { reason: 'unmerged' }),
    /unresolved merge/,
    'the reason names the merge, not "commit or stash"'
  );

  // Records already on disk carry the reason this replaced; the enum keeps it
  // so an old row still renders as a sentence rather than a bare code.
  assert.equal(events.validateEvent('migration.skipped', { reason: 'dirty-tree' }).reason, 'dirty-tree');
  assert.match(events.formatLabel('migration.skipped', { reason: 'dirty-tree' }), /uncommitted changes/);

  assert.deepEqual(events.validateEvent('migration.skipped', { reason: 'invented' }), {}, 'an undeclared reason is stripped');
});

// ─── STR-02: structure lifecycle ──────────────────────────

test('structure lifecycle events carry enums and counts only', () => {
  assert.deepEqual(events.validateEvent('structure.reconciled', {
    host: 'app', reason: 'file-event', ms: 840, changes: 3, coverage: 'complete',
    path: 'src/secret.js', file: 'src/secret.js', message: 'free text'
  }), { host: 'app', reason: 'file-event', ms: 840, changes: 3, coverage: 'complete' });
  assert.deepEqual(events.validateEvent('structure.reconciled', { reason: 'made-up', coverage: 'mostly' }), {});
  assert.deepEqual(events.validateEvent('structure.lifecycle', { state: 'missed-bound', reason: 'changing-files', path: 'x' }), { state: 'missed-bound', reason: 'changing-files' });
  assert.deepEqual(events.validateEvent('structure.lifecycle', { state: 'exploded' }), {});
  assert.equal(events.kindOf('structure.reconciled'), 'action');
  assert.equal(events.kindOf('structure.lifecycle'), 'action');
});

test('structure lifecycle labels read plainly and never throw', () => {
  assert.equal(events.formatLabel('structure.reconciled', { reason: 'git-state', changes: 1 }), 'Structure map updated — 1 file changed, the checkout changed (branch, merge or rebase)');
  assert.equal(events.formatLabel('structure.reconciled', { coverage: 'partial' }), 'Structure map updated (partial coverage)');
  assert.equal(events.formatLabel('structure.lifecycle', { state: 'attached' }), 'Started keeping the structure map current');
  assert.equal(events.formatLabel('structure.lifecycle', { state: 'detached' }), 'Stopped keeping the structure map current');
  assert.match(events.formatLabel('structure.lifecycle', { state: 'missed-bound' }), /missed its time bound — unknown reason/);
  for (const reason of events.LIFECYCLE_REASONS) assert.ok(events.formatLabel('structure.reconciled', { reason }));
  for (const reason of events.MISSED_BOUND_REASONS) assert.ok(!events.formatLabel('structure.lifecycle', { state: 'missed-bound', reason }).includes('undefined'));
});

// ─── the close step ───────────────────────────────────────

test('the close reminder is a mode on both hint events', () => {
  assert.ok(events.HINT_MODES.includes('spec-close'));
  assert.deepEqual(events.validateEvent('hint.injected', { host: 'claude-hook', mode: 'spec-close', specs: 2 }),
    { host: 'claude-hook', mode: 'spec-close', specs: 2 });
  assert.deepEqual(events.validateEvent('hint.quiet', { host: 'codex-hook', mode: 'spec-close', reason: 'orchestrated' }),
    { host: 'codex-hook', mode: 'spec-close', reason: 'orchestrated' });
  // One list feeds both events: a mode that can speak can also stay quiet.
  for (const mode of events.HINT_MODES) {
    assert.equal(events.validateEvent('hint.injected', { mode }).mode, mode);
    assert.equal(events.validateEvent('hint.quiet', { mode }).mode, mode);
  }
});

test('a close reminder says how many specs it named', () => {
  assert.equal(events.formatLabel('hint.injected', { mode: 'spec-close', specs: 1 }),
    'Reminded the agent that 1 closed spec still owes close items');
  assert.equal(events.formatLabel('hint.injected', { mode: 'spec-close', specs: 3 }),
    'Reminded the agent that 3 closed specs still owe close items');
});

test('every reason a close reminder is withheld reads as its own sentence', () => {
  const reasons = ['orchestrated', 'closed-earlier', 'git-unavailable', 'session-dedup', 'no-index'];
  const labels = reasons.map((reason) => events.formatLabel('hint.quiet', { mode: 'spec-close', reason }));
  assert.equal(new Set(labels).size, reasons.length, 'each reason reads differently');
  for (const [i, label] of labels.entries()) {
    assert.match(label, /^Spec close reminder withheld — /);
    assert.ok(!label.endsWith(reasons[i]), `${reasons[i]} has a sentence, not its bare code`);
  }
  // "no index" means tasks.json here, not the spec index.
  assert.match(events.formatLabel('hint.quiet', { mode: 'spec-close', reason: 'no-index' }), /tasks\.json could not be read/);
  assert.match(events.formatLabel('hint.quiet', { mode: 'pre-edit', reason: 'no-index' }), /no spec index yet/);
  // The first design's two reasons never shipped and are gone.
  for (const gone of ['before-baseline', 'no-close-time']) {
    assert.deepEqual(events.validateEvent('hint.quiet', { mode: 'spec-close', reason: gone }), { mode: 'spec-close' });
  }
});

test('a close check carries a slug, a verdict and a count — nothing of the digest', () => {
  assert.deepEqual(events.validateEvent('spec.close_checked', {
    host: 'cli', slug: 'spec-close-step', verdict: 'malformed', defects: 2,
    line: 'the first sentence of a digest', path: '.frame/specs/x/digest.md'
  }), { host: 'cli', slug: 'spec-close-step', verdict: 'malformed', defects: 2 });
  assert.deepEqual(events.validateEvent('spec.close_checked', { verdict: 'fine', defects: -1 }), {});
  assert.deepEqual(events.CLOSE_VERDICTS, ['ok', 'missing', 'malformed']);
  assert.equal(events.kindOf('spec.close_checked'), 'action');
});

test('a close check label says what was found', () => {
  assert.equal(events.formatLabel('spec.close_checked', { slug: 'a', verdict: 'ok' }), 'Spec a: close check passed');
  assert.equal(events.formatLabel('spec.close_checked', { slug: 'a', verdict: 'missing' }), 'Spec a: close check found a close item missing');
  assert.equal(events.formatLabel('spec.close_checked', { slug: 'a', verdict: 'malformed', defects: 1 }), 'Spec a: close check named 1 defect in its close items');
  assert.equal(events.formatLabel('spec.close_checked', { slug: 'a', verdict: 'malformed', defects: 3 }), 'Spec a: close check named 3 defects in its close items');
  assert.equal(events.formatLabel('spec.close_checked', {}), 'Spec ?: close check ran');
});

test('a module hint skipped while the map is being updated is a recorded reason', () => {
  assert.deepEqual(events.validateEvent('hint.quiet', { mode: 'search', reason: 'map-dirty' }), { mode: 'search', reason: 'map-dirty' });
  assert.equal(events.formatLabel('hint.quiet', { mode: 'search', reason: 'map-dirty' }), 'Module hint skipped — the module map is being updated');
});

test('a recorded decision card carries kinds and a slug — nothing of the card', () => {
  assert.deepEqual(events.validateEvent('decision.added', {
    host: 'cli', source: 'spec', slug: 'decision-cards-core', relation: 'supersedes',
    decision: 'leaked text', files: 'src/x.js'
  }), { host: 'cli', source: 'spec', slug: 'decision-cards-core', relation: 'supersedes' });
  assert.deepEqual(events.validateEvent('decision.added', { source: 'chat', relation: 'replaces' }), {});
  assert.deepEqual(events.validateEvent('decision.rejected', { host: 'cli', defects: 3, why: 'leak' }), { host: 'cli', defects: 3 });
  assert.equal(events.kindOf('decision.added'), 'action');
  assert.equal(events.kindOf('decision.rejected'), 'suppression');
  assert.deepEqual(events.DECISION_SOURCES, ['spec', 'notes']);
  assert.deepEqual(events.DECISION_RELATIONS, ['supersedes', 'extends', 'none']);
});

test('decision card labels say where the story is and how the card relates', () => {
  assert.equal(events.formatLabel('decision.added', { source: 'spec', slug: 'a', relation: 'none' }), 'Decision recorded for spec a');
  assert.equal(events.formatLabel('decision.added', { source: 'notes', relation: 'supersedes' }),
    'Decision recorded from a PROJECT_NOTES entry, superseding an older decision');
  assert.equal(events.formatLabel('decision.added', { source: 'notes', relation: 'extends' }),
    'Decision recorded from a PROJECT_NOTES entry, extending an older decision');
  assert.equal(events.formatLabel('decision.added', {}), 'Decision recorded');
  assert.equal(events.formatLabel('decision.rejected', { defects: 1 }), 'Decision refused — 1 defect named');
  assert.equal(events.formatLabel('decision.rejected', { defects: 2 }), 'Decision refused — 2 defects named');
});

test('an edit-time card delivery is a hint mode of its own, with a card count', () => {
  assert.ok(events.HINT_MODES.includes('decision-edit'));
  assert.deepEqual(events.validateEvent('hint.injected', { host: 'codex-hook', mode: 'decision-edit', path: 'src/a.js', cards: 2 }),
    { host: 'codex-hook', mode: 'decision-edit', path: 'src/a.js', cards: 2 });
  assert.equal(events.formatLabel('hint.injected', { mode: 'decision-edit', path: 'src/a.js', cards: 1 }),
    'Recorded decision delivered for src/a.js (1 card)');
  assert.equal(events.formatLabel('hint.injected', { mode: 'decision-edit', path: 'src/a.js', cards: 3 }),
    'Recorded decisions delivered for src/a.js (3 cards)');
  assert.equal(events.formatLabel('hint.quiet', { mode: 'decision-edit', reason: 'no-context' }).length > 0, true);
});

test('a prompt-time card delivery is a hint mode of its own, with a card count', () => {
  assert.ok(events.HINT_MODES.includes('decision-prompt'));
  assert.deepEqual(events.validateEvent('hint.injected', { host: 'claude-hook', mode: 'decision-prompt', cards: 2 }),
    { host: 'claude-hook', mode: 'decision-prompt', cards: 2 });
  assert.equal(events.formatLabel('hint.injected', { mode: 'decision-prompt', cards: 1 }), 'Surfaced 1 recorded decision for this request');
  assert.equal(events.formatLabel('hint.injected', { mode: 'decision-prompt', cards: 2 }), 'Surfaced 2 recorded decisions for this request');
  assert.deepEqual(events.validateEvent('hint.quiet', { host: 'claude-hook', mode: 'decision-prompt', reason: 'no-context' }),
    { host: 'claude-hook', mode: 'decision-prompt', reason: 'no-context' });
});
