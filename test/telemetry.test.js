/**
 * Telemetry policy tests — fail-closed opt-out decision.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 *
 * Targets the pure policy module (src/main/telemetryEvents.js); the Electron
 * side of telemetry.js is a thin wrapper over it.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { EVENTS, normalizeTool, validateEvent, effectiveEnabled } = require('../src/main/telemetryEvents');

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
