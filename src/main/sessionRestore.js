/**
 * Session restore — the main-process half (restore-ai-sessions-on-relaunch).
 *
 * Learns which Claude Code / Codex session runs in which terminal, keeps one
 * record per project in `~/.frame/session-restore.json`, and hands a project's
 * record to the renderer the first time that project opens after a launch.
 *
 * Inputs:
 *  - **Reports.** Every PTY gets `FRAME_TERMINAL_ID` / `FRAME_SESSION_DIR` in
 *    its env (ptyManager). The SessionStart hook (frameTemplates) drops the
 *    CLI's payload into that directory as `<terminalId>.<tool>.<pid>.json`;
 *    a watcher picks it up here.
 *  - **Terminal lifecycle** from ptyManager: spawn, foreground changes, user
 *    close / shell exit, and teardown (`freeze`).
 *  - **Renderer**: restore claims, renames, focus, the last active project.
 *
 * Every decision about what those inputs mean lives in the pure
 * `sessionRestoreStore`; this module only does the I/O around it.
 *
 * Teardown is not a close. Quit, window close and reload all go through
 * `ptyManager.destroyAll()`, which freezes this module before a single PTY is
 * killed — otherwise the dying CLIs would read as "the user left the
 * session" and empty every record on the way out.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const fsSafe = require('./fsSafe');
const core = require('./sessionRestoreStore');
const { IPC } = require('../shared/ipcChannels');
const { WORKSPACE_DIR } = require('../shared/frameConstants');

const STORE_FILE = 'session-restore.json';
const REPORT_DIR = 'session-reports';
// A restore that never reports back (renderer gone mid-restore) stops
// holding its project's record after this long.
const RESTORE_HOLD_MS = 60 * 1000;

let storePath = null;
let reportDir = null;
let state = core.normalizeStore(null);
const live = {};
const shellPids = new Map(); // terminalId → PTY shell pid, for the foreground check
const restoring = new Map(); // projectPath → hold timer while its restore runs
let frozen = false;
let watcher = null;
let scanTimer = null;

/**
 * Create the report directory, drop last run's leftovers (their terminals
 * are gone), load the store and start watching.
 */
function init() {
  const base = path.join(os.homedir(), WORKSPACE_DIR);
  storePath = path.join(base, STORE_FILE);
  reportDir = path.join(base, REPORT_DIR);

  try {
    fs.mkdirSync(reportDir, { recursive: true });
    for (const name of fs.readdirSync(reportDir)) {
      try { fs.unlinkSync(path.join(reportDir, name)); } catch (_) { /* next */ }
    }
  } catch (err) {
    console.warn('[session-restore] report directory unavailable:', err.message);
  }

  const { data } = fsSafe.readJsonWithRecovery(storePath);
  state = core.normalizeStore(data);

  try {
    watcher = fsSafe.safeWatch(reportDir, null, scheduleScan, () => { watcher = null; });
  } catch (err) {
    console.warn('[session-restore] cannot watch reports:', err.message);
  }
}

/** The env a PTY needs so its CLIs can report. Empty when init failed. */
function envFor(terminalId) {
  if (!reportDir) return {};
  return { FRAME_TERMINAL_ID: terminalId, FRAME_SESSION_DIR: reportDir };
}

// ─── persistence ──────────────────────────────────────────

function writeStore() {
  if (!storePath) return;
  try {
    fsSafe.writeFileAtomic(storePath, JSON.stringify(state, null, 2) + '\n');
  } catch (err) {
    console.warn('[session-restore] could not save:', err.message);
  }
}

const sameRecord = (a, b) =>
  JSON.stringify({ ...(a || {}), savedAt: 0 }) === JSON.stringify({ ...(b || {}), savedAt: 0 });

/** Rewrite one project's record from its live terminals. */
function persist(projectPath) {
  if (!projectPath || frozen || restoring.has(projectPath)) return;
  const record = core.projectRecord(live, projectPath, Date.now());
  const previous = state.projects[projectPath];
  if (record.sessions.length === 0 && !previous) return;
  if (previous && sameRecord(previous, record)) return;
  core.putRecord(state, projectPath, record);
  writeStore();
}

// ─── terminal lifecycle (ptyManager) ──────────────────────

function registerTerminal(terminalId, { projectPath = null, shellPid = null } = {}) {
  // A new terminal after a teardown means the app is in use again (reload).
  frozen = false;
  if (shellPid) shellPids.set(terminalId, shellPid);
  core.registerTerminal(live, terminalId, { projectPath, createdAt: Date.now() });
}

