/**
 * cloudTour tests — the signed-out Frame Cloud window's five-step tour: its
 * steps, its stepping rules and what its words may not say
 * (frame-cloud-header-entry spec).
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 * Pure: no DOM, no Electron.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const tour = require('../src/renderer/cloudTour');

const LAST = tour.STEPS.length - 1;

test('there are five steps, in order, with unique ids', () => {
  assert.deepEqual(tour.STEPS.map((s) => s.id), ['overview', 'board', 'discuss', 'shape', 'track']);
  assert.deepEqual(tour.STEPS.map((s) => s.name), ['Overview', 'Board', 'Discuss', 'Shape & Start', 'Track']);
  assert.equal(new Set(tour.STEPS.map((s) => s.id)).size, 5);
});

test('every step has a title, a lede and an example of a known kind', () => {
  for (const step of tour.STEPS) {
    assert.ok(step.title.length > 0, step.id);
    assert.ok(step.lede.length > 0, step.id);
    assert.ok(tour.EXAMPLE_KINDS.includes(step.example.kind), `${step.id}: ${step.example.kind}`);
  }
  assert.deepEqual(tour.STEPS.map((s) => s.example.kind), ['features', 'board', 'lane', 'parts', 'parts']);
});

test('the titles are the agreed ones', () => {
  assert.deepEqual(tour.STEPS.map((s) => s.title), [
    'Plan the work where the code is.',
    'One board, from idea to done.',
    'Talk a proposal through with your agent.',
    'The brief becomes specs and tasks.',
    'Progress comes from GitHub.',
  ]);
});

test('the overview lists six features', () => {
  const { items } = tour.STEPS[0].example;
  assert.deepEqual(items.map((f) => f.title), [
    'A board for your plan',
    'Decide with your agent',
    'Briefs become specs and tasks',
    'Progress from GitHub',
    'Milestones',
    'Solo or with a team',
  ]);
  for (const f of items) assert.ok(f.text.length > 0, f.title);
});

test('the board has a milestone and Backlog / Active / Done; the Active card lists three parts', () => {
  const { milestone, columns } = tour.STEPS[1].example;
  assert.ok(milestone.name && milestone.due && milestone.progress);
  assert.ok(milestone.ratio > 0 && milestone.ratio < 1);
  assert.deepEqual(columns.map((c) => c.name), ['Backlog', 'Active', 'Done']);
  for (const column of columns) {
    assert.ok(column.cards.length > 0, column.name);
    for (const card of column.cards) {
      assert.equal(typeof card.number, 'number');
      assert.ok(['Proposal', 'Work'].includes(card.kind), card.kind);
      assert.ok(card.title && card.foot);
      assert.ok(tour.TONES.includes(card.tone), card.tone);
    }
  }
  const [active] = columns[1].cards;
  assert.equal(active.parts.length, 3);
  assert.deepEqual(active.parts.map((p) => p.tone), ['ok', 'review', 'active']);
});

test('the discuss lane has two lines of talk, a record and Move to Work', () => {
  const lane = tour.STEPS[2].example;
  assert.ok(lane.chip);
  assert.deepEqual(lane.lines.map((l) => l.who), ['Agent', 'You']);
  assert.equal(lane.record.title, 'Recorded on the brief');
  assert.ok(lane.record.text.length > 0);
  assert.equal(lane.action, 'Move to Work');
});

test('shape shows one part on its branch and two not started, with a note and no action', () => {
  const parts = tour.STEPS[3].example;
  assert.deepEqual(parts.rows.map((r) => r.status), ['On feat/offline-queue', 'Not started · Begin', 'Not started · Begin']);
  assert.ok(parts.note);
  assert.equal(parts.action, undefined);
});

test('track shows merged, in review and implemented, with Move to Done', () => {
  const parts = tour.STEPS[4].example;
  assert.deepEqual(parts.rows.map((r) => r.status), ['Merged into main', 'PR #52 · In review', 'Implemented']);
  assert.equal(parts.action, 'Move to Done');
  assert.equal(parts.note, undefined);
});

test('every row tone is a known one', () => {
  for (const step of tour.STEPS.filter((s) => s.example.kind === 'parts')) {
    for (const row of step.example.rows) assert.ok(tour.TONES.includes(row.tone), `${step.id}: ${row.tone}`);
  }
});

test('clamp keeps any value inside the steps', () => {
  assert.equal(tour.clamp(0), 0);
  assert.equal(tour.clamp(3), 3);
  assert.equal(tour.clamp(LAST), LAST);
  assert.equal(tour.clamp(-1), 0);
  assert.equal(tour.clamp(99), LAST);
  assert.equal(tour.clamp(2.9), 2);
  assert.equal(tour.clamp('3'), 3);
  for (const junk of [undefined, null, NaN, 'x', {}, Infinity, -Infinity]) {
    assert.ok([0, LAST].includes(tour.clamp(junk)), String(junk));
  }
  assert.equal(tour.clamp(undefined), 0);
  assert.equal(tour.clamp(NaN), 0);
});

test('next and back move one step and stop at both ends', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(tour.next), [1, 2, 3, 4, 4]);
  assert.deepEqual([0, 1, 2, 3, 4].map(tour.back), [0, 0, 1, 2, 3]);
  assert.equal(tour.next(99), LAST);
  assert.equal(tour.back(-5), 0);
  assert.equal(tour.next(undefined), 1);
});

test('Back is off on step one and Next is off on step five', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(tour.canBack), [false, true, true, true, true]);
  assert.deepEqual([0, 1, 2, 3, 4].map(tour.canNext), [true, true, true, true, false]);
});

test('the counter names the position and the step', () => {
  assert.equal(tour.counter(0), '1 of 5 · Overview');
  assert.equal(tour.counter(1), '2 of 5 · Board');
  assert.equal(tour.counter(3), '4 of 5 · Shape & Start');
  assert.equal(tour.counter(4), '5 of 5 · Track');
  assert.equal(tour.counter(99), '5 of 5 · Track');
});

test('the trust line says what is stored, and leads with the code staying local', () => {
  assert.equal(
    tour.TRUST,
    'Your code stays on your machines. Frame Cloud stores briefs, project names and branch names, never your source.',
  );
  assert.ok(tour.TRUST.startsWith(tour.TRUST_LEAD));
  assert.equal(tour.EYEBROW, 'Frame Cloud');
});

test('strings() carries every word the tour shows', () => {
  const strings = tour.strings();
  assert.ok(strings.every((s) => typeof s === 'string'));
  for (const expected of [
    tour.EYEBROW,
    tour.TRUST,
    'Plan the work where the code is.',
    'Solo or with a team',
    'Beta launch',
    'PR #41 · In review',
    'Recorded on the brief',
    'Move to Work',
    '.frame/specs/offline-queue/spec.md → /spec.plan',
    'Move to Done',
    '3 of 5 · Discuss',
  ]) {
    assert.ok(strings.includes(expected), expected);
  }
});

test('the claims Frame does not keep are gone', () => {
  for (const s of tour.strings()) {
    assert.doesNotMatch(s, /live sessions?|specs on the web|every machine/i, s);
  }
});

test('no string names a trial, Pro, a price, an upgrade or a free or paid tier', () => {
  for (const s of tour.strings()) {
    assert.doesNotMatch(s, /\btrial\b|\bPro\b|\bprice\b|\bpricing\b|\bpaid\b|\bupgrade\b|\bfree\b|\$|€|£/i, s);
  }
  // "plan" is the tour's subject, so its guard is the one that lets it through.
  assert.ok(tour.strings().some((s) => /\bplan\b/i.test(s)));
});
