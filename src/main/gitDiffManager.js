/**
 * Git Diff Manager
 *
 * Handles `GET_GIT_DIFF` requests from the renderer's Diff Viewer overlay.
 *
 * Runs:
 *   - `git diff -- <path>`           for working-tree (unstaged) diffs
 *   - `git diff --cached -- <path>`  for index (staged) diffs
 *   - `git diff --no-index /dev/null <path>` for untracked files
 *
 * Returns { diff, isBinary, isUntracked }.
 */

const { execFile } = require('child_process');
const path = require('path');
const { IPC } = require('../shared/ipcChannels');
const logger = require('./logger');

const MAX_BUFFER = 20 * 1024 * 1024;
const DIFF_TIMEOUT_MS = 15000;

function setupIPC(ipcMain) {
  ipcMain.handle(IPC.GET_GIT_DIFF, async (_event, payload) => {
    const { projectPath, relPath, staged } = payload || {};
    if (!projectPath || !relPath) {
      return { diff: '', isBinary: false, isUntracked: false };
    }

    if (staged) {
      const out = await runDiff(projectPath, ['diff', '--cached', '--', relPath]);
      return { diff: out.stdout, isBinary: detectBinary(out.stdout), isUntracked: false };
    }

    // Working-tree path. If the file is untracked, `git diff` returns nothing,
    // so fall back to `git diff --no-index /dev/null <path>` to synthesize a diff.
    const tracked = await runDiff(projectPath, ['diff', '--', relPath]);
    if (tracked.stdout && tracked.stdout.trim().length > 0) {
      return { diff: tracked.stdout, isBinary: detectBinary(tracked.stdout), isUntracked: false };
    }

    const absPath = path.isAbsolute(relPath) ? relPath : path.join(projectPath, relPath);
    const untracked = await runDiff(projectPath, [
      'diff',
      '--no-index',
      '--',
      '/dev/null',
      absPath
    ]);
    return {
      diff: untracked.stdout,
      isBinary: detectBinary(untracked.stdout),
      isUntracked: true
    };
  });
}

// Set on the first ENOENT from the git binary — see gitStatusManager.
let gitMissing = false;
const GIT_MISSING_ERROR = 'git is not installed or not on PATH';

function runDiff(cwd, args) {
  if (gitMissing) {
    return Promise.resolve({ stdout: '', stderr: GIT_MISSING_ERROR });
  }
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: MAX_BUFFER, timeout: DIFF_TIMEOUT_MS },
      (err, stdout, stderr) => {
        if (err && err.code === 'ENOENT') {
          if (!gitMissing) {
            gitMissing = true;
            logger.warn('gitDiff', 'git executable not found — diff viewer disabled');
          }
          resolve({ stdout: '', stderr: GIT_MISSING_ERROR });
          return;
        }
        // `git diff --no-index` exits 1 when files differ — that's the normal
        // "we have a diff" case, not an error. Treat any stdout we got as valid.
        if (err && !stdout) {
          resolve({ stdout: '', stderr: stderr || err.message });
          return;
        }
        resolve({ stdout: stdout || '', stderr: stderr || '' });
      }
    );
  });
}

function detectBinary(diff) {
  if (!diff) return false;
  // `git diff` line for binaries: "Binary files a/foo and b/foo differ"
  return /^Binary files .* differ$/m.test(diff);
}

module.exports = { setupIPC };
