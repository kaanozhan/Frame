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
const { isGitMissing } = require('../shared/gitMissing');
const path = require('path');
const { IPC } = require('../shared/ipcChannels');
const logger = require('./logger');
const { isValidBranchName } = require('../shared/gitRefNames');
const fs = require('fs');
const { parseNumstat, mergeChangedFiles, MAX_DIFF_BYTES } = require('../shared/reviewModel');

const MAX_BUFFER = 20 * 1024 * 1024;
const DIFF_TIMEOUT_MS = 15000;

/**
 * One file's diff for the diff tab: staged (`--cached`), working tree, or a
 * synthesized diff for an untracked file. Exported so Frame Server answers
 * the same call for server workspaces (server-workspace-panels).
 */
async function gitDiff(payload) {
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
}

function setupIPC(ipcMain) {
  // Server workspaces are diffed and reviewed on the server (server-workspace-panels).
  const serverPanels = require('./serverPanels');
  // Routed by the payload's workspace id when it has one (server-hardening T6).
  const remote = (p, ctx, method, params, fallback) => {
    const entry = p && serverPanels.resolve(p, serverPanels.ctxOf(ctx));
    return entry ? serverPanels.call(entry, method, params).catch((err) => fallback(err.message)) : null;
  };
  ipcMain.handle(IPC.REVIEW_FILES, async (_event, { root, base, workspaceId } = {}) =>
    remote(root, { workspaceId }, 'review.files', { root, base }, (error) => ({ error, mergeBase: null, files: [] })) || reviewFiles(root, base));
  ipcMain.handle(IPC.REVIEW_FILE_DIFF, async (_event, payload = {}) =>
    remote(payload.root, payload, 'review.fileDiff', payload, (error) => ({ diff: '', isBinary: false, tooLarge: false, error })) || reviewFileDiff(payload.root, payload));

  ipcMain.handle(IPC.GET_GIT_DIFF, async (_event, payload) =>
    remote(payload && payload.projectPath, payload, 'git.diff', payload || {}, (error) => ({ diff: '', isBinary: false, isUntracked: false, error })) || gitDiff(payload));
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
      // Reads only: never take index.lock (see gitBranchesManager).
      ['--no-optional-locks', ...args],
      { cwd, maxBuffer: MAX_BUFFER, timeout: DIFF_TIMEOUT_MS },
      (err, stdout, stderr) => {
        if (isGitMissing(err, cwd)) {
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

// ─── Workspace review (workspace-review) ──────────────────
//
// Everything a workspace changes since the merge base with its base branch:
// committed and uncommitted tracked changes (`git diff <merge-base>` compares
// the working tree with that commit) plus untracked files. Read-only.

const HASH_CHUNK = 200;
const UNTRACKED_LINE_COUNT_MAX = 1024 * 1024;

/** Merge base of HEAD with origin/<base>, else with the local <base>. */
async function mergeBaseOf(root, base) {
  for (const ref of [`origin/${base}`, base]) {
    const out = await runDiff(root, ['merge-base', ref, 'HEAD']);
    const sha = out.stdout.trim();
    if (/^[0-9a-f]{7,40}$/.test(sha)) return sha;
  }
  return null;
}

/** Content hashes for existing files, `{ path: sha }`, in chunks. */
async function hashFiles(root, paths) {
  const hashes = {};
  const existing = paths.filter((p) => {
    try { return fs.statSync(path.join(root, p)).isFile(); } catch (_) { return false; }
  });
  for (let i = 0; i < existing.length; i += HASH_CHUNK) {
    const chunk = existing.slice(i, i + HASH_CHUNK);
    const out = await runDiff(root, ['hash-object', '--', ...chunk]);
    const lines = out.stdout.split('\n').map((l) => l.trim());
    chunk.forEach((p, j) => { if (lines[j]) hashes[p] = lines[j]; });
  }
  return hashes;
}

/** Line counts for small text untracked files (shown as +N). */
function countLines(root, paths) {
  const out = {};
  for (const p of paths) {
    try {
      const abs = path.join(root, p);
      if (fs.statSync(abs).size > UNTRACKED_LINE_COUNT_MAX) continue;
      const buf = fs.readFileSync(abs);
      if (buf.includes(0)) continue;
      const text = buf.toString('utf8');
      out[p] = text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0;
    } catch (_) { /* unreadable — no count */ }
  }
  return out;
}

const COMMIT_ID = /^[0-9a-f]{7,64}$/;

async function reviewFiles(root, base) {
  if (!root) return { error: 'No workspace', mergeBase: null, files: [] };
  // Base and merge base reach git argv: never let them be options (workspace-hardening L13d).
  if (base && !isValidBranchName(base)) return { error: `"${base}" is not a valid base branch name.`, mergeBase: null, files: [] };
  const mergeBase = await mergeBaseOf(root, base || 'main');
  if (!mergeBase) return { error: `No common history with ${base || 'main'}`, mergeBase: null, files: [] };
  const [numstat, nameStatus, untrackedOut] = await Promise.all([
    runDiff(root, ['diff', '-z', '-M', '--numstat', mergeBase]),
    runDiff(root, ['diff', '-z', '-M', '--name-status', mergeBase]),
    runDiff(root, ['ls-files', '--others', '--exclude-standard', '-z'])
  ]);
  const untracked = untrackedOut.stdout.split('\0').filter(Boolean);
  const trackedPaths = parseNumstat(numstat.stdout).map((n) => n.path);
  const hashes = await hashFiles(root, [...new Set([...trackedPaths, ...untracked])]);
  const files = mergeChangedFiles({
    numstat: numstat.stdout,
    nameStatus: nameStatus.stdout,
    untracked,
    hashes,
    untrackedLines: countLines(root, untracked)
  });
  return { error: null, mergeBase, files };
}

async function reviewFileDiff(root, { mergeBase, path: rel, oldPath, untracked }) {
  if (!root || !rel) return { diff: '', isBinary: false, tooLarge: false };
  if (!untracked && !COMMIT_ID.test(String(mergeBase || ''))) {
    return { diff: '', isBinary: false, tooLarge: false, error: 'The review has no valid merge base — refresh it.' };
  }
  const args = untracked
    ? ['diff', '--no-index', '--', '/dev/null', rel]
    : ['diff', '-M', mergeBase, '--', ...(oldPath ? [oldPath] : []), rel];
  const out = await runDiff(root, args);
  const diff = out.stdout || '';
  if (Buffer.byteLength(diff, 'utf8') > MAX_DIFF_BYTES) return { diff: '', isBinary: false, tooLarge: true };
  return { diff, isBinary: detectBinary(diff), tooLarge: false };
}

function detectBinary(diff) {
  if (!diff) return false;
  // `git diff` line for binaries: "Binary files a/foo and b/foo differ"
  return /^Binary files .* differ$/m.test(diff);
}

module.exports = { setupIPC, gitDiff, reviewFiles, reviewFileDiff };
