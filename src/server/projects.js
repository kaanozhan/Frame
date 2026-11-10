/**
 * Server projects and workspaces (server-workspaces spec, T5).
 *
 * A desktop project reaches the server by its remote: `projects.ensure`
 * clones it once into `~/frame/projects/<dir>` (the server's "project
 * home") and registers it in the server's own project registry. Code never
 * travels from the Mac, and uncommitted changes never move (2026-11-09).
 * Workspaces then run Initiative 1's `workspaceManager` on the server: same
 * names, branch prefix, fetched `origin/<base>`, archive rules.
 *
 * Methods: projects.ensure / projects.list,
 *          workspaces.list / create / archive / rename,
 *          tools.check (is the agent CLI installed *here*?).
 * Event:   workspaces.updated { projectPath }
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { IPC } = require('../shared/ipcChannels');
const { normalizeRemoteUrl, projectDirName } = require('../shared/serverRouting');

const CLONE_TIMEOUT_MS = 10 * 60 * 1000;

function projectsRoot() {
  return path.resolve(process.env.FRAME_SERVER_PROJECTS || path.join(os.homedir(), 'frame', 'projects'));
}

function setup({ shim, registerMethods, broadcast }) {
  const projectRegistry = require('../main/projectRegistry');
  const workspaceManager = require('../main/workspaceManager');
  const git = require('../main/gitBranchesManager');
  const aiToolManager = require('../main/aiToolManager');
  projectRegistry.init(null, shim.fakeWindow);
  workspaceManager.init(shim.fakeWindow);

  shim.onSend((channel, payload) => {
    if (channel === IPC.WORKSPACES_UPDATED) broadcast('workspaces.updated', payload || {});
  });

  async function remoteOf(dir) {
    try {
      const { stdout } = await git.execGitArgs(['remote', 'get-url', 'origin'], dir);
      return stdout.trim() || null;
    } catch (_) {
      return null;
    }
  }

  /** `{ dirName: normalizedRemote }` for every clone under the projects root. */
  async function clones() {
    const root = projectsRoot();
    let names = [];
    try { names = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (_) { names = []; }
    const out = {};
    for (const name of names) {
      out[name] = normalizeRemoteUrl(await remoteOf(path.join(root, name))) || `unknown:${name}`;
    }
    return out;
  }

  function register(projectPath) {
    const known = projectRegistry.getProjects().some((p) => p.path === projectPath);
    if (!known) projectRegistry.addProject(projectPath, path.basename(projectPath), fs.existsSync(path.join(projectPath, '.frame')));
  }

  /** The server's project for a known path, or an error naming what to do. */
  function needProject(projectPath) {
    if (!projectPath || !projectRegistry.getProjects().some((p) => p.path === projectPath)) {
      throw new Error('This project is not on the server yet.');
    }
    return projectPath;
  }

  registerMethods({
    'projects.ensure': async ({ originUrl } = {}) => {
      const norm = normalizeRemoteUrl(originUrl);
      if (!norm) throw new Error('This project has no usable git remote — push it to a remote first.');
      const taken = await clones();
      const dir = projectDirName(originUrl, taken);
      if (!dir) throw new Error('Could not choose a folder for this project on the server.');
      const projectPath = path.join(projectsRoot(), dir);
      let cloned = false;
      if (taken[dir] !== norm) {
        fs.mkdirSync(projectsRoot(), { recursive: true });
        try {
          await git.execGitArgs(['clone', '--', originUrl, projectPath], projectsRoot(), { timeout: CLONE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
        } catch (err) {
          throw new Error(`Cloning on the server failed: ${err.error || err.message}`);
        }
        cloned = true;
      }
      register(projectPath);
      return { projectPath, cloned };
    },
    'projects.list': async () => {
      const taken = await clones();
      return Object.entries(taken).map(([dir, remote]) => ({ projectPath: path.join(projectsRoot(), dir), remote }));
    },
    'workspaces.list': async ({ projectPath } = {}) => workspaceManager.list(needProject(projectPath)),
    'workspaces.create': async ({ projectPath, from, base, branch } = {}) => workspaceManager.create(needProject(projectPath), { from, base, branch }),
    'workspaces.archive': async ({ projectPath, id, action, message } = {}) => workspaceManager.archive(needProject(projectPath), id, { action, message }),
    'workspaces.rename': async ({ projectPath, id, name, branch } = {}) => workspaceManager.rename(needProject(projectPath), id, { name, branch }),
    'tools.check': async ({ toolId, tool = null, launchFlags = null, projectPath = null } = {}) => aiToolManager.checkToolAvailable({ toolId, tool, launchFlags, projectPath })
  });

  return { stop() {} };
}

module.exports = { setup, projectsRoot };
