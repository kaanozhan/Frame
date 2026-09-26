/**
 * STRUCTURE state — where the map lives, whether it is usable, and how a
 * new one is published without ever destroying the last valid copy.
 *
 * Responsibilities (generation decides content; this module decides what
 * happens to the files):
 *
 *   • path ownership   overlay `.frame/STRUCTURE.json` first; the root copy
 *                      only when `config.files` names it (frameStore's rule —
 *                      a user's own root STRUCTURE.json is never touched)
 *   • validation       shape, not just JSON syntax; a valid `.bak` is read
 *                      when the live file is corrupt
 *   • writer lock      exclusive `wx` lock held from before the baseline read
 *                      through publication and the final attempt record;
 *                      reclaimed only when its owner is demonstrably gone
 *   • attempt record   `.frame/runtime/structure/scan.json` — the latest
 *                      attempt, separate from the artifact, so a retained old
 *                      map never passes for a newly completed scan
 *   • recovery         original bytes archived content-addressed under
 *                      `.frame/runtime/structure/recovery/` before anything
 *                      authored or malformed is replaced; if that fails,
 *                      nothing is replaced
 *   • publication      fsSafe.writeFileAtomic (the same implementation the
 *                      app uses, shipped beside this file as fsSafe.js)
 *
 * The artifact and the attempt record are two writes, not a transaction:
 * `running` is persisted first, then the artifact, then the finished record
 * with the artifact digest. A crash in between leaves a running record that
 * the next writer classifies as interrupted — never as success.
 *
 * Standalone: ships into `.frame/bin/`; no dependencies beyond Node.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

/**
 * The atomic writer: the copy shipped beside this file in `.frame/bin/`,
 * or the app's own module when running from Frame's repository.
 */
function loadFsSafe() {
  try {
    return require('./fsSafe');
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') throw err;
    return require('../src/main/fsSafe');
  }
}
const fsSafe = loadFsSafe();

const STRUCTURE_FILE = 'STRUCTURE.json';
const RECORD_VERSION = 1;
const MAX_DIAGNOSTIC_SAMPLES = 100;

/* ------------------------------- paths ------------------------------- */

function readConfig(rootDir, fsImpl) {
  try {
    const config = JSON.parse(fsImpl.readFileSync(path.join(rootDir, '.frame', 'config.json'), 'utf8'));
    return config && typeof config === 'object' && !Array.isArray(config) ? config : null;
  } catch (err) {
    return null;
  }
}

function legacyOwns(rootDir, name, fsImpl) {
  const config = readConfig(rootDir, fsImpl);
  if (!config || !config.files || typeof config.files !== 'object') return false;
  return Object.values(config.files).includes(name);
}

/**
 * The map this project owns. Mirrors frameStore.resolvePath exactly:
 * overlay if it exists; the root file only when it exists and config.files
 * records it; otherwise the overlay (new maps are never created at the root).
 */
function resolveStructurePath(rootDir, fsImpl = fs) {
  const overlay = path.join(rootDir, '.frame', STRUCTURE_FILE);
  if (fsImpl.existsSync(overlay)) return overlay;
  const legacy = path.join(rootDir, STRUCTURE_FILE);
  if (fsImpl.existsSync(legacy) && legacyOwns(rootDir, STRUCTURE_FILE, fsImpl)) return legacy;
  return overlay;
}

function statePaths(rootDir, fsImpl = fs) {
  const runtimeDir = path.join(rootDir, '.frame', 'runtime', 'structure');
  return {
    rootDir,
    map: resolveStructurePath(rootDir, fsImpl),
    runtimeDir,
    scanFile: path.join(runtimeDir, 'scan.json'),
    lockFile: path.join(runtimeDir, 'lock'),
    recoveryDir: path.join(runtimeDir, 'recovery')
  };
}

/* ----------------------------- validation ---------------------------- */

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Shape check for a parsed map. Returns null when valid, otherwise a short
 * reason. Accepts v1.0 maps, v1.1 maps, Frame's templates and legacy
 * `path/purpose` records (those are migrated, not rejected).
 */
