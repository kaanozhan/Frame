/**
 * cloudStartService — the Electron shell around starting a shaped Frame
 * Cloud work brief.
 *
 * Holds no checks or ordering (that is cloudStart.js). It resolves the
 * folder's connected project, reads the brief and the folder's git state for
 * the Start Work dialog (`CLOUD_BRIEF_START_PREPARE`), and wires the real
 * effects into the core's handler for the start itself (`CLOUD_BRIEF_START`):
 * git through gitBranchesManager (an `origin/` base is fetched first; the
 * branch is cut, never checked out), the
 * part's workspace through workspaceManager.create, spec folders through
 * fsSafe under the workspace's spec path, and task rows through tasksManager
 * into the main checkout in one round.
 * It also keeps `<userData>/cloud-starts.json`, the parts this machine began,
 * on which branch and from which commit, and sends a begun part's branch to
 * the cloud (`brief.recordBranch`). The token and every write stay in main.
 */

const fs = require('fs');
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

/** This machine's record of a begun part (`{ ref, branch, begunAt, baseSha? }`), or null. */
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

/**
 * The listed briefs with each part's `begunBranch`, for the folder's cloud
 * project. A part begun on a branch this folder no longer has reads as not
 * begun. When the branches cannot be read, every entry counts.
 */
async function withBegunBranches(briefs, projectId, folderPath) {
  let localBranches = null;
  try {
    const list = await git.loadBranches(folderPath);
    if (list && !list.error && Array.isArray(list.branches)) {
      localBranches = new Set(list.branches.filter((b) => !b.isRemote).map((b) => b.name));
    }
  } catch (err) {
    logger.warn('cloudStart', `could not list branches: ${err.message || err.error}`);
  }
  return core.withBegunBranches(briefs, begun(), projectId, localBranches);
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

/** Every task id in `tasks.json`. */
function taskIds(folderPath) {
  const data = tasksManager.loadTasks(folderPath);
  return data && Array.isArray(data.tasks) ? data.tasks.map((t) => t && t.id).filter(Boolean) : [];
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
 * What the Start Work dialog shows. → prepareView's shape, or
 * `{ ok: false, reason }` for a folder not connected or a failed read.
 */
async function prepare(folderPath, number) {
  const project = cloudProjectsService.connectedProject(folderPath);
  if (!project) return { ok: false, reason: 'notConnected' };
  if (!Number.isInteger(number) || number < 1) return { ok: false, reason: 'other' };
  const read = await cloudProjectsService.call((ctx) => getBrief({ ...ctx, projectSlug: project.slug, number }));
  if (!read.ok) return { ok: false, reason: read.reason };
  const brief = read.value;
  try {
    const [list, local, remote] = await Promise.all([
      git.loadBranches(folderPath),
      brief.targetBranch ? git.localBranchExists(brief.targetBranch, folderPath) : false,
      brief.targetBranch ? git.remoteBranchExists(brief.targetBranch, folderPath) : false,
    ]);
    // A part begun on a branch this folder no longer has can be begun again,
    // as the board shows it (the same filter as withBegunBranches).
    const branches = list && !list.error && Array.isArray(list.branches) ? list.branches : null;
    const [live] = core.withBegunBranches([brief], begun(), project.id,
      branches ? new Set(branches.filter((b) => !b.isRemote).map((b) => b.name)) : null);
    const begunBranches = {};
    for (const part of live.parts) {
      if (part.begunBranch) begunBranches[part.id] = part.begunBranch;
    }
    return core.prepareView({
      brief,
      base: core.pickBase(brief.targetBranch, { local, remote }),
      begun: begunBranches,
      branches: list && Array.isArray(list.branches) ? list.branches : [],
    });
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
  try {
    return await core.handleStartRequest({
      number: r.number,
      beginPartId: typeof r.beginPartId === 'string' ? r.beginPartId : null,
      branch: typeof r.branch === 'string' ? r.branch : '',
      base: typeof r.base === 'string' ? r.base : '',
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
      createBranch: async (name, base, { track }) => orThrow(await git.createBranch(folderPath, name, false, base, { track })),
      branchSha: (name) => git.branchTipSha(folderPath, name),
      createWorkspace: (branch, base) => createWorkspace(folderPath, branch, base),
      recordBranch: (input) => sendBranch(input),
      writeSpec: (slug, files, root) => writeSpec(root, slug, files),
      writeTasks: (rows) => writeTasks(folderPath, rows),
      tasksPath: () => frameStore.resolvePath(folderPath, FRAME_FILES.TASKS),
      now: () => new Date().toISOString(),
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
