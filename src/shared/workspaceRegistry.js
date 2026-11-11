/**
 * workspaceRegistry — the rules over a project's workspace records.
 *
 * A workspace is a branch + its git worktree + its terminals (workspaces
 * spec). The records live in the project registry
 * (`~/.frame/workspaces.json`, `projects[i].workspaces`); this module only
 * decides what a change to that array means. Pure by design: no electron,
 * no fs, no git — main persists, git executes, this module rules.
 *
 * Every mutator returns `{ ok: true, records, record }` or
 * `{ ok: false, error: { code, message, holder? } }` and never mutates its
 * input, so a refused change leaves the caller's array untouched.
 *
 * Invariants:
 *   - A branch is held by at most one active (non-archived) workspace (C3).
 *     Archived workspaces hold nothing — their worktree is gone.
 *   - `id` is unique and stable; `name` is unique among the project's
 *     records so folder names never collide.
 *   - `location` is written as 'local' and not interpreted here; the
 *     self-hosted initiative adds other values without a migration (C6).
 *   - `missing` is a transient flag set by `reconcile`; it is never persisted.
 */

const { isValidBranchName } = require('./gitRefNames');

const MAIN_ID = 'main';

/** Defaults for `.frame/config.json` → `settings.workspaces`. */
const DEFAULT_SETTINGS = Object.freeze({
  setupScript: '',
  copyFiles: Object.freeze(['.env*']),
  branchPrefix: 'ws',
  // workspace-pr-flow: null = the first method the repository allows.
  mergeMethod: null,
  archiveOnMerge: true
});

const ERR = Object.freeze({
  BRANCH_IN_USE: 'BRANCH_IN_USE',
  NAME_IN_USE: 'NAME_IN_USE',
  NOT_FOUND: 'NOT_FOUND',
  NOT_ARCHIVED: 'NOT_ARCHIVED',
  ALREADY_ARCHIVED: 'ALREADY_ARCHIVED',
  INVALID: 'INVALID'
});

function fail(code, message, extra) {
  return { ok: false, error: Object.assign({ code, message }, extra || {}) };
}

function list(records) {
  return Array.isArray(records) ? records : [];
}

/** Normalise a filesystem path for comparison: forward slashes, no trailing slash. */
function normalizePath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function isActive(record) {
  return !!record && !record.archivedAt;
}

/** Active workspaces, in stored order. */
function activeOf(records) {
  return list(records).filter(isActive);
}

/** Archived workspaces, newest archive first. */
function archivedOf(records) {
  return list(records)
    .filter((r) => r && r.archivedAt)
    .sort((a, b) => String(b.archivedAt).localeCompare(String(a.archivedAt)));
}

function findById(records, id) {
  return list(records).find((r) => r && r.id === id) || null;
}

/** The active workspace holding `branch`, else null. `excludeId` skips one record. */
function findByBranch(records, branch, excludeId) {
  if (!branch) return null;
  return list(records).find((r) => isActive(r) && r.branch === branch && r.id !== excludeId) || null;
}

function findByName(records, name, excludeId) {
  if (!name) return null;
  return list(records).find((r) => r && r.name === name && r.id !== excludeId) || null;
}

function branchInUse(holder, branch) {
  return fail(ERR.BRANCH_IN_USE, `Branch "${branch}" is already open in workspace "${holder.name}".`, { holder: holder.name });
}

/**
 * Build a new record. `now` is an ISO string supplied by the caller so the
 * module stays deterministic under test.
 */
function createRecord({ id, name, branch, base, path, now }) {
  return {
    id,
    name,
    branch,
    base: base || null,
    path,
    location: 'local',
    createdAt: now,
    archivedAt: null
  };
}

/** Add a workspace. Refused when the branch or name is taken, or fields are missing. */
function add(records, fields) {
  const { id, name, branch, path } = fields || {};
  if (!id || !name || !branch || !path || id === MAIN_ID) {
    return fail(ERR.INVALID, 'A workspace needs an id, a name, a branch and a path.');
  }
  if (findById(records, id)) return fail(ERR.INVALID, `Workspace id "${id}" already exists.`);
  const holder = findByBranch(records, branch);
  if (holder) return branchInUse(holder, branch);
  if (findByName(records, name)) return fail(ERR.NAME_IN_USE, `A workspace named "${name}" already exists.`);
  const record = createRecord(fields);
  return { ok: true, records: [...list(records), record], record };
}

function replace(records, id, patch) {
  let record = null;
  const next = list(records).map((r) => {
    if (r && r.id === id) {
      record = Object.assign({}, r, patch);
      delete record.missing;
      return record;
    }
    return r;
  });
  return { ok: true, records: next, record };
}

/** Archive a workspace: it keeps its branch but stops holding it. */
function archive(records, id, now) {
  const current = findById(records, id);
  if (!current) return fail(ERR.NOT_FOUND, `No workspace "${id}".`);
  if (current.archivedAt) return fail(ERR.ALREADY_ARCHIVED, `Workspace "${current.name}" is already archived.`);
  return replace(records, id, { archivedAt: now });
}