function validateStructure(data) {
  if (!isPlainObject(data)) return 'not-an-object';
  if (!isPlainObject(data.modules)) return 'modules-not-an-object';
  for (const key of Object.keys(data.modules)) {
    const entry = data.modules[key];
    if (!isPlainObject(entry)) return 'module-not-an-object';
    if (Object.prototype.hasOwnProperty.call(entry, 'file') && typeof entry.file !== 'string') return 'module-file-not-a-string';
  }
  for (const field of ['intentIndex', 'legacyModuleGroups', 'curatedKeyOwners', 'generation', 'ipcChannels']) {
    if (data[field] !== undefined && !isPlainObject(data[field])) return `${field}-not-an-object`;
  }
  if (data.curatedKeyOwners && Object.values(data.curatedKeyOwners).some((v) => typeof v !== 'string')) {
    return 'curatedKeyOwners-value-not-a-string';
  }
  if (data.version !== undefined && typeof data.version !== 'string') return 'version-not-a-string';
  return null;
}

/**
 * A map a failed or partial scan may fall back to: valid, and the result of
 * a real scan. A pending template (or a pre-1.1 template with no modules)
 * is not a completed empty map.
 */
function isUsableMap(data) {
  if (validateStructure(data)) return false;
  const generation = data.generation;
  if (isPlainObject(generation)) return generation.state !== 'pending';
  return Object.keys(data.modules).length > 0;
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readBytes(fsImpl, file) {
  try {
    return { bytes: fsImpl.readFileSync(file), error: null };
  } catch (err) {
    return { bytes: null, error: err };
  }
}

function parseMap(bytes) {
  try {
    const data = JSON.parse(bytes.toString('utf8'));
    const reason = validateStructure(data);
    return reason ? { data: null, reason } : { data, reason: null };
  } catch (err) {
    return { data: null, reason: 'invalid-json' };
  }
}

/**
 * The baseline a mutating run builds on.
 *   missing  no live file (a backup alone is not resurrected)
 *   valid    `data` from the live file, or from `.bak` when the live file is
 *            corrupt (`source: 'backup'`, `liveCorrupt: true`)
 *   corrupt  live file unusable and no valid backup
 * Raw bytes are returned so callers can preserve them exactly.
 */
function readBaseline(mapPath, fsImpl = fs) {
  const live = readBytes(fsImpl, mapPath);
  if (live.error) {
    if (live.error.code === 'ENOENT') return { status: 'missing', data: null, source: null, liveBytes: null, liveDigest: null };
    return { status: 'corrupt', data: null, source: null, reason: `unreadable-${live.error.code || 'error'}`, liveBytes: null, liveDigest: null, unreadable: true };
  }
  const liveDigest = digest(live.bytes);
  const parsed = parseMap(live.bytes);
  if (parsed.data) return { status: 'valid', data: parsed.data, source: 'live', liveBytes: live.bytes, liveDigest };

  const backup = readBytes(fsImpl, `${mapPath}.bak`);
  if (backup.bytes) {
    const fromBackup = parseMap(backup.bytes);
    if (fromBackup.data) {
      return {
        status: 'valid', data: fromBackup.data, source: 'backup', liveCorrupt: true, reason: parsed.reason,
        liveBytes: live.bytes, liveDigest, backupBytes: backup.bytes
      };
    }
  }
  return { status: 'corrupt', data: null, source: null, reason: parsed.reason, liveBytes: live.bytes, liveDigest };
}

/* -------------------------------- lock ------------------------------- */

function defaultIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists, owned by someone else
  }
}

function readJson(fsImpl, file) {
  try {
    return JSON.parse(fsImpl.readFileSync(file, 'utf8'));
  } catch (err) {
    return null;
  }
}

