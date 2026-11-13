/**
 * workspaceSpecs — where a spec lives once specs move into workspaces
 * (spec-in-workspace spec, T01 / G2 / S3 / S4 / S7).
 *
 * Pinned: the merged list tags every entry with its workspace (null = main);
 * a slug in both places shows once, the workspace copy winning; the sort is
 * listSpecs' own (malformed first, then newest); local mode provisions the
 * Claude hook file too; command paths point the agent at its root but task
 * state at main; hand-back runs only in local mode and never replaces newer.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  provisionEntries, mergeSpecLists, rootForSlug, commandPaths, handBackSlugs
} = require('../src/shared/workspaceSpecs');

const P = '/work/app';
const TEAL = { id: 'w1', name: 'teal', branch: 'ws/teal', root: '/ws/app/teal' };
const AMBER = { id: 'w2', name: 'amber', branch: 'ws/amber', root: '/ws/app/amber' };

test('provisionEntries: bin, runtime commands and index; local mode adds the hook file', () => {
  assert.deepEqual(provisionEntries({ gitSharing: 'repo' }), ['.frame/bin', '.frame/runtime/commands', '.frame/index']);
  assert.deepEqual(provisionEntries(), ['.frame/bin', '.frame/runtime/commands', '.frame/index']);
  assert.ok(provisionEntries({ gitSharing: 'local' }).includes('.claude/settings.local.json'));
});

test('mergeSpecLists tags entries and lets the workspace copy win a slug clash', () => {
  const merged = mergeSpecLists(
    [
      { slug: 'login', phase: 'done', updated_at: '2026-11-01' },
      { slug: 'search', phase: 'planned', updated_at: '2026-11-05' }
    ],
    [
      { workspace: TEAL, specs: [{ slug: 'login', phase: 'implementing', updated_at: '2026-11-09' }] },
      { workspace: AMBER, specs: [{ slug: 'billing', phase: 'specified', updated_at: '2026-11-08' }] }
    ]
  );
  assert.deepEqual(merged.map((s) => s.slug), ['login', 'billing', 'search'], 'newest first');
  assert.equal(merged.length, 3, 'a slug in both places shows once');
  const login = merged.find((s) => s.slug === 'login');
  assert.equal(login.phase, 'implementing', 'the workspace copy wins');
  assert.deepEqual(login.workspace, { id: 'w1', name: 'teal', branch: 'ws/teal', root: '/ws/app/teal' });
  assert.equal(merged.find((s) => s.slug === 'search').workspace, null, 'main specs are tagged null');
});

test('mergeSpecLists: between two workspaces the first listed wins; malformed sort first', () => {
  const merged = mergeSpecLists(
    [{ slug: 'broken', malformed: true }],
    [
      { workspace: TEAL, specs: [{ slug: 'x', updated_at: '2026-11-01' }] },
      { workspace: AMBER, specs: [{ slug: 'x', updated_at: '2026-11-09' }] }
    ]
  );
  assert.equal(merged[0].slug, 'broken');
  assert.equal(merged.find((s) => s.slug === 'x').workspace.id, 'w1');
  assert.deepEqual(mergeSpecLists(null, null), []);
});

test('rootForSlug: the workspace folder for a workspace spec, else the project', () => {
  const merged = mergeSpecLists([{ slug: 'a' }], [{ workspace: TEAL, specs: [{ slug: 'b' }] }]);
  assert.equal(rootForSlug(merged, 'b', P), '/ws/app/teal');
  assert.equal(rootForSlug(merged, 'a', P), P);
  assert.equal(rootForSlug(merged, 'unknown', P), P);
});

test('commandPaths: the agent works in its root; tasks stay in main', () => {
  assert.deepEqual(
    commandPaths({ projectPath: P, root: '/ws/app/teal', tasksPath: `${P}/.frame/tasks.json` }),
    { project_path: '/ws/app/teal', tasks_path: `${P}/.frame/tasks.json` }
  );
  assert.equal(commandPaths({ projectPath: P, tasksPath: 't' }).project_path, P);
});

test('handBackSlugs: local mode only, new slugs and newer copies only', () => {
  const wt = [
    { slug: 'new-one', updated_at: '2026-11-09' },
    { slug: 'newer', updated_at: '2026-11-09' },
    { slug: 'older', updated_at: '2026-11-01' }
  ];
  const main = [
    { slug: 'newer', updated_at: '2026-11-05' },
    { slug: 'older', updated_at: '2026-11-05' }
  ];
  assert.deepEqual(handBackSlugs(wt, main, 'local'), ['new-one', 'newer']);
  assert.deepEqual(handBackSlugs(wt, main, 'repo'), [], 'repo mode: the branch carries specs');
});
