/**
 * Workspace git behaviour against real repositories (workspace-hardening spec).
 *
 * Drives the real main-process modules — workspaceManager, workspaceGitState,
 * gitBranchesManager, gitDiffManager — against a temporary project cloned
 * from a temporary bare remote, so each defect found in the 2026-11-11 review
 * is reproduced by the git it actually runs, then pinned:
 *   L1  a push never reaches the base branch, whatever the upstream or push.default
 *   L2  a branch rename never reads its text as an option
 *   X1  create never hands base/branch text to git as an option (--upload-pack)
 *   L13d the review diff never takes an option as its merge base
 *
 * Electron and the analytics SDKs are stubbed, as in frameProjectOpen.test.js;
 * githubManager is stubbed so no test ever calls `gh`. HOME points at a temp
 * folder before anything loads, because the workspaces root reads it at load.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Module = require('node:module');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-wsgit-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = 'Frame Test';
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = 'test@frame.local';

// Tests that need `gh` replace runGh for their duration (restored by withGh).
const GH_NONE = async () => ({ ok: false, error: 'gh is stubbed in tests', stdout: '' });
const GITHUB_STUB = {
  checkAccess: async () => ({ gh: false, authed: false, repoName: null }),
  runGh: GH_NONE
};
async function withGh(fake, fn) {
  GITHUB_STUB.runGh = fake;
  try { return await fn(); } finally { GITHUB_STUB.runGh = GH_NONE; }
}
const EXTERNAL_STUBS = {
  '@aptabase/electron/main': { initialize() {}, trackEvent() {} },
  'posthog-node': { PostHog: class { capture() {} captureException() {} identify() {} shutdown() { return Promise.resolve(); } } },
  electron: {
    app: { getPath: () => path.join(SANDBOX, 'userData'), getVersion: () => '0.0.0-test', on() {} },
    ipcMain: { handle() {}, on() {}, removeHandler() {} },
    dialog: { showMessageBox: async () => ({ response: 1 }) },
    BrowserWindow: { getAllWindows: () => [] }
  }
};
const GITHUB_PATH = path.join(__dirname, '..', 'src', 'main', 'githubManager.js');
const loadOriginal = Module._load;
Module._load = function (request, parent, ...rest) {
  if (Object.prototype.hasOwnProperty.call(EXTERNAL_STUBS, request)) return EXTERNAL_STUBS[request];
  if (request.startsWith('.') && parent && parent.filename) {
    try {
      if (Module._resolveFilename(request, parent) === GITHUB_PATH) return GITHUB_STUB;
    } catch (_) { /* fall through */ }
  }
  return loadOriginal.call(this, request, parent, ...rest);
};

const projectRegistry = require('../src/main/projectRegistry');
const workspaceManager = require('../src/main/workspaceManager');
const workspaceGitState = require('../src/main/workspaceGitState');
const gitDiffManager = require('../src/main/gitDiffManager');

projectRegistry.init({}, null);

after(() => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

let projectSeq = 0;
/** A project cloned from a bare remote with one commit on main, registered with Frame. */
function makeProject() {
  const dir = path.join(SANDBOX, `p${++projectSeq}`);
  fs.mkdirSync(dir, { recursive: true });
  const remote = path.join(dir, 'origin.git');
  const seed = path.join(dir, 'seed');
  git(['init', '-q', '--bare', '-b', 'main', remote], dir);
  git(['init', '-q', '-b', 'main', seed], dir);
  fs.writeFileSync(path.join(seed, 'README.md'), 'hello\n');
  git(['add', '.'], seed);
  git(['commit', '-qm', 'init'], seed);
  git(['push', '-q', remote, 'main'], seed);
  const project = path.join(dir, 'project');
  git(['clone', '-q', remote, project], dir);
  projectRegistry.addProject(project, path.basename(dir), false);
  return { project, remote };
}

/**
 * A test's own mutating git command inside a worktree. Every workspace
 * mutation starts a background git-state read (workspaceManager.notify →
 * workspaceGitState.refresh) whose `git status` can hold the index lock for a
 * moment, so a colliding `git add` is retried briefly instead of failing.
 */
function gitWrite(args, cwd) {
  for (let i = 0; ; i++) {
    try {
      return git(args, cwd);
    } catch (err) {
      if (i >= 50 || !/index\.lock/.test(String(err.stderr || err.message))) throw err;
      execFileSync('sleep', ['0.1']);
    }
  }
}

function remoteSha(remote, ref) {
  try { return git(['rev-parse', ref], remote); } catch (_) { return null; }
}

// ─── L1: push target ─────────────────────────────────────────

test('L1: a branch tracking origin/main pushes to its own name, never to main', async () => {
  const { project, remote } = makeProject();
  git(['branch', 'feat', 'origin/main'], project);            // upstream = origin/main
  git(['config', 'push.default', 'upstream'], project);       // a bare push would go to main
  const created = await workspaceManager.create(project, { from: 'branch', branch: 'feat' });
  assert.equal(created.error, null, created.error);
  const wt = created.workspace.path;
  fs.writeFileSync(path.join(wt, 'work.txt'), 'work\n');
  gitWrite(['add', '.'], wt);
  gitWrite(['commit', '-qm', 'work'], wt);
  const mainBefore = remoteSha(remote, 'main');

  const res = await workspaceGitState.push(project, created.workspace.id);

  assert.equal(remoteSha(remote, 'main'), mainBefore, 'origin/main must not move');
  assert.equal(res.error, null, res.error);
  assert.equal(remoteSha(remote, 'feat'), git(['rev-parse', 'HEAD'], wt), 'the push lands on origin/feat');
  assert.equal(git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], wt), 'origin/feat', 'upstream follows the branch');
});

