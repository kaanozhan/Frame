/**
 * Git Branches Manager Module
 * Handles git branch and worktree operations
 */

const { exec, execFile } = require('child_process');
const logger = require('./logger');
const fs = require('fs');
const path = require('path');
const { IPC } = require('../shared/ipcChannels');
const { FRAME_DIR, ORCH_WORKTREES_DIR, orchWorkBranch, orchIntegrationBranch } = require('../shared/frameConstants');
const { BRANCH_FORMAT, parseBranchLine, splitRemoteRef } = require('./gitBranchRefs');
const { isValidBranchName } = require('../shared/gitRefNames');
const { isGitMissing } = require('../shared/gitMissing');

let mainWindow = null;

/**
 * Initialize manager
 */
function init(window) {
  mainWindow = window;
}

// Set on the first "command not found" from the shell: without git every
// call would fail identically, so reject fast with a clear reason instead
// of spawning a doomed shell each time.
let gitMissing = false;
const GIT_MISSING_ERROR = 'git is not installed or not on PATH';

/**
 * Execute git command with promise
 */
function execGit(command, projectPath) {
  if (gitMissing) {
    return Promise.reject({ error: GIT_MISSING_ERROR, gitMissing: true });
  }
  return new Promise((resolve, reject) => {
    exec(command, { cwd: projectPath, timeout: 10000 }, (error, stdout, stderr) => {
      if (error) {
        // exit 127 = shell couldn't find the binary
        if (error.code === 127 || /command not found|not recognized/i.test(stderr || error.message)) {
          if (!gitMissing) {
            gitMissing = true;
            logger.warn('gitBranches', 'git executable not found — branch/worktree operations disabled');
          }
          reject({ error: GIT_MISSING_ERROR, gitMissing: true });
          return;
        }
        reject({ error: error.message, stderr });
      } else {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      }
    });
  });
}

/**
 * Execute git with an argv array — no shell, so a branch name is one
 * argument whatever it contains. The calls this spec touches (switch and
 * create) go through here; the others keep execGit's string form for now
 * (status-bar-branch-picker spec, D7). Rejects with git's own stderr as
 * `error` when there is one, so a refusal such as "already checked out at
 * …" reaches the UI verbatim. `opts` sets execFile's `timeout` and
 * `maxBuffer` (a larger one for a file read through git).
 */
// `git status` and `git diff` refresh the index's stat cache, which takes
// index.lock: a read Frame runs in the background could then make an agent's
// own `git add` / `git commit` fail with "index.lock exists". Reads skip that
// optional write (the same as GIT_OPTIONAL_LOCKS=0).
const OPTIONAL_LOCK_READS = new Set(['status', 'diff']);

function execGitArgs(args, projectPath, opts = {}) {
  if (gitMissing) {
    return Promise.reject({ error: GIT_MISSING_ERROR, gitMissing: true });
  }
  if (OPTIONAL_LOCK_READS.has(args[0])) args = ['--no-optional-locks', ...args];
  const timeout = opts.timeout || 10000;
  const maxBuffer = opts.maxBuffer || 1024 * 1024;
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: projectPath, timeout, maxBuffer }, (error, stdout, stderr) => {
      if (error) {
        // spawn reports a missing working directory as ENOENT too (a
        // workspace folder removed by archive): that is not "git missing",
        // and must not switch git off for the rest of the session.
        if (error.code === 'ENOENT' && !isGitMissing(error, projectPath)) {
          reject({ error: `Folder not found: ${projectPath}` });
          return;
        }
        if (isGitMissing(error, projectPath)) {
          if (!gitMissing) {
            gitMissing = true;
            logger.warn('gitBranches', 'git executable not found — branch/worktree operations disabled');
          }
          reject({ error: GIT_MISSING_ERROR, gitMissing: true });
          return;
        }
        const detail = (stderr || '').trim();
        // A killed child (timeout) has no useful stderr; say so plainly.
        const timedOut = error.killed && error.signal === 'SIGTERM';
        reject({ error: detail || (timedOut ? `git ${args[args[0] === '--no-optional-locks' ? 1 : 0]} timed out` : error.message), stderr: detail, timedOut });
      } else {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      }
    });
  });
}

/** Does `refs/heads/<name>` exist in this repo? */
async function localBranchExists(name, projectPath) {
  try {
    await execGitArgs(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], projectPath);
    return true;
  } catch (_) {
    return false;
  }
}

