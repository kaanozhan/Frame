/**
 * gitSharing tests: derivation, the behaviour matrix, mode transitions and
 * the `.frame/.gitignore` writer, against real temp git repositories.
 *
 * The properties that matter: a pre-upgrade project derives the mode it
 * already behaves as (and only once); a tracked `.frame/` makes the
 * effective mode repo whatever was declared; setMode never touches the git
 * index; the gitignore writer is idempotent and preserves unsigned lines.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const gitSharing = require('../src/main/gitSharing');
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

function seedFrameProject(dir, config = { version: '1.0', settings: {} }) {
  fs.mkdirSync(path.join(dir, FRAME_DIR), { recursive: true });
  fs.writeFileSync(path.join(dir, FRAME_DIR, 'config.json'), JSON.stringify(config, null, 2));
}

function readConfig(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, FRAME_DIR, 'config.json'), 'utf8'));
}

function trackFrame(dir) {
  git(dir, 'add', '-f', `${FRAME_DIR}/config.json`);
  git(dir, 'commit', '-qm', 'track frame');
}

function gitignorePath(dir) {
  return path.join(dir, FRAME_DIR, '.gitignore');
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-sharing-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// ─── D4: derive once, persist ─────────────────────────────────

test('absent mode on an untracked project derives local and persists it', () => {
  const repo = makeRepo('derive-local');
  seedFrameProject(repo);

  assert.equal(gitSharing.resolveMode(repo), 'local');
  assert.equal(readConfig(repo).settings.gitSharing, 'local');
});

test('absent mode on a tracked project derives repo and persists it', () => {
  const repo = makeRepo('derive-repo');
  seedFrameProject(repo);
  trackFrame(repo);

  assert.equal(gitSharing.resolveMode(repo), 'repo');
  assert.equal(readConfig(repo).settings.gitSharing, 'repo');
});

test('an already-declared mode is returned untouched — derivation happens once', () => {
  const repo = makeRepo('declared-stays');
  seedFrameProject(repo, { version: '1.0', settings: { gitSharing: 'repo' } });

  assert.equal(gitSharing.resolveMode(repo), 'repo');
  assert.equal(gitExclude.isFrameTracked(repo), false, 'precondition: untracked');
});

test('derivation preserves unknown config keys', () => {
  const repo = makeRepo('unknown-keys');
  seedFrameProject(repo, { version: '1.0', settings: { x: 1 }, custom: { keep: true } });

  gitSharing.resolveMode(repo);
  const config = readConfig(repo);
  assert.equal(config.settings.x, 1);
  assert.deepEqual(config.custom, { keep: true });
});

test('resolveMode is null outside a git repo and for a non-Frame project', () => {
  const plain = path.join(root, 'not-a-repo');
  fs.mkdirSync(plain, { recursive: true });
  seedFrameProject(plain);
  assert.equal(gitSharing.resolveMode(plain), null);

  const repo = makeRepo('no-frame');
  assert.equal(gitSharing.resolveMode(repo), null);
});

// ─── the state matrix ─────────────────────────────────────────

test('declared local, untracked → effective local', () => {
  const repo = makeRepo('m-local');
  seedFrameProject(repo, { settings: { gitSharing: 'local' } });

  assert.deepEqual(gitSharing.getState(repo), {
    isRepo: true, declared: 'local', tracked: false, effective: 'local'
  });
});

test('declared local, tracked → effective repo (D3, the S4 row)', () => {
  const repo = makeRepo('m-conflict');
  seedFrameProject(repo, { settings: { gitSharing: 'local' } });
  trackFrame(repo);

  assert.deepEqual(gitSharing.getState(repo), {
    isRepo: true, declared: 'local', tracked: true, effective: 'repo'
  });
});

test('declared repo, untracked and tracked → effective repo', () => {
  const untracked = makeRepo('m-repo-untracked');
  seedFrameProject(untracked, { settings: { gitSharing: 'repo' } });
  assert.equal(gitSharing.getState(untracked).effective, 'repo');

  const tracked = makeRepo('m-repo-tracked');
  seedFrameProject(tracked, { settings: { gitSharing: 'repo' } });
  trackFrame(tracked);
  assert.equal(gitSharing.getState(tracked).effective, 'repo');
});

test('not a git repo → isRepo false, effective null', () => {
  const plain = path.join(root, 'm-no-repo');
  fs.mkdirSync(plain, { recursive: true });
  seedFrameProject(plain);

  assert.deepEqual(gitSharing.getState(plain), {
    isRepo: false, declared: null, tracked: false, effective: null
  });
});

// ─── setMode ──────────────────────────────────────────────────

test('local → repo removes the exclude block, writes nothing to the index', () => {
  const repo = makeRepo('set-repo');
  seedFrameProject(repo, { settings: { gitSharing: 'local' } });
  gitExclude.ensure(repo);

  const result = gitSharing.setMode(repo, 'repo');
  assert.equal(result.success, true);
  assert.equal(result.state.effective, 'repo');
  assert.equal(readConfig(repo).settings.gitSharing, 'repo');

  const exclude = fs.readFileSync(gitExclude.excludeFilePath(repo), 'utf8');
  assert.ok(!exclude.includes(gitExclude.MARKER), 'exclude block survived the switch');
  assert.ok(fs.existsSync(gitignorePath(repo)), '.frame/.gitignore not written');

  assert.equal(git(repo, 'diff', '--cached', '--name-only').trim(), '', 'something was staged');
  assert.ok(git(repo, 'status', '--porcelain').includes('.frame/'), '.frame/ not visible after switch');
});

test('repo → local on an untracked project restores the block', () => {
  const repo = makeRepo('set-local');
  seedFrameProject(repo, { settings: { gitSharing: 'repo' } });

  const result = gitSharing.setMode(repo, 'local');
  assert.equal(result.success, true);
  assert.equal(result.state.effective, 'local');
  const exclude = fs.readFileSync(gitExclude.excludeFilePath(repo), 'utf8');
  assert.ok(exclude.includes(gitExclude.EXCLUDE_BLOCK));
});

test('repo → local on a tracked project never touches the index (S4)', () => {
  const repo = makeRepo('set-local-tracked');
  seedFrameProject(repo, { settings: { gitSharing: 'repo' } });
  trackFrame(repo);

  const result = gitSharing.setMode(repo, 'local');
  assert.equal(result.success, true);
  assert.deepEqual(result.state, { isRepo: true, declared: 'local', tracked: true, effective: 'repo' });
  assert.equal(gitExclude.isFrameTracked(repo), true, 'something was untracked');
  const exclude = fs.readFileSync(gitExclude.excludeFilePath(repo), 'utf8');
  assert.ok(!exclude.includes(gitExclude.MARKER), 'a block was written while tracked');
});

test('setMode rejects invalid modes and non-Frame projects', () => {
  const repo = makeRepo('set-invalid');
  seedFrameProject(repo);
  assert.equal(gitSharing.setMode(repo, 'team').success, false);

  const bare = makeRepo('set-no-frame');
  assert.equal(gitSharing.setMode(bare, 'repo').success, false);
});

// ─── ensureOnOpen ─────────────────────────────────────────────

test('ensureOnOpen derives, ensures the exclude state, and adds the gitignore', () => {
  const repo = makeRepo('open-upgrade');
  seedFrameProject(repo);

  const state = gitSharing.ensureOnOpen(repo);
  assert.equal(state.declared, 'local');
  assert.equal(readConfig(repo).settings.gitSharing, 'local');
  const exclude = fs.readFileSync(gitExclude.excludeFilePath(repo), 'utf8');
  assert.ok(exclude.includes(gitExclude.EXCLUDE_BLOCK));
  assert.ok(fs.existsSync(gitignorePath(repo)), 'pre-upgrade project did not gain .frame/.gitignore');
});

test('ensureOnOpen is idempotent — repeated calls change nothing', () => {
  const repo = makeRepo('open-idempotent');
  seedFrameProject(repo);

  gitSharing.ensureOnOpen(repo);
  const config = fs.readFileSync(path.join(repo, FRAME_DIR, 'config.json'), 'utf8');
  const gitignore = fs.readFileSync(gitignorePath(repo), 'utf8');
  const exclude = fs.readFileSync(gitExclude.excludeFilePath(repo), 'utf8');

  gitSharing.ensureOnOpen(repo);
  assert.equal(fs.readFileSync(path.join(repo, FRAME_DIR, 'config.json'), 'utf8'), config);
  assert.equal(fs.readFileSync(gitignorePath(repo), 'utf8'), gitignore);
  assert.equal(fs.readFileSync(gitExclude.excludeFilePath(repo), 'utf8'), exclude);
});

test('ensureOnOpen on a non-repo or non-Frame dir is a safe no-op', () => {
  const plain = path.join(root, 'open-plain');
  fs.mkdirSync(plain, { recursive: true });
  const state = gitSharing.ensureOnOpen(plain);
  assert.equal(state.isRepo, false);
  assert.deepEqual(fs.readdirSync(plain), [], 'something was written');
});

// ─── the .frame/.gitignore writer ─────────────────────────────

test('the gitignore block lists every machine-local path', () => {
  const repo = makeRepo('gi-content');
  seedFrameProject(repo);
  gitSharing.writeFrameGitignore(repo);

  const content = fs.readFileSync(gitignorePath(repo), 'utf8');
  for (const p of ['runtime/', 'index/', 'implement-permissions.json', 'worktrees/', 'orchestration/', 'bin/', '*.bak', '*.tmp', '*.corrupt-*']) {
    assert.ok(content.split('\n').includes(p), `missing machine-local path: ${p}`);
  }
});

test('machine-local paths are actually ignored in repo mode', () => {
  const repo = makeRepo('gi-effective');
  seedFrameProject(repo, { settings: { gitSharing: 'repo' } });
  gitSharing.ensureOnOpen(repo);

  fs.mkdirSync(path.join(repo, FRAME_DIR, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(repo, FRAME_DIR, 'runtime', 'bus.json'), '{}');
  fs.mkdirSync(path.join(repo, FRAME_DIR, 'specs', 's1'), { recursive: true });
  fs.writeFileSync(path.join(repo, FRAME_DIR, 'specs', 's1', 'spec.md'), '# s\n');
  fs.writeFileSync(path.join(repo, FRAME_DIR, 'tasks.json.bak'), '{}');

  const status = git(repo, 'status', '--porcelain', '-uall');
  assert.ok(status.includes('specs/s1/spec.md'), 'a spec was hidden');
  assert.ok(!status.includes('runtime/'), 'runtime/ leaked into git status');
  assert.ok(!status.includes('tasks.json.bak'), 'a .bak leaked into git status');
});

test('rewrites are idempotent and preserve unsigned user lines', () => {
  const repo = makeRepo('gi-preserve');
  seedFrameProject(repo);
  fs.writeFileSync(gitignorePath(repo), '# my own rules\nscratch/\n');

  assert.equal(gitSharing.writeFrameGitignore(repo), 'written');
  assert.equal(gitSharing.writeFrameGitignore(repo), 'unchanged');

  const content = fs.readFileSync(gitignorePath(repo), 'utf8');
  assert.ok(content.includes('# my own rules'));
  assert.ok(content.includes('scratch/'));
  assert.equal(content.split('\n').filter((l) => l === 'runtime/').length, 1);
});

test('an outdated signed block is replaced, not duplicated', () => {
  const repo = makeRepo('gi-outdated');
  seedFrameProject(repo);
  fs.writeFileSync(
    gitignorePath(repo),
    'keep-me/\n\n# managed by Frame — machine-local paths, rewritten by Frame; add your own lines outside this block\nruntime/\nold-entry/\n# end managed by Frame\n'
  );

  gitSharing.writeFrameGitignore(repo);
  const content = fs.readFileSync(gitignorePath(repo), 'utf8');
  assert.ok(content.includes('keep-me/'));
  assert.ok(!content.includes('old-entry/'), 'stale entry survived the rewrite');
  assert.equal(content.split('\n').filter((l) => l === 'runtime/').length, 1);
});

test('no .frame/ directory → no-op, nothing created', () => {
  const repo = makeRepo('gi-no-frame');
  assert.equal(gitSharing.writeFrameGitignore(repo), 'no-frame');
  assert.ok(!fs.existsSync(path.join(repo, FRAME_DIR)));
});
