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
function makeProject({ defaultBranch = 'main' } = {}) {
  const dir = path.join(SANDBOX, `p${++projectSeq}`);
  fs.mkdirSync(dir, { recursive: true });
  const remote = path.join(dir, 'origin.git');
  const seed = path.join(dir, 'seed');
  git(['init', '-q', '--bare', '-b', defaultBranch, remote], dir);
  git(['init', '-q', '-b', defaultBranch, seed], dir);
  fs.writeFileSync(path.join(seed, 'README.md'), 'hello\n');
  git(['add', '.'], seed);
  git(['commit', '-qm', 'init'], seed);
  git(['push', '-q', remote, defaultBranch], seed);
  const project = path.join(dir, 'project');
  git(['clone', '-q', remote, project], dir);
  projectRegistry.addProject(project, path.basename(dir), false);
  return { project, remote };
}

/**
 * A test's own mutating git command inside a worktree. Every workspace
 * mutation starts a background git-state read (workspaceManager.notify →
 * workspaceGitState.refresh); those reads run with --no-optional-locks, so
 * they never hold index.lock and the test's `git add` needs no retry — a
 * collision here is a regression.
 */
function gitWrite(args, cwd) {
  return git(args, cwd);
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

test('L13b: a merge that GitHub only queued is reported as queued, with no archive', async () => {
  const { project } = makeProject();
  const created = await workspaceManager.create(project, { from: 'new', base: 'main' });
  assert.equal(created.error, null, created.error);
  const ws = created.workspace;
  const pr = { number: 9, url: 'https://example/pr/9', state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: '', statusCheckRollup: [], comments: [], headRefName: ws.branch, baseRefName: 'main' };
  const res = await withGh(async (args) => {
    if (args[0] === 'pr' && args[1] === 'view') return { ok: true, stdout: JSON.stringify(pr) };
    if (args[0] === 'repo') return { ok: true, stdout: JSON.stringify({ squashMergeAllowed: true }) };
    if (args[0] === 'pr' && args[1] === 'merge') return { ok: true, stdout: '' };
    return { ok: false, error: 'unexpected', stdout: '' };
  }, () => workspaceGitState.merge(project, ws.id));
  assert.equal(res.error, null, res.error);
  assert.equal(res.queued, true);
  assert.equal(res.archived, false);
  assert.equal(res.fastForward, null, 'no fast-forward for a merge that has not happened');
  assert.equal(fs.existsSync(ws.path), true);
});

// ─── L8 / L13a / L14: guards fail closed ─────────────────────

test('L8: update from base refuses when the dirty check cannot run', async () => {
  const { project } = makeProject();
  const created = await workspaceManager.create(project, { from: 'new', base: 'main' });
  assert.equal(created.error, null, created.error);
  const wt = created.workspace.path;
  const gitBranches = require('../src/main/gitBranchesManager');
  // Break the worktree's link to its repository: every git command in it fails.
  const dotGit = path.join(wt, '.git');
  const link = fs.readFileSync(dotGit, 'utf8');
  fs.writeFileSync(dotGit, 'gitdir: /nonexistent/frame-test\n');
  try {
    const dirty = await gitBranches.trackedDirtyCount(wt);
    assert.ok(dirty.error, 'the failed check reports an error, not 0');
    const res = await workspaceGitState.updateFromBase(project, created.workspace.id);
    assert.ok(res.error, 'update refuses');
    assert.match(res.error, /uncommitted/);
  } finally {
    fs.writeFileSync(dotGit, link);
  }
});

test('L13a: Abort Update leaves a merge the user started alone', async () => {
  const { project } = makeProject();
  const created = await workspaceManager.create(project, { from: 'new', base: 'main' });
  assert.equal(created.error, null, created.error);
  const wt = created.workspace.path;
  // A side branch that conflicts with the workspace, merged by hand.
  gitWrite(['checkout', '-qb', 'side'], wt);
  fs.writeFileSync(path.join(wt, 'c.txt'), 'side\n');
  gitWrite(['add', '.'], wt); gitWrite(['commit', '-qm', 'side'], wt);
  gitWrite(['checkout', '-q', created.workspace.branch], wt);
  fs.writeFileSync(path.join(wt, 'c.txt'), 'mine\n');
  gitWrite(['add', '.'], wt); gitWrite(['commit', '-qm', 'mine'], wt);
  try { git(['merge', 'side'], wt); } catch (_) { /* conflict expected */ }
  assert.ok(git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], wt));
  const { parseConflicts } = require('../src/shared/prFlow');
  assert.deepEqual(parseConflicts(await require('../src/main/gitBranchesManager').conflictedFiles(wt)), ['c.txt'], 'conflicts are listed');
  const res = await workspaceGitState.abortUpdate(project, created.workspace.id);
  assert.ok(res.error, 'refused with a reason');
  assert.equal(res.aborted, false);
  assert.ok(git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], wt), 'the user\'s merge is still there');
});

