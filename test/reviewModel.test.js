/**
 * reviewModel — workspace review rules (workspace-review spec, T01).
 *
 * Fixtures are real `git diff -z` output (captured from a scratch repo):
 * an added file, a binary change, a deletion, a modification and a rename.
 * Pinned: numstat and name-status parse incl. renames and binaries; the
 * merged list carries status, counts, hashes and untracked files, sorted;
 * viewed ticks survive only an unchanged hash; line anchors reject
 * old-side-only lines; the prompt lists every comment in file/line order.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_DIFF_BYTES, parseNumstat, parseNameStatus, mergeChangedFiles, reconcileViewed, viewedSummary, lineAnchor, composeReviewPrompt
} = require('../src/shared/reviewModel');

const NUMSTAT = '1\t0\tadded.txt\0-\t-\tbin.dat\0' + '0\t1\tdel.txt\0' + '2\t1\tkeep.txt\0' + '0\t0\t\0old.txt\0new.txt\0';
const NAME_STATUS = 'A\0added.txt\0M\0bin.dat\0D\0del.txt\0M\0keep.txt\0R100\0old.txt\0new.txt\0';

test('parseNumstat reads counts, binaries and renames', () => {
  assert.deepEqual(parseNumstat(NUMSTAT), [
    { added: 1, removed: 0, binary: false, path: 'added.txt' },
    { added: 0, removed: 0, binary: true, path: 'bin.dat' },
    { added: 0, removed: 1, binary: false, path: 'del.txt' },
    { added: 2, removed: 1, binary: false, path: 'keep.txt' },
    { added: 0, removed: 0, binary: false, oldPath: 'old.txt', path: 'new.txt' }
  ]);
  assert.deepEqual(parseNumstat(''), []);
});

test('parseNameStatus reads letters and rename pairs', () => {
  assert.deepEqual(parseNameStatus(NAME_STATUS), {
    'added.txt': { status: 'A' },
    'bin.dat': { status: 'M' },
    'del.txt': { status: 'D' },
    'keep.txt': { status: 'M' },
    'new.txt': { status: 'R', oldPath: 'old.txt' }
  });
});

test('mergeChangedFiles: status, counts, hashes, untracked, sorted by path', () => {
  const files = mergeChangedFiles({
    numstat: NUMSTAT,
    nameStatus: NAME_STATUS,
    untracked: ['zz-new.txt', 'keep.txt'],
    hashes: { 'added.txt': 'h1', 'keep.txt': 'h2', 'new.txt': 'h3', 'bin.dat': 'h4', 'zz-new.txt': 'h5', 'del.txt': 'stale' },
    untrackedLines: { 'zz-new.txt': 3 }
  });
  assert.deepEqual(files.map((f) => [f.path, f.status]), [
    ['added.txt', 'A'], ['bin.dat', 'M'], ['del.txt', 'D'], ['keep.txt', 'M'], ['new.txt', 'R'], ['zz-new.txt', 'U']
  ]);
  assert.equal(files.find((f) => f.path === 'del.txt').hash, null, 'a deleted file has no content');
  assert.equal(files.find((f) => f.path === 'new.txt').oldPath, 'old.txt');
  assert.equal(files.find((f) => f.path === 'bin.dat').binary, true);
  assert.deepEqual(files.find((f) => f.path === 'zz-new.txt'), { path: 'zz-new.txt', status: 'U', added: 3, removed: 0, binary: false, hash: 'h5' });
  assert.equal(files.filter((f) => f.path === 'keep.txt').length, 1, 'a tracked path listed as untracked is not doubled');
});

test('viewed ticks survive only while the content hash is unchanged', () => {
  const files = [{ path: 'a', hash: '1' }, { path: 'b', hash: '2' }, { path: 'c', hash: null }];
  const viewed = reconcileViewed(files, { a: '1', b: 'old', gone: 'x', c: null });
  assert.deepEqual(viewed, { a: '1', c: null });
  assert.deepEqual(viewedSummary(files, viewed), { total: 3, viewed: 2, remaining: 1 });
  assert.deepEqual(viewedSummary([], {}), { total: 0, viewed: 0, remaining: 0 });
});

test('lineAnchor takes new-side lines and strips the diff marker', () => {
  assert.deepEqual(lineAnchor({ newLine: ' 12 ', code: '+  const x = 1;  ' }), { line: 12, text: '  const x = 1;' });
  assert.deepEqual(lineAnchor({ newLine: '3', code: ' context' }), { line: 3, text: 'context' });
  assert.equal(lineAnchor({ newLine: '', code: '-removed' }), null, 'old-side-only lines have no anchor');
  assert.equal(lineAnchor({ newLine: 'abc', code: 'x' }), null);
});

test('composeReviewPrompt lists every comment in file and line order', () => {
  const p = composeReviewPrompt({
    branch: 'ws/teal',
    comments: [
      { path: 'b.js', line: 9, text: 'return x;', body: 'Return a copy.' },
      { path: 'a.js', line: 20, text: 'let y', body: 'Use const' },
      { path: 'a.js', line: 3, text: '', body: 'Line one\nline two' }
    ]
  });
  assert.match(p, /branch `ws\/teal`/);
  const order = ['a.js:3', 'a.js:20', 'b.js:9'].map((k) => p.indexOf(k));
  assert.deepEqual(order.slice().sort((x, y) => x - y), order, 'sorted by file then line');
  assert.match(p, /> return x;\n {3}Return a copy\./);
  assert.match(p, /Line one line two/, 'multi-line comments fold into one line');
  assert.match(p, /Do not push/);
});

test('the diff size ceiling is 2 MB', () => {
  assert.equal(MAX_DIFF_BYTES, 2 * 1024 * 1024);
});
