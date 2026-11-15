/**
 * cloudProjectsService — the Electron shell around Frame Cloud projects.
 *
 * Holds no matching or link logic (that is cloudProjects.js). It takes the
 * bearer token from cloudSession, lists this device's known folders from
 * workspace.js, reads each folder's identity and git remote itself, caches
 * the last `project.list`, and pushes one token-free state object to the
 * renderer on every change.
 *
 * The renderer names a folder by path and a cloud project by id. The folder's
 * `projectId` and remote are always read here, so a renderer can never claim
 * with an identity it made up. `ensureProjectId` runs only inside claim and
 * create — listing never writes into a project.
 *
 * Refreshes are event-based, never on a timer: a session change into
 * signed-in, a request from the modal, and window focus at most once a minute.
 * Nothing here holds the app: every call inherits cloudSession's 15 s timeout.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { app } = require('electron');
const { IPC } = require('../../shared/ipcChannels');
const { FRAME_DIR, FRAME_CONFIG_FILE } = require('../../shared/frameConstants');
const workspace = require('../workspace');
const frameStore = require('../frameStore');
const userSettings = require('../userSettings');
const fsSafe = require('../fsSafe');
const logger = require('../logger');
const cloudSession = require('./cloudSession');
const core = require('./cloudProjects');

const CACHE_FILE = 'cloud-projects.json';
// 2: projects carry `thisDevice` (frame-cloud-teammate-connection); a v1 list
// would read every folder as not connected.
const CACHE_VERSION = 2;
const FOCUS_THROTTLE_MS = 60 * 1000;
const CANDIDATE_CONCURRENCY = 3;
const GIT_TIMEOUT_MS = 5000;
const DISMISS_KEY = 'cloudConnectPromptDismissed';

let mainWindow = null;

// The session this state belongs to: `${serverUrl} ${workspaceSlug}`.
let sessionKey = null;
let signedIn = false;

let projects = []; // normalized project.list, server order
let lastUpdated = null; // ISO time of the list shown
let stale = false; // showing the cache because the server could not be reached
let error = null; // 'network' | 'other' when there is no list at all
let loading = false;
let lastFetchAt = 0;
let refreshing = null;

let folders = []; // [{ path, name, projectId }], display order
let uninitialisedCount = 0;

const plans = new Map(); // path → planFolderRow result
const candidatesLoading = new Set(); // paths
let candidatesGen = 0;

let autoShowPending = false; // a user-started sign-in waiting for its first list
let autoShowDevices = false; // one-shot, cleared after the push that carries it

let lastPermissions = null; // `work,manage` as last pushed for this session, or null

// ─── Folders ──────────────────────────────────────────────────

function hasConfig(folderPath) {
  try {
    return fs.statSync(path.join(folderPath, FRAME_DIR, FRAME_CONFIG_FILE)).isFile();
  } catch {
    return false;
  }
}

/** Known folders with `.frame/config.json`, most recently opened first. Read-only. */
function scanFolders() {
  let known = [];
  try {
    known = workspace.getProjects() || [];
  } catch (err) {
    logger.warn('cloudProjects', 'could not read the known folders');
  }
  const sorted = known
    .filter((p) => p && typeof p.path === 'string')
    .map((p, index) => ({ p, index }))
    .sort((a, b) => {
      const ta = a.p.lastOpenedAt ? Date.parse(a.p.lastOpenedAt) || 0 : 0;
      const tb = b.p.lastOpenedAt ? Date.parse(b.p.lastOpenedAt) || 0 : 0;
      return tb - ta || a.index - b.index;
    })
    .map(({ p }) => p);

  const next = [];
  let skipped = 0;
  for (const p of sorted) {
    if (!hasConfig(p.path)) {
      skipped += 1;
      continue;
    }
    next.push({
      path: p.path,
      name: p.name || path.basename(p.path),
      projectId: frameStore.getProjectId(p.path),
    });
  }
  folders = next;
  uninitialisedCount = skipped;
}

function findFolder(folderPath) {
  return folders.find((f) => f.path === folderPath) || null;
}

