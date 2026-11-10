/**
 * Workspace Manager — the main-process side of workspaces (workspaces spec).
 *
 * A workspace is a branch + a linked git worktree outside the repo, at
 * `<workspacesRoot>/<repo>/<name>` (default root `~/frame/workspaces`,
 * user setting `workspacesRoot`). Records live in the project registry
 * (`projects[i].workspaces`); the rules over them are the pure
 * `shared/workspaceRegistry`; git runs through gitBranchesManager's argv
 * helpers. This module sequences the three and owns nothing else.
 *
 * Never auto-commits, never force-pushes, never deletes a branch (C4): the
 * archive "commit" and "discard" paths run only when the renderer passes the
 * user's explicit choice.
 *
 * Mutations for one project are serialized, so two clicks never race the
 * registry file.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { IPC } = require('../shared/ipcChannels');
const registry = require('../shared/workspaceRegistry');
const { nextName, toSlug, uniquify } = require('../shared/workspaceNames');
const { selectFiles } = require('../shared/copyFilesMatch');
const projectRegistry = require('./projectRegistry');
const tooling = require('./workspaceTooling');
const git = require('./gitBranchesManager');
const userSettings = require('./userSettings');
const logger = require('./logger');

const DEFAULT_ROOT = path.join(os.homedir(), 'frame', 'workspaces');

let mainWindow = null;
const queues = new Map(); // projectPath → tail promise

function init(window) {
  mainWindow = window;
}

/** Run `fn` after every earlier mutation for this project has settled. */
function serialize(projectPath, fn) {
  const prev = queues.get(projectPath) || Promise.resolve();
  const run = prev.then(fn, fn);
  queues.set(projectPath, run.catch(() => {}));
  return run;
}

function notify(projectPath) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.WORKSPACES_UPDATED, { projectPath });
  }
  // Specs follow their workspaces (spec-in-workspace): watch the new set of
  // specs folders and push the merged list. Lazily required — specManager
  // pulls in frameProject, which this module only needs at call time.
  try {
    require('./specManager').refreshWorkspaceWatchers(projectPath);
  } catch (err) {
    logger.warn('workspaces', `could not refresh spec watchers: ${err.message}`);
  }
}

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Where this machine keeps workspace folders (machine-local user setting). */
function workspacesRoot() {
  const configured = userSettings.get('workspacesRoot');
  return path.resolve(expandHome(typeof configured === 'string' && configured.trim() ? configured.trim() : DEFAULT_ROOT));
}

function projectDir(projectPath) {
  return path.join(workspacesRoot(), path.basename(projectPath));
}

function settingsFor(projectPath) {
  // Lazily required: frameProject requires projectRegistry, which this module also loads.
  return require('./frameProject').getWorkspaceSettings(projectPath);
}

function records(projectPath) {
  return projectRegistry.getWorkspaceRecords(projectPath);
}

function persist(projectPath, next) {
  return projectRegistry.setWorkspaceRecords(projectPath, registry.toStored(next));
}

function listDir(dir) {
  try { return fs.readdirSync(dir); } catch (_) { return []; }
}

function newId() {
  return crypto.randomBytes(4).toString('hex');
}

/**
 * Copy the `copyFiles` selection from the main checkout into a worktree.
 * Only gitignored, untracked paths are candidates (tracked files are already
 * there). Never overwrites a file that exists in the worktree.
 */
