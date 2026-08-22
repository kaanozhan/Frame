/**
 * frameStore — the one module that knows where a project's meta files live.
 *
 * Frame is moving its meta files off the project root and into `.frame/`.
 * Projects initialized before that keep the root layout until the user
 * consents to migrate, so both layouts have to work at once. Every read and
 * write of AGENTS.md / PROJECT_NOTES.md / QUICKSTART.md / STRUCTURE.json /
 * tasks.json goes through here; no other module joins those paths.
 *
 * Resolution rule (mirrored by the .frame/bin scripts):
 *
 *   overlay = <project>/.frame/<name>
 *   exists(overlay)                                  → overlay
 *   config.files record AND exists(<project>/<name>)  → root  (legacy)
 *   otherwise                                        → overlay
 *
 * The `config.files` record is Frame's own init signature and the only
 * accepted legacy fingerprint — a CLAUDE.md symlink alone is a public
 * convention, not proof. The last line is what makes a file Frame creates
 * *today* land in `.frame/` even in a project that has not migrated yet.
 *
 * `.frame/config.json` itself is never resolved: it has always lived in
 * `.frame/`, and it is the record the rule reads.
 *
 * Files are the source of truth. Every read hits disk — agents edit these
 * files with their own tools and Frame must see the result immediately — so
 * there is no write-behind cache here. Writes go through fsSafe
 * (tmp + fsync + rename, with a `.bak` of the previous copy), which is what
 * tasksManager has always done for tasks.json.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fsSafe = require('./fsSafe');
const { IPC } = require('../shared/ipcChannels');
const { FRAME_DIR, FRAME_CONFIG_FILE, FRAME_FILES } = require('../shared/frameConstants');

// ─── Config ───────────────────────────────────────────────────

function configPath(projectPath) {
  return path.join(projectPath, FRAME_DIR, FRAME_CONFIG_FILE);
}

/**
 * Read `.frame/config.json`. Returns null when it is missing or unreadable —
 * "not a Frame project (yet)" is a normal answer here, not an error.
 */
function readConfig(projectPath) {
  try {
    return JSON.parse(fs.readFileSync(configPath(projectPath), 'utf8'));
  } catch (err) {
    return null;
  }
}

