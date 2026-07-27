/**
 * Activity log — the main-process side.
 *
 * The append contract itself lives in `scripts/activity-log.js`, because
 * half the work worth recording happens in processes Frame cannot see (the
 * git pre-commit hook, Claude Code's tool hooks, `implement-launch.js` with
 * the app closed). This module is the Electron-coupled half: it holds the
 * in-memory ring the panel reads first, enforces the rate cap, aggregates
 * suppression bursts, and knows which bucket the active project writes to.
 *
 * Split the way `telemetry.js` / `telemetryEvents.js` already are — policy in
 * a pure module that `node --test` can reach, Electron coupling here.
 *
 * The ring always fills, whatever the panel is doing. A monitor you have to
 * switch on before the bug happens is close to useless; by the time the user
 * opens the panel the history has to already be there.
 */

// `electron` is required lazily inside attachWindow, never at module scope.
// fsSafe, tasksManager and gitStatusManager all reach this module, and CI
// runs the suite with no node_modules at all — a top-level electron require
// here fails three otherwise-pure test files at load time.
const fsSafe = require('./fsSafe');
const { IPC } = require('../shared/ipcChannels');
const activityFile = require('../../scripts/activity-log');
const events = require('../shared/activityEvents');

// Enough to cover a long agent run without becoming a memory story of its own.
const RING_MAX = 2000;

// Per-event-name cap. A watcher stuck in a loop must not be able to flood
// either the record or the panel; the aggregation below means a legitimate
// burst reports its true count instead of being clipped by this.
const RATE_WINDOW_MS = 1000;
const RATE_MAX_PER_EVENT = 20;

// Suppression bursts collapse inside this window. Short enough that the
// panel still feels live, long enough that a debounce storm lands as one row.
const AGGREGATE_MS = 250;

// How long after our own append a watcher fire is still assumed to be ours.
// The foreign-append watcher (wired with the renderer push) reads this;
// without it the watcher would retrigger on this process's own writes —
// the exact loop class audit-q3-performance-resources T04 fixed in
// specManager with the same stamp.
const SELF_WRITE_GRACE_MS = 400;

const ring = [];
let projectBucket = null;
// Declared here because setProject (above the renderer wiring) re-points it.
let watchRecord = () => {};
let selfWriteAt = 0;
let started = false;

// event name -> { count, windowStart }
const rateState = new Map();
// signature -> { name, fields, repeats, timer }
const pending = new Map();

/**
 * Start the layer. Sweeps buckets nothing has written to in a week; the
 * sweep is deliberately fire-and-forget so a slow disk cannot delay boot.
 */
function init() {
  if (started) return;
  started = true;
  setImmediate(() => {
    try {
      activityFile.prune();
    } catch {
      /* best effort, always */
    }
  });
}

/** Point project-scoped events at this project's bucket. */
function setProject(projectPath) {
  const next = projectPath ? activityFile.projectKey(projectPath) : null;
  if (next === projectBucket) return;
  projectBucket = next;
  // Follow the project: the panel shows the active project's record, so the
  // foreign-append watcher has to move with it.
  if (mainWindow) watchRecord();
}

function bucketFor(opts) {
  if (opts && opts.appScoped) return activityFile.APP_BUCKET;
  return projectBucket || activityFile.APP_BUCKET;
}

function rateLimited(name, now) {
  const state = rateState.get(name);
  if (!state || now - state.windowStart > RATE_WINDOW_MS) {
    rateState.set(name, { count: 1, windowStart: now });
    return false;
  }
  state.count += 1;
  return state.count > RATE_MAX_PER_EVENT;
}

function pushRing(entry) {
  ring.push(entry);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
}

/** Overwritten by wireRenderer() once a window exists (T09). */
let onEntry = null;

function emit(name, fields, opts) {
  const record = events.buildRecord(name, fields);
  if (!record) return; // unregistered — the registry is the filter

  const entry = { ...record, t: new Date().toISOString() };
  const label = events.formatLabel(name, fields);
  if (label) entry.label = label;

  pushRing(entry);
  selfWriteAt = Date.now();
  // append() never rejects; the void is deliberate — a failed write must not
  // surface anywhere, least of all as an unhandled rejection.
  activityFile.append(bucketFor(opts), record);
  if (onEntry) onEntry(entry);
}

/**
 * Signature for burst aggregation: the event plus the fields that identify
 * *which* thing is repeating. Counts and durations are excluded — they are
 * what differs between fires of the same thing.
 */
function signature(name, fields) {
  const keys = Object.keys(fields || {})
    .filter((k) => !['changes', 'collapsed', 'repeats', 'ms', 'specs'].includes(k))
    .sort();
  return `${name}|${keys.map((k) => `${k}=${fields[k]}`).join('&')}`;
}

function flushPending(sig) {
  const held = pending.get(sig);
  if (!held) return;
  pending.delete(sig);
  const fields = { ...held.fields };
  if (held.repeats > 1) fields.repeats = held.repeats;
  emit(held.name, fields, held.opts);
}

/**
 * Record one event. Unregistered events are dropped, over-cap events are
 * dropped, and repeated suppressions collapse into a single record carrying
 * the true count — clipping a burst with the rate cap alone would make
 * "twelve fires" read as "one".
 */
