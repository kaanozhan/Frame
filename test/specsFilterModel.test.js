/**
 * The Specs dashboard filter model (boards-done-window spec, T04 / S5 /
 * S6 / S7).
 *
 * Pure by design: requiring it must not reach `electron` or the DOM.
 * Pinned: scope × phase (phase ignored outside Active), the older split in
 * `all` and `done` and none in `active`, the search bypass, `showOlder`,
 * window 0, order preservation, and counts that follow the pool and the
 * window.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { SCOPES, PHASES, buildGridModel } = require('../src/renderer/specs/filterModel');
const { DAY_MS } = require('../src/shared/doneWindow');

const NOW = Date.parse('2026-09-13T12:00:00Z');
const ago = (d) => new Date(NOW - d * DAY_MS).toISOString();

// 5 active (one per phase) + 3 recent done + 38 older done = 46, the
// spec's S6 numbers.
function fixture() {
  const active = PHASES.map((p, i) => ({ slug: `a-${p.id}`, phase: p.id, updated_at: ago(i) }));
  const recentDone = [1, 10, 29].map(d => ({ slug: `d-recent-${d}`, phase: 'done', updated_at: ago(d) }));
  const olderDone = Array.from({ length: 38 }, (_, i) => ({ slug: `d-old-${i}`, phase: 'done', updated_at: ago(31 + i) }));
  // Interleave so order preservation is observable.
  return [active[0], olderDone[0], recentDone[0], ...active.slice(1), ...olderDone.slice(1), ...recentDone.slice(1)];
}
const slugs = (m) => m.visible.map(s => s.slug);

test('exports the three scopes and five active phases', () => {
  assert.deepEqual(SCOPES, ['all', 'active', 'done']);
  assert.deepEqual(PHASES.map(p => p.id), ['draft', 'specified', 'planned', 'tasks_generated', 'implementing']);
});

test('S6 · all: active + recent done, older behind the tile', () => {
  const m = buildGridModel({ specs: fixture(), scope: 'all', windowDays: 30, now: NOW });
  assert.equal(m.visible.length, 8);
  assert.equal(m.olderCount, 38);
  assert.equal(m.counts.all, 8);
  assert.equal(m.counts.active, 5);
  assert.equal(m.counts.done, 3);
  assert.equal(m.counts.doneTotal, 41);
});

test('S6 · done: recent done only, same tile', () => {
  const m = buildGridModel({ specs: fixture(), scope: 'done', windowDays: 30, now: NOW });
  assert.deepEqual(slugs(m), ['d-recent-1', 'd-recent-10', 'd-recent-29']);
  assert.equal(m.olderCount, 38);
});

test('S6 · active: never windowed, no tile', () => {
  const m = buildGridModel({ specs: fixture(), scope: 'active', windowDays: 30, now: NOW });
  assert.equal(m.visible.length, 5);
  assert.equal(m.olderCount, 0);
  assert.ok(m.visible.every(s => s.phase !== 'done'));
});

test('phase narrows inside active and is ignored outside it (S5)', () => {
  const specs = fixture();
  const a = buildGridModel({ specs, scope: 'active', phase: 'planned', windowDays: 30, now: NOW });
  assert.deepEqual(slugs(a), ['a-planned']);
  assert.equal(a.phase, 'planned');

  const all = buildGridModel({ specs, scope: 'all', phase: 'planned', windowDays: 30, now: NOW });
  assert.equal(all.visible.length, 8);
  assert.equal(all.phase, null);

  const done = buildGridModel({ specs, scope: 'done', phase: 'planned', windowDays: 30, now: NOW });
  assert.equal(done.visible.length, 3);
  assert.equal(done.phase, null);
});

test('a phase nobody is in yields an empty grid, not an error', () => {
  const specs = fixture().filter(s => s.phase !== 'draft');
  const m = buildGridModel({ specs, scope: 'active', phase: 'draft', windowDays: 30, now: NOW });
  assert.deepEqual(m.visible, []);
  assert.equal(m.counts['phase:draft'], undefined);
});

test('phase counts are per active phase and never include done', () => {
  const m = buildGridModel({ specs: fixture(), scope: 'all', windowDays: 30, now: NOW });
  for (const p of PHASES) assert.equal(m.counts[`phase:${p.id}`], 1);
  assert.equal(m.counts['phase:done'], undefined);
});

test('S7 · a search bypasses the window and hides the tile', () => {
  const specs = fixture();
  const matches = new Set(['d-old-3', 'd-old-20', 'a-draft']);
  const m = buildGridModel({ specs, scope: 'all', searchMatches: matches, windowDays: 30, now: NOW });
  assert.equal(m.visible.length, 3);
  assert.equal(m.olderCount, 0);
  assert.equal(m.counts.all, 3);
  assert.equal(m.counts.done, 2);
  assert.equal(m.counts.doneTotal, 2);
  assert.equal(m.counts.active, 1);

  const d = buildGridModel({ specs, scope: 'done', searchMatches: matches, windowDays: 30, now: NOW });
  assert.deepEqual(slugs(d).sort(), ['d-old-20', 'd-old-3']);
});

test('an empty search result is empty, not everything', () => {
  const m = buildGridModel({ specs: fixture(), scope: 'all', searchMatches: new Set(), windowDays: 30, now: NOW });
  assert.deepEqual(m.visible, []);
  assert.deepEqual(m.counts, { all: 0, active: 0, done: 0, doneTotal: 0 });
});

test('showOlder reveals everything and the counts follow', () => {
  const m = buildGridModel({ specs: fixture(), scope: 'all', windowDays: 30, showOlder: true, now: NOW });
  assert.equal(m.visible.length, 46);
  assert.equal(m.olderCount, 0);
  assert.equal(m.counts.all, 46);
  assert.equal(m.counts.done, 41);
});

test('window 0 means no window at all', () => {
  const m = buildGridModel({ specs: fixture(), scope: 'done', windowDays: 0, now: NOW });
  assert.equal(m.visible.length, 41);
  assert.equal(m.olderCount, 0);
});

test('visible keeps the input order (the grid is already sorted upstream)', () => {
  const m = buildGridModel({ specs: fixture(), scope: 'all', windowDays: 30, now: NOW });
  assert.deepEqual(slugs(m).slice(0, 4), ['a-draft', 'd-recent-1', 'a-specified', 'a-planned']);
});

test('a done spec with no updated_at stays visible', () => {
  const specs = [{ slug: 'x', phase: 'done' }, { slug: 'y', phase: 'done', updated_at: ago(400) }];
  const m = buildGridModel({ specs, scope: 'done', windowDays: 7, now: NOW });
  assert.deepEqual(slugs(m), ['x']);
  assert.equal(m.olderCount, 1);
});

test('malformed specs count as active and are never windowed', () => {
  const specs = [{ slug: 'm', phase: 'malformed', malformed: 'is missing phase', updated_at: ago(500) }];
  const m = buildGridModel({ specs, scope: 'all', windowDays: 7, now: NOW });
  assert.deepEqual(slugs(m), ['m']);
  assert.equal(m.counts.active, 1);
  assert.equal(m.olderCount, 0);
});

test('an unknown scope falls back to all; defaults are safe', () => {
  const m = buildGridModel({ specs: fixture(), scope: 'bogus', windowDays: 0 });
  assert.equal(m.scope, 'all');
  assert.equal(m.visible.length, 46);
  assert.deepEqual(buildGridModel().visible, []);
});

test('sort orders visible by updated_at: newest first by default, oldest on request', () => {
  const specs = [
    { slug: 'mid', phase: 'done', updated_at: ago(5) },
    { slug: 'new', phase: 'planned', updated_at: ago(1) },
    { slug: 'old', phase: 'done', updated_at: ago(40) }
  ];
  const n = buildGridModel({ specs, scope: 'all', now: NOW });
  assert.equal(n.sort, 'newest');
  assert.deepEqual(slugs(n), ['new', 'mid', 'old']);
  const o = buildGridModel({ specs, scope: 'all', sort: 'oldest', now: NOW });
  assert.equal(o.sort, 'oldest');
  assert.deepEqual(slugs(o), ['old', 'mid', 'new']);
});

test('sort falls back to created_at, puts undated specs oldest, and ignores unknown values', () => {
  const specs = [
    { slug: 'undated', phase: 'specified' },
    { slug: 'created', phase: 'specified', created_at: ago(2) },
    { slug: 'updated', phase: 'specified', updated_at: ago(3) }
  ];
  assert.deepEqual(slugs(buildGridModel({ specs, scope: 'active', now: NOW })), ['created', 'updated', 'undated']);
  assert.deepEqual(slugs(buildGridModel({ specs, scope: 'active', sort: 'oldest', now: NOW })), ['undated', 'updated', 'created']);
  assert.equal(buildGridModel({ specs, sort: 'sideways', now: NOW }).sort, 'newest');
});
