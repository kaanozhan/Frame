/**
 * leadManager — the desktop side of the Chief (lead-agent spec, T09).
 *
 * Wires the machine-agnostic leadHost to this machine: the local PTYs
 * (ptyManager), the renderer's xterm buffers for screen text (plan D5), the
 * conductor's lanes (read-only while the conductor still exists, D18), and
 * transcripts (sessionRestore first, then Claude's own pid file, D16).
 *
 * Only local terminals: a server's terminals belong to that server's Chief
 * (spec C4). For a server Chief this module is only a bridge (T12): Start,
 * mode and decisions are forwarded to its server; that server's
 * `lead.approvals` events come back as LEAD_APPROVALS with desktop ids.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { IPC } = require('../shared/ipcChannels');
const { createLeadHost } = require('./leadHost');
const transcript = require('../shared/leadTranscript');
const ptyManager = require('./ptyManager');
const sessionRestore = require('./sessionRestore');
const claudeSessionsManager = require('./claudeSessionsManager');
const logger = require('./logger');
const { isServerTerminalId, splitDesktopTerminalId, desktopTerminalId } = require('../shared/serverRouting');

const SCREEN_TIMEOUT_MS = 3000;
const OPEN_TERMINAL_TIMEOUT_MS = 15000;
const MACHINE = 'desktop';

let mainWindow = null;
let host = null;
const screenWaiters = new Map(); // requestId → resolve
const openWaiters = new Map();   // requestId → resolve

/**
 * A terminal the Chief opens for a queue item (work-queue D11): the renderer
 * creates it, so it is a lane the user sees (main-created PTYs are invisible
 * to the renderer), filed under its project, with the item as its assignment.
 */
function openTerminal({ projectPath, cwd, name = null, assignment = null } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.reject(new Error('No Frame window to open a terminal in.'));
  const requestId = crypto.randomBytes(6).toString('hex');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { openWaiters.delete(requestId); reject(new Error('Frame did not open the terminal in time.')); }, OPEN_TERMINAL_TIMEOUT_MS);
    openWaiters.set(requestId, (reply) => {
      clearTimeout(timer);
      if (reply && reply.terminalId) resolve(reply.terminalId);
      else reject(new Error((reply && reply.error) || 'The terminal could not be opened.'));
    });
    send(IPC.LEAD_OPEN_TERMINAL_REQUEST, { requestId, projectPath, cwd, name, assignment });
  });
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

/** Plain screen text from the renderer's xterm (D5); null when it cannot answer. */
function readScreen(terminalId, lines) {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve(null);
  const requestId = crypto.randomBytes(6).toString('hex');
  return new Promise((resolve) => {
    const timer = setTimeout(() => { screenWaiters.delete(requestId); resolve(null); }, SCREEN_TIMEOUT_MS);
    screenWaiters.set(requestId, (text) => { clearTimeout(timer); resolve(typeof text === 'string' ? text : null); });
    send(IPC.LEAD_SCREEN_REQUEST, { requestId, terminalId, lines });
  });
}

function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

/** A terminal's transcript: the SessionStart report, else ~/.claude/sessions/<pid>.json (D16). */
async function transcriptFor(terminalId) {
  const reported = sessionRestore.transcriptFor(terminalId);
  if (reported && reported.transcriptPath && fs.existsSync(reported.transcriptPath)) return reported.transcriptPath;
  const pid = await ptyManager.getForegroundPid(terminalId);
  if (!pid) return null;
  try {
    const sessionFile = JSON.parse(fs.readFileSync(path.join(claudeConfigDir(), 'sessions', `${pid}.json`), 'utf8'));
    const file = transcript.transcriptPathFromSession(sessionFile, {
      projectsDir: claudeSessionsManager.projectsDir(),
      encodeProjectPath: claudeSessionsManager.encodeProjectPath,
      join: path.join
    });
    return file && fs.existsSync(file) ? file : null;
  } catch (_) {
    return null;
  }
}

/** Conductor and worker lanes of a running orchestration session (read-only to the Chief). */
function orchestrationIds(projectPath) {
  try {
    const state = require('./orchestrationManager').getState(projectPath);
    if (!state || !state.active) return [];
    return [state.conductorTerminalId, ...(state.workers || []).map((w) => w.terminalId)].filter(Boolean);
  } catch (_) {
    return [];
  }
}

