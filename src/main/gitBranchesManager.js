/**
 * Git Branches Manager Module
 * Handles git branch and worktree operations
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { IPC } = require('../shared/ipcChannels');
const { FRAME_DIR, ORCH_WORKTREES_DIR, orchWorkBranch, orchIntegrationBranch } = require('../shared/frameConstants');

let mainWindow = null;

/**
 * Initialize manager
 */
function init(window) {
  mainWindow = window;
}

/**
 * Execute git command with promise
 */
function execGit(command, projectPath) {
  return new Promise((resolve, reject) => {
    exec(command, { cwd: projectPath, timeout: 10000 }, (error, stdout, stderr) => {
      if (error) {
        reject({ error: error.message, stderr });
      } else {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      }
    });
  });
}

/**
 * Check if working tree is clean
 */
async function isWorkingTreeClean(projectPath) {
  try {
    const { stdout } = await execGit('git status --porcelain', projectPath);
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
    const { stdout: branchOutput } = await execGit(
      'git branch -a --format="%(refname:short)|%(objectname:short)|%(committerdate:relative)|%(subject)"',
      projectPath
    );

    const branches = branchOutput.split('\n')
      .filter(line => line)
      .map(line => {
        const [name, commit, date, ...messageParts] = line.split('|');
        const message = messageParts.join('|');
        const isRemote = name.startsWith('origin/');
        return {
          name: name,
          commit: commit || '',
          date: date || '',
          message: message || '',
          isRemote,
          isCurrent: name === currentBranch
        };
      })
      // Filter out HEAD pointer
      .filter(b => !b.name.includes('HEAD'));

    return { error: null, currentBranch, branches };
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
    // Handle remote branches - create local tracking branch
    let targetBranch = branchName;
    if (branchName.startsWith('origin/')) {
      targetBranch = branchName.replace('origin/', '');
    }

    await execGit(`git checkout "${targetBranch}"`, projectPath);
    return { error: null, branch: targetBranch };
  } catch (err) {
    return { error: err.error || err.message };
  }
}

/**
 * Create a new branch
 */
async function createBranch(projectPath, branchName, checkout = true, baseBranch = null) {
  if (!projectPath || !branchName) {
    return { error: 'Missing parameters' };
  }

  try {
    let cmd;
    if (checkout) {
      // Create and switch to new branch
      cmd = baseBranch
        ? `git checkout -b "${branchName}" "${baseBranch}"`
        : `git checkout -b "${branchName}"`;
    } else {
      // Just create branch without switching
      cmd = baseBranch
        ? `git branch "${branchName}" "${baseBranch}"`
        : `git branch "${branchName}"`;
    }
    await execGit(cmd, projectPath);
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
    try { await execGit(`git branch -D "${branch}"`, projectPath); } catch (e) {}
  }
  try { fs.mkdirSync(path.dirname(wtPath), { recursive: true }); } catch (e) {}

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
    try { await execGit(`git branch -D "${branch}"`, projectPath); } catch (e) {}
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
  } catch (err) {}
  return out;
}

/**
 * Setup IPC handlers
 */
function setupIPC(ipcMain) {
  // Load branches
  ipcMain.handle(IPC.LOAD_GIT_BRANCHES, async (event, projectPath) => {
    return await loadBranches(projectPath);
  });

  // Switch branch
  ipcMain.handle(IPC.SWITCH_GIT_BRANCH, async (event, { projectPath, branchName }) => {
    return await switchBranch(projectPath, branchName);
  });

  // Create branch
  ipcMain.handle(IPC.CREATE_GIT_BRANCH, async (event, { projectPath, branchName, checkout, baseBranch }) => {
    return await createBranch(projectPath, branchName, checkout, baseBranch);
  });

  // Delete branch
  ipcMain.handle(IPC.DELETE_GIT_BRANCH, async (event, { projectPath, branchName, force }) => {
    return await deleteBranch(projectPath, branchName, force);
  });

  // Load worktrees
  ipcMain.handle(IPC.LOAD_GIT_WORKTREES, async (event, projectPath) => {
    return await loadWorktrees(projectPath);
  });

  // Add worktree
  ipcMain.handle(IPC.ADD_GIT_WORKTREE, async (event, { projectPath, worktreePath, branchName, createBranch }) => {
    return await addWorktree(projectPath, worktreePath, branchName, createBranch);
  });

  // Remove worktree
  ipcMain.handle(IPC.REMOVE_GIT_WORKTREE, async (event, { projectPath, worktreePath, force }) => {
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
  setupIPC,
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
