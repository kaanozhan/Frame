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
const { mapPrView, parseCount, composePr, pickMergeMethod, pushArgs, parseConflicts, mergeLanded } = require('../shared/prFlow');
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
  const base = await baseOf(projectPath, ws);
  const unpushed = upstream
    ? await git.revCount(ws.path, '@{u}..HEAD')
    : await git.revCount(ws.path, `origin/${base}..HEAD`);
  const behind = await git.revCount(ws.path, `HEAD..origin/${base}`);
  const prUsable = access && access.authed && access.repoName;
  // Only ask GitHub about branches that can have a PR: pushed ones, or ones
  // that had a PR last time (its upstream may have been removed after merge).
  const pr = prUsable && (upstream || (previous && previous.pr)) ? await prFor(projectPath, ws.branch) : null;
  const merging = await git.mergeInProgress(ws.path);
  return {
    dirty: parseCount(st.count),
    unpushed,
    behind,
    hasUpstream: !!upstream,
    pr,
    merging,
    conflicts: merging ? parseConflicts(await git.conflictedFiles(ws.path)) : []
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
    mainWindow.webContents.send(IPC.WORKSPACE_GIT_STATE, withServer(payload));
  }
}

// ─── Server workspaces (server-workspace-panels) ──────────────
//
// A server workspace's git and PR state is read on Frame Server by its own
// workspaceGitState (gh as the server user) and pushed as `pr.state`. Here it
// is kept per desktop project and merged into every WORKSPACE_GIT_STATE, the
// server's GitHub access kept apart as `serverAccess`. Actions on a server
// workspace go to the server by id.

const serverState = new Map(); // desktop projectPath → last server payload
let serverWired = false;

function serverLocationOf(id) {
  try { return require('./workspaceManager').serverLocation(id); } catch (_) { return null; }
}

function serverProjectOf(projectPath) {
  try {
    const hit = require('./workspaceManager').serverRoots().find((r) => r.projectPath === projectPath);
    return hit || null;
  } catch (_) {
    return null;
  }
}

function withServer(payload) {
  if (!payload || !payload.projectPath) return payload;
  const { mergeGitStatePayloads } = require('../shared/serverRouting');
  return mergeGitStatePayloads(payload, serverState.get(payload.projectPath) || null, payload.projectPath);
}

function wireServer() {
  if (serverWired) return;
  serverWired = true;
  const sc = require('./serverConnection');
  sc.on('pr.state', (payload) => {
    if (!payload || !payload.projectPath) return;
    let roots = [];
    try { roots = require('./workspaceManager').serverRoots(); } catch (_) { roots = []; }
    const local = roots.find((r) => r.serverProjectPath === payload.projectPath);
    if (!local) return;
    serverState.set(local.projectPath, payload);
    if (local.projectPath === watchedProject) {
      send(lastState.get(local.projectPath) || { projectPath: local.projectPath, access: null, workspaces: {} });
    }
  });
  sc.on('disconnected', () => serverState.clear());
}

/** Ask the server for its state of `projectPath`'s server workspaces (and make it push changes). */
async function refreshServer(projectPath) {
  const sp = serverProjectOf(projectPath);
  const sc = require('./serverConnection');
  if (!sp || !sc.isConnected()) return;
  try {
    const payload = await sc.call('pr.refresh', { projectPath: sp.serverProjectPath }, 120000);
    if (payload) serverState.set(projectPath, payload);
  } catch (err) {
    logger.warn('workspaces', `server git state failed: ${err.message}`);
  }
}

