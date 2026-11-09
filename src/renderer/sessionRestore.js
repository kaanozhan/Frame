/**
 * Session restore — the renderer half (restore-ai-sessions-on-relaunch).
 *
 * The first time a project opens after a launch, reopen one terminal per AI
 * session that was running there and resume it. Main decides what that is
 * (`SESSION_RESTORE_TAKE`: saved sessions whose transcript still exists);
 * this module opens the terminals, tells main which terminal now carries
 * which session, and puts the user back on the lane they left focused.
 *
 * "Once per run" lives here on purpose: a renderer reload destroys every
 * PTY, so restoring again after one is exactly what a relaunch would do.
 */

const fs = require('fs');
const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

const restoredThisRun = new Set();

/**
 * Restore a project's sessions if this is its first open in this run.
 * Safe to call on every project switch.
 *
 * @param {string|null} projectPath
 * @param {object} host - the MultiTerminalUI instance
 */
async function maybeRestore(projectPath, host) {
  if (!projectPath || restoredThisRun.has(projectPath)) return;
  restoredThisRun.add(projectPath);

  let plan = null;
  try {
    plan = await ipcRenderer.invoke(IPC.SESSION_RESTORE_TAKE, projectPath);
  } catch (err) {
    console.warn('sessionRestore: could not read the restore plan', err);
    return;
  }
  if (!plan || !Array.isArray(plan.sessions) || plan.sessions.length === 0) return;

  const agentDispatch = require('./agentDispatch');
  // Sessions return to the workspace they ran in when it is still open;
  // otherwise to main (workspaces spec).
  let liveWorkspaces = new Set();
  try {
    const listed = await ipcRenderer.invoke(IPC.WORKSPACES_LIST, projectPath);
    liveWorkspaces = new Set(((listed && listed.workspaces) || []).filter((w) => !w.missing).map((w) => w.id));
  } catch (_) { /* no workspaces: everything resumes in main */ }
  let focusId = null;
  try {
    // One at a time: terminal ids and the per-project cap are assigned in
    // creation order, and a full project stops the loop rather than failing
    // every remaining session with its own toast.
    for (const s of plan.sessions) {
      // `claude --resume` looks the transcript up by the directory it runs
      // in, so the terminal starts where the session did.
      const cwd = s.cwd && safeIsDir(s.cwd) ? s.cwd : projectPath;
      const fromWorkspace = s.workspaceId && s.workspaceId !== 'main';
      const workspaceId = fromWorkspace && liveWorkspaces.has(s.workspaceId) ? s.workspaceId : 'main';
      // A session whose workspace is gone falls back to main, at the project.
      const resumeCwd = fromWorkspace && workspaceId === 'main' ? projectPath : cwd;
      const id = await agentDispatch.resumeAgentSession(s.tool, s.sessionId, { projectPath, cwd: resumeCwd, name: s.name, workspaceId });
      if (!id) break;
      ipcRenderer.send(IPC.SESSION_RESTORE_CLAIM, {
        terminalId: id,
        tool: s.tool,
        sessionId: s.sessionId,
        transcriptPath: s.transcriptPath,
        cwd: resumeCwd,
        name: s.name
      });
      if (!focusId || s.sessionId === plan.activeSessionId) focusId = id;
    }
  } finally {
    ipcRenderer.send(IPC.SESSION_RESTORE_DONE, projectPath);
  }

  // Land on the lane that was focused — unless the user has moved to
  // another project while the terminals were opening.
  const focusTerm = focusId && host ? host.getManager().getTerminal(focusId) : null;
  if (focusTerm && host.getManager().getCurrentProject() === projectPath
      && (focusTerm.state.workspaceId || 'main') === host.getManager().getCurrentWorkspaceId()) {
    host.enterLane(focusId);
  }
}

function safeIsDir(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch (_) {
    return false;
  }
}

module.exports = { maybeRestore };
