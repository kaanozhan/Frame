/**
 * The guided tour's steps and rules (first-run-guided-tour spec).
 *
 * Pure by design: CI runs `npm test` with no `npm ci`, so this module may not
 * reach `electron` or the DOM. Requiring it at the top is half the test.
 *
 * What is pinned is what a reader would get wrong: step 1 exists only without
 * a project and everything after it only with one; a missing target skips a
 * step instead of ending the tour; any stored value, and a failed read, keep
 * the tour from starting by itself; and a card never leaves the viewport.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  SETTING_KEY,
  STEPS,
  shouldAutoStart,
  nextStepIndex,
  firstStepIndex,
  isLastStep,
  placeCard,
  validate
} = require('../src/renderer/tour/tourSteps');

const indexOf = (id) => STEPS.findIndex((s) => s.id === id);

// ─── shipped steps ────────────────────────────────────────

test('the shipped steps validate clean', () => {
  assert.deepEqual(validate(), []);
});

test('seven steps, in the tour order', () => {
  assert.deepEqual(STEPS.map((s) => s.id), [
    'project', 'switcher', 'workspaces', 'servers', 'agent', 'terminals', 'specs', 'tasks', 'settings'
  ]);
  assert.equal(SETTING_KEY, 'guidedTourDone');
});

test('the terminal-first message and the closing line are in the copy', () => {
  const agent = STEPS[indexOf('agent')].body;
  assert.match(agent, /Claude Code/);
  assert.match(agent, /Codex/);
  assert.match(STEPS[indexOf('terminals')].body, /terminal-first/);
  assert.ok(STEPS[STEPS.length - 1].closing, 'the last step carries the closing line');
});

test('only step 1 advances on a project, and only it needs no project', () => {
  for (const step of STEPS) {
    const isProject = step.id === 'project';
    assert.equal(step.advance === 'project', isProject, step.id);
    assert.equal(step.requiresNoProject, isProject, step.id);
    assert.equal(step.requiresProject, !isProject, step.id);
  }
});

test('the terminals step falls back to the nav row, which needs the nav revealed', () => {
  const [primary, fallback] = STEPS[indexOf('terminals')].targets;
  assert.equal(primary.needsNav, undefined);
  assert.equal(fallback.needsNav, 'terminals');
});

// ─── validate ─────────────────────────────────────────────

const sound = () => [
  { id: 'a', title: 'A', body: 'One.', advance: 'next', requiresProject: true, targets: [{ selector: '#a', placement: 'bottom' }] },
  { id: 'b', title: 'B', body: 'One. Two.', advance: 'project', requiresNoProject: true, targets: [{ selector: '#b', placement: 'right' }] }
];

test('validate reports each broken rule', () => {
  assert.deepEqual(validate(sound()), []);

  const cases = [
    [(s) => { s[1].id = 'a'; }, /duplicate id/],
    [(s) => { s[0].title = ' '; }, /missing title/],
    [(s) => { s[0].body = ''; }, /missing body/],
    [(s) => { s[0].body = 'One. Two. Three.'; }, /longer than two sentences/],
    [(s) => { s[0].closing = ''; }, /closing/],
    [(s) => { s[0].advance = 'click'; }, /unknown advance/],
    [(s) => { s[0].requiresNoProject = true; }, /requires both/],
    [(s) => { s[0].targets = []; }, /no targets/],
    [(s) => { s[0].targets[0].selector = ''; }, /no selector/],
    [(s) => { s[0].targets[0].placement = 'middle'; }, /unknown placement/]
  ];
  for (const [breakIt, expected] of cases) {
    const steps = sound();
    breakIt(steps);
    const errors = validate(steps);
    assert.equal(errors.length, 1, `${expected}: ${errors.join('; ')}`);
    assert.match(errors[0], expected);
  }
  assert.deepEqual(validate([]), ['steps must be a non-empty array']);
});

// ─── auto-start ───────────────────────────────────────────

test('auto-start only while the setting was never written', () => {
  assert.equal(shouldAutoStart({ done: null }), true);
  assert.equal(shouldAutoStart({ done: undefined }), true);
  assert.equal(shouldAutoStart({ done: { outcome: 'skipped', at: '2026-09-16T00:00:00Z' } }), false);
  assert.equal(shouldAutoStart({ done: true }), false);
});

test('a failed settings read never starts the tour', () => {
  assert.equal(shouldAutoStart({ done: null, readFailed: true }), false);
});

// ─── step resolution ──────────────────────────────────────

test('without a project the tour starts at step 1, with one at step 2', () => {
  assert.equal(firstStepIndex({ hasProject: false }), indexOf('project'));
  assert.equal(firstStepIndex({ hasProject: true }), indexOf('switcher'));
});

test('without a project nothing follows step 1', () => {
  assert.equal(nextStepIndex(indexOf('project'), { hasProject: false }), -1);
});

test('once a project is open, step 1 leads to the switcher', () => {
  assert.equal(nextStepIndex(indexOf('project'), { hasProject: true }), indexOf('switcher'));
});

test('an unavailable step is skipped, not the end of the tour', () => {
  const isAvailable = (step) => step.id !== 'specs';
  assert.equal(nextStepIndex(indexOf('terminals'), { hasProject: true, isAvailable }), indexOf('tasks'));
});

test('no available step left gives -1', () => {
  assert.equal(nextStepIndex(indexOf('switcher'), { hasProject: true, isAvailable: () => false }), -1);
  assert.equal(firstStepIndex({ hasProject: true, isAvailable: () => false }), -1);
});

test('settings is the last step', () => {
  assert.equal(isLastStep(indexOf('settings'), { hasProject: true }), true);
  assert.equal(isLastStep(indexOf('tasks'), { hasProject: true }), false);
  assert.equal(isLastStep(-1, { hasProject: true }), false);
});

// ─── placeCard ────────────────────────────────────────────

const viewport = { width: 1200, height: 800 };
const card = { width: 300, height: 140 };

test('the preferred side is used when the card fits there', () => {
  const target = { top: 100, left: 500, width: 200, height: 30 };
  const pos = placeCard(target, card, viewport, 'bottom');
  assert.equal(pos.placement, 'bottom');
  assert.equal(pos.top, 100 + 30 + 12);
  assert.equal(pos.left, 500 + 100 - 150);
});

test('a card that does not fit flips to the opposite side', () => {
  const target = { top: 720, left: 500, width: 200, height: 30 };
  const pos = placeCard(target, card, viewport, 'bottom');
  assert.equal(pos.placement, 'top');
  assert.equal(pos.top, 720 - 12 - 140);
});

test('right of a rail button near the bottom stays inside the viewport', () => {
  const target = { top: 760, left: 4, width: 32, height: 32 };
  const pos = placeCard(target, card, viewport, 'right');
  assert.equal(pos.placement, 'right');
  assert.equal(pos.left, 4 + 32 + 12);
  assert.equal(pos.top, 800 - 16 - 140);
});

test('the cross axis is clamped to the margin', () => {
  const target = { top: 10, left: 0, width: 40, height: 20 };
  const pos = placeCard(target, card, viewport, 'bottom');
  assert.equal(pos.left, 16);
  assert.ok(pos.top >= 16);
});

test('nowhere fits: keep the preferred side, still clamped', () => {
  const tiny = { width: 320, height: 200 };
  const target = { top: 20, left: 20, width: 280, height: 160 };
  const pos = placeCard(target, card, tiny, 'bottom');
  assert.equal(pos.placement, 'bottom');
  // Wider than the viewport allows: pinned to the left margin.
  assert.equal(pos.left, 16);
  // Below the target would overflow: pulled up to the last row that fits.
  assert.equal(pos.top, 200 - 16 - 140);
});

test('an unknown placement falls back to bottom', () => {
  const target = { top: 100, left: 500, width: 200, height: 30 };
  assert.equal(placeCard(target, card, viewport, 'middle').placement, 'bottom');
});
