/**
 * Workspace tooling — Frame's gitignored helpers inside a workspace's
 * worktree (spec-in-workspace spec).
 *
 * A worktree only carries what git tracks, so `.frame/bin` (hook scripts),
 * `.frame/runtime/commands` (staged spec templates) and `.frame/index` (the
 * spec index) are missing there — and with them every Frame hook goes quiet,
 * because the hook commands skip when `.frame/bin/<script>` is absent. In
 * `local` gitSharing mode the Claude hook file itself is untracked too.
 *
 * `provision` copies those paths from the main checkout into a worktree
 * (overwriting, so a refresh picks up a newer index). The hint scripts then
 * resolve their root from the hook cwd — the worktree — and read its copies;
 * no script needs to know about workspaces. Copies, not symlinks: no Windows
 * privilege, and no realpath'd `__dirname` steering a script back to main.
 *
 * `handBack` covers the other direction: in `local` mode specs written in a
 * worktree are never committed, so before the worktree is removed they are
 * copied into the main checkout's `.frame/specs`.
 */

const fs = require('fs');
const path = require('path');
const frameStore = require('./frameStore');
const gitSharing = require('./gitSharing');
const logger = require('./logger');
const { provisionEntries, handBackSlugs } = require('../shared/workspaceSpecs');

function modeOf(projectPath) {
  try {
    return gitSharing.getMode(projectPath);
  } catch (_) {
    return 'repo';
  }
}

/**
 * Copy Frame's gitignored tooling from the main checkout into `worktreePath`.
 * Missing sources (a project without Frame) are skipped. Returns the relative
 * paths that were copied.
 */
function provision(projectPath, worktreePath) {
  if (!projectPath || !worktreePath || projectPath === worktreePath) return [];
  if (!fs.existsSync(worktreePath)) return [];
  const copied = [];
  for (const rel of provisionEntries({ gitSharing: modeOf(projectPath) })) {
    const src = path.join(projectPath, rel);
    const dest = path.join(worktreePath, rel);
    if (!fs.existsSync(src)) continue;
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(src, dest, { recursive: true, force: true });
      copied.push(rel);
    } catch (err) {
      logger.warn('workspaces', `could not provision ${rel}: ${err.message}`);
    }
  }
  return copied;
}

/** `[{ slug, updated_at }]` for the spec folders under one checkout's specs root. */
function specStamps(root) {
  const dir = frameStore.specsRoot(root);
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (_) { return []; }
  return names.map((slug) => {
    let updated = '';
    try {
      const status = JSON.parse(fs.readFileSync(path.join(frameStore.resolveSpecDir(root, slug), 'status.json'), 'utf8'));
      updated = status.updated_at || status.created_at || '';
    } catch (_) { /* no status yet — still a folder worth keeping */ }
    return { slug, updated_at: updated };
  });
}

/**
 * Local mode only: copy a worktree's spec folders into the main checkout
 * before the worktree goes away — new slugs, and copies newer than main's.
 * Returns the slugs handed back. Never commits anything.
 */
function handBack(projectPath, worktreePath) {
  const mode = modeOf(projectPath);
  const slugs = handBackSlugs(specStamps(worktreePath), specStamps(projectPath), mode);
  const done = [];
  for (const slug of slugs) {
    try {
      const dest = frameStore.resolveSpecDir(projectPath, slug);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(frameStore.resolveSpecDir(worktreePath, slug), dest, { recursive: true, force: true });
      done.push(slug);
    } catch (err) {
      logger.warn('workspaces', `could not hand spec ${slug} back: ${err.message}`);
    }
  }
  return done;
}

module.exports = { provision, handBack };
