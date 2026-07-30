/**
 * instructionDiscovery — find out what the repo already says, and change none
 * of it.
 *
 * Two questions, one root scan:
 *
 *  1. **Native instruction files.** `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`,
 *     `.claude/CLAUDE.md`, `.cursorrules`, `.cursor/rules/*`,
 *     `.github/copilot-instructions.md`. These belong to the repo. Frame reads
 *     them only to know they exist, so the launch-time preamble can *point* an
 *     AI tool at them; nothing is copied out, nothing is written back.
 *
 *  2. **The pre-overlay Frame layout.** A project initialized by an older
 *     Frame carries root `tasks.json` / `AGENTS.md` / `STRUCTURE.json` /
 *     `PROJECT_NOTES.md` and often a `CLAUDE.md → AGENTS.md` symlink. Frame now
 *     reads only `.frame/`, so such a project would otherwise open as an empty,
 *     never-initialized one. Detecting it is what turns that silence into a
 *     banner; moving the files belongs to the `embedded-migration` spec.
 *
 * ── Strictly read-only ──
 * Every path here is opened for reading or stat'ed and nothing else. No
 * `openSync(..., 'w')`, no rename, no symlink, no mtime touch. A repo the user
 * does not own must be checksum-identical after a full Frame session, and this
 * is the module with the most opportunity to break that.
 *
 * ── Freshness ──
 * A full re-scan runs on every project open — that is the correctness path,
 * and it is a handful of `existsSync` calls. The debounced `fs.watch` is a
 * best-effort optimization on top: when it fires, the cache refreshes early so
 * a launch mid-session sees the current state. If the watcher never fires
 * (network mount, platform quirk, editor writing through a temp file), nothing
 * is lost — the next open re-scans anyway.
 */

const fs = require('fs');
const path = require('path');
const fsSafe = require('./fsSafe');
const { LEGACY_ROOT_FILES } = require('../shared/frameConstants');

const WATCH_DEBOUNCE_MS = 250;

/**
 * Native instruction files, in the order a reader would want them listed.
 * `dir: true` entries contribute every file inside the directory.
 */
const NATIVE_SOURCES = [
  { kind: 'claude', rel: 'CLAUDE.md' },
  { kind: 'claude', rel: path.join('.claude', 'CLAUDE.md') },
  { kind: 'agents', rel: 'AGENTS.md' },
  { kind: 'gemini', rel: 'GEMINI.md' },
  { kind: 'cursor', rel: '.cursorrules' },
  { kind: 'cursor', rel: path.join('.cursor', 'rules'), dir: true },
  { kind: 'copilot', rel: path.join('.github', 'copilot-instructions.md') }
];

// A pre-overlay init always produced these at the root. tasks.json alone is
// too weak a signal — plenty of unrelated projects have one — so the layout
// counts as Frame's only when a Frame-specific companion is there too.
const LEGACY_STRONG = [LEGACY_ROOT_FILES.STRUCTURE, LEGACY_ROOT_FILES.NOTES, LEGACY_ROOT_FILES.QUICKSTART];

let cache = new Map(); // projectPath → result
let watchers = new Map(); // projectPath → { watcher, timer }

function isFile(target) {
  try {
    return fs.statSync(target).isFile();
  } catch (_) {
    return false;
  }
}

/** `lstat`, so a symlink is reported as a symlink rather than followed. */
function linkInfo(target) {
  try {
    return fs.lstatSync(target);
  } catch (_) {
    return null;
  }
}

function listDirFiles(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(dir, entry.name))
      .sort();
  } catch (_) {
    return [];
  }
}

/**
 * Is the root layout an older Frame's, rather than a project that merely
 * happens to have an AGENTS.md?
 */
function detectLegacyLayout(projectPath) {
  const hasTasks = isFile(path.join(projectPath, LEGACY_ROOT_FILES.TASKS));
  const hasCompanion = LEGACY_STRONG.some((name) => isFile(path.join(projectPath, name)));

  // The other tell: a CLAUDE.md symlink pointing at AGENTS.md, which only
  // Frame's own init ever created.
  const claudeLink = linkInfo(path.join(projectPath, LEGACY_ROOT_FILES.CLAUDE_SYMLINK));
  let framePlantedSymlink = false;
  if (claudeLink && claudeLink.isSymbolicLink()) {
    try {
      framePlantedSymlink =
        path.basename(fs.readlinkSync(path.join(projectPath, LEGACY_ROOT_FILES.CLAUDE_SYMLINK))) ===
        LEGACY_ROOT_FILES.AGENTS;
    } catch (_) {
      framePlantedSymlink = false;
    }
  }

  return (hasTasks && hasCompanion) || framePlantedSymlink;
}

/**
 * Scan a project root. Returns
 * `{ projectPath, nativeFiles: [{ path, kind }], legacyLayout: boolean }`.
 * In-memory only — never persisted, never written back.
 */
function scan(projectPath) {
  const nativeFiles = [];
  if (!projectPath) return { projectPath, nativeFiles, legacyLayout: false };

  for (const source of NATIVE_SOURCES) {
    const target = path.join(projectPath, source.rel);
    if (source.dir) {
      for (const file of listDirFiles(target)) {
        nativeFiles.push({ path: file, kind: source.kind });
      }
      continue;
    }
    if (isFile(target)) nativeFiles.push({ path: target, kind: source.kind });
  }

  return { projectPath, nativeFiles, legacyLayout: detectLegacyLayout(projectPath) };
}

/** Scan and cache. Every project open goes through here. */
function refresh(projectPath) {
  const result = scan(projectPath);
  cache.set(projectPath, result);
  return result;
}

/**
 * The current view, scanning if this project has not been seen. Callers that
 * want guaranteed-fresh data call `refresh` instead.
 */
function get(projectPath) {
  return cache.get(projectPath) || refresh(projectPath);
}

/**
 * Best-effort freshness: re-scan when something at the root changes.
 *
 * The project root only — no recursion. A deep watch on an arbitrary
 * repository is a resource cost with no matching benefit here, and the
 * `.cursor/rules/` case is covered by the next open's full re-scan.
 */
function startWatching(projectPath) {
  if (!projectPath || watchers.has(projectPath)) return;
  if (!fs.existsSync(projectPath)) return;

  const state = { watcher: null, timer: null };
  try {
    state.watcher = fsSafe.safeWatch(projectPath, { persistent: false }, (eventType, filename) => {
      if (!filename) return;
      const base = path.basename(filename);
      const interesting =
        NATIVE_SOURCES.some((s) => path.basename(s.rel) === base) ||
        Object.values(LEGACY_ROOT_FILES).includes(base);
      if (!interesting) return;

      clearTimeout(state.timer);
      state.timer = setTimeout(() => refresh(projectPath), WATCH_DEBOUNCE_MS);
    }, () => { watchers.delete(projectPath); });
    watchers.set(projectPath, state);
  } catch (err) {
    // A project on a filesystem that cannot be watched still gets the
    // per-open re-scan, which is the path correctness depends on.
    console.warn('instructionDiscovery: watch failed (non-fatal):', err.message);
  }
}

function stopWatching(projectPath) {
  const state = watchers.get(projectPath);
  if (!state) return;
  clearTimeout(state.timer);
  try { if (state.watcher) state.watcher.close(); } catch (_) { /* ignore */ }
  watchers.delete(projectPath);
}

function stopAll() {
  for (const projectPath of Array.from(watchers.keys())) stopWatching(projectPath);
  cache = new Map();
}

module.exports = {
  scan,
  refresh,
  get,
  startWatching,
  stopWatching,
  stopAll,
  NATIVE_SOURCES
};
