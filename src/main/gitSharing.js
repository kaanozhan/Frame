/**
 * gitSharing — the one owner of a project's Git Sharing mode.
 *
 * `settings.gitSharing: "local" | "repo"` lives in `.frame/config.json` (D1),
 * so in repo mode the declaration is itself committed and travels with the
 * repository. This module composes `gitExclude` (which stays ignorant of the
 * config format — `frameProject → gitSharing → gitExclude` is one-way) and
 * maintains `.frame/.gitignore`, the signed list of machine-local paths that
 * makes sharing safe: a teammate who clones a repo-mode project inherits the
 * protection before Frame has ever run on their machine.
 *
 * Declared and effective mode are two different things (D3): a tracked
 * `.frame/` makes the effective mode `repo` whatever the config says, because
 * an exclude entry only hides untracked files and honouring `local` there
 * would silently hide every new file while the old ones stay visible.
 *
 * Never touches the git index: no staging, no commits, no `git rm`. Turning
 * sharing on removes the exclude block and nothing else — committing is the
 * user's move.
 *
 * Electron-free on purpose, so it tests under `node --test` like gitExclude.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const gitExclude = require('./gitExclude');
const { FRAME_DIR, FRAME_CONFIG_FILE } = require('../shared/frameConstants');

const MODES = ['local', 'repo'];

// ─── .frame/.gitignore — the machine-local manifest ───────────
//
// Everything here is generated or derived: committing it would put churn in
// files nobody edits (bin/, orchestration/) or absolute local paths in the
// repo (worktrees/, runtime/). The fsSafe suffixes keep crash-safety
// artifacts (tasks.json.bak and friends) out of repo-mode projects too.
// `bin/` is listed whole, not `bin/*.js` — every file in it is generated.
// `migration-backup/` holds the copy the layout migration takes of every root
// file it removes: without this line a repo-mode project would commit a
// duplicate of each file the same commit deletes.
const MACHINE_LOCAL_PATHS = [
  'runtime/',
  'index/',
  'migration-backup/',
  'implement-permissions.json',
  'worktrees/',
  'orchestration/',
  'bin/',
  '*.bak',
  '*.tmp',
  '*.corrupt-*'
];

const GITIGNORE_BEGIN = `# managed by Frame — machine-local paths, rewritten by Frame; add your own lines outside this block`;
const GITIGNORE_END = `# end managed by Frame`;
const GITIGNORE_BLOCK = [GITIGNORE_BEGIN, ...MACHINE_LOCAL_PATHS, GITIGNORE_END].join('\n');

function git(projectPath, args) {
  return execFileSync('git', args, {
    cwd: projectPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
}

function isGitRepo(projectPath) {
  return Boolean(projectPath) && gitExclude.excludeFilePath(projectPath) !== null;
}

function configPath(projectPath) {
  return path.join(projectPath, FRAME_DIR, FRAME_CONFIG_FILE);
}

/** Parsed `.frame/config.json`, or null when absent/unreadable. */
function readConfig(projectPath) {
  try {
    return JSON.parse(fs.readFileSync(configPath(projectPath), 'utf8'));
  } catch (_) {
    return null;
  }
}

/** Read-modify-write preserving every unknown key (the detectProject precedent). */
function writeConfig(projectPath, config) {
  fs.writeFileSync(configPath(projectPath), JSON.stringify(config, null, 2), 'utf8');
}

function declaredMode(config) {
  const value = config && config.settings && config.settings.gitSharing;
  return MODES.includes(value) ? value : null;
}

/**
 * The declared mode, derived once and persisted when absent (D4):
 * a pre-upgrade project keeps exactly the behaviour it already had —
 * tracked `.frame/` → `repo`, untracked → `local`.
 *
 * Returns `'local' | 'repo' | null` — null outside a git repo (no mode to
 * derive) or when the project has no `.frame/config.json` to persist into.
 */
function resolveMode(projectPath) {
  if (!isGitRepo(projectPath)) return null;

  const config = readConfig(projectPath);
  if (!config) return null;

  const declared = declaredMode(config);
  if (declared) return declared;

  const derived = gitExclude.isFrameTracked(projectPath) ? 'repo' : 'local';
  config.settings = config.settings || {};
  config.settings.gitSharing = derived;
  writeConfig(projectPath, config);
  return derived;
}