/** `git remote get-url origin`, or undefined when there is none. */
function readRemote(folderPath) {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['remote', 'get-url', 'origin'],
      { cwd: folderPath, timeout: GIT_TIMEOUT_MS },
      (err, stdout) => {
        const remote = !err && typeof stdout === 'string' ? stdout.trim() : '';
        resolve(remote || undefined);
      }
    );
  });
}

// ─── Cache ────────────────────────────────────────────────────

function cachePath() {
  return path.join(app.getPath('userData'), CACHE_FILE);
}

function loadCache(serverUrl, workspaceSlug) {
  try {
    const { data } = fsSafe.readJsonWithRecovery(cachePath());
    if (!data || data.version !== CACHE_VERSION) return null;
    if (data.serverUrl !== serverUrl || data.cloudWorkspaceSlug !== workspaceSlug) return null;
    if (!Array.isArray(data.projects)) return null;
    return { projects: data.projects.map(core.normalizeProject), savedAt: data.savedAt || null };
  } catch {
    return null;
  }
}

function saveCache(serverUrl, workspaceSlug) {
  try {
    fsSafe.writeFileAtomic(
      cachePath(),
      JSON.stringify(
        { version: CACHE_VERSION, serverUrl, cloudWorkspaceSlug: workspaceSlug, projects, savedAt: lastUpdated },
        null,
        2
      )
    );
  } catch {
    logger.warn('cloudProjects', `could not write ${cachePath()}`);
  }
}

function deleteCache() {
  const file = cachePath();
  for (const target of [file, `${file}.bak`, `${file}.tmp`]) {
    try {
      fs.unlinkSync(target);
    } catch (err) {
      if (err.code !== 'ENOENT') logger.warn('cloudProjects', `could not delete ${target}`);
    }
  }
}

// ─── State ────────────────────────────────────────────────────

/** Signed in to a workspace. Without one, no workspace procedure is ever called. */
function hasWorkspace() {
  const auth = cloudSession.getAuth();
  return Boolean(auth && auth.cloudWorkspace && auth.cloudWorkspace.slug);
}

/**
 * The signed-in role's two answers, `{ work, manage }`. Both false while
 * signed out or without a workspace: no workspace, no write.
 */
function permissions() {
  const auth = cloudSession.getAuth();
  if (!auth || !auth.cloudWorkspace || !auth.cloudWorkspace.slug) return { work: false, manage: false };
  return core.permissionsOf(auth.cloudWorkspace.role);
}

/** Whether the signed-in role holds `permission` (`work` | `manage`). */
function can(permission) {
  return Boolean(permissions()[permission]);
}

/**
 * Main's own check before a write: null when the role may, otherwise the
 * refusal to return without sending anything. Hiding a control is not
 * protection — the renderer is untrusted and the server enforces anyway.
 */
function refuseUnless(permission) {
  return can(permission) ? null : { ok: false, reason: 'roleForbidden' };
}

function permissionsKey(p) {
  return `${p.work},${p.manage}`;
}

function status() {
  if (!signedIn) return 'signedOut';
  if (!hasWorkspace()) return 'noWorkspace';
  if (!lastUpdated) {
    if (error && !loading) return 'error';
    return 'loading';
  }
  return stale ? 'stale' : 'ready';
}

/** The renderer's view. Built field by field — no token, no identity, no remote. */
function publicState() {
  const auth = cloudSession.getAuth();
  const cloudWorkspace = auth && auth.cloudWorkspace
    ? { name: auth.cloudWorkspace.name || '', slug: auth.cloudWorkspace.slug || '' }
    : null;
  const { projectRows, folderRows } = core.matchFolders(signedIn ? projects : [], folders);
  const webFor = (p) => Boolean(auth && core.buildWebUrl({
    apiUrl: auth.serverUrl,
    webOrigin: auth.webOrigin,
    workspaceSlug: cloudWorkspace && cloudWorkspace.slug,
    projectSlug: p.slug,
  }));

  return {
    status: status(),
    cloudWorkspace,
    projects: projectRows.map((p) => ({ ...p, canOpenWeb: webFor(p) })),
    folders: folderRows.map((f) => ({
      ...f,
      // A connected or recognised (ready) folder already knows its project.
      plan: f.connected || f.ready ? null : plans.get(f.path) || null,
      candidatesLoading: candidatesLoading.has(f.path),
    })),
    unconnectedCount: folderRows.filter((f) => !f.connected).length,
    uninitialisedCount,
    lastUpdated,
    canOpenWeb: Boolean(auth && auth.webOrigin),
    permissions: permissions(),
    promptDismissed: Boolean(userSettings.get(DISMISS_KEY)),
    autoShowDevices,
    error: status() === 'error' ? error : undefined,
  };
}

