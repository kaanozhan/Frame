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
const { isGitMissing } = require('../shared/gitMissing');
const fs = require('fs');
const path = require('path');
const fsSafe = require('./fsSafe');
const activityLog = require('./activityLog');
const logger = require('./logger');
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

// ─── Server workspaces (server-workspace-panels) ──────────────
//
// One watch at a time, as before — but it may be on the server: watching a
// server workspace's folder stops the local watcher and asks Frame Server to
// watch it (its own gitStatusManager); the server's status comes back as
// `git.status` and goes to the window as GIT_STATUS_DATA. A reconnect
// re-issues the watch.

let remoteWatch = null; // { entry, root }
let remoteWired = false;

function serverPanels() {
  return require('./serverPanels');
}

function wireRemote() {
  if (remoteWired) return;
  remoteWired = true;
  const sc = require('./serverConnection');
  sc.on('git.status', (payload) => {
    if (!remoteWatch || !payload || payload.projectPath !== remoteWatch.root) return;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.GIT_STATUS_DATA, payload);
  });
  sc.on('connected', () => {
    if (remoteWatch) serverPanels().call(remoteWatch.entry, 'git.watch', { root: remoteWatch.root }).catch(() => {});
  });
}

function unwatchRemote() {
  if (!remoteWatch) return;
  const { entry } = remoteWatch;
  remoteWatch = null;
  serverPanels().call(entry, 'git.unwatch', {}).catch(() => {});
}

function watch(projectPath, ctx = null) {
  const entry = projectPath && serverPanels().resolve(projectPath, ctx);
  if (!entry) {
    unwatchRemote();
    startWatching(projectPath);
    return;
  }
  stopWatching();
  remoteWatch = { entry, root: projectPath };
  serverPanels().call(entry, 'git.watch', { root: projectPath }).catch((err) => {
    logger.warn('gitStatus', `server watch failed: ${err.message}`);
  });
}

function setupIPC(ipcMain) {
  try { wireRemote(); } catch (err) { logger.warn('gitStatus', `server status not wired: ${err.message}`); }

  ipcMain.on(IPC.WATCH_GIT_STATUS, (event, projectPath, ctx) => {
    watch(projectPath, serverPanels().ctxOf(ctx));
  });

  ipcMain.on(IPC.UNWATCH_GIT_STATUS, () => {
    unwatchRemote();
    stopWatching();
  });

  // On-demand refresh (e.g. the Changes tab was opened). Silent unless the
  // status actually changed — see lastSerialized de-dupe in pushStatus().
  ipcMain.on(IPC.REFRESH_GIT_STATUS, () => {
    if (remoteWatch) serverPanels().call(remoteWatch.entry, 'git.refresh', {}).catch(() => {});
    else pushStatus();
  });
}

/**
 * The git dir a `.git` *file* points at (`gitdir: <path>`), resolved against
 * the worktree it sits in. Linked worktrees and submodules use this form.
 * Pure: takes the file's contents. Returns null for anything else.
 */
function gitDirFromDotGitFile(contents, worktreePath) {
  const match = /^gitdir:\s*(.+?)\s*$/m.exec(String(contents || ''));
  if (!match) return null;
  return path.resolve(worktreePath, match[1]);
}

/** The real git dir for `projectPath`: `.git` itself, or where a `.git` file points. */
function resolveGitDir(projectPath) {
  const dotGit = path.join(projectPath, '.git');
  let stat;
  try { stat = fs.statSync(dotGit); } catch (_) { return null; }
  if (stat.isDirectory()) return dotGit;
  if (!stat.isFile()) return null;
  try {
    return gitDirFromDotGitFile(fs.readFileSync(dotGit, 'utf8'), projectPath);
  } catch (_) {
    return null;
  }
}