function onForeground(terminalId, processName, shellName) {
  if (frozen) return;
  persist(core.applyForeground(live, terminalId, { processName, shellName }));
}

/** The user closed the terminal or its shell exited. */
function onClose(terminalId) {
  shellPids.delete(terminalId);
  if (frozen) return;
  persist(core.applyClose(live, terminalId));
}

/** App teardown: keep every record exactly as it is. */
function freeze() {
  frozen = true;
}

// ─── reports ──────────────────────────────────────────────

function scheduleScan() {
  if (scanTimer) return;
  scanTimer = setTimeout(() => {
    scanTimer = null;
    scanReports();
  }, 100);
}

function scanReports() {
  let names;
  try {
    names = fs.readdirSync(reportDir);
  } catch (_) {
    return;
  }
  for (const name of names) {
    if (!core.parseReportName(name)) continue;
    const file = path.join(reportDir, name);
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
      fs.unlinkSync(file);
    } catch (_) {
      continue;
    }
    if (frozen) continue;
    const report = core.parseReport(name, text);
    if (!report || !live[report.terminalId]) continue;
    isForegroundJob(report.pid, shellPids.get(report.terminalId), (ok) => {
      if (ok && !frozen) persist(core.applyReport(live, report));
    });
  }
}

/**
 * Is `pid` the terminal's foreground job? A CLI started from inside a
 * session's Bash tool inherits the env and reports too, but sits in another
 * process group (measurements.md §3). Windows has no tpgid; there the
 * report is taken as is.
 */
function isForegroundJob(pid, shellPid, callback) {
  if (process.platform === 'win32') return callback(true);
  if (!pid || !shellPid) return callback(false);
  execFile('ps', ['-o', 'pid=,pgid=,tpgid=', '-p', `${pid},${shellPid}`], (err, out) => {
    if (err && !out) return callback(false);
    const rows = {};
    for (const line of String(out || '').trim().split('\n')) {
      const [p, pgid, tpgid] = line.trim().split(/\s+/).map(Number);
      if (p) rows[p] = { pgid, tpgid };
    }
    const cli = rows[pid];
    const shell = rows[shellPid];
    callback(!!(cli && shell && shell.tpgid > 0 && cli.pgid === shell.tpgid));
  });
}

// ─── renderer ─────────────────────────────────────────────

/**
 * A project's restore plan. Holds the project's record until the renderer
 * says the restore is done, so the first claimed terminal does not rewrite
 * the record down to one session while the rest are still being opened.
 */
function take(projectPath) {
  const plan = core.planRestore(state.projects[projectPath], (p) => fs.existsSync(p));
  if (plan.sessions.length > 0) {
    clearTimeout(restoring.get(projectPath));
    restoring.set(projectPath, setTimeout(() => restoreDone(projectPath), RESTORE_HOLD_MS));
  }
  return plan;
}

function restoreDone(projectPath) {
  if (!restoring.has(projectPath)) return;
  clearTimeout(restoring.get(projectPath));
  restoring.delete(projectPath);
  persist(projectPath);
}

function setLastActiveProject(projectPath) {
  const next = typeof projectPath === 'string' ? projectPath : null;
  if (state.lastActiveProject === next) return;
  state.lastActiveProject = next;
  writeStore();
}

function setupIPC(ipcMain) {
  ipcMain.handle(IPC.SESSION_RESTORE_TAKE, (event, projectPath) => take(projectPath));
  ipcMain.on(IPC.SESSION_RESTORE_DONE, (event, projectPath) => restoreDone(projectPath));
  ipcMain.on(IPC.SESSION_RESTORE_CLAIM, (event, { terminalId, ...claim } = {}) => {
    persist(core.applyClaim(live, terminalId, claim));
  });
  ipcMain.on(IPC.SESSION_RESTORE_META, (event, { terminalId, ...meta } = {}) => {
    persist(core.applyMeta(live, terminalId, meta));
  });
  ipcMain.handle(IPC.SESSION_RESTORE_GET_LAST_PROJECT, () => state.lastActiveProject);
  ipcMain.on(IPC.SESSION_RESTORE_SET_LAST_PROJECT, (event, projectPath) => setLastActiveProject(projectPath));
}

module.exports = {
  init,
  envFor,
  registerTerminal,
  onForeground,
  onClose,
  freeze,
  setupIPC
};