test('L1: the base branch itself is never pushed, even when opened as a workspace', async () => {
  const { project, remote } = makeProject();
  git(['branch', 'release', 'origin/main'], project);
  const created = await workspaceManager.create(project, { from: 'branch', branch: 'release' });
  assert.equal(created.error, null, created.error);
  // Simulate a record whose base is its own branch (the base opened as a workspace).
  const records = projectRegistry.getWorkspaceRecords(project).map((r) => (r.id === created.workspace.id ? { ...r, base: 'release' } : r));
  projectRegistry.setWorkspaceRecords(project, records);
  const before = remoteSha(remote, 'release');
  const res = await workspaceGitState.push(project, created.workspace.id);
  assert.match(String(res.error), /base branch/);
  assert.equal(remoteSha(remote, 'release'), before);
});

// ─── L2: rename takes no option text ─────────────────────────

test('L2: renaming a branch to option text is refused and no branch changes', async () => {
  const { project } = makeProject();
  const created = await workspaceManager.create(project, { from: 'new', base: 'main' });
  assert.equal(created.error, null, created.error);
  await workspaceManager.archive(project, created.workspace.id, {});
  const branchesBefore = git(['branch', '--format=%(refname:short)'], project);
  const res = await workspaceManager.rename(project, created.workspace.id, { branch: '-f' });
  assert.ok(res.error, 'refused');
  assert.equal(git(['branch', '--format=%(refname:short)'], project), branchesBefore, 'main and the workspace branch are untouched');
  assert.equal(git(['symbolic-ref', '--short', 'HEAD'], project), 'main');
});

// ─── X1: create takes no option text ─────────────────────────

test('X1: a base or branch that is option text never reaches git', async () => {
  const { project } = makeProject();
  const marker = path.join(SANDBOX, 'pwned-x1');
  const viaBase = await workspaceManager.create(project, { from: 'new', base: `--upload-pack=touch ${marker}; git-upload-pack` });
  assert.ok(viaBase.error, 'refused');
  const viaBranch = await workspaceManager.create(project, { from: 'branch', branch: `--upload-pack=touch ${marker}` });
  assert.ok(viaBranch.error, 'refused');
  assert.equal(fs.existsSync(marker), false, 'no command ran');
  assert.equal(projectRegistry.getWorkspaceRecords(project).length, 0, 'nothing was recorded');
});

// ─── L13d: review merge base is a commit, never an option ─────

test('L13d: the review diff refuses a merge base that is not a commit id', async () => {
  const { project } = makeProject();
  const out = path.join(SANDBOX, 'pwned-l13d');
  const res = await gitDiffManager.reviewFileDiff(project, { mergeBase: `--output=${out}`, path: 'README.md' });
  assert.ok(res.error, 'refused');
  assert.equal(fs.existsSync(out), false, 'git wrote no file');
  const files = await gitDiffManager.reviewFiles(project, '--upload-pack=x');
  assert.ok(files.error, 'an option as base is refused');
});

// ─── L3 / L5 / L11: archive never loses commits ──────────────

