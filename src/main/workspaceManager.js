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
const { selectFiles, dirsToExpand } = require('../shared/copyFilesMatch');
const projectRegistry = require('./projectRegistry');
const tooling = require('./workspaceTooling');
const git = require('./gitBranchesManager');
const { isValidBranchName } = require('../shared/gitRefNames');
const prFlow = require('../shared/prFlow');
const userSettings = require('./userSettings');
const logger = require('./logger');

const DEFAULT_ROOT = path.join(os.homedir(), 'frame', 'workspaces');

let mainWindow = null;
const queues = new Map(); // projectPath → tail promise

function init(window) {
  mainWindow = window;
  try { wireServerEvents(); } catch (err) { logger.warn('workspaces', `server events not wired: ${err.message}`); }
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
  // …and so does their git / PR state (workspace-pr-flow).
  require('./workspaceGitState').refresh(projectPath);
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
  // Files inside fully ignored folders that a pattern reaches into (L10).
  for (const dir of dirsToExpand(paths, copyFiles)) {
    const inner = await git.listIgnoredIn(projectPath, dir);
    chosen.push(...selectFiles(inner, copyFiles));
  }
  const copied = [];
  for (const rel of chosen) {
    const clean = rel.replace(/\/+$/, '');
    const src = path.join(projectPath, clean);
    const dest = path.join(worktreePath, clean);
    try {
      if (fs.existsSync(dest)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      // verbatimSymlinks: a relative link stays relative instead of being
      // rewritten to point back into the main checkout (L9).
      fs.cpSync(src, dest, { recursive: true, errorOnExist: false, force: false, verbatimSymlinks: true });
      copied.push(clean);
    } catch (err) {
      logger.warn('workspaces', `could not copy ${clean}: ${err.message}`);
    }
  }
  return copied;
}

// ─── Queries ─────────────────────────────────────────────────

/** Records reconciled against `git worktree list`; `isRepo` false when git cannot read the project. */
// ─── Server workspaces (server-workspaces spec) ──────────────
//
// Workspaces can also live on the connected Frame Server. The server keeps
// their records (its own workspaceManager, same rules); this side lists
// them next to the local ones with `location: 'server'` and routes create,
// status, rename and archive by location. A desktop project finds its server
// clone by remote URL. While disconnected, the last known server rows stay
// listed as `offline`.

const serverRows = new Map(); // local projectPath → { serverProjectPath, host, rows }

function server() {
  return require('./serverConnection');
}

/** The host the desktop is (or was last) connected to. */
function currentHost() {
  try { return server().getStatus().host || null; } catch (_) { return null; }
}

/**
 * Cached server rows of `projectPath`, only when they belong to the current
 * host: another host's clone and workspaces never list or route here
 * (server-hardening T2).
 */
function rowsFor(projectPath) {
  const entry = serverRows.get(projectPath);
  return entry && entry.host === currentHost() ? entry : null;
}

/** The current host's entries only. */
function currentEntries() {
  const host = currentHost();
  return [...serverRows].filter(([, entry]) => entry.host === host);
}

async function originOf(projectPath) {
  try {
    const { stdout } = await git.execGitArgs(['remote', 'get-url', 'origin'], projectPath);
    return stdout.trim() || null;
  } catch (_) {
    return null;
  }
}

/** How the server knows `projectPath`: its remote, its root commit, and the key (serverRouting.projectKey). */
async function localIdentity(projectPath) {
  const origin = await originOf(projectPath);
  const root = await git.rootCommit(projectPath);
  const { projectKey } = require('../shared/serverRouting');
  return { origin, root, key: projectKey({ originUrl: origin, root }) };
}

/** The server's clone of `projectPath`, matched by remote or (no remote) by root commit; null when none. */
async function findOnServer(projectPath, id) {
  const { sameRemote } = require('../shared/serverRouting');
  const clones = (await server().call('projects.list', {})) || [];
  const hit = clones.find((c) => (c.remote && id.origin && (c.remote === id.key || sameRemote(c.remote, id.origin)))
    || (!id.origin && c.root && id.root && c.root === id.root));
  return hit ? hit.projectPath : null;
}

/**
 * Make sure the server has `projectPath` (server-onboarding): the existing
 * clone, else the project's committed history sent as a git bundle over SSH
 * and cloned there (`projects.receive`). Nothing uncommitted is sent; the
 * count left behind is returned as `sent.uncommitted`.
 */
async function ensureOnServer(projectPath) {
  const id = await localIdentity(projectPath);
  if (!id.key) throw new Error('This project has no commits yet — commit something first, then create a server workspace.');
  const existing = await findOnServer(projectPath, id);
  if (existing) return { serverProjectPath: existing, sent: null };

  const crypto = require('crypto');
  const name = `receive-${crypto.randomBytes(6).toString('hex')}.bundle`;
  const local = path.join(os.tmpdir(), `frame-${name}`);
  try {
    const made = await git.createBundle(projectPath, local);
    if (made.error) throw new Error(`Could not package the project: ${made.error}`);
    const host = server().getStatus().host;
    await require('./serverInstaller').upload(host, local, `.frame-server/tmp/${name}`);
    let res;
    try {
      res = await server().call('projects.receive', { bundlePath: name, originUrl: id.origin, root: id.root, name: path.basename(projectPath) }, 11 * 60 * 1000);
    } catch (err) {
      if (/Unknown method/i.test(err.message)) throw new Error(`Update Frame Server on ${host} to send projects from this Mac (Connect to Server ▸ Update).`);
      throw err;
    }
    const st = await git.worktreeStatus(projectPath);
    return { serverProjectPath: res.projectPath, sent: { uncommitted: Number(st.count) || 0 } };
  } finally {
    try { fs.rmSync(local, { force: true }); } catch (_) { /* gone */ }
  }
}

/** The server's clone of `projectPath`, or null (cached per host; matched by remote or root commit). */
async function serverProjectFor(projectPath) {
  const cached = rowsFor(projectPath);
  if (cached && cached.serverProjectPath) return cached.serverProjectPath;
  const id = await localIdentity(projectPath);
  if (!id.key) return null;
  return findOnServer(projectPath, id);
}

function toServerRow(row, serverProjectPath, host) {
  return { ...row, location: 'server', host, serverProjectPath };
}

async function listServer(projectPath) {
  const prev = rowsFor(projectPath);
  const offline = () => (prev ? prev.rows.map((r) => ({ ...r, offline: true })) : []);
  if (!server().isConnected()) return offline();
  try {
    const sp = await serverProjectFor(projectPath);
    if (!sp) { serverRows.delete(projectPath); return []; }
    const res = await server().call('workspaces.list', { projectPath: sp });
    const host = server().getStatus().host;
    const rows = ((res && res.workspaces) || []).map((w) => toServerRow(w, sp, host));
    serverRows.set(projectPath, { serverProjectPath: sp, host, rows });
    return rows;
  } catch (err) {
    logger.warn('workspaces', `server workspaces for ${projectPath}: ${err.message}`);
    return offline();
  }
}

/**
 * Every known server workspace folder (server-workspace-panels): what panel
 * calls are routed by. Last known rows count while disconnected, so their
 * calls answer "offline" instead of reading this machine's disk.
 */
function serverRoots() {
  const out = [];
  for (const [projectPath, entry] of currentEntries()) {
    for (const r of entry.rows) {
      if (r && r.path && !r.archivedAt) out.push({ root: r.path, id: r.id, host: entry.host, projectPath, serverProjectPath: entry.serverProjectPath });
    }
  }
  return out;
}

/** Where a workspace id lives on the server, or null when it is not a server workspace. */
function serverLocation(workspaceId) {
  for (const [projectPath, entry] of currentEntries()) {
    const row = entry.rows.find((r) => r.id === workspaceId);
    if (row) return { projectPath, serverProjectPath: entry.serverProjectPath, path: row.path, host: entry.host, name: row.name };
  }
  return null;
}

function serverCall(method, projectPath, id, extra = {}) {
  const loc = serverLocation(id);
  if (!loc) return null;
  if (!server().isConnected()) return Promise.resolve({ error: `Not connected to ${loc.host || 'the server'}.` });
  return server().call(method, { projectPath: loc.serverProjectPath, id, ...extra }, 11 * 60 * 1000)
    .then((res) => { notifyRenderer(projectPath); return res; })
    .catch((err) => ({ error: err.message }));
}

async function createOnServer(projectPath, { from, base, branch }) {
  if (!server().isConnected()) return { error: 'Connect to a server first (File ▸ Connect to Server…).' };
  try {
    const { serverProjectPath: sp, sent } = await ensureOnServer(projectPath);
    const res = await server().call('workspaces.create', { projectPath: sp, from, base, branch }, 11 * 60 * 1000);
    if (!res || res.error) return { error: (res && res.error) || 'Could not create the workspace on the server.' };
    const host = server().getStatus().host;
    const workspace = toServerRow(res.workspace, sp, host);
    const entry = rowsFor(projectPath) || { serverProjectPath: sp, host, rows: [] };
    entry.rows = [...entry.rows.filter((r) => r.id !== workspace.id), workspace];
    serverRows.set(projectPath, entry);
    notifyRenderer(projectPath);
    return { error: null, workspace, copied: [], fetch: res.fetch, setupScript: res.setupScript, location: 'server', ...(sent ? { sent } : {}) };
  } catch (err) {
    return { error: err.message };
  }
}

/** Tell the renderer only (no spec/git refresh — those are local concerns). */
function notifyRenderer(projectPath) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.WORKSPACES_UPDATED, { projectPath });
}

