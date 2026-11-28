/**
 * Frame Cloud — the Connected mark beside the project switcher.
 *
 * A small cloud inside #sidebar-current-project-wrap, shown only while
 * signed in with a role that can work and the open folder's own projectId is
 * carried by a listed cloud project. A miss is silent: no mark, no hint. It reads the pushed projects
 * state and makes no request of its own.
 *
 * `openFolder()` is the same answer for the palette's project commands.
 */

const state = require('./state');

let hub = null;
let markEl = null;
let wrapEl = null;

function init(cloudHub) {
  hub = cloudHub;
  wrapEl = document.getElementById('sidebar-current-project-wrap');
  if (!wrapEl) {
    console.error('Frame Cloud: #sidebar-current-project-wrap not found — no Connected mark');
    return;
  }
  markEl = document.getElementById('cloud-project-mark');
  if (!markEl) {
    console.error('Frame Cloud: #cloud-project-mark not found — no Connected mark');
    return;
  }

  hub.onProjects(update);
  hub.onSession(update);
  state.onProjectChange(update);
  update();
}

/**
 * The open folder as Frame Cloud sees it:
 * `{ signedIn, path, folder }` — folder is the pushed row, or null.
 */
function openFolder() {
  const session = hub ? hub.session() : null;
  const projects = hub ? hub.projects() : null;
  const path = state.getProjectPath();
  const signedIn = Boolean(session && session.state === 'signedIn');
  const listed = signedIn && projects && Array.isArray(projects.folders) && projects.lastUpdated;
  const folder = listed && path ? projects.folders.find((f) => f.path === path) || null : null;
  return { signedIn, path, folder, projects };
}

function update() {
  if (!markEl) return;
  const { folder, projects } = openFolder();
  // A viewer gets no mark (frame-cloud-roles D2); a role change redraws on the next push.
  const canWork = Boolean(projects && projects.permissions && projects.permissions.work);
  const connected = Boolean(folder && folder.connected && folder.project && canWork);
  markEl.hidden = !connected;
  wrapEl.classList.toggle('has-cloud-mark', connected);
  if (!connected) return;
  const ws = (projects && projects.cloudWorkspace) || {};
  const label = `Connected to ${folder.project.name || folder.project.slug} in ${ws.name || ws.slug || 'Frame Cloud'}`;
  markEl.title = label;
  markEl.setAttribute('aria-label', label);
}

module.exports = { init, openFolder };
