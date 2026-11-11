/**
 * Server terminals — the PTYs of server workspaces (server-workspaces spec, T4).
 *
 * The one interface a later pty-host daemon can replace. Today it drives
 * Frame's own `ptyManager` inside Frame Server (through the electron shim's
 * fake window) and keeps a screen mirror per terminal so a desktop that
 * comes back can redraw the exact screen.
 *
 * Ids: ptyManager's `term-<n>` is exposed as `srv-<boot>-<n>` (serverRouting),
 * so the desktop can route by id, its local teardown never touches these, and
 * an id from before a server restart never names a new terminal
 * (server-hardening T3: `<boot>` is a nonce per server process).
 *
 * Methods: terminals.create / input / resize / destroy / list / attach.
 * Events:  terminal.output { terminalId, data }
 *          terminal.process { terminalId, processName, shellName, commandLine }
 *          terminal.destroyed { terminalId, exitCode }
 * The PTYs live as long as the server process: a desktop disconnecting
 * changes nothing here.
 */

const { IPC } = require('../shared/ipcChannels');
const crypto = require('crypto');
const os = require('os');
const { serverTerminalId, parseServerTerminalId } = require('../shared/serverRouting');
const { createMirror } = require('./screenMirror');

const LOCAL_PREFIX = 'term-';
const BOOT = crypto.randomBytes(3).toString('hex');
const toServerId = (id) => (id && id.startsWith(LOCAL_PREFIX) ? serverTerminalId(id.slice(LOCAL_PREFIX.length), BOOT) : id);
// An id of another boot names no terminal here.
const toLocalId = (id) => {
  const p = parseServerTerminalId(id);
  if (!p) return id;
  return p.boot === BOOT ? `${LOCAL_PREFIX}${p.n}` : `${LOCAL_PREFIX}gone-${p.n}`;
};

/**
 * Wire terminals into the server: `shim` is the installed electron shim,
 * `registerMethods` / `broadcast` come from the server entry.
 */
function setup({ shim, registerMethods, broadcast }) {
  const ptyManager = require('../main/ptyManager');
  ptyManager.init(shim.fakeWindow);
  const meta = new Map(); // srv id → { projectPath, workspaceId, cwd, createdAt, mirror, process }

  shim.onSend((channel, payload) => {
    if (!payload || !payload.terminalId) return;
    const terminalId = toServerId(payload.terminalId);
    const m = meta.get(terminalId);
    if (channel === IPC.TERMINAL_OUTPUT_ID) {
      if (m) m.mirror.write(payload.data);
      broadcast('terminal.output', { terminalId, data: payload.data });
    } else if (channel === IPC.TERMINAL_PROCESS_DATA) {
      const p = { terminalId, processName: payload.processName, shellName: payload.shellName, commandLine: payload.commandLine };
      if (m) m.process = p;
      broadcast('terminal.process', p);
    } else if (channel === IPC.TERMINAL_DESTROYED) {
      if (m) { m.mirror.dispose(); meta.delete(terminalId); }
      broadcast('terminal.destroyed', { terminalId, exitCode: payload.exitCode });
    }
  });

  const describe = (terminalId, m) => ({
    terminalId,
    projectPath: m.projectPath,
    workspaceId: m.workspaceId,
    home: !!m.home,
    homeFor: m.homeFor || null,
    homeWorkspace: m.homeWorkspace || null,
    cwd: m.cwd,
    createdAt: m.createdAt,
    ...m.mirror.size,
    process: m.process || null
  });

  const need = (terminalId) => {
    const m = meta.get(terminalId);
    if (!m || !ptyManager.hasTerminal(toLocalId(terminalId))) throw new Error(`No server terminal ${terminalId}`);
    return m;
  };

  registerMethods({
    'terminals.create': async ({ projectPath = null, workspaceId = 'main', cwd = null, cols = 80, rows = 24, shell = null, extraEnv = null, home = false, homeFor = null, homeWorkspace = null } = {}) => {
      // A home terminal (server-onboarding): the user's home folder, no
      // project or workspace here; `homeFor` names the desktop project it was
      // opened from so a reconnecting desktop can adopt it there.
      if (home === true) {
        projectPath = null;
        workspaceId = null;
        cwd = os.homedir();
      }
      const localId = ptyManager.createTerminal(cwd, projectPath, shell, extraEnv, workspaceId || 'main');
      const terminalId = toServerId(localId);
      const mirror = createMirror({ cols, rows });
      meta.set(terminalId, { projectPath, workspaceId, home: home === true, homeFor: home === true && typeof homeFor === 'string' ? homeFor : null, homeWorkspace: home === true && typeof homeWorkspace === 'string' ? homeWorkspace : null, cwd: (ptyManager.getTerminalInfo(localId) || {}).cwd || cwd, createdAt: Date.now(), mirror, process: null });
      if (cols !== 80 || rows !== 24) ptyManager.resizeTerminal(localId, cols, rows);
      return { terminalId, cols, rows };
    },
    'terminals.input': async ({ terminalId, data }) => {
      need(terminalId);
      if (typeof data === 'string' && data) ptyManager.writeToTerminal(toLocalId(terminalId), data);
      return null;
    },
    'terminals.resize': async ({ terminalId, cols, rows }) => {
      const m = need(terminalId);
      if (cols > 0 && rows > 0) {
        ptyManager.resizeTerminal(toLocalId(terminalId), cols, rows);
        m.mirror.resize(cols, rows);
      }
      return null;
    },
    'terminals.destroy': async ({ terminalId }) => {
      if (meta.has(terminalId)) ptyManager.destroyTerminal(toLocalId(terminalId));
      const m = meta.get(terminalId);
      if (m) { m.mirror.dispose(); meta.delete(terminalId); }
      // The PTY's exit sends terminal.destroyed (ptyManager → fake window).
      return null;
    },
    'terminals.list': async ({ projectPath = null } = {}) => {
      const out = [];
      for (const [terminalId, m] of meta) {
        if (!ptyManager.hasTerminal(toLocalId(terminalId))) continue;
        if (projectPath && m.projectPath !== projectPath) continue;
        out.push(describe(terminalId, m));
      }
      return out.sort((a, b) => a.createdAt - b.createdAt);
    },
    'terminals.attach': async ({ terminalId }) => {
      const m = need(terminalId);
      const snap = await m.mirror.snapshot();
      return { ...describe(terminalId, m), screen: snap.screen, cols: snap.cols, rows: snap.rows };
    }
  });

  return {
    stop() {
      for (const m of meta.values()) m.mirror.dispose();
      meta.clear();
      ptyManager.destroyAll();
    }
  };
}

module.exports = { setup, toServerId, toLocalId, BOOT };
