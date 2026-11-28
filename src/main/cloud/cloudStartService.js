/**
 * cloudStartService — the Electron shell around starting a shaped Frame
 * Cloud work brief.
 *
 * Holds no checks or ordering (that is cloudStart.js). It resolves the
 * folder's connected project, reads the brief and the folder's git state for
 * the Start Work dialog (`CLOUD_BRIEF_START_PREPARE`), and wires the real
 * effects into the core's handler for the start itself (`CLOUD_BRIEF_START`):
 * git through gitBranchesManager (an `origin/` base is fetched first; the
 * branch is cut, and checked out only for a part begun in the project
 * checkout), the
 * part's workspace through workspaceManager.create, spec folders through
 * fsSafe under the workspace's spec path, and task rows through tasksManager
 * into the main checkout in one round.
 * It also keeps `<userData>/cloud-starts.json`, the parts this machine began,
 * on which branch and from which commit, and sends a begun part's branch to
 * the cloud (`brief.recordBranch`). The token and every write stay in main.
 *
 * A part can also start on a saved Frame Server (frame-cloud-start-on-server):
 * the start's effects are then bound to that server's link — its preflight
 * (`workspaces.preflight`, after the project is sent if missing), the
 * workspace cut there (`workspaceManager.create({ from: 'new', branch,
 * location: 'server' })`), `specs.create` and `tasks.insert`. The begun
 * record keeps the server's key, and a server part stands while that server
 * has its branch (`git.branches` on its clone) or cannot say. Nothing is
 * mirrored onto this Mac, and a server that fails is never replaced by
 * another or by the Mac.
 *
 * A part can also start in the project checkout itself
 * (frame-cloud-start-places): the dialog is told the checkout's branch, its
 * uncommitted changes and the begun part that keeps it busy, and the start
 * reads them again (`checkoutState`), cuts and checks the branch out there,
 * and writes the part into the project folder. Nothing is ever stashed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const { IPC } = require('../../shared/ipcChannels');
const { FRAME_FILES } = require('../../shared/frameConstants');
const { isValidBranchName } = require('../../shared/gitRefNames');
const fsSafe = require('../fsSafe');
const frameStore = require('../frameStore');
const logger = require('../logger');
const tasksManager = require('../tasksManager');
const specManager = require('../specManager');
const git = require('../gitBranchesManager');
const workspaceManager = require('../workspaceManager');
const cloudProjectsService = require('./cloudProjectsService');
const { getBrief, recordBranch } = require('./cloudBriefs');
const core = require('./cloudStart');

const BEGUN_FILE = 'cloud-starts.json';

/** How long a begun server part's branch list may take before it reads as unknown. */
const SERVER_BRANCHES_MS = 5000;
/** The preflight fetches the base on the server. */
const SERVER_PREFLIGHT_MS = 60 * 1000;

let mainWindow = null;
let begunStore = null; // loaded on first use

// ─── Begun parts ──────────────────────────────────────────────

function begunPath() {
  return path.join(app.getPath('userData'), BEGUN_FILE);
}

/** The parts this machine began (`<userData>/cloud-starts.json`), read once. */
function begun() {
  if (!begunStore) {
    const { data, error } = fsSafe.readJsonWithRecovery(begunPath());
    if (error) logger.warn('cloudStart', `could not read ${begunPath()}`);
    begunStore = core.normalizeBegun(data || core.emptyBegun());
  }
  return begunStore;
}

/** Record a part as begun on `branch`. A failed save is logged: the part is begun either way. */
function recordBegun(entry) {
  begunStore = core.addBegun(begun(), entry);
  try {
    fsSafe.writeFileAtomic(begunPath(), JSON.stringify(begunStore, null, 2));
  } catch (err) {
    logger.warn('cloudStart', `could not save ${BEGUN_FILE}: ${err.message}`);
  }
}

/** This machine's record of a begun part (`{ ref, branch, begunAt, baseSha?, serverKey? }`), or null. */
function begunEntry(projectId, number, partId) {
  return core.getBegun(begun(), projectId, number, partId);
}

/**
 * Send a begun part's branch to the cloud. Begin fires it and never waits:
 * a failure is logged here, and the next Briefs read sends it again. A role
 * without `work` sends nothing — the server would only refuse it.
 */
