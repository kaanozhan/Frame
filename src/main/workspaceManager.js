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
async function copyIgnoredFiles(projectPath, worktreePath, patterns = null) {
  // A server workspace is created with the desktop's patterns (server-copy-files):
  // the server's own config may lag behind them, or not exist (local mode).
  const copyFiles = Array.isArray(patterns) ? patterns : settingsFor(projectPath).copyFiles;
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
// Workspaces can also live on Frame Servers — any number of them
// (multi-server-connections). Each server keeps its records (its own
// workspaceManager, same rules); this side lists every saved server's rows
// next to the local ones with `location: 'server'`, `host` and `serverKey`,
// and routes create, status, rename and archive to that server's link. A
// desktop project finds its clone on each server by remote URL. While a
// server is down, its last known rows stay listed as `offline`; the other
// servers are unaffected.

// local projectPath → Map<serverKey, { serverProjectPath, host, serverKey, rows }>:
// every saved server's rows, each server on its own (multi-server-connections).
const serverRows = new Map();

function server() {
  return require('./serverConnection');
}

/** Every saved server's link, in list order. */
function links() {
  try { return server().all(); } catch (_) { return []; }
}

/** The cached entry of one server for `projectPath`, or null. */
function rowsFor(projectPath, serverKey) {
  const byServer = serverRows.get(projectPath);
  return (byServer && byServer.get(serverKey)) || null;
}

function setRows(projectPath, entry) {
  if (!serverRows.has(projectPath)) serverRows.set(projectPath, new Map());
  serverRows.get(projectPath).set(entry.serverKey, entry);
}

/**
 * `[projectPath, entry]` of every saved server, in the saved list's order (the
 * servers are listed in parallel, so the cache's insertion order is whichever
 * answered first): a removed server's rows never list or route.
 */
function currentEntries() {
  const order = links().map((l) => l.key);
  const out = [];
  for (const [projectPath, byServer] of serverRows) {
    for (const key of order) if (byServer.has(key)) out.push([projectPath, byServer.get(key)]);
  }
  return out;
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

/** `link`'s clone of `projectPath`, matched by remote or (no remote) by root commit; null when none. */
async function findOnServer(link, id) {
  const { sameRemote } = require('../shared/serverRouting');
  const clones = (await link.call('projects.list', {})) || [];
  const hit = clones.find((c) => (c.remote && id.origin && (c.remote === id.key || sameRemote(c.remote, id.origin)))
    || (!id.origin && c.root && id.root && c.root === id.root));
  return hit ? hit.projectPath : null;
}

/**
 * Make sure `link`'s server has `projectPath` (server-onboarding): the
 * existing clone, else the project's committed history sent as a git bundle
 * over SSH to that server and cloned there (`projects.receive`). Nothing
 * uncommitted is sent; the count left behind is returned as `sent.uncommitted`.
 */
async function ensureOnServer(projectPath, link) {
  const id = await localIdentity(projectPath);
  if (!id.key) throw new Error('This project has no commits yet — commit something first, then create a server workspace.');
  const existing = await findOnServer(link, id);
  if (existing) return { serverProjectPath: existing, sent: null };

  const crypto = require('crypto');
  const name = `receive-${crypto.randomBytes(6).toString('hex')}.bundle`;
  const local = path.join(os.tmpdir(), `frame-${name}`);
  try {
    const made = await git.createBundle(projectPath, local);
    if (made.error) throw new Error(`Could not package the project: ${made.error}`);
    const host = link.host;
    await require('./serverInstaller').upload(host, local, `.frame-server/tmp/${name}`);
    let res;
    try {
      res = await link.call('projects.receive', { bundlePath: name, originUrl: id.origin, root: id.root, name: path.basename(projectPath) }, 11 * 60 * 1000);
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

/** `link`'s clone of `projectPath`, or null (cached per server; matched by remote or root commit). */
async function serverProjectFor(projectPath, link) {
  const cached = rowsFor(projectPath, link.key);
  if (cached && cached.serverProjectPath) return cached.serverProjectPath;
  const id = await localIdentity(projectPath);
  if (!id.key) return null;
  return findOnServer(link, id);
}

function toServerRow(row, serverProjectPath, link) {
  return { ...row, location: 'server', host: link.host, serverKey: link.key, serverProjectPath };
}

/**
 * One server's workspaces of `projectPath`: `{ rows, archived }`. While the
 * server is down, its last known lists, offline. Archived rows come from the
 * server's own list (archived there, restorable from here).
 */
async function listOn(projectPath, link) {
  const prev = rowsFor(projectPath, link.key);
  const offline = () => (prev
    ? { rows: prev.rows.map((r) => ({ ...r, offline: true })), archived: (prev.archived || []).map((r) => ({ ...r, offline: true })) }
    : { rows: [], archived: [] });
  if (!link.isConnected()) return offline();
  try {
    const sp = await serverProjectFor(projectPath, link);
    if (!sp) {
      if (serverRows.has(projectPath)) serverRows.get(projectPath).delete(link.key);
      return { rows: [], archived: [] };
    }
    const res = await link.call('workspaces.list', { projectPath: sp });
    const rows = ((res && res.workspaces) || []).map((w) => toServerRow(w, sp, link));
    const archived = ((res && res.archived) || []).map((w) => toServerRow(w, sp, link));
    setRows(projectPath, { serverProjectPath: sp, host: link.host, serverKey: link.key, rows, archived });
    return { rows, archived };
  } catch (err) {
    logger.warn('workspaces', `server workspaces of ${projectPath} on ${link.host}: ${err.message}`);
    return offline();
  }
}

/** Every saved server's workspaces of `projectPath`, server by server in list order: `{ workspaces, archived }`. */
async function listServer(projectPath) {
  const perServer = await Promise.all(links().map((link) => listOn(projectPath, link)));
  return { workspaces: perServer.flatMap((p) => p.rows), archived: perServer.flatMap((p) => p.archived) };
}

/**
 * Every known server workspace folder (server-workspace-panels): what panel
 * calls are routed by, each with the server it lives on. Last known rows
 * count while that server is down, so their calls answer "offline" instead
 * of reading this machine's disk.
 */
function serverRoots() {
  const out = [];
  for (const [projectPath, entry] of currentEntries()) {
    for (const r of entry.rows) {
      if (r && r.path && !r.archivedAt) out.push({ root: r.path, id: r.id, host: entry.host, serverKey: entry.serverKey, projectPath, serverProjectPath: entry.serverProjectPath });
    }
  }
  return out;
}

/**
 * Where a workspace id lives on a server, or null when it is not a server
 * workspace. `serverKey` narrows the search to one server.
 */
function serverLocation(workspaceId, serverKey = null) {
  for (const [projectPath, entry] of currentEntries()) {
    if (serverKey && entry.serverKey !== serverKey) continue;
    // Archived rows too: restoring one is routed to its server.
    const row = entry.rows.find((r) => r.id === workspaceId) || (entry.archived || []).find((r) => r.id === workspaceId);
    if (row) return { projectPath, serverProjectPath: entry.serverProjectPath, path: row.path, host: entry.host, serverKey: entry.serverKey, name: row.name };
  }
  return null;
}

/** The connected link of `loc`'s server, or null. */
function linkOfLocation(loc) {
  const link = loc && loc.serverKey ? server().of(loc.serverKey) : null;
  return link && link.isConnected() ? link : null;
}

function serverCall(method, projectPath, id, extra = {}) {
  const loc = serverLocation(id);
  if (!loc) return null;
  const link = linkOfLocation(loc);
  if (!link) return Promise.resolve({ error: `Not connected to ${loc.host || 'the server'}.` });
  return link.call(method, { projectPath: loc.serverProjectPath, id, ...extra }, 11 * 60 * 1000)
    .then((res) => { notifyRenderer(projectPath); return res; })
    .catch((err) => ({ error: err.message }));
}

/**
 * One saved server's link and its clone of `projectPath`, for a caller that
 * talks to that server itself (Start Work on a server,
 * frame-cloud-start-on-server D9): `{ link, host, serverKey,
 * serverProjectPath }`, where `serverProjectPath` is null when the server has
 * no copy. With `ensure`, a missing project is sent first, as creating a
 * workspace sends it, and `sent: { uncommitted }` says so (T12).
 * → `{ error, unsaved? }` for a server no longer saved
 * (`unsaved`), not connected, or one that could not take the project; every
 * error but the unsaved one names the host.
 */
async function serverProject(projectPath, serverKey, { ensure = false } = {}) {
  const link = serverKey ? server().of(serverKey) : null;
  if (!link) return { error: 'That server is no longer in the list.', unsaved: true };
  if (!link.isConnected()) return { error: `Not connected to ${link.host} — connect it first.` };
  try {
    const ensured = ensure ? await ensureOnServer(projectPath, link) : null;
    const serverProjectPath = ensured ? ensured.serverProjectPath : await serverProjectFor(projectPath, link);
    return {
      link, host: link.host, serverKey: link.key, serverProjectPath: serverProjectPath || null,
      ...(ensured && ensured.sent ? { sent: ensured.sent } : {})
    };
  } catch (err) {
    const msg = err.message || String(err);
    return { error: msg.includes(link.host) ? msg : `${link.host}: ${msg}` };
  }
}

/**
 * Create a workspace on one server (`serverKey`). Without a key — a caller
 * that predates several servers — the first connected server is used.
 */
async function createOnServer(projectPath, { from, base, branch, serverKey = null }) {
  const link = serverKey ? server().of(serverKey) : links().find((l) => l.isConnected());
  if (!link) return { error: serverKey ? 'That server is no longer in the list.' : 'Connect to a server first (File ▸ Add Server…).' };
  if (!link.isConnected()) return { error: `Not connected to ${link.host} — connect it first.` };
  try {
    const { serverProjectPath: sp, sent } = await ensureOnServer(projectPath, link);
    // This desktop's copyFiles patterns (server-copy-files): the server copies
    // the matching files it holds in its main copy into the new worktree.
    const copyFiles = settingsFor(projectPath).copyFiles || [];
    const res = await link.call('workspaces.create', { projectPath: sp, from, base, branch, copyFiles }, 11 * 60 * 1000);
    if (!res || res.error) return { error: (res && res.error) || `Could not create the workspace on ${link.host}.` };
    const workspace = toServerRow(res.workspace, sp, link);
    const entry = rowsFor(projectPath, link.key) || { serverProjectPath: sp, host: link.host, serverKey: link.key, rows: [] };
    entry.rows = [...entry.rows.filter((r) => r.id !== workspace.id), workspace];
    setRows(projectPath, entry);
    notifyRenderer(projectPath);
    return {
      error: null, workspace, copied: [], fetch: res.fetch, setupScript: res.setupScript, location: 'server', serverKey: link.key,
      // The commit a new branch was cut from, read on the server (frame-cloud-start-on-server D6).
      ...(res.startSha ? { startSha: res.startSha } : {}),
      ...(sent ? { sent } : {})
    };
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
  sc.on('workspaces.updated', ({ projectPath: sp } = {}, key) => {
    for (const [projectPath, entry] of currentEntries()) {
      if (entry.serverProjectPath === sp && (!key || entry.serverKey === key)) notifyRenderer(projectPath);
    }
  });
  // A removed server's rows go outright: they never list or route again.
  sc.on('removed', (payload, key) => {
    for (const byServer of serverRows.values()) byServer.delete(key);
    all();
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
  return {
    ...local,
    workspaces: [...local.workspaces.map((w) => ({ ...w, location: 'local' })), ...remote.workspaces],
    // Archived on a server too, shown with its host and restorable from here.
    archived: [...(local.archived || []), ...remote.archived]
  };
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
  // The main checkout is git's first worktree; its branch labels the main row.
  const main = worktrees.find((w) => w && w.isMain);
  return {
    error: null,
    isRepo: true,
    mainBranch: main ? (main.branch || (main.detached ? 'detached HEAD' : null)) : null,
    workspaces: withHeadBranch(await withBase(projectPath, registry.activeOf(reconciled)), present),
    archived: registry.archivedOf(reconciled)
  };
}

/**
 * Display only: each row's `headBranch` is the branch git reports for its
 * folder right now, so the sidebar names a branch renamed inside the
 * worktree (an agent's `git branch -m`) the way the status bar does. Null
 * on a detached HEAD. Never stored — the record's `branch` stays what push,
 * PR and every other action use.
 */
function withHeadBranch(rows, worktrees) {
  const key = (p) => registry.normalizePath(realPath(p));
  const at = new Map(worktrees.map((w) => [key(w.path), w.detached ? null : (w.branch || null)]));
  return rows.map((r) => ({ ...r, headBranch: at.has(key(r.path)) ? at.get(key(r.path)) : null }));
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
 *                    first; a failed fetch falls back to what is local). With
 *                    `branch`, the new branch takes that name instead and the
 *                    workspace is named from its last segment; a name already
 *                    taken is refused (frame-cloud-start-on-server D6).
 *   from: 'branch' → an existing branch (local, or remote-only via git's DWIM)
 * A new branch's answer carries `startSha`, the commit it was cut from.
 */
async function create(projectPath, { from = 'new', base, branch, location = 'local', serverKey = null, copyFiles = null } = {}) {
  if (!projectPath) return { error: 'No project selected' };
  // Branch text from the dialog (or the server protocol) reaches git argv:
  // refuse anything that is not a plain branch name before any git runs
  // (workspace-hardening X1 — `--upload-pack=<cmd>` as a base ran a command).
  if (base !== undefined && base !== null && base !== '' && !isValidBranchName(base)) return { error: `"${base}" is not a valid base branch name.` };
  const named = branch !== undefined && branch !== null && branch !== '';
  if ((from === 'branch' || named) && !isValidBranchName(branch)) return { error: `"${branch}" is not a valid branch name.` };
  if (location === 'server') return createOnServer(projectPath, { from, base, branch, serverKey });
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

    if (named) {
      // The caller's branch name (Start Work on a server): never reused.
      if (await git.localBranchExists(branch, projectPath)) return { error: `Branch "${branch}" already exists.` };
      targetBranch = branch;
      name = uniquify(toSlug(branch.split('/').pop()) || nextName(takenNames), takenNames);
    } else {
      // Pick a name whose folder and branch are both free.
      const taken = [...takenNames];
      for (;;) {
        name = nextName(taken);
        targetBranch = `${settings.branchPrefix}/${name}`;
        if (!(await git.localBranchExists(targetBranch, projectPath))) break;
        taken.push(name);
      }
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

  const copied = await copyIgnoredFiles(projectPath, worktreePath, copyFiles);
  tooling.provision(projectPath, worktreePath);
  notify(projectPath);
  return { error: null, workspace: result.record, copied, fetch, setupScript: settings.setupScript, ...(from !== 'branch' ? { startSha } : {}) };
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
  // A workspace archived on a server is restored there.
  const routed = serverCall('workspaces.restore', projectPath, id);
  if (routed) return routed;
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
  ipcMain.handle(IPC.WORKSPACE_PROVISION, guarded(({ projectPath, id }) => provision(projectPath, id)));
  ipcMain.handle(IPC.WORKSPACE_REMOVE_RECORD, guarded(({ projectPath, id }) => serialize(projectPath, () => removeRecord(projectPath, id))));
}

/**
 * Refresh Frame's gitignored tooling in a workspace (on selection): copied
 * from the main checkout for a local one; for a server one, its Frame Server
 * stages it there (server-workspace-tooling). A Frame Server that predates
 * `workspaces.provision`, or one that is down, is skipped quietly — the next
 * spec command provisions again. The workspace list is not reloaded for it.
 */
async function provision(projectPath, id) {
  const loc = serverLocation(id);
  if (loc) {
    const link = linkOfLocation(loc);
    if (!link || !link.isConnected()) return { error: null, copied: [] };
    try {
      const res = await link.call('workspaces.provision', { projectPath: loc.serverProjectPath, id }, 60 * 1000);
      return { error: null, copied: (res && Array.isArray(res.copied)) ? res.copied : [] };
    } catch (err) {
      if (!/Unknown method/i.test(err.message || '')) logger.warn('workspaces', `could not provision ${loc.name || id} on ${loc.host}: ${err.message}`);
      return { error: null, copied: [] };
    }
  }
  const record = registry.findById(records(projectPath), id);
  if (!record || record.archivedAt || !fs.existsSync(record.path)) return { error: null, copied: [] };
  return { error: null, copied: tooling.provision(projectPath, record.path) };
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
  serverProject,
  provision,
  status,
  baseForBranch,
  create,
  archive,
  archiveQueued,
  restore,
  rename,
  removeRecord
};
