/**
 * embeddedMigration — move a pre-overlay project into the `.frame/` layout.
 *
 * A project initialized by an older Frame keeps its meta files at the root:
 * `tasks.json`, `STRUCTURE.json`, `PROJECT_NOTES.md`, `QUICKSTART.md`, a
 * generated `AGENTS.md`, and `CLAUDE.md`/`GEMINI.md` symlinks pointing at it.
 * Frame now reads only `.frame/`, so those files are simultaneously invisible
 * to the app and *visible to the agent* — the launch preamble tells Claude the
 * root `CLAUDE.md` is the user's own, when it is a symlink Frame planted to a
 * file Frame generated describing a layout that no longer exists. That
 * contradiction, not the empty panels, is why this runs by itself.
 *
 * ── Shape ──
 * `plan()` inspects and writes nothing. `migrateProject()` executes a plan.
 * `sweep()` maps that over the registry. Splitting inspection from execution
 * is what makes the hard parts — dual layout, dirty trees, half-finished runs
 * — testable without performing them.
 *
 * ── Electron-free ──
 * Paths in, plain objects out. The activity recorder and the telemetry sink
 * are injected by `init()` (the convention `globalLayer` follows), so this
 * module and its suite never load Electron.
 *
 * Spec: .frame/specs/embedded-migration/
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  FRAME_DIR,
  FRAME_CONFIG_FILE,
  LEGACY_ROOT_FILES,
  FRAME_META_FILES
} = require('../shared/frameConstants');
const instructionDiscovery = require('./instructionDiscovery');
const gitSharing = require('./gitSharing');
const structureBootstrap = require('./structureBootstrap');
const { bucketCount } = require('./telemetryEvents');

/** Everything removed is copied here first, and nothing prunes it. */
const BACKUP_DIR = 'migration-backup';

/**
 * Root artifact → where it belongs under `.frame/`. Only these five carry
 * data; the symlinks are handled separately because they hold nothing.
 */
const TARGET_BY_ROOT_NAME = {
  [LEGACY_ROOT_FILES.AGENTS]: FRAME_META_FILES.AGENTS,
  [LEGACY_ROOT_FILES.STRUCTURE]: FRAME_META_FILES.STRUCTURE,
  [LEGACY_ROOT_FILES.NOTES]: FRAME_META_FILES.NOTES,
  [LEGACY_ROOT_FILES.TASKS]: FRAME_META_FILES.TASKS,
  [LEGACY_ROOT_FILES.QUICKSTART]: FRAME_META_FILES.QUICKSTART
};

/** `config.json.files` keys that name a data artifact, in migration order. */
const MANIFEST_ARTIFACT_KEYS = ['agents', 'structure', 'notes', 'tasks', 'quickstart'];

/**
 * The two symlinks old init planted. `config.json.files` records only
 * `claudeSymlink` even though `GEMINI.md` was created the same way, so the
 * manifest cannot be the test here — the link target is.
 */
const SYMLINK_NAMES = [LEGACY_ROOT_FILES.CLAUDE_SYMLINK, LEGACY_ROOT_FILES.GEMINI_SYMLINK];

/**
 * The heading old init wrote when it consumed a user's instruction file. The
 * code that produced it was deleted in 1202ab2; it survives in users' files,
 * so it lives here as a literal — this is the only handle on content that was
 * taken from the user and has to go back.
 */
const EXISTING_HEADING = (label) => `## Existing Instructions (from ${label})`;

/** Label in the merged file → the root path its content came from. */
const RESTORE_TARGETS = [
  { label: LEGACY_ROOT_FILES.CLAUDE_SYMLINK, rel: LEGACY_ROOT_FILES.CLAUDE_SYMLINK },
  { label: LEGACY_ROOT_FILES.GEMINI_SYMLINK, rel: LEGACY_ROOT_FILES.GEMINI_SYMLINK },
  { label: LEGACY_ROOT_FILES.AGENTS, rel: LEGACY_ROOT_FILES.AGENTS }
  // `.claude/CLAUDE.md` is deliberately absent: old init read it but never
  // unlinked it, so the file is still on disk and recreating it would be
  // Frame writing a file it never took (D6).
];

