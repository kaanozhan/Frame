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

const GITHUB_STUB = {
  checkAccess: async () => ({ gh: false, authed: false, repoName: null }),
  runGh: async () => ({ ok: false, error: 'gh is stubbed in tests', stdout: '' })
};
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
