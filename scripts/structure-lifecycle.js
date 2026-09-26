#!/usr/bin/env node
/**
 * STRUCTURE lifecycle — keeps the working-tree map current (STR-02).
 *
 * This file holds the scheduler: a pure, clock-injected state machine that
 * turns a stream of change notifications into a bounded sequence of
 * reconciliation jobs. The worker around it (notifications, receipts,
 * commands) builds on this export.
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
    report({ type: 'job', epoch: job.epoch, fullHash: job.fullHash, status, ms: duration, reasons: job.reasons });

    if (APPLIED.has(status)) {
      state.retries = 0;
      if (job.epoch > state.appliedEpoch) state.appliedEpoch = job.epoch;
      if (state.appliedEpoch >= state.requestedEpoch) state.dirty.clear();
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

module.exports = { createScheduler, SCHEDULER_DEFAULTS: DEFAULTS };