// ─── injection ────────────────────────────────────────────────
//
// Both sinks default to no-ops. A migration that cannot record must still
// migrate: observability is the compensation for running silently, not a
// precondition for running at all.

let recordActivity = () => {};
let sendTelemetry = () => {};

/**
 * Projects currently being migrated. Shared by the sweep and the foreground
 * path, which are the same engine reached two ways.
 */
const inFlight = new Set();

/**
 * @param {{ record?: Function, telemetry?: Function }} deps
 *   record    — `activityLog.record(name, fields)`
 *   telemetry — `telemetry.track(event, props)`
 */
function init(deps = {}) {
  if (typeof deps.record === 'function') recordActivity = deps.record;
  if (typeof deps.telemetry === 'function') sendTelemetry = deps.telemetry;
}

function record(name, fields) {
  try {
    recordActivity(name, fields);
  } catch (_) {
    /* recording must never break the thing it observes */
  }
}

// ─── filesystem helpers ───────────────────────────────────────

function lstat(target) {
  try {
    return fs.lstatSync(target);
  } catch (_) {
    return null;
  }
}

function exists(target) {
  return lstat(target) !== null;
}

/** True only for a symlink Frame planted: one that points at `AGENTS.md`. */
function isFramePlantedSymlink(projectPath, rel) {
  const target = path.join(projectPath, rel);
  const info = lstat(target);
  if (!info || !info.isSymbolicLink()) return false;
  try {
    return path.basename(fs.readlinkSync(target)) === LEGACY_ROOT_FILES.AGENTS;
  } catch (_) {
    return false;
  }
}

function readFile(target) {
  try {
    return fs.readFileSync(target, 'utf8');
  } catch (_) {
    return null;
  }
}

