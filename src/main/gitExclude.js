/**
 * gitExclude — Frame's marker block in `.git/info/exclude`
 *
 * Sharing mode `local` means "Frame's files exist for me, not for the repo":
 * `.frame/` and `.claude/rules/frame.md` are excluded so `git status` shows
 * nothing Frame made. The exclusion goes in `.git/info/exclude`, never in the
 * tracked `.gitignore` — a local preference must not become a commit that
 * hides Frame's files from everyone else.
 *
 * Three properties this module exists to guarantee:
 *
 *   • **Conditional.** The block is present only while `.frame/` is untracked.
 *     The moment any `.frame/` path is committed, exclusion would make the
 *     tracked files invisible on a teammate's clone, so it is removed —
 *     committing `.frame/` is the whole opt-in to sharing.
 *   • **Anchored and prefixed.** Entries are `/.frame/`, not `.frame/`, so a
 *     monorepo's other `.frame/` directories are unaffected; in a project that
 *     is a sub-directory of its repo, the entry carries `show-prefix`.
 *   • **Ours only.** Everything outside the markers is the user's and is
 *     rewritten byte-for-byte.
 *
 * Outside a git repo every function is a no-op that says so. Paths come from
 * `git rev-parse --git-path info/exclude`, which is correct for linked
 * worktrees (where `.git` is a file, not a directory).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { FRAME_DIR, CLAUDE_RULE_PATH } = require('../shared/frameConstants');

const MARKER_START = '# >>> frame (managed) >>>';
const MARKER_END = '# <<< frame (managed) <<<';

/** Run a git command in the project, returning trimmed stdout or null. */
function git(projectPath, args) {
  try {
    return execFileSync('git', args, {
      cwd: projectPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch (err) {
    return null;
  }
}

function isGitRepo(projectPath) {
  return git(projectPath, ['rev-parse', '--is-inside-work-tree']) === 'true';
}

/**
 * Absolute path of the exclude file for this project's repository. `git-path`
 * resolves it for linked worktrees and `.git` files too, where joining
 * `.git/info/exclude` by hand would land nowhere.
 */
function excludeFilePath(projectPath) {
  const p = git(projectPath, ['rev-parse', '--git-path', 'info/exclude']);
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.join(projectPath, p);
}

/**
 * The project's path relative to the repository root, with a trailing slash
 * ('' when the project *is* the root). Exclude patterns are repo-relative, so
 * a project in `apps/web/` must exclude `/apps/web/.frame/`.
 */
function repoPrefix(projectPath) {
  const prefix = git(projectPath, ['rev-parse', '--show-prefix']);
  return prefix || '';
}

/** The anchored entries Frame excludes, in block order. */
function entriesFor(projectPath) {
  const prefix = repoPrefix(projectPath);
  return [`/${prefix}${FRAME_DIR}/`, `/${prefix}${CLAUDE_RULE_PATH}`];
}

/** True when any `.frame/` path in this project is tracked by git. */
function isFrameTracked(projectPath) {
  const listed = git(projectPath, ['ls-files', '--cached', '--', `${FRAME_DIR}/`]);
  return Boolean(listed);
}

/**
 * Split a file's text into { head, tail } around Frame's block. Returns the
 * whole text as `head` when no block is present.
 */
function splitBlock(text) {
  const start = text.indexOf(MARKER_START);
  if (start === -1) return { head: text, tail: '', found: false };
  const endMarker = text.indexOf(MARKER_END, start);
  const end = endMarker === -1 ? text.length : endMarker + MARKER_END.length;
  let tail = text.slice(end);
  if (tail.startsWith('\n')) tail = tail.slice(1);
  return { head: text.slice(0, start), tail, found: true };
}

function readExclude(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    return '';
  }
}

/**
 * Put Frame's block in the exclude file (idempotent). Refuses — and removes
 * an existing block — when `.frame/` is tracked, because excluding tracked
 * files is how they go invisible on someone else's clone.
 */
function ensureExcluded(projectPath) {
  if (!isGitRepo(projectPath)) return { applied: false, reason: 'not a git repository' };

  if (isFrameTracked(projectPath)) {
    const removal = removeExcluded(projectPath);
    return {
      applied: false,
      tracked: true,
      removed: removal.removed,
      reason: '.frame/ is tracked — exclusion would hide committed files'
    };
  }

  const file = excludeFilePath(projectPath);
  if (!file) return { applied: false, reason: 'could not resolve info/exclude' };

  const existing = readExclude(file);
  const { head, tail } = splitBlock(existing);
  const block = `${MARKER_START}\n${entriesFor(projectPath).join('\n')}\n${MARKER_END}\n`;
  const headText = head.length > 0 && !head.endsWith('\n') ? head + '\n' : head;
  const next = headText + block + tail;

  if (next === existing) return { applied: true, changed: false, file };

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next, 'utf8');
  return { applied: true, changed: true, file };
}

/** Take Frame's block back out, leaving every user line untouched. */
function removeExcluded(projectPath) {
  if (!isGitRepo(projectPath)) return { removed: false, reason: 'not a git repository' };

  const file = excludeFilePath(projectPath);
  if (!file) return { removed: false, reason: 'could not resolve info/exclude' };

  const existing = readExclude(file);
  const { head, tail, found } = splitBlock(existing);
  if (!found) return { removed: false, file };

  fs.writeFileSync(file, head + tail, 'utf8');
  return { removed: true, file };
}

/** Whether Frame's block is currently in the exclude file. */
function hasBlock(projectPath) {
  const file = excludeFilePath(projectPath);
  if (!file) return false;
  return readExclude(file).includes(MARKER_START);
}

module.exports = {
  ensureExcluded,
  removeExcluded,
  hasBlock,
  isFrameTracked,
  isGitRepo,
  excludeFilePath,
  entriesFor,
  MARKER_START,
  MARKER_END
};
