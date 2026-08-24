/**
 * Shipped-script project-root tests (non-invasive-overlay T03).
 *
 * The copies under a project's `.frame/bin/` used to resolve their project as
 * `__dirname/..`, which is `.frame/` — so running one by hand from a user
 * project reported on (or wrote into) the wrong tree. Each script now derives
 * the project from its own location, honours FRAME_PROJECT_ROOT above
 * everything, and resolves meta files overlay-first without ever creating one
 * at the project root.
 *
 * The scripts are staged with the real `copyParserScripts`, so this also pins
 * that migration's refresh path ships everything they require.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const structureBootstrap = require('../src/main/structureBootstrap');

let projectDir;
let binDir;

function run(script, args = [], env = {}) {
  return spawnSync('node', [path.join(binDir, script), ...args], {
    // cwd is deliberately somewhere else: the script must find the project
    // from its own location, not from where it happens to be invoked.
    cwd: os.tmpdir(),
    encoding: 'utf8',
    env: { ...process.env, FRAME_PROJECT_ROOT: undefined, ...env },
    timeout: 30000
  });
}

before(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-scripts-'));
  fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });

  fs.writeFileSync(
    path.join(projectDir, 'src', 'widgetManager.js'),
    [
      '/**',
      ' * Widget Manager — creates and stores widgets.',
      ' */',
      'function createWidget(name) { return { name }; }',
      'module.exports = { createWidget };',
      ''
    ].join('\n'),
    'utf8'
  );
  fs.writeFileSync(
    path.join(projectDir, 'src', 'reportPrinter.js'),
    [
      '/**',
      ' * Report Printer — renders widget reports.',
      ' */',
      'function printReport(rows) { return rows.join("\\n"); }',
      'module.exports = { printReport };',
      ''
    ].join('\n'),
    'utf8'
  );

  binDir = path.join(projectDir, '.frame', 'bin');
  structureBootstrap.copyParserScripts(projectDir);
});