async function sendBranch(input) {
  if (!cloudProjectsService.can('work')) return;
  const result = await cloudProjectsService.call((ctx) => recordBranch({ ...ctx, ...input }));
  if (!result.ok) logger.warn('cloudStart', `could not record the branch of part ${input.partId}: ${result.reason}`);
}

function serverConnection() {
  return require('../serverConnection');
}

/** The saved server's host, or null. */
function hostOf(serverKey) {
  try {
    const link = serverConnection().of(serverKey);
    return link ? link.host : null;
  } catch {
    return null;
  }
}

/** Is the folder's project keeping Frame files out of git? Then no server can hold its parts. */
function localMode(folderPath) {
  try {
    return require('../gitSharing').getMode(folderPath) === 'local';
  } catch {
    return false;
  }
}

/**
 * The local branch names in a server's clone of the folder's project, or
 * null when that cannot be said: the server is offline, holds no copy we can
 * find, or does not answer in time. Null keeps a begun part standing.
 */
async function serverBranches(folderPath, serverKey) {
  const sp = await workspaceManager.serverProject(folderPath, serverKey);
  if (sp.error || !sp.serverProjectPath) return null;
  try {
    const list = await sp.link.call('git.branches', { root: sp.serverProjectPath }, SERVER_BRANCHES_MS);
    if (!list || list.error || !Array.isArray(list.branches)) return null;
    return new Set(list.branches.filter((b) => b && !b.isRemote).map((b) => b.name));
  } catch (err) {
    logger.warn('cloudStart', `could not list the branches on ${sp.host}: ${err.message}`);
    return null;
  }
}

/**
 * `{ [serverKey]: Set | null }` for every saved server (D13): the branches
 * of each server that `keys` names, read once each; null for the rest.
 */
async function serverBranchSets(folderPath, keys) {
  const out = {};
  let saved = [];
  try { saved = serverConnection().all(); } catch { saved = []; }
  for (const link of saved) out[link.key] = null;
  const wanted = [...new Set(keys)].filter((k) => Object.prototype.hasOwnProperty.call(out, k));
  await Promise.all(wanted.map(async (key) => { out[key] = await serverBranches(folderPath, key); }));
  return out;
}

/** The servers this project's begun parts were begun on. */
function begunServerKeys(projectId) {
  const prefix = `${projectId}:`;
  const keys = [];
  for (const [key, entry] of Object.entries(begun().begun)) {
    if (key.startsWith(prefix) && entry && entry.serverKey) keys.push(entry.serverKey);
  }
  return keys;
}

/** The Mac's local branch names from a gitBranchesManager list, or null. */
function localNames(list) {
  return list && !list.error && Array.isArray(list.branches)
    ? new Set(list.branches.filter((b) => !b.isRemote).map((b) => b.name))
    : null;
}

/** `p` with the home folder shown as `~`, as the dialog prints paths. */
function shortPath(p) {
  const home = os.homedir();
  return home && (p === home || p.startsWith(home + path.sep)) ? `~${p.slice(home.length)}` : p;
}

/**
 * Is a checkout part's record finished in the project folder (D1)? Its spec
 * when `.frame/specs/<ref>/status.json` exists (phase `done`), else its
 * `tasks.json` row (`completed`). A record that cannot be found is not
 * finished, so the checkout stays locked rather than switched from under it.
 * The tasks file is read at most once per answer.
 */
function finishedIn(folderPath) {
  let tasks = null;
  return (entry) => {
    try {
      const statusPath = path.join(frameStore.resolveSpecDir(folderPath, entry.ref), 'status.json');
      if (fs.existsSync(statusPath)) return JSON.parse(fs.readFileSync(statusPath, 'utf8')).phase === 'done';
    } catch {
      return false;
    }
    if (!tasks) {
      const data = tasksManager.loadTasks(folderPath);
      tasks = data && Array.isArray(data.tasks) ? data.tasks : [];
    }
    const row = tasks.find((t) => t && t.id === entry.ref);
    return Boolean(row && row.status === 'completed');
  };
}

/**
 * The project checkout as Start Work reads it: its current branch ('' when
 * HEAD is detached), how many changes `git status --porcelain` lists, and the
 * begun part that keeps it busy (core.checkoutBusy). Throws when git cannot
 * tell the changes.
 */
