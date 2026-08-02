/**
 * launchEnv — where Frame's own `PATH` entry comes from.
 *
 * Since the overlay, an agent learns about Frame at launch, and until now only
 * a launch Frame *composed* carried that context: a user typing `claude` in
 * Frame's own terminal got the bare CLI. The fix is to put `.frame/bin` first
 * on the `PATH` of every process Frame spawns, so a hand-typed tool resolves
 * to the same wrapper a dispatch uses.
 *
 * ── Scoped to Frame's children ──
 * The entry lives in the environment of a PTY Frame spawns. Nothing
 * machine-wide is mutated and nothing is written outside `.frame/`, which is
 * what makes this available where a shell-rc line or a `~/.claude/CLAUDE.md`
 * block was not (see the terminal-context-boundary spec). There is
 * correspondingly nothing to undo when Frame is uninstalled.
 *
 * ── POSIX only, for now ──
 * Frame's wrappers are bash scripts. On Windows there is nothing runnable to
 * put on `PATH`, and shadowing a working CLI with a script that cannot run is
 * worse than not injecting at all — so `supportsWrappers()` gates every caller
 * from one place rather than each doing its own `process.platform` check.
 *
 * Pure: no fs, no Electron, no spawn. Paths and strings in, strings out.
 */

const path = require('path');
const { FRAME_DIR, FRAME_BIN_DIR } = require('../shared/frameConstants');

/**
 * Whether this platform can run the wrappers Frame writes.
 *
 * The single gate for `PATH` injection and wrapper generation alike: when it
 * is false Frame falls back to composing flags inline, which is exactly the
 * behaviour Windows had before this module existed.
 */
function supportsWrappers(platform = process.platform) {
  return platform !== 'win32';
}

/**
 * Absolute path to a project's `.frame/bin`, or '' without a project.
 *
 * Not created here — writing it is `aiToolManager`'s job. This module only
 * says where it is.
 */
function frameBinDir(projectPath) {
  if (!projectPath) return '';
  return path.join(projectPath, FRAME_DIR, FRAME_BIN_DIR);
}

/**
 * `pathValue` with the project's `.frame/bin` in front.
 *
 * Idempotent by design: a PTY can be re-spawned many times in a session (and
 * inherits an env that may already carry the entry), and a `PATH` that grew a
 * duplicate on every respawn would be a slow leak nobody would look for. A
 * value that already leads with the directory is returned untouched.
 *
 * Returns the input unchanged where Frame writes no wrappers, so callers need
 * no platform branch of their own.
 */
function prependFrameBin(pathValue, projectPath, platform = process.platform) {
  const current = pathValue == null ? '' : String(pathValue);
  if (!supportsWrappers(platform)) return current;

  const binDir = frameBinDir(projectPath);
  if (!binDir) return current;

  const sep = platform === 'win32' ? ';' : ':';
  const entries = current.split(sep);
  if (entries[0] === binDir) return current;

  // Anywhere but first is not good enough — a real `claude` earlier on the
  // path would win and the session would silently lose Frame's context. Drop
  // any later copy so re-prepending moves it rather than duplicating it.
  const rest = entries.filter((entry) => entry && entry !== binDir);
  return [binDir, ...rest].join(sep);
}

module.exports = {
  supportsWrappers,
  frameBinDir,
  prependFrameBin
};