function push() {
  const payload = publicState();
  autoShowDevices = false;
  if (!mainWindow || mainWindow.isDestroyed()) return payload;
  mainWindow.webContents.send(IPC.CLOUD_PROJECTS_STATE, payload);
  return payload;
}

function resetList() {
  projects = [];
  lastUpdated = null;
  stale = false;
  error = null;
  plans.clear();
  candidatesLoading.clear();
  candidatesGen += 1;
}

// ─── Calls ────────────────────────────────────────────────────

/**
 * One bearer call through the shared rules: 401 signs out quietly, a
 * forgotten device is registered again and the call retried once. A refusal
 * that says the role or the workspace changed (ROLE_FORBIDDEN, NO_WORKSPACE)
 * re-reads device.me so every surface redraws with what the server now says;
 * the call itself is not retried.
 * → `{ ok: true, value }` or `{ ok: false, reason }`. Never throws.
 */
async function call(fn) {
  const run = () => {
    const auth = cloudSession.getAuth();
    if (!auth) return Promise.reject(Object.assign(new Error('signed out'), { kind: 'unauthorized' }));
    return fn({ api: auth.serverUrl, token: auth.token, fetchJson: cloudSession.fetchJson });
  };
  const fail = (err) => {
    const reason = core.classifyLinkError(err);
    if (reason === 'unauthorized') cloudSession.sessionExpired();
    if (reason === 'roleForbidden' || reason === 'noWorkspace') {
      Promise.resolve(cloudSession.refresh()).catch(() => {});
    }
    return { ok: false, reason };
  };
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    if (core.classifyLinkError(err) !== 'notRegistered') return fail(err);
  }
  try {
    await cloudSession.reRegister();
    return { ok: true, value: await run() };
  } catch (err) {
    return fail(err);
  }
}

/** Re-read the project list (and the folders). Concurrent callers share one request. */
function refresh() {
  if (refreshing) return refreshing;
  const auth = cloudSession.getAuth();
  if (!auth) {
    scanFolders();
    return Promise.resolve(push());
  }
  if (!hasWorkspace()) {
    // Nothing to list: the folders still count for the no-workspace panel, and
    // the after-sign-in devices prompt is dropped rather than kept for later.
    scanFolders();
    autoShowPending = false;
    return Promise.resolve(push());
  }
  const key = sessionKey;
  const run = (async () => {
    loading = true;
    scanFolders();
    push();
    lastFetchAt = Date.now();
    const result = await call((ctx) => core.listProjects(ctx));
    if (key !== sessionKey) return; // the session changed underneath
    if (result.ok) {
      projects = result.value;
      lastUpdated = new Date().toISOString();
      stale = false;
      error = null;
      saveCache(auth.serverUrl, auth.cloudWorkspace && auth.cloudWorkspace.slug);
    } else if (result.reason === 'unauthorized') {
      return; // sessionExpired already moved everything to signed out
    } else {
      error = result.reason === 'network' ? 'network' : 'other';
      stale = Boolean(lastUpdated);
      logger.info('cloudProjects', `project list unavailable: ${result.reason}`);
    }
    scanFolders();
    if (autoShowPending && result.ok) {
      const unconnectedCount = core.matchFolders(projects, folders).folderRows.filter((f) => !f.connected).length;
      autoShowDevices = core.shouldAutoShowDevices({
        userStartedSignIn: true,
        dismissed: Boolean(userSettings.get(DISMISS_KEY)),
        unconnectedCount,
        canWork: can('work'),
      });
    }
    autoShowPending = false;
  })()
    .catch((err) => logger.error('cloudProjects', 'refresh crashed', err))
    .then(() => {
      if (refreshing !== run) return publicState(); // superseded by a session change
      loading = false;
      refreshing = null;
      return push();
    });
  refreshing = run;
  return run;
}

