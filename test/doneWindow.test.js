/**
 * The done-window model (boards-done-window spec, T01 / D6 / S4 / S9).
 *
 * Pure by design: requiring it must not reach `electron` or the DOM.
 * Pinned: the normaliser's per-key fallback (missing, null, non-numeric,
 * out-of-set, numeric strings), the inclusive boundary at exactly N days,
 * `0` meaning everything, absent and unparseable dates counting as recent,
 * and the partition keeping input order.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  DAY_MS,
  DEFAULT_DONE_WINDOW,
  WINDOW_OPTIONS,
  normalizeDoneWindow,
  isWithinWindow,
  partitionDone
} = require('../src/shared/doneWindow');

const NOW = Date.parse('2026-09-13T12:00:00Z');
const daysAgo = (d) => new Date(NOW - d * DAY_MS).toISOString();

test('defaults and options are what Project Settings offers', () => {
  assert.deepEqual(DEFAULT_DONE_WINDOW, { tasks: 7, specs: 0 });
  assert.deepEqual(WINDOW_OPTIONS, [7, 30, 90, 0]);
});

test('normalizeDoneWindow: missing, null and garbage fall back per key', () => {
  assert.deepEqual(normalizeDoneWindow(undefined), { tasks: 7, specs: 0 });
  assert.deepEqual(normalizeDoneWindow(null), { tasks: 7, specs: 0 });
  assert.deepEqual(normalizeDoneWindow('30'), { tasks: 7, specs: 0 });
  assert.deepEqual(normalizeDoneWindow({}), { tasks: 7, specs: 0 });
  assert.deepEqual(normalizeDoneWindow({ tasks: null, specs: 'soon' }), { tasks: 7, specs: 0 });
  assert.deepEqual(normalizeDoneWindow({ tasks: 15, specs: -1 }), { tasks: 7, specs: 0 });
  assert.deepEqual(normalizeDoneWindow({ tasks: NaN, specs: Infinity }), { tasks: 7, specs: 0 });
});

test('normalizeDoneWindow: valid values pass, one bad key does not spoil the other', () => {
  assert.deepEqual(normalizeDoneWindow({ tasks: 90, specs: 0 }), { tasks: 90, specs: 0 });
  assert.deepEqual(normalizeDoneWindow({ tasks: 30 }), { tasks: 30, specs: 0 });
  assert.deepEqual(normalizeDoneWindow({ tasks: 'x', specs: 7 }), { tasks: 7, specs: 7 });
});

test('normalizeDoneWindow: numeric strings in the option set are accepted', () => {
  assert.deepEqual(normalizeDoneWindow({ tasks: '30', specs: ' 0 ' }), { tasks: 30, specs: 0 });
  assert.deepEqual(normalizeDoneWindow({ tasks: '12' }), { tasks: 7, specs: 0 });
});

test('normalizeDoneWindow never mutates its input', () => {
  const raw = { tasks: 7, specs: 'bad' };
  normalizeDoneWindow(raw);
  assert.deepEqual(raw, { tasks: 7, specs: 'bad' });
});

test('isWithinWindow: inclusive boundary at exactly N days', () => {
  assert.equal(isWithinWindow(daysAgo(6.99), 7, NOW), true);
  assert.equal(isWithinWindow(daysAgo(7), 7, NOW), true);
  assert.equal(isWithinWindow(new Date(NOW - 7 * DAY_MS - 1).toISOString(), 7, NOW), false);
  assert.equal(isWithinWindow(daysAgo(29), 30, NOW), true);
  assert.equal(isWithinWindow(daysAgo(31), 30, NOW), false);
});

test('isWithinWindow: 0 days means everything is within', () => {
  assert.equal(isWithinWindow(daysAgo(4000), 0, NOW), true);
  assert.equal(isWithinWindow(null, 0, NOW), true);
});

test('isWithinWindow: absent or unparseable dates count as recent', () => {
  assert.equal(isWithinWindow(undefined, 7, NOW), true);
  assert.equal(isWithinWindow(null, 7, NOW), true);
  assert.equal(isWithinWindow('', 7, NOW), true);
  assert.equal(isWithinWindow('yesterday', 7, NOW), true);
});

test('isWithinWindow accepts epoch milliseconds too', () => {
  assert.equal(isWithinWindow(NOW - 3 * DAY_MS, 7, NOW), true);
  assert.equal(isWithinWindow(NOW - 9 * DAY_MS, 7, NOW), false);
});

test('partitionDone splits on the picked date and keeps input order', () => {
  const items = [
    { id: 'a', completedAt: daysAgo(1) },
    { id: 'b', completedAt: daysAgo(40) },
    { id: 'c', completedAt: daysAgo(3) },
    { id: 'd', completedAt: daysAgo(400) },
    { id: 'e' }                                  // no date → recent
  ];
  const { recent, older } = partitionDone(items, { days: 7, now: NOW, dateOf: t => t.completedAt });
  assert.deepEqual(recent.map(t => t.id), ['a', 'c', 'e']);
  assert.deepEqual(older.map(t => t.id), ['b', 'd']);
});

test('partitionDone: fallback date through dateOf (completedAt || updatedAt)', () => {
  const items = [
    { id: 'a', updatedAt: daysAgo(2) },
    { id: 'b', updatedAt: daysAgo(20) },
    { id: 'c', completedAt: daysAgo(1), updatedAt: daysAgo(50) }
  ];
  const { recent, older } = partitionDone(items, {
    days: 7, now: NOW, dateOf: t => t.completedAt || t.updatedAt
  });
  assert.deepEqual(recent.map(t => t.id), ['a', 'c']);
  assert.deepEqual(older.map(t => t.id), ['b']);
});

test('partitionDone: window 0 puts everything in recent; empty input is fine', () => {
  const items = [{ id: 'a', at: daysAgo(999) }];
  assert.deepEqual(partitionDone(items, { days: 0, now: NOW, dateOf: t => t.at }).older, []);
  assert.deepEqual(partitionDone([], { days: 7 }), { recent: [], older: [] });
  assert.deepEqual(partitionDone(undefined, { days: 7 }), { recent: [], older: [] });
});

test('partitionDone without dateOf treats every item as recent', () => {
  const { recent, older } = partitionDone([{ id: 'a' }], { days: 7, now: NOW });
  assert.equal(recent.length, 1);
  assert.equal(older.length, 0);
});
