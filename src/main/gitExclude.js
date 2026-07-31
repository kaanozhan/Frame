/**
 * gitExclude — keep `.frame/` out of git without touching the tracked tree.
 *
 * Frame's default is zero-touch: open any repository, use Frame for a full
 * session, and `git status` still reports nothing. The only place that can be
 * arranged without editing a tracked file is `.git/info/exclude` — per-clone,
 * never committed, invisible to everyone else. The project's `.gitignore` is
 * off limits; it belongs to the repo, not to us.
 *
 * ── Why the entry is conditional ──
 * An exclude entry only hides *untracked* files, and that is exactly the trap.
 * A team that opts in by committing `.frame/` still has the entry sitting in
 * every clone — so every *new* file under `.frame/` (a fresh spec folder, a
 * new report) stays invisible in `git status` and the team silently drifts
 * apart. So the rule is: write the line only while `.frame/` is untracked, and
 * remove the line we previously wrote the moment any `.frame/` path is tracked.
 * Opting in is therefore just "commit `.frame/`" — this notices on the next
 * open, on every machine, and gets out of the way.
 *
 * The entry is signed so we only ever remove our own; a hand-written
 * `.frame/` rule, or anything else in the file, is left exactly as found.
 *
 * ── Why a two-line block and not one signed line ──
 * gitignore syntax has no trailing comments. `.frame/ # managed by Frame`
 * is not an excluded directory with a note attached — it is a literal pattern
 * that matches nothing, so the entry would look right in the file and hide
 * nothing at all. The signature therefore goes on its own comment line above
 * the pattern, and the two are added and removed together.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { FRAME_DIR } = require('../shared/frameConstants');

const MARKER = 'managed by Frame';
const PATTERN = `${FRAME_DIR}/`;
const COMMENT = `# ${MARKER} — removed automatically when ${FRAME_DIR}/ is committed`;
const EXCLUDE_BLOCK = `${COMMENT}\n${PATTERN}`;

function git(projectPath, args) {
  return execFileSync('git', args, {
    cwd: projectPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
}

/**
 * Absolute path of this working tree's exclude file, or null outside a repo.
 *
 * `git rev-parse --git-path` rather than `<root>/.git/info/exclude`: in a
 * linked worktree `.git` is a file pointing elsewhere, and in a submodule the
 * git dir lives under the superproject. Asking git is the only resolution
 * that is right in all three.
 */
function excludeFilePath(projectPath) {
  try {
    const raw = git(projectPath, ['rev-parse', '--git-path', 'info/exclude']).trim();
    if (!raw) return null;
    return path.isAbsolute(raw) ? raw : path.join(projectPath, raw);
  } catch (_) {
    return null; // not a git repository — nothing to exclude from
  }
}

/** Is any path under `.frame/` tracked in this repo? */
function isFrameTracked(projectPath) {
  try {
    return git(projectPath, ['ls-files', '--cached', '--', `${FRAME_DIR}/`]).trim().length > 0;
  } catch (_) {
    return false;
  }
}

/**
 * Strip every trace of ours from `lines`: the signed comment plus the pattern
 * directly beneath it, and — for files written by an earlier Frame — the
 * broken single-line form that carried the marker as a trailing comment.
 *
 * Returns `{ kept, found }`. An unsigned `.frame/` that nobody claimed is
 * left alone; it is someone else's rule.
 */
function stripOurs(lines) {
  const kept = [];
  let found = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('#') && trimmed.includes(MARKER)) {
      found = true;
      if (lines[i + 1] !== undefined && lines[i + 1].trim() === PATTERN) i += 1;
      continue;
    }

    // Pre-block form: `.frame/ # managed by Frame …` on one line.
    if (trimmed.includes(MARKER) && trimmed.startsWith(PATTERN)) {
      found = true;
      continue;
    }

    kept.push(line);
  }

  return { kept, found };
}

function readLines(excludePath) {
  try {
    const raw = fs.readFileSync(excludePath, 'utf8');
    return { lines: raw.split('\n'), existed: true };
  } catch (err) {
    if (err.code === 'ENOENT') return { lines: [], existed: false };
    throw err;
  }
}

/**
 * Write `lines` back, preserving the file's trailing-newline convention and
 * leaving every foreign line byte-identical.
 */
function writeLines(excludePath, lines) {
  fs.mkdirSync(path.dirname(excludePath), { recursive: true });
  let out = lines.join('\n');
  if (out.length && !out.endsWith('\n')) out += '\n';
  fs.writeFileSync(excludePath, out, 'utf8');
}

/**
 * Bring the exclude file to the state the repo currently calls for.
 *
 * `mode` is the project's declared git-sharing mode, resolved by the caller —
 * this module stays ignorant of where it is stored. `'repo'` means the block
 * must never exist: nothing is written and a previously written block is
 * stripped. `'local'` or absent keeps the conditional logic below, where a
 * tracked `.frame/` still removes the block whatever was declared — an
 * exclude entry only hides untracked files, so honouring `'local'` on a
 * tracked repo would silently hide every new file while the old ones stay
 * visible.
 *
 * Idempotent and self-healing — safe to call on every project open. Returns
 * one of:
 *   'no-repo'    — not a git repository, nothing done
 *   'added'      — our line was written
 *   'removed'    — our line is gone (`.frame/` tracked, or repo mode)
 *   'unchanged'  — already in the right state
 *   'error'      — the exclude file could not be read or written
 */
function ensure(projectPath, mode) {
  if (!projectPath) return 'no-repo';

  const excludePath = excludeFilePath(projectPath);
  if (!excludePath) return 'no-repo';

  try {
    const { lines } = readLines(excludePath);
    const tracked = isFrameTracked(projectPath);
    const { kept, found } = stripOurs(lines);

    if (tracked || mode === 'repo') {
      if (!found) return 'unchanged';
      writeLines(excludePath, kept);
      return 'removed';
    }

    const current = lines.join('\n');
    if (found && current.includes(EXCLUDE_BLOCK)) return 'unchanged';

    // Absent, duplicated, or written by an older Frame in the broken
    // single-line form — collapse to exactly one current block at the end.
    while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
    kept.push(COMMENT, PATTERN);
    writeLines(excludePath, kept);
    return 'added';
  } catch (err) {
    console.error('gitExclude: could not update info/exclude:', err.message);
    return 'error';
  }
}

module.exports = { ensure, excludeFilePath, isFrameTracked, EXCLUDE_BLOCK, MARKER };