/** Run a PR-flow action of a server workspace on the server, or return null for a local one. */
function onServer(method, id, params) {
  const loc = serverLocationOf(id);
  if (!loc) return null;
  const sc = require('./serverConnection');
  if (!sc.isConnected()) return Promise.resolve({ error: `${loc.host || 'The server'} is offline — reconnect to continue.` });
  return sc.call(method, { projectPath: loc.serverProjectPath, id, ...params }, 11 * 60 * 1000)
    .catch((err) => ({ error: err.message }));
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

/**
 * Make `projectPath` the polled and pushed project (Frame Server's
 * pr.refresh); null stops polling when no desktop is left (server-hardening T9).
 */
function setWatched(projectPath) {
  watchedProject = projectPath || null;
}

/** The polled project, or null. */
function watched() {
  return watchedProject;
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

/**
 * A workspace's base: the recorded one, else (records from before
 * workspace-hardening L4 stored `base: null`) the remote's default branch.
 */
async function baseOf(projectPath, ws) {
  if (ws.base) return ws.base;
  return (await git.defaultRemoteBranch(projectPath)).branch || 'main';
}

function settingsOf(projectPath) {
  // Lazily required: frameProject pulls in much of main.
  return require('./frameProject').getWorkspaceSettings(projectPath);
}

/** Push a workspace's branch; the first push sets `origin/<branch>` as upstream. */
/**
 * Push and pull requests need `origin`: a project sent to the server without
 * a remote (server-onboarding), or a local one never connected, is told how
 * to add one instead of seeing git's own error.
 */
const NO_REMOTE = 'This project has no remote — add one (git remote add origin <url>) to push or open a pull request.';
async function noRemote(cwd) {
  try {
    await git.execGitArgs(['remote', 'get-url', 'origin'], cwd);
    return false;
  } catch (_) {
    return true;
  }
}

async function push(projectPath, id) {
  const ws = recordOf(projectPath, id);
  if (!ws) return { error: 'This workspace is not available.' };
  if (await noRemote(ws.path)) return { error: NO_REMOTE };
  // A workspace opened from an existing branch may have no stored base: the
  // remote's default branch stands in, so the base can never be pushed.
  const base = await baseOf(projectPath, ws);
  const upstream = await git.upstreamOf(ws.path);
  const plan = pushArgs({ branch: ws.branch, base, upstream });
  if (plan.error) return { error: plan.error };
  const st = await git.worktreeStatus(ws.path);
  const res = await git.pushBranch(ws.path, plan.args);
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
  if (await noRemote(ws.path)) return { error: NO_REMOTE };
  const base = await baseOf(projectPath, ws);
  const commits = await git.commitSubjects(ws.path, `origin/${base}..HEAD`);
  const { title, body } = composePr({ spec: heldSpec(projectPath, id), commits, branch: ws.branch });
  return { error: null, title, body, base, branch: ws.branch, commits: commits.length };
}

/** Push if needed, then `gh pr create` from the workspace branch into its base. */
async function prCreate(projectPath, id, { title, body = '', draft = false } = {}) {
  const ws = recordOf(projectPath, id);
  if (!ws) return { error: 'This workspace is not available.' };
  if (await noRemote(ws.path)) return { error: NO_REMOTE };
  if (!title || !String(title).trim()) return { error: 'A pull request needs a title.' };
  const access = await github.checkAccess(projectPath);
  if (!access.gh) return { error: 'GitHub CLI (gh) is not installed.' };
  if (!access.authed) return { error: 'GitHub CLI is not signed in — run `gh auth login`.' };
  if (!access.repoName) return { error: 'This project has no GitHub remote.' };

  const pushed = await push(projectPath, id);
  if (pushed.error) return { error: `Push failed: ${pushed.error}` };

  const args = ['pr', 'create', '--base', await baseOf(projectPath, ws), '--head', ws.branch,
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
  // A merge queue (or auto-merge) accepts the command without merging: then
  // there is nothing to fast-forward and the workspace must stay.
  const after = await prFor(projectPath, ws.branch);
  if (!mergeLanded(after)) {
    refresh(projectPath);
    return { error: null, method, number: current.number, queued: true, fastForward: null, archived: false, archiveNote: null };
  }
  const fastForward = await git.fastForwardIfOn(projectPath, await baseOf(projectPath, ws));
  let archived = false;
  let archiveNote = null;
  if (settings.archiveOnMerge) {
    // Behind the per-project queue so a concurrent create cannot overwrite
    // the record (workspace-hardening L5).
    const a = await require('./workspaceManager').archiveQueued(projectPath, id, {});
    archived = !!(a && !a.error && !a.dirty && !a.headOff);
    if (a && a.dirty) archiveNote = 'not archived: the workspace has uncommitted changes';
    else if (a && a.headOff) archiveNote = `not archived: ${a.headOff.unreachable} commit${a.headOff.unreachable === 1 ? '' : 's'} not on any branch would be lost`;
    else if (a && a.error) archiveNote = `not archived: ${a.error}`;
  }
  refresh(projectPath);
  return { error: null, method, number: current.number, fastForward, archived, archiveNote };
}

// ─── Update from base (update-from-base) ──────────────────────
//
// Fetch the base and merge `origin/<base>` into the workspace branch. Never a
// rebase, never a push; refuses tracked uncommitted changes so an abort can
// never touch the user's own work. A conflict is left in place (MERGE_HEAD)
// for an agent to resolve or the user to abort — the row shows it until then.

async function updateFromBase(projectPath, id) {
  const ws = recordOf(projectPath, id);
  if (!ws) return { error: 'This workspace is not available.' };
  const base = await baseOf(projectPath, ws);
  try {
    if (await git.mergeInProgress(ws.path)) {
      return { state: 'conflict', base, files: parseConflicts(await git.conflictedFiles(ws.path)) };
    }
    const dirty = await git.trackedDirtyCount(ws.path);
    if (dirty.error) return { error: `Could not check for uncommitted changes, so nothing was merged: ${dirty.error}` };
    if (dirty.count) return { state: 'dirty', base, count: dirty.count };

    let fetchNote = null;
    const fetched = await git.fetchBranch(ws.path, base);
    if (!fetched.fetched) {
      const known = await git.revCount(ws.path, `origin/${base}`);
      if (!known) return { error: `Could not fetch ${base}: ${fetched.error || 'unknown error'}` };
      fetchNote = `could not fetch — used the last fetched origin/${base}`;
    }
    const behind = await git.revCount(ws.path, `HEAD..origin/${base}`);
    if (!behind) return { state: 'up-to-date', base, ...(fetchNote ? { fetchNote } : {}) };

    const merged = await git.mergeRef(ws.path, `origin/${base}`);
    if (merged.ok) return { state: 'updated', base, commits: behind, ...(fetchNote ? { fetchNote } : {}) };

    if (await git.mergeInProgress(ws.path)) {
      const files = parseConflicts(await git.conflictedFiles(ws.path));
      if (files.length) return { state: 'conflict', base, files };
      await git.abortMerge(ws.path); // stopped for another reason — leave the branch as it was
    }
    return { error: merged.error || 'The merge failed.' };
  } finally {
    refresh(projectPath);
  }
}

/** Abort a stopped update: `git merge --abort`, only while MERGE_HEAD exists. */
async function abortUpdate(projectPath, id) {
  const ws = recordOf(projectPath, id);
  if (!ws) return { error: 'This workspace is not available.' };
  try {
    if (!(await git.mergeInProgress(ws.path))) return { error: null, aborted: false };
    // Only abort the merge an update started (MERGE_HEAD is a commit of
    // origin/<base>): one the user or an agent began is theirs (L13a).
    const base = await baseOf(projectPath, ws);
    if (!(await git.mergeHeadIn(ws.path, `origin/${base}`))) {
      return { error: `The merge in progress is not an update from ${base} — Frame leaves it for you to finish or abort.`, aborted: false };
    }
    const res = await git.abortMerge(ws.path);
    return { error: res.error, aborted: !res.error };
  } finally {
    refresh(projectPath);
  }
}

function setupIPC(ipcMain) {
  // The renderer names the project it shows; that project is the one polled.
  try { wireServer(); } catch (err) { logger.warn('workspaces', `server git state not wired: ${err.message}`); }
  ipcMain.handle(IPC.WORKSPACE_GIT_REFRESH, async (event, { projectPath } = {}) => {
    if (!projectPath) return null;
    watchedProject = projectPath;
    const [local] = await Promise.all([refresh(projectPath), refreshServer(projectPath)]);
    return withServer(local || { projectPath, access: null, workspaces: {} });
  });
  const guarded = (fn) => async (event, payload = {}) => {
    try {
      return await fn(payload);
    } catch (err) {
      logger.error('workspaces', err);
      return { error: err.message || String(err) };
    }
  };
  ipcMain.handle(IPC.WORKSPACE_PUSH, guarded(({ projectPath, id }) => onServer('pr.push', id) || push(projectPath, id)));
  ipcMain.handle(IPC.WORKSPACE_PR_DRAFT, guarded(({ projectPath, id }) => onServer('pr.draft', id) || prDraft(projectPath, id)));
  ipcMain.handle(IPC.WORKSPACE_PR_CREATE, guarded(({ projectPath, id, title, body, draft }) => onServer('pr.create', id, { title, body, draft }) || prCreate(projectPath, id, { title, body, draft })));
  ipcMain.handle(IPC.WORKSPACE_PR_MERGE, guarded(({ projectPath, id }) => onServer('pr.merge', id) || merge(projectPath, id)));
  ipcMain.handle(IPC.WORKSPACE_UPDATE_FROM_BASE, guarded(({ projectPath, id }) => onServer('update.run', id) || updateFromBase(projectPath, id)));
  ipcMain.handle(IPC.WORKSPACE_UPDATE_ABORT, guarded(({ projectPath, id }) => onServer('update.abort', id) || abortUpdate(projectPath, id)));
}

module.exports = { init, setupIPC, refresh, setWatched,
  watched, getState, activeWorkspaces, push, prDraft, prCreate, merge, updateFromBase, abortUpdate, PR_FIELDS };
