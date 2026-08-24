/**
 * Claude Sessions Manager Module
 *
 * Lists Claude Code session history for a project by reading the session
 * transcripts in ~/.claude/projects/<encoded-path>/<sessionId>.jsonl.
 *
 * It used to read `sessions-index.json` from the same directory. Claude Code
 * no longer maintains that file: on this machine it existed in 2 of 95
 * project directories, was last written seven months ago, and every
 * transcript it pointed at had since been deleted — so the panel listed
 * three dead sessions and none of the fourteen real ones
 * (sessions-from-transcripts spec). The transcripts are the source of truth.
 */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const readline = require('readline');
const { IPC } = require('../shared/ipcChannels');

let mainWindow = null;

/**
 * Where Claude Code keeps its data. `CLAUDE_CONFIG_DIR` is how Claude Code
 * itself allows relocating it, so honouring it keeps Frame correct for users
 * who set it — and lets the tests point this module at a fixture tree.
 * Read per call rather than frozen at require time.
 */
function projectsDir() {
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(claudeDir, 'projects');
}

/** Longest first-prompt excerpt kept for a session title. */
const PROMPT_EXCERPT = 200;

/**
 * Per-file scan cache. Transcripts are append-only, so an entry remembers
 * how many bytes were already folded into `session` and a later scan reads
 * only what was appended since. Keyed by absolute file path.
 * { offset, size, mtimeMs, session }
 */
const scanCache = new Map();

/**
 * Initialize sessions manager
 */
function init(window) {
  mainWindow = window;
}

/**
 * Encode project path to Claude Code's directory format: every character
 * that is not [a-zA-Z0-9] becomes '-', matching Claude Code itself — dots,
 * underscores and Windows separators/drive colons included
 * (e.g. /Users/kaan/my.app → -Users-kaan-my-app). The old /-only variant
 * silently produced an empty session list for any path containing a dot.
 */
function encodeProjectPath(projectPath) {
  return projectPath.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Text of a user record, when it is the user's own words.
 *
 * Transcripts carry more than typed prompts: tool results, attachments,
 * slash-command wrappers, the local-command caveat, and injected context.
 * None of those are a title, so they never become one.
 */
function userPromptText(record) {
  if (record.isMeta) return null;

  const content = record.message && record.message.content;
  let text = null;

  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    // Any tool_result part means this record is a tool's output, not typing.
    if (content.some(part => part && part.type === 'tool_result')) return null;
    const textPart = content.find(part => part && part.type === 'text');
    text = textPart ? textPart.text : null;
  }

  if (!text) return null;
  text = text.trim();
  if (!text) return null;

  // <command-name>, <local-command-caveat>, <system-reminder>… — harness
  // scaffolding, not something the user would recognise as their session.
  if (text.startsWith('<')) return null;
  if (text.startsWith('Caveat:')) return null;

  return text.slice(0, PROMPT_EXCERPT);
}

/** Fold one transcript record into the session being built. */
function applyRecord(session, record) {
  if (record.type === 'user' || record.type === 'assistant') {
    session.messageCount++;
    if (record.timestamp) {
      if (!session.created) session.created = record.timestamp;
      session.lastActivity = record.timestamp;
    }
    if (record.gitBranch) session.gitBranch = record.gitBranch;
    if (record.isSidechain) session.isSidechain = true;
    if (record.type === 'user' && !session.firstPrompt) {
      const text = userPromptText(record);
      if (text) session.firstPrompt = text;
    }
    return;
  }

  // Claude Code writes the session's own title as its own record; later
  // titles supersede earlier ones.
  if (record.type === 'ai-title' && record.aiTitle) {
    session.summary = record.aiTitle;
  } else if (record.type === 'summary' && record.summary) {
    session.summary = record.summary;
  }
}

function emptySession(sessionId) {
  return {
    sessionId,
    summary: null,
    firstPrompt: null,
    messageCount: 0,
    created: null,
    lastActivity: null,
    gitBranch: null,
    isSidechain: false
  };
}

