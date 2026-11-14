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
 *   specs.status { projectPath, root, slug, partial } updateSpecStatusIn (phase, implement_mode)
 *
 * `projectPath` is the server clone (task state lives in its tasks.json, the
 * server's counterpart of the main checkout); `root` is the clone itself or
 * one of its active workspaces. Anything else is refused: these methods read
 * and write only inside the server's own projects and workspaces.
 */

const path = require('path');

const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
// What the desktop may change on a server spec: what the spec flow needs.
const STATUS_KEYS = ['phase', 'implement_mode'];

function setup({ registerMethods }) {
  const specManager = require('../main/specManager');
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
      if (!Object.keys(allowed).length) return { error: 'Only the phase and implement mode of a server spec can be changed from the desktop.' };
      return specManager.updateSpecStatusIn(dir, needSlug(slug), allowed);
    }
  });

  return {};
}

module.exports = { setup };
