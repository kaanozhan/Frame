/**
 * cloudDiscussionsService — the Electron shell around discussing a Frame
 * Cloud proposal.
 *
 * Holds no prompt, validation or request logic (that is cloudDiscussions.js).
 * It owns `<userData>/cloud-discussions/`:
 *
 *   discussions.json        — every discussion id main issued, so a session
 *                             resumed after a restart can still record
 *                             (pruned to 90 days on load)
 *   record-discussion.js    — the command the agent runs, staged from
 *                             src/templates/bin/ at start
 *   bus/                    — the command's requests; replies/ holds answers
 *   prompts/<id>.md         — each discussion's prompt; the lane is sent one
 *                             line that reads it (a long paste gets cut)
 *
 * Nothing is written into the user's repo. Discuss (`CLOUD_BRIEF_DISCUSS`)
 * checks the folder is connected and the brief is an open proposal, issues an
 * id and returns the lane's prompt; the renderer opens the lane. A request is
 * claimed by renaming it, handled, answered in replies/, and a record that
 * landed is pushed as `CLOUD_BRIEF_DISCUSSION_RECORDED`.
 *
 * The bus is watched only while this Frame is signed in to Frame Cloud. Every
 * Frame on the machine shares userData, so a signed-out one leaves requests
 * alone instead of claiming them and answering that it does not know the id.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { IPC } = require('../../shared/ipcChannels');
const fsSafe = require('../fsSafe');
const logger = require('../logger');
const aiToolManager = require('../aiToolManager');
const cloudSession = require('./cloudSession');
const cloudProjectsService = require('./cloudProjectsService');
const cloudBriefsService = require('./cloudBriefsService');
const core = require('./cloudDiscussions');
const { LIMITS } = require('./cloudBriefs');
const { WAIT_MS } = require('../../templates/bin/record-discussion');

const DIR_NAME = 'cloud-discussions';
const STORE_FILE = 'discussions.json';
const COMMAND_FILE = 'record-discussion.js';
const COMMAND_TEMPLATE = path.join(__dirname, '..', '..', 'templates', 'bin', COMMAND_FILE);
const WATCH_DEBOUNCE_MS = 100;
/** A request older than the command's wait has been given up on; recording it would be a write nobody hears about. */
const STALE_REQUEST_MS = WAIT_MS + 5000;
/** Replies the command never collected (it was killed) are swept after this. */
const STALE_REPLY_MS = 10 * 60 * 1000;

let mainWindow = null;
let store = core.emptyStore();
let initialised = false;
let watcher = null;
let debounce = null;

function baseDir() {
  return path.join(app.getPath('userData'), DIR_NAME);
}

function busDir() {
  return path.join(baseDir(), 'bus');
}

function repliesDir() {
  return path.join(busDir(), 'replies');
}

function commandPath() {
  return path.join(baseDir(), COMMAND_FILE);
}

function promptsDir() {
  return path.join(baseDir(), 'prompts');
}

// ─── The store ────────────────────────────────────────────────

function loadStore() {
  const file = path.join(baseDir(), STORE_FILE);
  const { data, error } = fsSafe.readJsonWithRecovery(file);
  if (error) logger.warn('cloudDiscussions', `could not read ${file}`);
  store = core.pruneDiscussions(data || core.emptyStore());
  const before = data && data.discussions ? Object.keys(data.discussions).length : 0;
  if (before !== Object.keys(store.discussions).length) saveStore();
  removeStalePrompts();
}

/** Delete the prompt files of discussions the store no longer holds. */
function removeStalePrompts() {
  let names = [];
  try { names = fs.readdirSync(promptsDir()); } catch { return; }
  for (const name of core.stalePromptFiles(names, store)) {
    try { fs.unlinkSync(path.join(promptsDir(), name)); } catch { /* raced */ }
  }
}

