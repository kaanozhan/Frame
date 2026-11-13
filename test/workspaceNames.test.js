/**
 * workspaceNames — automatic color names (workspaces spec, T02 / D4).
 *
 * Pinned: names come from the color pool and avoid what is taken (records
 * and folders, case-insensitively); an exhausted pool continues with `-2`;
 * slugs are folder/branch safe; uniquify suffixes against existing folders.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { COLORS, nextName, toSlug, uniquify } = require('../src/shared/workspaceNames');

const first = () => 0;

test('the pool is lowercase, unique, slug-safe color names', () => {
  assert.ok(COLORS.length >= 50);
  assert.equal(new Set(COLORS).size, COLORS.length);
  for (const c of COLORS) assert.match(c, /^[a-z]+$/);
});

test('nextName picks a free color', () => {
  assert.equal(nextName([], first), COLORS[0]);
  assert.ok(COLORS.includes(nextName([], Math.random)));
});

test('nextName skips taken names, case-insensitively', () => {
  const taken = [COLORS[0].toUpperCase(), COLORS[1]];
  assert.equal(nextName(taken, first), COLORS[2]);
});

test('an exhausted pool continues with -2, then -3', () => {
  assert.equal(nextName(COLORS, first), `${COLORS[0]}-2`);
  const allTwos = COLORS.map((c) => `${c}-2`);
  assert.equal(nextName([...COLORS, ...allTwos], first), `${COLORS[0]}-3`);
  assert.equal(nextName([...COLORS, `${COLORS[0]}-2`], first), `${COLORS[1]}-2`);
});

test('toSlug makes a folder/branch-safe segment', () => {
  assert.equal(toSlug('Login Ekranı!'), 'login-ekran');
  assert.equal(toSlug('  --API refactor--  '), 'api-refactor');
  assert.equal(toSlug('***'), '');
  assert.ok(toSlug('a'.repeat(80)).length <= 40);
  assert.ok(!toSlug('a'.repeat(39) + '-b').endsWith('-'));
});

test('uniquify suffixes against what exists', () => {
  assert.equal(uniquify('teal', []), 'teal');
  assert.equal(uniquify('teal', ['teal']), 'teal-2');
  assert.equal(uniquify('teal', ['TEAL', 'teal-2']), 'teal-3');
});
