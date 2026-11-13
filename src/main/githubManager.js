/**
 * GitHub Manager Module
 * Handles GitHub integration using gh CLI
 *
 * Every `gh` call goes out with envPath.childEnv(). A packaged app launched
 * from Finder inherits launchd's PATH, which has no /opt/homebrew/bin, so a
 * bare exec() reported "gh CLI not installed" to users who had gh installed
 * and working in their terminal. See src/main/envPath.js.
 *
 * github-view-tree-layout spec (D6): the access check — gh present → signed
 * in → GitHub remote — runs once per project and is cached here, so the
 * renderer never spawns gh per section. A manual refresh passes `force`.
 * `gh` stays the only GitHub transport (C4); git-side work (working-tree
 * check, branches, worktrees) stays in gitBranchesManager.
 */

const { exec, execFile } = require('child_process');
const { shell } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const envPath = require('./envPath');
const gitBranchesManager = require('./gitBranchesManager');

/** Same ceiling as gitBranchesManager.execGit — a slow or offline
 *  `gh repo view` resolves to no-remote instead of hanging the panel. */
const GH_TIMEOUT_MS = 10000;
const PR_STATES = ['open', 'closed', 'all'];
const PR_FIELDS = 'number,title,state,isDraft,author,updatedAt,url,reviewDecision,statusCheckRollup,headRefName';

let mainWindow = null;
let currentProjectPath = null;

/** projectPath → { gh, authed, repoName, error } */
const accessCache = new Map();

/**
 * Initialize GitHub manager
 */
function init(window) {
  mainWindow = window;
}

/**
 * Set current project path. A project change drops every cached access
 * check, so returning to a project re-runs it.
 */
function setProjectPath(projectPath) {
  if (projectPath !== currentProjectPath) accessCache.clear();
  currentProjectPath = projectPath;
}

/**
 * Run one gh (or git) command with the repaired PATH and a timeout.
 * Resolves `{ ok, stdout, stderr, error }` — never rejects.
 */
async function run(cmd, cwd) {
  const env = await envPath.childEnv();
  return new Promise((resolve) => {
    exec(cmd, { cwd, env, timeout: GH_TIMEOUT_MS }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: (stdout || '').trim(),
        stderr: (stderr || '').trim(),
        error: error ? ((stderr || '').trim() || error.message) : null
      });
    });
  });
}

/**
 * Run gh with an argv array — no shell, so a PR title or body (which the user
 * edits and may contain quotes, backticks or `$`) is passed through as data.
 * `stdin`, when given, is written to the process (for `--body-file -`).
 * Resolves `{ ok, stdout, stderr, error }` — never rejects (workspace-pr-flow).
 */
async function runGh(args, cwd, { stdin = null, timeout = 60000 } = {}) {
  const env = await envPath.childEnv();
  return new Promise((resolve) => {
    const child = execFile('gh', args, { cwd, env, timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: (stdout || '').trim(),
        stderr: (stderr || '').trim(),
        error: error ? ((stderr || '').trim() || error.message) : null
      });
    });
    // Always close stdin: with a body it carries `--body-file -`, without
    // one a never-closed pipe could leave a command waiting for input.
    if (child.stdin) child.stdin.end(stdin != null ? String(stdin) : undefined);
  });
}

/**
 * Check if gh CLI is available
 */
async function checkGhCli() {
  const res = await run('gh --version');
  return res.ok;
}

/**
 * Is gh signed in to any host? `gh auth status` exits non-zero when not.
 */
async function checkGhAuth() {
  const res = await run('gh auth status');
  return res.ok;
}

/**
 * Check if current directory is a git repo with GitHub remote
 */
async function checkGitHubRepo(projectPath) {
  const res = await run('gh repo view --json nameWithOwner', projectPath);
  if (!res.ok) {
    return { isGitHubRepo: false, repoName: null, error: res.error };
  }
  try {
    const data = JSON.parse(res.stdout);
    if (data && typeof data.nameWithOwner === 'string') {
      return { isGitHubRepo: true, repoName: data.nameWithOwner, error: null };
    }
  } catch {
    // fall through
  }
  return { isGitHubRepo: false, repoName: null, error: 'Could not read repository name' };
}

/**
 * The one access check (D6): gh present → signed in → GitHub remote.
 * Short-circuits at the first failure and caches per project until a
 * forced refresh or a project change.
 * @returns {{ gh: boolean, authed: boolean, repoName: string|null, error: string|null }}
 */
async function checkAccess(projectPath, force = false) {
  if (!projectPath) {
    return { gh: false, authed: false, repoName: null, error: 'No project selected' };
  }
  if (!force && accessCache.has(projectPath)) {
    return accessCache.get(projectPath);
  }

  let result;
  if (!(await checkGhCli())) {
    result = { gh: false, authed: false, repoName: null, error: null };
  } else if (!(await checkGhAuth())) {
    result = { gh: true, authed: false, repoName: null, error: null };
  } else {
    const repo = await checkGitHubRepo(projectPath);
    result = { gh: true, authed: true, repoName: repo.repoName, error: repo.error };
  }

  accessCache.set(projectPath, result);
  return result;
}