const adapter = {
  listTerminals: (projectPath) => ptyManager.listTerminals(projectPath),
  status: (id) => ptyManager.agentStatus(id),
  pasteMode: (id) => ptyManager.pasteMode(id),
  lastUserInputAt: (id) => ptyManager.getLastUserInputAt(id),
  readScreen,
  transcriptFor,
  write: (id, data) => ptyManager.writeToTerminal(id, data),
  orchestrationIds,
  // The work queue (work-queue T10): terminals the user sees, this Mac's queue, task state.
  createTerminal: (opts) => openTerminal(opts),
  queue: {
    load: (projectPath) => require('./queueManager').macQueue(projectPath),
    change: (projectPath, fn) => require('./queueManager').macChange(projectPath, fn)
  },
  setTaskStatus: (projectPath, taskId, status) => require('./tasksManager').updateTask(projectPath, taskId, { status }),
  onApprovalsChanged: (chief, pending) => send(IPC.LEAD_APPROVALS, { ...chief, pending })
};

// ─── server Chiefs (T12) ───────────────────────────────────

function server() {
  return require('./serverConnection');
}

/** `{ link, serverTerminalId, info }` for a server Chief's desktop id, or null. */
function serverRoute(terminalId) {
  if (!isServerTerminalId(terminalId)) return null;
  const split = splitDesktopTerminalId(terminalId);
  const link = split && server().of(split.serverKey);
  if (!link || !link.isConnected()) return null;
  return { link, serverTerminalId: split.serverTerminalId, info: ptyManager.serverTerminalInfo(terminalId) || {} };
}

/** Server-local ids in an approval record → desktop ids, so the renderer can name the target. */
function toDesktopRecord(rec, key) {
  return { ...rec, chiefId: desktopTerminalId(key, rec.chiefId) || rec.chiefId, target: rec.target ? (desktopTerminalId(key, rec.target) || rec.target) : null, serverKey: key };
}

function forwardServerApprovals(payload, key) {
  if (!payload || !payload.chiefId) return;
  const chiefId = desktopTerminalId(key, payload.chiefId);
  if (!chiefId) return;
  send(IPC.LEAD_APPROVALS, {
    chiefId,
    machine: 'server',
    serverKey: key,
    pending: (payload.pending || []).map((r) => toDesktopRecord(r, key))
  });
}

/** Connected servers that hold workspaces of this project, each with its clone path: where a server Chief belongs. */
async function serverChiefTargets(projectPath) {
  if (!projectPath) return [];
  let rows = [];
  try {
    const listed = await require('./workspaceManager').list(projectPath);
    rows = ((listed && listed.workspaces) || []).filter((w) => w.location === 'server' && w.serverProjectPath && !w.offline);
  } catch (_) {
    return [];
  }
  const seen = new Map();
  for (const w of rows) {
    const link = server().of(w.serverKey);
    if (!link || !link.isConnected() || seen.has(w.serverKey)) continue;
    seen.set(w.serverKey, { serverKey: w.serverKey, host: w.host || link.host, serverProjectPath: w.serverProjectPath });
  }
  return [...seen.values()];
}

function init(window) {
  mainWindow = window;
  if (host) return;
  try {
    server().on('lead.approvals', (payload, key) => forwardServerApprovals(payload, key));
    // A server Chief opened a queue item's terminal (work-queue T11): the
    // window adopts it like the server's other terminals of the project.
    server().on('lead.terminalOpened', (payload, key) => send(IPC.LEAD_TERMINAL_OPENED, { serverKey: key }));
  } catch (e) { logger.warn('lead', `server events not wired: ${e.message}`); }
  host = createLeadHost({ machine: MACHINE, machineLabel: 'this Mac', adapter, logger });
  ptyManager.onTerminalExit((terminalId) => {
    try { host.terminalGone(terminalId); } catch (e) { logger.warn('lead', `terminalGone failed: ${e.message}`); }
  });
}

/** The desktop host (T12's server bridge and tests). */
function getHost() {
  return host;
}