/** `link.candidates` for every unconnected folder, three at a time, pushing as answers land. */
async function loadCandidates() {
  if (!cloudSession.getAuth() || !hasWorkspace() || stale || !lastUpdated) return;
  scanFolders();
  const { folderRows } = core.matchFolders(projects, folders);
  // Only folders no project carries: a ready folder's project is its identity's.
  const targets = folders.filter((f, i) => !folderRows[i].connected && !folderRows[i].ready);
  const gen = ++candidatesGen;
  candidatesLoading.clear();
  for (const f of targets) candidatesLoading.add(f.path);
  push();

  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const folder = targets[next++];
      if (gen !== candidatesGen) return;
      const remote = await readRemote(folder.path);
      const result = await call((ctx) =>
        core.getCandidates({ ...ctx, folderName: folder.name, remote, frameProjectId: folder.projectId })
      );
      if (gen !== candidatesGen) return;
      candidatesLoading.delete(folder.path);
      if (result.ok) {
        const row = { path: folder.path, name: folder.name, connected: false, project: null };
        plans.set(folder.path, core.planFolderRow(row, result.value, folder.projectId));
      }
      push();
      if (result.reason === 'unauthorized') return;
    }
  };
  await Promise.all(Array.from({ length: CANDIDATE_CONCURRENCY }, worker));
}

function linkBlocked() {
  if (!cloudSession.getAuth()) return { ok: false, reason: 'unauthorized' };
  if (!hasWorkspace()) return { ok: false, reason: 'noWorkspace' };
  if (stale || !lastUpdated) return { ok: false, reason: 'network' };
  return null;
}

// Stamp the folder's identity at the moment the user links it (S6).
function identityFor(folder) {
  try {
    return frameStore.ensureProjectId(folder.path);
  } catch (err) {
    logger.warn('cloudProjects', `could not write the project id for ${folder.path}`);
    return null;
  }
}

async function afterLink(folderPath, result) {
  if (result.ok || result.reason === 'taken' || result.reason === 'notFound') {
    plans.delete(folderPath);
    await refresh();
  }
}