let serverWired = false;
function wireServerEvents() {
  if (serverWired) return;
  serverWired = true;
  const sc = server();
  sc.on('workspaces.updated', ({ projectPath: sp } = {}) => {
    for (const [projectPath, entry] of currentEntries()) if (entry.serverProjectPath === sp) notifyRenderer(projectPath);
  });
  // Another host: the previous host's rows are dropped outright (T2).
  sc.on('connected', (s) => {
    const host = (s && s.host) || currentHost();
    for (const [projectPath, entry] of [...serverRows]) if (entry.host !== host) serverRows.delete(projectPath);
  });
  const all = () => {
    for (const p of projectRegistry.getProjects()) notifyRenderer(p.path);
  };
  sc.on('connected', all);
  sc.on('disconnected', all);
}

async function list(projectPath) {
  if (!projectPath) return { error: 'No project selected', isRepo: false, workspaces: [], archived: [] };
  const local = await listLocal(projectPath);
  if (local.error || !local.isRepo) return local;
  const remote = await listServer(projectPath);
  return { ...local, workspaces: [...local.workspaces.map((w) => ({ ...w, location: 'local' })), ...remote] };
}

function realPath(p) {
  try { return fs.realpathSync(p); } catch (_) { return p; }
}

async function listLocal(projectPath) {
  const { error, worktrees } = await git.loadWorktrees(projectPath);
  if (error) return { error, isRepo: false, workspaces: [], archived: [] };
  // `git worktree list` keeps a deleted folder until `worktree prune`, so a
  // row only counts when its folder is still on disk.
  const present = worktrees.filter((w) => w && w.path && fs.existsSync(w.path));
  const reconciled = registry.reconcile(records(projectPath), present, { canon: realPath });
  return {
    error: null,
    isRepo: true,
    workspaces: await withBase(projectPath, registry.activeOf(reconciled)),
    archived: registry.archivedOf(reconciled)
  };
}

