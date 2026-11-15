/**
 * branchOptions — the New Workspace branch fields' list (pure).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../src/renderer/workspaces/branchOptions');

const local = ['main', 'feat/login', 'fix/Logout-bug'];
const remote = ['main', 'feat/login', 'release/2.9', 'feat/billing'];

test('no filter: local first, then remote branches without a local twin', () => {
  const r = B.build({ local, remote });
  assert.deepEqual(r.sections.map((s) => [s.id, s.items]), [['local', local], ['remote', ['release/2.9', 'feat/billing']]]);
  assert.deepEqual(r.items, [...local, 'release/2.9', 'feat/billing']);
});

test('the filter matches anywhere in the name, ignoring case', () => {
  assert.deepEqual(B.build({ local, remote, filter: 'LOG' }).items, ['feat/login', 'fix/Logout-bug']);
  assert.deepEqual(B.build({ local, remote, filter: '2.9' }).items, ['release/2.9']);
  assert.deepEqual(B.build({ local, remote, filter: '  bill ' }).items, ['feat/billing'], 'surrounding spaces ignored');
  assert.deepEqual(B.build({ local, remote, filter: 'nothing' }), { sections: [], items: [] });
});

test('an exact match comes first in its section and is the first highlight', () => {
  const r = B.build({ local: ['feat/main-menu', 'main'], remote: [], filter: 'main' });
  assert.deepEqual(r.items, ['main', 'feat/main-menu']);
  assert.equal(B.initialHighlight(r.items, 'main'), 0);
  assert.equal(B.initialHighlight(r.items, 'mai'), -1, 'a partial filter highlights nothing: Enter keeps the text');
  assert.equal(B.initialHighlight(r.items, ''), -1);
});

test('long lists are capped per section with a count of the rest', () => {
  const many = Array.from({ length: B.LIMIT + 5 }, (_, i) => `b${i}`);
  const r = B.build({ local: many });
  assert.equal(r.sections[0].items.length, B.LIMIT);
  assert.equal(r.sections[0].more, 5);
});

test('arrows wrap and start at the ends', () => {
  const items = ['a', 'b', 'c'];
  assert.equal(B.move(items, -1, 1), 0);
  assert.equal(B.move(items, -1, -1), 2);
  assert.equal(B.move(items, 2, 1), 0);
  assert.equal(B.move(items, 0, -1), 2);
  assert.equal(B.move([], 0, 1), -1);
});

test('junk input is ignored', () => {
  assert.deepEqual(B.build({ local: ['a', null, '', 'a', 3], remote: undefined }).items, ['a']);
  assert.deepEqual(B.build(), { sections: [], items: [] });
});