/** Write a discussion's prompt atomically. → its path, or null. */
function writePrompt(discussionId, prompt) {
  try {
    fs.mkdirSync(promptsDir(), { recursive: true });
    const target = path.join(promptsDir(), core.promptFileName(discussionId));
    fs.writeFileSync(`${target}.tmp`, prompt);
    fs.renameSync(`${target}.tmp`, target);
    return target;
  } catch (err) {
    logger.warn('cloudDiscussions', `could not write the discuss prompt: ${err.message}`);
    return null;
  }
}

function saveStore() {
  try {
    fsSafe.writeFileAtomic(path.join(baseDir(), STORE_FILE), JSON.stringify(store, null, 2));
    return true;
  } catch (err) {
    logger.warn('cloudDiscussions', `could not write the discussions store: ${err.message}`);
    return false;
  }
}

// ─── The staged command ───────────────────────────────────────

/** Copy the command next to the bus, only when it changed. → staged? */
function stageCommand() {
  try {
    const source = fs.readFileSync(COMMAND_TEMPLATE, 'utf8');
    let current = null;
    try { current = fs.readFileSync(commandPath(), 'utf8'); } catch { /* not staged yet */ }
    if (current !== source) fsSafe.writeFileAtomic(commandPath(), source);
    return true;
  } catch (err) {
    logger.warn('cloudDiscussions', `could not stage the record command: ${err.message}`);
    return false;
  }
}

// ─── Discuss ──────────────────────────────────────────────────

/**
 * Start a discussion of an open proposal with `toolId`. The full prompt is
 * written to a file; what comes back is the one line the lane is sent.
 * → `{ ok: true, prompt }` or `{ ok: false, reason }`.
 */
async function discuss(folderPath, number, toolId) {
  if (!cloudProjectsService.connectedProject(folderPath)) return { ok: false, reason: 'notConnected' };
  // A role without `work` could never record the result: stage nothing.
  const forbidden = cloudProjectsService.refuseUnless('work');
  if (forbidden) return forbidden;
  const tool = typeof toolId === 'string' ? aiToolManager.getAvailableTools()[toolId] : null;
  if (!tool) return { ok: false, reason: 'unknownTool' };
  const detail = await cloudBriefsService.get(folderPath, number);
  if (!detail.ok) return { ok: false, reason: detail.reason };
  if (detail.brief.kind !== 'proposal' || detail.brief.status === 'closed') return { ok: false, reason: 'notAnOpenProposal' };
  if (!stageCommand()) return { ok: false, reason: 'other' };

  const discussionId = core.newDiscussionId();
  store = core.addDiscussion(store, {
    id: discussionId,
    folderPath,
    number,
    toolId,
    provider: String(tool.name || toolId).slice(0, LIMITS.provider),
    createdAt: new Date().toISOString(),
  });
  if (!saveStore()) return { ok: false, reason: 'other' };

  const prompt = core.buildDiscussPrompt({
    brief: detail.brief,
    events: detail.events,
    toolId,
    commandPath: commandPath(),
    discussionId,
    meId: detail.meId,
  });
  const promptPath = writePrompt(discussionId, prompt);
  if (!promptPath) return { ok: false, reason: 'other' };
  return { ok: true, prompt: core.promptInstruction(promptPath, number) };
}

// ─── The bus ──────────────────────────────────────────────────

function writeReply(name, reply) {
  try {
    fs.mkdirSync(repliesDir(), { recursive: true });
    const target = path.join(repliesDir(), name);
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(reply));
    fs.renameSync(`${target}.tmp`, target);
  } catch (err) {
    logger.warn('cloudDiscussions', `could not write a reply: ${err.message}`);
  }
}

function pushRecorded(folderPath, number) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.CLOUD_BRIEF_DISCUSSION_RECORDED, { folderPath, number });
  }
}

/**
 * `call`, refused locally without `work`: the request's own checks (unknown
 * discussion, bad input, not connected) still answer first, and a role that
 * cannot record is answered `roleForbidden` before anything reaches the server.
 */
async function workCall(fn) {
  return cloudProjectsService.refuseUnless('work') || cloudProjectsService.call(fn);
}

