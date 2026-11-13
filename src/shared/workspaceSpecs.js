/**
 * workspaceSpecs — where a spec lives once specs move into workspaces
 * (spec-in-workspace spec).
 *
 * Specs are written inside a workspace's worktree and ride its branch; the
 * project still sees one list: the main checkout's specs plus each active
 * workspace's in-flight specs. This module holds the rules for that list and
 * for the files Frame provisions into a worktree so its tooling works there.
 *
 * Pure by design: lists and plain values in, plain values out. No fs, no
 * electron — main reads folders and copies files, this module decides.
 */

/**
 * Gitignored Frame paths a worktree needs for hooks, helpers and staged
 * commands, relative to a checkout root. In `local` gitSharing mode the
 * Claude hook file is untracked as well, so it is provisioned too.
 */
function provisionEntries({ gitSharing } = {}) {
  const entries = ['.frame/bin', '.frame/runtime/commands', '.frame/index'];
  if (gitSharing === 'local') entries.push('.claude/settings.local.json');
  return entries;
}

function isMalformed(spec) {
  return !!(spec && spec.malformed);
}

function sortSpecs(list) {
  // Same order listSpecs has always returned: malformed first (they need
  // attention), then most recently updated.
  return list.sort((a, b) => {
    const am = isMalformed(a) ? 0 : 1;
    const bm = isMalformed(b) ? 0 : 1;
    if (am !== bm) return am - bm;
    return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
  });
}

/**
 * Merge the main checkout's specs with each workspace's.
 *
 * @param {Array} mainSpecs - listSpecs() of the main checkout
 * @param {Array<{workspace: {id, name, branch, root}, specs: Array}>} workspaceLists
 * @returns {Array} one entry per slug, each tagged `workspace` (null = main).
 *   On a slug present in both, the workspace copy wins — it is the version
 *   being worked on; once the workspace is archived, main's copy shows again.
 *   Between two workspaces the first listed wins (records keep their order).
 */
function mergeSpecLists(mainSpecs, workspaceLists) {
  const bySlug = new Map();
  for (const spec of mainSpecs || []) {
    if (!spec || !spec.slug) continue;
    bySlug.set(spec.slug, { ...spec, workspace: null });
  }
  const claimed = new Set();
  for (const entry of workspaceLists || []) {
    if (!entry || !entry.workspace) continue;
    const { id, name, branch, root } = entry.workspace;
    for (const spec of entry.specs || []) {
      if (!spec || !spec.slug || claimed.has(spec.slug)) continue;
      claimed.add(spec.slug);
      bySlug.set(spec.slug, { ...spec, workspace: { id, name, branch: branch || null, root } });
    }
  }
  return sortSpecs(Array.from(bySlug.values()));
}

/** The root a slug lives in: its workspace's folder, else the main checkout. */
function rootForSlug(mergedSpecs, slug, projectPath) {
  const spec = (mergedSpecs || []).find((s) => s && s.slug === slug);
  return spec && spec.workspace && spec.workspace.root ? spec.workspace.root : projectPath;
}

/**
 * Values a staged spec command is filled with. `{project_path}` is where the
 * agent works (the worktree for a workspace spec); `{tasks_path}` is always
 * the main checkout's tasks.json, so task state never forks onto a branch.
 */
function commandPaths({ projectPath, root, tasksPath }) {
  return {
    project_path: root || projectPath,
    tasks_path: tasksPath
  };
}

/**
 * Spec folders to copy from a worktree back into the main checkout before the
 * worktree is removed. Only in `local` gitSharing mode — in `repo` mode the
 * specs are committed on the branch. A slug already in main is skipped unless
 * the worktree copy is newer (compare `updated_at`), so a hand-back never
 * replaces newer work with older.
 *
 * @param {Array<{slug, updated_at}>} worktreeSpecs
 * @param {Array<{slug, updated_at}>} mainSpecs
 * @param {'repo'|'local'} mode
 * @returns {string[]} slugs to copy
 */
function handBackSlugs(worktreeSpecs, mainSpecs, mode) {
  if (mode !== 'local') return [];
  const main = new Map((mainSpecs || []).filter((s) => s && s.slug).map((s) => [s.slug, s]));
  return (worktreeSpecs || [])
    .filter((s) => s && s.slug)
    .filter((s) => {
      const existing = main.get(s.slug);
      if (!existing) return true;
      return String(s.updated_at || '') > String(existing.updated_at || '');
    })
    .map((s) => s.slug);
}

module.exports = { provisionEntries, mergeSpecLists, rootForSlug, commandPaths, handBackSlugs };
