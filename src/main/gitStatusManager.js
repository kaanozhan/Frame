/**
 * Git Status Manager
 *
 * Watches the active project (event-driven, no polling) and pushes a fresh
 * `git status --porcelain=v1 -z` snapshot to the renderer for file-tree
 * decoration whenever something relevant changes.
 *
 * Two fs.watch watchers feed one debounced refresh:
 *   • the working tree (recursive) — new/edited/deleted files, and
 *   • the `.git` directory (recursive) — commit / stage / checkout / branch,
 *     which only ever touch files inside `.git` (index, HEAD, refs/…) and are
 *     missed by the worktree watcher on most platforms.
 * On top of that we refresh on window focus and on explicit REFRESH_GIT_STATUS
 * requests (e.g. the Changes tab being opened) as a safety net for any event a
 * watcher dropped. The `lastSerialized` de-dupe means an unchanged status never
 * reaches the renderer, so these extra triggers are silent when nothing moved.
 *
 * Diff viewer / staged-files panel / stage-discard actions are intentionally
 * out of scope here — those are separate features.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { IPC } = require('../shared/ipcChannels');

const MAX_BUFFER = 10 * 1024 * 1024;
const DEBOUNCE_MS = 200;

let mainWindow = null;
let worktreeWatcher = null;
let gitDirWatcher = null;
let debounceTimer = null;
let currentProjectPath = null;
let lastSerialized = null; // de-dupe identical pushes
let isFetching = false; // in-flight guard
let pendingRefetch = false; // a trigger arrived mid-fetch

function init(window) {
  mainWindow = window;
  // Refocusing the app is a cheap moment to reconcile any event a watcher may
  // have dropped while we were in the background. pushStatus() self-guards on
  // currentProjectPath, so this is a no-op when nothing is being watched.
  window.on('focus', () => pushStatus());
}

function setupIPC(ipcMain) {
  ipcMain.on(IPC.WATCH_GIT_STATUS, (event, projectPath) => {
    startWatching(projectPath);
  });

  ipcMain.on(IPC.UNWATCH_GIT_STATUS, () => {
    stopWatching();
  });

  // On-demand refresh (e.g. the Changes tab was opened). Silent unless the
  // status actually changed — see lastSerialized de-dupe in pushStatus().
  ipcMain.on(IPC.REFRESH_GIT_STATUS, () => {
    pushStatus();
  });
}

function startWatching(projectPath) {
  stopWatching();
  currentProjectPath = projectPath;
  if (!projectPath) return;

  // Initial snapshot so decorations paint immediately.
  pushStatus();

  // Working-tree watcher: new/edited/deleted files. Events under `.git/` are
  // ignored here because the dedicated .git watcher handles those.
  try {
    worktreeWatcher = fs.watch(
      projectPath,
      { recursive: true, persistent: false },
      (eventType, filename) => {
        if (filename && isGitInternalPath(filename)) return;
        scheduleRefresh();
      }
    );
  } catch (err) {
    console.error('gitStatusManager: worktree fs.watch failed', err);
  }

  // `.git` watcher: commit / stage / unstage / checkout / branch only ever
  // mutate files inside `.git` (index, HEAD, refs/…). Only watch when `.git`
  // is a real directory — for linked worktrees / submodules it's a file, in
  // which case the worktree watcher alone is acceptable.
  try {
    const gitDir = path.join(projectPath, '.git');
    const stat = fs.statSync(gitDir);
    if (stat.isDirectory()) {
      gitDirWatcher = fs.watch(
        gitDir,
        { recursive: true, persistent: false },
        () => scheduleRefresh()
      );
    }
  } catch (err) {
    // Not a repo (no .git) or watch unsupported — fine, leave it unset.
  }
}

function stopWatching() {
  if (worktreeWatcher) {
    try { worktreeWatcher.close(); } catch (_) { /* ignore */ }
  }
  worktreeWatcher = null;
  if (gitDirWatcher) {
    try { gitDirWatcher.close(); } catch (_) { /* ignore */ }
  }
  gitDirWatcher = null;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  currentProjectPath = null;
  lastSerialized = null;
  pendingRefetch = false;
}

// True for paths that live inside the repo's `.git` directory, so the worktree
// watcher can defer them to the dedicated .git watcher.
function isGitInternalPath(filename) {
  return filename === '.git' || filename.startsWith('.git' + path.sep) || filename.startsWith('.git/');
}

