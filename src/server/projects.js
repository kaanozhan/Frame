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
 *          workspaces.list / status / create / archive / rename,
 *          tools.check (is the agent CLI installed *here*?).
 * Event:   workspaces.updated { projectPath }
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { IPC } = require('../shared/ipcChannels');
const { normalizeRemoteUrl, projectDirName, projectDirNameFor, projectKey } = require('../shared/serverRouting');

const CLONE_TIMEOUT_MS = 10 * 60 * 1000;

/** Where uploads land: `<server home>/tmp` (server-onboarding). */
function uploadsDir() {
  const home = process.env.FRAME_SERVER_HOME || path.join(os.homedir(), '.frame-server');
  return path.resolve(home, 'tmp');
}

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

  async function rootOf(dir) {
    try {
      const { stdout } = await git.execGitArgs(['config', '--get', 'frame.root'], dir);
      return stdout.trim() || null;
    } catch (_) {
      return null;
    }
  }

  /**
   * `{ dirName: key }` for every clone under the projects root: the
   * normalized remote, else `root:<sha>` from `frame.root` (a project sent
   * without a remote), else `unknown:<dir>`. Partial folders are skipped.
   */
  async function clones() {
    const root = projectsRoot();
    let names = [];
    try { names = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name); } catch (_) { names = []; }
    const out = {};
    for (const name of names) {
      const dir = path.join(root, name);
      out[name] = projectKey({ originUrl: await remoteOf(dir), root: await rootOf(dir) }) || `unknown:${name}`;
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
    /**
     * A project sent from the desktop as a git bundle (server-onboarding):
     * cloned into a partial folder, `origin` pointed at the project's remote
     * (or removed), `frame.root` recorded, then renamed into place. The
     * bundle and any partial folder are removed whatever happens.
     */
    'projects.receive': async ({ bundlePath, originUrl = null, root = null, name = '' } = {}) => {
      // A bare name is an upload in `<server home>/tmp` (the desktop uploads
      // relative to the SSH login folder); an absolute path must point there.
      const uploads = uploadsDir();
      const bundle = path.resolve(uploads, String(bundlePath || ''));
      if (path.dirname(bundle) !== uploads || !/^receive-[A-Za-z0-9._-]+\.bundle$/.test(path.basename(bundle))) {
        throw new Error(`The bundle must be an upload in ${uploads}.`);
      }
      let partial = null;
      try {
        const key = projectKey({ originUrl, root });
        if (!key) throw new Error('This project has neither a usable remote nor a root commit.');
        const taken = await clones();
        const dir = projectDirNameFor({ originUrl, root, name }, taken);
        if (!dir) throw new Error('Could not choose a folder for this project on the server.');
        const projectPath = path.join(projectsRoot(), dir);
        if (taken[dir] === key) {
          register(projectPath);
          return { projectPath, cloned: false };
        }
        fs.mkdirSync(projectsRoot(), { recursive: true });
        partial = path.join(projectsRoot(), `.${dir}.partial-${process.pid}`);
        fs.rmSync(partial, { recursive: true, force: true });
        try {
          await git.execGitArgs(['clone', '-q', '--', bundle, partial], projectsRoot(), { timeout: CLONE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
        } catch (err) {
          throw new Error(`The project bundle could not be cloned: ${err.error || err.message}`);
        }
        if (originUrl && normalizeRemoteUrl(originUrl)) await git.execGitArgs(['remote', 'set-url', 'origin', originUrl], partial);
        else await git.execGitArgs(['remote', 'remove', 'origin'], partial);
        if (root) await git.execGitArgs(['config', 'frame.root', root], partial);
        fs.renameSync(partial, projectPath);
        partial = null;
        register(projectPath);
        return { projectPath, cloned: true };
      } finally {
        fs.rmSync(bundle, { force: true });
        if (partial) fs.rmSync(partial, { recursive: true, force: true });
      }
    },
    'projects.list': async () => {
      const taken = await clones();
      const out = [];
      for (const [dir, key] of Object.entries(taken)) {
        const projectPath = path.join(projectsRoot(), dir);
        out.push({ projectPath, remote: key.startsWith('root:') || key.startsWith('unknown:') ? null : key, root: await rootOf(projectPath) });
      }
      return out;
    },
    'workspaces.list': async ({ projectPath } = {}) => workspaceManager.list(needProject(projectPath)),
    'workspaces.create': async ({ projectPath, from, base, branch } = {}) => workspaceManager.create(needProject(projectPath), { from, base, branch }),
    'workspaces.status': async ({ projectPath, id } = {}) => workspaceManager.status(needProject(projectPath), id),
    'workspaces.archive': async ({ projectPath, id, action, message, rescue } = {}) => workspaceManager.archive(needProject(projectPath), id, { action, message, rescue: rescue === true }),
    'workspaces.rename': async ({ projectPath, id, name, branch } = {}) => workspaceManager.rename(needProject(projectPath), id, { name, branch }),
    'tools.check': async ({ toolId, tool = null, launchFlags = null, projectPath = null } = {}) => aiToolManager.checkToolAvailable({ toolId, tool, launchFlags, projectPath })
  });

  return { stop() {} };
}

module.exports = { setup, projectsRoot };
