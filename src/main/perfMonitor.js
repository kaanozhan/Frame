/**
 * perfMonitor — lightweight main-process performance instrumentation.
 *
 * Three primitives (plan: audit-q3-performance-resources):
 *   - Event-loop-lag sampler: a 500ms interval that measures timer drift;
 *     sustained drift above LAG_BUDGET_MS means something blocked the loop.
 *   - Operation timers: opStart(name)/opEnd(name) around hot operations
 *     (project init, structure bootstrap, spec push, usage poll).
 *   - Startup marks: mark(name) records ms since process start; the
 *     'did-finish-load' mark is the time-to-interactive proxy the startup
 *     budget (TTI ≤ 1500ms) is measured against.
 *
 * Dev-gated: active when NODE_ENV=development or FRAME_PERF=1. When
 * disabled, every call is a cheap no-op — safe to leave call sites in
 * production code. Logs through logger (electron-log) under the 'perf'
 * scope so numbers land in main.log with the rest of the diagnostics.
 */

const { performance } = require('perf_hooks');
const logger = require('./logger');

const SAMPLE_INTERVAL_MS = 500;
const LAG_BUDGET_MS = 50; // max tolerated main-thread block per operation
const TTI_BUDGET_MS = 1500; // cold-launch time-to-interactive budget

let enabled = false;
let samplerTimer = null;
let lastSampleAt = 0;
let maxLagMs = 0;

const marks = new Map(); // name -> ms since process start
const openOps = new Map(); // name -> start (performance.now())

function isEnabled() {
  return enabled;
}

function init() {
  enabled = process.env.NODE_ENV === 'development' || process.env.FRAME_PERF === '1';
  if (!enabled) return;
  startSampler();
  logger.info('perf', `instrumentation on (sample ${SAMPLE_INTERVAL_MS}ms, lag budget ${LAG_BUDGET_MS}ms, TTI budget ${TTI_BUDGET_MS}ms)`);
}

/**
 * Event-loop-lag sampler. The interval is expected to fire every
 * SAMPLE_INTERVAL_MS; anything beyond that is time the loop spent blocked.
 */
function startSampler() {
  if (samplerTimer) return;
  lastSampleAt = performance.now();
  samplerTimer = setInterval(() => {
    const now = performance.now();
    const lag = now - lastSampleAt - SAMPLE_INTERVAL_MS;
    lastSampleAt = now;
    if (lag > maxLagMs) maxLagMs = lag;
    if (lag > LAG_BUDGET_MS) {
      logger.warn('perf', `event-loop lag ${Math.round(lag)}ms (budget ${LAG_BUDGET_MS}ms)`);
    }
  }, SAMPLE_INTERVAL_MS);
  // Never keep the app alive just to sample it.
  if (typeof samplerTimer.unref === 'function') samplerTimer.unref();
}

function stopSampler() {
  if (samplerTimer) clearInterval(samplerTimer);
  samplerTimer = null;
}

/** Record a named startup mark as ms since process start. */
function mark(name) {
  if (!enabled) return;
  const at = Math.round(performance.now());
  marks.set(name, at);
  logger.info('perf', `mark ${name} @ ${at}ms`);
  if (name === 'did-finish-load' && at > TTI_BUDGET_MS) {
    logger.warn('perf', `startup TTI ${at}ms exceeds budget ${TTI_BUDGET_MS}ms`);
  }
}

/** Start timing a named operation. Nested/overlapping names overwrite. */
function opStart(name) {
  if (!enabled) return;
  openOps.set(name, performance.now());
}

/** Finish timing; logs the duration, warns past the block budget. */
function opEnd(name) {
  if (!enabled) return;
  const start = openOps.get(name);
  if (start === undefined) return;
  openOps.delete(name);
  const ms = Math.round(performance.now() - start);
  const level = ms > LAG_BUDGET_MS ? 'warn' : 'info';
  logger[level]('perf', `op ${name} took ${ms}ms${ms > LAG_BUDGET_MS ? ` (budget ${LAG_BUDGET_MS}ms)` : ''}`);
}

/** Snapshot for the measurement pass (T10) — marks, worst lag, budgets. */
function getSummary() {
  return {
    enabled,
    marks: Object.fromEntries(marks),
    maxLagMs: Math.round(maxLagMs),
    budgets: { lagMs: LAG_BUDGET_MS, ttiMs: TTI_BUDGET_MS }
  };
}

module.exports = { init, isEnabled, mark, opStart, opEnd, getSummary, stopSampler };