/** Does `refs/remotes/origin/<name>` exist in this repo? Nothing is fetched: it is what this machine has. */
async function remoteBranchExists(name, projectPath) {
  try {
    await execGitArgs(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${name}`], projectPath);
    return true;
  } catch (_) {
    return false;
  }
}

/** The checked-out branch's name, or '' when HEAD is detached or git fails. */
async function currentBranch(projectPath) {
  try {
    const { stdout } = await execGitArgs(['rev-parse', '--abbrev-ref', 'HEAD'], projectPath);
    return stdout === 'HEAD' ? '' : stdout;
  } catch (_) {
    return '';
  }
}

/**
 * Stash every change, untracked files included (`git stash push -u -m`), so
 * what `git status --porcelain` listed is what gets stashed. Ignored files
 * stay. → `{ error: null }` or `{ error }`.
 */
async function stashAll(projectPath, message) {
  try {
    await execGitArgs(['stash', 'push', '-u', '-m', message], projectPath);
    return { error: null };
  } catch (err) {
    return { error: err.error || err.message };
  }
}

/**
 * Check if working tree is clean
 */
async function isWorkingTreeClean(projectPath) {
  try {
    const { stdout } = await execGit('git --no-optional-locks status --porcelain', projectPath);
    return { clean: stdout === '', changes: stdout.split('\n').filter(Boolean) };
  } catch (err) {
    return { clean: false, error: err.error };
  }
}

/**
 * Load all branches
 */
async function loadBranches(projectPath) {
  if (!projectPath) {
    return { error: 'No project selected', branches: [] };
  }

  try {
    // Check if it's a git repo
    await execGit('git rev-parse --is-inside-work-tree', projectPath);

    // Get current branch
    const { stdout: currentBranch } = await execGit('git branch --show-current', projectPath);

    // Get all branches with details
    // The full refname rides along so the remote HEAD pointer can be
    // dropped reliably: `refs/remotes/origin/HEAD` shortens to plain
    // "origin", which used to slip through the old `includes('HEAD')`
    // filter and list as a local branch (github-view-tree-layout spec).
    // The format (six fields, unix committer time as the fifth) and its
    // parser live together in gitBranchRefs so they cannot drift apart
    // (status-bar-branch-picker spec).
    const { stdout: branchOutput } = await execGit(
      `git branch -a --format="${BRANCH_FORMAT}"`,
      projectPath
    );

    // The remote list lets a `<remote>/<name>` ref be split against the
    // remotes that actually exist — `origin/feat/x` and `a/b/feat` both
    // resolve — so the picker can hide a remote branch that already has
    // a local twin, and switchBranch can track any remote, not just origin.
    const { stdout: remoteOutput } = await execGit('git remote', projectPath);
    const remotes = remoteOutput.split('\n').map((r) => r.trim()).filter(Boolean);

    const branches = branchOutput.split('\n')
      .map(parseBranchLine)
      .filter(Boolean)
      // Filter out the remote HEAD pointer (refs/remotes/<remote>/HEAD)
      .filter(b => !b.refname.endsWith('/HEAD'))
      .map(({ refname, ...b }) => {
        const row = { ...b, isCurrent: b.name === currentBranch };
        if (b.isRemote) {
          const split = splitRemoteRef(b.name, remotes);
          if (split) {
            row.remote = split.remote;
            row.shortName = split.shortName;
          }
        }
        return row;
      });

    return { error: null, currentBranch, remotes, branches };
  } catch (err) {
    return { error: err.error || 'Not a git repository', branches: [] };
  }
}

/**
 * Switch to a branch
 */
async function switchBranch(projectPath, branchName) {
  if (!projectPath || !branchName) {
    return { error: 'Missing parameters' };
  }

  // Check for uncommitted changes
  const status = await isWorkingTreeClean(projectPath);
  if (!status.clean && !status.error) {
    return {
      error: 'uncommitted_changes',
      message: 'You have uncommitted changes',
      changes: status.changes
    };
  }

  try {
    // A local branch of that exact name wins, even one literally called
    // "origin/x". Otherwise the name is a remote-tracking ref: split it
    // against the remotes that actually exist (any remote, not only
    // origin) and create the local tracking branch — or check out the
    // local twin if it already exists (status-bar-branch-picker spec, D6).
    if (await localBranchExists(branchName, projectPath)) {
      await execGitArgs(['checkout', branchName], projectPath);
    } else {
      const { stdout: remoteOutput } = await execGitArgs(['remote'], projectPath);
      const remotes = remoteOutput.split('\n').map((r) => r.trim()).filter(Boolean);
      const split = splitRemoteRef(branchName, remotes);
      if (!split) {
        // Not local, not under a known remote: let git say what it is.
        await execGitArgs(['checkout', branchName], projectPath);
      } else if (await localBranchExists(split.shortName, projectPath)) {
        await execGitArgs(['checkout', split.shortName], projectPath);
      } else {
        await execGitArgs(
          ['checkout', '-b', split.shortName, '--track', `${split.remote}/${split.shortName}`],
          projectPath
        );
      }
    }

    // Read back where git actually landed rather than assuming it.
    const { stdout: branch } = await execGitArgs(['branch', '--show-current'], projectPath);
    return { error: null, branch: branch || branchName };
  } catch (err) {
    return { error: err.error || err.message };
  }
}

/**
 * Create a new branch. `{ track: false }` cuts it with `--no-track`, so a
 * branch made from a remote base does not track that base.
 */
async function createBranch(projectPath, branchName, checkout = true, baseBranch = null, { track } = {}) {
  if (!projectPath || !branchName) {
    return { error: 'Missing parameters' };
  }
  // The same predicate the picker's create row runs on every keystroke;
  // here it is the last line before git, for every caller.
  if (!isValidBranchName(branchName)) {
    return { error: `Invalid branch name: ${branchName}` };
  }

  try {
    const args = checkout ? ['checkout'] : ['branch'];
    if (track === false) args.push('--no-track');
    if (checkout) args.push('-b');
    args.push(branchName);
    if (baseBranch) args.push(baseBranch);
    await execGitArgs(args, projectPath);
    return { error: null, branch: branchName };
  } catch (err) {
    return { error: err.error || err.message };
  }
}

/**
 * Delete a branch
 */
async function deleteBranch(projectPath, branchName, force = false) {
  if (!projectPath || !branchName) {
    return { error: 'Missing parameters' };
  }

  try {
    const flag = force ? '-D' : '-d';
    await execGit(`git branch ${flag} "${branchName}"`, projectPath);
    return { error: null, branch: branchName };
  } catch (err) {
    return { error: err.error || err.message };
  }
}

/**
 * Load worktrees
 */
async function loadWorktrees(projectPath) {
  if (!projectPath) {
    return { error: 'No project selected', worktrees: [] };
  }

  try {
    const { stdout } = await execGit('git worktree list --porcelain', projectPath);

    const worktrees = [];
    let current = {};

    stdout.split('\n').forEach(line => {
      if (line.startsWith('worktree ')) {
        if (current.path) worktrees.push(current);
        current = { path: line.substring(9) };
      } else if (line.startsWith('HEAD ')) {
        current.head = line.substring(5);
      } else if (line.startsWith('branch ')) {
        current.branch = line.substring(7).replace('refs/heads/', '');
      } else if (line === 'bare') {
        current.bare = true;
      } else if (line === 'detached') {
        current.detached = true;
      }
    });

    if (current.path) worktrees.push(current);

    // Mark main worktree
    if (worktrees.length > 0) {
      worktrees[0].isMain = true;
    }

    return { error: null, worktrees };
  } catch (err) {
    return { error: err.error || err.message, worktrees: [] };
  }
}

/**
 * Add a worktree
 */
async function addWorktree(projectPath, worktreePath, branchName, createBranch = false) {
  if (!projectPath || !worktreePath || !branchName) {
    return { error: 'Missing parameters' };
  }

  try {
    const cmd = createBranch
      ? `git worktree add -b "${branchName}" "${worktreePath}"`
      : `git worktree add "${worktreePath}" "${branchName}"`;
    await execGit(cmd, projectPath);
    return { error: null, path: worktreePath, branch: branchName };
  } catch (err) {
    return { error: err.error || err.message };
  }
}

/**
 * Remove a worktree
 */
async function removeWorktree(projectPath, worktreePath, force = false) {
  if (!projectPath || !worktreePath) {
    return { error: 'Missing parameters' };
  }

  try {
    const cmd = force
      ? `git worktree remove --force "${worktreePath}"`
      : `git worktree remove "${worktreePath}"`;
    await execGit(cmd, projectPath);
    return { error: null, path: worktreePath };
  } catch (err) {
    return { error: err.error || err.message };
  }
}

// ─── Workspace helpers (workspaces spec) ──────────────────
//
// A workspace is a branch + a linked worktree outside the repo. Everything
// here goes through execGitArgs (argv, no shell) — branch names and paths are
// single arguments whatever they contain. The string-built addWorktree /
// removeWorktree above stay for the GitHub panel and orchestration.

const FETCH_TIMEOUT_MS = 15000;
const WORKTREE_ADD_TIMEOUT_MS = 120000; // checking out a large repo takes time
const LIST_MAX_BUFFER = 16 * 1024 * 1024;

async function hasRemote(projectPath, remote = 'origin') {
  try {
    const { stdout } = await execGitArgs(['remote'], projectPath);
    return stdout.split('\n').map((l) => l.trim()).includes(remote);
  } catch (_) {
    return false;
  }
}

async function refExists(ref, projectPath) {
  try {
    await execGitArgs(['rev-parse', '--verify', '--quiet', ref], projectPath);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * The branch a new workspace should start from by default.
 * With an `origin`: what `origin/HEAD` points at, else origin/main or
 * origin/master. Without one: the current branch, else main or master.
 * Returns `{ error, branch, hasOrigin }` — `branch` is a short name ("main").
 */
async function defaultRemoteBranch(projectPath) {
  if (!projectPath) return { error: 'No project selected', branch: null, hasOrigin: false };
  const hasOrigin = await hasRemote(projectPath);
  if (hasOrigin) {
    try {
      const { stdout } = await execGitArgs(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], projectPath);
      const short = stdout.trim();
      if (short.startsWith('origin/')) return { error: null, branch: short.slice('origin/'.length), hasOrigin };
    } catch (_) { /* origin/HEAD not set — fall through */ }
    for (const name of ['main', 'master']) {
      if (await refExists(`refs/remotes/origin/${name}`, projectPath)) return { error: null, branch: name, hasOrigin };
    }
  }
  try {
    const { stdout } = await execGitArgs(['symbolic-ref', '--quiet', '--short', 'HEAD'], projectPath);
    if (stdout.trim()) return { error: null, branch: stdout.trim(), hasOrigin };
  } catch (_) { /* detached HEAD */ }
  for (const name of ['main', 'master']) {
    if (await localBranchExists(name, projectPath)) return { error: null, branch: name, hasOrigin };
  }
  return { error: 'Could not determine a default branch', branch: null, hasOrigin };
}

/**
 * `git fetch origin <branch>` with a 15 s ceiling. Never throws: a failure
 * (offline, auth) comes back as `{ fetched: false, error }` so the caller can
 * fall back to the local `origin/<branch>` and tell the user.
 */
async function fetchBranch(projectPath, branch) {
  if (!projectPath || !branch) return { fetched: false, error: 'Missing parameters' };
  // Never hand option text to git fetch: `--upload-pack=<cmd>` runs a command (workspace-hardening X1).
  if (!isValidBranchName(branch)) return { fetched: false, error: `"${branch}" is not a valid branch name.` };
  try {
    await execGitArgs(['fetch', 'origin', branch], projectPath, { timeout: FETCH_TIMEOUT_MS });
    return { fetched: true, error: null };
  } catch (err) {
    return { fetched: false, error: err.error || err.message };
  }
}

/**
 * Create a workspace worktree.
 *   createBranch: true  → `git worktree add --no-track -b <branch> <path> <startPoint>`
 *   createBranch: false → `git worktree add <path> <branch>` (git's own DWIM
 *                          creates a tracking branch for a remote-only name)
 * `--no-track` keeps a new branch from adopting its start point
 * (`origin/main`) as upstream, so a later push can never target main.
 */
async function addWorkspaceWorktree(projectPath, worktreePath, { branch, createBranch, startPoint } = {}) {
  if (!projectPath || !worktreePath || !branch) return { error: 'Missing parameters' };
  const args = createBranch
    ? ['worktree', 'add', '--no-track', '-b', branch, worktreePath, ...(startPoint ? [startPoint] : [])]
    : ['worktree', 'add', worktreePath, branch];
  try {
    await execGitArgs(args, projectPath, { timeout: WORKTREE_ADD_TIMEOUT_MS });
    return { error: null, path: worktreePath, branch };
  } catch (err) {
    return { error: err.error || err.message };
  }
}

/** `git worktree remove [--force] <path>`, argv form. */
async function removeWorkspaceWorktree(projectPath, worktreePath, force = false) {
  if (!projectPath || !worktreePath) return { error: 'Missing parameters' };
  const args = ['worktree', 'remove', ...(force ? ['--force'] : []), worktreePath];
  try {
    await execGitArgs(args, projectPath, { timeout: WORKTREE_ADD_TIMEOUT_MS });
    return { error: null, path: worktreePath };
  } catch (err) {
    return { error: err.error || err.message };
  }
}

/** Uncommitted state of a worktree: `{ error, dirty, count }` from `git status --porcelain`. */
async function worktreeStatus(worktreePath) {
  if (!worktreePath) return { error: 'Missing parameters', dirty: false, count: 0 };
  try {
    const { stdout } = await execGitArgs(['status', '--porcelain'], worktreePath, { maxBuffer: LIST_MAX_BUFFER });
    const lines = stdout ? stdout.split('\n').filter(Boolean) : [];
    return { error: null, dirty: lines.length > 0, count: lines.length };
  } catch (err) {
    return { error: err.error || err.message, dirty: false, count: 0 };
  }
}

/**
 * Archive's commit and discard run the user's hooks (pre-commit, lint) and
 * may touch many files: the 10 s default cuts them off half-way
 * (workspace-hardening L11).
 */
const ARCHIVE_TIMEOUT_MS = 120000;

/**
 * Where a worktree's HEAD stands: on `branch` or not, and how many commits
 * it holds that no branch, remote branch or tag reaches — the commits that
 * removing the worktree would lose (workspace-hardening L3).
 */
async function headState(worktreePath, branch) {
  if (!worktreePath) return { error: 'Missing parameters' };
  try {
    let onRef = null;
    try {
      const { stdout } = await execGitArgs(['symbolic-ref', '-q', '--short', 'HEAD'], worktreePath);
      onRef = stdout.trim() || null;
    } catch (_) { onRef = null; }
    const { stdout: sha } = await execGitArgs(['rev-parse', 'HEAD'], worktreePath);
    const { stdout: count } = await execGitArgs(['rev-list', '--count', 'HEAD', '--not', '--branches', '--remotes', '--tags'], worktreePath);
    return {
      error: null,
      detached: onRef === null,
      onBranch: !!branch && onRef === branch,
      ref: onRef,
      sha: sha.trim(),
      unreachable: parseInt(count.trim(), 10) || 0
    };
  } catch (err) {
    return { error: err.error || err.message };
  }
}

/** Stage everything and commit it with `message` (the archive dialog's "commit"). */
async function commitAll(worktreePath, message) {
  if (!worktreePath || !message) return { error: 'Missing parameters' };
  try {
    await execGitArgs(['add', '-A'], worktreePath, { timeout: ARCHIVE_TIMEOUT_MS });
    await execGitArgs(['commit', '-m', message], worktreePath, { timeout: ARCHIVE_TIMEOUT_MS });
    return { error: null };
  } catch (err) {
    return { error: err.error || err.message };
  }
}

/**
 * Throw away uncommitted work (the archive dialog's "discard"): tracked
 * changes reset, untracked files removed. Ignored files (copied `.env`,
 * `node_modules`) are left for `worktree remove --force` to take with the folder.
 */
async function discardAll(worktreePath) {
  if (!worktreePath) return { error: 'Missing parameters' };
  try {
    await execGitArgs(['reset', '--hard'], worktreePath, { timeout: ARCHIVE_TIMEOUT_MS });
    await execGitArgs(['clean', '-fd'], worktreePath, { timeout: ARCHIVE_TIMEOUT_MS });
    return { error: null };
  } catch (err) {
    return { error: err.error || err.message };
  }
}

/**
 * Ignored, untracked paths in the main checkout — the candidates `copyFiles`
 * patterns choose from. `--directory` collapses an ignored directory into one
 * `dir/` entry instead of listing every file under it (node_modules stays one
 * line). Returns `{ error, paths }` with repo-relative paths.
 */
async function listIgnoredCandidates(projectPath) {
  if (!projectPath) return { error: 'No project selected', paths: [] };
  try {
    const { stdout } = await execGitArgs(
      ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'],
      projectPath,
      { maxBuffer: LIST_MAX_BUFFER }
    );
    return { error: null, paths: stdout.split('\0').filter(Boolean) };
  } catch (err) {
    return { error: err.error || err.message, paths: [] };
  }
}

/**
 * The project's committed history as one file (server-onboarding): HEAD,
 * every local branch and tag — what a clone needs, nothing uncommitted.
 */
async function createBundle(projectPath, dest) {
  try {
    await execGitArgs(['bundle', 'create', '-q', dest, 'HEAD', '--branches', '--tags'], projectPath, { timeout: 10 * 60 * 1000 });
    return { error: null };
  } catch (err) {
    return { error: err.error || err.message };
  }
}

/** The project's root commit (the lowest-sorted parentless commit of HEAD), or null. */
async function rootCommit(projectPath) {
  try {
    const { stdout } = await execGitArgs(['rev-list', '--max-parents=0', 'HEAD'], projectPath);
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean).sort()[0] || null;
  } catch (_) {
    return null;
  }
}

/** Ignored, untracked files inside one collapsed ignored folder `dir` (copyFiles, L10). */
async function listIgnoredIn(projectPath, dir) {
  try {
    const { stdout } = await execGitArgs(
      ['ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', dir],
      projectPath,
      { maxBuffer: LIST_MAX_BUFFER }
    );
    return stdout.split('\0').filter(Boolean);
  } catch (_) {
    return [];
  }
}

// ─── PR flow helpers (workspace-pr-flow) ───────────────────
//
// Push, counts and the post-merge fast-forward. Argv only; nothing here
// ever passes --force, and pushBranch refuses to be called without a branch.

const PUSH_TIMEOUT_MS = 120000;

/** `git rev-list --count <range>` in `cwd`; 0 when the range does not resolve. */
async function revCount(cwd, range) {
  try {
    const { stdout } = await execGitArgs(['rev-list', '--count', range], cwd);
    const n = parseInt(stdout, 10);
    return Number.isFinite(n) ? n : 0;
  } catch (_) {
    return 0;
  }
}

/** The upstream of the checked-out branch (`origin/ws/teal`), or null. */
/** `branch`'s upstream as seen from `cwd` (`origin/develop`, or a local name), or null. */
async function upstreamOfBranch(cwd, branch) {
  if (!isValidBranchName(branch)) return null;
  try {
    // for-each-ref names the branch by its full ref: no tag or path can shadow it.
    const { stdout } = await execGitArgs(['for-each-ref', '--format=%(upstream:short)', `refs/heads/${branch}`], cwd);
    return stdout.trim() || null;
  } catch (_) {
    return null;
  }
}

async function upstreamOf(cwd) {
  try {
    const { stdout } = await execGitArgs(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd);
    return stdout.trim() || null;
  } catch (_) {
    return null;
  }
}

/**
 * Run a push built by prFlow.pushArgs in `cwd` — always an explicit
 * `origin refs/heads/B:refs/heads/B` target, never a bare `git push` whose
 * destination depends on the upstream and push.default. Never forces.
 */
async function pushBranch(cwd, args) {
  if (!cwd || !Array.isArray(args) || args[0] !== 'push') return { error: 'Missing parameters' };
  try {
    await execGitArgs(args, cwd, { timeout: PUSH_TIMEOUT_MS });
    return { error: null };
  } catch (err) {
    return { error: err.error || err.message };
  }
}

/** Commit subjects in `range`, newest first (`git log --format=%s`), at most `max`. */
async function commitSubjects(cwd, range, max = 50) {
  try {
    const { stdout } = await execGitArgs(['log', `--max-count=${max}`, '--format=%s', range], cwd);
    return stdout ? stdout.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  } catch (_) {
    return [];
  }
}

/**
 * After a PR merges: fast-forward the main checkout's `branch` from origin —
 * only when that checkout is on `branch` and has no uncommitted changes.
 * Returns `{ updated, reason }`; never touches a checkout it would disturb.
 */
async function fastForwardIfOn(projectPath, branch) {
  if (!projectPath || !branch) return { updated: false, reason: 'Missing parameters' };
  let current = '';
  try {
    current = (await execGitArgs(['symbolic-ref', '--quiet', '--short', 'HEAD'], projectPath)).stdout.trim();
  } catch (_) { /* detached */ }
  if (current !== branch) return { updated: false, reason: `the main checkout is on ${current || 'a detached HEAD'}, not ${branch}` };
  // Tracked changes only: an untracked .env or scratch file never blocks a
  // fast-forward, and `pull --ff-only` refuses on its own if it would clobber one.
  try {
    const { stdout } = await execGitArgs(['status', '--porcelain', '--untracked-files=no'], projectPath);
    if (stdout.trim()) return { updated: false, reason: 'the main checkout has uncommitted changes' };
  } catch (err) {
    return { updated: false, reason: err.error || err.message };
  }
  try {
    await execGitArgs(['pull', '--ff-only', 'origin', branch], projectPath, { timeout: PUSH_TIMEOUT_MS });
    return { updated: true, reason: null };
  } catch (err) {
    return { updated: false, reason: err.error || err.message };
  }
}

// ─── Update from base (update-from-base) ──────────────────
//
// The workspace branch takes the base in with a plain merge (never a
// rebase, never a push). Every helper runs argv in the worktree.

/** Uncommitted changes to tracked files (untracked files never block a merge on their own). */
async function trackedDirtyCount(cwd) {
  // `{ count, error }`: a check that could not run must not read as clean
  // (workspace-hardening L8 — the callers refuse on error).
  try {
    const { stdout } = await execGitArgs(['status', '--porcelain', '--untracked-files=no'], cwd, { maxBuffer: LIST_MAX_BUFFER });
    return { count: stdout ? stdout.split('\n').filter(Boolean).length : 0, error: null };
  } catch (err) {
    return { count: 0, error: err.error || err.message || 'git status failed' };
  }
}

/** Is MERGE_HEAD a commit of `ref` (the merge Frame's update started), not one the user or an agent began? */
async function mergeHeadIn(cwd, ref) {
  try {
    await execGitArgs(['merge-base', '--is-ancestor', 'MERGE_HEAD', ref], cwd);
    return true;
  } catch (_) {
    return false;
  }
}

/** Is a merge stopped half-way (MERGE_HEAD present)? */
async function mergeInProgress(cwd) {
  try {
    await execGitArgs(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], cwd);
    return true;
  } catch (_) {
    return false;
  }
}

/** Raw `-z` list of unmerged paths (parse with prFlow.parseConflicts); '' when none or unreadable. */
async function conflictedFiles(cwd) {
  try {
    // `ls-files -u` (plumbing) never writes the index, unlike `git diff`,
    // which refreshes it even under --no-optional-locks (git 2.39): this
    // runs in the background poll while an agent may be committing.
    // Lines are `<mode> <sha> <stage>\t<path>`; return paths `\0`-joined.
    const { stdout } = await execGitArgs(['ls-files', '-u', '-z'], cwd, { maxBuffer: LIST_MAX_BUFFER });
    return stdout.split('\0').map((l) => l.slice(l.indexOf('\t') + 1)).filter(Boolean).join('\0');
  } catch (_) {
    return '';
  }
}

/** `git merge --no-edit <ref>` → `{ ok, error }`; never throws. */
async function mergeRef(cwd, ref) {
  if (!cwd || !ref) return { ok: false, error: 'Missing parameters' };
  try {
    await execGitArgs(['merge', '--no-edit', ref], cwd, { timeout: PUSH_TIMEOUT_MS, maxBuffer: LIST_MAX_BUFFER });
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err.error || err.message };
  }
}

/** `git merge --abort` → `{ error }`. */
async function abortMerge(cwd) {
  try {
    await execGitArgs(['merge', '--abort'], cwd, { timeout: PUSH_TIMEOUT_MS });
    return { error: null };
  } catch (err) {
    return { error: err.error || err.message };
  }
}

// ─── Orchestration helpers ────────────────────────────────
//
// Worker worktrees for orchestration live under .frame/worktrees/<slug> on a
// branch frame/<slug>/work, branched from current HEAD at dispatch time
// (fresh-base rule). These build on the generic addWorktree/removeWorktree above.

function orchWorktreePath(projectPath, slug) {
  return path.join(projectPath, FRAME_DIR, ORCH_WORKTREES_DIR, slug);
}

async function getHeadSha(projectPath) {
  try {
    const { stdout } = await execGit('git rev-parse HEAD', projectPath);
    return stdout;
  } catch (err) {
    return null;
  }
}

// ─── Reading a branch without checking it out (frame-cloud-brief-done) ──

/** A file read through git may be a large tasks.json; execFile's default buffer is 1 MB. */
const SHOW_MAX_BUFFER = 32 * 1024 * 1024;

/** A value safe to pass as a revision: a non-empty string git cannot read as an option. */
function isRevArg(value) {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('-');
}

/** The full commit id a local branch points at, or null when there is no such branch. */
async function branchTipSha(projectPath, name) {
  if (!isRevArg(name)) return null;
  try {
    const { stdout } = await execGitArgs(['rev-parse', '--verify', '--quiet', `refs/heads/${name}^{commit}`], projectPath);
    return stdout || null;
  } catch (_) {
    return null;
  }
}

/**
 * A file's text as committed at `ref` (`git show <ref>:./<relPath>`, the path
 * relative to `projectPath`), without a checkout. null when the file or the
 * ref is not there.
 */
async function showFileAt(projectPath, ref, relPath) {
  if (!isRevArg(ref) || typeof relPath !== 'string' || !relPath) return null;
  try {
    const { stdout } = await execGitArgs(['show', `${ref}:./${relPath}`], projectPath, { maxBuffer: SHOW_MAX_BUFFER });
    return stdout;
  } catch (_) {
    return null;
  }
}

/** Does this repository hold `sha` as a commit? */
async function commitExists(projectPath, sha) {
  if (!isRevArg(sha)) return false;
  try {
    await execGitArgs(['cat-file', '-e', `${sha}^{commit}`], projectPath);
    return true;
  } catch (_) {
    return false;
  }
}

/** Is commit `a` an ancestor of `b`, or the same commit? false when either is unknown. */
async function isAncestor(projectPath, a, b) {
  if (!isRevArg(a) || !isRevArg(b)) return false;
  try {
    await execGitArgs(['merge-base', '--is-ancestor', a, b], projectPath);
    return true;
  } catch (_) {
    return false;
  }
}

async function branchExists(projectPath, branchName) {
  try {
    await execGit(`git rev-parse --verify --quiet "refs/heads/${branchName}"`, projectPath);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Create a fresh worker worktree for a spec, branched from current HEAD.
 * Cleans any stale worktree/branch for the slug first so a re-dispatch picks up
 * the latest merged state. Returns { error, path, branch, baseSha }.
 */
async function createOrchWorktree(projectPath, slug) {
  const wtPath = orchWorktreePath(projectPath, slug);
  const branch = orchWorkBranch(slug);

  await removeWorktree(projectPath, wtPath, true); // ignore "not a worktree" errors
  if (await branchExists(projectPath, branch)) {
    try { await execGit(`git branch -D "${branch}"`, projectPath); } catch (e) { logger.warn('gitBranches', 'branch -D failed (may not exist):', e.message); }
  }
  try { fs.mkdirSync(path.dirname(wtPath), { recursive: true }); } catch (e) { logger.warn('gitBranches', 'worktree dir create failed:', e.message); }

  const baseSha = await getHeadSha(projectPath);
  const res = await addWorktree(projectPath, wtPath, branch, true); // -b <branch> <path> (from HEAD)
  if (res.error) return res;
  return { error: null, path: wtPath, branch, baseSha };
}

/**
 * Remove a spec's worker worktree (force). Optionally delete its work branch.
 * Used by teardown (T25); deleteBranch is guarded by the caller so un-merged
 * work can be kept.
 */
async function removeOrchWorktree(projectPath, slug, { deleteBranch = false } = {}) {
  const wtPath = orchWorktreePath(projectPath, slug);
  const branch = orchWorkBranch(slug);
  const res = await removeWorktree(projectPath, wtPath, true);
  if (deleteBranch && (await branchExists(projectPath, branch))) {
    try { await execGit(`git branch -D "${branch}"`, projectPath); } catch (e) { logger.warn('gitBranches', 'branch -D failed (may not exist):', e.message); }
  }
  return res;
}

/**
 * Files actually changed on a spec's work branch relative to a base ref.
 * Used for the merge-time footprint drift check (T22). Pass the baseSha
 * recorded at worktree creation for an accurate diff.
 */
async function worktreeChangedFiles(projectPath, slug, baseRef = 'HEAD') {
  const branch = orchWorkBranch(slug);
  try {
    const { stdout } = await execGit(`git diff --name-only "${baseRef}...${branch}"`, projectPath);
    return stdout ? stdout.split('\n').filter(Boolean) : [];
  } catch (err) {
    return [];
  }
}

/**
 * Merge a spec's work branch into its per-spec integration branch. Because the
 * work branch was cut from the same base and is the only contributor to the
 * integration branch (one worktree per spec, V1), this is a fast-forward:
 * point integration at the work tip. Never touches the main working tree or
 * `main`, never pushes. Returns { error, branch }.
 */
async function mergeWorkToIntegration(projectPath, slug) {
  const work = orchWorkBranch(slug);
  const integ = orchIntegrationBranch(slug);
  if (!(await branchExists(projectPath, work))) {
    return { error: `work branch ${work} does not exist` };
  }
  try {
    await execGit(`git branch -f "${integ}" "${work}"`, projectPath);
    return { error: null, branch: integ };
  } catch (err) {
    return { error: err.error || err.message };
  }
}

/**
 * Whether a spec's work branch has been merged (its integration branch exists
 * and contains the work tip). Used by teardown to decide if a work branch is an
 * orphan (unmerged → keep) or safe to prune.
 */
async function isWorkMerged(projectPath, slug) {
  const work = orchWorkBranch(slug);
  const integ = orchIntegrationBranch(slug);
  if (!(await branchExists(projectPath, integ))) return false;
  try {
    await execGit(`git merge-base --is-ancestor "${work}" "${integ}"`, projectPath);
    return true; // exit 0 → work is an ancestor of integration
  } catch (err) {
    return false;
  }
}

/**
 * List orchestration branches present in the repo, grouped by slug. Used for
 * best-effort rehydration after a restart. Returns { slug: { work, integration } }.
 */
async function listOrchBranches(projectPath) {
  const out = {};
  try {
    const { stdout } = await execGit(`git branch --list "frame/*" --format="%(refname:short)"`, projectPath);
    for (const ref of stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
      const m = ref.match(/^frame\/(.+)\/(work|integration)$/);
      if (!m) continue;
      const [, slug, kind] = m;
      out[slug] = out[slug] || { work: false, integration: false };
      out[slug][kind] = true;
    }
  } catch (err) {
    logger.warn('gitBranches', 'listOrchBranches failed:', err.message);
  }
  return out;
}

/**
 * Setup IPC handlers
 */
function setupIPC(ipcMain) {
  // Load branches
  // A server workspace's branches live on the server (server-workspace-panels).
  const serverPanels = require('./serverPanels');
  // Routed by the caller's workspace id when it sends one (server-hardening T6).
  const remote = (p, ctx, method, params) => {
    const entry = p && serverPanels.resolve(p, serverPanels.ctxOf(ctx));
    return entry ? serverPanels.call(entry, method, params).catch((err) => ({ error: err.message, branches: [] })) : null;
  };

  ipcMain.handle(IPC.LOAD_GIT_BRANCHES, async (event, projectPath, ctx) => {
    return (await remote(projectPath, ctx, 'git.branches', { root: projectPath })) || loadBranches(projectPath);
  });

  // Switch branch
  ipcMain.handle(IPC.SWITCH_GIT_BRANCH, async (event, { projectPath, branchName, workspaceId }) => {
    return (await remote(projectPath, { workspaceId }, 'git.switch', { root: projectPath, branchName })) || switchBranch(projectPath, branchName);
  });

  // Branch and worktree changes under a server root would run on this
  // machine's disk: refused until the server does them (server-hardening T10).
  const onServer = (p, ctx) => !!(p && serverPanels.resolve(p, serverPanels.ctxOf(ctx)));
  const refused = { error: serverPanels.READ_ONLY_GIT };

  // Create branch
  ipcMain.handle(IPC.CREATE_GIT_BRANCH, async (event, payload = {}) => {
    const { projectPath, branchName, checkout, baseBranch } = payload;
    if (onServer(projectPath, payload)) return refused;
    return await createBranch(projectPath, branchName, checkout, baseBranch);
  });

  // Delete branch
  ipcMain.handle(IPC.DELETE_GIT_BRANCH, async (event, payload = {}) => {
    const { projectPath, branchName, force } = payload;
    if (onServer(projectPath, payload)) return refused;
    return await deleteBranch(projectPath, branchName, force);
  });

  // Load worktrees: a server workspace's are not listed here.
  ipcMain.handle(IPC.LOAD_GIT_WORKTREES, async (event, projectPath, ctx) => {
    if (onServer(projectPath, ctx)) return { error: null, worktrees: [], note: 'Worktrees of a server workspace are not listed here.' };
    return await loadWorktrees(projectPath);
  });

  // Add worktree
  ipcMain.handle(IPC.ADD_GIT_WORKTREE, async (event, payload = {}) => {
    const { projectPath, worktreePath, branchName, createBranch: create } = payload;
    if (onServer(projectPath, payload)) return refused;
    return await addWorktree(projectPath, worktreePath, branchName, create);
  });

  // Remove worktree
  ipcMain.handle(IPC.REMOVE_GIT_WORKTREE, async (event, payload = {}) => {
    const { projectPath, worktreePath, force } = payload;
    if (onServer(projectPath, payload)) return refused;
    return await removeWorktree(projectPath, worktreePath, force);
  });

  // Toggle panel from menu
  ipcMain.on(IPC.TOGGLE_GIT_BRANCHES_PANEL, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.TOGGLE_GIT_BRANCHES_PANEL);
    }
  });
}

module.exports = {
  init,
  loadBranches,
  switchBranch,
  createBranch,
  deleteBranch,
  loadWorktrees,
  addWorktree,
  removeWorktree,
  isWorkingTreeClean,
  localBranchExists,
  remoteBranchExists,
  currentBranch,
  stashAll,
  branchTipSha,
  showFileAt,
  commitExists,
  isAncestor,
  setupIPC,
  // Workspace helpers (workspaces spec)
  execGitArgs,
  localBranchExists,
  defaultRemoteBranch,
  fetchBranch,
  addWorkspaceWorktree,
  removeWorkspaceWorktree,
  worktreeStatus,
  commitAll,
  discardAll,
  headState,
  ARCHIVE_TIMEOUT_MS,
  listIgnoredCandidates,
  listIgnoredIn,
  createBundle,
  rootCommit,
  // PR flow helpers (workspace-pr-flow)
  revCount,
  upstreamOf,
  upstreamOfBranch,
  pushBranch,
  commitSubjects,
  fastForwardIfOn,
  // Update from base (update-from-base)
  trackedDirtyCount,
  mergeHeadIn,
  mergeInProgress,
  conflictedFiles,
  mergeRef,
  abortMerge,
  // Orchestration helpers
  orchWorktreePath,
  getHeadSha,
  branchExists,
  createOrchWorktree,
  removeOrchWorktree,
  worktreeChangedFiles,
  mergeWorkToIntegration,
  isWorkMerged,
  listOrchBranches
};
