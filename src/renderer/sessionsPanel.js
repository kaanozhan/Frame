/**
 * Sessions Panel
 *
 * The project's Claude Code and Codex sessions, each one click from being
 * resumed — one tab per CLI.
 * Reached from the sidebar's Context → Sessions row, the palette's "Go to
 * Sessions" and Home's Last Sessions card; hosted in the center by
 * `multiTerminalUI` the way the Claude panel used to be (`PANEL_REGISTRY`).
 *
 * This used to be the Sessions tab of the Claude panel, beside Plugins. The
 * two had nothing in common but the tool: a session list is *context* — what
 * the project knows about its own history, like Specs and Tasks — while
 * plugins are a Claude Code setting. So Sessions became a Context row of its
 * own and Plugins moved behind the sidebar rail's foot button for now
 * (feedbackPanel.js). The Claude list comes from `LOAD_CLAUDE_SESSIONS`
 * (sessions-from-transcripts spec), the Codex list from
 * `LOAD_CODEX_SESSIONS` (codexSessionsManager.js); both arrive in the same
 * `{ sessions, reason }` shape.
 *
 * Host contract, the same as every center-hosted panel: `show()` adds
 * `.visible` and loads, `hide()` drops `.visible` — which is what the host's
 * MutationObserver watches to route back to the terminals view.
 */

const fs = require('fs');
const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');
const { escapeHtml } = require('./htmlUtils');

// Per CLI: the IPC that lists its sessions and how its empty states read.
const TOOLS = {
  claude: {
    channel: IPC.LOAD_CLAUDE_SESSIONS,
    footer: 'Claude Code sessions will appear here',
    reasons: {
      'no-claude-dir': 'Claude Code has no session history on this machine yet',
      'no-project-sessions': 'No Claude Code sessions recorded for this project yet',
      'read-error': 'Could not read Claude session data — check ~/.claude/projects'
    }
  },
  codex: {
    channel: IPC.LOAD_CODEX_SESSIONS,
    footer: 'Codex sessions will appear here',
    reasons: {
      'no-codex-dir': 'Codex has no session history on this machine yet',
      'no-project-sessions': 'No Codex sessions recorded for this project yet',
      'read-error': 'Could not read Codex session data — check ~/.codex/sessions'
    }
  }
};
const TAB_KEY = 'frame-sessions-tab';

let isVisible = false;
let activeTool = 'claude';
// { claude: { sessions, reason }, codex: { sessions, reason } }
let lists = { claude: { sessions: [], reason: null }, codex: { sessions: [], reason: null } };

let panelElement = null;
let contentElement = null;

function init() {
  panelElement = document.getElementById('sessions-panel');
  contentElement = document.getElementById('sessions-content');

  if (!panelElement) {
    console.error('sessionsPanel: #sessions-panel not found — Sessions will not open');
    return;
  }

  const refreshBtn = document.getElementById('sessions-refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', refreshSessions);

  // An open list follows the selected workspace (workspaces spec).
  state.onWorkspaceChange(() => { if (isVisible) loadSessions(); });

  try {
    const saved = localStorage.getItem(TAB_KEY);
    if (TOOLS[saved]) activeTool = saved;
  } catch (_) { /* non-fatal */ }

  document.querySelectorAll('#sessions-tabs .sessions-tab').forEach((tab) => {
    tab.addEventListener('click', () => selectTool(tab.dataset.tool));
  });
  paintTabs();
}

function selectTool(tool) {
  if (!TOOLS[tool] || tool === activeTool) return;
  activeTool = tool;
  try { localStorage.setItem(TAB_KEY, tool); } catch (_) { /* non-fatal */ }
  paintTabs();
  renderSessions();
}

