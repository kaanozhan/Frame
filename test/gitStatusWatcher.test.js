/**
 * Working-tree watcher scope.
 *
 * This predicate decides what does *not* wake the Changes panel. It earned a
 * test the hard way: the watcher was refreshing on Frame's own artifact
 * writes, which meant a `git status` roughly every 270ms for hours with no
 * information produced. The module is Electron-coupled, so only the pure
 * predicate is exercised here — the project's convention.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isIgnoredWorktreePath, gitDirFromDotGitFile } = require('../src/main/gitStatusManager');
const path = require('path');

test('git internals are ignored — the dedicated .git watcher owns them', () => {
  for (const p of ['.git', '.git/index', '.git/refs/heads/main', '.git/index.lock']) {
    assert.equal(isIgnoredWorktreePath(p), true, `${p} should be ignored`);
  }
});

test("Frame's own artifacts are ignored — refreshing because Frame wrote its own index tells nobody anything", () => {
  for (const p of [
    '.frame',
    '.frame/index/spec-index.json',
    '.frame/runtime/commands/claude-code/spec.new.md',
    '.frame/specs/activity-monitor/status.json'
  ]) {
    assert.equal(isIgnoredWorktreePath(p), true, `${p} should be ignored`);
  }
});

test('real source changes still wake the watcher', () => {
  for (const p of ['src/main/index.js', 'package.json', 'README.md', 'test/fsSafe.test.js']) {
    assert.equal(isIgnoredWorktreePath(p), false, `${p} must still refresh the panel`);
  }
});

test('lookalike paths are not swallowed by the prefix match', () => {
  for (const p of ['.frameworks/config.js', 'frame/app.js', 'src/.frame-notes.md', '.gitignore', '.github/workflows/ci.yml']) {
    assert.equal(isIgnoredWorktreePath(p), false, `${p} must not be mistaken for a Frame artifact`);
  }
});

test('an empty or missing filename never claims to be ignorable', () => {
  assert.equal(isIgnoredWorktreePath(undefined), false);
  assert.equal(isIgnoredWorktreePath(null), false);
  assert.equal(isIgnoredWorktreePath(''), false);
});

// Linked worktrees (workspaces spec, T03): `.git` is a file pointing at the
// real git dir, which is what the `.git` watcher must follow.
test('a .git file resolves to the git dir it points at', () => {
  assert.equal(
    gitDirFromDotGitFile('gitdir: /repo/.git/worktrees/teal\n', '/ws/repo/teal'),
    path.resolve('/repo/.git/worktrees/teal')
  );
  assert.equal(
    gitDirFromDotGitFile('gitdir: ../.git/modules/sub', '/repo/sub'),
    path.resolve('/repo/sub', '../.git/modules/sub'),
    'a relative gitdir resolves against the worktree'
  );
});

test('anything that is not a gitdir pointer resolves to nothing', () => {
  assert.equal(gitDirFromDotGitFile('', '/x'), null);
  assert.equal(gitDirFromDotGitFile('ref: refs/heads/main', '/x'), null);
  assert.equal(gitDirFromDotGitFile(undefined, '/x'), null);
});