function startWatching(projectPath) {
  stopWatching();
  currentProjectPath = projectPath;
  // Point the activity record at this project. Doing it here rather than
  // only on the open-project dialog matters: at boot the project is restored
  // from the project registry, that dialog callback never runs, and every record
  // for a restored project was landing in the `app` bucket.
  activityLog.setProject(projectPath);
  if (!projectPath) return;

  // Initial snapshot so decorations paint immediately.
  pushStatus();

  // Working-tree watcher: new/edited/deleted files. Events under `.git/` are
  // ignored here because the dedicated .git watcher handles those.
  try {
    worktreeWatcher = fsSafe.safeWatch(
      projectPath,
      { recursive: true, persistent: false },
      (eventType, filename) => {
        if (isIgnoredWorktreePath(filename)) return;
        scheduleRefresh('git-worktree');
      },
      () => { worktreeWatcher = null; } // root deleted/renamed at runtime — degrade, don't crash
    );
  } catch (err) {
    console.error('gitStatusManager: worktree fs.watch failed', err);
  }

  // `.git` watcher: commit / stage / unstage / checkout / branch only ever
  // mutate files inside the git dir (index, HEAD, refs/…). In a linked
  // worktree (a workspace, workspaces spec) or a submodule `.git` is a file
  // pointing at the real git dir; that dir is watched instead, so commits and
  // stages made inside a workspace refresh the Changes panel too.
  try {
    const gitDir = resolveGitDir(projectPath);
    const stat = gitDir ? fs.statSync(gitDir) : null;
    if (stat && stat.isDirectory()) {
      gitDirWatcher = fsSafe.safeWatch(
        gitDir,
        { recursive: true, persistent: false },
        (_event, filename) => {
          // Dropped silently, exactly like the working-tree watcher drops
          // `.git`: this is scope, not a guard. Lock files and the churn our
          // own status read produces are simply not this watcher's business,
          // and recording each one would move the flood from `git status`
          // calls into the panel instead of removing it.
          if (isGitBookkeeping(filename)) return;
          scheduleRefresh('git-dir');
        },
        () => { gitDirWatcher = null; }
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

/**
 * Paths the working-tree watcher does not care about.
 *
 * `.git` is handled by the dedicated watcher below. `.frame` is Frame's own
 * artifact directory — the spec index, staged command templates and runtime
 * state are rewritten by Frame constantly, and refreshing the Changes panel
 * because Frame just refreshed its own index produces no information at all.
 * Excluding them turned a `git status` every ~270ms into a quiet watcher.
 *
 * Trade-off, accepted deliberately: a project that commits `.frame/` will see
 * real changes there reach the panel late — on the next focus, or the next
 * change anywhere else — rather than immediately.
 *
 * Pure and exported so it can be tested without standing up Electron.
 */
function isIgnoredWorktreePath(filename) {
  if (!filename) return false;
  const rel = String(filename).split(path.sep).join('/');
  if (isGitInternalPath(filename)) return true;
  return rel === '.frame' || rel.startsWith('.frame/');
}

// Coalesce bursts (a checkout or `npm install` touches many files) into a
// single git-status run.
// Two watchers feed one debounce, so the burst is attributed to whichever
// of them fired most in the window — reporting one row per raw fs event
// would drown the panel during a checkout or an npm install.
let refreshBurst = { worktree: 0, gitDir: 0 };

// How long after our own `git status` a .git event is still assumed to be
// its aftermath. Long enough to cover git's own write-out, short enough that
// a real stage/unstage from a terminal still lands in the panel.
const GIT_SELF_READ_GRACE_MS = 700;
let lastGitReadAt = 0;

/**
 * Is this .git event just bookkeeping rather than a real repository change?
 *
 * Two things qualify: lock files, which are transient and always paired with
 * the real change that follows them, and anything arriving right after our
 * own status read, which refreshes .git/index's stat cache.
 */
function isGitBookkeeping(filename) {
  const name = String(filename || '');
  if (name.endsWith('.lock')) return true;
  return Date.now() - lastGitReadAt < GIT_SELF_READ_GRACE_MS;
}

function scheduleRefresh(watcher) {
  if (watcher === 'git-dir') refreshBurst.gitDir += 1;
  else refreshBurst.worktree += 1;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const total = refreshBurst.worktree + refreshBurst.gitDir;
    activityLog.record('watch.fired', {
      watcher: refreshBurst.gitDir > refreshBurst.worktree ? 'git-dir' : 'git-worktree',
      changes: total,
      collapsed: total,
      triggered: 'refresh'
    });
    refreshBurst = { worktree: 0, gitDir: 0 };
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
    // `git status` is not read-only on disk: it refreshes .git/index's stat
    // cache and cycles index.lock. Without this stamp the .git watcher sees
    // our own read, refreshes again, and the pair spin forever — measured at
    // one fire every ~270ms for two and a half hours before the activity
    // record made it visible.
    lastGitReadAt = Date.now();

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

// Set on the first ENOENT from the git binary: no git on this machine means
// every spawn would fail identically, so short-circuit quietly instead of
// respawning (and logging) on every FS event.
let gitMissing = false;

function readGitStatus(projectPath) {
  if (gitMissing) {
    return Promise.resolve({ isRepo: false, branch: null, files: {} });
  }
  return new Promise((resolve) => {
    execFile(
      'git',
      // Never take index.lock for a read: an agent's own git write in the
      // same checkout would fail on it (see gitBranchesManager).
      ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all'],
      { cwd: projectPath, maxBuffer: MAX_BUFFER },
      (err, stdout) => {
        if (err) {
          if (isGitMissing(err, projectPath) && !gitMissing) {
            gitMissing = true;
            logger.warn('gitStatus', 'git executable not found — file-tree status decorations disabled');
          }
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

module.exports = { init, setupIPC, readGitStatus, startWatching, stopWatching, pushStatus, isIgnoredWorktreePath, gitDirFromDotGitFile, resolveGitDir };