async function checkoutState(folderPath, projectId) {
  const [branch, status] = await Promise.all([git.currentBranch(folderPath), git.isWorkingTreeClean(folderPath)]);
  if (!status || status.error || !Array.isArray(status.changes)) throw new Error((status && status.error) || 'git status failed');
  return {
    branch: branch || '',
    changes: status.changes.length,
    busy: core.checkoutBusy(begun(), projectId, branch, finishedIn(folderPath)),
  };
}

/** Does a begun entry still stand in the way of Begin (D14)? Answered by core.begunLive. */
async function begunStands(folderPath, entry) {
  if (!entry.serverKey) return git.localBranchExists(entry.branch, folderPath);
  return core.begunLive(entry, null, await serverBranchSets(folderPath, [entry.serverKey]));
}

/**
 * The listed briefs with each part's `begunBranch`, for the folder's cloud
 * project. A part begun on a branch this folder no longer has reads as not
 * begun; a part begun on a server, by that server's branches (D13). When the
 * Mac's branches cannot be read, every Mac entry counts.
 */
async function withBegunBranches(briefs, projectId, folderPath) {
  let localBranches = null;
  try {
    localBranches = localNames(await git.loadBranches(folderPath));
  } catch (err) {
    logger.warn('cloudStart', `could not list branches: ${err.message || err.error}`);
  }
  const servers = await serverBranchSets(folderPath, begunServerKeys(projectId));
  return core.withBegunBranches(briefs, begun(), projectId, localBranches, servers);
}

/**
 * Every spec slug the project holds, across checkouts: the folder names in
 * the main checkout's `.frame/specs/` (a folder that is not a valid spec
 * still takes its name) and every slug specManager lists, which adds the
 * specs living in active workspaces. A part started in a workspace writes its
 * spec there, so the main folder alone would hand out a slug already taken.
 */
function specSlugs(folderPath) {
  const slugs = new Set();
  try {
    for (const entry of fs.readdirSync(frameStore.specsRoot(folderPath), { withFileTypes: true })) {
      if (entry.isDirectory()) slugs.add(entry.name);
    }
  } catch {
    // No specs folder yet: nothing taken here.
  }
  try {
    for (const spec of specManager.listSpecs(folderPath)) {
      if (spec && typeof spec.slug === 'string' && spec.slug) slugs.add(spec.slug);
    }
  } catch (err) {
    logger.warn('cloudStart', `could not list the workspaces' specs: ${err.message}`);
  }
  return [...slugs];
}

/** Every task id the project holds: the Mac's `tasks.json` merged with the cached server tasks (D12). */
function taskIds(folderPath) {
  const data = tasksManager.loadTasks(folderPath);
  const merged = tasksManager.tasksPayload(folderPath, data).tasks;
  const list = merged && Array.isArray(merged.tasks) ? merged.tasks : (data && Array.isArray(data.tasks) ? data.tasks : []);
  return list.map((t) => t && t.id).filter(Boolean);
}

/**
 * Write a spec folder under `root`, the part's workspace. It is created,
 * never overwritten: a folder the new branch already holds fails the write.
 */
function writeSpec(root, slug, files) {
  if (!root) throw new Error('no workspace to write the spec into');
  const dir = frameStore.resolveSpecDir(root, slug);
  if (fs.existsSync(dir)) throw new Error(`.frame/specs/${slug} already exists on this branch`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fsSafe.writeFileAtomic(path.join(dir, name), content);
  }
}

/** Append the task rows in one load/save round, then push the list so the Tasks panel shows them. */
function writeTasks(folderPath, rows) {
  const data = tasksManager.loadTasks(folderPath);
  if (!data || !Array.isArray(data.tasks)) throw new Error('.frame/tasks.json could not be read');
  const taken = new Set(data.tasks.map((t) => t && t.id));
  const clash = rows.find((row) => taken.has(row.id));
  if (clash) throw new Error(`${clash.id} already exists in .frame/tasks.json on this branch`);
  data.tasks.push(...rows);
  data.metadata = data.metadata || {};
  data.metadata.totalCreated = (data.metadata.totalCreated || 0) + rows.length;
  if (!tasksManager.saveTasks(folderPath, data)) throw new Error('.frame/tasks.json could not be written');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.TASKS_DATA, { projectPath: folderPath, tasks: data });
  }
}

/** A gitBranchesManager answer (`{ error }`) as a throw, which is what the core's effects do on failure. */
function orThrow(result) {
  if (result && result.error) throw new Error(result.error);
}

