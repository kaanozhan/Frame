/**
 * Workspace list prefs — open or folded, per sidebar view
 * (workspace-list-agent-alerts spec, T04).
 *
 * Pinned: open by default in Projects, folded in every other view; a view
 * remembers its own choice and leaves the others alone; a bad stored value
 * reads as no choice made.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { STORAGE_KEY, defaultOpen, parse, isOpen, withOpen } = require('../src/renderer/workspaces/listPrefs');

test('defaults: open in Projects, folded in Files, Changes and GitHub', () => {
  assert.equal(defaultOpen('projects'), true);
  for (const view of ['files', 'changes', 'github', 'something-new', undefined]) {
    assert.equal(defaultOpen(view), false);
  }
  assert.equal(isOpen({}, 'projects'), true);
  assert.equal(isOpen({}, 'files'), false);
  assert.equal(STORAGE_KEY, 'frame-ws-list-open');
});

test('a view remembers its own choice; the other views are unaffected', () => {
  let prefs = withOpen({}, 'projects', false);
  assert.equal(isOpen(prefs, 'projects'), false);
  assert.equal(isOpen(prefs, 'files'), false);
  prefs = withOpen(prefs, 'files', true);
  assert.deepEqual(prefs, { projects: false, files: true });
  assert.equal(isOpen(prefs, 'changes'), false);
  assert.equal(isOpen(prefs, 'github'), false);
  // The choice survives the round trip through storage.
  assert.deepEqual(parse(JSON.stringify(prefs)), prefs);
  // withOpen never changes what it was given.
  const before = { files: true };
  withOpen(before, 'files', false);
  assert.deepEqual(before, { files: true });
});

test('bad stored values read as no choice made', () => {
  for (const raw of [null, undefined, '', 'not json', '[]', '"open"', '42', 'null']) {
    assert.deepEqual(parse(raw), {});
  }
  assert.deepEqual(parse('{"projects":"yes","files":true,"changes":0,"github":null}'), { files: true });
  for (const prefs of [null, undefined, 'x', 7, [true], { projects: 'no' }]) {
    assert.equal(isOpen(prefs, 'projects'), true);
    assert.equal(isOpen(prefs, 'files'), false);
  }
  assert.deepEqual(withOpen('garbage', 'files', 1), { files: true });
  assert.deepEqual(withOpen({ projects: 'yes', github: false }, 'files', false), { github: false, files: false });
});
