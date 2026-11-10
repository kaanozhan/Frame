/**
 * Workspace Git State — each workspace's way out, as seen from main
 * (workspace-pr-flow spec).
 *
 * For the watched project's active workspaces it reads the git state
 * (uncommitted, unpushed, behind the base, upstream) and, for workspaces that
 * are pushed or already have a PR, the PR through the user's `gh`
 * (state, checks, comments, mergeability). The result is pushed to the
 * renderer as WORKSPACE_GIT_STATE; the renderer only draws it.
 *
 * Refresh: one visibility-gated poller (3 min) for the watched project, on
 * window focus, on WORKSPACE_GIT_REFRESH, after every workspace mutation
 * (workspaceManager.notify) and after every PR action. Nothing polls while
 * the window is hidden (pollGate).
 *
 * Everything runs as the user's own git and gh. Frame stores no token and
 * calls no model.
 */

const fs = require('fs');
const { IPC } = require('../shared/ipcChannels');
const registry = require('../shared/workspaceRegistry');
const { mapPrView, parseCount, composePr, pickMergeMethod, isPushable } = require('../shared/prFlow');
const projectRegistry = require('./projectRegistry');
const git = require('./gitBranchesManager');
const github = require('./githubManager');
const pollGate = require('./pollGate');
const logger = require('./logger');

const POLL_MS = 3 * 60 * 1000;
const PR_FIELDS = 'number,url,state,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,comments,headRefName,baseRefName';

let mainWindow = null;
let watchedProject = null;
let poller = null;
const lastState = new Map();   // projectPath → last pushed payload
const inFlight = new Map();    // projectPath → promise
const pending = new Set();     // projectPath refresh requested while one was in flight

function init(window) {
  mainWindow = window;
  if (window && !window.isDestroyed()) {
    window.on('focus', () => { if (watchedProject) refresh(watchedProject); });
  }
  if (!poller) {
    poller = pollGate.gatedInterval(() => { if (watchedProject) refresh(watchedProject); }, POLL_MS);
  }
}

function activeWorkspaces(projectPath) {
  let records = [];
  try {
    records = registry.activeOf(projectRegistry.getWorkspaceRecords(projectPath));
  } catch (_) {
    return [];
  }
  return records.filter((r) => r && r.path && fs.existsSync(r.path));
}

async function prFor(projectPath, branch) {
  const res = await github.runGh(['pr', 'view', branch, '--json', PR_FIELDS], projectPath, { timeout: 20000 });
  if (!res.ok) return null; // "no pull requests found" and every other failure read as: no PR
  try {
    return mapPrView(JSON.parse(res.stdout));
  } catch (_) {
    return null;
  }
}

/** RowState for one workspace (see the plan's data shapes). */
async function rowState(projectPath, ws, access, previous) {
  const st = await git.worktreeStatus(ws.path);
  const upstream = await git.upstreamOf(ws.path);
  const base = ws.base || 'main';
  const unpushed = upstream
    ? await git.revCount(ws.path, '@{u}..HEAD')
    : await git.revCount(ws.path, `origin/${base}..HEAD`);
  const behind = await git.revCount(ws.path, `HEAD..origin/${base}`);
  const prUsable = access && access.authed && access.repoName;
  // Only ask GitHub about branches that can have a PR: pushed ones, or ones
  // that had a PR last time (its upstream may have been removed after merge).
  const pr = prUsable && (upstream || (previous && previous.pr)) ? await prFor(projectPath, ws.branch) : null;
  return {
    dirty: parseCount(st.count),
    unpushed,
    behind,
    hasUpstream: !!upstream,
    pr
  };
}

async function collect(projectPath) {
  let access = { gh: false, authed: false, repoName: null };
  try {
    const a = await github.checkAccess(projectPath);
    access = { gh: !!a.gh, authed: !!a.authed, repoName: a.repoName || null };
  } catch (err) {
    logger.warn('workspaces', `gh access check failed: ${err.message}`);
  }
  const prev = lastState.get(projectPath);
  const workspaces = {};
  for (const ws of activeWorkspaces(projectPath)) {
    try {
      workspaces[ws.id] = await rowState(projectPath, ws, access, prev && prev.workspaces[ws.id]);
    } catch (err) {
      logger.warn('workspaces', `git state for ${ws.name} failed: ${err.message}`);
    }
  }
  return { projectPath, access, workspaces };
}

