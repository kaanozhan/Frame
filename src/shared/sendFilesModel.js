/**
 * sendFilesModel — the rules behind the "Send files to server" modal
 * (server-copy-files). Pure: paths, sizes and states in; trees, selections
 * and verdicts out. The modal and the desktop main process both use it.
 *
 * Two groups, as git reports them:
 *   ignored    — `git ls-files --others --ignored --exclude-standard --directory`:
 *                files, and fully ignored folders listed collapsed (`node_modules/`)
 *   untracked  — `git ls-files --others --exclude-standard`: new files not yet
 *                committed (committing them is the better path; never in the
 *                server's main copy)
 *
 * A *leaf* is what can be ticked: a file, or a collapsed folder (sent whole).
 */

const { compile } = require('./copyFilesMatch');

// Folders that must be rebuilt on the server (Mac-built natives do not run
// on Linux) or are only caches; plus macOS clutter.
const HEAVY_DIRS = new Set([
  'node_modules', '.venv', 'venv', 'dist', 'build', '.next', '.nuxt', '.cache',
  'target', '__pycache__', '.turbo', 'coverage', '.parcel-cache', '.gradle'
]);
const CLUTTER = new Set(['.DS_Store']);

const WARN_BYTES = 50 * 1024 * 1024;
const REFUSE_BYTES = 1024 * 1024 * 1024;

function clean(p) {
  return String(p || '').replace(/\/+$/, '');
}

/** A dependency/build/cache folder (or something inside one), or OS clutter. */
function isHeavy(relPath) {
  const segs = clean(relPath).split('/');
  if (CLUTTER.has(segs[segs.length - 1])) return true;
  return segs.some((s) => HEAVY_DIRS.has(s));
}

/**
 * Build one group's tree. `paths`: git's list (collapsed folders end with
 * `/`). `sizes`: `{ path: { size, cut } }`. `server`: `{ path: 'same'|'changed'|'missing' }`.
 */
function buildGroup(group, paths, sizes = {}, server = {}) {
  const root = { path: '', name: '', type: 'dir', group, children: [] };
  const dirs = new Map([['', root]]);
  const dirFor = (rel) => {
    if (dirs.has(rel)) return dirs.get(rel);
    const parent = dirFor(rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
    const node = { path: rel, name: rel.slice(rel.lastIndexOf('/') + 1), type: 'dir', group, children: [] };
    parent.children.push(node);
    dirs.set(rel, node);
    return node;
  };
  // A folder git lists collapsed is sent whole; a path git also lists inside
  // it would draw that folder twice (seen on `.claude/`), so it is dropped.
  const whole = (paths || []).filter((p) => String(p).endsWith('/')).map((p) => clean(p));
  const insideWhole = (rel) => whole.some((d) => rel !== d && rel.startsWith(`${d}/`));
  for (const raw of paths || []) {
    if (insideWhole(clean(raw))) continue;
    const collapsed = String(raw).endsWith('/');
    const rel = clean(raw);
    if (!rel) continue;
    const parent = dirFor(rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
    const s = sizes[rel] || {};
    parent.children.push({
      path: rel,
      name: rel.slice(rel.lastIndexOf('/') + 1),
      type: collapsed ? 'dir' : 'file',
      collapsed,
      leaf: true,
      group,
      size: Number(s.size) || 0,
      ...(s.cut ? { sizeCut: true } : {}),
      heavy: isHeavy(rel),
      ...(server[rel] ? { server: server[rel] } : {})
    });
  }
  const sortRec = (n) => {
    if (!n.children) return;
    n.children.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    n.children.forEach(sortRec);
  };
  sortRec(root);
  return root;
}

/** `{ ignored, untracked }` trees. */
function buildTree({ ignored = [], untracked = [], sizes = {}, server = {} } = {}) {
  return { ignored: buildGroup('ignored', ignored, sizes, server), untracked: buildGroup('untracked', untracked, sizes, server) };
}

/** Every tickable leaf under `node` (or under both groups of a tree). */
function leaves(node) {
  if (!node) return [];
  if (node.ignored || node.untracked) return [...leaves(node.ignored), ...leaves(node.untracked)];
  if (node.leaf) return [node];
  return (node.children || []).flatMap(leaves);
}

/**
 * What the modal opens with: leaves matching the project's `copyFiles`,
 * unless heavy or already identical on the server. "Select all" is never
 * the default.
 */
function defaultSelection(tree, copyFiles) {
  const match = compile(Array.isArray(copyFiles) ? copyFiles : []);
  const out = new Set();
  for (const l of leaves(tree)) {
    if (l.heavy || l.server === 'same') continue;
    if (match(l.path)) out.add(l.path);
  }
  return out;
}

/** Tick or untick everything under `node`; returns a new Set. */
function toggle(selected, node, on) {
  const next = new Set(selected);
  for (const l of leaves(node)) {
    if (on) next.add(l.path); else next.delete(l.path);
  }
  return next;
}

function selectAll(tree) {
  return new Set(leaves(tree).map((l) => l.path));
}

/** `{ bytes, files, cut }` for the ticked leaves; `cut` when a folder's size is a lower bound. */
function selectionSize(tree, selected) {
  let bytes = 0;
  let files = 0;
  let cut = false;
  for (const l of leaves(tree)) {
    if (!selected.has(l.path)) continue;
    bytes += l.size || 0;
    files += 1;
    if (l.sizeCut) cut = true;
  }
  return { bytes, files, cut };
}

/** 'ok' | 'warn' (above 50 MB) | 'refuse' (above 1 GB). */
function sizeVerdict(bytes) {
  if (bytes > REFUSE_BYTES) return 'refuse';
  if (bytes > WARN_BYTES) return 'warn';
  return 'ok';
}

/**
 * The `copyFiles` patterns "Remember for this project" saves: ignored
 * leaves only (the server copies ignored files into new workspaces; untracked
 * ones never go there). A file is anchored at the root (`/.env` — not every
 * `.env` at any depth); a collapsed folder becomes `folder/**`.
 */
function patternsFor(tree, selected) {
  const out = [];
  for (const l of leaves(tree.ignored || tree)) {
    if (l.group !== 'ignored' || !selected.has(l.path)) continue;
    // A path with a `/` is already anchored; a root-level file needs the leading `/`.
    out.push(l.type === 'dir' ? `${l.path}/**` : (l.path.includes('/') ? l.path : `/${l.path}`));
  }
  return out;
}

/** Existing patterns plus new ones, in order, without duplicates. */
function mergePatterns(existing, added) {
  const out = [];
  for (const p of [...(existing || []), ...(added || [])]) {
    const t = String(p || '').trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** `1.2 KB`, `48 MB`; `≥ ` in front when the size is a lower bound. */
function formatBytes(bytes, cut = false) {
  const n = Number(bytes) || 0;
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  const text = i === 0 ? `${n} B` : `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
  return cut ? `≥ ${text}` : text;
}

module.exports = {
  HEAVY_DIRS, WARN_BYTES, REFUSE_BYTES, formatBytes,
  isHeavy, buildTree, leaves, defaultSelection, toggle, selectAll, selectionSize, sizeVerdict, patternsFor, mergePatterns
};
