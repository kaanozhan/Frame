/**
 * Claude Sessions Manager Module
 * Reads Claude Code session history from ~/.claude/projects/
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { IPC } = require('../shared/ipcChannels');

let mainWindow = null;

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

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
 * Get sessions for a given project path.
 * Returns { sessions, reason } — reason distinguishes "zero sessions" from
 * "there is nothing to read here", so the panel can say why it's empty.
 */
function getSessionsForProject(projectPath) {
  if (!projectPath) return { sessions: [], reason: 'no-project' };
  if (!fs.existsSync(PROJECTS_DIR)) return { sessions: [], reason: 'no-claude-dir' };

  const projectDir = path.join(PROJECTS_DIR, encodeProjectPath(projectPath));
  if (!fs.existsSync(projectDir)) return { sessions: [], reason: 'no-project-sessions' };

  const sessionsFile = path.join(projectDir, 'sessions-index.json');

  try {
    if (!fs.existsSync(sessionsFile)) {
      return { sessions: [], reason: 'no-project-sessions' };
    }

    const data = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));

    // Support both { entries: [...] } and plain array formats
    const entries = Array.isArray(data) ? data : (data.entries || []);
    if (!Array.isArray(entries)) return { sessions: [], reason: null };

    // Sort by modified date descending (most recent first)
    const sessions = entries.sort((a, b) => {
      const dateA = new Date(a.modified || a.created || 0);
      const dateB = new Date(b.modified || b.created || 0);
      return dateB - dateA;
    });
    return { sessions, reason: null };
  } catch (err) {
    console.error('Error reading sessions file:', err);
    return { sessions: [], reason: 'read-error' };
  }
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
  getSessionsForProject
};
