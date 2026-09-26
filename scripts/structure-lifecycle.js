#!/usr/bin/env node
/**
 * STRUCTURE lifecycle — keeps the working-tree map current (STR-02).
 *
 *   node structure-lifecycle.js --once [--json]   one full-hash reconciliation
 *   node structure-lifecycle.js --watch           foreground coordinator
 *   node structure-lifecycle.js --supervised      the app's child process
 *
 * Two parts: the scheduler (a pure, clock-injected state machine turning
 * change notifications into a bounded sequence of reconciliation jobs) and
 * the worker (one reconciliation through the STR-01 pipeline, the runtime
 * receipt structure-read.js reads, notifications, and the commands). Every
 * publication is a full STR-01 build — content hashes and cached extraction
 * make it cheap — so the incremental result is the full-scan result by
 * construction. No search hook runs this; it never executes project code.
 *
 * Scheduling rules:
 *   • ordinary file events coalesce for `debounceMs` (300 ms) after the last
 *     event, and never wait longer than `maxWaitMs` (2 s) from the first
 *     event of a burst
 *   • jobs are serialized; events arriving while a job runs produce exactly
 *     one follow-up job, however many there were
 *   • structural signals (directory changes, ignore/config/curation files,
 *     Git control state, watcher errors, overflow) and explicit reconcile
 *     requests (attach, periodic tick, resume, reopen) ask for a full-hash
 *     reconciliation, which also coalesces
 *   • a job's result is published even if newer events arrived — it is a
 *     consistent observation, and the pending epoch keeps readers from
 *     calling it fresh; only a job older than what is already applied is
 *     superseded
 *   • mixed observations retry with a full hash a bounded number of times,
 *     then report a missed bound; failures and timeouts report a missed
 *     bound and keep the change dirty for the next request
 *   • while paused nothing runs; events are still recorded, and resuming
 *     requests a reconciliation
 */

'use strict';

const DEFAULTS = Object.freeze({
  debounceMs: 300,
  maxWaitMs: 2000,
  maxRetries: 2,
  retryDelayMs: 300,
  scanBudgetMs: 30000
});

/** Result statuses a job may report back to the scheduler. */
const APPLIED = new Set(['published', 'unchanged']);

/**
 * createScheduler({ clock, run, onReport, ...DEFAULTS })
 *
 *   clock     { now(), setTimeout(fn, ms), clearTimeout(handle) }
 *   run(job)  async; job = { epoch, fullHash, reasons, attempt } →
 *             { status: 'published'|'unchanged'|'mixed'|'superseded'|
 *                       'busy'|'failed'|'timeout', ... }
 *   onReport  receives { type: 'job'|'missed-bound', ... } for activity and
 *             receipts; never required for correctness
 *
 * Returns { notify, requestReconcile, pause, resume, status, idle, dispose }.
 */
