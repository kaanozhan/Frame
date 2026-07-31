/**
 * Telemetry policy tests — fail-closed opt-out decision.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 *
 * Targets the pure policy module (src/main/telemetryEvents.js); the Electron
 * side of telemetry.js is a thin wrapper over it.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { EVENTS, normalizeTool, bucketCount, validateEvent, effectiveEnabled } = require('../src/main/telemetryEvents');

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

// ─── project_sharing_set ──────────────────────────────────

test('project_sharing_set passes validation with in-enum values', () => {
  assert.deepEqual(
    validateEvent('project_sharing_set', { mode: 'local', source: 'init' }),
    { mode: 'local', source: 'init' }
  );
  assert.deepEqual(
    validateEvent('project_sharing_set', { mode: 'repo', source: 'settings' }),
    { mode: 'repo', source: 'settings' }
  );
});

test('project_sharing_set strips out-of-enum values and unknown props', () => {
  assert.deepEqual(validateEvent('project_sharing_set', { mode: 'team', source: 'init' }), { source: 'init' });
  assert.deepEqual(
    validateEvent('project_sharing_set', { mode: 'repo', source: 'hint', projectPath: '/Users/x/secret' }),
    { mode: 'repo' }
  );
});

// ─── migration_failed ─────────────────────────────────────
//
// The one event the layout migration sends, and only when it aborts. It rides
// closest to user data of anything in the registry — it fires while Frame is
// moving named files around a named project — so the tests below are about
// what cannot get out, not only what gets through.

test('migration_failed passes its step and bucketed artifact count', () => {
  assert.deepEqual(
    validateEvent('migration_failed', { step: 'backup', artifacts: '4-6' }),
    { step: 'backup', artifacts: '4-6' }
  );
});

test('migration_failed cannot carry a path, an error message or a raw count', () => {
  assert.deepEqual(
    validateEvent('migration_failed', {
      step: 'move',
      artifacts: 6, // a number, not a bucket
      path: 'PROJECT_NOTES.md',
      error: "EACCES: permission denied, unlink '/Users/x/proj/CLAUDE.md'",
      project: 'secret-client-work',
    }),
    { step: 'move' }
  );
});

test('bucketCount is the only way a count reaches the wire, and it is coarse', () => {
  assert.equal(bucketCount(0), '0');
  assert.equal(bucketCount(1), '1-3');
  assert.equal(bucketCount(3), '1-3');
  assert.equal(bucketCount(4), '4-6');
  assert.equal(bucketCount(6), '4-6');
  assert.equal(bucketCount(7), '7+');
  assert.equal(bucketCount(4000), '7+');
  // Junk buckets to '0' rather than throwing: the event fires on a failure
  // path, where the count is exactly what may be missing.
  for (const junk of [undefined, null, NaN, Infinity, -3, '6']) {
    assert.equal(bucketCount(junk), '0', `${String(junk)} must bucket to 0`);
  }
});

test('every bucketCount output is in the registry enum', () => {
  for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 99]) {
    assert.ok(
      EVENTS.migration_failed.artifacts.includes(bucketCount(n)),
      `bucketCount(${n}) escaped the enum`
    );
  }
});