/** Active state and per-tab counts. */
function paintTabs() {
  document.querySelectorAll('#sessions-tabs .sessions-tab').forEach((tab) => {
    const on = tab.dataset.tool === activeTool;
    tab.classList.toggle('active', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
    const n = lists[tab.dataset.tool].sessions.length;
    tab.classList.toggle('is-empty', n === 0);
    const countEl = tab.querySelector('[data-count-for]');
    if (countEl) countEl.textContent = n > 0 ? String(n) : '';
  });
}

/** Show the panel and (re)load the list — the host calls this on mount. */
function show() {
  if (!panelElement) return;
  panelElement.classList.add('visible');
  isVisible = true;
  loadSessions();
}

function hide() {
  if (!panelElement) return;
  panelElement.classList.remove('visible');
  isVisible = false;
}

/**
 * Load both lists — the tab counts need both, whichever tab is showing.
 */
async function loadSessions() {
  // Sessions belong to the folder they ran in: the selected workspace's
  // worktree, or the project itself on main (workspaces spec).
  const projectPath = state.getWorkspaceRoot();

  // A server workspace's sessions are recorded on the server, not in this
  // machine's transcripts: say so rather than list the wrong ones
  // (server-hardening T10).
  const ws = state.getWorkspace();
  const rec = ws && require('./workspaceSection').getWorkspaces().find((w) => w.id === ws.id);
  if (rec && rec.location === 'server') {
    lists = { claude: { sessions: [], reason: null }, codex: { sessions: [], reason: null } };
    paintTabs();
    renderSessionsEmpty('Sessions are not listed for server workspaces yet — they are recorded on the server.');
    return;
  }

  if (!projectPath) {
    lists = { claude: { sessions: [], reason: null }, codex: { sessions: [], reason: null } };
    paintTabs();
    renderSessionsEmpty('No project selected');
    return;
  }

  const load = async (tool) => {
    try {
      const result = await ipcRenderer.invoke(TOOLS[tool].channel, projectPath);
      // Main returns { sessions, reason }; tolerate a plain array too
      if (Array.isArray(result)) return { sessions: result, reason: null };
      return { sessions: result.sessions || [], reason: result.reason || null };
    } catch (err) {
      console.error(`Error loading ${tool} sessions:`, err);
      return { sessions: [], reason: 'load-failed' };
    }
  };

  const [claude, codex] = await Promise.all([load('claude'), load('codex')]);
  lists = { claude, codex };
  paintTabs();
  renderSessions();
}

/**
 * Refresh sessions with spinner animation
 */
async function refreshSessions() {
  const refreshBtn = document.getElementById('sessions-refresh-btn');

  try {
    if (refreshBtn) {
      refreshBtn.classList.add('spinning');
      refreshBtn.disabled = true;
    }
    await loadSessions();
  } finally {
    if (refreshBtn) {
      refreshBtn.classList.remove('spinning');
      refreshBtn.disabled = false;
    }
  }
}

/**
 * Render sessions list
 */
function renderSessions() {
  if (!contentElement) return;
  const { sessions, reason } = lists[activeTool];

  // Update count
  const countEl = document.getElementById('sessions-count');
  if (countEl) {
    countEl.textContent = `${sessions.length} session${sessions.length !== 1 ? 's' : ''}`;
  }

  if (sessions.length === 0) {
    // Say WHY it's empty — an unexplained empty panel reads as broken
    const message = reason === 'load-failed'
      ? 'Failed to load sessions'
      : (TOOLS[activeTool].reasons[reason] || 'No sessions found for this project');
    renderSessionsEmpty(message);
    return;
  }

  contentElement.innerHTML = sessions.map(session => renderSessionItem(session)).join('');

  // Add click listeners
  contentElement.querySelectorAll('.session-item').forEach(el => {
    el.addEventListener('click', () => {
      const session = sessions.find(s => s.sessionId === el.dataset.sessionId);
      if (session) resumeSession(activeTool, session);
    });
  });
}

/**
 * Render a single session item
 */
function renderSessionItem(session) {
  const title = escapeHtml(session.summary || session.firstPrompt || 'Untitled session');
  const timeStr = formatRelativeTime(session.modified || session.created);
  const branch = session.gitBranch ? `<span class="session-branch">${escapeHtml(session.gitBranch)}</span>` : '';
  const msgCount = session.messageCount || 0;
  const sidechainClass = session.isSidechain ? ' sidechain' : '';

  return `
    <div class="session-item${sidechainClass}" data-session-id="${escapeHtml(session.sessionId)}">
      <div class="session-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <div class="session-content">
        <div class="session-title">${title}</div>
        <div class="session-meta">
          <span>${timeStr}</span>
          <span>${msgCount} msg${msgCount !== 1 ? 's' : ''}</span>
          ${branch}
        </div>
      </div>
    </div>
  `;
}

/**
 * Render sessions empty state
 */
function renderSessionsEmpty(message) {
  if (!contentElement) return;

  const countEl = document.getElementById('sessions-count');
  if (countEl) countEl.textContent = '';

  contentElement.innerHTML = `
    <div class="sessions-empty">
      <div class="plugins-empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <p>${escapeHtml(message)}</p>
      <span>${escapeHtml(TOOLS[activeTool].footer)}</span>
    </div>
  `;
}

/**
 * Resume a session in a terminal of its own.
 *
 * Not window.terminalSendCommand: that types into whatever terminal has
 * focus, and when that terminal is already running Claude the command lands
 * in Claude's prompt as a message instead of starting anything
 * (sessions-from-transcripts spec). `hide()` drops `.visible`, which is how
 * the host routes back to the terminals view — so the new lane is on screen.
 */
function resumeSession(tool, session) {
  hide();
  // No session id, no transcript, nothing about the work — only that the
  // resume path was used at all, which is what says the feature earns its
  // place.
  ipcRenderer.send(IPC.ANALYTICS_TRACK, 'session_resumed');
  const agentDispatch = require('./agentDispatch');
  const projectPath = state.getProjectPath();
  if (!projectPath) return;
  const root = state.getWorkspaceRoot() || projectPath;
  if (tool === 'codex') {
    // A Codex session started in a folder inside the listed root resumes in
    // that folder — unless the folder is gone since.
    const cwd = session.cwd && session.cwd !== root && fs.existsSync(session.cwd)
      ? session.cwd
      : root;
    agentDispatch.resumeAgentSession('codex', session.sessionId, { projectPath, cwd, focus: true });
    return;
  }
  agentDispatch.resumeAgentSession('claude', session.sessionId, { projectPath, cwd: root, focus: true });
}

/**
 * Format a date string to relative time
 */
function formatRelativeTime(dateString) {
  if (!dateString) return '';

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour !== 1 ? 's' : ''} ago`;
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return `${diffDay} days ago`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)} week${Math.floor(diffDay / 7) !== 1 ? 's' : ''} ago`;

  return date.toLocaleDateString();
}

module.exports = {
  init,
  show,
  hide,
  isVisible: () => isVisible
};
