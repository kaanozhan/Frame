/**
 * Server specs — the spec flow in a server workspace (server-specs spec).
 *
 * Specs live in a workspace's worktree and ride its branch (spec-in-workspace).
 * For a server workspace that worktree is here, so Frame Server answers the
 * desktop's spec calls with specManager's own per-checkout readers:
 *
 *   specs.list   { projectPath, root }              listSpecsIn, after syncing each
 *                                                    tasks.md into the clone's tasks.json
 *   specs.get    { projectPath, root, slug }        getSpecIn
 *   specs.report { projectPath, root, slug, kind }  readSpecReportIn
 *   specs.status { projectPath, root, slug, partial } updateSpecStatusIn (phase, implement_mode, flow_mode)
 *   specs.watch  { projectPath, roots }             watch each root's .frame/specs (replaces the set)
 *   specs.unwatch                                   stop watching
 *   specs.stage  { projectPath, root, slug, command, aiTool, description }
 *                provision Frame's tooling, then stage the command's prompt in root
 *   specs.create { projectPath, root, slug, files }  a new spec folder holding only
 *                spec.md and status.json, as Start Work writes it (frame-cloud-start-on-server D10)
 *
 * specs.stage does what the desktop does for a local workspace, here: the
 * clone gets Frame's gitignored tooling from this package (hook scripts in
 * .frame/bin, the staged command templates, the spec index), the worktree gets
 * a copy (workspaceTooling.provision), and the prompt is built from this
 * package's templates with {tasks_path} naming the clone's tasks.json. The
 * desktop only sends the instruction to a lane in that workspace.
 *
 * Event: specs.changed { root } — a debounced change under a watched root's
 * .frame/specs (an agent wrote status.json, a plan or a report). The desktop
 * re-lists that root; it never polls. Watching stops when the last desktop
 * disconnects (idle) and starts again when one asks.
 *
 * `projectPath` is the server clone (task state lives in its tasks.json, the
 * server's counterpart of the main checkout); `root` is the clone itself or
 * one of its active workspaces. Anything else is refused: these methods read
 * and write only inside the server's own projects and workspaces.
 */

const fs = require('fs');
const path = require('path');

const COMMANDS = ['spec.new', 'spec.plan', 'spec.tasks', 'spec.implement', 'spec.auto'];
const LOCAL_MODE = 'This project keeps Frame files out of git (local mode), so a spec on the server would be lost when the workspace is archived — write it in a local workspace.';
const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
// What the desktop may change on a server spec: what the spec flow needs.
const STATUS_KEYS = ['phase', 'implement_mode', 'flow_mode'];
// What Start Work may write into a new spec folder, and nothing else.
const CREATE_FILES = ['spec.md', 'status.json'];
const CHANGE_DEBOUNCE_MS = 300;