function send(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.WORKSPACE_GIT_STATE, payload);
  }
}

/**
 * Re-read and push the state of `projectPath`'s workspaces. Calls that land
 * while a read is running coalesce into one more read after it.
 */
function refresh(projectPath) {
  if (!projectPath) return Promise.resolve(null);
  if (inFlight.has(projectPath)) {
    pending.add(projectPath);
    return inFlight.get(projectPath);
  }
  const run = collect(projectPath)
    .then((payload) => {
      lastState.set(projectPath, payload);
      if (projectPath === watchedProject) send(payload);
      return payload;
    })
    .catch((err) => {
      logger.warn('workspaces', `git state refresh failed: ${err.message}`);
      return null;
    })
    .finally(() => {
      inFlight.delete(projectPath);
      if (pending.delete(projectPath)) refresh(projectPath);
    });
  inFlight.set(projectPath, run);
  return run;
}

/** The last state read for a project, or null. */
function getState(projectPath) {
  return lastState.get(projectPath) || null;
}

// ─── Actions (push, PR, merge) ────────────────────────────────
//
// Each acts on one workspace through the user's git/gh and re-pushes state.
// Never --force, never the base branch, never a commit on the user's behalf.

function recordOf(projectPath, id) {
  return activeWorkspaces(projectPath).find((r) => r.id === id) || null;
}

function settingsOf(projectPath) {
  // Lazily required: frameProject pulls in much of main.
  return require('./frameProject').getWorkspaceSettings(projectPath);
}

/** Push a workspace's branch; the first push sets `origin/<branch>` as upstream. */
async function push(projectPath, id) {
  const ws = recordOf(projectPath, id);
  if (!ws) return { error: 'This workspace is not available.' };
  if (!isPushable({ branch: ws.branch, base: ws.base })) {
    return { error: `Refusing to push ${ws.branch}: it is the base branch.` };
  }
  const st = await git.worktreeStatus(ws.path);
  const upstream = await git.upstreamOf(ws.path);
  const res = await git.pushBranch(ws.path, ws.branch, { setUpstream: !upstream });
  refresh(projectPath);
  return { error: res.error || null, dirty: st.count || 0 };
}

/** The spec a workspace holds (spec-in-workspace), with its documents, or null. */
function heldSpec(projectPath, id) {
  try {
    const specManager = require('./specManager');
    const held = specManager.listSpecs(projectPath).find((s) => s && s.workspace && s.workspace.id === id && !s.malformed);
    if (!held) return null;
    const full = specManager.getSpec(projectPath, held.slug);
    return full ? { slug: held.slug, title: held.title, spec: full.spec, outcome: full.outcome } : null;
  } catch (err) {
    logger.warn('workspaces', `could not read the workspace's spec: ${err.message}`);
    return null;
  }
}

/** Prefilled PR title/body: from the held spec, else the commit subjects. */
async function prDraft(projectPath, id) {
  const ws = recordOf(projectPath, id);
  if (!ws) return { error: 'This workspace is not available.' };
  const base = ws.base || 'main';
  const commits = await git.commitSubjects(ws.path, `origin/${base}..HEAD`);
  const { title, body } = composePr({ spec: heldSpec(projectPath, id), commits, branch: ws.branch });
  return { error: null, title, body, base, branch: ws.branch, commits: commits.length };
}

