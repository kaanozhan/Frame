/**
 * cloudBriefsService — the Electron shell around reading and creating Frame
 * Cloud briefs.
 *
 * Holds no request or normalizing logic (that is cloudBriefs.js). The
 * renderer names a folder by path and nothing else: the connected project's
 * slug is resolved here from cloudProjectsService's own state, so a renderer
 * can never ask for another project's briefs, and a folder that is not
 * connected is refused before any request goes out.
 *
 * Every request goes through cloudProjectsService's `call()`, so a 401 signs
 * out quietly and a forgotten device is registered again and retried once.
 * The writes are `create` (a new brief and its links), `decide` (a proposal
 * moved to work) and `move` (a started brief moved to Done or back to Active,
 * frame-cloud-brief-manual-done); discussions are recorded by
 * cloudDiscussionsService. A move to Done that needs no reason is held here
 * for its 5-second Undo (`undoMove`), and the held moves are sent at quit
 * (`flushMoves`), so neither closing the view nor quitting loses one (D1).
 * After a read answers, cloudDoneService reports the parts' branches and
 * finishes (frame-cloud-brief-done). No other brief or milestone mutation is
 * called from here.
 *
 * GitHub tracking (frame-cloud-github-tracking): the board's `mergeTracking`
 * comes from the core's `mergeTrackingOf`, and Open on web also opens the
 * project's Settings at its GitHub section, the only place tracking is turned
 * on or off. Frame never asks GitHub for anything itself (`brief.refresh` is
 * not called, plan D2).
 */

const { IPC } = require('../../shared/ipcChannels');
const { createMoveHold } = require('../../shared/cloudMoveHold');
const cloudSession = require('./cloudSession');
const cloudProjectsService = require('./cloudProjectsService');
const core = require('./cloudBriefs');
const cloudStartService = require('./cloudStartService');
const cloudDoneService = require('./cloudDoneService');

const NOT_CONNECTED = { ok: false, reason: 'notConnected' };

/** The app's one hold: a move to Done waits here for its Undo (plan D1, D12). */
const moveHold = createMoveHold();

/** The longest a flush waits for held moves, so a dead network cannot hold the app open (D19). */
const FLUSH_TIMEOUT_MS = 3000;

/** The signed-in user's id, for "You"; '' when unknown. */
function meId() {
  const user = cloudSession.getPublicState().user;
  return user && typeof user.id === 'string' ? user.id : '';
}

/**
 * Report what this machine knows about the read's parts once the read has
 * answered, so the board never waits on git or on the cloud's GitHub check
 * (frame-cloud-brief-done D8). The report never throws.
 */
function reportAfter(folderPath, project, briefs) {
  setImmediate(() => {
    cloudDoneService.report(folderPath, project, briefs).catch(() => {});
  });
}

/** What every web link of the project is built from, or null when signed out. */
function webInputs(project) {
  const auth = cloudSession.getAuth();
  if (!auth || !project) return null;
  return {
    apiUrl: auth.serverUrl,
    webOrigin: auth.webOrigin,
    workspaceSlug: auth.cloudWorkspace && auth.cloudWorkspace.slug,
    projectSlug: project.slug,
  };
}

function webUrl(project, number) {
  const inputs = webInputs(project);
  return inputs ? core.buildBriefWebUrl({ ...inputs, number }) : null;
}

function settingsWebUrl(project) {
  const inputs = webInputs(project);
  return inputs ? core.buildSettingsWebUrl(inputs) : null;
}

/**
 * The folder's briefs and milestones.
 * → `{ ok, project, briefs, milestones, mergeTracking, meId, canOpenWeb }` or `{ ok: false, reason }`.
 */