/**
 * Open the part's branch in a new local workspace, the way New Workspace
 * does (naming, the registry, copyFiles, tooling, the setup script).
 * → `{ workspace, setupScript }`; throws on failure.
 */
async function createWorkspace(folderPath, branch, base) {
  const result = await workspaceManager.create(folderPath, { from: 'branch', branch, base: base || undefined });
  orThrow(result);
  if (!result || !result.workspace) throw new Error('the workspace was not created');
  return { workspace: result.workspace, setupScript: result.setupScript || '' };
}

/**
 * The start's effects bound to one saved server (`serverKey`): its
 * preflight — the project sent there first when missing — the workspace cut
 * there, and the spec or task written into it. Every failure names the host.
 */
function serverDeps(folderPath, serverKey) {
  const reach = async () => {
    const sp = await workspaceManager.serverProject(folderPath, serverKey);
    if (sp.error) throw new Error(sp.error);
    if (!sp.serverProjectPath) throw new Error(`${sp.host} no longer holds this project`);
    return sp;
  };
  return {
    serverPreflight: async ({ branch, base }) => {
      const sp = await workspaceManager.serverProject(folderPath, serverKey, { ensure: true });
      if (sp.error) return { ok: false, reason: 'serverUnavailable', detail: sp.error };
      if (!sp.serverProjectPath) return { ok: false, reason: 'serverUnavailable', detail: `${sp.host} could not take this project` };
      try {
        const res = await sp.link.call('workspaces.preflight', { projectPath: sp.serverProjectPath, branch, base }, SERVER_PREFLIGHT_MS);
        // The project went there as a bundle just now: the start's answer says so (T12).
        return { ok: true, ...(res || {}), ...(sp.sent ? { sent: sp.sent } : {}) };
      } catch (err) {
        const msg = err.message || String(err);
        // A server without this spec's methods (D1, D8): update it, never fall back.
        if (/Unknown method/i.test(msg)) return { ok: false, reason: 'serverOld', detail: sp.host };
        return { ok: false, reason: 'serverUnavailable', detail: msg.includes(sp.host) ? msg : `${sp.host}: ${msg}` };
      }
    },
    createWorkspace: async (branch, base) => {
      const result = await workspaceManager.create(folderPath, { from: 'new', branch, base: base || undefined, location: 'server', serverKey });
      orThrow(result);
      if (!result || !result.workspace) throw new Error('the workspace was not created');
      return { workspace: result.workspace, setupScript: result.setupScript || '', startSha: result.startSha || null };
    },
    writeSpec: async (slug, files, root) => {
      const sp = await reach();
      await sp.link.call('specs.create', { projectPath: sp.serverProjectPath, root, slug, files });
    },
    writeTasks: async (rows) => {
      const sp = await reach();
      await sp.link.call('tasks.insert', { projectPath: sp.serverProjectPath, rows });
      // TASKS_DATA carries the new row from the server's list (D11).
      try { await tasksManager.refreshServerTasks(folderPath, { onlyKey: serverKey }); } catch { /* reported inside */ }
    },
  };
}

/**
 * What the Start Work dialog shows. → prepareView's shape (with the
 * checkout's state, each place's base and the workspace folder) plus
 * `localMode`, or `{ ok: false, reason }` for a folder not connected or a
 * failed read.
 */
async function prepare(folderPath, number) {
  const project = cloudProjectsService.connectedProject(folderPath);
  if (!project) return { ok: false, reason: 'notConnected' };
  if (!Number.isInteger(number) || number < 1) return { ok: false, reason: 'other' };
  const read = await cloudProjectsService.call((ctx) => getBrief({ ...ctx, projectSlug: project.slug, number }));
  if (!read.ok) return { ok: false, reason: read.reason };
  const brief = read.value;
  try {
    const [list, local, remote, checkout] = await Promise.all([
      git.loadBranches(folderPath),
      brief.targetBranch ? git.localBranchExists(brief.targetBranch, folderPath) : false,
      brief.targetBranch ? git.remoteBranchExists(brief.targetBranch, folderPath) : false,
      checkoutState(folderPath, project.id),
    ]);
    // A part begun on a branch this folder (or its server) no longer has can
    // be begun again, as the board shows it (the same filter as withBegunBranches).
    const servers = await serverBranchSets(folderPath, begunServerKeys(project.id));
    const [live] = core.withBegunBranches([brief], begun(), project.id, localNames(list), servers);
    const begunBranches = {};
    for (const part of live.parts) {
      if (part.begunBranch) begunBranches[part.id] = part.begunBranch;
    }
    const view = core.prepareView({
      brief,
      base: core.pickBase(brief.targetBranch, { local, remote }),
      begun: begunBranches,
      branches: list && Array.isArray(list.branches) ? list.branches : [],
      targetOn: { local, remote },
      checkout: { ...checkout, path: shortPath(folderPath) },
      workspaceFolder: shortPath(path.join(workspaceManager.workspacesRoot(), path.basename(folderPath))),
    });
    return view.ok ? { ...view, localMode: localMode(folderPath) } : view;
  } catch (err) {
    logger.warn('cloudStart', `could not read the folder: ${err.message}`);
    return { ok: false, reason: 'other' };
  }
}