/** Push if needed, then `gh pr create` from the workspace branch into its base. */
async function prCreate(projectPath, id, { title, body = '', draft = false } = {}) {
  const ws = recordOf(projectPath, id);
  if (!ws) return { error: 'This workspace is not available.' };
  if (!title || !String(title).trim()) return { error: 'A pull request needs a title.' };
  const access = await github.checkAccess(projectPath);
  if (!access.gh) return { error: 'GitHub CLI (gh) is not installed.' };
  if (!access.authed) return { error: 'GitHub CLI is not signed in — run `gh auth login`.' };
  if (!access.repoName) return { error: 'This project has no GitHub remote.' };

  const pushed = await push(projectPath, id);
  if (pushed.error) return { error: `Push failed: ${pushed.error}` };

  const args = ['pr', 'create', '--base', ws.base || 'main', '--head', ws.branch,
    '--title', String(title).trim(), '--body-file', '-'];
  if (draft) args.push('--draft');
  const res = await github.runGh(args, ws.path, { stdin: String(body || '') });
  refresh(projectPath);
  if (!res.ok) return { error: res.error };
  const url = (res.stdout.match(/https?:\/\/\S+/) || [null])[0];
  return { error: null, url };
}

/**
 * Merge the workspace's PR with the project's method (or the repo's first
 * allowed), fast-forward the main checkout when it is on the base and clean,
 * then archive the workspace when the setting says so.
 */
async function merge(projectPath, id) {
  const ws = recordOf(projectPath, id);
  if (!ws) return { error: 'This workspace is not available.' };
  const current = await prFor(projectPath, ws.branch);
  if (!current) return { error: 'This workspace has no pull request.' };
  if (current.state !== 'open') return { error: `The pull request is ${current.state}.` };
  if (!current.ready) return { error: 'The pull request is not ready to merge (checks or conflicts).' };

  const settings = settingsOf(projectPath);
  const flags = await github.runGh(['repo', 'view', '--json', 'squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed'], projectPath, { timeout: 20000 });
  let allowed = null;
  try { allowed = flags.ok ? JSON.parse(flags.stdout) : null; } catch (_) { allowed = null; }
  const method = pickMergeMethod(allowed, settings.mergeMethod);
  if (!method) return { error: 'The repository allows no merge method.' };

  const res = await github.runGh(['pr', 'merge', String(current.number), `--${method}`], projectPath);
  if (!res.ok) {
    refresh(projectPath);
    return { error: res.error, method };
  }
  const fastForward = await git.fastForwardIfOn(projectPath, ws.base || 'main');
  let archived = false;
  let archiveNote = null;
  if (settings.archiveOnMerge) {
    const a = await require('./workspaceManager').archive(projectPath, id, {});
    archived = !!(a && !a.error && !a.dirty);
    if (a && a.dirty) archiveNote = 'not archived: the workspace has uncommitted changes';
    else if (a && a.error) archiveNote = `not archived: ${a.error}`;
  }
  refresh(projectPath);
  return { error: null, method, number: current.number, fastForward, archived, archiveNote };
}

function setupIPC(ipcMain) {
  // The renderer names the project it shows; that project is the one polled.
  ipcMain.handle(IPC.WORKSPACE_GIT_REFRESH, async (event, { projectPath } = {}) => {
    if (!projectPath) return null;
    watchedProject = projectPath;
    return refresh(projectPath);
  });
  const guarded = (fn) => async (event, payload = {}) => {
    try {
      return await fn(payload);
    } catch (err) {
      logger.error('workspaces', err);
      return { error: err.message || String(err) };
    }
  };
  ipcMain.handle(IPC.WORKSPACE_PUSH, guarded(({ projectPath, id }) => push(projectPath, id)));
  ipcMain.handle(IPC.WORKSPACE_PR_DRAFT, guarded(({ projectPath, id }) => prDraft(projectPath, id)));
  ipcMain.handle(IPC.WORKSPACE_PR_CREATE, guarded(({ projectPath, id, title, body, draft }) => prCreate(projectPath, id, { title, body, draft })));
  ipcMain.handle(IPC.WORKSPACE_PR_MERGE, guarded(({ projectPath, id }) => merge(projectPath, id)));
}

module.exports = { init, setupIPC, refresh, getState, activeWorkspaces, push, prDraft, prCreate, merge, PR_FIELDS };