// Coalesce bursts (a checkout or `npm install` touches many files) into a
// single git-status run.
function scheduleRefresh() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    pushStatus();
  }, DEBOUNCE_MS);
}

async function pushStatus() {
  const projectPath = currentProjectPath;
  if (!projectPath || !mainWindow || mainWindow.isDestroyed()) return;

  // In-flight guard: never run two `git status` at once; remember that another
  // trigger arrived so we reconcile once the current run finishes.
  if (isFetching) {
    pendingRefetch = true;
    return;
  }
  isFetching = true;

  try {
    const result = await readGitStatus(projectPath);

    // Bail if watching stopped or the project changed mid-fetch.
    if (currentProjectPath !== projectPath || !mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    // Skip if identical to the last push (avoids needless renderer work).
    const serialized = JSON.stringify(result);
    if (serialized !== lastSerialized) {
      lastSerialized = serialized;
      mainWindow.webContents.send(IPC.GIT_STATUS_DATA, {
        projectPath,
        isRepo: result.isRepo,
        branch: result.branch || null,
        files: result.files
      });
    }
  } finally {
    isFetching = false;
    if (pendingRefetch) {
      pendingRefetch = false;
      pushStatus();
    }
  }
}

function readGitStatus(projectPath) {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all'],
      { cwd: projectPath, maxBuffer: MAX_BUFFER },
      (err, stdout) => {
        if (err) {
          resolve({ isRepo: false, branch: null, files: {} });
          return;
        }
        const parsed = parsePorcelainV1(stdout);
        resolve({ isRepo: true, branch: parsed.branch, files: parsed.files });
      }
    );
  });
}

/**
 * Parse `git status --porcelain=v1 -z --branch` output.
 * First entry is the branch header: "## main...origin/main [ahead 1]",
 * "## HEAD (no branch)" (detached) or "## No commits yet on main".
 * File entries: "XY <path>\0" with renamed/copied adding "<oldpath>\0" after.
 */
function parsePorcelainV1(stdout) {
  const files = {};
  let branch = null;
  if (!stdout) return { branch, files };

  const entries = stdout.split('\0');
  let i = 0;
  while (i < entries.length) {
    const entry = entries[i];
    if (!entry || entry.length < 3) {
      i++;
      continue;
    }

    // Branch header from --branch
    if (entry.startsWith('## ')) {
      const header = entry.substring(3);
      if (header.startsWith('No commits yet on ')) {
        branch = header.substring('No commits yet on '.length);
      } else if (header.startsWith('HEAD ')) {
        branch = 'detached HEAD';
      } else {
        branch = header.split('...')[0].split(' ')[0];
      }
      i++;
      continue;
    }

    const indexStatus = entry[0];
    const worktreeStatus = entry[1];
    const filename = entry.substring(3);

    const fileInfo = {
      index: indexStatus,
      worktree: worktreeStatus,
      classification: classify(indexStatus, worktreeStatus)
    };

    // Renamed (R) and copied (C) entries are followed by the original name.
    if (indexStatus === 'R' || indexStatus === 'C') {
      const oldPath = entries[i + 1];
      if (oldPath) fileInfo.oldPath = oldPath;
      files[filename] = fileInfo;
      i += 2;
    } else {
      files[filename] = fileInfo;
      i++;
    }
  }

  return { branch, files };
}

/**
 * Reduce two-character status to a single classification useful for UI styling.
 * Order matters: conflicts and stages take precedence over modifications.
 */
function classify(index, worktree) {
  if (index === '?' && worktree === '?') return 'untracked';
  if (index === '!' && worktree === '!') return 'ignored';

  // Conflicts: any U marker, or AA/DD per git status docs
  if (
    index === 'U' ||
    worktree === 'U' ||
    (index === 'A' && worktree === 'A') ||
    (index === 'D' && worktree === 'D')
  ) {
    return 'conflict';
  }

  // Index has changes (staged) — check first because staged additions matter
  if (index === 'A') return 'added';
  if (index === 'R') return 'renamed';
  if (index === 'D' && worktree !== 'D') return 'deleted';

  // Worktree-only deletion
  if (worktree === 'D') return 'deleted';

  // Anything else with M is modified
  if (index === 'M' || worktree === 'M') return 'modified';

  return 'modified';
}

module.exports = { init, setupIPC };