/** True only when the owner is on this host and its process is gone. */
function ownerIsGone(owner, isAlive) {
  if (!isPlainObject(owner) || !Number.isInteger(owner.pid)) return false; // ambiguous
  if (owner.host !== os.hostname()) return false; // cannot prove it
  return !isAlive(owner.pid);
}

/**
 * Take the exclusive writer lock. Returns `{ ok: true, token }` or
 * `{ ok: false, reason: 'busy', owner }` / `{ ok: false, reason: 'error', error }`.
 * A stale lock is moved aside atomically and re-verified before the retry,
 * so two reclaimers cannot both win and a fresh lock is never discarded.
 */
function acquireLock(paths, options = {}) {
  const fsImpl = options.fs || fs;
  const isAlive = options.isAlive || defaultIsAlive;
  const token = options.token || crypto.randomUUID();
  const record = {
    token,
    attemptId: options.attemptId || token,
    pid: options.pid || process.pid,
    host: os.hostname(),
    createdAt: (options.now ? new Date(options.now()) : new Date()).toISOString()
  };
  try {
    fsImpl.mkdirSync(paths.runtimeDir, { recursive: true });
  } catch (error) {
    return { ok: false, reason: 'error', error };
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fsImpl.openSync(paths.lockFile, 'wx');
      try {
        fsImpl.writeFileSync(fd, JSON.stringify(record));
        fsImpl.fsyncSync(fd);
      } finally {
        fsImpl.closeSync(fd);
      }
      return { ok: true, token, record };
    } catch (err) {
      if (err.code !== 'EEXIST') return { ok: false, reason: 'error', error: err };
    }
    const owner = readJson(fsImpl, paths.lockFile);
    if (attempt > 0 || !ownerIsGone(owner, isAlive)) return { ok: false, reason: 'busy', owner };

    // Move the stale lock aside, then confirm it is the one we judged.
    const aside = `${paths.lockFile}.stale-${token}`;
    try {
      fsImpl.renameSync(paths.lockFile, aside);
    } catch (err) {
      if (err.code === 'ENOENT') continue; // someone else reclaimed it
      return { ok: false, reason: 'error', error: err };
    }
    const moved = readJson(fsImpl, aside);
    if (!moved || moved.token !== owner.token) {
      // We moved a fresh lock by mistake: put it back without clobbering.
      try { fsImpl.linkSync(aside, paths.lockFile); } catch (err) { /* a newer lock exists */ }
      try { fsImpl.unlinkSync(aside); } catch (err) { /* ignore */ }
      return { ok: false, reason: 'busy', owner: moved };
    }
    try { fsImpl.unlinkSync(aside); } catch (err) { /* ignore */ }
  }
  return { ok: false, reason: 'busy', owner: readJson(fsImpl, paths.lockFile) };
}

/** Release the lock only if `token` still owns it. */
function releaseLock(paths, token, fsImpl = fs) {
  const owner = readJson(fsImpl, paths.lockFile);
  if (!owner || owner.token !== token) return false;
  try {
    fsImpl.unlinkSync(paths.lockFile);
    return true;
  } catch (err) {
    return false;
  }
}

/** Is a live writer holding the lock right now? (Read-only; for --check.) */
function writerActive(paths, options = {}) {
  const fsImpl = options.fs || fs;
  const isAlive = options.isAlive || defaultIsAlive;
  if (!fsImpl.existsSync(paths.lockFile)) return false;
  return !ownerIsGone(readJson(fsImpl, paths.lockFile), isAlive);
}

/* ---------------------------- attempt record ------------------------- */

function readAttempt(paths, fsImpl = fs) {
  const record = readJson(fsImpl, paths.scanFile);
  return isPlainObject(record) ? record : null;
}

function writeAttempt(paths, record, fsImpl = fs) {
  fsImpl.mkdirSync(paths.runtimeDir, { recursive: true });
  if (fsImpl === fs) fsSafe.writeFileAtomic(paths.scanFile, JSON.stringify(record, null, 2) + '\n');
  else writeAtomicWith(fsImpl, paths.scanFile, JSON.stringify(record, null, 2) + '\n');
}