/** Write `.frame/config.json` atomically. Throws on failure, like fsSafe. */
function writeConfig(projectPath, config) {
  const target = configPath(projectPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fsSafe.writeFileAtomic(target, JSON.stringify(config, null, 2));
}

/**
 * The names a legacy project recorded at init. Empty for a project written
 * by the overlay-era templates (they stopped emitting the record).
 */
function legacyFileNames(projectPath) {
  const config = readConfig(projectPath);
  if (!config || !config.files || typeof config.files !== 'object') return [];
  return Object.values(config.files).filter((name) => typeof name === 'string' && name);
}

// ─── Layout ───────────────────────────────────────────────────

/**
 * Absolute path Frame should use for meta file `name` in this project.
 * Exported because migration and the IPC layer need the same answer — no
 * caller builds it from FRAME_DIR itself.
 */
function resolvePath(projectPath, name) {
  const overlay = path.join(projectPath, FRAME_DIR, name);
  if (fs.existsSync(overlay)) return overlay;

  const root = path.join(projectPath, name);
  if (fs.existsSync(root) && legacyFileNames(projectPath).includes(name)) return root;

  return overlay;
}

/**
 * True while the project still carries Frame's pre-overlay layout: the
 * `config.files` record plus at least one of the listed files at the root.
 * This is the migration fingerprint; a second look after migrating is false.
 */
function isLegacyLayout(projectPath) {
  return legacyFileNames(projectPath).some((name) => fs.existsSync(path.join(projectPath, name)));
}

/**
 * Directory to watch for tasks.json — the root for an unmigrated project,
 * `.frame/` otherwise. Derived from where tasks.json actually resolves, so a
 * half-migrated tree is watched where the file really is.
 */
function metaDir(projectPath) {
  return path.dirname(resolvePath(projectPath, FRAME_FILES.TASKS));
}

// ─── Typed read/write ─────────────────────────────────────────

function readText(projectPath, name) {
  try {
    return fs.readFileSync(resolvePath(projectPath, name), 'utf8');
  } catch (err) {
    return null;
  }
}

function writeText(projectPath, name, text) {
  const target = resolvePath(projectPath, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fsSafe.writeFileAtomic(target, text);
}

/**
 * tasks.json, with fsSafe's corruption recovery. Returns the recovery record
 * `{ data, source, error }` rather than the bare object because tasksManager
 * renders a different state for "restored from .bak" than for "corrupt with
 * nothing to restore" — flattening that here would push it back to reading
 * the file itself.
 */
function getTasks(projectPath) {
  return fsSafe.readJsonWithRecovery(resolvePath(projectPath, FRAME_FILES.TASKS));
}

function saveTasks(projectPath, data) {
  writeText(projectPath, FRAME_FILES.TASKS, JSON.stringify(data, null, 2));
}

/** STRUCTURE.json parsed, or null when it is missing or unparseable. */
function getStructure(projectPath) {
  const raw = readText(projectPath, FRAME_FILES.STRUCTURE);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function saveStructure(projectPath, structure) {
  writeText(projectPath, FRAME_FILES.STRUCTURE, JSON.stringify(structure, null, 2));
}

function readNotes(projectPath) {
  return readText(projectPath, FRAME_FILES.NOTES);
}

/**
 * Append an entry to PROJECT_NOTES.md, keeping one blank line between it and
 * whatever was there. Creates the file when the project has none.
 */
function appendNote(projectPath, text) {
  const existing = readNotes(projectPath);
  const entry = String(text).trim();
  const body = existing && existing.trim()
    ? `${existing.replace(/\s+$/, '')}\n\n${entry}\n`
    : `${entry}\n`;
  writeText(projectPath, FRAME_FILES.NOTES, body);
}

function readQuickstart(projectPath) {
  return readText(projectPath, FRAME_FILES.QUICKSTART);
}

function readAgents(projectPath) {
  return readText(projectPath, FRAME_FILES.AGENTS);
}

function writeAgents(projectPath, text) {
  writeText(projectPath, FRAME_FILES.AGENTS, text);
}

// ─── Project identity ─────────────────────────────────────────

/** The project's stable id, or null if it has none yet. */
function getProjectId(projectPath) {
  const config = readConfig(projectPath);
  return config && typeof config.projectId === 'string' && config.projectId
    ? config.projectId
    : null;
}

/**
 * Stamp a UUID into `.frame/config.json` once and return it; a project that
 * already has one keeps it. Returns null for a project with no config —
 * identity belongs to init and migration, not to a bare directory.
 */
function ensureProjectId(projectPath) {
  const config = readConfig(projectPath);
  if (!config) return null;

  if (typeof config.projectId === 'string' && config.projectId) return config.projectId;

  config.projectId = crypto.randomUUID();
  writeConfig(projectPath, config);
  return config.projectId;
}

// ─── IPC ──────────────────────────────────────────────────────

/**
 * The renderer used to read STRUCTURE.json off disk itself, which meant a
 * renderer module knew the layout. It asks for the parsed map instead.
 */
function setupIPC(ipcMain) {
  ipcMain.handle(IPC.LOAD_STRUCTURE_MAP, (event, projectPath) => {
    if (!projectPath) return { error: 'No project selected' };
    const data = getStructure(projectPath);
    if (!data) return { error: 'STRUCTURE.json not found' };
    return data;
  });
}

module.exports = {
  resolvePath,
  setupIPC,
  metaDir,
  isLegacyLayout,
  getTasks,
  saveTasks,
  getStructure,
  saveStructure,
  readNotes,
  appendNote,
  readQuickstart,
  readAgents,
  writeAgents,
  readConfig,
  writeConfig,
  getProjectId,
  ensureProjectId
};
