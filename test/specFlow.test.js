/**
 * specFlow — the flow-mode rules (full-auto-spec-flow spec, T01).
 * Pinned: unknown or missing flow_mode behaves as today, a run starts only on
 * a live transition of a bound spec at `specified`, resume is offered only
 * with no live run and work left, and the locked bar names the stage.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/shared/specFlow');

test('normalizeFlowMode accepts the two modes and nothing else', () => {
  assert.equal(F.normalizeFlowMode({ flow_mode: 'full-auto' }), 'full-auto');
  assert.equal(F.normalizeFlowMode({ flow_mode: 'step-by-step' }), 'step-by-step');
  assert.equal(F.normalizeFlowMode({ flow_mode: 'autonomous' }), null);
  assert.equal(F.normalizeFlowMode({}), null);
  assert.equal(F.normalizeFlowMode(null), null);
});

test('shouldStartFullAuto fires only on a live transition of a bound spec at specified', () => {
  const before = { slug: 'a', phase: 'specified' };
  const after = { slug: 'a', phase: 'specified', flow_mode: 'full-auto' };
  assert.equal(F.shouldStartFullAuto(before, after, true), true);
  assert.equal(F.shouldStartFullAuto({ ...before, flow_mode: 'step-by-step' }, after, true), true);
});

test('shouldStartFullAuto never fires for an unbound slug, a first sight, or a spec already in full auto', () => {
  const before = { slug: 'a', phase: 'specified' };
  const after = { slug: 'a', phase: 'specified', flow_mode: 'full-auto' };
  assert.equal(F.shouldStartFullAuto(before, after, false), false, 'not bound in this window');
  assert.equal(F.shouldStartFullAuto(null, after, true), false, 'first sight (project opened, pull)');
  assert.equal(F.shouldStartFullAuto(after, after, true), false, 'already full auto before');
  assert.equal(F.shouldStartFullAuto(before, { ...after, phase: 'planned' }, true), false, 'past specified');
  assert.equal(F.shouldStartFullAuto(before, { ...before, flow_mode: 'step-by-step' }, true), false);
});

test('fullAutoResumeAction offers spec.auto only for a full-auto spec with work left and no live run', () => {
  for (const phase of ['specified', 'planned', 'tasks_generated', 'implementing']) {
    const action = F.fullAutoResumeAction({ phase, flow_mode: 'full-auto' }, false);
    assert.equal(action && action.command, 'spec.auto', phase);
    assert.equal(action.label, 'Resume Full Auto…');
  }
  assert.equal(F.fullAutoResumeAction({ phase: 'done', flow_mode: 'full-auto' }, false), null);
  assert.equal(F.fullAutoResumeAction({ phase: 'draft', flow_mode: 'full-auto' }, false), null);
  assert.equal(F.fullAutoResumeAction({ phase: 'planned', flow_mode: 'full-auto' }, true), null, 'live run');
  assert.equal(F.fullAutoResumeAction({ phase: 'planned', flow_mode: 'step-by-step' }, false), null);
  assert.equal(F.fullAutoResumeAction({ phase: 'planned' }, false), null, 'no flow_mode behaves as today');
});

test('fullAutoStageLabel names the stage and a waiting agent', () => {
  assert.equal(F.fullAutoStageLabel('specified', null, 'agent-working'), 'Full auto · planning');
  assert.equal(F.fullAutoStageLabel('planned', null, 'agent-working'), 'Full auto · tasks');
  assert.equal(F.fullAutoStageLabel('implementing', { completed: 3, total: 7 }, 'agent-working'), 'Full auto · implementing 3/7');
  assert.equal(F.fullAutoStageLabel('tasks_generated', { completed: 0, total: 0 }, 'agent-working'), 'Full auto · implementing');
  assert.equal(F.fullAutoStageLabel('implementing', { completed: 3, total: 7 }, 'agent-input'), 'Full auto · needs you');
  assert.equal(F.fullAutoStageLabel('planned', null, 'agent-approval'), 'Full auto · waiting for permission');
});
