/**
 * gitExclude tests (T03): the conditional exclude state machine, exercised
 * against real temp git repositories rather than a stubbed git.
 *
 * The interesting property is not "the entry gets written" — it is that the
 * entry disappears once `.frame/` is tracked (otherwise a team that opts in
 * silently stops seeing new spec folders), that foreign lines survive, and
 * that a linked worktree resolves its own exclude file rather than the
 * main one.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const gitExclude = require('../src/main/gitExclude');
const { FRAME_DIR } = require('../src/shared/frameConstants');

let root;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function makeRepo(name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Frame Test');
  fs.writeFileSync(path.join(dir, 'README.md'), '# repo\n');
  git(dir, 'add', 'README.md');
  git(dir, 'commit', '-qm', 'initial');
  return dir;
}

function seedFrameDir(dir) {
  fs.mkdirSync(path.join(dir, FRAME_DIR), { recursive: true });
  fs.writeFileSync(path.join(dir, FRAME_DIR, 'config.json'), '{"version":"1.0"}\n');
}

function excludeContent(dir) {
  return fs.readFileSync(gitExclude.excludeFilePath(dir), 'utf8');
}

function statusPorcelain(dir) {
  return git(dir, 'status', '--porcelain').trim();
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-exclude-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// ─── untracked → add ──────────────────────────────────────────

test('untracked .frame/ gets the signed block, and git status goes quiet', () => {
  const repo = makeRepo('plain');
  seedFrameDir(repo);
  assert.notEqual(statusPorcelain(repo), '', 'precondition: .frame/ is visible');

  assert.equal(gitExclude.ensure(repo), 'added');
  assert.ok(excludeContent(repo).includes(gitExclude.EXCLUDE_BLOCK));
  assert.equal(statusPorcelain(repo), '', 'the working tree is not clean');
});

test('ensure is idempotent — a second call changes nothing', () => {
  const repo = makeRepo('idempotent');
  seedFrameDir(repo);

  assert.equal(gitExclude.ensure(repo), 'added');
  const after = excludeContent(repo);
  assert.equal(gitExclude.ensure(repo), 'unchanged');
  assert.equal(excludeContent(repo), after);
});

test('a duplicated or older Frame entry collapses to exactly one current block', () => {
  const repo = makeRepo('dupes');
  seedFrameDir(repo);
  const excludePath = gitExclude.excludeFilePath(repo);
  fs.mkdirSync(path.dirname(excludePath), { recursive: true });
  fs.writeFileSync(excludePath, `.frame/ # ${gitExclude.MARKER} (old wording)\n.frame/ # ${gitExclude.MARKER}\n`);

  assert.equal(gitExclude.ensure(repo), 'added');
  const content = excludeContent(repo);
  const marked = content.split('\n').filter((l) => l.includes(gitExclude.MARKER));
  assert.equal(marked.length, 1, 'more than one Frame entry survived');
  assert.ok(content.includes(gitExclude.EXCLUDE_BLOCK));
});

// ─── tracked → remove ─────────────────────────────────────────

test('once .frame/ is tracked the entry is removed, so new files stay visible', () => {
  const repo = makeRepo('opted-in');
  seedFrameDir(repo);
  gitExclude.ensure(repo);

  // The team opts in: commit .frame/ (forced past our own exclude entry).
  git(repo, 'add', '-f', `${FRAME_DIR}/config.json`);
  git(repo, 'commit', '-qm', 'track frame');

  assert.equal(gitExclude.ensure(repo), 'removed');
  assert.ok(!excludeContent(repo).includes(gitExclude.MARKER));

  // A newly created .frame/ file must now show up — the drift this guards.
  fs.mkdirSync(path.join(repo, FRAME_DIR, 'specs', 'new-spec'), { recursive: true });
  fs.writeFileSync(path.join(repo, FRAME_DIR, 'specs', 'new-spec', 'spec.md'), '# new\n');
  assert.ok(statusPorcelain(repo).includes('.frame/'), 'a fresh spec stayed invisible');
});

test('removal is not repeated once done', () => {
  const repo = makeRepo('opted-in-twice');
  seedFrameDir(repo);
  gitExclude.ensure(repo);
  git(repo, 'add', '-f', `${FRAME_DIR}/config.json`);
  git(repo, 'commit', '-qm', 'track frame');

  assert.equal(gitExclude.ensure(repo), 'removed');
  assert.equal(gitExclude.ensure(repo), 'unchanged');
});

// ─── other people's lines ─────────────────────────────────────

test('foreign lines survive both adding and removing', () => {
  const repo = makeRepo('foreign');
  seedFrameDir(repo);
  const excludePath = gitExclude.excludeFilePath(repo);
  fs.mkdirSync(path.dirname(excludePath), { recursive: true });
  const foreign = '# my personal ignores\nscratch/\n*.local\n.frame/\n';
  fs.writeFileSync(excludePath, foreign);

  gitExclude.ensure(repo);
  let content = excludeContent(repo);
  for (const line of foreign.trim().split('\n')) {
    assert.ok(content.includes(line), `lost a foreign line: ${line}`);
  }
  assert.ok(content.includes(gitExclude.EXCLUDE_BLOCK));

  git(repo, 'add', '-f', `${FRAME_DIR}/config.json`);
  git(repo, 'commit', '-qm', 'track frame');
  gitExclude.ensure(repo);

  content = excludeContent(repo);
  for (const line of foreign.trim().split('\n')) {
    assert.ok(content.includes(line), `lost a foreign line on removal: ${line}`);
  }
  assert.ok(!content.includes(gitExclude.MARKER), 'our line stayed behind');
});

test("a hand-written unsigned .frame/ rule is never removed", () => {
  const repo = makeRepo('hand-written');
  seedFrameDir(repo);
  const excludePath = gitExclude.excludeFilePath(repo);
  fs.mkdirSync(path.dirname(excludePath), { recursive: true });
  fs.writeFileSync(excludePath, '.frame/\n');

  gitExclude.ensure(repo);
  git(repo, 'add', '-f', `${FRAME_DIR}/config.json`);
  git(repo, 'commit', '-qm', 'track frame');
  gitExclude.ensure(repo);

  assert.ok(excludeContent(repo).split('\n').includes('.frame/'), "removed someone else's rule");
});

// ─── no repo / worktrees ──────────────────────────────────────

test('a directory outside any git repository is a no-op', () => {
  const plain = path.join(root, 'not-a-repo');
  fs.mkdirSync(plain, { recursive: true });
  seedFrameDir(plain);

  assert.equal(gitExclude.ensure(plain), 'no-repo');
  assert.equal(gitExclude.excludeFilePath(plain), null);
  assert.deepEqual(fs.readdirSync(plain), [FRAME_DIR], 'something was written anyway');
});

test('ensure(undefined) is a no-op', () => {
  assert.equal(gitExclude.ensure(undefined), 'no-repo');
});

test('a linked worktree writes to its own exclude file, not the main one', () => {
  const repo = makeRepo('main-tree');
  const wt = path.join(root, 'linked');
  git(repo, 'worktree', 'add', '-q', '-b', 'side', wt);
  seedFrameDir(wt);

  assert.equal(gitExclude.ensure(wt), 'added');

  const wtExclude = gitExclude.excludeFilePath(wt);
  assert.ok(fs.readFileSync(wtExclude, 'utf8').includes(gitExclude.EXCLUDE_BLOCK));
  assert.equal(statusPorcelain(wt), '', 'the worktree is not clean');

  const mainExclude = gitExclude.excludeFilePath(repo);
  assert.notEqual(path.resolve(wtExclude), path.resolve(mainExclude), 'resolved to the shared file');
});

test('isFrameTracked reflects the repo, not the filesystem', () => {
  const repo = makeRepo('tracking');
  seedFrameDir(repo);
  assert.equal(gitExclude.isFrameTracked(repo), false);

  git(repo, 'add', '-f', `${FRAME_DIR}/config.json`);
  git(repo, 'commit', '-qm', 'track frame');
  assert.equal(gitExclude.isFrameTracked(repo), true);
});