async function list(folderPath, { includeClosed } = {}) {
  const project = cloudProjectsService.connectedProject(folderPath);
  if (!project) return NOT_CONNECTED;
  const call = cloudProjectsService.call;
  const [briefs, milestones] = await Promise.all([
    call((ctx) => core.listBriefs({ ...ctx, projectSlug: project.slug, includeClosed: includeClosed === true })),
    call((ctx) => core.listMilestones({ ...ctx, projectSlug: project.slug })),
  ]);
  if (!briefs.ok) return { ok: false, reason: briefs.reason };
  if (!milestones.ok) return { ok: false, reason: milestones.reason };
  // Open proposals' discussion counts and new comments, one `brief.events` each (frame-cloud-brief-discussions T11, T13).
  const discussed = await core.addDiscussionCounts(call, briefs.value, meId());
  // Open shaped work's parts by shape, one `brief.getByNumber` each (frame-cloud-brief-shape T11).
  const counted = await core.addPartCounts(call, discussed, project.slug);
  // Each part's branch when this machine began it (frame-cloud-brief-start T12).
  const begun = await cloudStartService.withBegunBranches(counted, project.id, folderPath);
  reportAfter(folderPath, project, begun);
  return {
    ok: true,
    project: { name: project.name, slug: project.slug },
    briefs: begun,
    milestones: milestones.value,
    mergeTracking: core.mergeTrackingOf(briefs.value),
    meId: meId(),
    canOpenWeb: Boolean(webUrl(project)),
  };
}

/** One brief by number, with its history. → `{ ok, brief, events, meId, canOpenWeb }` or `{ ok: false, reason }`. */
async function get(folderPath, number) {
  const project = cloudProjectsService.connectedProject(folderPath);
  if (!project) return NOT_CONNECTED;
  if (!Number.isInteger(number) || number < 1) return { ok: false, reason: 'other' };
  const call = cloudProjectsService.call;
  const brief = await call((ctx) => core.getBrief({ ...ctx, projectSlug: project.slug, number }));
  if (!brief.ok) return { ok: false, reason: brief.reason };
  const events = await call((ctx) => core.briefEvents({ ...ctx, id: brief.value.id }));
  if (!events.ok) return { ok: false, reason: events.reason };
  // Each part's branch when this machine began it (frame-cloud-brief-start T15).
  const [begun] = await cloudStartService.withBegunBranches([brief.value], project.id, folderPath);
  reportAfter(folderPath, project, [begun]);
  return {
    ok: true,
    brief: begun,
    events: events.value,
    meId: meId(),
    canOpenWeb: Boolean(webUrl(project, number)),
  };
}

/**
 * Create a brief in the folder's project, then attach its links. The request
 * is checked here again (the renderer is not trusted) and a bad field or link
 * refuses it before anything is sent. The brief id never leaves main.
 * → `{ ok, number, attachmentError }` or `{ ok: false, reason, field? }`.
 */
async function create(folderPath, request) {
  const project = cloudProjectsService.connectedProject(folderPath);
  if (!project) return NOT_CONNECTED;
  const forbidden = cloudProjectsService.refuseUnless('work');
  if (forbidden) return forbidden;
  const built = core.buildCreateInput(request);
  if (!built.ok) return built;
  const links = core.normalizeLinks(request && request.links);
  if (!links.ok) return links;
  const input = { projectSlug: project.slug, ...built.input };
  const result = await core.createWithLinks(cloudProjectsService.call, { input, links: links.links });
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, number: result.number, attachmentError: result.attachmentError };
}

/**
 * Move an open proposal to work with a priority. The brief is resolved here by
 * number; its id never leaves main. → `{ ok: true }` or `{ ok: false, reason }`.
 */
async function decide(folderPath, number, priority) {
  const project = cloudProjectsService.connectedProject(folderPath);
  if (!project) return NOT_CONNECTED;
  const forbidden = cloudProjectsService.refuseUnless('work');
  if (forbidden) return forbidden;
  if (!Number.isInteger(number) || number < 1) return { ok: false, reason: 'other' };
  const call = cloudProjectsService.call;
  const brief = await call((ctx) => core.getBrief({ ...ctx, projectSlug: project.slug, number }));
  if (!brief.ok) return { ok: false, reason: brief.reason };
  return core.decideThrough(call, { id: brief.value.id, priority });
}

/** A held move's key: the folder and the brief number, joined by a NUL. */
function moveKey(folderPath, number) {
  return `${folderPath}\0${number}`;
}

