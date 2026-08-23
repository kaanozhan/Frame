/**
 * gitSharing — is Frame's context shared with the repo, or local to this machine?
 *
 * One setting (`settings.gitSharing` in `.frame/config.json`) with two values,
 * and everything that follows from it:
 *
 *   repo  — `.frame/` is meant to be committed. No git exclusion; the managed
 *           block in `.frame/.gitignore` keeps machine-local classes out; hook
 *           entries live in `.claude/settings.json` (shared with the team).
 *   local — Frame's files exist for this user only. `.frame/` and the pointer
 *           are excluded via `.git/info/exclude` (never the tracked
 *           `.gitignore`) while `.frame/` is untracked; hook entries move to
 *           `.claude/settings.local.json`.
 *
 * Frame never runs `git rm`. If `.frame/` is already tracked and the user
 * picks `local`, the mode is stored, the exclusion is skipped (excluding
 * tracked files makes them vanish on a teammate's clone) and a warning with
 * the exact command is handed to the UI. Untracking someone's committed files
 * is their call, not ours.
 */

const fs = require('fs');
const path = require('path');
const frameStore = require('./frameStore');
const gitExclude = require('./gitExclude');
const templates = require('../shared/frameTemplates');
const { FRAME_DIR, FRAME_GITIGNORE_FILE } = require('../shared/frameConstants');

const MODES = ['repo', 'local'];
const DEFAULT_MODE = 'repo';

let activityLog = null;

/** Wired from index.js so mode changes land in the activity record. */
function init({ activityLog: log } = {}) {
  activityLog = log || null;
}

function record(event, fields) {
  try {
    if (activityLog) activityLog.record(event, fields);
  } catch (err) {
    /* bookkeeping never breaks a settings write */
  }
}

function normalizeMode(mode) {
  return MODES.includes(mode) ? mode : DEFAULT_MODE;
}

/** The mode a project is in (defaulting to `repo` for configs written before it). */
function getMode(projectPath) {
  const config = frameStore.readConfig(projectPath);
  return normalizeMode(config && config.settings && config.settings.gitSharing);
}

/** Which Claude settings file this mode's hook entries belong in. */
function hookFileFor(mode) {
  return normalizeMode(mode) === 'local' ? 'settings.local.json' : 'settings.json';
}

/**
 * Write (or refresh) the managed block in `.frame/.gitignore`. Lines the user
 * added outside the markers survive; the block itself is regenerated from the
 * file classes, so a Frame upgrade that adds a runtime directory reaches every
 * project the next time this runs.
 */
function ensureFrameGitignore(projectPath) {
  const file = path.join(projectPath, FRAME_DIR, FRAME_GITIGNORE_FILE);
  const block = templates.getFrameGitignoreBlock();

  let existing = '';
  try {
    existing = fs.readFileSync(file, 'utf8');
  } catch (err) {
    /* first write */
  }

  // Same marker-block surgery as the exclude file: whole-line marker match,
  // CRLF tolerated, a file that does not end in a newline gets one.
  const { head, tail } = gitExclude.splitBlock(existing, {
    start: templates.FRAME_GITIGNORE_MARKER_START,
    end: templates.FRAME_GITIGNORE_MARKER_END
  });
  const headText = head.length > 0 && !head.endsWith('\n') ? `${head}\n` : head;
  const next = headText + block + tail;

  if (next === existing) return { changed: false, file };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next, 'utf8');
  return { changed: true, file };
}

/**
 * What the UI needs to render the control: the current mode, whether `.frame/`
 * is tracked, and the warning (with command) when those two disagree.
 */
function getState(projectPath) {
  const mode = getMode(projectPath);
  const inGit = gitExclude.isGitRepo(projectPath);
  const tracked = inGit ? gitExclude.isFrameTracked(projectPath) : false;

  let warning = null;
  if (mode === 'local' && tracked) {
    warning = `.frame/ is already committed, so it stays visible in git. To make it local, untrack it yourself: git rm -r --cached ${FRAME_DIR}`;
  } else if (mode === 'local' && !inGit) {
    warning = 'Not a git repository — nothing to exclude, but Frame keeps its files out of the way all the same.';
  }

  return { mode, tracked, inGit, warning, hookFile: hookFileFor(mode) };
}

/**
 * Apply a mode: store it, move Frame's hook entries to the file that mode
 * uses, refresh `.frame/.gitignore`, and add or remove the exclude block.
 * Returns the same shape as getState() so the caller can re-render directly.
 */
function setMode(projectPath, requestedMode) {
  const mode = normalizeMode(requestedMode);
  const previous = getMode(projectPath);

  // A config that is not an object (an array, a bare string, `null`) is a
  // broken file, not a project to reconfigure — writing `settings` onto it
  // would throw or corrupt it further.
  const config = frameStore.readConfig(projectPath);
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { ...getState(projectPath), error: 'not a Frame project' };
  }
  // Written only on a real change: reconcile() runs on every project open and
  // has no business rewriting config.json (and its .bak) each time.
  if (!config.settings || typeof config.settings !== 'object' || config.settings.gitSharing !== mode) {
    config.settings = (config.settings && typeof config.settings === 'object') ? config.settings : {};
    config.settings.gitSharing = mode;
    frameStore.writeConfig(projectPath, config);
  }

  ensureFrameGitignore(projectPath);

  // Hook entries follow the mode: added to the new file, taken out of the old
  // one. Lazy require — frameProject requires this module's siblings and we
  // must not build a cycle at load time.
  const frameProject = require('./frameProject');
  const target = hookFileFor(mode);
  const other = hookFileFor(mode === 'local' ? 'repo' : 'local');
  // The install can decline (another tool is active, unparseable settings) and
  // the caller needs to know — it is how the UI reports "hooks need a hand".
  const hooks = frameProject.installSpecHintHook(projectPath, { file: target });
  frameProject.removeSpecHintHook(projectPath, { file: other });

  const exclude = mode === 'local'
    ? gitExclude.ensureExcluded(projectPath)
    : gitExclude.removeExcluded(projectPath);

  if (mode !== previous) {
    record('sharing.mode_changed', { from: previous, to: mode });
  }

  return { ...getState(projectPath), applied: exclude, hooks };
}

/**
 * Re-apply the stored mode. Called on project open and after migration: the
 * exclude block is conditional on tracked state, which changes behind Frame's
 * back the moment someone commits `.frame/`.
 */
function reconcile(projectPath) {
  if (!frameStore.readConfig(projectPath)) return null;
  return setMode(projectPath, getMode(projectPath));
}

module.exports = {
  init,
  getMode,
  setMode,
  getState,
  reconcile,
  hookFileFor,
  ensureFrameGitignore,
  MODES,
  DEFAULT_MODE
};