/**
 * The full sharing state for the UI's behaviour matrix.
 *
 * `effective` implements D3: tracked → `'repo'` regardless of `declared`;
 * the S4 warning renders exactly when `declared === 'local' && tracked`.
 * Works without `.frame/` existing (the init modal asks before init).
 */
function getState(projectPath) {
  if (!isGitRepo(projectPath)) {
    return { isRepo: false, declared: declaredMode(readConfig(projectPath)), tracked: false, effective: null };
  }

  const declared = resolveMode(projectPath);
  const tracked = gitExclude.isFrameTracked(projectPath);
  const effective = tracked ? 'repo' : declared;
  return { isRepo: true, declared, tracked, effective };
}

/**
 * The single write path for a mode change — the modal toggle and the sharing
 * hint both land here. Config write → exclude block per the new mode →
 * `.frame/.gitignore` refresh. Never touches the index (C1/C2): going
 * local on a tracked project writes the declaration and stops — the caller
 * shows the S4 warning with the `git rm -r --cached .frame` command.
 */
function setMode(projectPath, mode) {
  if (!MODES.includes(mode)) {
    return { success: false, error: `invalid mode: ${mode}` };
  }
  const config = readConfig(projectPath);
  if (!config) {
    return { success: false, error: 'not a Frame project' };
  }

  config.settings = config.settings || {};
  config.settings.gitSharing = mode;
  writeConfig(projectPath, config);

  gitExclude.ensure(projectPath, mode);
  writeFrameGitignore(projectPath);

  return { success: true, state: getState(projectPath) };
}

/**
 * The project-open path: resolve (deriving and persisting on first sight of
 * a pre-upgrade project), bring the exclude file in line, and make sure
 * `.frame/.gitignore` exists — which is how existing projects gain it.
 * Replaces the bare `gitExclude.ensure` call. Safe on any input.
 */
function ensureOnOpen(projectPath) {
  const mode = resolveMode(projectPath);
  gitExclude.ensure(projectPath, mode || undefined);
  writeFrameGitignore(projectPath);
  return getState(projectPath);
}

/**
 * Write the signed machine-local block into `.frame/.gitignore`.
 *
 * Rewrites replace only our block — everything outside the begin/end
 * markers is preserved byte-identical, the `stripOurs` discipline. No-op
 * when `.frame/` doesn't exist: this module never creates the overlay dir.
 * Returns 'written' | 'unchanged' | 'no-frame' | 'error'.
 */
function writeFrameGitignore(projectPath) {
  if (!projectPath) return 'no-frame';
  const frameDir = path.join(projectPath, FRAME_DIR);
  if (!fs.existsSync(frameDir)) return 'no-frame';

  const file = path.join(frameDir, '.gitignore');
  try {
    let lines = [];
    try {
      lines = fs.readFileSync(file, 'utf8').split('\n');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    // Strip our block: from a begin marker through the matching end marker
    // (or, for a truncated file, through the last consecutive non-empty line).
    const kept = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].trim() === GITIGNORE_BEGIN.trim() || (lines[i].trim().startsWith('#') && lines[i].includes('managed by Frame') && !lines[i].includes('end'))) {
        while (i + 1 < lines.length && lines[i + 1].trim() !== GITIGNORE_END && lines[i + 1].trim() !== '') i += 1;
        if (i + 1 < lines.length && lines[i + 1].trim() === GITIGNORE_END) i += 1;
        continue;
      }
      kept.push(lines[i]);
    }

    while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
    const next = kept.length ? [...kept, '', GITIGNORE_BLOCK] : [GITIGNORE_BLOCK];
    let out = next.join('\n');
    if (!out.endsWith('\n')) out += '\n';

    let current = null;
    try {
      current = fs.readFileSync(file, 'utf8');
    } catch (_) { /* absent */ }
    if (current === out) return 'unchanged';

    fs.writeFileSync(file, out, 'utf8');
    return 'written';
  } catch (err) {
    console.error('gitSharing: could not write .frame/.gitignore:', err.message);
    return 'error';
  }
}

module.exports = {
  getState,
  resolveMode,
  setMode,
  ensureOnOpen,
  writeFrameGitignore,
  MACHINE_LOCAL_PATHS,
  GITIGNORE_BLOCK
};