function record(name, fields, opts) {
  try {
    if (!events.isRegistered(name)) return;
    const now = Date.now();
    if (rateLimited(name, now)) return;

    if (events.isSuppression(name)) {
      const sig = signature(name, fields);
      const held = pending.get(sig);
      if (held) {
        held.repeats += 1;
        return;
      }
      const timer = setTimeout(() => flushPending(sig), AGGREGATE_MS);
      // Never keep the app alive to flush a suppression record.
      if (typeof timer.unref === 'function') timer.unref();
      pending.set(sig, { name, fields, opts, repeats: 1, timer });
      return;
    }

    emit(name, fields, opts);
  } catch {
    // Recording must never be able to break the thing it observes.
  }
}

/** True when a watcher fire on the record is this process's own append. */
function isSelfWrite(now = Date.now()) {
  return now - selfWriteAt < SELF_WRITE_GRACE_MS;
}

/** Newest-last window over the in-memory ring. */
function recent(limit = RING_MAX) {
  return ring.slice(-limit);
}

/** The bucket key project-scoped events currently write to. */
function activeBucket() {
  return bucketFor(null);
}

// ─── renderer wiring ──────────────────────────────────────
//
// Two sources feed the panel. Our own records arrive through the ring, and
// records written by the other host processes — the git pre-commit hook,
// Claude Code's tool hooks, a run made while the app was closed — arrive by
// watching the file. Pushes are coalesced the way PTY output already is: the
// monitor must never become the load it exists to observe.

const PUSH_FLUSH_MS = 200;

let mainWindow = null;
let outbox = [];
let flushTimer = null;
let recordWatcher = null;
let watchedBucket = null;
let foreignOffset = 0;

function flushOutbox() {
  flushTimer = null;
  if (!outbox.length) return;
  const batch = outbox;
  outbox = [];
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send(IPC.ACTIVITY_DATA, { entries: batch });
  } catch {
    /* a closing window is not an error worth surfacing */
  }
}

function queueForRenderer(entry) {
  outbox.push(entry);
  if (outbox.length > RING_MAX) outbox.splice(0, outbox.length - RING_MAX);
  if (flushTimer) return;
  flushTimer = setTimeout(flushOutbox, PUSH_FLUSH_MS);
  if (typeof flushTimer.unref === 'function') flushTimer.unref();
}

/**
 * Read whatever the file gained since we last looked, dropping anything the
 * registry does not recognise — records written from `.frame/bin/` are built
 * by hand out there, so validation happens here on the way in.
 */
function drainForeign() {
  const all = activityFile.readRecent(watchedBucket, RING_MAX);
  if (all.length <= foreignOffset) {
    foreignOffset = all.length;
    return;
  }
  const fresh = all.slice(foreignOffset);
  foreignOffset = all.length;
  for (const raw of fresh) {
    if (!raw || !events.isRegistered(raw.ev)) continue;
    const entry = { ...events.buildRecord(raw.ev, raw), t: raw.t };
    const label = events.formatLabel(raw.ev, raw);
    if (label) entry.label = label;
    pushRing(entry);
    queueForRenderer(entry);
  }
}

watchRecord = function watchRecord() {
  if (recordWatcher) {
    try {
      recordWatcher.close();
    } catch {
      /* ignore */
    }
    recordWatcher = null;
  }
  watchedBucket = activeBucket();
  foreignOffset = activityFile.readRecent(watchedBucket, RING_MAX).length;
  try {
    recordWatcher = fsSafe.safeWatch(
      activityFile.bucketDir(watchedBucket),
      null,
      () => {
        // We append to the file we watch, so without this stamp every one of
        // our own records would come straight back as a foreign one — the
        // self-write loop this whole layer exists to make visible.
        if (isSelfWrite()) return;
        drainForeign();
      },
      () => {
        recordWatcher = null;
      }
    );
  } catch {
    /* no bucket dir yet — the next setProject will try again */
  }
};

/**
 * Attach the window and serve the backlog. The backlog deliberately comes
 * off disk rather than the ring: `implement-launch.js` and the git hook
 * write with the app closed, and those events have to be there when it opens.
 */
function attachWindow(window) {
  const { ipcMain } = require('electron');
  mainWindow = window;
  onEntry = queueForRenderer;
  watchRecord();

  ipcMain.handle(IPC.GET_ACTIVITY, () => {
    const bucket = activeBucket();
    const fromDisk = activityFile
      .readRecent(bucket, RING_MAX)
      .filter((r) => r && events.isRegistered(r.ev))
      .map((r) => {
        const entry = { ...events.buildRecord(r.ev, r), t: r.t };
        const label = events.formatLabel(r.ev, r);
        if (label) entry.label = label;
        return entry;
      });
    return { bucket, entries: fromDisk.slice(-RING_MAX) };
  });
}

module.exports = {
  RING_MAX,
  RATE_MAX_PER_EVENT,
  AGGREGATE_MS,
  SELF_WRITE_GRACE_MS,
  PUSH_FLUSH_MS,
  init,
  setProject,
  attachWindow,
  record,
  recent,
  isSelfWrite,
  activeBucket
};
