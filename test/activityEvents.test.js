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
  assert.equal(events.HINT_REASONS.length, 11, 'one code per quiet return in spec-hint.js');
  assert.equal(new Set(events.HINT_REASONS).size, 11, 'codes are distinct');
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

test('a collapsed burst is reported with its true count, not as a single fire', () => {
  const label = events.formatLabel('watch.fired', { watcher: 'specs', changes: 2, collapsed: 12 });
  assert.match(label, /12 fires collapsed/);
  assert.ok(!events.formatLabel('watch.fired', { watcher: 'specs', changes: 2, collapsed: 1 }).includes('collapsed'));
});
