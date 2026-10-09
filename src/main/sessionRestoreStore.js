/**
 * Which AI session runs in which terminal, and what each project restores.
 *
 * Pure by contract: no `electron`, no `fs`, no clock of its own. The wrapper
 * (`sessionRestore.js`) owns the file, the report directory and the process
 * checks; this module owns every decision about what those inputs mean, so
 * the decisions can be tested without standing any of that up.
 *
 * Two shapes:
 *
 *  - **live** — `{ [terminalId]: entry }` for this process's terminals. An
 *    entry carries a session only once its CLI reported one (SessionStart
 *    hook) or a restore claimed one. Plain shells never get a session, which
 *    is the whole of "plain shells are not restored".
 *  - **store** — what `~/.frame/session-restore.json` holds: the last active
 *    project and one record per project. A project's record is rewritten only
 *    from live events that concern it, so a project nobody opened this run
 *    keeps the record it had at the last quit.
 *
 * Reducers mutate `live` and return the project path whose record must be
 * rewritten, or null when nothing persistent changed.
 */

const path = require('path');

const STORE_VERSION = 1;

/** The CLIs whose sessions are captured and resumed. */
const TOOLS = ['claude', 'codex'];

/** Project records kept, most recently saved first — same cap as the
 *  renderer's localStorage terminal record. */
const MAX_PROJECTS = 20;

/** One project restores at most this many terminals — the per-project
 *  terminal cap in ptyManager / terminalManager. */
const MAX_RESTORE = 9;

// Session ids reach a command line, so they must be exactly what the CLIs
// name their transcripts: a UUID, nothing else. Codex ids are UUIDv7-shaped
// and pass the same check (measurements.md §2).
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// `<terminalId>.<tool>.<pid>.json`, written by the hook (frameTemplates).
const REPORT_NAME_RE = /^(term-\d+)\.(claude|codex)\.(\d+)\.json$/;

function isAbsolutePath(value) {
  return typeof value === 'string' && (path.posix.isAbsolute(value) || path.win32.isAbsolute(value));
}

