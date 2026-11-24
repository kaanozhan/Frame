/**
 * leadManager — the desktop side of the Chief (lead-agent spec, T09).
 *
 * Wires the machine-agnostic leadHost to this machine: the local PTYs
 * (ptyManager), the renderer's xterm buffers for screen text (plan D5), the
 * conductor's lanes (read-only while the conductor still exists, D18), and
 * transcripts (sessionRestore first, then Claude's own pid file, D16).
 *
 * Only local terminals: a server's terminals belong to that server's Chief
 * (spec C4). The server side of approvals reaches the renderer through
 * src/main/leadManager's server bridge in T12.
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

const SCREEN_TIMEOUT_MS = 3000;
const MACHINE = 'desktop';

let mainWindow = null;
let host = null;
const screenWaiters = new Map(); // requestId → resolve

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
  // Not used by any v1 tool; the work-queue spec's "open a terminal" lands here (D19).
  createTerminal: async ({ cwd, projectPath, workspaceId = 'main' } = {}) => ptyManager.createTerminal(cwd, projectPath, null, null, workspaceId),
  onApprovalsChanged: (chief, pending) => send(IPC.LEAD_APPROVALS, { ...chief, pending })
};

function init(window) {
  mainWindow = window;
  if (host) return;
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
    if (host && terminalId) host.stopChief(terminalId, { reason: 'The Chief session ended.' });
  });

  ipcMain.handle(IPC.LEAD_MODE_GET, (event, { projectPath } = {}) => (host ? host.getMode(projectPath) : 'user-guided'));
  ipcMain.handle(IPC.LEAD_MODE_SET, (event, { projectPath, mode } = {}) => (host ? host.setMode(projectPath, mode) : 'user-guided'));

  ipcMain.handle(IPC.LEAD_PENDING, (event, { projectPath } = {}) => {
    if (!host) return [];
    return host.chiefsFor(projectPath).map((c) => ({ ...c, pending: host.pending(c.chiefId) }));
  });

  ipcMain.handle(IPC.LEAD_DECIDE, (event, { approvalId, decision, text = null, serverKey = null } = {}) => {
    if (serverKey) return module.exports.decideOnServer(serverKey, { approvalId, decision, text });
    return host ? host.decide(approvalId, { decision, text }) : { ok: false };
  });

  ipcMain.on(IPC.LEAD_SCREEN_REPLY, (event, { requestId, text } = {}) => {
    const fn = screenWaiters.get(requestId);
    if (!fn) return;
    screenWaiters.delete(requestId);
    fn(text);
  });
}

/** A server Chief's approval, decided on the desktop (T12 fills this in). */
async function decideOnServer() {
  return { ok: false, error: 'Server Chiefs are not connected yet' };
}

function shutdown() {
  if (host) host.close();
  host = null;
}

module.exports = { init, setupIPC, getHost, shutdown, decideOnServer, _adapter: adapter };