/** fsSafe's algorithm over an injected fs (tests inject write failures). */
function writeAtomicWith(fsImpl, filePath, data) {
  try {
    const st = fsImpl.statSync(filePath);
    if (st.size > 0) fsImpl.copyFileSync(filePath, `${filePath}.bak`);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const tmpPath = `${filePath}.tmp`;
  const fd = fsImpl.openSync(tmpPath, 'w');
  try {
    fsImpl.writeFileSync(fd, data);
    fsImpl.fsyncSync(fd);
  } finally {
    fsImpl.closeSync(fd);
  }
  fsImpl.renameSync(tmpPath, filePath);
}

function currentDigest(paths, fsImpl) {
  const live = readBytes(fsImpl, paths.map);
  return live.bytes ? digest(live.bytes) : null;
}

/**
 * Classify a `running` record whose process is gone. The artifact digest
 * decides whether publication happened before the process died: a changed,
 * valid artifact was published (acknowledgement unconfirmed) and is kept —
 * never rolled back to an older backup.
 */
function classifyOrphan(record, paths, fsImpl, now) {
  const artifactDigest = currentDigest(paths, fsImpl);
  const changed = artifactDigest !== (record.baselineDigest || null);
  const live = readBytes(fsImpl, paths.map);
  const validNow = Boolean(live.bytes) && Boolean(parseMap(live.bytes).data);
  const published = changed && validNow;
  return {
    ...record,
    state: 'interrupted',
    finishedAt: null,
    reconciledAt: now().toISOString(),
    published,
    acknowledged: false,
    artifactDigest,
    retainedPrevious: !published
  };
}

/* ------------------------------ recovery ----------------------------- */

class PreservationError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'PreservationError';
    this.code = 'E_STRUCTURE_PRESERVE';
    this.cause = cause;
  }
}

/**
 * Archive exact bytes at `recovery/<sha256>.json`. Identical content reuses
 * the existing record; records are never overwritten. Throws
 * PreservationError when the bytes cannot be made durable.
 */
function preserveBytes(paths, bytes, fsImpl = fs) {
  const target = path.join(paths.recoveryDir, `${digest(bytes)}.json`);
  try {
    fsImpl.mkdirSync(paths.recoveryDir, { recursive: true });
    const existing = readBytes(fsImpl, target);
    if (existing.bytes && existing.bytes.equals(bytes)) return target;
    const tmp = `${target}.tmp-${process.pid}`;
    const fd = fsImpl.openSync(tmp, 'w');
    try {
      fsImpl.writeFileSync(fd, bytes);
      fsImpl.fsyncSync(fd);
    } finally {
      fsImpl.closeSync(fd);
    }
    fsImpl.renameSync(tmp, target);
    const check = readBytes(fsImpl, target);
    if (!check.bytes || !check.bytes.equals(bytes)) throw new Error('recovery record does not match');
    return target;
  } catch (err) {
    throw new PreservationError(`could not preserve original map bytes: ${err.code || err.message}`, err);
  }
}

/* ---------------------------- the protocol --------------------------- */

function boundedDiagnostics(diagnostics) {
  if (!diagnostics) return { total: 0, truncated: false, samples: [] };
  if (Array.isArray(diagnostics)) {
    return {
      total: diagnostics.length,
      truncated: diagnostics.length > MAX_DIAGNOSTIC_SAMPLES,
      samples: diagnostics.slice(0, MAX_DIAGNOSTIC_SAMPLES)
    };
  }
  return diagnostics;
}

function relative(paths, file) {
  return path.relative(paths.rootDir, file).split(path.sep).join('/');
}