/** Claim one request by renaming it, handle it, answer it. A claimed request is never handled twice. */
async function handleFile(name) {
  const full = path.join(busDir(), name);
  const claimed = `${full}.taken`;
  try {
    fs.renameSync(full, claimed);
  } catch {
    return; // withdrawn by the command, or claimed by an earlier drain
  }
  let request = null;
  try {
    request = JSON.parse(fs.readFileSync(claimed, 'utf8'));
  } catch { /* handled below as unknown */ }

  if (request && Number.isFinite(request.ts) && Date.now() - request.ts > STALE_REQUEST_MS) {
    // The command gave up long ago (Frame was closed and it was killed before withdrawing).
    try { fs.unlinkSync(claimed); } catch { /* gone */ }
    return;
  }

  let result;
  try {
    result = await core.handleRecordRequest(request, {
      store,
      connectedProject: cloudProjectsService.connectedProject,
      call: workCall,
    });
  } catch (err) {
    logger.warn('cloudDiscussions', `recording failed: ${err.message}`);
    result = { ok: false, reason: 'other' };
  }
  const reply = result.ok
    ? { ok: true, message: core.replyMessage(result) }
    : { ok: false, reason: result.reason, message: core.replyMessage(result) };
  writeReply(name, reply);
  try { fs.unlinkSync(claimed); } catch { /* gone */ }
  if (result.ok) pushRecorded(result.folderPath, result.number);
}

function drain() {
  let names;
  try {
    names = fs.readdirSync(busDir());
  } catch {
    return;
  }
  for (const name of names) {
    if (name.endsWith('.json')) handleFile(name);
  }
}

/** Remove what a crash or a killed command left: claimed requests, tmp files, uncollected replies. */
function sweep() {
  const now = Date.now();
  const remove = (dir, test) => {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const name of names) {
      const full = path.join(dir, name);
      try {
        if (test(name, fs.statSync(full))) fs.unlinkSync(full);
      } catch { /* raced */ }
    }
  };
  remove(busDir(), (name, stat) => stat.isFile() && (name.endsWith('.taken') || (name.endsWith('.tmp') && now - stat.mtimeMs > STALE_REQUEST_MS)));
  remove(repliesDir(), (name, stat) => stat.isFile() && now - stat.mtimeMs > STALE_REPLY_MS);
}

function startWatcher() {
  if (watcher) return;
  try {
    fs.mkdirSync(repliesDir(), { recursive: true });
  } catch (err) {
    logger.warn('cloudDiscussions', `could not create the bus: ${err.message}`);
    return;
  }
  sweep();
  drain(); // requests written while Frame was closed, still inside their wait
  try {
    watcher = fsSafe.safeWatch(busDir(), null, () => {
      clearTimeout(debounce);
      debounce = setTimeout(drain, WATCH_DEBOUNCE_MS);
    }, () => { watcher = null; });
  } catch (err) {
    logger.warn('cloudDiscussions', `could not watch the bus: ${err.message}`);
  }
}

function stopWatcher() {
  clearTimeout(debounce);
  debounce = null;
  if (!watcher) return;
  try { watcher.close(); } catch { /* already closed */ }
  watcher = null;
}

/** Watch the bus while signed in, and only then. */
function followSession(publicState) {
  if (publicState && publicState.state === 'signedIn') startWatcher();
  else stopWatcher();
}

function init(window) {
  mainWindow = window;
  if (initialised) return; // a re-created window keeps the running bus
  try {
    fs.mkdirSync(baseDir(), { recursive: true });
  } catch (err) {
    logger.warn('cloudDiscussions', `could not create ${baseDir()}: ${err.message}`);
    return;
  }
  initialised = true;
  loadStore();
  stageCommand();
  followSession(cloudSession.getPublicState());
  cloudSession.onChange(({ state }) => followSession(state));
}

function setupIPC(ipcMain) {
  ipcMain.handle(IPC.CLOUD_BRIEF_DISCUSS, (event, folderPath, number, toolId) => discuss(folderPath, number, toolId));
}

module.exports = {
  init,
  setupIPC,
  discuss,
};
