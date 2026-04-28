/**
 * Git Status Manager
 *
 * Polls `git status --porcelain=v1 -z` for the active project on a fixed
 * interval and pushes the parsed result to the renderer for file-tree
 * decoration.
 *
 * Diff viewer / staged-files panel / stage-discard actions are intentionally
 * out of scope here — those are separate features.
 */

const { execFile } = require('child_process');
const { IPC } = require('../shared/ipcChannels');

const POLL_INTERVAL_MS = 5000;
const MAX_BUFFER = 10 * 1024 * 1024;

let mainWindow = null;
let pollTimer = null;
let currentProjectPath = null;
let lastSerialized = null; // de-dupe identical pushes

function init(window) {
  mainWindow = window;
}

function setupIPC(ipcMain) {
  ipcMain.on(IPC.WATCH_GIT_STATUS, (event, projectPath) => {
    startWatching(projectPath);
  });

  ipcMain.on(IPC.UNWATCH_GIT_STATUS, () => {
    stopWatching();
  });
}

function startWatching(projectPath) {
  stopWatching();
  currentProjectPath = projectPath;
  if (!projectPath) return;

  // Initial fetch (don't wait the full interval before showing decorations)
  pushStatus();

  pollTimer = setInterval(pushStatus, POLL_INTERVAL_MS);
}

function stopWatching() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  currentProjectPath = null;
  lastSerialized = null;
}

async function pushStatus() {
  const projectPath = currentProjectPath;
  if (!projectPath || !mainWindow || mainWindow.isDestroyed()) return;

  const result = await readGitStatus(projectPath);

  // Skip if status is identical to the last push (avoids needless renderer work)
  const serialized = JSON.stringify(result);
  if (serialized === lastSerialized) return;
  lastSerialized = serialized;

  mainWindow.webContents.send(IPC.GIT_STATUS_DATA, {
    projectPath,
    isRepo: result.isRepo,
    files: result.files
  });
}

function readGitStatus(projectPath) {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      { cwd: projectPath, maxBuffer: MAX_BUFFER },
      (err, stdout) => {
        if (err) {
          resolve({ isRepo: false, files: {} });
          return;
        }
        resolve({ isRepo: true, files: parsePorcelainV1(stdout) });
      }
    );
  });
}

/**
 * Parse `git status --porcelain=v1 -z` output.
 * Format: "XY <path>\0" with renamed/copied entries adding "<oldpath>\0" after.
 */
function parsePorcelainV1(stdout) {
  const files = {};
  if (!stdout) return files;

  const entries = stdout.split('\0');
  let i = 0;
  while (i < entries.length) {
    const entry = entries[i];
    if (!entry || entry.length < 3) {
      i++;
      continue;
    }
    const indexStatus = entry[0];
    const worktreeStatus = entry[1];
    const filename = entry.substring(3);

    files[filename] = {
      index: indexStatus,
      worktree: worktreeStatus,
      classification: classify(indexStatus, worktreeStatus)
    };

    // Renamed (R) and copied (C) entries are followed by the original name.
    if (indexStatus === 'R' || indexStatus === 'C') {
      i += 2;
    } else {
      i++;
    }
  }

  return files;
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