/** Restore an archived workspace. Refused when its branch is now open elsewhere (C3). */
function restore(records, id) {
  const current = findById(records, id);
  if (!current) return fail(ERR.NOT_FOUND, `No workspace "${id}".`);
  if (!current.archivedAt) return fail(ERR.NOT_ARCHIVED, `Workspace "${current.name}" is not archived.`);
  const holder = findByBranch(records, current.branch, id);
  if (holder) return branchInUse(holder, current.branch);
  return replace(records, id, { archivedAt: null });
}

/**
 * Rename a workspace's short name and/or branch. The folder path is not
 * changed here — moving a worktree is the caller's decision.
 */
function rename(records, id, { name, branch } = {}) {
  const current = findById(records, id);
  if (!current) return fail(ERR.NOT_FOUND, `No workspace "${id}".`);
  const patch = {};
  if (name !== undefined && name !== current.name) {
    if (!name) return fail(ERR.INVALID, 'A workspace name cannot be empty.');
    if (findByName(records, name, id)) return fail(ERR.NAME_IN_USE, `A workspace named "${name}" already exists.`);
    patch.name = name;
  }
  if (branch !== undefined && branch !== current.branch) {
    if (!branch) return fail(ERR.INVALID, 'A branch name cannot be empty.');
    if (!isValidBranchName(branch)) return fail(ERR.INVALID, `"${branch}" is not a valid branch name.`);
    if (!current.archivedAt) {
      const holder = findByBranch(records, branch, id);
      if (holder) return branchInUse(holder, branch);
    }
    patch.branch = branch;
  }
  return replace(records, id, patch);
}

/** Drop a record entirely (the "Remove record" action for a missing workspace). */
function remove(records, id) {
  const current = findById(records, id);
  if (!current) return fail(ERR.NOT_FOUND, `No workspace "${id}".`);
  return { ok: true, records: list(records).filter((r) => r && r.id !== id), record: current };
}

/**
 * Mark active records whose worktree no longer appears in `git worktree list`
 * as `missing: true` (and clear the flag on ones that came back). `rows` are
 * `{ path }` objects as loadWorktrees returns them. Archived records are left
 * alone — having no worktree is their normal state.
 */
function reconcile(records, rows, { canon = (p) => p } = {}) {
  // `canon` (realpath in the manager) lets a symlinked workspaces root match
  // the real paths git lists (workspace-hardening L7).
  const key = (p) => normalizePath(p ? canon(p) : p);
  const present = new Set(list(rows).map((row) => key(row && row.path)));
  return list(records).map((r) => {
    if (!isActive(r)) return r;
    const missing = !present.has(key(r.path));
    if (missing === !!r.missing) return r;
    const next = Object.assign({}, r);
    if (missing) next.missing = true;
    else delete next.missing;
    return next;
  });
}

/**
 * Read `settings.workspaces` defensively: a missing or hand-mangled value
 * falls back per key, so a bad config never blocks creating a workspace.
 * `branchPrefix` keeps only ref-safe characters (`a-z0-9._-/`, no leading or
 * trailing slash); an empty prefix after cleaning falls back to `ws`.
 */
function normalizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const setupScript = typeof src.setupScript === 'string' ? src.setupScript : DEFAULT_SETTINGS.setupScript;
  const copyFiles = Array.isArray(src.copyFiles)
    ? src.copyFiles.filter((p) => typeof p === 'string').map((p) => p.trim()).filter(Boolean)
    : [...DEFAULT_SETTINGS.copyFiles];
  const cleanedPrefix = typeof src.branchPrefix === 'string'
    ? src.branchPrefix.trim().toLowerCase().replace(/[^a-z0-9._\/-]+/g, '-').replace(/\/+/g, '/').replace(/^[/.-]+|[/.-]+$/g, '')
    : '';
  const mergeMethod = ['squash', 'merge', 'rebase'].includes(src.mergeMethod) ? src.mergeMethod : DEFAULT_SETTINGS.mergeMethod;
  const archiveOnMerge = typeof src.archiveOnMerge === 'boolean' ? src.archiveOnMerge : DEFAULT_SETTINGS.archiveOnMerge;
  return { setupScript, copyFiles, branchPrefix: cleanedPrefix || DEFAULT_SETTINGS.branchPrefix, mergeMethod, archiveOnMerge };
}

/** Strip transient fields before persisting. */
function toStored(records) {
  return list(records).map((r) => {
    if (!r || !('missing' in r)) return r;
    const copy = Object.assign({}, r);
    delete copy.missing;
    return copy;
  });
}

module.exports = {
  MAIN_ID,
  DEFAULT_SETTINGS,
  normalizeSettings,
  ERR,
  normalizePath,
  isActive,
  activeOf,
  archivedOf,
  findById,
  findByBranch,
  findByName,
  createRecord,
  add,
  archive,
  restore,
  rename,
  remove,
  reconcile,
  toStored
};