async function linkClaim({ path: folderPath, projectId, acceptRemoteMismatch, takeOver } = {}) {
  const blocked = linkBlocked() || refuseUnless('work');
  if (blocked) return blocked;
  const folder = findFolder(folderPath);
  if (!folder || typeof projectId !== 'string' || !projectId) return { ok: false, reason: 'other' };
  const frameProjectId = identityFor(folder);
  if (!frameProjectId) return { ok: false, reason: 'noConfig' };
  const remote = await readRemote(folder.path);
  const result = await call((ctx) =>
    core.claim({
      ...ctx,
      projectId,
      frameProjectId,
      remote,
      acceptRemoteMismatch: acceptRemoteMismatch === true,
      takeOver: takeOver === true,
    })
  );
  await afterLink(folder.path, result);
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

async function linkCreate({ path: folderPath, name, slug } = {}) {
  const blocked = linkBlocked() || refuseUnless('manage');
  if (blocked) return blocked;
  const folder = findFolder(folderPath);
  if (!folder) return { ok: false, reason: 'other' };
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (!cleanName) return { ok: false, reason: 'badRequest', field: 'name' };
  const slugError = core.validateSlug(slug);
  if (slugError) return { ok: false, reason: 'badRequest', field: 'slug', slugError };
  const frameProjectId = identityFor(folder);
  if (!frameProjectId) return { ok: false, reason: 'noConfig' };
  const remote = await readRemote(folder.path);
  const result = await call((ctx) => core.create({ ...ctx, name: cleanName, slug, frameProjectId, remote }));
  await afterLink(folder.path, result);
  if (result.ok) return { ok: true };
  if (result.reason === 'slugTaken') {
    return { ok: false, reason: 'slugTaken', field: 'slug', suggestion: core.nextSlug(slug) };
  }
  return { ok: false, reason: result.reason };
}

/**
 * Connects this device to the project that already carries the folder's
 * identity (`link.connect`). Writes no identity: a folder without one, or
 * whose identity no listed project carries, has nothing to connect to.
 * A refusal that means the list was stale refreshes it; a mismatch here is
 * another folder's take-over, not a question for this one (`identityChanged`).
 */
async function linkConnect({ path: folderPath } = {}) {
  const blocked = linkBlocked() || refuseUnless('work');
  if (blocked) return blocked;
  const folder = findFolder(folderPath);
  if (!folder) return { ok: false, reason: 'other' };
  // Read, never stamp.
  const frameProjectId = frameStore.getProjectId(folder.path);
  const project = frameProjectId ? projects.find((p) => p.frameProjectId === frameProjectId) : null;
  if (!project) {
    await refresh();
    return { ok: false, reason: 'notFound' };
  }
  const result = await call((ctx) => core.connect({ ...ctx, projectId: project.id, frameProjectId }));
  const reason = result.ok ? null : result.reason === 'mismatch' ? 'identityChanged' : result.reason;
  if (result.ok || reason === 'unlinked' || reason === 'identityChanged' || reason === 'notFound') {
    plans.delete(folder.path);
    await refresh();
  }
  return result.ok ? { ok: true } : { ok: false, reason };
}

/**
 * Removes this device's connection to a project (`link.disconnect`). By
 * project, not folder: a device stays connected to a project whose folder was
 * moved away. Nothing else changes — the identity, other members' devices and
 * this user's other devices stay connected.
 */
async function linkDisconnect({ projectId } = {}) {
  const blocked = linkBlocked() || refuseUnless('work');
  if (blocked) return blocked;
  if (typeof projectId !== 'string' || !projectId) return { ok: false, reason: 'other' };
  if (!projects.some((p) => p.id === projectId)) {
    // Gone from the list: its connections went with it.
    await refresh();
    return { ok: true };
  }
  const result = await call((ctx) => core.disconnect({ ...ctx, projectId }));
  if (result.ok || result.reason === 'notFound') {
    await refresh();
    return { ok: true };
  }
  return { ok: false, reason: result.reason };
}

async function checkSlug(slug) {
  const slugError = core.validateSlug(slug);
  if (slugError) return { ok: false, reason: 'badRequest', slugError };
  if (!cloudSession.getAuth()) return { ok: false, reason: 'unauthorized' };
  if (!hasWorkspace()) return { ok: false, reason: 'noWorkspace' };
  const result = await call((ctx) => core.checkSlug({ ...ctx, slug }));
  if (!result.ok) return { ok: false, reason: result.reason };
  return result.value
    ? { ok: true, available: true }
    : { ok: true, available: false, suggestion: core.nextSlug(slug) };
}

/** The renderer sends a project id; the URL is built and opened here. */
function openOnWeb(projectId) {
  const auth = cloudSession.getAuth();
  const project = projects.find((p) => p.id === projectId);
  if (!auth || !project) return false;
  const url = core.buildWebUrl({
    apiUrl: auth.serverUrl,
    webOrigin: auth.webOrigin,
    workspaceSlug: auth.cloudWorkspace && auth.cloudWorkspace.slug,
    projectSlug: project.slug,
  });
  if (!url) return false;
  cloudSession.openUrl(url);
  return true;
}

/**
 * The cloud project a known folder is connected to, from this service's own
 * state — the same match the renderer's Connected mark draws from.
 * → `{ id, slug, name }`, or null when signed out, unknown or not connected.
 */
function connectedProject(folderPath) {
  if (!signedIn || !cloudSession.getAuth() || typeof folderPath !== 'string') return null;
  const folder = findFolder(folderPath);
  if (!folder) return null;
  const row = core.matchFolders(projects, [folder]).folderRows[0];
  return row && row.connected ? row.project : null;
}

/** The workspace's page, or `/new` to create one when there is none. */
function openWorkspaceOnWeb() {
  const auth = cloudSession.getAuth();
  if (!auth) return false;
  const origins = { apiUrl: auth.serverUrl, webOrigin: auth.webOrigin };
  const url = hasWorkspace()
    ? core.buildWorkspaceWebUrl({ ...origins, workspaceSlug: auth.cloudWorkspace.slug })
    : core.buildNewWorkspaceWebUrl(origins);
  if (!url) return false;
  cloudSession.openUrl(url);
  return true;
}

// ─── Session ──────────────────────────────────────────────────

function onSessionChange({ state, userStarted }) {
  const auth = cloudSession.getAuth();
  if (state.state === 'signedIn' && auth) {
    const slug = auth.cloudWorkspace ? auth.cloudWorkspace.slug : '';
    const key = `${auth.serverUrl} ${slug}`;
    const entering = !signedIn || key !== sessionKey;
    const nextPermissions = permissionsKey(permissions());
    const permissionsChanged = nextPermissions !== lastPermissions;
    lastPermissions = nextPermissions;
    signedIn = true;
    if (userStarted) autoShowPending = true;
    if (key !== sessionKey) {
      sessionKey = key;
      resetList();
      refreshing = null;
      loading = false;
      const cached = slug ? loadCache(auth.serverUrl, slug) : null; // no workspace, no cache
      if (cached) {
        projects = cached.projects;
        lastUpdated = cached.savedAt;
        stale = true; // until the server answers
      }
    }
    if (entering || userStarted) refresh();
    // Same workspace, new role (device.me on focus, or after a ROLE_FORBIDDEN):
    // nothing to re-list, but every surface redraws from the new answers.
    else if (permissionsChanged) push();
    return;
  }

  if (state.state === 'signedOut' || state.state === 'unavailable') {
    const hadSession = signedIn || sessionKey !== null;
    signedIn = false;
    sessionKey = null;
    lastPermissions = null;
    autoShowPending = false;
    resetList();
    if (hadSession) deleteCache();
    push();
  }
  // requestingCode / awaitingApproval / registering / failed: nothing to list.
}

// ─── Wiring ───────────────────────────────────────────────────

function init(window) {
  mainWindow = window;
  cloudSession.onChange(onSessionChange);
  window.on('focus', () => {
    if (!signedIn || Date.now() - lastFetchAt < FOCUS_THROTTLE_MS) return;
    refresh();
  });
}

function setupIPC(ipcMain) {
  ipcMain.handle(IPC.CLOUD_PROJECTS_GET_STATE, () => {
    scanFolders();
    return publicState();
  });
  ipcMain.handle(IPC.CLOUD_PROJECTS_REFRESH, () => refresh());
  ipcMain.handle(IPC.CLOUD_FOLDER_CANDIDATES, () => {
    loadCandidates().catch((err) => logger.error('cloudProjects', 'candidates crashed', err));
    return true;
  });
  ipcMain.handle(IPC.CLOUD_CHECK_SLUG, (event, slug) => checkSlug(slug));
  ipcMain.handle(IPC.CLOUD_LINK_CLAIM, (event, request) => linkClaim(request));
  ipcMain.handle(IPC.CLOUD_LINK_CREATE, (event, request) => linkCreate(request));
  ipcMain.handle(IPC.CLOUD_LINK_CONNECT, (event, request) => linkConnect(request));
  ipcMain.handle(IPC.CLOUD_LINK_DISCONNECT, (event, request) => linkDisconnect(request));
  ipcMain.handle(IPC.CLOUD_OPEN_ON_WEB, (event, projectId) => openOnWeb(projectId));
  ipcMain.handle(IPC.CLOUD_OPEN_WORKSPACE_ON_WEB, () => openWorkspaceOnWeb());
}

module.exports = {
  init,
  setupIPC,
  refresh,
  publicState,
  call,
  can,
  refuseUnless,
  connectedProject,
};