test('L14: a missing workspace folder does not switch the review diff off', async () => {
  const { project } = makeProject();
  const gitDiff = require('../src/main/gitDiffManager');
  const gone = path.join(os.tmpdir(), `frame-gone-${Date.now()}`);
  await gitDiff.reviewFiles(gone, 'main');
  fs.writeFileSync(path.join(project, 'new.txt'), 'x\n');
  const res = await gitDiff.reviewFiles(project, 'main');
  assert.equal(res.error, null, res.error);
  assert.ok(res.files.some((f) => f.path === 'new.txt'), 'git still runs after the missing folder');
});

// ─── L4 / L12: a workspace knows its base ────────────────────

test('L4: a workspace opened from a branch cut from develop records develop as its base', async () => {
  const { project } = makeProject();
  git(['checkout', '-qb', 'develop'], project);
  git(['push', '-q', '-u', 'origin', 'develop'], project);
  git(['checkout', '-q', '--track', '-b', 'feat/x', 'origin/develop'], project);
  git(['checkout', '-q', 'main'], project);
  const suggested = await workspaceManager.baseForBranch(project, 'feat/x');
  assert.equal(suggested.base, 'develop', 'prefilled from the upstream');
  const created = await workspaceManager.create(project, { from: 'branch', branch: 'feat/x', base: suggested.base });
  assert.equal(created.error, null, created.error);
  assert.equal(created.workspace.base, 'develop');
  const noBase = await workspaceManager.create(project, { from: 'branch', branch: 'develop' });
  assert.equal(noBase.error, null, noBase.error);
  assert.equal(noBase.workspace.base, 'main', 'without a base the default branch is stored, not null');
});

test('L4: a stored base of null resolves to the remote default branch in a master repository', async () => {
  const { project } = makeProject({ defaultBranch: 'master' });
  git(['branch', 'feat/old', 'origin/master'], project);
  const created = await workspaceManager.create(project, { from: 'branch', branch: 'feat/old' });
  assert.equal(created.error, null, created.error);
  // An older record: base null.
  const recs = projectRegistry.getWorkspaceRecords(project).map((r) => (r.id === created.workspace.id ? { ...r, base: null } : r));
  projectRegistry.setWorkspaceRecords(project, recs);
  const listed = await workspaceManager.list(project);
  assert.equal(listed.workspaces.find((w) => w.id === created.workspace.id).base, 'master');
  const res = await workspaceGitState.updateFromBase(project, created.workspace.id);
  assert.equal(res.error, undefined, res.error);
  assert.equal(res.base, 'master');
  assert.equal(res.state, 'up-to-date');
});

test('L12: a pushed branch cannot be renamed; an unpushed one can', async () => {
  const { project } = makeProject();
  const a = await workspaceManager.create(project, { from: 'new', base: 'main' });
  const b = await workspaceManager.create(project, { from: 'new', base: 'main' });
  assert.equal(a.error, null, a.error);
  git(['push', '-q', '-u', 'origin', a.workspace.branch], a.workspace.path);
  const refused = await workspaceManager.rename(project, a.workspace.id, { branch: 'feat/renamed-a' });
  assert.match(String(refused.error), /pushed/);
  assert.equal(git(['rev-parse', '--verify', '-q', `refs/heads/${a.workspace.branch}`], project).length > 0, true);
  const ok = await workspaceManager.rename(project, b.workspace.id, { branch: 'feat/renamed-b' });
  assert.equal(ok.error, null, ok.error);
  assert.ok(git(['rev-parse', '--verify', '-q', 'refs/heads/feat/renamed-b'], project));
});

