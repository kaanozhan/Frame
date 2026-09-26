/**
 * structure-discovery tests (STR-01 T02): one inventory policy independent
 * of layout and parser support — root/mixed/hidden files, workspace counts
 * beyond the detector's cap, nested ignore precedence, unsupported and
 * binary content, symlinks, bounds, and injected traversal failures.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const {
  discover,
  discoverProject,
  evaluatePaths,
  resolvePolicy,
  normalizeCandidatePath,
  classifySample,
  StructurePolicyError,
  DEFAULT_LIMITS,
  MAX_DIAGNOSTIC_SAMPLES
} = require('../scripts/structure-discovery');

let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-discovery-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** { 'rel/path': string | Buffer } */
function scaffold(files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

const paths = (result) => result.files.map((f) => f.path);

/** A real-fs wrapper whose selected calls fail with `code` for matching paths. */
function failingFs(overrides) {
  const wrapped = { ...fs };
  for (const [method, predicate] of Object.entries(overrides)) {
    wrapped[method] = (target, ...rest) => {
      const rel = typeof target === 'string' ? path.relative(root, target).split(path.sep).join('/') : '';
      const code = predicate(rel);
      if (code) {
        const err = new Error(`${code}: injected ${method} ${rel}`);
        err.code = code;
        throw err;
      }
      return fs[method](target, ...rest);
    };
  }
  return wrapped;
}

/* ------------------------------ layouts ------------------------------- */

test('an empty project is a complete inventory with no files', () => {
  const result = discover(root);
  assert.equal(result.coverage, 'complete');
  assert.deepEqual(result.incompleteReasons, []);
  assert.deepEqual(result.files, []);
  assert.equal(result.counts.eligibleFiles, 0);
});

test('root-level, mixed-root, config, docs, extensionless and empty files are all eligible', () => {
  scaffold({
    'index.js': 'module.exports = 1;',
    'src/app.js': '',
    'lib/util.py': 'def f(): pass',
    'server/main.go': 'package main',
    'docs/guide.md': '# Guide',
    'package.json': '{}',
    'Makefile': 'all:\n\techo hi\n',
    'Dockerfile': 'FROM node\n',
    'config/app.yaml': 'a: 1'
  });
  const result = discover(root);
  assert.equal(result.coverage, 'complete');
  assert.deepEqual(paths(result), [
    'Dockerfile', 'Makefile', 'config/app.yaml', 'docs/guide.md', 'index.js',
    'lib/util.py', 'package.json', 'server/main.go', 'src/app.js'
  ]);
  const empty = result.files.find((f) => f.path === 'src/app.js');
  assert.equal(empty.sizeBytes, 0);
});

test('synthetic CoMeety-shaped workspace without detection config is fully covered', () => {
  scaffold({
    'package.json': JSON.stringify({ name: 'comeety', private: true, workspaces: ['apps/*', 'packages/*'] }),
    'apps/api/src/routes/users.ts': 'export const users = 1;',
    'apps/mobile/app/(app)/(home)/community/[id].tsx': 'export default function Screen() {}',
    'apps/mobile/modules/content-editor/editor/block-types/survey/index.tsx': 'export const Survey = 1;',
    'apps/admin/src/main.tsx': 'export {}',
    'packages/contracts/src/index.ts': 'export type A = 1;',
    '.frame/config.json': JSON.stringify({ projectId: 'x' })
  });
  const result = discoverProject(root);
  assert.equal(result.coverage, 'complete');
  assert.deepEqual(paths(result), [
    'apps/admin/src/main.tsx',
    'apps/api/src/routes/users.ts',
    'apps/mobile/app/(app)/(home)/community/[id].tsx',
    'apps/mobile/modules/content-editor/editor/block-types/survey/index.tsx',
    'package.json',
    'packages/contracts/src/index.ts'
  ]);
});

test('26 workspace packages are all covered despite the detector capping roots at 24', () => {
  const files = { 'package.json': JSON.stringify({ workspaces: ['packages/*'] }) };
  for (let i = 0; i < 26; i++) {
    const name = `pkg-${String(i).padStart(2, '0')}`;
    files[`packages/${name}/package.json`] = JSON.stringify({ name });
    files[`packages/${name}/src/index.js`] = `module.exports = ${i};`;
  }
  scaffold(files);
  const result = discover(root);
  assert.equal(result.coverage, 'complete');
  assert.equal(result.files.filter((f) => f.path.endsWith('/src/index.js')).length, 26);
  assert.equal(result.files.length, 53);
});

test('a depth-13 path is covered by default and reported partial when maxDepth is lower', () => {
  const deep = `${Array.from({ length: 13 }, (_, i) => `d${i + 1}`).join('/')}/deep.js`;
  scaffold({ [deep]: 'x', 'top.js': 'y' });

  const full = discover(root);
  assert.equal(full.coverage, 'complete');
  assert.ok(paths(full).includes(deep));

  const bounded = discover(root, { structure: { limits: { maxDepth: 12 } } });
  assert.equal(bounded.coverage, 'partial');
  assert.deepEqual(bounded.incompleteReasons, ['limit-maxDepth']);
  assert.ok(!paths(bounded).includes(deep));
  assert.ok(paths(bounded).includes('top.js'));
  assert.equal(bounded.counts.prunedDirectories.depth, 1);
  assert.equal(bounded.diagnostics.samples[0].path, 'd1/d2/d3/d4/d5/d6/d7/d8/d9/d10/d11/d12/d13');
});

test('hidden source directories are walked; .git, .frame and Frame-generated files are not', () => {
  scaffold({
    '.github/workflows/ci.yml': 'on: push',
    '.storybook/main.js': 'module.exports = {};',
    '.claude/settings.json': '{}',
    '.claude/rules/frame.md': '# generated copy',
    '.git/HEAD': 'ref: refs/heads/main',
    '.frame/STRUCTURE.json': '{}',
    'pkg/.frame/tasks.json': '{}',
    '.env.example': 'A=1'
  });
  const result = discover(root);
  assert.deepEqual(paths(result), [
    '.claude/settings.json', '.env.example', '.github/workflows/ci.yml', '.storybook/main.js'
  ]);
  assert.equal(result.counts.prunedDirectories.hard, 3);
  // Frame's own generated files are skipped without being counted
  assert.equal(result.counts.excludedFiles.hard, 0);
});

/* ------------------------------ policy -------------------------------- */

test('default dependency/output directories are pruned and counted as directories only', () => {
  scaffold({
    'node_modules/a/index.js': 'x',
    'node_modules/b/index.js': 'x',
    'dist/bundle.js': 'x',
    'nested/build/out.js': 'x',
    'src/a.js': 'x'
  });
  const result = discover(root);
  assert.deepEqual(paths(result), ['src/a.js']);
  assert.equal(result.counts.prunedDirectories.default, 3);
  assert.equal(result.policy.ignoredDirectoriesSource, 'default');
});

test('ignoredDirectories replaces the default set so a project can include its own build/', () => {
  scaffold({ 'build/tool.js': 'x', 'node_modules/a.js': 'x' });
  const result = discover(root, { structure: { ignoredDirectories: ['node_modules'] } });
  assert.deepEqual(paths(result), ['build/tool.js']);
  assert.equal(result.policy.ignoredDirectoriesSource, 'config');
  assert.deepEqual(result.policy.ignoredDirectories, ['node_modules']);
});

test('nested .gitignore precedence, wildcards, anchors and negations follow Git', () => {
  scaffold({
    '.gitignore': ['*.log', '!keep.log', '/root-only.txt', 'src/hidden.js', 'logs/', '!logs/keep.txt', '**/gen/*.js'].join('\n'),
    'a.log': 'x',
    'keep.log': 'x',
    'root-only.txt': 'x',
    'src/root-only.txt': 'x',
    'src/hidden.js': 'x',
    'src/visible.js': 'x',
    'logs/keep.txt': 'x',
    'deep/gen/out.js': 'x',
    'deep/gen/out.ts': 'x',
    'sub/.gitignore': '!debug.log\nlocal.txt\n',
    'sub/debug.log': 'x',
    'sub/other.log': 'x',
    'sub/local.txt': 'x',
    'local.txt': 'x'
  });
  const result = discover(root);
  assert.deepEqual(paths(result), [
    '.gitignore', 'deep/gen/out.ts', 'keep.log', 'local.txt', 'src/root-only.txt',
    'src/visible.js', 'sub/.gitignore', 'sub/debug.log'
  ]);
  // logs/ is excluded, so its negated child is never re-included
  assert.equal(result.counts.prunedDirectories.gitignore, 1);
});

test('project.structure.exclude applies last and can re-include a gitignored directory', () => {
  scaffold({
    '.gitignore': 'generated/\n',
    'generated/api.ts': 'x',
    'src/a.ts': 'x',
    'src/b.test.ts': 'x'
  });
  const result = discover(root, { structure: { exclude: ['!generated/', '*.test.ts'] } });
  assert.deepEqual(paths(result), ['.gitignore', 'generated/api.ts', 'src/a.ts']);
  assert.equal(result.counts.excludedFiles.config, 1);
});

test('matching is case-sensitive on every platform', () => {
  scaffold({ '.gitignore': 'Secret.txt\n', 'secret.txt': 'x', 'Secret.txt.md': 'x' });
  const result = discover(root);
  assert.ok(paths(result).includes('secret.txt'));
});

test('the policy summary exposes rule sources, hashes, defaults and limits', () => {
  const rules = 'dist/\n';
  scaffold({ '.gitignore': rules, 'pkg/.gitignore': '*.tmp\n', 'a.js': 'x' });
  const result = discover(root, { structure: { exclude: ['*.bak'], limits: { maxFiles: 10 } } });
  assert.deepEqual(result.policy.ignoreFiles, [
    { path: '.gitignore', sha256: crypto.createHash('sha256').update(rules).digest('hex') },
    { path: 'pkg/.gitignore', sha256: crypto.createHash('sha256').update('*.tmp\n').digest('hex') }
  ]);
  assert.deepEqual(result.policy.exclude, ['*.bak']);
  assert.deepEqual(result.policy.limits, { ...DEFAULT_LIMITS, maxFiles: 10 });
  assert.equal(result.policy.caseSensitive, true);
  assert.ok(result.policy.hardExclusions.includes('**/.git'));
  assert.ok(result.policy.hardExclusions.includes('.claude/rules/frame.md'));
});

test('invalid project.structure settings are explicit errors, never silent fallbacks', () => {
  const bad = [
    { unknown: true },
    { ignoredDirectories: 'dist' },
    { ignoredDirectories: ['a/b'] },
    { exclude: [1] },
    { limits: { maxFiles: -1 } },
    { limits: { maxFiles: Infinity } },
    { limits: { maxFiles: 1.5 } },
    { limits: { bogus: 1 } },
    []
  ];
  for (const structure of bad) {
    assert.throws(() => resolvePolicy(structure), StructurePolicyError, JSON.stringify(structure));
  }
  assert.deepEqual(resolvePolicy(undefined).limits, DEFAULT_LIMITS);
});

test('a malformed .frame/config.json is a policy error; a missing one uses defaults', () => {
  scaffold({ 'a.js': 'x' });
  assert.equal(discoverProject(root).coverage, 'complete');
  scaffold({ '.frame/config.json': '{ not json' });
  assert.throws(() => discoverProject(root), StructurePolicyError);
});

test('legacy root meta files are excluded only when config.files owns them', () => {
  scaffold({
    'STRUCTURE.json': '{}',
    'STRUCTURE.json.bak': '{}',
    'STRUCTURE.json.corrupt-2026': '{',
    'tasks.json': '[]',
    'src/a.js': 'x'
  });
  assert.deepEqual(paths(discoverProject(root)), [
    'STRUCTURE.json', 'STRUCTURE.json.bak', 'STRUCTURE.json.corrupt-2026', 'src/a.js', 'tasks.json'
  ]);

  scaffold({ '.frame/config.json': JSON.stringify({ files: { structure: 'STRUCTURE.json' } }) });
  const owned = discoverProject(root);
  assert.deepEqual(paths(owned), ['src/a.js', 'tasks.json']);
  // their appearance or disappearance never changes the counts
  fs.rmSync(path.join(root, 'STRUCTURE.json.bak'));
  assert.deepEqual(discoverProject(root).counts, owned.counts);
  assert.ok(owned.policy.hardExclusions.includes('STRUCTURE.json.corrupt-*'));
});

/* --------------------------- classification --------------------------- */

test('unsupported languages and unknown text are eligible; binaries are counted, not listed', () => {
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hello', 'utf16le')]);
  scaffold({
    'app/models/user.rb': 'class User; end',
    'notes.custom': 'plain text',
    'data.bin2': Buffer.from([0x01, 0x00, 0x02]),
    'logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    'win.txt2': utf16,
    'latin1.legacy': Buffer.from([0x63, 0x61, 0x66, 0xe9]),
    'Procfile': 'web: node index.js'
  });
  const result = discover(root);
  assert.deepEqual(paths(result), ['Procfile', 'app/models/user.rb', 'latin1.legacy', 'notes.custom', 'win.txt2']);
  assert.equal(result.counts.binaryFiles, 2);
  const byPath = Object.fromEntries(result.files.map((f) => [f.path, f]));
  assert.equal(byPath['app/models/user.rb'].classifiedBy, 'extension');
  assert.equal(byPath['win.txt2'].encoding, 'utf-16le');
  assert.equal(byPath['latin1.legacy'].encoding, 'unknown');
  assert.equal(byPath['notes.custom'].encoding, 'utf-8');
});

test('sample classification recognizes BOMs before NUL bytes and tolerates a cut character', () => {
  assert.deepEqual(classifySample(Buffer.from([0xfe, 0xff, 0x00, 0x41])), { binary: false, encoding: 'utf-16be' });
  assert.deepEqual(classifySample(Buffer.from([0xff, 0xfe, 0x00, 0x00, 0x41, 0, 0, 0])), { binary: false, encoding: 'utf-32le' });
  assert.deepEqual(classifySample(Buffer.from([0xef, 0xbb, 0xbf, 0x41])), { binary: false, encoding: 'utf-8-bom' });
  assert.deepEqual(classifySample(Buffer.from([0x41, 0x00])), { binary: true });
  // "é" is 0xc3 0xa9 — a sample that ends after 0xc3 is still UTF-8
  assert.deepEqual(classifySample(Buffer.from([0x41, 0xc3])), { binary: false, encoding: 'utf-8' });
  assert.deepEqual(classifySample(Buffer.from([0x41, 0xc3]), true), { binary: false, encoding: 'unknown' });
  assert.deepEqual(classifySample(Buffer.alloc(0)), { binary: false, encoding: 'utf-8' });
});

test('large files are inventoried from a bounded sample', () => {
  scaffold({ 'big.data1': Buffer.alloc(5 * 1024 * 1024, 0x61) });
  const result = discover(root);
  assert.deepEqual(paths(result), ['big.data1']);
  assert.equal(result.files[0].sizeBytes, 5 * 1024 * 1024);
});

test('Unicode names keep their spelling and sort bytewise', () => {
  // distinct letters: default macOS volumes are case-insensitive
  scaffold({ 'ä.js': 'x', 'a.js': 'x', 'B.js': 'x', '日本.md': 'x' });
  assert.deepEqual(paths(discover(root)), ['B.js', 'a.js', 'ä.js', '日本.md']);
});

/* ------------------------- symlinks and errors ------------------------ */

test('symlinks and symlink cycles are never followed', () => {
  scaffold({ 'src/a.js': 'x', 'outside/secret.js': 'x' });
  fs.symlinkSync(root, path.join(root, 'src', 'loop'));
  fs.symlinkSync(path.join(root, 'src', 'a.js'), path.join(root, 'link.js'));
  const result = discover(root);
  assert.equal(result.coverage, 'complete');
  assert.deepEqual(paths(result), ['outside/secret.js', 'src/a.js']);
  assert.equal(result.counts.symlinks, 2);
});

test('an unreadable directory makes coverage partial without dropping its siblings', () => {
  scaffold({ 'ok/a.js': 'x', 'locked/b.js': 'x' });
  const result = discover(root, { fs: failingFs({ readdirSync: (rel) => (rel === 'locked' ? 'EACCES' : null) }) });
  assert.equal(result.coverage, 'partial');
  assert.deepEqual(result.incompleteReasons, ['unreadable']);
  assert.deepEqual(paths(result), ['ok/a.js']);
  assert.deepEqual(result.diagnostics.samples, [{ path: 'locked', reason: 'unreadable', code: 'EACCES' }]);
});

test('entry stat, sample read and ignore-file read failures are all partial coverage', () => {
  scaffold({
    'a.js': 'x',
    'gone.js': 'x',
    'mystery.x1': 'text',
    'sub/.gitignore': '*.js\n',
    'sub/c.js': 'x'
  });
  const result = discover(root, {
    fs: failingFs({
      lstatSync: (rel) => (rel === 'gone.js' ? 'EIO' : null),
      openSync: (rel) => (rel === 'mystery.x1' ? 'EACCES' : null),
      readFileSync: (rel) => (rel === 'sub/.gitignore' ? 'EACCES' : null)
    })
  });
  assert.equal(result.coverage, 'partial');
  assert.deepEqual(paths(result), ['a.js']);
  assert.equal(result.counts.unreadable, 3);
  assert.deepEqual(result.diagnostics.samples.map((s) => s.path), ['gone.js', 'mystery.x1', 'sub/.gitignore']);
});

test('diagnostic samples are capped while totals stay exact', () => {
  const files = {};
  for (let i = 0; i < MAX_DIAGNOSTIC_SAMPLES + 50; i++) files[`d${String(i).padStart(3, '0')}/a.js`] = 'x';
  scaffold(files);
  const result = discover(root, { fs: failingFs({ readdirSync: (rel) => (rel.startsWith('d') ? 'EACCES' : null) }) });
  assert.equal(result.diagnostics.total, MAX_DIAGNOSTIC_SAMPLES + 50);
  assert.equal(result.diagnostics.samples.length, MAX_DIAGNOSTIC_SAMPLES);
  assert.equal(result.diagnostics.truncated, true);
});

/* -------------------------------- bounds ------------------------------ */

test('maxFiles and maxEntries stop the walk and report partial coverage', () => {
  scaffold({ 'a.js': 'x', 'b.js': 'x', 'c.js': 'x' });
  const files = discover(root, { structure: { limits: { maxFiles: 2 } } });
  assert.equal(files.coverage, 'partial');
  assert.deepEqual(files.incompleteReasons, ['limit-maxFiles']);
  assert.equal(files.files.length, 2);

  const entries = discover(root, { structure: { limits: { maxEntries: 1 } } });
  assert.deepEqual(entries.incompleteReasons, ['limit-maxEntries']);
});

test('the time budget and cancellation end the walk as partial coverage', () => {
  scaffold({ 'a.js': 'x', 'b.js': 'x' });
  let clock = 0;
  const timedOut = discover(root, { structure: { limits: { timeoutMs: 5 } }, now: () => (clock += 3) });
  assert.equal(timedOut.coverage, 'partial');
  assert.deepEqual(timedOut.incompleteReasons, ['timeout']);

  const controller = new AbortController();
  controller.abort();
  const cancelled = discover(root, { signal: controller.signal });
  assert.deepEqual(cancelled.incompleteReasons, ['cancelled']);
  assert.deepEqual(cancelled.files, []);
});

test('repeated discovery of an unchanged tree is identical', () => {
  scaffold({ '.gitignore': '*.log\n', 'b/x.js': 'x', 'a/y.py': 'y', 'c.log': 'z' });
  assert.deepEqual(discover(root), discover(root));
});

test('a missing root is a failure, not an empty inventory', () => {
  assert.throws(() => discover(path.join(root, 'nope')), /not accessible/);
});

/* --------------------------- candidate paths -------------------------- */

test('evaluatePaths decides candidates by the same policy without walking the tree', () => {
  scaffold({
    '.gitignore': 'logs/\n*.log\n',
    'src/a.js': 'x',
    'src/b.log': 'x',
    'logs/keep.txt': 'x',
    'node_modules/x.js': 'x',
    'img.png': Buffer.from([0x89, 0x50]),
    'sub/.gitignore': '!special.log\n',
    'sub/special.log': 'x'
  });
  let readdirCalls = 0;
  const countingFs = { ...fs, readdirSync: (...args) => { readdirCalls++; return fs.readdirSync(...args); } };
  const { results, policyInputChanged } = evaluatePaths(root, [
    'src/a.js', 'src/b.log', 'logs/keep.txt', 'node_modules/x.js', 'img.png',
    'sub/special.log', 'deleted.js', 'src/a.js', '../escape.js', '/abs.js'
  ], { fs: countingFs });
  assert.equal(readdirCalls, 0);
  assert.equal(policyInputChanged, false);
  const byPath = Object.fromEntries(results.map((r) => [r.path, r]));
  assert.deepEqual(Object.keys(byPath).sort(), [
    'deleted.js', 'img.png', 'logs/keep.txt', 'node_modules/x.js', 'src/a.js', 'src/b.log', 'sub/special.log'
  ]);
  assert.equal(byPath['src/a.js'].status, 'eligible');
  assert.deepEqual(byPath['src/b.log'], { path: 'src/b.log', status: 'excluded', reason: 'gitignore' });
  assert.deepEqual(byPath['logs/keep.txt'], { path: 'logs/keep.txt', status: 'excluded', reason: 'gitignore' });
  assert.deepEqual(byPath['node_modules/x.js'], { path: 'node_modules/x.js', status: 'excluded', reason: 'default' });
  assert.deepEqual(byPath['img.png'], { path: 'img.png', status: 'excluded', reason: 'binary' });
  assert.equal(byPath['sub/special.log'].status, 'eligible');
  assert.deepEqual(byPath['deleted.js'], { path: 'deleted.js', status: 'missing' });
});

test('evaluatePaths never reports a filesystem error as a deletion', () => {
  scaffold({ 'src/a.js': 'x', 'src/b.js': 'x', '.gitignore': '' });
  const { results, policyInputChanged } = evaluatePaths(root, ['src/a.js', 'src/b.js', '.gitignore'], {
    fs: failingFs({ lstatSync: (rel) => (rel === 'src/a.js' ? 'EACCES' : null) })
  });
  const byPath = Object.fromEntries(results.map((r) => [r.path, r]));
  assert.deepEqual(byPath['src/a.js'], { path: 'src/a.js', status: 'error', reason: 'unreadable', code: 'EACCES' });
  assert.equal(byPath['src/b.js'].status, 'eligible');
  assert.equal(policyInputChanged, true);
});

test('evaluatePaths agrees with a full walk on every file in the tree', () => {
  scaffold({
    '.gitignore': '*.log\n!keep.log\nbuild/\n',
    'keep.log': 'x',
    'drop.log': 'x',
    'build/out.js': 'x',
    'a/b/c.js': 'x',
    'a/.gitignore': 'c.js\n!b/\n',
    'a/b/d.ts': 'x',
    '.frame/config.json': JSON.stringify({ project: { structure: { exclude: ['a/b/d.ts'] } } })
  });
  const all = ['keep.log', 'drop.log', 'build/out.js', 'a/b/c.js', 'a/b/d.ts', 'a/.gitignore', '.gitignore', '.frame/config.json'];
  const walked = new Set(paths(discoverProject(root)));
  const config = JSON.parse(fs.readFileSync(path.join(root, '.frame/config.json'), 'utf8'));
  const { results } = evaluatePaths(root, all, { structure: config.project.structure });
  for (const r of results) {
    assert.equal(r.status === 'eligible', walked.has(r.path), r.path);
  }
});

test('candidate paths are normalized to root-relative POSIX form', () => {
  assert.equal(normalizeCandidatePath('./src//a.js'), 'src/a.js');
  assert.equal(normalizeCandidatePath('../a.js'), null);
  assert.equal(normalizeCandidatePath('/etc/passwd'), null);
  assert.equal(normalizeCandidatePath(''), null);
  if (path.sep === '/') assert.equal(normalizeCandidatePath('odd\\name.js'), 'odd\\name.js');
});

// Differential check against Git itself. Discovery never needs Git; the test
// only uses it as the reference implementation, and skips where it is absent.
const { spawnSync } = require('child_process');
const HAS_GIT = spawnSync('git', ['--version']).status === 0;

test('nested ignore decisions match `git ls-files --others --exclude-standard`', { skip: !HAS_GIT && 'git not installed' }, () => {
  const files = {
    '.gitignore': [
      '*.log', '!keep.log', '/root-only.txt', 'src/hidden.js', 'logs/', '!logs/keep.txt',
      '**/gen/*.js', 'docs/**/draft-*', '!docs/a/draft-ok.md', 'cache', '*.tmp', '!/pkg/x.tmp',
      'foo/*', '!foo/bar/'
    ].join('\n'),
    'sub/.gitignore': '!debug.log\nlocal.txt\n',
    'sub/deeper/.gitignore': '!local.txt\n'
  };
  for (const rel of [
    'a.log', 'keep.log', 'root-only.txt', 'src/root-only.txt', 'src/hidden.js', 'src/visible.js',
    'logs/keep.txt', 'deep/gen/out.js', 'deep/gen/out.ts', 'docs/a/draft-1.md', 'docs/a/draft-ok.md',
    'docs/b/c/draft-2.md', 'docs/b/c/final.md', 'cache/x.js', 'src/cache', 'y.tmp', 'pkg/x.tmp',
    'pkg/z.tmp', 'foo/a.js', 'foo/bar/b.js', 'foo/baz/c.js', 'sub/debug.log', 'sub/other.log',
    'sub/local.txt', 'local.txt', 'sub/deeper/local.txt', 'sub/deeper/n.log'
  ]) files[rel] = 'x';
  scaffold(files);

  const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(git('init', '-q', '.').status, 0);
  git('config', 'core.ignorecase', 'false');
  git('config', 'core.excludesFile', os.devNull);
  const expected = git('ls-files', '--others', '--exclude-standard').stdout.split('\n').filter(Boolean);

  const actual = paths(discover(root, { structure: { ignoredDirectories: [] } }));
  const byteSort = (list) => [...list].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  assert.deepEqual(actual, byteSort(expected));
});