/** Byte comparison, not mtime or size: a stale copy can match on both. */
function sameContent(a, b) {
  try {
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch (_) {
    return false;
  }
}

// ─── git ──────────────────────────────────────────────────────

function git(projectPath, args) {
  return execFileSync('git', args, {
    cwd: projectPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
}

function isGitRepo(projectPath) {
  try {
    git(projectPath, ['rev-parse', '--git-dir']);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Legacy artifacts git reports as modified or staged (D4).
 *
 * Untracked files are not dirty: there is no diff for the user to be confused
 * by and nothing git is holding. A non-git project returns `[]` on purpose —
 * the failure D4 guards against needs a working tree to occur in, and the only
 * other available signal, mtime, would strand an actively-edited project in
 * the broken state forever.
 */
function dirtyArtifacts(projectPath, rels) {
  if (!rels.length || !isGitRepo(projectPath)) return [];
  try {
    const out = git(projectPath, ['status', '--porcelain', '--', ...rels]);
    return out
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('??'))
      .map((line) => line.slice(3).trim())
      // A rename reads as "old -> new"; the artifact is the destination.
      .map((name) => (name.includes(' -> ') ? name.split(' -> ').pop() : name))
      .map((name) => name.replace(/^"|"$/g, ''))
      .filter((name) => rels.includes(name));
  } catch (_) {
    return [];
  }
}

/**
 * Which artifacts git has committed. This drives the receipt's git sentence,
 * and it is deliberately not the sharing mode: a user who gitignored `.frame/`
 * themselves but committed the root files derives `local` while the deletions
 * are plainly visible in their working tree (D8).
 */
function trackedArtifacts(projectPath, rels) {
  if (!rels.length || !isGitRepo(projectPath)) return [];
  try {
    return git(projectPath, ['ls-files', '--cached', '--', ...rels])
      .split('\n')
      .map((line) => line.trim())
      .filter((name) => rels.includes(name));
  } catch (_) {
    return [];
  }
}

// ─── the legacy config ────────────────────────────────────────

function configPath(projectPath) {
  return path.join(projectPath, FRAME_DIR, FRAME_CONFIG_FILE);
}

function readConfig(projectPath) {
  try {
    return JSON.parse(fs.readFileSync(configPath(projectPath), 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * The root files Frame created *for this project*, from the legacy config's
 * `files` block — a per-project manifest of Frame's own artifacts, and a far
 * stronger basis for "touch only what Frame made" than matching well-known
 * names (D5). Falls back to `LEGACY_ROOT_FILES` when the block is absent or
 * malformed, which is also the case for a project whose config never had one.
 *
 * `hasRecord` is a separate question from `names`: the oldest configs used
 * keys this version does not know (`claude` rather than `agents`), so a block
 * we cannot read is still a block Frame wrote — evidence of a pre-overlay
 * init even when the names have to come from the fallback.
 *
 * @returns {{ source: 'config'|'fallback', names: string[], hasRecord: boolean }}
 */
function artifactManifest(projectPath) {
  const config = readConfig(projectPath);
  const files = config && config.files;
  const hasRecord = Boolean(files && typeof files === 'object' && !Array.isArray(files));
  if (hasRecord) {
    const names = MANIFEST_ARTIFACT_KEYS.map((key) => files[key]).filter(
      (name) => typeof name === 'string' && name.length > 0
    );
    if (names.length) return { source: 'config', names, hasRecord };
  }
  return {
    source: 'fallback',
    names: Object.keys(TARGET_BY_ROOT_NAME),
    hasRecord
  };
}

// ─── the merged instruction blocks ────────────────────────────

/**
 * Pull one `## Existing Instructions (from <label>)` block out of a merged
 * `AGENTS.md`.
 *
 * The blocks were joined with `\n\n---\n\n`, so a block runs until the next
 * horizontal rule that is followed by another such heading, or to end of file.
 * Matching on the rule alone would truncate any user content that contains
 * one — and a consumed CLAUDE.md full of `---` separators is exactly the kind
 * of file that gets handed back mangled.
 *
 * @returns {string|null} the block's content, or null when it isn't there
 */
function extractExisting(content, label) {
  if (typeof content !== 'string') return null;
  const heading = EXISTING_HEADING(label);
  const start = content.indexOf(heading);
  if (start === -1) return null;

  const bodyStart = start + heading.length;
  const rest = content.slice(bodyStart);

  // The next block's separator: a rule on its own line followed by another
  // "Existing Instructions" heading.
  const next = rest.search(/\n+---\n+## Existing Instructions \(from /);
  const body = next === -1 ? rest : rest.slice(0, next);
  return body.replace(/^\n+/, '').replace(/\s+$/, '') + '\n';
}

// ─── plan ─────────────────────────────────────────────────────

/**
 * What migrating this project would do. Pure inspection — no writes, safe to
 * call on every open and on every project in the registry.
 *
 * @returns {{
 *   legacy: boolean, manifest: 'config'|'fallback',
 *   artifacts: Array<{ rel: string, target: string, disposition: string }>,
 *   restore: Array<{ rel: string, from: string }>,
 *   symlinks: string[], unrecognized: string[],
 *   dirty: string[], tracked: string[], backupDir: string
 * }}
 */
function plan(projectPath) {
  const empty = {
    legacy: false,
    manifest: 'fallback',
    artifacts: [],
    restore: [],
    symlinks: [],
    unrecognized: [],
    dirty: [],
    tracked: [],
    backupDir: path.join(FRAME_DIR, BACKUP_DIR)
  };
  if (!projectPath || !exists(projectPath)) return empty;
  if (!instructionDiscovery.scan(projectPath).legacyLayout) return empty;

  // ── Frame's own fingerprint, or nothing happens ──
  //
  // `detectLegacyLayout` matches on names — root `tasks.json` plus one of
  // `STRUCTURE.json` / `PROJECT_NOTES.md` / `QUICKSTART.md`. That was enough
  // when the consequence was a banner; it is not enough now that the
  // consequence is moving files, because those names belong to plenty of
  // repositories Frame never touched. A project with its own `tasks.json` and
  // `QUICKSTART.md` would have had both relocated on the next start.
  //
  // So a name match must be corroborated by something only Frame's own init
  // could have left:
  //
  //   - the `files` record in `.frame/config.json` — every pre-overlay init
  //     wrote one; the current init writes none, precisely so this stays a
  //     signature rather than a formality;
  //   - a `CLAUDE.md`/`GEMINI.md` symlink pointing at `AGENTS.md` — nothing
  //     else creates that, and old init created it unconditionally.
  //
  // Either is proof. Neither is forgeable by an ordinary repository. Without
  // one, the root files are the user's and this returns as if nothing were
  // there. (A migrated project has neither — the record is dropped and the
  // links removed — so it also reads as done, which is the same answer.)
  const manifest = artifactManifest(projectPath);
  const symlinks = SYMLINK_NAMES.filter((rel) => isFramePlantedSymlink(projectPath, rel));
  if (!manifest.hasRecord && !symlinks.length) return empty;

  const artifacts = [];
  for (const rel of manifest.names) {
    const target = TARGET_BY_ROOT_NAME[rel];
    if (!target) continue; // named by the manifest but not a layout we know
    const from = path.join(projectPath, rel);
    if (!exists(from)) continue;
    // A symlink at an artifact's name is the CLAUDE.md/AGENTS.md case, not a
    // file to move — the symlink list owns it.
    if (lstat(from).isSymbolicLink()) continue;

    const to = path.join(projectPath, target);
    let disposition = 'move';
    if (exists(to)) disposition = sameContent(from, to) ? 'delete-identical' : 'backup-conflict';
    artifacts.push({ rel, target, disposition });
  }

  const planned = new Set(artifacts.map((a) => a.rel));

  // Well-known legacy names sitting at the root that this project's manifest
  // does not claim. Reported so the receipt can say so, never touched (D5).
  const unrecognized = Object.keys(TARGET_BY_ROOT_NAME).filter(
    (rel) => !planned.has(rel) && exists(path.join(projectPath, rel)) && !lstat(path.join(projectPath, rel)).isSymbolicLink()
  );

  // The merged file is still at the root before the move, and already under
  // `.frame/` if an earlier run was interrupted after it.
  const mergedFrom = artifacts.some((a) => a.rel === LEGACY_ROOT_FILES.AGENTS)
    ? LEGACY_ROOT_FILES.AGENTS
    : FRAME_META_FILES.AGENTS;
  const merged = readFile(path.join(projectPath, mergedFrom));
  const restore = [];
  for (const { label, rel } of RESTORE_TARGETS) {
    if (extractExisting(merged, label) === null) continue;
    restore.push({ rel, from: `${mergedFrom}#${EXISTING_HEADING(label).replace('## ', '')}` });
  }

  const touched = [...planned, ...symlinks];
  return {
    legacy: true,
    manifest: manifest.source,
    artifacts,
    restore,
    symlinks,
    unrecognized,
    dirty: dirtyArtifacts(projectPath, touched),
    tracked: trackedArtifacts(projectPath, touched),
    backupDir: path.join(FRAME_DIR, BACKUP_DIR)
  };
}

// ─── the backup ───────────────────────────────────────────────

/**
 * Byte-copy everything the run will remove into `.frame/migration-backup/`,
 * preserving relative paths.
 *
 * One directory for the project's whole migration history, never timestamped
 * and never pruned (D9). Migration fires once per project, so there is no pile
 * to organize; a second run only follows a failed one, and since the backup is
 * written whole before anything moves, skipping paths already there yields
 * exactly the union of both runs in the one place a user can understand.
 *
 * A dangling symlink is skipped rather than failing the run: it points at
 * nothing, so there is nothing to preserve.
 *
 * @returns {string[]} the relative paths written by this call
 */
function writeBackup(projectPath, rels) {
  const root = path.join(projectPath, FRAME_DIR, BACKUP_DIR);
  const written = [];
  for (const rel of rels) {
    const from = path.join(projectPath, rel);
    if (!exists(from)) continue;
    const to = path.join(root, rel);
    if (exists(to)) continue; // an earlier run already preserved this one
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      written.push(rel);
    } catch (err) {
      const info = lstat(from);
      if (info && info.isSymbolicLink()) continue; // dangling — nothing to keep
      throw err;
    }
  }
  return written;
}

// ─── executing a plan ─────────────────────────────────────────

/**
 * Carry out one artifact's disposition.
 *
 * `move` is copy-verify-then-delete rather than rename: an interruption then
 * leaves a duplicate the next run's idempotent copy step reconciles, never a
 * hole (D2). `backup-conflict` only deletes, because `.frame/` always wins and
 * the root copy is already in the backup — post-upgrade work is never
 * overwritten by a stale root file (D3).
 */
function applyArtifact(projectPath, artifact) {
  const from = path.join(projectPath, artifact.rel);
  const to = path.join(projectPath, artifact.target);

  if (artifact.disposition === 'move') {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    if (!sameContent(from, to)) {
      throw new Error(`embeddedMigration: ${artifact.rel} did not copy intact`);
    }
  }
  fs.unlinkSync(from);
  record('migration.artifact', { path: artifact.rel, disposition: artifact.disposition });
}

/**
 * Drop the `files` block from `.frame/config.json`.
 *
 * It is a manifest of root files that no longer exist, and leaving it would
 * make the next `plan()` name paths that are gone. Everything else in the
 * config is preserved — this rewrites one key, it does not regenerate a file.
 */
function rewriteConfig(projectPath) {
  const config = readConfig(projectPath);
  if (!config || !Object.prototype.hasOwnProperty.call(config, 'files')) return false;
  delete config.files;
  fs.writeFileSync(configPath(projectPath), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return true;
}

/**
 * Remove the symlinks old init planted. Runs *before* restoration, not after
 * it as the spec's step list reads: writing `CLAUDE.md` while the symlink is
 * still there would follow it and create a root `AGENTS.md` instead — the one
 * file this migration exists to remove.
 *
 * @returns {string[]} the links actually removed
 */
function removeSymlinks(projectPath, rels) {
  const removed = [];
  for (const rel of rels) {
    const target = path.join(projectPath, rel);
    const info = lstat(target);
    if (!info || !info.isSymbolicLink()) continue;
    fs.unlinkSync(target);
    removed.push(rel);
  }
  return removed;
}

/**
 * Hand back the instruction files old init took.
 *
 * This is the overlay rule's one sanctioned write outside `.frame/`, and it is
 * narrow: it returns bytes this tool consumed, to the path it took them from,
 * only when nothing is there now. A file the user has since created at that
 * path is never overwritten — the extracted content goes to
 * `migration-backup/restored/` instead, where the receipt can point at it.
 *
 * `.claude/CLAUDE.md` is absent from `RESTORE_TARGETS` on purpose: old init
 * read it but never unlinked it, so it is still on disk and recreating it
 * would be Frame writing a file it never took (D6).
 *
 * @returns {Array<{ rel: string, source: 'merge-block'|'backup-conflict' }>}
 */
function restoreInstructions(projectPath, mergedRel) {
  const merged = readFile(path.join(projectPath, mergedRel));
  const restored = [];

  for (const { label, rel } of RESTORE_TARGETS) {
    const content = extractExisting(merged, label);
    if (content === null) continue;

    const target = path.join(projectPath, rel);
    if (exists(target)) {
      const held = path.join(projectPath, FRAME_DIR, BACKUP_DIR, 'restored', rel);
      fs.mkdirSync(path.dirname(held), { recursive: true });
      if (!exists(held)) fs.writeFileSync(held, content, 'utf8');
      record('migration.restored', { path: rel, source: 'backup-conflict' });
      restored.push({ rel, source: 'backup-conflict' });
      continue;
    }

    fs.writeFileSync(target, content, 'utf8');
    record('migration.restored', { path: rel, source: 'merge-block' });
    restored.push({ rel, source: 'merge-block' });
  }

  return restored;
}

/**
 * Migrate one project. Either it completes or it leaves the project untouched
 * and retries on the next open — there is no persisted half-migrated state
 * (D2).
 *
 * @param {string} projectPath
 * @param {{ onProgress?: (artifact: object) => void }} [opts]
 *   onProgress — the foreground modal's per-artifact reporter. The sweep
 *   passes nothing; the engine has no notion of which caller it has.
 * @returns {{ status: 'migrated'|'deferred'|'skipped'|'failed', ... }}
 */
function migrateProject(projectPath, opts = {}) {
  const started = Date.now();
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

  // The guard lives here rather than in `sweep()` so both callers share it:
  // the user selecting a project the sweep is already working on must not
  // start a second migration of it (S15).
  if (inFlight.has(projectPath)) {
    record('migration.skipped', { reason: 'in-flight' });
    return { status: 'skipped', reason: 'in-flight', artifacts: [], restored: [], tracked: [] };
  }

  const detected = plan(projectPath);
  if (!detected.legacy) return { status: 'skipped', artifacts: [], restored: [], tracked: [] };

  record('migration.detected', {
    artifacts: detected.artifacts.length,
    restore: detected.restore.length
  });

  if (detected.dirty.length) {
    record('migration.deferred', { reason: 'uncommitted', files: detected.dirty.length });
    return { status: 'deferred', dirty: detected.dirty, artifacts: [], restored: [], tracked: detected.tracked };
  }

  // Steps below are the atomic unit: a failure aborts the run, leaves the
  // backup behind, and the next open retries from a state the idempotent copy
  // step can reconcile.
  inFlight.add(projectPath);
  let step = 'backup';
  try {
    // The ignore block before the backup, not after: a run that dies halfway
    // would otherwise leave a repo-mode project showing every backed-up file
    // as a new untracked one.
    gitSharing.writeFrameGitignore(projectPath);
    writeBackup(projectPath, [...detected.artifacts.map((a) => a.rel), ...detected.symlinks]);

    // Before the move, not after. The shipped parser resolves its meta paths
    // through `.frame/` with a root fallback, so it is correct on either side
    // of this step — refreshing first means even a run that dies mid-move
    // leaves scripts that read the layout they actually find. Doing it after
    // would leave that window open for whatever the next commit is.
    //
    // Never fatal: a project that migrates with a stale parser is a bug worth
    // fixing, but not one worth failing the migration over.
    step = 'scripts';
    try {
      const refreshed = structureBootstrap.refreshStagedScripts(projectPath);
      record('migration.scripts', { scripts: refreshed.scripts.length, hook: refreshed.hook });
    } catch (err) {
      record('migration.scripts', { error: err.message });
    }

    step = 'move';
    for (const artifact of detected.artifacts) {
      applyArtifact(projectPath, artifact);
      if (onProgress) onProgress(artifact);
    }

    step = 'restore';
    for (const rel of removeSymlinks(projectPath, detected.symlinks)) {
      record('migration.restored', { path: rel, source: 'symlink-only' });
    }
    // The merged file is under `.frame/` once the move above has run, and
    // still at the root when this project's manifest never claimed it.
    const mergedRel = exists(path.join(projectPath, FRAME_META_FILES.AGENTS))
      ? FRAME_META_FILES.AGENTS
      : LEGACY_ROOT_FILES.AGENTS;
    const restored = restoreInstructions(projectPath, mergedRel);

    step = 'config';
    rewriteConfig(projectPath);

    // The project keeps the sharing posture it already had. `declaredMode` is
    // null on every legacy config — the block predates `settings.gitSharing` —
    // so derivation runs here for the first time and `.frame/` being committed
    // is what decides it. Frame does not offer the choice: Project Settings
    // owns that, and this is a recording, not a decision (D7).
    step = 'posture';
    const mode = gitSharing.resolveMode(projectPath);
    gitSharing.writeFrameGitignore(projectPath);
    if (mode) record('migration.posture', { mode });

    record('migration.completed', {
      artifacts: detected.artifacts.length,
      restored: restored.length,
      tracked: detected.tracked.length,
      ms: Date.now() - started
    });

    return {
      status: 'migrated',
      artifacts: detected.artifacts,
      restored,
      tracked: detected.tracked,
      unrecognized: detected.unrecognized,
      backupDir: detected.backupDir
    };
  } catch (err) {
    record('migration.failed', { step, artifacts: detected.artifacts.length });
    // The one thing this spec reports off-machine, and only because D1 runs
    // silently and D10 removed the banner: a run that dies halfway is
    // otherwise invisible everywhere but this user's own disk.
    try {
      sendTelemetry('migration_failed', {
        step,
        artifacts: bucketCount(detected.artifacts.length)
      });
    } catch (_) {
      /* telemetry never decides whether migration reports a failure */
    }
    return {
      status: 'failed',
      step,
      error: err.message,
      artifacts: detected.artifacts,
      restored: [],
      tracked: detected.tracked,
      backupDir: detected.backupDir
    };
  } finally {
    inFlight.delete(projectPath);
  }
}

/** True while a migration of this project is running (S15). */
function isMigrating(projectPath) {
  return inFlight.has(projectPath);
}

// ─── the sweep ────────────────────────────────────────────────

/**
 * Migrate every project the workspace registry knows about.
 *
 * Frame is not a one-project tool: hanging migration off project-open alone
 * would migrate a user's five legacy projects one per session, each with its
 * own notice, and leave every project they did not happen to open in the
 * broken state indefinitely (D1a).
 *
 * Projects Frame does not know about are not migrated, and that is correct:
 * `workspaces.json` *is* the set Frame is responsible for, and the only way
 * out of it is the user removing a project. An old one migrates the moment
 * they add it back.
 *
 * Yields to the event loop between projects so a long sweep never holds the
 * main process; a failure is confined to its own project.
 *
 * @returns {Promise<Array<{ path, name, status, tracked, restored, error? }>>}
 */
async function sweep(projectPaths) {
  const results = [];
  for (const projectPath of projectPaths || []) {
    await new Promise((resolve) => setImmediate(resolve));

    const entry = { path: projectPath, name: projectPath ? path.basename(projectPath) : '' };
    if (!projectPath || !exists(projectPath)) {
      record('migration.skipped', { reason: 'missing-path' });
      results.push({ ...entry, status: 'skipped', reason: 'missing-path', tracked: 0, restored: 0 });
      continue;
    }

    try {
      const result = migrateProject(projectPath);
      results.push({
        ...entry,
        status: result.status,
        reason: result.reason,
        tracked: (result.tracked || []).length,
        restored: (result.restored || []).length,
        dirty: result.dirty,
        backupDir: result.backupDir,
        error: result.error
      });
    } catch (err) {
      // migrateProject already reports its own failures; this catches the
      // unforeseen so one project can never stop the pass.
      results.push({ ...entry, status: 'failed', tracked: 0, restored: 0, error: err.message });
    }
  }
  return results;
}

module.exports = {
  init,
  plan,
  migrateProject,
  isMigrating,
  sweep,
  writeBackup,
  removeSymlinks,
  restoreInstructions,
  rewriteConfig,
  extractExisting,
  BACKUP_DIR,
  TARGET_BY_ROOT_NAME,
  SYMLINK_NAMES
};