/**
 * Read one transcript into a session record, reusing whatever a previous
 * scan already folded in. Streaming (rather than readFile) keeps a 24MB
 * transcript from landing in memory at once and yields to the event loop
 * between chunks, so the main process stays responsive.
 */
async function scanTranscript(file, stat) {
  const sessionId = path.basename(file, '.jsonl');
  const cached = scanCache.get(file);

  // Same file, nothing appended → nothing to do.
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
    return { ...cached.session };
  }

  // Append-only: continue from where the last scan stopped. A file that
  // shrank was rotated or replaced, so start over.
  const canResume = cached && stat.size > cached.offset;
  const session = canResume ? { ...cached.session } : emptySession(sessionId);
  const start = canResume ? cached.offset : 0;

  const stream = fs.createReadStream(file, { start, encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch (_) {
      continue; // a half-written trailing line while a session is live
    }
    applyRecord(session, record);
  }

  scanCache.set(file, {
    offset: stat.size,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    session: { ...session }
  });

  return session;
}

/**
 * Get sessions for a given project path.
 * Returns { sessions, reason } — reason distinguishes "zero sessions" from
 * "there is nothing to read here", so the panel can say why it's empty.
 */
async function getSessionsForProject(projectPath) {
  if (!projectPath) return { sessions: [], reason: 'no-project' };
  const root = projectsDir();
  if (!fs.existsSync(root)) return { sessions: [], reason: 'no-claude-dir' };

  const projectDir = path.join(root, encodeProjectPath(projectPath));
  if (!fs.existsSync(projectDir)) return { sessions: [], reason: 'no-project-sessions' };

  let files;
  try {
    files = (await fsp.readdir(projectDir))
      .filter(name => name.endsWith('.jsonl'))
      .map(name => path.join(projectDir, name));
  } catch (err) {
    console.error('Error reading Claude project directory:', err);
    return { sessions: [], reason: 'read-error' };
  }

  if (files.length === 0) return { sessions: [], reason: 'no-project-sessions' };

  const sessions = [];
  let failures = 0;

  for (const file of files) {
    try {
      const stat = await fsp.stat(file);
      const session = await scanTranscript(file, stat);
      // A transcript with no user or assistant record is a session that never
      // happened (opened and abandoned). Listing it offers a resume that
      // resumes nothing.
      if (session.messageCount === 0) continue;
      sessions.push({
        sessionId: session.sessionId,
        summary: session.summary,
        firstPrompt: session.firstPrompt,
        messageCount: session.messageCount,
        // Last record's timestamp is the true end of the conversation; mtime
        // is the fallback for a transcript whose records carry none.
        created: session.created || stat.birthtime.toISOString(),
        modified: session.lastActivity || stat.mtime.toISOString(),
        gitBranch: session.gitBranch,
        isSidechain: session.isSidechain,
        projectPath
      });
    } catch (err) {
      failures++;
      console.error('Error reading Claude transcript:', file, err.message);
    }
  }

  // Every file failed → the panel should say it couldn't read, not that the
  // project has no history.
  if (sessions.length === 0) {
    return { sessions: [], reason: failures > 0 ? 'read-error' : 'no-project-sessions' };
  }

  sessions.sort((a, b) => new Date(b.modified) - new Date(a.modified));
  return { sessions, reason: null };
}

/**
 * Setup IPC handlers
 */
function setupIPC(ipcMain) {
  ipcMain.handle(IPC.LOAD_CLAUDE_SESSIONS, async (event, projectPath) => {
    return getSessionsForProject(projectPath);
  });

  ipcMain.handle(IPC.REFRESH_CLAUDE_SESSIONS, async (event, projectPath) => {
    return getSessionsForProject(projectPath);
  });
}

module.exports = {
  init,
  setupIPC,
  getSessionsForProject,
  // exported for tests
  _resetCache: () => scanCache.clear()
};