// ─── L6 / L7 / L9 / L10 / L13c / L13e: registry and filesystem edges ──

test('L6: removing and re-adding a project keeps its workspace records', async () => {
  const { project } = makeProject();
  const created = await workspaceManager.create(project, { from: 'new', base: 'main' });
  assert.equal(created.error, null, created.error);
  projectRegistry.removeProject(project);
  assert.deepEqual(projectRegistry.getWorkspaceRecords(project), []);
  projectRegistry.addProject(project, 'again', false);
  const back = projectRegistry.getWorkspaceRecords(project);
  assert.ok(back.find((r) => r.id === created.workspace.id), 'the record came back');
  const listed = await workspaceManager.list(project);
  assert.ok(listed.workspaces.find((w) => w.id === created.workspace.id && !w.missing));
});

test('L7: a symlinked workspaces root does not mark workspaces missing', async () => {
  const { project } = makeProject();
  const userSettings = require('../src/main/userSettings');
  const real = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-wsroot-'));
  const link = path.join(SANDBOX, `wslink-${Date.now()}`);
  fs.symlinkSync(real, link);
  const before = userSettings.get('workspacesRoot');
  userSettings.set('workspacesRoot', link);
  try {
    const created = await workspaceManager.create(project, { from: 'new', base: 'main' });
    assert.equal(created.error, null, created.error);
    const listed = await workspaceManager.list(project);
    const row = listed.workspaces.find((w) => w.id === created.workspace.id);
    assert.ok(row, 'listed');
    assert.ok(!row.missing, 'not missing');
  } finally {
    userSettings.set('workspacesRoot', before);
  }
});

test('L9 / L10: copied symlinks stay as written and certs/** copies an ignored folder', async () => {
  const { project } = makeProject();
  fs.writeFileSync(path.join(project, '.gitignore'), '.env*\ncerts/\n');
  git(['add', '.gitignore'], project); git(['commit', '-qm', 'ignore'], project);
  fs.mkdirSync(path.join(project, 'certs'));
  fs.writeFileSync(path.join(project, 'certs', 'dev.pem'), 'pem\n');
  fs.writeFileSync(path.join(project, '.env.shared'), 'A=1\n');
  fs.symlinkSync('.env.shared', path.join(project, '.env'));
  const frameProject = require('../src/main/frameProject');
  const orig = frameProject.getWorkspaceSettings;
  frameProject.getWorkspaceSettings = () => ({ ...orig(project), copyFiles: ['.env*', 'certs/**'] });
  try {
    const created = await workspaceManager.create(project, { from: 'new', base: 'main' });
    assert.equal(created.error, null, created.error);
    const wt = created.workspace.path;
    assert.equal(fs.readlinkSync(path.join(wt, '.env')), '.env.shared', 'the relative link is kept, not pointed back into main');
    assert.equal(fs.readFileSync(path.join(wt, 'certs', 'dev.pem'), 'utf8'), 'pem\n');
  } finally {
    frameProject.getWorkspaceSettings = orig;
  }
});

