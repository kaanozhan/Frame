/**
 * gitExclude tests (non-invasive-overlay T06).
 *
 * The exclude block is the whole of sharing mode `local`, and it has three
 * ways to go wrong: unanchored entries that hit a monorepo's other `.frame/`
 * directories, a wrong file in a linked worktree or sub-directory project, and
 * excluding files that are already tracked (which makes them disappear on a
 * teammate's clone). Each gets a test.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const gitExclude = require('../src/main/gitExclude');

let repoDir;

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function initRepo(dir) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', 'root']);
}

function writeFrame(dir) {
  fs.mkdirSync(path.join(dir, '.frame'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.frame', 'config.json'), '{"version":"1.0"}', 'utf8');
}

function readExclude(dir) {
  return fs.readFileSync(gitExclude.excludeFilePath(dir), 'utf8');
}

beforeEach(() => {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-exclude-'));
  initRepo(repoDir);
  writeFrame(repoDir);
});

afterEach(() => {
  fs.rmSync(repoDir, { recursive: true, force: true });
});

test('adds an anchored block and is idempotent', () => {
  const first = gitExclude.ensureExcluded(repoDir);
  assert.equal(first.applied, true);
  assert.equal(first.changed, true);

  const content = readExclude(repoDir);
  assert.match(content, /^\/\.frame\/$/m, 'entry is anchored, not a bare .frame/');
  assert.match(content, /^\/\.claude\/rules\/frame\.md$/m);
  assert.ok(gitExclude.hasBlock(repoDir));

  const second = gitExclude.ensureExcluded(repoDir);
  assert.equal(second.changed, false, 'second call writes nothing');
  assert.equal(readExclude(repoDir), content);
});

test('user lines outside the block survive add and remove', () => {
  const file = gitExclude.excludeFilePath(repoDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# my own excludes\nscratch/\n', 'utf8');

  gitExclude.ensureExcluded(repoDir);
  let content = readExclude(repoDir);
  assert.match(content, /# my own excludes/);
  assert.match(content, /^scratch\/$/m);

  const removal = gitExclude.removeExcluded(repoDir);
  assert.equal(removal.removed, true);
  content = readExclude(repoDir);
  assert.equal(content, '# my own excludes\nscratch/\n', 'back to exactly the user\'s lines');
  assert.equal(gitExclude.hasBlock(repoDir), false);
});

test('a sub-directory project excludes its own path, not the repo root\'s', () => {
  const projectDir = path.join(repoDir, 'apps', 'web');
  fs.mkdirSync(projectDir, { recursive: true });
  writeFrame(projectDir);

  gitExclude.ensureExcluded(projectDir);
  const content = readExclude(projectDir);
  assert.match(content, /^\/apps\/web\/\.frame\/$/m);
  assert.match(content, /^\/apps\/web\/\.claude\/rules\/frame\.md$/m);
  assert.ok(!/^\/\.frame\/$/m.test(content), 'the repo root\'s .frame/ is untouched');
});

test('a linked worktree writes to the repository\'s shared exclude file', () => {
  fs.writeFileSync(path.join(repoDir, 'file.txt'), 'x', 'utf8');
  git(repoDir, ['add', 'file.txt']); // not `-A`: .frame/ must stay untracked here
  git(repoDir, ['commit', '-q', '-m', 'first']);

  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-wt-'));
  fs.rmSync(worktreeDir, { recursive: true, force: true });
  git(repoDir, ['worktree', 'add', '-q', '-b', 'wt', worktreeDir]);
  try {
    writeFrame(worktreeDir);
    const result = gitExclude.ensureExcluded(worktreeDir);
    assert.equal(result.applied, true);
    // .git is a file in a linked worktree; the resolved path must still be a
    // real exclude file (git-path points at the common dir).
    assert.ok(fs.existsSync(result.file), 'resolved exclude file exists');
    assert.match(fs.readFileSync(result.file, 'utf8'), /^\/\.frame\/$/m);
  } finally {
    git(repoDir, ['worktree', 'remove', '--force', worktreeDir]);
  }
});

test('a tracked .frame/ is never excluded, and an existing block is withdrawn', () => {
  gitExclude.ensureExcluded(repoDir);
  assert.ok(gitExclude.hasBlock(repoDir));

  git(repoDir, ['add', '-f', '.frame/config.json']);
  git(repoDir, ['commit', '-q', '-m', 'share frame']);
  assert.equal(gitExclude.isFrameTracked(repoDir), true);

  const result = gitExclude.ensureExcluded(repoDir);
  assert.equal(result.applied, false);
  assert.equal(result.tracked, true);
  assert.equal(gitExclude.hasBlock(repoDir), false, 'block withdrawn so committed files stay visible');
});

test('outside a git repository every operation is a stated no-op', () => {
  const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-nogit-'));
  try {
    writeFrame(plainDir);
    assert.equal(gitExclude.isGitRepo(plainDir), false);
    assert.equal(gitExclude.ensureExcluded(plainDir).applied, false);
    assert.equal(gitExclude.removeExcluded(plainDir).removed, false);
    assert.equal(gitExclude.isFrameTracked(plainDir), false);
    assert.deepEqual(fs.readdirSync(plainDir), ['.frame'], 'nothing written');
  } finally {
    fs.rmSync(plainDir, { recursive: true, force: true });
  }
});