/**
 * Move a started brief to Done (`to: 'done'`) or back to Active
 * (`to: 'active'`). The brief is resolved here by number; its id never leaves
 * main. A move to Done with `hold` and no reason waits `HOLD_MS` for Undo and
 * is sent when the time passes, when another move starts, or at quit; every
 * other move first sends whatever is held, then goes at once.
 *
 * The id is read inside the send, not before holding, so the hold starts the
 * moment the renderer asks: an Undo pressed during that first read still
 * finds the move, and an undone move sends nothing at all.
 * → `{ ok: true }` or `{ ok: false, reason }` (`undone` after an Undo).
 */
async function move(folderPath, number, { to, reason, hold } = {}) {
  const project = cloudProjectsService.connectedProject(folderPath);
  if (!project) return NOT_CONNECTED;
  // Checked when asked; a move already held still goes through call(), so a
  // role lost during the hold comes back from the server as roleForbidden.
  const forbidden = cloudProjectsService.refuseUnless('work');
  if (forbidden) return forbidden;
  if (!Number.isInteger(number) || number < 1) return { ok: false, reason: 'other' };
  const call = cloudProjectsService.call;
  const send = async () => {
    const brief = await call((ctx) => core.getBrief({ ...ctx, projectSlug: project.slug, number }));
    if (!brief.ok) return { ok: false, reason: brief.reason };
    return core.moveThrough(call, { id: brief.value.id, to, reason });
  };
  const hasReason = typeof reason === 'string' && reason.trim() !== '';
  if (hold === true && to === 'done' && !hasReason) return moveHold.hold(moveKey(folderPath, number), send);
  await moveHold.flush({ timeoutMs: FLUSH_TIMEOUT_MS });
  return send();
}

/** Cancel a held move to Done. → whether one was still held (false once its send started). */
function undoMove(folderPath, number) {
  if (!Number.isInteger(number) || number < 1) return false;
  return moveHold.undo(moveKey(folderPath, number));
}

/** Send every held move now, waiting at most FLUSH_TIMEOUT_MS (quit, D19). Never rejects. */
function flushMoves() {
  return moveHold.flush({ timeoutMs: FLUSH_TIMEOUT_MS });
}

/**
 * The project on the web: its Settings at the GitHub section for
 * `'settings'`, one brief for a number, the project page for nothing. Any
 * other target opens nothing. The URL is built and opened here.
 */
function openOnWeb(folderPath, target) {
  const project = cloudProjectsService.connectedProject(folderPath);
  if (!project) return false;
  let url = null;
  if (target === 'settings') url = settingsWebUrl(project);
  else if (target === undefined || target === null) url = webUrl(project);
  else if (typeof target === 'number') url = webUrl(project, target);
  if (!url) return false;
  cloudSession.openUrl(url);
  return true;
}

function setupIPC(ipcMain) {
  ipcMain.handle(IPC.CLOUD_BRIEFS_LIST, (event, folderPath, options) => list(folderPath, options || {}));
  ipcMain.handle(IPC.CLOUD_BRIEF_GET, (event, folderPath, number) => get(folderPath, number));
  ipcMain.handle(IPC.CLOUD_BRIEFS_OPEN_ON_WEB, (event, folderPath, target) => openOnWeb(folderPath, target));
  ipcMain.handle(IPC.CLOUD_BRIEF_CREATE, (event, folderPath, request) => create(folderPath, request));
  ipcMain.handle(IPC.CLOUD_BRIEF_DECIDE, (event, folderPath, number, priority) => decide(folderPath, number, priority));
  ipcMain.handle(IPC.CLOUD_BRIEF_MOVE, (event, folderPath, number, options) => move(folderPath, number, options || {}));
  ipcMain.handle(IPC.CLOUD_BRIEF_MOVE_UNDO, (event, folderPath, number) => undoMove(folderPath, number));
}

module.exports = {
  setupIPC,
  list,
  get,
  create,
  decide,
  move,
  undoMove,
  flushMoves,
  openOnWeb,
};