test('L10: an anchored pattern inside a fully ignored folder copies just the matching files', async () => {
  const { project } = makeProject();
  fs.writeFileSync(path.join(project, '.gitignore'), 'secrets/\n');
  git(['add', '.gitignore'], project); git(['commit', '-qm', 'ignore'], project);
  fs.mkdirSync(path.join(project, 'secrets'));
  fs.writeFileSync(path.join(project, 'secrets', 'a.key'), 'k\n');
  fs.writeFileSync(path.join(project, 'secrets', 'big.bin'), 'b\n');
  const frameProject = require('../src/main/frameProject');
  const orig = frameProject.getWorkspaceSettings;
  frameProject.getWorkspaceSettings = () => ({ ...orig(project), copyFiles: ['secrets/*.key'] });
  try {
    const created = await workspaceManager.create(project, { from: 'new', base: 'main' });
    assert.equal(created.error, null, created.error);
    const wt = created.workspace.path;
    assert.equal(fs.existsSync(path.join(wt, 'secrets', 'a.key')), true);
    assert.equal(fs.existsSync(path.join(wt, 'secrets', 'big.bin')), false);
  } finally {
    frameProject.getWorkspaceSettings = orig;
  }
});

test('L13c: a create that fails after making its branch removes that branch', async () => {
  const { project } = makeProject();
  projectRegistry.removeProject(project); // persist will fail: not registered
  const res = await workspaceManager.create(project, { from: 'new', base: 'main' });
  assert.ok(res.error, 'create failed');
  const left = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], project).split('\n').filter((b) => b && b !== 'main');
  assert.deepEqual(left, [], 'no half-created branch is left');
});

test('L13e: spec locations of a project that is not watched follow its workspaces', async () => {
  const { project } = makeProject();
  const specManager = require('../src/main/specManager');
  const a = await workspaceManager.create(project, { from: 'new', base: 'main' });
  assert.equal(specManager.specRoot(project, 'later'), project, 'unknown slug → main (now cached)');
  fs.mkdirSync(path.join(a.workspace.path, '.frame', 'specs', 'later'), { recursive: true });
  await workspaceManager.create(project, { from: 'new', base: 'main' }); // any workspace change
  assert.equal(specManager.specRoot(project, 'later'), a.workspace.path);
});

// ─── Background reads never take the index lock (follow-up of T01) ──

test('status and diff reads leave .git/index alone (--no-optional-locks)', async () => {
  const { project } = makeProject();
  const gitBranches = require('../src/main/gitBranchesManager');
  const gitDiff = require('../src/main/gitDiffManager');
  const gitStatus = require('../src/main/gitStatusManager');
  const index = path.join(project, '.git', 'index');
  // Stat-dirty but content-identical: a plain `git status` would refresh
  // and rewrite the index (taking index.lock) here.
  const stale = () => {
    const f = path.join(project, 'README.md');
    const t = new Date(Date.now() + 5000);
    fs.utimesSync(f, t, t);
    fs.utimesSync(index, new Date(0), new Date(0));
    return fs.statSync(index).mtimeMs;
  };
  let before = stale();
  await gitBranches.worktreeStatus(project);
  await gitBranches.trackedDirtyCount(project);
  assert.equal(fs.statSync(index).mtimeMs, before, 'worktreeStatus / trackedDirtyCount did not rewrite the index');
  before = stale();
  await gitStatus.readGitStatus(project);
  assert.equal(fs.statSync(index).mtimeMs, before, 'the file-tree status did not rewrite the index');
  before = stale();
  await gitBranches.conflictedFiles(project);
  assert.equal(fs.statSync(index).mtimeMs, before, 'the conflict listing did not rewrite the index');
  // Known limit: `git diff` (the review) refreshes the index even with
  // --no-optional-locks on git 2.39; it runs when a review loads, not in the
  // background poll. Not asserted here.
  void gitDiff;
});

// ─── server-onboarding T03: push and PR need a remote ────────

test('push and pull requests of a project without a remote say a remote is needed', async () => {
  const { project } = makeProject();
  const created = await workspaceManager.create(project, { from: 'new', base: 'main' });
  assert.equal(created.error, null, created.error);
  git(['remote', 'remove', 'origin'], project);
  const pushed = await workspaceGitState.push(project, created.workspace.id);
  assert.match(String(pushed.error), /no remote — add one/);
  const draft = await workspaceGitState.prDraft(project, created.workspace.id);
  assert.match(String(draft.error), /no remote — add one/);
  const pr = await workspaceGitState.prCreate(project, created.workspace.id, { title: 'x' });
  assert.match(String(pr.error), /no remote — add one/);
});