after(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('copyParserScripts stages the scripts and their extractors', () => {
  for (const file of ['update-structure.js', 'find-module.js', 'check-freshness.js', 'intent-map.json']) {
    assert.ok(fs.existsSync(path.join(binDir, file)), `${file} staged`);
  }
  assert.ok(fs.existsSync(path.join(binDir, 'lang', 'javascript.js')), 'lang extractors staged');
});

test('update-structure.js writes .frame/STRUCTURE.json for the project it lives in', () => {
  const result = run('update-structure.js');
  assert.equal(result.status, 0, result.stderr);

  const overlayPath = path.join(projectDir, '.frame', 'STRUCTURE.json');
  assert.ok(fs.existsSync(overlayPath), 'map written under .frame/');
  assert.ok(!fs.existsSync(path.join(projectDir, 'STRUCTURE.json')), 'nothing created at the project root');

  const structure = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
  const keys = Object.keys(structure.modules);
  assert.ok(keys.some((k) => k.includes('widgetManager')), `widgetManager in ${keys}`);
  assert.ok(keys.some((k) => k.includes('reportPrinter')), `reportPrinter in ${keys}`);
});

test('find-module.js resolves the same project', () => {
  const result = run('find-module.js', ['widget']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /widgetManager/);
});

test('check-freshness.js reports no phantom modules for a freshly parsed tree', () => {
  const result = run('check-freshness.js', ['--json']);
  assert.equal(result.status, 0, result.stderr);
  const findings = JSON.parse(result.stdout);
  const phantom = (findings.findings || findings).filter((f) => f.check === 'phantom-module');
  assert.deepEqual(phantom, [], 'the modules it lists are the ones on disk');
});

test('an existing root STRUCTURE.json keeps being updated in place', () => {
  // Unmigrated project: the map is still at the root, so the parser must
  // keep writing there rather than starting a second copy under .frame/.
  const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-scripts-legacy-'));
  fs.mkdirSync(path.join(legacyDir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(legacyDir, 'src', 'legacyModule.js'),
    '/** Legacy Module — one export. */\nmodule.exports = { legacy: true };\n',
    'utf8'
  );
  fs.writeFileSync(path.join(legacyDir, 'STRUCTURE.json'), JSON.stringify({ modules: {} }, null, 2) + '\n', 'utf8');
  structureBootstrap.copyParserScripts(legacyDir);

  const result = spawnSync('node', [path.join(legacyDir, '.frame', 'bin', 'update-structure.js')], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    env: { ...process.env, FRAME_PROJECT_ROOT: undefined },
    timeout: 30000
  });
  assert.equal(result.status, 0, result.stderr);

  const structure = JSON.parse(fs.readFileSync(path.join(legacyDir, 'STRUCTURE.json'), 'utf8'));
  assert.ok(Object.keys(structure.modules).some((k) => k.includes('legacyModule')), 'root map updated');
  assert.ok(!fs.existsSync(path.join(legacyDir, '.frame', 'STRUCTURE.json')), 'no second copy under .frame/');

  fs.rmSync(legacyDir, { recursive: true, force: true });
});

test('the pre-commit snippet updates a linked worktree\'s own STRUCTURE.json', () => {
  // Worker worktrees (.frame/worktrees/<slug>) are linked checkouts. Resolving
  // the parser from `--show-toplevel` alone finds nothing there when the
  // checkout has no .frame/bin of its own, and the hook silently did nothing.
  const { getStructureHookSnippet } = require('../src/shared/frameTemplates');
  const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

  const mainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-hook-main-'));
  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-hook-wt-'));
  fs.rmSync(worktreeDir, { recursive: true, force: true });
  try {
    git(mainDir, ['init', '-q']);
    git(mainDir, ['config', 'user.email', 'test@example.com']);
    git(mainDir, ['config', 'user.name', 'Test']);
    fs.mkdirSync(path.join(mainDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(mainDir, 'src', 'widgetManager.js'), '/** Widget Manager — one export. */\nmodule.exports = {};\n', 'utf8');
    git(mainDir, ['add', 'src']);
    git(mainDir, ['commit', '-q', '-m', 'init']);
    structureBootstrap.copyParserScripts(mainDir); // only the main checkout has .frame/bin

    git(mainDir, ['worktree', 'add', '-q', '-b', 'wt', worktreeDir]);
    assert.ok(!fs.existsSync(path.join(worktreeDir, '.frame', 'bin')), 'the worktree has no parser of its own');

    fs.writeFileSync(path.join(worktreeDir, 'src', 'gadgetManager.js'), '/** Gadget Manager — one export. */\nmodule.exports = {};\n', 'utf8');
    git(worktreeDir, ['add', 'src/gadgetManager.js']);

    const hookFile = path.join(worktreeDir, 'run-hook.sh');
    fs.writeFileSync(hookFile, `#!/bin/sh\n${getStructureHookSnippet()}\nexit 0\n`, { mode: 0o755 });
    const result = spawnSync('sh', [hookFile], { cwd: worktreeDir, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr);

    const written = path.join(worktreeDir, '.frame', 'STRUCTURE.json');
    assert.ok(fs.existsSync(written), 'the worktree got its own STRUCTURE.json');
    const structure = JSON.parse(fs.readFileSync(written, 'utf8'));
    assert.ok(Object.keys(structure.modules).some((k) => k.includes('gadgetManager')), 'and it describes the worktree');
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', worktreeDir], { cwd: mainDir });
    fs.rmSync(worktreeDir, { recursive: true, force: true });
    fs.rmSync(mainDir, { recursive: true, force: true });
  }
});

test('FRAME_PROJECT_ROOT still wins over the script location', () => {
  const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-scripts-other-'));
  fs.mkdirSync(path.join(otherDir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(otherDir, 'src', 'otherModule.js'),
    '/** Other Module — elsewhere entirely. */\nmodule.exports = { other: true };\n',
    'utf8'
  );

  // Same staged script, pointed at a different project by env alone.
  const result = run('update-structure.js', [], { FRAME_PROJECT_ROOT: otherDir });
  assert.equal(result.status, 0, result.stderr);

  const structure = JSON.parse(fs.readFileSync(path.join(otherDir, '.frame', 'STRUCTURE.json'), 'utf8'));
  assert.ok(Object.keys(structure.modules).some((k) => k.includes('otherModule')), 'env target parsed');

  const staged = JSON.parse(fs.readFileSync(path.join(projectDir, '.frame', 'STRUCTURE.json'), 'utf8'));
  assert.ok(!Object.keys(staged.modules).some((k) => k.includes('otherModule')), 'the script\'s own project untouched');

  fs.rmSync(otherDir, { recursive: true, force: true });
});