function isSessionId(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Parse a report file's name. Anything else in the directory — the hook's
 * `.tmp` half-writes included — is not a report.
 */
function parseReportName(name) {
  const m = REPORT_NAME_RE.exec(String(name || ''));
  if (!m) return null;
  return { terminalId: m[1], tool: m[2], pid: Number(m[3]) };
}

/**
 * A report is the CLI's SessionStart payload, verbatim. Returns null for a
 * name that is not a report, unparseable JSON, a non-UUID session id or a
 * missing transcript path — a session that cannot be checked for existence
 * is a session that cannot be restored safely.
 */
function parseReport(name, text) {
  const meta = parseReportName(name);
  if (!meta) return null;
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_) {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  if (!isSessionId(payload.session_id)) return null;
  if (!isAbsolutePath(payload.transcript_path)) return null;
  return {
    ...meta,
    sessionId: payload.session_id,
    transcriptPath: payload.transcript_path,
    cwd: typeof payload.cwd === 'string' ? payload.cwd : null,
    source: typeof payload.source === 'string' ? payload.source : null
  };
}

// ─── live map ─────────────────────────────────────────────

function emptyEntry(terminalId, projectPath, createdAt) {
  return {
    terminalId,
    projectPath: projectPath || null,
    createdAt,
    tool: null,
    sessionId: null,
    transcriptPath: null,
    cwd: null,
    name: null,
    active: false,
    // An agent has been seen in the foreground. Only an agent → shell
    // transition ends a session: a restored terminal sits at its shell
    // prompt until the resume command lands, and must not be dropped then.
    seenAgent: false
  };
}

function hasSession(entry) {
  return !!(entry && entry.sessionId);
}

/** A PTY was spawned. Terminals without a project (global) are never restored. */
function registerTerminal(live, terminalId, { projectPath = null, createdAt = 0 } = {}) {
  if (!live[terminalId]) live[terminalId] = emptyEntry(terminalId, projectPath, createdAt);
  return null;
}

/**
 * A CLI reported its session. The caller has already checked the reporter is
 * the terminal's foreground job; an unknown terminal (closed, or from another
 * process) is ignored.
 */
function applyReport(live, report) {
  const entry = live[report.terminalId];
  if (!entry || !entry.projectPath) return null;
  const changed = entry.sessionId !== report.sessionId || entry.tool !== report.tool
    || entry.transcriptPath !== report.transcriptPath;
  entry.tool = report.tool;
  entry.sessionId = report.sessionId;
  entry.transcriptPath = report.transcriptPath;
  entry.cwd = report.cwd || entry.cwd;
  entry.seenAgent = true;
  return changed ? entry.projectPath : null;
}

/**
 * The renderer opened this terminal to resume a saved session. Registered
 * before the CLI starts so the record keeps it even if the hook never
 * reports (an untrusted Codex hook, say).
 */
function applyClaim(live, terminalId, { tool, sessionId, transcriptPath, cwd = null, name = null } = {}) {
  const entry = live[terminalId];
  if (!entry || !entry.projectPath) return null;
  if (!TOOLS.includes(tool) || !isSessionId(sessionId)) return null;
  entry.tool = tool;
  entry.sessionId = sessionId;
  entry.transcriptPath = transcriptPath || null;
  entry.cwd = cwd || entry.cwd;
  if (name) entry.name = name;
  entry.seenAgent = false;
  return entry.projectPath;
}

/** Rename and focus, from the renderer. `active: true` clears the flag on
 *  the project's other terminals — one active terminal per project. */
function applyMeta(live, terminalId, { name, active } = {}) {
  const entry = live[terminalId];
  if (!entry || !entry.projectPath) return null;
  let changed = false;
  if (name !== undefined && (name || null) !== entry.name) {
    entry.name = name || null;
    changed = true;
  }
  if (active === true && !entry.active) {
    for (const other of Object.values(live)) {
      if (other.projectPath === entry.projectPath) other.active = false;
    }
    entry.active = true;
    changed = true;
  }
  return changed ? entry.projectPath : null;
}

/**
 * The terminal's foreground process changed (ptyManager's poll). Anything
 * but the shell counts as the agent being up; the shell again after that
 * means the user left the CLI, and the session leaves the record.
 */
function applyForeground(live, terminalId, { processName, shellName } = {}) {
  const entry = live[terminalId];
  if (!entry || !processName) return null;
  if (processName !== shellName) {
    entry.seenAgent = true;
    return null;
  }
  if (!entry.seenAgent || !hasSession(entry)) return null;
  entry.tool = null;
  entry.sessionId = null;
  entry.transcriptPath = null;
  entry.seenAgent = false;
  return entry.projectPath;
}

/** The user closed the terminal, or its shell exited. Never called during
 *  app teardown — the wrapper is frozen then. */
function applyClose(live, terminalId) {
  const entry = live[terminalId];
  if (!entry) return null;
  delete live[terminalId];
  return hasSession(entry) ? entry.projectPath : null;
}

// ─── store ────────────────────────────────────────────────

function normalizeStore(raw) {
  const store = { version: STORE_VERSION, lastActiveProject: null, projects: {} };
  if (!raw || typeof raw !== 'object') return store;
  if (typeof raw.lastActiveProject === 'string') store.lastActiveProject = raw.lastActiveProject;
  if (raw.projects && typeof raw.projects === 'object') {
    for (const [projectPath, record] of Object.entries(raw.projects)) {
      if (record && Array.isArray(record.sessions)) store.projects[projectPath] = record;
    }
  }
  return store;
}

/** A project's record, projected from its live terminals, oldest first. */
function projectRecord(live, projectPath, now) {
  const entries = Object.values(live)
    .filter((e) => e.projectPath === projectPath && hasSession(e))
    .sort((a, b) => a.createdAt - b.createdAt);
  const active = entries.find((e) => e.active);
  return {
    savedAt: now,
    activeSessionId: active ? active.sessionId : null,
    sessions: entries.map((e) => ({
      tool: e.tool,
      sessionId: e.sessionId,
      transcriptPath: e.transcriptPath,
      cwd: e.cwd,
      name: e.name
    }))
  };
}

/**
 * Write a project's record into the store. An empty record removes the
 * project — nothing to restore is the same as no record. Prunes to
 * MAX_PROJECTS by `savedAt`, never dropping the project just written.
 */
function putRecord(store, projectPath, record) {
  if (!projectPath) return store;
  if (!record || record.sessions.length === 0) {
    delete store.projects[projectPath];
    return store;
  }
  store.projects[projectPath] = record;
  const others = Object.keys(store.projects).filter((k) => k !== projectPath);
  const excess = others.length - (MAX_PROJECTS - 1);
  if (excess > 0) {
    others
      .sort((a, b) => (store.projects[a].savedAt || 0) - (store.projects[b].savedAt || 0))
      .slice(0, excess)
      .forEach((k) => delete store.projects[k]);
  }
  return store;
}

/**
 * What to reopen for a project: its saved sessions whose transcript still
 * exists, in saved order, capped at MAX_RESTORE. `exists` is injected so the
 * wrapper does the disk check and a test can pin it.
 */
function planRestore(record, exists) {
  if (!record || !Array.isArray(record.sessions)) return { sessions: [], activeSessionId: null };
  const seen = new Set();
  const sessions = [];
  for (const s of record.sessions) {
    if (!s || !TOOLS.includes(s.tool) || !isSessionId(s.sessionId)) continue;
    if (seen.has(s.sessionId)) continue;
    if (!s.transcriptPath || !exists(s.transcriptPath)) continue;
    seen.add(s.sessionId);
    sessions.push({
      tool: s.tool,
      sessionId: s.sessionId,
      transcriptPath: s.transcriptPath,
      cwd: s.cwd || null,
      name: s.name || null
    });
    if (sessions.length >= MAX_RESTORE) break;
  }
  const activeSessionId = sessions.some((s) => s.sessionId === record.activeSessionId)
    ? record.activeSessionId
    : null;
  return { sessions, activeSessionId };
}

module.exports = {
  STORE_VERSION,
  TOOLS,
  MAX_PROJECTS,
  MAX_RESTORE,
  isSessionId,
  parseReportName,
  parseReport,
  registerTerminal,
  applyReport,
  applyClaim,
  applyMeta,
  applyForeground,
  applyClose,
  normalizeStore,
  projectRecord,
  putRecord,
  planRestore
};
