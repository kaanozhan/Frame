/**
 * Telemetry policy tests — fail-closed opt-out decision.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 *
 * Targets the pure policy module (src/main/telemetryEvents.js); the Electron
 * side of telemetry.js is a thin wrapper over it.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { EVENTS, normalizeTool, validateEvent, effectiveEnabled, createRateLimiter, DEFAULT_RATE_LIMIT } = require('../src/main/telemetryEvents');

// ─── effectiveEnabled — the re-opt-in regression ──────────

test('never-set value on a healthy load defaults ON (opt-out semantics)', () => {
  assert.equal(effectiveEnabled({ value: null, loadFailed: false }), true);
});

test('explicit opt-out on a healthy load stays off', () => {
  assert.equal(effectiveEnabled({ value: false, loadFailed: false }), false);
});

test('explicit opt-in on a healthy load stays on', () => {
  assert.equal(effectiveEnabled({ value: true, loadFailed: false }), true);
});

test('failed settings load fails CLOSED regardless of the cached value', () => {
  // The re-opt-in bug: an unrecoverable user-settings.json used to reset the
  // cache to {} so `null !== false` re-enabled telemetry for opted-out users.
  assert.equal(effectiveEnabled({ value: null, loadFailed: true }), false);
  assert.equal(effectiveEnabled({ value: true, loadFailed: true }), false);
  assert.equal(effectiveEnabled({ value: false, loadFailed: true }), false);
});

// ─── The registry is enum-only ────────────────────────────

test('registry props are arrays of fixed strings — no free-form values possible', () => {
  for (const [event, schema] of Object.entries(EVENTS)) {
    for (const [prop, allowed] of Object.entries(schema)) {
      assert.ok(Array.isArray(allowed), `${event}.${prop} must be an enum array`);
      assert.ok(allowed.length > 0, `${event}.${prop} enum must not be empty`);
      for (const v of allowed) {
        assert.equal(typeof v, 'string', `${event}.${prop} values must be strings`);
      }
    }
  }
});

// ─── validateEvent ────────────────────────────────────────

test('unregistered event returns null', () => {
  assert.equal(validateEvent('made_up_event', {}), null);
});

test('registered event with no props passes with empty props', () => {
  assert.deepEqual(validateEvent('spec_created', undefined), {});
});

test('unknown props are stripped', () => {
  assert.deepEqual(
    validateEvent('spec_phase_advanced', { phase: 'planned', projectPath: '/Users/x/secret' }),
    { phase: 'planned' }
  );
});

test('out-of-enum values are stripped', () => {
  assert.deepEqual(validateEvent('spec_phase_advanced', { phase: 'not-a-phase' }), {});
  assert.deepEqual(validateEvent('error_occurred', { category: 'stack: at foo()' }), {});
});

test('tool props are normalized before the enum check', () => {
  assert.deepEqual(validateEvent('agent_run_started', { tool: 'claude-code' }), { tool: 'claude' });
  assert.deepEqual(validateEvent('ai_tool_selected', { tool: 'my-secret-tool' }), { tool: 'custom' });
});

// ─── normalizeTool ────────────────────────────────────────

test('normalizeTool collapses everything outside the built-ins to custom', () => {
  assert.equal(normalizeTool('claude'), 'claude');
  assert.equal(normalizeTool('codex'), 'codex');
  assert.equal(normalizeTool('gemini'), 'gemini');
  assert.equal(normalizeTool('claude-code'), 'claude');
  assert.equal(normalizeTool('aider'), 'custom');
  assert.equal(normalizeTool(''), 'custom');
  assert.equal(normalizeTool(undefined), 'custom');
  assert.equal(normalizeTool(null), 'custom');
});

// ─── Rate limiting — the quota is finite ──────────────────

test('normal use is never rate limited', () => {
  const limiter = createRateLimiter();
  // A busy minute of real user activity: every event goes out.
  for (let i = 0; i < DEFAULT_RATE_LIMIT.perWindow; i++) {
    assert.equal(limiter.check(1000 + i * 100).allowed, true, `event ${i} sent`);
  }
  assert.equal(limiter.stats().suppressed, 0);
});

test('a burst past the window cap is dropped, and says so once', () => {
  // Two Frames on one project: the older build walks spec phases back, this
  // one reconciles them forward, and the loop bills the analytics quota.
  const limiter = createRateLimiter();
  for (let i = 0; i < DEFAULT_RATE_LIMIT.perWindow; i++) limiter.check(1000);

  const first = limiter.check(1000);
  assert.equal(first.allowed, false, 'over the cap');
  assert.match(first.notice, /rate limit reached/, 'and it is reported');

  const next = limiter.check(1001);
  assert.equal(next.allowed, false);
  assert.equal(next.notice, null, 'but not reported per dropped event');

  assert.equal(limiter.stats().suppressed, 2);
});

test('the window rolls: a quiet minute restores the budget', () => {
  const limiter = createRateLimiter();
  for (let i = 0; i < DEFAULT_RATE_LIMIT.perWindow; i++) limiter.check(1000);
  assert.equal(limiter.check(1000).allowed, false);

  const later = 1000 + DEFAULT_RATE_LIMIT.windowMs;
  assert.equal(limiter.check(later).allowed, true, 'the old window has expired');
});

test('the session ceiling holds even when every window is under the cap', () => {
  // A slow loop — one event every few seconds, forever — stays under the
  // per-minute cap, so the session ceiling is what bounds it.
  const limiter = createRateLimiter({ perWindow: 1000, perSession: 5 });
  for (let i = 0; i < 5; i++) {
    assert.equal(limiter.check(i * 10_000).allowed, true);
  }
  const over = limiter.check(6 * 10_000);
  assert.equal(over.allowed, false);
  assert.match(over.notice, /this run has sent 5 events/);
});
