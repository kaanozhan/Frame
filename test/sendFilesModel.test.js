/**
 * The rules behind the "Send files to server" modal (server-copy-files T02).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/shared/sendFilesModel');
const { compile } = require('../src/shared/copyFilesMatch');

const MB = 1024 * 1024;
const tree = () => M.buildTree({
  ignored: ['.env', '.env.local', 'apps/web/.env', 'config/local.json', 'certs/', 'node_modules/', 'dist/', '.DS_Store'],
  untracked: ['src/new-feature.js'],
  sizes: {
    '.env': { size: 120 }, '.env.local': { size: 80 }, 'apps/web/.env': { size: 60 },
    'config/local.json': { size: 2000 }, 'certs': { size: 4000 },
    'node_modules': { size: 900 * MB, cut: true }, 'dist': { size: 30 * MB }, '.DS_Store': { size: 6000 },
    'src/new-feature.js': { size: 500 }
  },
  server: { '.env.local': 'same', '.env': 'changed' }
});

test('T02: the tree has two groups; collapsed folders are leaves; heavy ones are flagged', () => {
  const t = tree();
  const ignored = M.leaves(t.ignored).map((l) => [l.path, l.type, !!l.heavy]);
  assert.deepEqual(ignored.sort(), [
    ['.DS_Store', 'file', true], ['.env', 'file', false], ['.env.local', 'file', false],
    ['apps/web/.env', 'file', false], ['certs', 'dir', false], ['config/local.json', 'file', false],
    ['dist', 'dir', true], ['node_modules', 'dir', true]
  ].sort());
  assert.deepEqual(M.leaves(t.untracked).map((l) => l.path), ['src/new-feature.js']);
  const nm = M.leaves(t).find((l) => l.path === 'node_modules');
  assert.equal(nm.sizeCut, true);
  assert.equal(M.leaves(t).find((l) => l.path === '.env').server, 'changed');
});

test('T02: the default ticks copyFiles matches, never heavy or server-identical entries', () => {
  const t = tree();
  assert.deepEqual([...M.defaultSelection(t, ['.env*', 'certs/**'])].sort(), ['.env', 'apps/web/.env', 'certs'], '.env.local is the same on the server');
  assert.deepEqual([...M.defaultSelection(t, ['**'])].sort(), ['.env', 'apps/web/.env', 'certs', 'config/local.json', 'src/new-feature.js'], 'even ** leaves heavy folders out');
  assert.deepEqual([...M.defaultSelection(t, [])], [], 'no patterns: nothing ticked');
});

test('T02: folder toggles, select all and the size line', () => {
  const t = tree();
  let sel = M.toggle(new Set(), t.ignored.children.find((n) => n.path === 'apps'), true);
  assert.deepEqual([...sel], ['apps/web/.env']);
  sel = M.toggle(sel, t.ignored.children.find((n) => n.path === 'apps'), false);
  assert.equal(sel.size, 0);
  const all = M.selectAll(t);
  assert.equal(all.size, 9);
  const size = M.selectionSize(t, all);
  assert.equal(size.files, 9);
  assert.equal(size.cut, true, 'node_modules size is a lower bound');
  assert.equal(M.selectionSize(t, new Set(['.env', 'certs'])).bytes, 4120);
});

test('T02: size verdict — fine up to 50 MB, warn above, refuse above 1 GB', () => {
  assert.equal(M.sizeVerdict(50 * MB), 'ok');
  assert.equal(M.sizeVerdict(50 * MB + 1), 'warn');
  assert.equal(M.sizeVerdict(1024 * MB), 'warn');
  assert.equal(M.sizeVerdict(1024 * MB + 1), 'refuse');
  const t = tree();
  assert.equal(M.sizeVerdict(M.selectionSize(t, M.selectAll(t)).bytes), 'warn', 'select all with node_modules (≥900 MB) warns');
});

test('T02: Remember saves anchored patterns for ignored leaves only, and they select the same files again', () => {
  const t = tree();
  const sel = new Set(['.env', 'apps/web/.env', 'certs', 'src/new-feature.js']);
  const patterns = M.patternsFor(t, sel);
  assert.deepEqual([...patterns].sort(), ['/.env', 'apps/web/.env', 'certs/**'], 'untracked files are not remembered');
  const match = compile(patterns);
  assert.equal(match('.env'), true);
  assert.equal(match('apps/web/.env'), true);
  assert.equal(match('other/.env'), false, '/.env is anchored at the root');
  assert.equal(match('certs'), true);
  assert.equal(match('.env.local'), false);
  assert.deepEqual(M.mergePatterns(['.env*', '/.env'], ['/.env', 'certs/**', ' ', 'certs/**']), ['.env*', '/.env', 'certs/**'], 'merged in order, no duplicates or blanks');
});