function setupIPC(ipcMain) {
  ipcMain.handle(IPC.LEAD_START, async (event, { projectPath, terminalId } = {}) => {
    if (isServerTerminalId(terminalId)) {
      const route = serverRoute(terminalId);
      if (!route) return { ok: false, error: 'That server is not connected.' };
      try {
        const res = await route.link.call('lead.start', { terminalId: route.serverTerminalId });
        return { ok: true, command: res.command, mode: res.mode };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }
    if (!host) return { ok: false, error: 'Chief host not ready' };
    if (!terminalId || !ptyManager.isLeadTerminal(terminalId) || ptyManager.leadTerminalOf(projectPath) !== terminalId) {
      return { ok: false, error: 'Not this project\'s Chief terminal' };
    }
    try {
      const res = await host.startChief({ chiefId: terminalId, projectPath });
      return { ok: true, command: res.command, mode: res.mode };
    } catch (e) {
      logger.error('lead', `startChief failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.on(IPC.LEAD_STOP, (event, { terminalId } = {}) => {
    if (isServerTerminalId(terminalId)) {
      const route = serverRoute(terminalId);
      if (route) route.link.call('lead.stop', { terminalId: route.serverTerminalId }).catch(() => {});
      return;
    }
    if (host && terminalId) host.stopChief(terminalId, { reason: 'The Chief session ended.' });
  });

  // Modes are per (project, machine): a server Chief's mode lives on its server.
  ipcMain.handle(IPC.LEAD_MODE_GET, async (event, { projectPath, terminalId = null } = {}) => {
    const route = terminalId ? serverRoute(terminalId) : null;
    if (route) return route.link.call('lead.mode', { projectPath: route.info.serverProjectPath }).catch(() => 'user-guided');
    return host ? host.getMode(projectPath) : 'user-guided';
  });
  ipcMain.handle(IPC.LEAD_MODE_SET, async (event, { projectPath, mode, terminalId = null } = {}) => {
    const route = terminalId ? serverRoute(terminalId) : null;
    if (route) return route.link.call('lead.mode', { projectPath: route.info.serverProjectPath, mode }).catch(() => 'user-guided');
    return host ? host.setMode(projectPath, mode) : 'user-guided';
  });

  // Start queue (work-queue T12): the Chief of that terminal works its machine's queue.
  ipcMain.handle(IPC.LEAD_QUEUE_START, async (event, { terminalId } = {}) => {
    if (isServerTerminalId(terminalId)) {
      const route = serverRoute(terminalId);
      if (!route) return { ok: false, reason: 'That server is not connected.' };
      try { return await route.link.call('lead.queueStart', { terminalId: route.serverTerminalId }); } catch (e) { return { ok: false, reason: e.message }; }
    }
    return host ? host.queueStart(terminalId) : { ok: false, reason: 'Chief host not ready' };
  });

  ipcMain.handle(IPC.LEAD_SERVER_TARGETS, (event, { projectPath } = {}) => serverChiefTargets(projectPath));

  // This project's Chiefs with what they wait on — local, plus every connected
  // server's (a reconnect shows the approvals asked while the Mac was away).
  ipcMain.handle(IPC.LEAD_PENDING, async (event, { projectPath } = {}) => {
    const out = host ? host.chiefsFor(projectPath).map((c) => ({ ...c, pending: host.pending(c.chiefId) })) : [];
    for (const t of await serverChiefTargets(projectPath)) {
      try {
        const list = await server().of(t.serverKey).call('lead.pending', { projectPath: t.serverProjectPath });
        for (const c of list || []) {
          out.push({ chiefId: desktopTerminalId(t.serverKey, c.chiefId), machine: 'server', serverKey: t.serverKey, pending: (c.pending || []).map((r) => toDesktopRecord(r, t.serverKey)) });
        }
      } catch (_) { /* that server cannot answer now */ }
    }
    return out;
  });

  ipcMain.handle(IPC.LEAD_DECIDE, (event, { approvalId, decision, text = null, serverKey = null } = {}) => {
    if (serverKey) return module.exports.decideOnServer(serverKey, { approvalId, decision, text });
    return host ? host.decide(approvalId, { decision, text }) : { ok: false };
  });

  ipcMain.on(IPC.LEAD_OPEN_TERMINAL_REPLY, (event, reply = {}) => {
    const fn = openWaiters.get(reply.requestId);
    if (!fn) return;
    openWaiters.delete(reply.requestId);
    fn(reply);
  });

  ipcMain.on(IPC.LEAD_SCREEN_REPLY, (event, { requestId, text } = {}) => {
    const fn = screenWaiters.get(requestId);
    if (!fn) return;
    screenWaiters.delete(requestId);
    fn(text);
  });
}

/** A server Chief's approval, decided here; the server applies the first decision only. */
async function decideOnServer(serverKey, { approvalId, decision, text = null } = {}) {
  const link = server().of(serverKey);
  if (!link || !link.isConnected()) return { ok: false, error: 'That server is not connected.' };
  try {
    return await link.call('lead.decide', { approvalId, decision, text });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function shutdown() {
  if (host) host.close();
  host = null;
}

module.exports = { init, setupIPC, getHost, shutdown, decideOnServer, _adapter: adapter };
