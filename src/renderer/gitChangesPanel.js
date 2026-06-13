/**
 * Git Changes Panel (Changes sidebar tab)
 *
 * Subscribes to `GIT_STATUS_DATA` (already pushed by gitStatusManager for the
 * active project's file tree decoration) and renders the entries in VSCode-
 * style buckets: Staged Changes / Changes / Merge Conflicts.
 *
 * Read-only — clicking a row will (in T09) open the Diff Viewer overlay.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

let emptyEl = null;
let bodyEl = null;
let sections = { staged: null, changes: null, conflict: null };
let lists = { staged: null, changes: null, conflict: null };

let currentProjectPath = null;
let onRowClick = null;
// Flat, display-order list of changed files ({ relPath, staged, group }) — the
// diff section reads this for its prev/next navigation.
let lastOrdered = [];

function init(opts = {}) {
  emptyEl = document.getElementById('git-changes-empty');
  bodyEl = document.getElementById('git-changes-body');
  if (!emptyEl || !bodyEl) return;

  onRowClick = typeof opts.onRowClick === 'function' ? opts.onRowClick : null;

  for (const group of ['staged', 'changes', 'conflict']) {
    sections[group] = bodyEl.querySelector(`[data-git-changes-group="${group}"]`);
    lists[group] = bodyEl.querySelector(`[data-git-changes-list="${group}"]`);
  }

  // Event delegation — one listener for all rows across all groups.
  bodyEl.addEventListener('click', (e) => {
    const row = e.target.closest('.git-changes-row');
    if (!row || !bodyEl.contains(row)) return;
    if (!onRowClick) return;
    onRowClick({
      projectPath: currentProjectPath,
      relPath: row.dataset.relpath,
      group: row.dataset.group,
      staged: row.dataset.group === 'staged'
    });
  });

  ipcRenderer.on(IPC.GIT_STATUS_DATA, (_event, payload) => {
    if (!payload) return;
    handleStatus(payload);
  });
}

function handleStatus(payload) {
  currentProjectPath = payload.projectPath || null;

  if (!payload.isRepo) {
    lastOrdered = [];
    showMessage('Not a git repository');
    return;
  }

  const buckets = partition(payload.files || {});
  const total = buckets.staged.length + buckets.changes.length + buckets.conflict.length;

  // Flat nav order matches the on-screen order: staged → changes → conflict.
  lastOrdered = [
    ...buckets.staged.map((e) => ({ relPath: e.relPath, staged: true, group: 'staged' })),
    ...buckets.changes.map((e) => ({ relPath: e.relPath, staged: false, group: 'changes' })),
    ...buckets.conflict.map((e) => ({ relPath: e.relPath, staged: false, group: 'conflict' }))
  ];

  if (total === 0) {
    showMessage('Working tree clean');
    return;
  }

  emptyEl.style.display = 'none';
  bodyEl.style.display = '';

  renderGroup('staged', buckets.staged);
  renderGroup('changes', buckets.changes);
  renderGroup('conflict', buckets.conflict);
}

function showMessage(text) {
  emptyEl.textContent = text;
  emptyEl.style.display = '';
  bodyEl.style.display = 'none';
}

/**
 * Partition `{ [relPath]: { index, worktree, classification } }` into three
 * buckets. A file with both staged and worktree changes appears in both
 * `staged` and `changes` (VSCode parity).
 */
function partition(files) {
  const staged = [];
  const changes = [];
  const conflict = [];

  for (const [relPath, entry] of Object.entries(files)) {
    const { index, worktree, classification, oldPath } = entry;

    if (classification === 'ignored') continue;

    const base = { relPath, index, worktree, classification, oldPath };

    if (classification === 'conflict') {
      conflict.push({ ...base, group: 'conflict' });
      continue;
    }

    // Staged: index char is something other than ' ' or '?'
    if (index && index !== ' ' && index !== '?') {
      staged.push({ ...base, group: 'staged' });
    }

    // Working-tree changes or untracked
    const isUntracked = index === '?' && worktree === '?';
    if (isUntracked || worktree === 'M' || worktree === 'D' || worktree === 'A') {
      changes.push({ ...base, group: 'changes' });
    }
  }

  const byPath = (a, b) => a.relPath.localeCompare(b.relPath);
  staged.sort(byPath);
  changes.sort(byPath);
  conflict.sort(byPath);

  return { staged, changes, conflict };
}

function renderGroup(group, entries) {
  const sectionEl = sections[group];
  const listEl = lists[group];
  if (!sectionEl || !listEl) return;

  if (entries.length === 0) {
    sectionEl.style.display = 'none';
    listEl.innerHTML = '';
    return;
  }

  sectionEl.style.display = '';
  listEl.innerHTML = '';
  for (const entry of entries) {
    listEl.appendChild(buildRow(entry));
  }
}

function buildRow(entry) {
  const row = document.createElement('div');
  row.className = 'git-changes-row';
  // The diff fetcher always wants the NEW path for renames.
  row.dataset.relpath = entry.relPath;
  row.dataset.group = entry.group;

  const lastSlash = entry.relPath.lastIndexOf('/');
  const name = lastSlash >= 0 ? entry.relPath.slice(lastSlash + 1) : entry.relPath;
  const dir = lastSlash >= 0 ? entry.relPath.slice(0, lastSlash) : '';

  const nameEl = document.createElement('span');
  nameEl.className = 'git-changes-row-name';

  // Renamed: show "oldname → newname" so the user sees what moved.
  if (entry.oldPath) {
    const oldLast = entry.oldPath.lastIndexOf('/');
    const oldName = oldLast >= 0 ? entry.oldPath.slice(oldLast + 1) : entry.oldPath;
    nameEl.textContent = `${oldName} → ${name}`;
  } else {
    nameEl.textContent = name;
  }

  const dirEl = document.createElement('span');
  dirEl.className = 'git-changes-row-dir';
  dirEl.textContent = dir;

  const badge = document.createElement('span');
  badge.className = 'git-changes-row-badge';
  const status = badgeChar(entry);
  badge.dataset.status = status;
  badge.textContent = status;

  const hoverPath = entry.oldPath
    ? `${entry.oldPath} → ${entry.relPath}`
    : entry.relPath;
  row.title = `${hoverPath} (${entry.index || ' '}${entry.worktree || ' '})`;
  row.append(nameEl, dirEl, badge);
  return row;
}

function badgeChar(entry) {
  if (entry.group === 'staged') {
    return normalize(entry.index);
  }
  if (entry.group === 'conflict') {
    return 'C';
  }
  // changes group
  if (entry.index === '?' && entry.worktree === '?') return 'U';
  return normalize(entry.worktree);
}

function normalize(ch) {
  if (!ch || ch === ' ') return 'M';
  return ch;
}

/** Current changed files in display order (for the diff section's prev/next). */
function getOrderedFiles() {
  return lastOrdered.slice();
}

module.exports = { init, getOrderedFiles };
