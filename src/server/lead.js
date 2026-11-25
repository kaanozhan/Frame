/**
 * Server Chief — the Frame Server side of the Chief (lead-agent spec, T11).
 *
 * The same leadHost the desktop runs, wired to this server's PTYs: a server
 * Chief lives in a project's server clone and sees that project's terminals
 * on this server — never a desktop terminal (spec C4: the access direction
 * stays desktop → server). It keeps working while no desktop is connected;
 * in user-guided mode its approvals wait until a desktop connects and shows
 * them (`lead.approvals` event, `lead.pending` on reconnect, `lead.decide`).
 *
 * Terminal ids are the server's own `srv-<boot>-<n>`; ptyManager underneath
 * still knows them as `term-<n>`.
 *
 * Methods: lead.start · lead.stop · lead.mode · lead.pending · lead.decide
 * Event:   lead.approvals { chiefId, projectPath, machine, pending[] }
 *          lead.terminalOpened { projectPath } — the Chief opened a queue
 *          item's terminal; a connected desktop re-adopts the project's terminals
 *
 * The work queue (work-queue T11): this server's queue of a project lives in
 * its clone (queueStore); the Chief opens queue terminals here, so the queue
 * keeps moving while no desktop is connected.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLeadHost } = require('../main/leadHost');
const transcript = require('../shared/leadTranscript');
const claudeSessionsManager = require('../main/claudeSessionsManager');
const { toServerId, toLocalId } = require('./terminals');
const logger = require('../main/logger');
const queueStore = require('../main/queueStore');

function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

/**
 * @param {object} o
 * @param {Function} o.registerMethods
 * @param {Function} o.broadcast
 * @param {object} o.terminals  what src/server/terminals.js setup() returned
 */
function setup({ registerMethods, broadcast, terminals }) {
  const pty = terminals.ptyManager;

  // No sessionRestore on a server: a terminal's transcript comes from the
  // Claude CLI's own session file, by its pid (plan D16).
  async function transcriptFor(id) {
    const pid = await pty.getForegroundPid(toLocalId(id));
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

  const adapter = {
    listTerminals: (projectPath) => terminals.terminalsOf(projectPath),
    status: (id) => pty.agentStatus(toLocalId(id)),
    pasteMode: (id) => pty.pasteMode(toLocalId(id)),
    lastUserInputAt: (id) => pty.getLastUserInputAt(toLocalId(id)),
    readScreen: async (id, lines) => {
      const m = terminals.metaOf(id);
      return m ? m.mirror.text({ lines }) : null;
    },
    transcriptFor,
    write: (id, data) => pty.writeToTerminal(toLocalId(id), data),
    orchestrationIds: () => [], // no conductor runs on a server
    createTerminal: async ({ projectPath, cwd, name = null } = {}) => {
      const terminalId = terminals.createQueueTerminal({ projectPath, cwd, name });
      broadcast('lead.terminalOpened', { projectPath, terminalId });
      return terminalId;
    },
    queue: {
      load: (projectPath) => queueStore.load(projectPath),
      change: (projectPath, fn) => queueStore.update(projectPath, fn) // queue.watch tells the desktops
    },
    setTaskStatus: (projectPath, taskId, status) => require('../main/tasksManager').updateTask(projectPath, taskId, { status }),
    onApprovalsChanged: (chief, pending) => broadcast('lead.approvals', { ...chief, pending })
  };

  const host = createLeadHost({ machine: 'server', machineLabel: `server ${os.hostname()}`, adapter, logger });

  pty.onTerminalExit((localId) => {
    try { host.terminalGone(toServerId(localId)); } catch (e) { logger.warn('lead', `terminalGone failed: ${e.message}`); }
  });

  registerMethods({
    'lead.start': async ({ terminalId } = {}) => {
      const m = terminals.metaOf(terminalId);
      if (!m || !m.lead) throw new Error('Not a Chief terminal on this server');
      // Items whose terminal is gone (a server restart) are interrupted (D19).
      try { queueStore.reconcile(m.projectPath, new Set(terminals.terminalsOf(m.projectPath).map((t) => t.id))); } catch (e) { logger.warn('lead', `queue reconcile failed: ${e.message}`); }
      const res = await host.startChief({ chiefId: terminalId, projectPath: m.projectPath, platform: process.platform });
      return { command: res.command, mode: res.mode };
    },
    'lead.stop': async ({ terminalId } = {}) => ({ stopped: host.stopChief(terminalId, { reason: 'The Chief session ended.' }) }),
    'lead.mode': async ({ projectPath, mode } = {}) => (mode ? host.setMode(projectPath, mode) : host.getMode(projectPath)),
    'lead.pending': async ({ projectPath = null } = {}) => host.chiefsFor(projectPath).map((c) => ({ ...c, pending: host.pending(c.chiefId) })),
    // The server is the authority: the first desktop to decide wins (D17).
    'lead.decide': async ({ approvalId, decision, text = null } = {}) => host.decide(approvalId, { decision, text })
  });

  return {
    stop() { host.close(); }
  };
}

module.exports = { setup };