/**
 * Run one mutating attempt end to end.
 *
 * options:
 *   rootDir, mode ('full'|'delta'), attemptId (the parent's token, optional)
 *   build(baseline) → {
 *     candidate: Buffer|string|null   (null = no-op, nothing to write)
 *     inventory: { coverage: 'complete'|'partial'|'unknown', reasons }
 *     extraction: { coverage, counts }
 *     counts, diagnostics
 *     discardsAuthored: boolean       (authored content will not survive)
 *   }  — may throw (fatal: nothing is published)
 *   fs, isAlive, now, pid             injection points
 *   hooks: { beforePublish, afterPublish }  test-only interruption points
 *
 * Returns the result envelope:
 *   { state, mode, attemptId, published, artifact, retainedPrevious,
 *     artifactDigest, coverage, extraction, counts, diagnostics,
 *     recoveryPaths, persisted, reason, busy }
 * where `artifact` is 'written' | 'unchanged' | 'retained' | 'none'.
 */
function runAttempt(options) {
  const fsImpl = options.fs || fs;
  const now = options.now ? () => new Date(options.now()) : () => new Date();
  const paths = statePaths(options.rootDir, fsImpl);
  const attemptId = options.attemptId || crypto.randomUUID();
  const hooks = options.hooks || {};
  const pid = options.pid || process.pid;

  const envelope = {
    state: 'failed',
    mode: options.mode,
    attemptId,
    map: relative(paths, paths.map),
    published: false,
    artifact: 'none',
    retainedPrevious: false,
    artifactDigest: null,
    coverage: null,
    extraction: null,
    counts: null,
    diagnostics: { total: 0, truncated: false, samples: [] },
    recoveryPaths: [],
    persisted: false,
    reason: null,
    busy: false
  };

  const lock = acquireLock(paths, { fs: fsImpl, isAlive: options.isAlive, pid, attemptId, now: options.now });
  if (!lock.ok) {
    envelope.busy = lock.reason === 'busy';
    envelope.reason = lock.reason === 'busy' ? 'busy' : `lock-${(lock.error && lock.error.code) || 'error'}`;
    envelope.artifactDigest = currentDigest(paths, fsImpl);
    envelope.retainedPrevious = envelope.artifactDigest !== null;
    envelope.artifact = envelope.retainedPrevious ? 'retained' : 'none';
    return envelope;
  }

  let releaseOnExit = true;
  try {
    // Classify an orphaned attempt before starting ours.
    let previous = readAttempt(paths, fsImpl);
    if (previous && previous.state === 'running') previous = classifyOrphan(previous, paths, fsImpl, now);

    const baseline = readBaseline(paths.map, fsImpl);
    const running = {
      version: RECORD_VERSION,
      attemptId,
      pid,
      host: os.hostname(),
      mode: options.mode,
      state: 'running',
      startedAt: now().toISOString(),
      finishedAt: null,
      map: envelope.map,
      baselineDigest: baseline.liveDigest || null,
      ...(previous ? { previous: summarizePrevious(previous) } : {})
    };
    try {
      writeAttempt(paths, running, fsImpl);
    } catch (err) {
      // Without a persisted running record the protocol cannot promise an
      // honest outcome: publish nothing, report through the caller only.
      envelope.reason = `state-unwritable-${err.code || 'error'}`;
      envelope.artifactDigest = baseline.liveDigest || null;
      envelope.retainedPrevious = envelope.artifactDigest !== null;
      envelope.artifact = envelope.retainedPrevious ? 'retained' : 'none';
      return envelope;
    }

    const finish = (fields) => {
      Object.assign(envelope, fields);
      const record = {
        ...running,
        state: envelope.state,
        finishedAt: now().toISOString(),
        coverage: envelope.coverage,
        extraction: envelope.extraction,
        counts: envelope.counts,
        diagnostics: envelope.diagnostics,
        published: envelope.published,
        artifact: envelope.artifact,
        artifactDigest: envelope.artifactDigest,
        retainedPrevious: envelope.retainedPrevious,
        recoveryPaths: envelope.recoveryPaths,
        reason: envelope.reason
      };
      try {
        writeAttempt(paths, record, fsImpl);
        envelope.persisted = true;
      } catch (err) {
        envelope.persisted = false;
      }
      return envelope;
    };

    // A live file we cannot read cannot be preserved, so it is never replaced.
    if (baseline.unreadable) {
      return finish({ state: 'failed', reason: 'baseline-unreadable', artifact: 'retained', retainedPrevious: true });
    }

    let built;
    try {
      built = options.build(baseline);
    } catch (err) {
      return finish({
        state: 'failed',
        reason: err && err.code ? err.code : 'generation-failed',
        message: err && err.message,
        artifactDigest: baseline.liveDigest || null,
        retainedPrevious: Boolean(baseline.liveDigest),
        artifact: baseline.liveDigest ? 'retained' : 'none'
      });
    }

    const inventory = built.inventory || { coverage: 'unknown', reasons: [] };
    const extraction = built.extraction || null;
    const common = {
      coverage: inventory,
      extraction,
      counts: built.counts || null,
      diagnostics: boundedDiagnostics(built.diagnostics)
    };
    const degraded = inventory.coverage === 'partial' || (extraction && extraction.coverage === 'partial');
    const stateFor = () => (degraded ? 'partial' : 'complete');

    // No-op (delta with no changes): nothing to write.
    if (built.candidate === null || built.candidate === undefined) {
      return finish({
        ...common,
        state: stateFor(),
        published: baseline.status === 'valid',
        artifact: baseline.status === 'valid' ? 'unchanged' : 'none',
        artifactDigest: baseline.liveDigest || null
      });
    }

    const candidate = Buffer.isBuffer(built.candidate) ? built.candidate : Buffer.from(built.candidate, 'utf8');
    const candidateCheck = parseMap(candidate);
    if (!candidateCheck.data) {
      return finish({ ...common, state: 'failed', reason: `invalid-candidate-${candidateCheck.reason}`, artifactDigest: baseline.liveDigest || null, retainedPrevious: Boolean(baseline.liveDigest), artifact: baseline.liveDigest ? 'retained' : 'none' });
    }

    // Incomplete inventory: keep a usable live map byte-for-byte.
    const liveUsable = baseline.status === 'valid' && baseline.source === 'live' && isUsableMap(baseline.data);
    if (inventory.coverage === 'partial' && liveUsable) {
      return finish({
        ...common,
        state: 'partial',
        reason: 'incomplete-inventory',
        published: false,
        artifact: 'retained',
        retainedPrevious: true,
        artifactDigest: baseline.liveDigest
      });
    }

    // Identical bytes: nothing to write.
    if (baseline.liveBytes && baseline.liveBytes.equals(candidate)) {
      return finish({ ...common, state: stateFor(), published: true, artifact: 'unchanged', artifactDigest: baseline.liveDigest });
    }

    // Preserve before replacing anything malformed or authored.
    const recoveryPaths = [];
    try {
      if (baseline.liveBytes && (baseline.status === 'corrupt' || baseline.liveCorrupt || built.discardsAuthored)) {
        recoveryPaths.push(relative(paths, preserveBytes(paths, baseline.liveBytes, fsImpl)));
      }
      if (baseline.backupBytes && baseline.source === 'backup') {
        recoveryPaths.push(relative(paths, preserveBytes(paths, baseline.backupBytes, fsImpl)));
      }
    } catch (err) {
      return finish({
        ...common,
        state: 'failed',
        reason: 'preservation-failed',
        message: err.message,
        recoveryPaths,
        artifactDigest: baseline.liveDigest || null,
        retainedPrevious: Boolean(baseline.liveDigest),
        artifact: baseline.liveDigest ? 'retained' : 'none'
      });
    }

    if (hooks.beforePublish) hooks.beforePublish();
    try {
      fsImpl.mkdirSync(path.dirname(paths.map), { recursive: true });
      if (fsImpl === fs) fsSafe.writeFileAtomic(paths.map, candidate);
      else writeAtomicWith(fsImpl, paths.map, candidate);
    } catch (err) {
      return finish({
        ...common,
        state: 'failed',
        reason: `publish-failed-${err.code || 'error'}`,
        recoveryPaths,
        artifactDigest: currentDigest(paths, fsImpl),
        retainedPrevious: Boolean(baseline.liveDigest),
        artifact: baseline.liveDigest ? 'retained' : 'none'
      });
    }
    if (hooks.afterPublish) hooks.afterPublish();

    return finish({
      ...common,
      state: stateFor(),
      reason: inventory.coverage === 'partial' ? 'incomplete-inventory' : (degraded ? 'extraction-errors' : null),
      published: true,
      artifact: 'written',
      retainedPrevious: false,
      recoveryPaths,
      artifactDigest: digest(candidate)
    });
  } catch (err) {
    if (err && err.simulatedCrash) {
      // Test hook: behave like a killed process — no record, no release.
      releaseOnExit = false;
    }
    throw err;
  } finally {
    if (releaseOnExit) releaseLock(paths, lock.token, fsImpl);
  }
}

