/**
 * frameStore — the single seam between Frame and its stored artifacts.
 *
 * Every Frame meta artifact (tasks, notes, structure map, quickstart, project
 * config, the project instruction layer) is read and written through here.
 * The surface is deliberately *data*, not paths: `readTasks(projectPath)`,
 * `writeNotes(projectPath, text)`. Where those bytes physically live —
 * today `<project>/.frame/<file>` — is this module's private business.
 *
 * Why data and not a path helper: a later spec moves Frame's artifacts out of
 * the working tree entirely, into a Frame-owned store keyed by user and
 * project. With this shape that is a new backend behind these functions and
 * no caller changes. A `getTasksFilePath()` that every caller then joins and
 * `fs`-reads itself would force all of them to be reopened a second time.
 *
 * ── Paths, for the minority that genuinely needs a file ──
 * `fs.watch` watchers, the scripts under `.frame/bin/`, and anything handed to
 * an AI tool to open cannot work with data — they need a real path. Those use
 * the separately named `…Path(projectPath)` entries below. The split is not
 * extra machinery (while `.frame/` is the store a path is trivially
 * available); it exists so the set of "must be a real file on disk" call sites
 * stays visible in the code instead of having to be rediscovered the day the
 * store stops being files.
 *
 * ── Legacy ──
 * This module never reads or writes the pre-overlay root layout. A project
 * carrying a root `tasks.json` and no `.frame/tasks.json` reads here as empty;
 * recognizing that state is `instructionDiscovery`'s job, and moving the files
 * is the `embedded-migration` spec's.
 */

const fs = require('fs');
const path = require('path');
const fsSafe = require('./fsSafe');
const { FRAME_DIR, FRAME_META_FILES } = require('../shared/frameConstants');

/**
 * Resolve one of the FRAME_META_FILES identifiers (posix, repo-relative)
 * against a project root. The split/join is what keeps those identifiers
 * portable — they are written with `/` and land as native separators here.
 */
function resolve(projectPath, relative) {
  return path.join(projectPath, ...relative.split('/'));
}

function ensureFrameDir(projectPath) {
  const dir = path.join(projectPath, FRAME_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Paths (the file-needing minority) ────────────────────────

function frameDirPath(projectPath) {
  return path.join(projectPath, FRAME_DIR);
}

function tasksPath(projectPath) {
  return resolve(projectPath, FRAME_META_FILES.TASKS);
}

function structurePath(projectPath) {
  return resolve(projectPath, FRAME_META_FILES.STRUCTURE);
}

function notesPath(projectPath) {
  return resolve(projectPath, FRAME_META_FILES.NOTES);
}

function quickstartPath(projectPath) {
  return resolve(projectPath, FRAME_META_FILES.QUICKSTART);
}

function configPath(projectPath) {
  return resolve(projectPath, FRAME_META_FILES.CONFIG);
}

function agentsPath(projectPath) {
  return resolve(projectPath, FRAME_META_FILES.AGENTS);
}

// ─── Primitives ───────────────────────────────────────────────

/**
 * Read a JSON artifact, preserving fsSafe's recovery envelope
 * (`{ data, source, error }`) rather than flattening it. Callers need the
 * difference between "missing" (fresh project), "recovered from .bak" (tell
 * the user) and "unrecoverable" (error state) — collapsing those to
 * `data || null` is exactly the silent failure tasksManager had to grow out
 * of, so the envelope travels through the seam intact.
 */
function readJson(filePath) {
  return fsSafe.readJsonWithRecovery(filePath);
}

/** Write a JSON artifact atomically, creating `.frame/` on first write. */
function writeJson(projectPath, filePath, value) {
  ensureFrameDir(projectPath);
  fsSafe.writeFileAtomic(filePath, JSON.stringify(value, null, 2));
}

/** Read a text artifact. Missing file → `null`, never a throw. */
function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** Write a text artifact atomically, creating `.frame/` on first write. */
function writeText(projectPath, filePath, text) {
  ensureFrameDir(projectPath);
  fsSafe.writeFileAtomic(filePath, text);
}

// ─── Data API ─────────────────────────────────────────────────

function readTasks(projectPath) {
  return readJson(tasksPath(projectPath));
}

function writeTasks(projectPath, data) {
  writeJson(projectPath, tasksPath(projectPath), data);
}

function readStructure(projectPath) {
  return readJson(structurePath(projectPath));
}

function writeStructure(projectPath, data) {
  writeJson(projectPath, structurePath(projectPath), data);
}

function readConfig(projectPath) {
  return readJson(configPath(projectPath));
}

function writeConfig(projectPath, data) {
  writeJson(projectPath, configPath(projectPath), data);
}

function readNotes(projectPath) {
  return readText(notesPath(projectPath));
}

function writeNotes(projectPath, text) {
  writeText(projectPath, notesPath(projectPath), text);
}

function readQuickstart(projectPath) {
  return readText(quickstartPath(projectPath));
}

function writeQuickstart(projectPath, text) {
  writeText(projectPath, quickstartPath(projectPath), text);
}

/**
 * The project instruction layer. Legitimately absent in most projects —
 * Frame's generic instructions live once in user-scoped storage, and this
 * file appears only when a project has genuinely project-specific Frame
 * context to record.
 */
function readAgents(projectPath) {
  return readText(agentsPath(projectPath));
}

function writeAgents(projectPath, text) {
  writeText(projectPath, agentsPath(projectPath), text);
}

/** Does this project have Frame artifacts at all? */
function hasFrameDir(projectPath) {
  return fs.existsSync(frameDirPath(projectPath));
}

module.exports = {
  // data
  readTasks,
  writeTasks,
  readStructure,
  writeStructure,
  readConfig,
  writeConfig,
  readNotes,
  writeNotes,
  readQuickstart,
  writeQuickstart,
  readAgents,
  writeAgents,
  hasFrameDir,
  ensureFrameDir,
  // paths — watchers, .frame/bin/ scripts, files handed to an AI tool
  frameDirPath,
  tasksPath,
  structurePath,
  notesPath,
  quickstartPath,
  configPath,
  agentsPath
};