function createScheduler(options) {
  const opts = { ...DEFAULTS, ...options };
  const { clock, run } = opts;
  const report = typeof opts.onReport === 'function' ? opts.onReport : () => {};

  const state = {
    requestedEpoch: 0,
    appliedEpoch: 0,
    dirty: new Set(),
    pendingFull: false,
    burstStartedAt: null,
    timer: null,
    running: null,
    followUp: false,
    paused: false,
    disposed: false,
    retries: 0,
    jobs: 0
  };
  let idleWaiters = [];

  function settleIdle() {
    if (state.running || state.timer || state.followUp) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  function clearTimer() {
    if (state.timer) {
      clock.clearTimeout(state.timer);
      state.timer = null;
    }
  }

  function schedule(delayMs) {
    clearTimer();
    state.timer = clock.setTimeout(() => {
      state.timer = null;
      flush();
    }, Math.max(0, delayMs));
  }

  /** Register a change; `full` asks for a full-hash reconciliation. */
  function record(reason, full) {
    if (state.disposed) return;
    state.requestedEpoch++;
    if (reason) state.dirty.add(reason);
    if (full) state.pendingFull = true;
    if (state.paused) return;
    if (state.running) {
      state.followUp = true;
      return;
    }
    const now = clock.now();
    if (state.burstStartedAt === null) state.burstStartedAt = now;
    const deadline = state.burstStartedAt + opts.maxWaitMs;
    schedule(Math.min(opts.debounceMs, deadline - now));
  }

  function notify(event = {}) {
    record(event.reason || 'file-event', Boolean(event.full));
  }

  function requestReconcile(reason = 'reconcile') {
    record(reason, true);
  }

  async function flush() {
    if (state.disposed || state.paused || state.running) return;
    state.burstStartedAt = null;
    const job = {
      epoch: state.requestedEpoch,
      fullHash: state.pendingFull,
      reasons: [...state.dirty],
      attempt: state.retries
    };
    state.pendingFull = false;
    state.followUp = false;
    state.jobs++;
    const startedAt = clock.now();
    state.running = job;

    let result;
    try {
      result = await run(job);
    } catch (err) {
      result = { status: 'failed', error: err && err.message };
    }
    if (state.disposed) return;
    state.running = null;
    const duration = clock.now() - startedAt;
    const status = result && result.status ? result.status : 'failed';
    // State first, then the report: a listener that persists status must see
    // the job already applied.
    if (APPLIED.has(status)) {
      if (job.epoch > state.appliedEpoch) state.appliedEpoch = job.epoch;
      if (state.appliedEpoch >= state.requestedEpoch) state.dirty.clear();
    }
    report({ type: 'job', epoch: job.epoch, fullHash: job.fullHash, status, ms: duration, reasons: job.reasons });

    if (APPLIED.has(status)) {
      state.retries = 0;
      if (duration > opts.scanBudgetMs) report({ type: 'missed-bound', reason: 'scan-budget', ms: duration });
    } else if (status === 'mixed' || status === 'busy') {
      if (state.retries < opts.maxRetries) {
        state.retries++;
        state.pendingFull = state.pendingFull || status === 'mixed';
        state.followUp = false;
        if (!state.paused) schedule(opts.retryDelayMs);
        settleIdle();
        return;
      }
      state.retries = 0;
      report({ type: 'missed-bound', reason: status === 'mixed' ? 'changing-files' : 'writer-busy' });
    } else if (status !== 'superseded') {
      state.retries = 0;
      report({ type: 'missed-bound', reason: status });
    }

    if (state.followUp && !state.paused) {
      state.followUp = false;
      schedule(0);
    }
    settleIdle();
  }

  function pause() {
    state.paused = true;
    clearTimer();
    state.burstStartedAt = null;
    settleIdle();
  }

  function resume() {
    if (!state.paused) return;
    state.paused = false;
    requestReconcile('resume');
  }

  function status() {
    return {
      requestedEpoch: state.requestedEpoch,
      appliedEpoch: state.appliedEpoch,
      dirty: [...state.dirty],
      pending: state.requestedEpoch > state.appliedEpoch,
      running: Boolean(state.running),
      paused: state.paused,
      jobs: state.jobs
    };
  }

  /** Resolves when no job is running or scheduled (tests, shutdown). */
  function idle() {
    if (!state.running && !state.timer && !state.followUp) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.push(resolve));
  }

  function dispose() {
    state.disposed = true;
    clearTimer();
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  return { notify, requestReconcile, pause, resume, status, idle, dispose };
}

/* ========================================================================
 * The worker: one reconciliation, the receipt, notifications, commands.
 * ===================================================================== */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Loaded lazily so the scheduler above stays importable on its own.
function helpers() {
  return {
    discovery: require('./structure-discovery'),
    generation: require('./structure-generation'),
    state: require('./structure-state'),
    snapshot: require('./structure-snapshot'),
    read: require('./structure-read')
  };
}

const PERIODIC_MS = 60000;
const MAX_DIRECTORY_WATCHERS = 2048;
const RESULT_SCHEMA = 'frame.structure.lifecycle/1';

// Git control files whose change means the checkout itself moved (branch
// switch, merge, rebase, cherry-pick). The index is deliberately absent:
// `git status` rewrites it constantly and a staged change alters no file.
const GIT_CONTROL_FILES = new Set(['HEAD', 'ORIG_HEAD', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REBASE_HEAD', 'FETCH_HEAD']);

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function runtimeDir(root) {
  return path.join(root, '.frame', 'runtime', 'structure');
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

/* ------------------------------ lifecycle.json --------------------------- */

function readLifecycle(root) {
  return readJson(helpers().read.lifecyclePath(root));
}

/**
 * Merge `patch` into lifecycle.json. Only the worker writes it; the receipt
 * is written after the artifact it describes has been published.
 */
function writeLifecycle(root, patch) {
  const current = readLifecycle(root) || {};
  const next = { version: 1, checkout: fs.realpathSync(root), ...current, ...patch };
  writeJsonAtomic(helpers().read.lifecyclePath(root), next);
  return next;
}

/* ------------------------------ reconciliation --------------------------- */

function curationDigest() {
  try {
    return sha256(fs.readFileSync(path.join(__dirname, 'intent-map.json')));
  } catch (e) {
    return sha256('');
  }
}

function projectBlock(root) {
  const config = readJson(path.join(root, '.frame', 'config.json'));
  return config && config.project && typeof config.project === 'object' ? config.project : {};
}

/**
 * One full reconciliation of the working tree: discover, observe content
 * (stat-gated unless `fullHash`), build with cached extraction, publish
 * through STR-01's writer, then record the receipt.
 *
 * Returns { status, ... } for the scheduler:
 *   published | unchanged   the map now reflects this observation
 *   mixed                   files changed while observed; nothing published
 *   busy | timeout | failed not applied (reported as a missed bound)
 */
function reconcile(root, job = {}) {
  const { discovery, generation, state, snapshot, read } = helpers();
  const startedAt = Date.now();
  let loaded;
  let found;
  try {
    loaded = discovery.loadProjectStructureConfig(root);
    found = discovery.discover(root, { structure: loaded.structure, legacyFiles: loaded.legacyFiles });
  } catch (err) {
    return { status: 'failed', reason: err.code || 'discovery-failed', message: err.message };
  }
  const budget = found.policy.limits.timeoutMs;
  const deadline = startedAt + budget;

  const previous = snapshot.loadManifest(root);
  const observed = snapshot.observe(root, found, {
    manifest: previous,
    fullHash: Boolean(job.fullHash),
    shouldStop: () => Date.now() > deadline
  });
  if (observed.stopped) return { status: 'timeout', reason: 'scan-budget' };
  if (observed.mixed.length) return { status: 'mixed', paths: observed.mixed.slice(0, 20) };

  const cache = snapshot.createExtractionCache(root, observed.manifest);
  const curation = generation.loadCuration(__dirname);
  let report = null;
  const result = state.runAttempt({
    rootDir: root,
    mode: 'full',
    precondition: () => cache.mixed.length === 0,
    build: (baseline) => {
      const prior = baseline.status === 'valid' ? baseline.data : null;
      const built = generation.buildFull({
        rootDir: root, discovery: found, prior, curation, projectConfig: projectBlock(root), extract: cache.extract
      });
      report = built.report;
      return {
        candidate: generation.serializeStructure(built.structure, prior),
        inventory: built.structure.generation.inventory,
        extraction: built.report.extraction,
        counts: built.structure.generation.counts,
        diagnostics: built.structure.generation.diagnostics,
        discardsAuthored: built.report.discarded.length > 0
      };
    }
  });

  if (result.busy) return { status: 'busy' };
  if (result.state === 'superseded') return cache.mixed.length ? { status: 'mixed', paths: cache.mixed.slice(0, 20) } : { status: 'superseded' };
  if (result.state === 'failed' || !report) return { status: 'failed', reason: result.reason, message: result.message };

  snapshot.saveManifest(root, observed.manifest);
  cache.prune();

  // The receipt describes what is on disk now (written, unchanged or a
  // retained older map after an incomplete inventory).
  const mapPath = state.resolveStructurePath(root);
  let bytes = null;
  let stat = null;
  try {
    bytes = fs.readFileSync(mapPath);
    stat = fs.lstatSync(mapPath);
  } catch (e) {
    return { status: 'failed', reason: 'artifact-unreadable' };
  }
  let revision = null;
  try {
    revision = JSON.parse(bytes.toString('utf8')).generation.revision || null;
  } catch (e) {
    revision = null;
  }
  const receipt = {
    view: 'working-tree',
    revision,
    artifactDigest: sha256(bytes),
    artifactStat: read.artifactSignature(stat),
    sourceDigest: observed.sourceDigest,
    policyDigest: sha256(JSON.stringify(found.policy)),
    curationDigest: curationDigest(),
    observedAt: new Date().toISOString(),
    leaseMs: PERIODIC_MS + budget,
    coverage: found.coverage,
    extraction: report.extraction.coverage
  };
  return {
    status: result.artifact === 'written' ? 'published' : 'unchanged',
    receipt,
    changed: observed.changed.length,
    removed: observed.removed.length,
    hashed: observed.hashed,
    reused: observed.reused,
    cacheHits: cache.stats.hits,
    ms: Date.now() - startedAt
  };
}

/* -------------------------------- ownership ------------------------------ */

function ownerPaths(root) {
  return { runtimeDir: runtimeDir(root), lockFile: path.join(runtimeDir(root), 'lifecycle.owner') };
}

/** One coordinator per checkout; reclaimed only from a demonstrably dead owner. */
function acquireOwner(root, options = {}) {
  return helpers().state.acquireLock(ownerPaths(root), { isAlive: options.isAlive, pid: options.pid });
}

function releaseOwner(root, token) {
  return helpers().state.releaseLock(ownerPaths(root), token);
}

/* ------------------------------ notifications ---------------------------- */

/** Git directories of a checkout, from `.git` or a `gitdir:` file. No Git process. */
function resolveGitDirs(root) {
  const dotgit = path.join(root, '.git');
  let stat;
  try {
    stat = fs.lstatSync(dotgit);
  } catch (e) {
    return null;
  }
  if (stat.isDirectory()) return { gitDir: dotgit, inside: true };
  if (!stat.isFile()) return null;
  const match = /^gitdir:\s*(.+)\s*$/m.exec(fs.readFileSync(dotgit, 'utf8'));
  if (!match) return null;
  const gitDir = path.resolve(root, match[1].trim());
  return { gitDir, inside: !path.relative(root, gitDir).startsWith('..') };
}

/**
 * Classify one notification (root-relative POSIX path, or null) into a
 * scheduler event, or null to ignore it (our own writes, non-inputs).
 */
function classify(rel, ownedRootMap) {
  if (rel === null || rel === undefined || rel === '') return { reason: 'unknown-change', full: true };
  const parts = rel.split('/');
  if (parts[0] === '.git') return parts.length === 2 && GIT_CONTROL_FILES.has(parts[1]) ? { reason: 'git-state', full: true } : null;
  if (parts[0] === '.frame') {
    if (rel === '.frame/config.json') return { reason: 'config', full: true };
    if (rel === '.frame/bin/intent-map.json') return { reason: 'curation', full: true };
    return null; // map, runtime, tools, meta files: never inputs
  }
  if (ownedRootMap && (rel === 'STRUCTURE.json' || rel.startsWith('STRUCTURE.json.'))) return null;
  if (parts[parts.length - 1] === '.gitignore') return { reason: 'gitignore', full: true };
  return { reason: 'file-event', full: false, path: rel };
}

function ownsRootMap(root) {
  const config = readJson(path.join(root, '.frame', 'config.json'));
  return Boolean(config && config.files && Object.values(config.files).includes('STRUCTURE.json'));
}

/**
 * Watch a checkout. Recursive watching where the runtime supports it,
 * otherwise one watcher per directory (capped). Directory events and watcher
 * errors ask for a full reconciliation; periodic reconciliation covers what
 * notifications miss either way.
 */
function createWatcher(root, onEvent, options = {}) {
  const watchers = new Map();
  const ownedRootMap = ownsRootMap(root);
  let mode = 'none';
  let capped = false;

  const emit = (rel) => {
    const event = classify(rel, ownedRootMap);
    if (!event) return;
    if (!event.full && rel) {
      try {
        if (fs.lstatSync(path.join(root, ...rel.split('/'))).isDirectory()) {
          event.full = true;
          event.reason = 'directory';
          if (mode === 'per-directory') addDirectory(rel);
        }
      } catch (e) {
        /* deleted: an ordinary change */
      }
    }
    onEvent(event);
  };

  const onError = () => onEvent({ reason: 'watcher-error', full: true, watcherFailed: true });

  function watchOne(dirRel, recursive) {
    const abs = dirRel ? path.join(root, ...dirRel.split('/')) : root;
    const watcher = fs.watch(abs, { recursive }, (eventType, filename) => {
      if (filename === null || filename === undefined) return emit(null);
      const name = String(filename).split(path.sep).join('/');
      emit(dirRel ? `${dirRel}/${name}` : name);
    });
    watcher.on('error', onError);
    watchers.set(dirRel || '.', watcher);
  }

  function addDirectory(dirRel) {
    if (watchers.has(dirRel || '.')) return;
    if (watchers.size >= MAX_DIRECTORY_WATCHERS) {
      capped = true;
      return;
    }
    try {
      watchOne(dirRel, false);
    } catch (e) {
      /* vanished or unreadable: periodic reconciliation covers it */
    }
  }

  function start(directories) {
    // Native recursive watching is efficient on macOS and Windows. Linux's
    // (Node 20+) watches every subdirectory itself, node_modules included,
    // and can exhaust inotify limits — use the bounded per-directory mode.
    const recursiveNative = process.platform === 'darwin' || process.platform === 'win32';
    if (recursiveNative && !options.forcePerDirectory) {
      try {
        watchOne('', true);
        mode = 'recursive';
      } catch (e) {
        mode = 'per-directory';
      }
    } else {
      mode = 'per-directory';
    }
    if (mode === 'per-directory') {
      addDirectory('');
      // Inputs outside the inventory: policy/config and curation.
      addDirectory('.frame');
      addDirectory('.frame/bin');
      for (const dir of directories) addDirectory(dir);
    }
    const git = resolveGitDirs(root);
    if (git && (!git.inside || mode === 'per-directory')) {
      try {
        const watcher = fs.watch(git.gitDir, (eventType, filename) => {
          if (filename && GIT_CONTROL_FILES.has(String(filename))) onEvent({ reason: 'git-state', full: true });
        });
        watcher.on('error', onError);
        watchers.set(`git:${git.gitDir}`, watcher);
      } catch (e) {
        /* no control-state notifications: periodic reconciliation covers it */
      }
    }
  }

  function close() {
    for (const watcher of watchers.values()) {
      try { watcher.close(); } catch (e) { /* ignore */ }
    }
    watchers.clear();
  }

  return {
    start,
    close,
    addDirectory,
    info: () => ({ mode, watchers: watchers.size, capped })
  };
}

/** Directories to watch in per-directory mode: parents of eligible files. */
function directoriesOf(root) {
  try {
    const { discovery } = helpers();
    const loaded = discovery.loadProjectStructureConfig(root);
    const found = discovery.discover(root, { structure: loaded.structure, legacyFiles: loaded.legacyFiles });
    const dirs = new Set();
    for (const file of found.files) {
      const parts = file.path.split('/');
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    }
    return [...dirs].sort().slice(0, MAX_DIRECTORY_WATCHERS);
  } catch (e) {
    return [];
  }
}

/* --------------------------------- worker -------------------------------- */

/**
 * Run the lifecycle for one checkout until stopped.
 *
 * options:
 *   supervised   no own timer; the caller drives `tick()` (the app does it
 *                through pollGate)
 *   periodicMs   own reconciliation interval in watch mode (60 s)
 *   onReport     job and missed-bound reports
 *   forcePerDirectory, isAlive  test hooks
 *
 * Returns { ok: false, reason: 'busy' } when another live coordinator owns
 * the checkout, otherwise a handle { tick, pause, resume, requestReconcile,
 * status, idle, stop }.
 */
function startWorker(root, options = {}) {
  const owner = acquireOwner(root, { isAlive: options.isAlive });
  if (!owner.ok) return { ok: false, reason: owner.reason, owner: owner.owner };

  const report = typeof options.onReport === 'function' ? options.onReport : () => {};
  let stopped = false;
  let persisted = '';
  let watcher = null;

  // Readers must see pending changes promptly, but a burst must not become
  // a write per event: persist only when pending flips or a new reason shows.
  const persistPending = () => {
    const status = scheduler.status();
    const key = status.pending ? `pending:${status.dirty.slice().sort().join(',')}` : 'clean';
    if (key === persisted) return;
    persisted = key;
    try {
      writeLifecycle(root, {
        epoch: { requested: status.requestedEpoch, applied: status.appliedEpoch },
        dirty: status.dirty
      });
    } catch (e) {
      /* a runtime that cannot be written only loses freshness */
    }
  };

  const scheduler = createScheduler({
    clock: { now: Date.now, setTimeout, clearTimeout },
    onReport: (r) => {
      report(r);
      if (r.type === 'missed-bound') {
        try {
          writeLifecycle(root, { missedBound: { reason: r.reason, at: new Date().toISOString() } });
        } catch (e) {
          /* ignore */
        }
      }
      persistPending();
    },
    run: async (job) => {
      const result = reconcile(root, job);
      if (result.receipt) {
        const status = scheduler.status();
        const pendingAfter = status.requestedEpoch > job.epoch;
        try {
          writeLifecycle(root, {
            epoch: { requested: status.requestedEpoch, applied: job.epoch },
            dirty: pendingAfter ? status.dirty : [],
            missedBound: null,
            receipt: result.receipt
          });
          persisted = pendingAfter ? persisted : 'clean';
        } catch (e) {
          /* ignore */
        }
      }
      if (watcher && result.status !== 'mixed' && watcher.failed) {
        watcher.failed = false;
        armWatcher();
      }
      return result;
    }
  });

  const onEvent = (event) => {
    if (stopped) return;
    if (event.watcherFailed && watcher) watcher.failed = true;
    scheduler.notify(event);
    persistPending();
  };

  function armWatcher() {
    if (watcher) watcher.close();
    watcher = createWatcher(root, onEvent, { forcePerDirectory: options.forcePerDirectory });
    watcher.failed = false;
    try {
      watcher.start(directoriesOf(root));
    } catch (e) {
      watcher.failed = true;
    }
  }

  armWatcher();
  scheduler.requestReconcile('attach');

  let timer = null;
  if (!options.supervised) {
    timer = setInterval(() => scheduler.requestReconcile('periodic'), options.periodicMs || PERIODIC_MS);
    if (timer.unref) timer.unref();
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (timer) clearInterval(timer);
    if (watcher) watcher.close();
    scheduler.dispose();
    releaseOwner(root, owner.token);
  }

  return {
    ok: true,
    tick: () => scheduler.requestReconcile('periodic'),
    requestReconcile: (reason) => scheduler.requestReconcile(reason || 'reconcile'),
    pause: () => scheduler.pause(),
    resume: () => scheduler.resume(),
    status: () => ({ ...scheduler.status(), watcher: watcher ? watcher.info() : null }),
    idle: () => scheduler.idle(),
    stop
  };
}

/* ---------------------------------- CLI ---------------------------------- */

function resolveProjectRoot() {
  if (process.env.FRAME_PROJECT_ROOT) return path.resolve(process.env.FRAME_PROJECT_ROOT);
  if (path.basename(__dirname) === 'bin' && path.basename(path.dirname(__dirname)) === '.frame') {
    return path.dirname(path.dirname(__dirname));
  }
  if (path.basename(__dirname) === 'scripts') return path.join(__dirname, '..');
  return process.cwd();
}

function writeLine(stream, value) {
  stream.write(`${JSON.stringify(value)}\n`);
}

function runOnce(root, json) {
  const result = reconcile(root, { fullHash: true });
  if (result.receipt) {
    try {
      writeLifecycle(root, { receipt: result.receipt });
    } catch (e) {
      /* ignore */
    }
  }
  const exitCode = result.status === 'published' || result.status === 'unchanged' ? 0 : 2;
  const envelope = { schema: RESULT_SCHEMA, command: 'once', exitCode, ...result };
  if (json) writeLine(process.stdout, envelope);
  else process.stdout.write(`${result.status}${result.reason ? ` (${result.reason})` : ''}\n`);
  return exitCode;
}

/**
 * --watch: foreground coordinator with its own timer until SIGINT/SIGTERM.
 * --supervised: the app's child — no timer; JSON lines on stdin
 *   ({ "cmd": "tick" | "pause" | "resume" | "reconcile" | "stop" }), reports
 *   as JSON lines on stdout; exits when stdin closes.
 */
function runLongLived(root, supervised) {
  const out = (value) => writeLine(process.stdout, { schema: RESULT_SCHEMA, ...value });
  const worker = startWorker(root, { supervised, onReport: (r) => out({ type: r.type, ...r }) });
  if (!worker.ok) {
    process.stderr.write(`structure-lifecycle: another coordinator owns this checkout (pid ${worker.owner && worker.owner.pid})\n`);
    out({ type: 'busy' });
    process.exitCode = 2;
    return;
  }
  out({ type: 'started', mode: supervised ? 'supervised' : 'watch', watcher: worker.status().watcher });
  const shutdown = () => {
    worker.stop();
    out({ type: 'stopped' });
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  if (!supervised) return;
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      let message;
      try {
        message = JSON.parse(line);
      } catch (e) {
        continue;
      }
      if (message.cmd === 'tick') worker.tick();
      else if (message.cmd === 'pause') worker.pause();
      else if (message.cmd === 'resume') worker.resume();
      else if (message.cmd === 'reconcile') worker.requestReconcile(message.reason || 'reconcile');
      else if (message.cmd === 'stop') shutdown();
    }
  });
  process.stdin.on('end', shutdown);
}

function main() {
  const args = process.argv.slice(2);
  const known = new Set(['--once', '--watch', '--supervised', '--json']);
  const unknown = args.filter((a) => !known.has(a));
  const modes = ['--once', '--watch', '--supervised'].filter((m) => args.includes(m));
  if (unknown.length || modes.length !== 1) {
    process.stderr.write('usage: structure-lifecycle.js --once [--json] | --watch | --supervised\n');
    process.exitCode = 2;
    return;
  }
  const root = resolveProjectRoot();
  if (modes[0] === '--once') process.exitCode = runOnce(root, args.includes('--json'));
  else runLongLived(root, modes[0] === '--supervised');
}

if (require.main === module) main();

module.exports = {
  createScheduler,
  SCHEDULER_DEFAULTS: DEFAULTS,
  reconcile,
  startWorker,
  createWatcher,
  classify,
  resolveGitDirs,
  readLifecycle,
  writeLifecycle,
  acquireOwner,
  releaseOwner,
  PERIODIC_MS,
  MAX_DIRECTORY_WATCHERS
};