/** Start the brief: every check again (the renderer is not trusted), then the order. → handleStartRequest's shapes. */
async function start(folderPath, request) {
  const project = cloudProjectsService.connectedProject(folderPath);
  if (!project) return { ok: false, reason: 'notConnected' };
  const forbidden = cloudProjectsService.refuseUnless('work');
  if (forbidden) return forbidden;
  const r = request && typeof request === 'object' ? request : {};
  if (!Number.isInteger(r.number) || r.number < 1) return { ok: false, reason: 'other' };
  const serverKey = typeof r.serverKey === 'string' && r.serverKey ? r.serverKey : null;
  // Server specs and tasks refuse local mode; the desktop decides it (C6).
  if (serverKey && localMode(folderPath)) return { ok: false, reason: 'localMode' };
  try {
    return await core.handleStartRequest({
      number: r.number,
      beginPartId: typeof r.beginPartId === 'string' ? r.beginPartId : null,
      branch: typeof r.branch === 'string' ? r.branch : '',
      base: typeof r.base === 'string' ? r.base : '',
      place: typeof r.place === 'string' ? r.place : undefined,
      serverKey,
    }, {
      call: cloudProjectsService.call,
      projectSlug: project.slug,
      specSlugs: () => specSlugs(folderPath),
      taskIds: () => taskIds(folderPath),
      isValidBranchName,
      localBranchExists: (name) => git.localBranchExists(name, folderPath),
      remoteBranchExists: (name) => git.remoteBranchExists(name, folderPath),
      fetchBase: (name) => git.fetchBranch(folderPath, name),
      begun: (partId) => core.getBegun(begun(), project.id, r.number, partId),
      recordBegun: (entry) => recordBegun({ ...entry, projectId: project.id, number: r.number, begunAt: new Date().toISOString() }),
      // Cut, not checked out — except in the project checkout (frame-cloud-start-places D12).
      createBranch: async (name, base, { track, checkout }) => orThrow(await git.createBranch(folderPath, name, checkout === true, base, { track })),
      branchSha: (name) => git.branchTipSha(folderPath, name),
      createWorkspace: (branch, base) => createWorkspace(folderPath, branch, base),
      recordBranch: (input) => sendBranch(input),
      writeSpec: (slug, files, root) => writeSpec(root, slug, files),
      writeTasks: (rows) => writeTasks(folderPath, rows),
      tasksPath: () => frameStore.resolvePath(folderPath, FRAME_FILES.TASKS),
      begunStands: (entry) => begunStands(folderPath, entry),
      hostOf,
      checkoutState: () => checkoutState(folderPath, project.id),
      checkoutPath: folderPath,
      now: () => new Date().toISOString(),
      // On a server, its own effects replace the Mac's (the core never cuts there).
      ...(serverKey ? serverDeps(folderPath, serverKey) : {}),
    });
  } catch (err) {
    logger.warn('cloudStart', `start failed: ${err.message}`);
    return { ok: false, reason: 'other' };
  }
}

function init(window) {
  mainWindow = window;
}

function setupIPC(ipcMain) {
  ipcMain.handle(IPC.CLOUD_BRIEF_START_PREPARE, (event, folderPath, number) => prepare(folderPath, number));
  ipcMain.handle(IPC.CLOUD_BRIEF_START, (event, folderPath, request) => start(folderPath, request));
}

module.exports = {
  init,
  setupIPC,
  prepare,
  start,
  recordBegun,
  begunEntry,
  withBegunBranches,
};