function summarizePrevious(record) {
  return {
    attemptId: record.attemptId || null,
    state: record.state || null,
    published: Boolean(record.published),
    acknowledged: record.acknowledged !== false,
    artifactDigest: record.artifactDigest || null
  };
}

/**
 * Parent-side reconciliation after its child exited without a usable
 * result (timeout, signal, crash). Only the attempt `attemptId` owns may be
 * touched, only under the writer lock, and only while it is still the
 * latest attempt — a newer attempt always takes precedence. A still-running
 * child keeps its lock (its pid is alive), so this returns busy instead of
 * letting a second publisher through.
 *
 * Returns { outcome: 'reconciled'|'finished'|'superseded'|'busy'|'missing', record }.
 */
function reconcileAttempt(rootDir, attemptId, options = {}) {
  const fsImpl = options.fs || fs;
  const now = options.now ? () => new Date(options.now()) : () => new Date();
  const paths = statePaths(rootDir, fsImpl);
  const lock = acquireLock(paths, { fs: fsImpl, isAlive: options.isAlive, pid: options.pid, now: options.now });
  if (!lock.ok) return { outcome: 'busy', record: readAttempt(paths, fsImpl) };
  try {
    const record = readAttempt(paths, fsImpl);
    if (!record) return { outcome: 'missing', record: null };
    if (record.attemptId !== attemptId) return { outcome: 'superseded', record };
    if (record.state !== 'running') return { outcome: 'finished', record };
    const classified = classifyOrphan(record, paths, fsImpl, now);
    try {
      writeAttempt(paths, classified, fsImpl);
    } catch (err) {
      return { outcome: 'reconciled', record: classified, persisted: false };
    }
    return { outcome: 'reconciled', record: classified, persisted: true };
  } finally {
    releaseLock(paths, lock.token, fsImpl);
  }
}

/**
 * Read-only view for `--check`: no lock, no writes. `stable()` re-reads the
 * artifact digest and writer state so a check that raced a writer can
 * report "cannot verify" instead of comparing mixed generations.
 */
function snapshot(rootDir, options = {}) {
  const fsImpl = options.fs || fs;
  const paths = statePaths(rootDir, fsImpl);
  const activeAtStart = writerActive(paths, options);
  const baseline = readBaseline(paths.map, fsImpl);
  return {
    paths,
    baseline,
    writerActive: activeAtStart,
    attempt: readAttempt(paths, fsImpl),
    stable() {
      if (activeAtStart || writerActive(paths, options)) return false;
      return currentDigest(paths, fsImpl) === (baseline.liveDigest || null);
    }
  };
}

module.exports = {
  resolveStructurePath,
  statePaths,
  validateStructure,
  isUsableMap,
  readBaseline,
  acquireLock,
  releaseLock,
  writerActive,
  readAttempt,
  preserveBytes,
  runAttempt,
  reconcileAttempt,
  snapshot,
  digest,
  PreservationError
};