async function copyIgnoredFiles(projectPath, worktreePath) {
  const { copyFiles } = settingsFor(projectPath);
  if (!copyFiles.length) return [];
  const { paths } = await git.listIgnoredCandidates(projectPath);
  const chosen = selectFiles(paths, copyFiles);
  const copied = [];
  for (const rel of chosen) {
    const clean = rel.replace(/\/+$/, '');
    const src = path.join(projectPath, clean);
    const dest = path.join(worktreePath, clean);
    try {
      if (fs.existsSync(dest)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(src, dest, { recursive: true, errorOnExist: false, force: false });
      copied.push(clean);
    } catch (err) {
      logger.warn('workspaces', `could not copy ${clean}: ${err.message}`);
    }
  }
  return copied;
}

// ─── Queries ─────────────────────────────────────────────────

/** Records reconciled against `git worktree list`; `isRepo` false when git cannot read the project. */
async function list(projectPath) {
  if (!projectPath) return { error: 'No project selected', isRepo: false, workspaces: [], archived: [] };
  const { error, worktrees } = await git.loadWorktrees(projectPath);
  if (error) return { error, isRepo: false, workspaces: [], archived: [] };
  // `git worktree list` keeps a deleted folder until `worktree prune`, so a
  // row only counts when its folder is still on disk.
  const present = worktrees.filter((w) => w && w.path && fs.existsSync(w.path));
  const reconciled = registry.reconcile(records(projectPath), present);
  return {
    error: null,
    isRepo: true,
    workspaces: registry.activeOf(reconciled),
    archived: registry.archivedOf(reconciled)
  };
}

async function status(projectPath, id) {
  const record = registry.findById(records(projectPath), id);
  if (!record) return { error: `No workspace "${id}".`, dirty: false, count: 0 };
  return git.worktreeStatus(record.path);
}

// ─── Mutations ───────────────────────────────────────────────

/**
 * Create a workspace.
 *   from: 'new'    → new branch `<prefix>/<name>` off `origin/<base>` (fetched
 *                    first; a failed fetch falls back to what is local)
 *   from: 'branch' → an existing branch (local, or remote-only via git's DWIM)
 */
async function create(projectPath, { from = 'new', base, branch } = {}) {
  if (!projectPath) return { error: 'No project selected' };
  const { error: gitError } = await git.loadWorktrees(projectPath);
  if (gitError) return { error: 'This project is not a git repository.' };

  const current = records(projectPath);
  const settings = settingsFor(projectPath);
  const dir = projectDir(projectPath);
  const takenNames = [...current.map((r) => r.name), ...listDir(dir)];

  let name;
  let targetBranch;
  let startPoint = null;
  let fetch = { fetched: false, error: null, skipped: true };

  if (from === 'branch') {
    if (!branch) return { error: 'Choose a branch.' };
    const holder = registry.findByBranch(current, branch);
    if (holder) return { error: `Branch "${branch}" is already open in workspace "${holder.name}".` };
    targetBranch = branch;
    name = uniquify(toSlug(branch.split('/').pop()) || nextName(takenNames), takenNames);
  } else {
    const def = await git.defaultRemoteBranch(projectPath);
    const baseBranch = base || def.branch;
    if (!baseBranch) return { error: def.error || 'Choose a base branch.' };
    const hasOrigin = def.hasOrigin;

    if (hasOrigin) {
      fetch = { ...(await git.fetchBranch(projectPath, baseBranch)), skipped: false };
      startPoint = (await refExists(`refs/remotes/origin/${baseBranch}`, projectPath)) ? `origin/${baseBranch}` : baseBranch;
    } else {
      startPoint = baseBranch;
    }

    // Pick a name whose folder and branch are both free.
    const taken = [...takenNames];
    for (;;) {
      name = nextName(taken);
      targetBranch = `${settings.branchPrefix}/${name}`;
      if (!(await git.localBranchExists(targetBranch, projectPath))) break;
      taken.push(name);
    }
    base = baseBranch;
  }

  const worktreePath = path.join(dir, name);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    return { error: `Could not create ${dir}: ${err.message}` };
  }

  const added = await git.addWorkspaceWorktree(projectPath, worktreePath, {
    branch: targetBranch,
    createBranch: from !== 'branch',
    startPoint
  });
  if (added.error) return { error: added.error };

  const result = registry.add(current, {
    id: newId(),
    name,
    branch: targetBranch,
    base: base || null,
    path: worktreePath,
    now: new Date().toISOString()
  });
  if (!result.ok || !persist(projectPath, result.records)) {
    // Roll the worktree back: a folder nobody tracks is worse than an error.
    await git.removeWorkspaceWorktree(projectPath, worktreePath, true);
    return { error: result.ok ? 'This project is not in the project registry.' : result.error.message };
  }

  const copied = await copyIgnoredFiles(projectPath, worktreePath);
  tooling.provision(projectPath, worktreePath);
  notify(projectPath);
  return { error: null, workspace: result.record, copied, fetch, setupScript: settings.setupScript };
}