/** A workspace whose worktree has one commit on a detached HEAD that no branch holds. */
async function detachedWithCommit() {
  const { project, remote } = makeProject();
  const created = await workspaceManager.create(project, { from: 'new', base: 'main' });
  assert.equal(created.error, null, created.error);
  const wt = created.workspace.path;
  gitWrite(['checkout', '-q', '--detach'], wt);
  fs.writeFileSync(path.join(wt, 'lost.txt'), 'only here\n');
  gitWrite(['add', '.'], wt);
  gitWrite(['commit', '-qm', 'detached work'], wt);
  return { project, remote, ws: created.workspace, wt, sha: git(['rev-parse', 'HEAD'], wt) };
}

test('L3: archive refuses to drop commits on a detached HEAD and status reports them', async () => {
  const { project, ws, wt, sha } = await detachedWithCommit();
  const st = await workspaceManager.status(project, ws.id);
  assert.equal(st.head.detached, true);
  assert.equal(st.head.unreachable, 1);
  const res = await workspaceManager.archive(project, ws.id, {});
  assert.ok(res.headOff, 'archive stops and reports the commits');
  assert.equal(res.headOff.unreachable, 1);
  assert.equal(fs.existsSync(wt), true, 'the worktree is still there');
  assert.equal(git(['cat-file', '-t', sha], project), 'commit');
});

test('L3: archive with rescue keeps the commits on a rescue branch, then removes the worktree', async () => {
  const { project, ws, wt, sha } = await detachedWithCommit();
  const res = await workspaceManager.archive(project, ws.id, { rescue: true });
  assert.equal(res.error, null, res.error);
  const rescue = `${ws.branch}-rescue-${sha.slice(0, 7)}`;
  assert.equal(git(['rev-parse', `refs/heads/${rescue}`], project), sha, 'the rescue branch holds the commit');
  assert.equal(fs.existsSync(wt), false, 'the worktree is gone');
  assert.ok(projectRegistry.getWorkspaceRecords(project).find((r) => r.id === ws.id).archivedAt);
});

test('L3: archive after merge does not remove a worktree with unreachable commits', async () => {
  const { project, ws, wt } = await detachedWithCommit();
  const pr = { number: 7, url: 'https://example/pr/7', state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: '', statusCheckRollup: [], comments: [], headRefName: ws.branch, baseRefName: 'main' };
  let merged = false;
  const res = await withGh(async (args) => {
    if (args[0] === 'pr' && args[1] === 'view') return { ok: true, stdout: JSON.stringify(merged ? { ...pr, state: 'MERGED' } : pr) };
    if (args[0] === 'repo') return { ok: true, stdout: JSON.stringify({ squashMergeAllowed: true, mergeCommitAllowed: true, rebaseMergeAllowed: true }) };
    if (args[0] === 'pr' && args[1] === 'merge') { merged = true; return { ok: true, stdout: '' }; }
    return { ok: false, error: 'unexpected', stdout: '' };
  }, () => workspaceGitState.merge(project, ws.id));
  assert.equal(res.error, null, res.error);
  assert.equal(res.archived, false);
  assert.match(String(res.archiveNote), /not on any branch/);
  assert.equal(fs.existsSync(wt), true, 'the worktree is kept');
});

test('L5: an archive and a create on the same project never overwrite each other', async () => {
  const { project } = makeProject();
  const first = await workspaceManager.create(project, { from: 'new', base: 'main' });
  assert.equal(first.error, null, first.error);
  const handlers = {};
  workspaceManager.setupIPC({ handle: (ch, fn) => { handlers[ch] = fn; }, on() {}, removeHandler() {} });
  const { IPC } = require('../src/shared/ipcChannels');
  const [created, archived] = await Promise.all([
    handlers[IPC.WORKSPACE_CREATE]({}, { projectPath: project, from: 'new', base: 'main' }),
    workspaceManager.archiveQueued(project, first.workspace.id, {})
  ]);
  assert.equal(created.error, null, created.error);
  assert.equal(archived.error, null, archived.error);
  const recs = projectRegistry.getWorkspaceRecords(project);
  assert.ok(recs.find((r) => r.id === first.workspace.id).archivedAt, 'the archive stuck');
  assert.ok(recs.find((r) => r.id === created.workspace.id && !r.archivedAt), 'the new workspace is recorded');
});

test('L11: archive commit and discard get a timeout long enough for hooks', () => {
  const git = require('../src/main/gitBranchesManager');
  assert.ok(git.ARCHIVE_TIMEOUT_MS >= 60000);
});