function setup({ registerMethods, broadcast }) {
  const specManager = require('../main/specManager');
  const fsSafe = require('../main/fsSafe');
  const frameStore = require('../main/frameStore');
  const { provisionTooling } = require('./tooling');
  const gitSharing = require('../main/gitSharing');
  const watchers = new Map(); // root → { watcher, timer }
  const projectRegistry = require('../main/projectRegistry');
  const workspaceRegistry = require('../shared/workspaceRegistry');

  /** The checkout a call names, once it is known to belong to a server project. */
  function checkout(projectPath, root) {
    if (typeof projectPath !== 'string' || !projectPath || !projectRegistry.getProjects().some((p) => p.path === projectPath)) {
      throw new Error('This project is not on the server yet.');
    }
    if (typeof root !== 'string' || !root) throw new Error('Missing root.');
    const want = path.resolve(root);
    if (want === path.resolve(projectPath)) return want;
    let rows = [];
    try { rows = workspaceRegistry.activeOf(projectRegistry.getWorkspaceRecords(projectPath) || []); } catch (_) { rows = []; }
    if (rows.some((r) => r && r.path && path.resolve(r.path) === want)) return want;
    throw new Error('That folder is not a workspace of this project on the server.');
  }

  function needSlug(slug) {
    if (typeof slug !== 'string' || !SLUG_RE.test(slug)) throw new Error('Not a spec name.');
    return slug;
  }

  function unwatch(root) {
    const entry = watchers.get(root);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    try { entry.watcher.close(); } catch (_) { /* already closed */ }
    watchers.delete(root);
  }

  function unwatchAll() {
    for (const root of Array.from(watchers.keys())) unwatch(root);
  }

  function watch(root) {
    if (watchers.has(root)) return;
    const dir = frameStore.specsRoot(root);
    try {
      fs.mkdirSync(dir, { recursive: true });
      const entry = { watcher: null, timer: null };
      entry.watcher = fsSafe.safeWatch(dir, { recursive: true }, () => {
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          entry.timer = null;
          broadcast('specs.changed', { root });
        }, CHANGE_DEBOUNCE_MS);
      }, () => { watchers.delete(root); });
      watchers.set(root, entry);
    } catch (err) {
      console.warn(`[frame-server] could not watch specs in ${root}: ${err.message}`);
    }
  }

  /** Frame's gitignored tooling, in the clone from this package and then in the worktree (tooling.js). */
  const provision = (projectPath, root) => provisionTooling(projectPath, root);

  registerMethods({
    'specs.list': async ({ projectPath, root } = {}) => {
      const dir = checkout(projectPath, root);
      specManager.syncSpecTasksIn(dir, projectPath);
      return specManager.listSpecsIn(dir, projectPath);
    },
    'specs.get': async ({ projectPath, root, slug } = {}) => specManager.getSpecIn(checkout(projectPath, root), needSlug(slug)),
    'specs.report': async ({ projectPath, root, slug, kind } = {}) => specManager.readSpecReportIn(checkout(projectPath, root), needSlug(slug), kind),
    'specs.status': async ({ projectPath, root, slug, partial } = {}) => {
      const dir = checkout(projectPath, root);
      const allowed = {};
      for (const key of STATUS_KEYS) {
        if (partial && Object.prototype.hasOwnProperty.call(partial, key)) allowed[key] = partial[key];
      }
      if (!Object.keys(allowed).length) return { error: 'Only the phase, implement mode and flow mode of a server spec can be changed from the desktop.' };
      return specManager.updateSpecStatusIn(dir, needSlug(slug), allowed);
    },
    'specs.watch': async ({ projectPath, roots } = {}) => {
      const wanted = (Array.isArray(roots) ? roots : []).map((r) => checkout(projectPath, r));
      for (const root of Array.from(watchers.keys())) if (!wanted.includes(root)) unwatch(root);
      for (const root of wanted) watch(root);
      return { watching: Array.from(watchers.keys()) };
    },
    'specs.unwatch': async () => { unwatchAll(); return null; },
    // Start Work's spec part, begun on this server: a brand-new folder only,
    // never an overwrite, and only the two files Shape produced.
    'specs.create': async ({ projectPath, root, slug, files } = {}) => {
      const dir = checkout(projectPath, root);
      needSlug(slug);
      let mode = 'repo';
      try { mode = gitSharing.getMode(projectPath); } catch (_) { mode = 'repo'; }
      if (mode === 'local') throw new Error(LOCAL_MODE);
      const names = files && typeof files === 'object' && !Array.isArray(files) ? Object.keys(files) : [];
      if (!names.length || names.some((n) => !CREATE_FILES.includes(n) || typeof files[n] !== 'string')) {
        throw new Error('A new spec takes only spec.md and status.json, as text.');
      }
      const folder = frameStore.resolveSpecDir(dir, slug);
      if (fs.existsSync(folder)) throw new Error(`.frame/specs/${slug} already exists on this branch`);
      fs.mkdirSync(folder, { recursive: true });
      const created = CREATE_FILES.filter((n) => names.includes(n));
      for (const name of created) fsSafe.writeFileAtomic(path.join(folder, name), files[name]);
      return { created };
    },
    'specs.stage': async ({ projectPath, root, slug = null, command, aiTool = 'claude-code', description = '' } = {}) => {
      const dir = checkout(projectPath, root);
      if (!COMMANDS.includes(command)) return { success: false, error: `Unknown spec command: ${command}` };
      if (slug !== null || command !== 'spec.new') needSlug(slug);
      let mode = 'repo';
      try { mode = gitSharing.getMode(projectPath); } catch (_) { mode = 'repo'; }
      if (mode === 'local') return { success: false, error: LOCAL_MODE };
      await provision(projectPath, dir);
      return specManager.buildSpecCommandFileIn(dir, projectPath, slug, command, aiTool, description);
    }
  });

  return {
    stop: unwatchAll,
    // No desktop is connected: nobody receives specs.changed.
    idle: unwatchAll
  };
}

module.exports = { setup };