/**
 * Records stored before workspaces knew their base (`base: null`) read as the
 * remote's default branch; nothing is migrated (workspace-hardening B2).
 */
async function withBase(projectPath, rows) {
  if (!rows.some((r) => !r.base)) return rows;
  const def = (await git.defaultRemoteBranch(projectPath)).branch || null;
  return rows.map((r) => (r.base ? r : { ...r, base: def }));
}

/** The base to prefill for a workspace opened from `branch` (decision B2). */
async function baseForBranch(projectPath, branch) {
  if (!projectPath || !isValidBranchName(branch)) return { error: 'Choose a branch.', base: null };
  const [upstream, def] = await Promise.all([
    git.upstreamOfBranch(projectPath, branch),
    git.defaultRemoteBranch(projectPath)
  ]);
  return { error: null, base: prFlow.baseForBranch({ branch, upstream, defaultBranch: def.branch }) };
}

async function status(projectPath, id) {
  const routed = serverCall('workspaces.status', projectPath, id);
  if (routed) return routed;
  const record = registry.findById(records(projectPath), id);
  if (!record) return { error: `No workspace "${id}".`, dirty: false, count: 0 };
  const st = await git.worktreeStatus(record.path);
  if (st.error) return st;
  const head = await git.headState(record.path, record.branch);
  return { ...st, head: head.error ? null : head };
}

// ─── Mutations ───────────────────────────────────────────────

/**
 * Create a workspace.
 *   from: 'new'    → new branch `<prefix>/<name>` off `origin/<base>` (fetched
 *                    first; a failed fetch falls back to what is local)
 *   from: 'branch' → an existing branch (local, or remote-only via git's DWIM)
 */
