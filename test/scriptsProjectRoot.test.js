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

test('an owned root STRUCTURE.json keeps being updated in place', () => {
  // Unmigrated project: the map is still at the root, so the parser must
  // keep writing there rather than starting a second copy under .frame/.
  // Ownership is the `config.files` record frameStore trusts (STR-01); a
  // root file without it is the user's and is left alone (tested below).
  const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-scripts-legacy-'));
  fs.mkdirSync(path.join(legacyDir, '.frame'), { recursive: true });
  fs.writeFileSync(path.join(legacyDir, '.frame', 'config.json'), JSON.stringify({ files: { structure: 'STRUCTURE.json' } }));
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

/* ---------- STR-01: one STRUCTURE ownership rule for writer and readers ---------- */

const structureState = require('../scripts/structure-state');
const SCRIPTS = path.join(__dirname, '..', 'scripts');

function ownershipProject({ overlay = false, root = false, owned = false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-owner-'));
  fs.mkdirSync(path.join(dir, '.frame'), { recursive: true });
  const map = (label) => JSON.stringify({
    version: '1.1',
    modules: { [`${label}Widget`]: { file: `src/${label}Widget.js`, description: label } },
    intentIndex: { widget: [{ module: `${label}Widget`, file: `src/${label}Widget.js`, description: label }] }
  });
  if (overlay) fs.writeFileSync(path.join(dir, '.frame', 'STRUCTURE.json'), map('overlay'));
  if (root) fs.writeFileSync(path.join(dir, 'STRUCTURE.json'), map('root'));
  if (owned) fs.writeFileSync(path.join(dir, '.frame', 'config.json'), JSON.stringify({ files: { structure: 'STRUCTURE.json' } }));
  return dir;
}

/** Which copy each reader used: find-module prints files, freshness flags phantoms. */
function readersSee(dir) {
  const env = { ...process.env, FRAME_PROJECT_ROOT: dir };
  const find = spawnSync('node', [path.join(SCRIPTS, 'find-module.js'), 'widget'], { encoding: 'utf8', env });
  const fresh = spawnSync('node', [path.join(SCRIPTS, 'check-freshness.js'), '--json'], { encoding: 'utf8', env });
  const hint = spawnSync('node', [path.join(SCRIPTS, 'module-hint.js'), 'search'], {
    encoding: 'utf8', env,
    input: JSON.stringify({ session_id: `s-${Math.random()}`, cwd: dir, tool_name: 'Grep', tool_input: { pattern: 'widget' } })
  });
  const pick = (text) => (/overlayWidget/.test(text) ? 'overlay' : /rootWidget/.test(text) ? 'root' : 'none');
  const phantoms = JSON.parse(fresh.stdout).findings.filter((f) => f.check === 'phantom-module').map((f) => f.message).join(' ');
  return { find: pick(find.stdout), freshness: pick(phantoms), hint: pick(hint.stdout) };
}

for (const [label, layout, expected] of [
  ['overlay only', { overlay: true }, 'overlay'],
  ['unowned root file only', { root: true }, 'none'],
  ['owned root file', { root: true, owned: true }, 'root'],
  ['overlay beside an owned root file', { overlay: true, root: true, owned: true }, 'overlay']
]) {
  test(`writer and every reader agree on STRUCTURE ownership: ${label}`, () => {
    const dir = ownershipProject(layout);
    try {
      const writerTarget = structureState.resolveStructurePath(dir);
      const writer = writerTarget === path.join(dir, 'STRUCTURE.json') ? 'root' : 'overlay';
      const readers = readersSee(dir);
      if (expected === 'none') {
        assert.equal(writer, 'overlay', 'the writer creates the overlay, never touches the user file');
        assert.deepEqual(readers, { find: 'none', freshness: 'none', hint: 'none' });
      } else {
        assert.equal(writer, expected);
        assert.deepEqual(readers, { find: expected, freshness: expected, hint: expected });
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('the parser leaves an unrelated root STRUCTURE.json alone and writes the overlay', () => {
  const dir = ownershipProject({ root: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), '// A\n');
  const before = fs.readFileSync(path.join(dir, 'STRUCTURE.json'), 'utf8');
  try {
    const result = spawnSync('node', [path.join(SCRIPTS, 'update-structure.js')], { encoding: 'utf8', env: { ...process.env, FRAME_PROJECT_ROOT: dir } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(dir, 'STRUCTURE.json'), 'utf8'), before);
    const map = JSON.parse(fs.readFileSync(path.join(dir, '.frame', 'STRUCTURE.json'), 'utf8'));
    assert.ok(map.modules.a);
    // the user's file is ordinary project content in the inventory
    assert.ok(Object.values(map.modules).some((m) => m.file === 'STRUCTURE.json'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readers report partial, unverified and non-replacing scans; a missing attempt record is silent', () => {
  const dir = ownershipProject({ overlay: true });
  const env = { ...process.env, FRAME_PROJECT_ROOT: dir };
  const freshness = () => JSON.parse(spawnSync('node', [path.join(SCRIPTS, 'check-freshness.js'), '--json'], { encoding: 'utf8', env }).stdout)
    .findings.filter((f) => f.check === 'structure-generation').map((f) => f.message);
  const find = () => spawnSync('node', [path.join(SCRIPTS, 'find-module.js'), 'widget'], { encoding: 'utf8', env }).stdout;
  const setMap = (generation) => {
    const file = path.join(dir, '.frame', 'STRUCTURE.json');
    const map = JSON.parse(fs.readFileSync(file, 'utf8'));
    map.generation = generation;
    fs.writeFileSync(file, JSON.stringify(map));
  };
  try {
    assert.deepEqual(freshness(), [], 'no generation block and no attempt record → nothing to report');

    setMap({ inventory: { coverage: 'partial', reasons: ['limit-maxFiles'] } });
    assert.match(freshness()[0], /covers only part of the project \(limit-maxFiles\).*--full/);
    assert.match(find(), /covers only part of the project/);

    setMap({ inventory: { coverage: 'unknown', reasons: ['no-baseline'] } });
    assert.match(freshness()[0], /not been verified by a full scan/);

    setMap({ inventory: { coverage: 'unknown', reasons: ['delta'] } });
    assert.deepEqual(freshness(), [], 'an ordinary partial update is not a warning');

    fs.mkdirSync(path.join(dir, '.frame', 'runtime', 'structure'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.frame', 'runtime', 'structure', 'scan.json'), JSON.stringify({ state: 'partial', retainedPrevious: true, reason: 'incomplete-inventory' }));
    assert.match(freshness()[0], /earlier scan — the latest one was incomplete/);

    fs.writeFileSync(path.join(dir, '.frame', 'runtime', 'structure', 'scan.json'), JSON.stringify({ state: 'interrupted', published: true, acknowledged: false }));
    assert.match(freshness()[0], /interrupted right after publishing/);

    // readers never repair: the map is byte-identical afterwards
    const before = fs.readFileSync(path.join(dir, '.frame', 'STRUCTURE.json'), 'utf8');
    find();
    freshness();
    assert.equal(fs.readFileSync(path.join(dir, '.frame', 'STRUCTURE.json'), 'utf8'), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------- STR-01: the pre-commit hook after the pipeline change ------------- */

test('the hook snippet is unchanged: --changed, non-blocking, stages only the map target', () => {
  const { getStructureHookSnippet } = require('../src/shared/frameTemplates');
  const snippet = getStructureHookSnippet();
  assert.match(snippet, /node "\$FRAME_PARSER" --changed \|\| true/);
  assert.ok(!/--full/.test(snippet), 'no full scan in a commit hook');
  const staged = [...snippet.matchAll(/git add "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(staged, ['$FRAME_ROOT/.frame/STRUCTURE.json', '$FRAME_ROOT/STRUCTURE.json']);
});

test('full map → hook commit → no-op commit: unaffected entries and no-op bytes survive, nothing else is staged', () => {
  const { getStructureHookSnippet } = require('../src/shared/frameTemplates');
  const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-hook-delta-'));
  try {
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 'test@example.com']);
    git(dir, ['config', 'user.name', 'Test']);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), '// A\n');
    fs.writeFileSync(path.join(dir, 'src', 'b.js'), '// B\n');
    fs.writeFileSync(path.join(dir, 'app', 'user.rb'), 'class User; end\n');
    fs.writeFileSync(path.join(dir, 'README.md'), '# Readme\n');
    structureBootstrap.copyParserScripts(dir);
    const full = spawnSync('node', [path.join(dir, '.frame', 'bin', 'update-structure.js')], { cwd: dir, encoding: 'utf8', env: { ...process.env, FRAME_PROJECT_ROOT: undefined } });
    assert.equal(full.status, 0, full.stderr);
    const mapFile = path.join(dir, '.frame', 'STRUCTURE.json');
    const before = JSON.parse(fs.readFileSync(mapFile, 'utf8'));

    const hookFile = path.join(dir, '.git', 'run-hook.sh');
    fs.writeFileSync(hookFile, `#!/bin/sh\n${getStructureHookSnippet()}\nexit 0\n`, { mode: 0o755 });

    fs.writeFileSync(path.join(dir, 'src', 'a.js'), '// A changed\n');
    git(dir, ['add', 'src/a.js']);
    const hook = spawnSync('sh', [hookFile], { cwd: dir, encoding: 'utf8' });
    assert.equal(hook.status, 0, hook.stderr);
    const staged = git(dir, ['diff', '--cached', '--name-only']).stdout.split('\n').filter(Boolean).sort();
    assert.deepEqual(staged, ['.frame/STRUCTURE.json', 'src/a.js'], 'no runtime, recovery or source files beyond the commit');

    const after = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    assert.equal(after.modules.a.description, 'A changed');
    for (const key of ['b', 'app/user.rb', 'README']) assert.deepEqual(after.modules[key], before.modules[key], key);

    git(dir, ['commit', '-q', '-m', 'change']);
    const bytes = fs.readFileSync(mapFile, 'utf8');
    const noop = spawnSync('sh', [hookFile], { cwd: dir, encoding: 'utf8' });
    assert.equal(noop.status, 0, noop.stderr);
    assert.equal(fs.readFileSync(mapFile, 'utf8'), bytes, 'a no-op hook run leaves the map bytes alone');
    assert.deepEqual(git(dir, ['diff', '--cached', '--name-only']).stdout.trim(), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a busy parser keeps the commit non-blocking and says the map was not refreshed', () => {
  const { getStructureHookSnippet } = require('../src/shared/frameTemplates');
  const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-hook-busy-'));
  try {
    git(dir, ['init', '-q']);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), '// A\n');
    structureBootstrap.copyParserScripts(dir);
    spawnSync('node', [path.join(dir, '.frame', 'bin', 'update-structure.js')], { cwd: dir, encoding: 'utf8', env: { ...process.env, FRAME_PROJECT_ROOT: undefined } });
    const mapFile = path.join(dir, '.frame', 'STRUCTURE.json');
    const bytes = fs.readFileSync(mapFile, 'utf8');
    fs.writeFileSync(path.join(dir, '.frame', 'runtime', 'structure', 'lock'), JSON.stringify({ token: 'x', pid: process.pid, host: os.hostname() }));
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), '// A changed\n');
    git(dir, ['add', 'src/a.js']);
    const hookFile = path.join(dir, '.git', 'run-hook.sh');
    fs.writeFileSync(hookFile, `#!/bin/sh\n${getStructureHookSnippet()}\nexit 0\n`, { mode: 0o755 });
    const hook = spawnSync('sh', [hookFile], { cwd: dir, encoding: 'utf8' });
    assert.equal(hook.status, 0);
    assert.match(hook.stderr, /not refreshed/);
    assert.equal(fs.readFileSync(mapFile, 'utf8'), bytes);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a linked worktree borrowing the main parser leaves the main checkout\'s map and state alone', () => {
  const { getStructureHookSnippet } = require('../src/shared/frameTemplates');
  const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  const mainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-wt-main-'));
  const worktreeDir = path.join(os.tmpdir(), `frame-wt-linked-${process.pid}-${Date.now()}`);
  try {
    git(mainDir, ['init', '-q']);
    git(mainDir, ['config', 'user.email', 'test@example.com']);
    git(mainDir, ['config', 'user.name', 'Test']);
    fs.mkdirSync(path.join(mainDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(mainDir, 'src', 'mainOnly.js'), '// Main\n');
    fs.writeFileSync(path.join(mainDir, '.gitignore'), '.frame/\n');
    git(mainDir, ['add', '.']);
    git(mainDir, ['commit', '-q', '-m', 'init']);
    structureBootstrap.copyParserScripts(mainDir);
    fs.writeFileSync(path.join(mainDir, '.frame', 'bin', 'intent-map.json'), JSON.stringify({ widgets: { modules: ['gadget'] } }));
    spawnSync('node', [path.join(mainDir, '.frame', 'bin', 'update-structure.js')], { cwd: mainDir, env: { ...process.env, FRAME_PROJECT_ROOT: undefined } });
    const mainMap = fs.readFileSync(path.join(mainDir, '.frame', 'STRUCTURE.json'), 'utf8');
    const mainScan = fs.readFileSync(path.join(mainDir, '.frame', 'runtime', 'structure', 'scan.json'), 'utf8');

    git(mainDir, ['worktree', 'add', '-q', '-b', 'wt', worktreeDir]);
    fs.writeFileSync(path.join(worktreeDir, 'src', 'gadget.js'), '// Gadget\n');
    git(worktreeDir, ['add', 'src/gadget.js']);
    const hookFile = path.join(worktreeDir, 'run-hook.sh');
    fs.writeFileSync(hookFile, `#!/bin/sh\n${getStructureHookSnippet()}\nexit 0\n`, { mode: 0o755 });
    const result = spawnSync('sh', [hookFile], { cwd: worktreeDir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);

    const wtMap = JSON.parse(fs.readFileSync(path.join(worktreeDir, '.frame', 'STRUCTURE.json'), 'utf8'));
    assert.ok(wtMap.modules.gadget, 'the worktree map describes the worktree');
    // curation is looked up beside the borrowed parser, as before STR-01
    assert.deepEqual(wtMap.intentIndex.widgets.map((e) => e.file), ['src/gadget.js']);
    assert.ok(fs.existsSync(path.join(worktreeDir, '.frame', 'runtime', 'structure', 'scan.json')), 'state belongs to the worktree');
    assert.equal(fs.readFileSync(path.join(mainDir, '.frame', 'STRUCTURE.json'), 'utf8'), mainMap, 'main map untouched');
    assert.equal(fs.readFileSync(path.join(mainDir, '.frame', 'runtime', 'structure', 'scan.json'), 'utf8'), mainScan, 'main state untouched');
    assert.ok(!fs.existsSync(path.join(mainDir, '.frame', 'runtime', 'structure', 'lock')));
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', worktreeDir], { cwd: mainDir });
    fs.rmSync(worktreeDir, { recursive: true, force: true });
    fs.rmSync(mainDir, { recursive: true, force: true });
  }
});

/* ---------------- STR-02: readers on the freshness contract ---------------- */

const lifecycleScript = path.join(SCRIPTS, 'structure-lifecycle.js');
const { readDescriptor } = require('../scripts/structure-read');

function lifecycleState(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, '.frame', 'runtime', 'structure', 'lifecycle.json'), 'utf8'));
}

test('readers report the lifecycle freshness and skip the date heuristic once it is known', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-fresh-readers-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.frame'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'widgetMaker.js'), '// Widget maker\n');
  fs.writeFileSync(path.join(dir, 'src', 'widgetStore.js'), '// Widget store\n');
  const env = { ...process.env, FRAME_PROJECT_ROOT: dir };
  const find = () => spawnSync('node', [path.join(SCRIPTS, 'find-module.js'), 'widget'], { encoding: 'utf8', env }).stdout;
  const findings = () => JSON.parse(spawnSync('node', [path.join(SCRIPTS, 'check-freshness.js'), '--json'], { encoding: 'utf8', env }).stdout)
    .findings.filter((f) => f.check.startsWith('structure-')).map((f) => `${f.check}: ${f.message}`);
  try {
    assert.equal(spawnSync('node', [lifecycleScript, '--once'], { env }).status, 0);
    assert.match(find(), /^Map: fresh · working tree/);
    assert.deepEqual(findings(), []);

    const state = lifecycleState(dir);
    state.epoch = { requested: 5, applied: 4 };
    state.dirty = ['file-event'];
    state.missedBound = { reason: 'changing-files', at: new Date().toISOString() };
    fs.writeFileSync(path.join(dir, '.frame', 'runtime', 'structure', 'lifecycle.json'), JSON.stringify(state));
    assert.match(find(), /^⚠ Map: dirty \(file-event\)/);
    assert.deepEqual(findings(), [
      'structure-freshness: STRUCTURE.json is dirty (file-event) — changes are waiting to be applied',
      'structure-freshness: the last STRUCTURE update missed its time bound (changing-files)'
    ]);

    state.dirty = [];
    state.epoch = { requested: 5, applied: 5 };
    state.missedBound = null;
    state.receipt.observedAt = '2020-01-01T00:00:00.000Z';
    fs.writeFileSync(path.join(dir, '.frame', 'runtime', 'structure', 'lifecycle.json'), JSON.stringify(state));
    assert.match(find(), /^⚠ Map: stale \(lease-expired\) — run: node .*structure-lifecycle\.js --once/);
    assert.match(findings()[0], /is stale \(lease-expired\)/);

    const mapFile = path.join(dir, '.frame', 'STRUCTURE.json');
    fs.writeFileSync(mapFile, fs.readFileSync(mapFile, 'utf8').replace('Widget maker', 'Edited by hand'));
    assert.match(find(), /^⚠ Map: unverified \(artifact-changed\)/);
    assert.match(findings()[0], /changed since it was last verified \(artifact-changed\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a linked worktree keeps its own map, receipt and lease when it borrows the main parser', () => {
  const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  const mainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-life-main-'));
  const worktreeDir = path.join(os.tmpdir(), `frame-life-wt-${process.pid}-${Date.now()}`);
  try {
    git(mainDir, ['init', '-q']);
    git(mainDir, ['config', 'user.email', 'test@example.com']);
    git(mainDir, ['config', 'user.name', 'Test']);
    fs.mkdirSync(path.join(mainDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(mainDir, 'src', 'mainOnly.js'), '// Main\n');
    fs.writeFileSync(path.join(mainDir, '.gitignore'), '.frame/\n');
    git(mainDir, ['add', '.']);
    git(mainDir, ['commit', '-q', '-m', 'init']);
    structureBootstrap.copyParserScripts(mainDir);
    const mainBin = path.join(mainDir, '.frame', 'bin', 'structure-lifecycle.js');
    assert.equal(spawnSync('node', [mainBin, '--once'], { env: { ...process.env, FRAME_PROJECT_ROOT: undefined } }).status, 0);
    const mainState = fs.readFileSync(path.join(mainDir, '.frame', 'runtime', 'structure', 'lifecycle.json'), 'utf8');

    git(mainDir, ['worktree', 'add', '-q', '-b', 'wt', worktreeDir]);
    fs.writeFileSync(path.join(worktreeDir, 'src', 'worktreeOnly.js'), '// Worktree\n');
    assert.equal(spawnSync('node', [mainBin, '--once'], { env: { ...process.env, FRAME_PROJECT_ROOT: worktreeDir } }).status, 0);

    const wtMap = JSON.parse(fs.readFileSync(path.join(worktreeDir, '.frame', 'STRUCTURE.json'), 'utf8'));
    assert.ok(wtMap.modules.worktreeOnly);
    assert.equal(readDescriptor(worktreeDir).freshness, 'fresh');
    assert.equal(lifecycleState(worktreeDir).checkout, fs.realpathSync(worktreeDir));
    assert.equal(fs.readFileSync(path.join(mainDir, '.frame', 'runtime', 'structure', 'lifecycle.json'), 'utf8'), mainState, 'main receipt untouched');
    assert.ok(!JSON.parse(fs.readFileSync(path.join(mainDir, '.frame', 'STRUCTURE.json'), 'utf8')).modules.worktreeOnly);
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', worktreeDir], { cwd: mainDir });
    fs.rmSync(worktreeDir, { recursive: true, force: true });
    fs.rmSync(mainDir, { recursive: true, force: true });
  }
});
