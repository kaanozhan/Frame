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
const { mapPrView, parseCount } = require('../shared/prFlow');
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

function setupIPC(ipcMain) {
  // The renderer names the project it shows; that project is the one polled.
  ipcMain.handle(IPC.WORKSPACE_GIT_REFRESH, async (event, { projectPath } = {}) => {
    if (!projectPath) return null;
    watchedProject = projectPath;
    return refresh(projectPath);
  });
}

module.exports = { init, setupIPC, refresh, getState, activeWorkspaces, PR_FIELDS };