async function refExists(ref, projectPath) {
  try {
    await git.execGitArgs(['rev-parse', '--verify', '--quiet', ref], projectPath);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Archive. With uncommitted changes and no `action`, nothing happens and
 * `{ dirty: true }` comes back so the renderer can ask. `action: 'commit'`
 * commits everything with `message`; `'discard'` throws it away. The
 * worktree is then removed (`--force`, which also drops ignored copies such
 * as `.env` and `node_modules`); the branch is kept.
 */
async function archive(projectPath, id, { action, message } = {}) {
  const current = records(projectPath);
  const record = registry.findById(current, id);
  if (!record) return { error: `No workspace "${id}".` };
  if (record.archivedAt) return { error: `Workspace "${record.name}" is already archived.` };

  const exists = fs.existsSync(record.path);
  if (exists) {
    const st = await git.worktreeStatus(record.path);
    if (st.error) return { error: st.error };
    if (st.dirty) {
      if (action === 'commit') {
        const c = await git.commitAll(record.path, message || `WIP: archive ${record.name}`);
        if (c.error) return { error: c.error };
      } else if (action === 'discard') {
        const d = await git.discardAll(record.path);
        if (d.error) return { error: d.error };
      } else {
        return { error: null, dirty: true, count: st.count };
      }
    }
    // Local gitSharing mode: specs written here were never committed — bring
    // them home before the folder goes (spec-in-workspace, D3).
    tooling.handBack(projectPath, record.path);
    const removed = await git.removeWorkspaceWorktree(projectPath, record.path, true);
    if (removed.error) return { error: removed.error };
  } else {
    // Folder already gone (deleted outside Frame): let git forget it.
    await git.execGitArgs(['worktree', 'prune'], projectPath).catch(() => {});
  }

  const result = registry.archive(current, id, new Date().toISOString());
  if (!result.ok) return { error: result.error.message };
  persist(projectPath, result.records);
  notify(projectPath);
  return { error: null, workspace: result.record };
}

/** Restore: recreate the worktree from the branch, copy files again; refused when the branch is open elsewhere. */
async function restore(projectPath, id) {
  const current = records(projectPath);
  const check = registry.restore(current, id);
  if (!check.ok) return { error: check.error.message };
  const record = registry.findById(current, id);
  if (fs.existsSync(record.path)) {
    return { error: `${record.path} already exists. Move or delete it, then restore again.` };
  }
  await git.execGitArgs(['worktree', 'prune'], projectPath).catch(() => {});
  try {
    fs.mkdirSync(path.dirname(record.path), { recursive: true });
  } catch (err) {
    return { error: err.message };
  }
  const added = await git.addWorkspaceWorktree(projectPath, record.path, { branch: record.branch, createBranch: false });
  if (added.error) return { error: added.error };

  persist(projectPath, check.records);
  const copied = await copyIgnoredFiles(projectPath, record.path);
  tooling.provision(projectPath, record.path);
  notify(projectPath);
  return { error: null, workspace: check.record, copied, setupScript: settingsFor(projectPath).setupScript };
}

/** Rename the short name (label only; the folder stays) and/or the branch (`git branch -m`). */
async function rename(projectPath, id, { name, branch } = {}) {
  const current = records(projectPath);
  const record = registry.findById(current, id);
  if (!record) return { error: `No workspace "${id}".` };
  const nextLabel = name === undefined ? undefined : toSlug(name);
  if (name !== undefined && !nextLabel) return { error: 'Use letters, numbers or dashes for the name.' };
  const nextBranch = branch === undefined ? undefined : String(branch).trim();

  const result = registry.rename(current, id, { name: nextLabel, branch: nextBranch });
  if (!result.ok) return { error: result.error.message };

  if (nextBranch && nextBranch !== record.branch) {
    try {
      await git.execGitArgs(['branch', '-m', record.branch, nextBranch], projectPath);
    } catch (err) {
      return { error: err.error || err.message };
    }
  }
  persist(projectPath, result.records);
  notify(projectPath);
  return { error: null, workspace: result.record };
}

/** Forget a record whose worktree is gone (missing) or that is archived. */
async function removeRecord(projectPath, id) {
  const { workspaces } = await list(projectPath);
  const current = records(projectPath);
  const record = registry.findById(current, id);
  if (!record) return { error: `No workspace "${id}".` };
  const live = workspaces.find((w) => w.id === id);
  if (live && !live.missing) return { error: 'Archive the workspace first.' };
  const result = registry.remove(current, id);
  persist(projectPath, result.records);
  await git.execGitArgs(['worktree', 'prune'], projectPath).catch(() => {});
  notify(projectPath);
  return { error: null };
}

// ─── IPC ─────────────────────────────────────────────────────

function setupIPC(ipcMain) {
  const guarded = (fn) => async (event, payload = {}) => {
    try {
      return await fn(payload);
    } catch (err) {
      logger.error('workspaces', err);
      return { error: err.message || String(err) };
    }
  };

  ipcMain.handle(IPC.WORKSPACES_LIST, guarded((projectPath) => list(projectPath)));
  ipcMain.handle(IPC.WORKSPACE_STATUS, guarded(({ projectPath, id }) => status(projectPath, id)));
  ipcMain.handle(IPC.GIT_DEFAULT_BRANCH, guarded((projectPath) => git.defaultRemoteBranch(projectPath)));
  ipcMain.handle(IPC.WORKSPACE_CREATE, guarded(({ projectPath, ...opts }) => serialize(projectPath, () => create(projectPath, opts))));
  ipcMain.handle(IPC.WORKSPACE_ARCHIVE, guarded(({ projectPath, id, ...opts }) => serialize(projectPath, () => archive(projectPath, id, opts))));
  ipcMain.handle(IPC.WORKSPACE_RESTORE, guarded(({ projectPath, id }) => serialize(projectPath, () => restore(projectPath, id))));
  ipcMain.handle(IPC.WORKSPACE_RENAME, guarded(({ projectPath, id, ...opts }) => serialize(projectPath, () => rename(projectPath, id, opts))));
  ipcMain.handle(IPC.WORKSPACE_PROVISION, guarded(({ projectPath, id }) => {
    const record = registry.findById(records(projectPath), id);
    if (!record || record.archivedAt || !fs.existsSync(record.path)) return { error: null, copied: [] };
    return { error: null, copied: tooling.provision(projectPath, record.path) };
  }));
  ipcMain.handle(IPC.WORKSPACE_REMOVE_RECORD, guarded(({ projectPath, id }) => serialize(projectPath, () => removeRecord(projectPath, id))));
}

module.exports = {
  init,
  setupIPC,
  workspacesRoot,
  list,
  status,
  create,
  archive,
  restore,
  rename,
  removeRecord
};
