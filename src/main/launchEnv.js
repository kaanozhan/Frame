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
 * ── Two wrapper families, and a tool that may earn neither ──
 * POSIX gets an extensionless bash script per tool. Windows gets a `.cmd`,
 * because only `.cmd` is in the default `PATHEXT` and that is what makes a
 * bare `claude` resolve to it — but only for a tool whose CLI can take its
 * prompt as a *file path*. Without that, a batch wrapper would have to embed
 * a multi-line, backtick-bearing preamble in a language that cannot quote it,
 * and shadowing a working CLI with a script that cannot run is worse than not
 * injecting at all. `wrapperFamily` and `wrapperFileName` answer both
 * questions from one place, so no caller does its own `process.platform`
 * check.
 *
 * `supportsWrappers` keeps its narrower meaning — *does this platform get a
 * POSIX wrapper for every tool* — and is what the inline-flag branch still
 * asks. The `PATH` entry is deliberately not gated on it: leading with
 * `.frame/bin` is right wherever a wrapper of any family might land there.
 *
 * Pure: no fs, no Electron, no spawn. Paths and strings in, strings out.
 */

const path = require('path');
const { FRAME_DIR, FRAME_BIN_DIR } = require('../shared/frameConstants');

/**
 * Whether this platform gets a POSIX wrapper for every tool.
 *
 * False on Windows, where a wrapper is per-tool and conditional — see
 * `wrapperFileName`. Callers that mean "should I compose flags inline
 * instead of leaning on a wrapper" want this one.
 */
function supportsWrappers(platform = process.platform) {
  return platform !== 'win32';
}

/**
 * Which flavour of wrapper this platform runs: `'posix'` or `'cmd'`.
 *
 * Names the family, says nothing about whether a given tool gets one.
 */
function wrapperFamily(platform = process.platform) {
  return platform === 'win32' ? 'cmd' : 'posix';
}

/**
 * The filename a tool's wrapper takes here, or `''` when it gets none.
 *
 * `canPassPaths` is the tool's side of the bargain: true when its CLI accepts
 * the preamble as a file path rather than a string. POSIX does not care — a
 * bash wrapper can expand the file itself — but on Windows it is the whole
 * condition, which is why Codex and Gemini get no `.cmd` and behave there
 * exactly as they do today.
 */
function wrapperFileName(toolId, options = {}) {
  if (!toolId) return '';

  const { platform = process.platform, canPassPaths = false } = options;
  if (wrapperFamily(platform) === 'cmd') {
    return canPassPaths ? `${toolId}.cmd` : '';
  }
  return String(toolId);
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
 * Platform-blind on purpose. The old `supportsWrappers` gate here was a
 * category error — the check is about wrappers, and this function is about
 * `PATH` — and it was what kept the `;` separator below from ever being
 * reached. A `.frame/bin` that holds nothing is a harmless first entry.
 */
function prependFrameBin(pathValue, projectPath, platform = process.platform) {
  const current = pathValue == null ? '' : String(pathValue);

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
  wrapperFamily,
  wrapperFileName,
  frameBinDir,
  prependFrameBin
};