/**
 * The legacy error string for a failed access check, or null when the
 * check passed. Keeps LOAD_GITHUB_ISSUES' payload shape (C5).
 */
function accessError(access) {
  if (!access.gh) return 'gh CLI not installed';
  if (!access.authed) return 'gh not signed in';
  if (!access.repoName) return 'Not a GitHub repository';
  return null;
}

function normalizeState(state) {
  const s = String(state || 'open').toLowerCase();
  return PR_STATES.includes(s) ? s : 'open';
}

/**
 * Load GitHub issues for current project
 */
async function loadIssues(projectPath, state = 'open') {
  const access = await checkAccess(projectPath);
  const denied = accessError(access);
  if (denied) {
    return { error: denied, issues: [], repoName: access.repoName };
  }

  const cmd = `gh issue list --state ${normalizeState(state)} --json number,title,state,author,labels,createdAt,updatedAt,url --limit 50`;
  const res = await run(cmd, projectPath);
  if (!res.ok) {
    return { error: res.error, issues: [], repoName: access.repoName };
  }
  try {
    return { error: null, issues: JSON.parse(res.stdout), repoName: access.repoName };
  } catch (e) {
    return { error: 'Failed to parse issues', issues: [], repoName: access.repoName };
  }
}

/**
 * Load pull requests (G4) with the same open / closed / all filter as issues.
 */
async function loadPullRequests(projectPath, state = 'open') {
  const access = await checkAccess(projectPath);
  const denied = accessError(access);
  if (denied) {
    return { error: denied, prs: [], repoName: access.repoName };
  }

  const cmd = `gh pr list --state ${normalizeState(state)} --limit 50 --json ${PR_FIELDS}`;
  const res = await run(cmd, projectPath);
  if (!res.ok) {
    return { error: res.error, prs: [], repoName: access.repoName };
  }
  try {
    return { error: null, prs: JSON.parse(res.stdout), repoName: access.repoName };
  } catch (e) {
    return { error: 'Failed to parse pull requests', prs: [], repoName: access.repoName };
  }
}

/**
 * `gh pr checkout <n>`, refused on a dirty tree the way SWITCH_GIT_BRANCH
 * refuses (C8): no auto-stash, the renderer's toast says so.
 */
async function checkoutPullRequest(projectPath, number) {
  const n = Number.parseInt(number, 10);
  if (!projectPath || !Number.isInteger(n) || n <= 0) {
    return { error: 'Missing parameters' };
  }

  const access = await checkAccess(projectPath);
  const denied = accessError(access);
  if (denied) return { error: denied };

  const status = await gitBranchesManager.isWorkingTreeClean(projectPath);
  if (!status.clean && !status.error) {
    return {
      error: 'uncommitted_changes',
      message: 'You have uncommitted changes',
      changes: status.changes
    };
  }

  const res = await run(`gh pr checkout ${n}`, projectPath);
  if (!res.ok) {
    return { error: res.error };
  }

  const head = await run('git branch --show-current', projectPath);
  return { error: null, branch: head.ok ? head.stdout : null, number: n };
}

/**
 * Open issue in browser
 */
function openIssue(url) {
  if (url) {
    shell.openExternal(url);
  }
}

/**
 * Setup IPC handlers
 */
function setupIPC(ipcMain) {
  // Access state: gh present → signed in → GitHub remote (cached per project)
  ipcMain.handle(IPC.GITHUB_ACCESS_STATE, async (event, payload = {}) => {
    const path = payload.projectPath || currentProjectPath;
    return await checkAccess(path, payload.force === true);
  });

  // Load issues
  ipcMain.handle(IPC.LOAD_GITHUB_ISSUES, async (event, { projectPath, state }) => {
    const path = projectPath || currentProjectPath;
    if (!path) {
      return { error: 'No project selected', issues: [] };
    }
    return await loadIssues(path, state);
  });

  // Load pull requests
  ipcMain.handle(IPC.LOAD_GITHUB_PULL_REQUESTS, async (event, { projectPath, state } = {}) => {
    const path = projectPath || currentProjectPath;
    if (!path) {
      return { error: 'No project selected', prs: [] };
    }
    return await loadPullRequests(path, state);
  });

  // Check out a pull request's branch
  ipcMain.handle(IPC.CHECKOUT_GITHUB_PR, async (event, { projectPath, number } = {}) => {
    const path = projectPath || currentProjectPath;
    return await checkoutPullRequest(path, number);
  });

  // Open issue (or any GitHub URL) in browser
  ipcMain.on(IPC.OPEN_GITHUB_ISSUE, (event, url) => {
    openIssue(url);
  });
}

module.exports = {
  init,
  setProjectPath,
  setupIPC,
  checkAccess,
  runGh,
  loadIssues,
  loadPullRequests,
  checkoutPullRequest,
  openIssue
};