async function create(projectPath, { from = 'new', base, branch, location = 'local' } = {}) {
  if (!projectPath) return { error: 'No project selected' };
  // Branch text from the dialog (or the server protocol) reaches git argv:
  // refuse anything that is not a plain branch name before any git runs
  // (workspace-hardening X1 — `--upload-pack=<cmd>` as a base ran a command).
  if (base !== undefined && base !== null && base !== '' && !isValidBranchName(base)) return { error: `"${base}" is not a valid base branch name.` };
  if (from === 'branch' && !isValidBranchName(branch)) return { error: `"${branch}" is not a valid branch name.` };
  if (location === 'server') return createOnServer(projectPath, { from, base, branch });
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
    // A real base, never an assumed `main` (workspace-hardening L4): the
    // dialog's choice, else what the dialog would have prefilled.
    if (!base) base = (await baseForBranch(projectPath, branch)).base;
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

  // The commit a new branch starts at: a failed create deletes the branch
  // only while it still points there (L13c, compare-and-swap).
  let startSha = null;
  if (from !== 'branch') {
    try { startSha = (await git.execGitArgs(['rev-parse', '--verify', '-q', `${startPoint}^{commit}`], projectPath)).stdout.trim() || null; } catch (_) { startSha = null; }
  }
  const dropNewBranch = async () => {
    if (!startSha) return;
    // Frame's own half-finished create, never a user branch: a recorded
    // exception to "never deletes a branch" (workspace-hardening plan, L13c).
    await git.execGitArgs(['update-ref', '-d', `refs/heads/${targetBranch}`, startSha], projectPath).catch(() => {});
  };

  const added = await git.addWorkspaceWorktree(projectPath, worktreePath, {
    branch: targetBranch,
    createBranch: from !== 'branch',
    startPoint
  });
  if (added.error) {
    await dropNewBranch();
    return { error: added.error };
  }

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
    await dropNewBranch();
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
async function archive(projectPath, id, { action, message, rescue = false } = {}) {
  const routed = serverCall('workspaces.archive', projectPath, id, { action, message, rescue });
  if (routed) return routed;
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
    // Commits no branch holds (a detached HEAD, or a branch switched away
    // from) would go with the worktree. Stop and report them unless the user
    // chose a rescue branch (workspace-hardening L3, decision B1).
    const head = await git.headState(record.path, record.branch);
    if (head.error) return { error: head.error };
    if (head.unreachable > 0) {
      if (!rescue) return { error: null, headOff: { unreachable: head.unreachable, sha: head.sha, detached: head.detached, ref: head.ref } };
      const rescueBranch = `${record.branch}-rescue-${head.sha.slice(0, 7)}`;
      try {
        await git.execGitArgs(['branch', '--', rescueBranch, head.sha], projectPath);
      } catch (err) {
        return { error: `Could not create ${rescueBranch}: ${err.error || err.message}` };
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
  const routed = serverCall('workspaces.rename', projectPath, id, { name, branch });
  if (routed) return routed;
  const current = records(projectPath);
  const record = registry.findById(current, id);
  if (!record) return { error: `No workspace "${id}".` };
  const nextLabel = name === undefined ? undefined : toSlug(name);
  if (name !== undefined && !nextLabel) return { error: 'Use letters, numbers or dashes for the name.' };
  const nextBranch = branch === undefined ? undefined : String(branch).trim();

  const result = registry.rename(current, id, { name: nextLabel, branch: nextBranch });
  if (!result.ok) return { error: result.error.message };

  if (nextBranch && nextBranch !== record.branch) {
    // A pushed branch keeps its name here: renaming it locally strands its
    // upstream and its pull request (workspace-hardening L12).
    const upstream = await git.upstreamOfBranch(projectPath, record.branch);
    const onOrigin = await refExists(`refs/remotes/origin/${record.branch}`, projectPath);
    if (upstream || onOrigin) {
      return { error: `${record.branch} has been pushed — rename it on GitHub first, then open the new branch as a workspace.` };
    }
    try {
      // `--` ends options: a name can never be read as one (workspace-hardening L2).
      await git.execGitArgs(['branch', '-m', '--', record.branch, nextBranch], projectPath);
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
  ipcMain.handle(IPC.WORKSPACE_BASE_FOR_BRANCH, guarded(({ projectPath, branch }) => baseForBranch(projectPath, branch)));
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

/** `archive` behind the per-project queue, for callers outside IPC (merge's archive-on-merge). */
function archiveQueued(projectPath, id, opts) {
  return serialize(projectPath, () => archive(projectPath, id, opts));
}

module.exports = {
  init,
  setupIPC,
  workspacesRoot,
  list,
  serverLocation,
  serverRoots,
  status,
  baseForBranch,
  create,
  archive,
  archiveQueued,
  restore,
  rename,
  removeRecord
};
