/**
 * Cross-project fixture suite (T02+). The committed golden STRUCTURE.json in
 * test/fixtures/js-src-app locks the parser's output for a src/+CJS+npm
 * project. STR-01 upgraded it once to version 1.1 (new inventory entries and
 * the generation block) while keeping every legacy module key and extracted
 * fact; from then on regeneration must be byte-identical. T05 extends this
 * file with per-fixture stack assertions; STR-01 T05 adds the CLI's
 * mode-specific result contract.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const PARSER = path.join(REPO_ROOT, 'scripts', 'update-structure.js');
const FIXTURES = path.join(__dirname, 'fixtures');

function runParser(projectRoot, args = []) {
  return spawnSync('node', [PARSER, ...args], {
    env: { ...process.env, FRAME_PROJECT_ROOT: projectRoot },
    encoding: 'utf8'
  });
}

/**
 * A temporary copy of js-src-app. Its golden lives at the project root, so
 * the copy records Frame's legacy ownership (`config.files`) — without that
 * record a root STRUCTURE.json is the user's own file and is never written.
 */
function goldenCopy() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-golden-'));
  fs.cpSync(path.join(FIXTURES, 'js-src-app'), tmp, { recursive: true });
  fs.mkdirSync(path.join(tmp, '.frame'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.frame', 'config.json'), JSON.stringify({ files: { structure: 'STRUCTURE.json' } }));
  return tmp;
}

const GOLDEN = () => fs.readFileSync(path.join(FIXTURES, 'js-src-app', 'STRUCTURE.json'), 'utf8');

test('golden: js-src-app STRUCTURE.json is in sync with the parser (--check)', () => {
  const tmp = goldenCopy();
  try {
    const res = runParser(tmp, ['--check']);
    assert.equal(res.status, 0, `--check reported drift:\n${res.stdout}${res.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// The golden sits at the fixture root, so this pair also covers legacy
// ownership: an owned root STRUCTURE.json keeps being updated in place.
test('golden: repeated full regens on a js-src-app copy stay byte-identical to the golden', () => {
  const tmp = goldenCopy();
  try {
    for (let i = 0; i < 2; i++) {
      const res = runParser(tmp);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(fs.readFileSync(path.join(tmp, 'STRUCTURE.json'), 'utf8'), GOLDEN(), `regen ${i + 1}`);
    }
    assert.ok(!fs.existsSync(path.join(tmp, '.frame', 'STRUCTURE.json')), 'no second copy under .frame/');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('golden: the 1.1 upgrade kept the legacy module keys and their extracted facts', () => {
  const golden = JSON.parse(GOLDEN());
  assert.equal(golden.version, '1.1');
  assert.equal(golden.modules.index.file, 'src/index.js');
  assert.deepEqual(golden.modules.index.exports, ['greet', 'run']);
  assert.deepEqual(golden.modules.index.depends, ['lib/mathUtils']);
  assert.equal(golden.modules.index.functions.greet.purpose, 'Format a greeting with a computed sum');
  assert.deepEqual(golden.modules['lib/mathUtils'].exports, ['add', 'multiply']);
  assert.equal(golden.generation.inventory.coverage, 'complete');
});

/* ----------------- detect → parse pipeline per fixture ----------------- */

const DETECTOR = path.join(REPO_ROOT, 'scripts', 'detect-project.js');

/**
 * Copy a fixture to a tmp dir, run detect-project --write, then a full
 * parse. Returns the resulting STRUCTURE.json object (tmp dir is removed).
 */
function initAndParse(fixtureName) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `frame-fixture-`));
  try {
    fs.cpSync(path.join(FIXTURES, fixtureName), tmp, { recursive: true });
    fs.mkdirSync(path.join(tmp, '.frame'), { recursive: true });
    const detect = spawnSync('node', [DETECTOR, '--write', tmp], { encoding: 'utf8' });
    assert.equal(detect.status, 0, detect.stderr);
    const parse = runParser(tmp);
    assert.equal(parse.status, 0, parse.stderr);
    const raw = fs.readFileSync(path.join(tmp, '.frame', 'STRUCTURE.json'), 'utf8');
    // Output must never carry Frame's own vocabulary into a user project
    for (const sentinel of ['TERMINAL_', 'CLAUDE_', 'GITHUB_', 'FRAME_PROJECT', 'multiTerminal']) {
      assert.ok(!raw.includes(sentinel), `fixture output contains Frame vocabulary "${sentinel}"`);
    }
    return JSON.parse(raw);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('django-app: non-empty, stack-appropriate modules', () => {
  const s = initAndParse('django-app');
  const views = s.modules['mysite/views'];
  assert.ok(views, `mysite/views missing — modules: ${Object.keys(s.modules)}`);
  assert.equal(views.description, 'Views for the sample site.');
  assert.deepEqual(views.exports, ['index', 'HealthCheck']);
  assert.ok(views.depends.includes('django.http'));
  assert.equal(views.functions.index.purpose, 'Render the landing page.');
});

test('go-service: cmd/ + internal/ modules with exported names', () => {
  const s = initAndParse('go-service');
  const store = s.modules['internal/store/store'];
  assert.ok(store, `internal/store/store missing — modules: ${Object.keys(s.modules)}`);
  assert.equal(store.description, 'Package store keeps records in memory.');
  assert.deepEqual(store.exports, ['Get', 'Put']);
  assert.ok(s.modules['cmd/server/main']);
});

test('rust-workspace: member crates parsed with pub items', () => {
  const s = initAndParse('rust-workspace');
  const lib = s.modules['crates/parser/src/lib'];
  assert.ok(lib, `crates/parser/src/lib missing — modules: ${Object.keys(s.modules)}`);
  assert.equal(lib.description, 'Parsing utilities.');
  assert.deepEqual(lib.exports, ['parse', 'Document']);
  assert.ok(s.modules['crates/cli/src/main']);
});

test('pnpm-monorepo: workspace packages parsed incl. TS and ESM', () => {
  const s = initAndParse('pnpm-monorepo');
  const button = s.modules['packages/ui/src/button'];
  assert.ok(button, `packages/ui/src/button missing — modules: ${Object.keys(s.modules)}`);
  assert.deepEqual(button.exports, ['button']);
  assert.deepEqual(button.functions.button.params, ['label']); // TS annotation stripped
  assert.ok(s.modules['packages/core/index']);
});

test('docs-repo: markdown file map with heading descriptions', () => {
  const s = initAndParse('docs-repo');
  const guide = s.modules['docs/guide'];
  assert.ok(guide, `docs/guide missing — modules: ${Object.keys(s.modules)}`);
  assert.equal(guide.description, 'Guide');
  assert.deepEqual(guide.exports, []);
  assert.ok(s.modules['docs/api']);
});

/* --------------------- templates from detection ------------------------ */

const templates = require('../src/shared/frameTemplates');
const { detectProject } = require(DETECTOR);

test('templates: QUICKSTART carries the detected commands, never npm defaults', () => {
  const project = detectProject(path.join(FIXTURES, 'django-app'));
  const q = templates.getQuickstartTemplate('django-app', project);
  assert.ok(q.includes('poetry install'));
  assert.ok(q.includes('python manage.py runserver'));
  assert.ok(q.includes('poetry run pytest'));
  assert.ok(!q.includes('npm'), 'npm leaked into a Python project QUICKSTART');
  assert.ok(!q.includes('todos.json'), 'todos.json bug resurfaced');
  assert.ok(q.includes('tasks.json'));
  assert.ok(q.includes('mysite/'), 'detected source root missing from the tree');
});

test('templates: unknown commands render as explicit TODO, not a guess', () => {
  const q = templates.getQuickstartTemplate('mystery', null);
  assert.ok(q.includes("TODO: confirm — Frame couldn't detect this"));
  assert.ok(!q.includes('npm install'));
  assert.ok(!q.includes('todos.json'));
});

test('templates: AGENTS.md records the detected stack and the record-your-stack rule', () => {
  const project = detectProject(path.join(FIXTURES, 'go-service'));
  const a = templates.getAgentsTemplate('go-service', { project });
  assert.ok(a.includes('## Project Facts'));
  assert.ok(a.includes('go'));
  assert.ok(a.includes('`go test ./...`'));
  assert.ok(a.includes('Never assume this'));
  // No detection → the section still demands recording real facts
  const bare = templates.getAgentsTemplate('mystery', {});
  assert.ok(bare.includes('## Project Facts'));
  assert.ok(bare.includes("couldn't detect"));
});

test('templates: STRUCTURE shape is generic — no Electron presumptions', () => {
  const project = detectProject(path.join(FIXTURES, 'rust-workspace'));
  const s = templates.getStructureTemplate('rust-workspace', project);
  assert.deepEqual(s.architecture.languages, ['rust']);
  assert.deepEqual(s.architecture.sourceRoots, project.sourceRoots);
  assert.ok(!('dataFlow' in s), 'dataFlow presumption resurfaced');
  assert.ok(!('ipcChannels' in s), 'ipcChannels presumption resurfaced');
  assert.ok(!('entryPoint' in s.architecture));
  assert.ok('intentIndex' in s);
});

test('shipped scripts carry no Frame-specific vocabulary (spec success criterion)', () => {
  const sentinels = [
    'TERMINAL_CREATE', 'LOAD_GITHUB_ISSUES', 'INITIALIZE_FRAME_PROJECT',
    'LOAD_CLAUDE_USAGE', 'claudeUsageManager', 'githubManager',
    'gitBranchesManager', 'multiTerminal', 'TabBar', 'ipcChannels.js'
  ];
  const scriptsDir = path.join(REPO_ROOT, 'scripts');
  const shipped = [
    'update-structure.js', 'detect-project.js', 'find-module.js', 'check-freshness.js',
    'structure-discovery.js', 'structure-generation.js', 'structure-state.js',
    ...fs.readdirSync(path.join(scriptsDir, 'lang')).map(f => path.join('lang', f))
  ];
  for (const file of shipped) {
    const content = fs.readFileSync(path.join(scriptsDir, file), 'utf8');
    for (const sentinel of sentinels) {
      assert.ok(!content.includes(sentinel), `${file} contains Frame vocabulary "${sentinel}"`);
    }
  }
});

test('ipc channels sync from the config-named file with token-derived categories', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-ipc-'));
  try {
    fs.mkdirSync(path.join(tmp, '.frame'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.frame', 'config.json'), JSON.stringify({
      project: { sourceRoots: ['src'], ipcChannelsFile: 'src/ipc.js' }
    }));
    fs.writeFileSync(path.join(tmp, 'src', 'ipc.js'), [
      'const IPC = {',
      "  LOAD_REPORTS: 'load-reports',",
      "  TOGGLE_EXPORT_PANEL: 'toggle-export-panel'",
      '};',
      'module.exports = { IPC };'
    ].join('\n'));
    const res = runParser(tmp);
    assert.equal(res.status, 0, res.stderr);
    const s = JSON.parse(fs.readFileSync(path.join(tmp, '.frame', 'STRUCTURE.json'), 'utf8'));
    assert.ok(s.ipcChannels.reports.LOAD_REPORTS, 'LOAD_REPORTS → category "reports"');
    assert.ok(s.ipcChannels.export.TOGGLE_EXPORT_PANEL, 'TOGGLE_EXPORT_PANEL → category "export"');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('walker safety: symlink cycle + ignored dirs terminate with clean output', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-walker-'));
  try {
    fs.mkdirSync(path.join(tmp, '.frame'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'lib', 'node_modules', 'junk'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.frame', 'config.json'),
      JSON.stringify({ project: { sourceRoots: ['lib'] } }));
    fs.writeFileSync(path.join(tmp, 'lib', 'a.js'), 'function a() {}\nmodule.exports = { a };\n');
    fs.writeFileSync(path.join(tmp, 'lib', 'node_modules', 'junk', 'dep.js'), 'x');
    fs.symlinkSync(path.join(tmp, 'lib'), path.join(tmp, 'lib', 'loop'));
    const res = runParser(tmp);
    assert.equal(res.status, 0, res.stderr);
    const s = JSON.parse(fs.readFileSync(path.join(tmp, '.frame', 'STRUCTURE.json'), 'utf8'));
    assert.deepEqual(Object.keys(s.modules), ['lib/a']); // no node_modules, no cycle dupes
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/* ---------------------- CLI result contract (STR-01) --------------------- */

function tmpProject(files = {}, config = null) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-cli-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    fs.writeFileSync(path.join(tmp, rel), content);
  }
  if (config) {
    fs.mkdirSync(path.join(tmp, '.frame'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.frame', 'config.json'), JSON.stringify(config));
  }
  return tmp;
}

/** Every path under `dir` with size and mtime — proves a run wrote nothing. */
function treeState(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      const abs = path.join(d, name);
      const st = fs.lstatSync(abs);
      out.push(`${path.relative(dir, abs)}:${st.size}:${st.mtimeMs}`);
      if (st.isDirectory()) walk(abs);
    }
  };
  walk(dir);
  return out;
}

const mapOf = (dir) => path.join(dir, '.frame', 'STRUCTURE.json');
const envelopeOf = (res) => {
  const lines = res.stdout.trim().split('\n');
  assert.equal(lines.length, 1, `exactly one stdout line in --json mode:\n${res.stdout}`);
  return JSON.parse(lines[0]);
};
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

test('cli: --json prints one bounded envelope on stdout and human text on stderr', () => {
  const tmp = tmpProject({ 'src/a.js': '// A\nmodule.exports = {};', 'app/user.rb': 'class User; end' });
  try {
    const res = runParser(tmp, ['--full', '--json']);
    assert.equal(res.status, 0, res.stderr);
    const env = envelopeOf(res);
    assert.equal(env.schema, 'frame.structure.result/1');
    assert.equal(env.command, 'full');
    assert.equal(env.exitCode, 0);
    assert.equal(env.state, 'complete');
    assert.equal(env.published, true);
    assert.equal(env.artifact, 'written');
    assert.equal(env.modules, undefined, 'the map itself is not in the envelope');
    assert.deepEqual(env.extraction.counts, { parsed: 1, unsupported: 1, partial: 0 });
    assert.match(res.stderr, /Updated STRUCTURE\.json/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('cli: an empty project yields a completed empty map, exit 0', () => {
  const tmp = tmpProject();
  try {
    const env = envelopeOf(runParser(tmp, ['--json']));
    assert.equal(env.exitCode, 0);
    assert.equal(env.state, 'complete');
    const map = JSON.parse(fs.readFileSync(mapOf(tmp), 'utf8'));
    assert.deepEqual(map.modules, {});
    assert.equal(map.generation.inventory.coverage, 'complete');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('cli: extraction errors exit 1 with the map published', { skip: IS_ROOT && 'root ignores file modes' }, () => {
  const tmp = tmpProject({ 'src/a.js': '// A', 'src/locked.js': '// L' });
  fs.chmodSync(path.join(tmp, 'src', 'locked.js'), 0o000);
  try {
    const res = runParser(tmp, ['--json']);
    const env = envelopeOf(res);
    assert.equal(res.status, 1);
    assert.equal(env.state, 'partial');
    assert.equal(env.published, true);
    assert.equal(env.reason, 'extraction-errors');
    const map = JSON.parse(fs.readFileSync(mapOf(tmp), 'utf8'));
    assert.equal(map.modules.locked.extraction.reason, 'read-error');
  } finally {
    fs.chmodSync(path.join(tmp, 'src', 'locked.js'), 0o644);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('cli: an incomplete inventory exits 1 — published on a first scan, retained afterwards', () => {
  const tmp = tmpProject({ 'a.js': 'x', 'b.js': 'y' });
  try {
    const first = envelopeOf(runParser(tmp, ['--json']));
    assert.equal(first.exitCode, 0);
    const good = fs.readFileSync(mapOf(tmp), 'utf8');

    fs.writeFileSync(path.join(tmp, '.frame', 'config.json'), JSON.stringify({ project: { structure: { limits: { maxFiles: 1 } } } }));
    const retained = envelopeOf(runParser(tmp, ['--json']));
    assert.equal(retained.exitCode, 1);
    assert.equal(retained.published, false);
    assert.equal(retained.artifact, 'retained');
    assert.deepEqual(retained.coverage.reasons, ['limit-maxFiles']);
    assert.equal(fs.readFileSync(mapOf(tmp), 'utf8'), good);

    fs.rmSync(mapOf(tmp));
    const firstPartial = envelopeOf(runParser(tmp, ['--json']));
    assert.equal(firstPartial.exitCode, 1);
    assert.equal(firstPartial.published, true);
    assert.equal(JSON.parse(fs.readFileSync(mapOf(tmp), 'utf8')).generation.inventory.coverage, 'partial');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('cli: busy and invalid configuration exit 2 without writing the map', () => {
  const tmp = tmpProject({ 'a.js': 'x' });
  try {
    runParser(tmp);
    const before = fs.readFileSync(mapOf(tmp), 'utf8');
    fs.writeFileSync(path.join(tmp, 'a.js'), '// changed');

    const lockFile = path.join(tmp, '.frame', 'runtime', 'structure', 'lock');
    fs.writeFileSync(lockFile, JSON.stringify({ token: 'held', pid: process.pid, host: os.hostname() }));
    const busy = runParser(tmp, ['--json']);
    assert.equal(busy.status, 2);
    assert.equal(envelopeOf(busy).busy, true);
    assert.match(busy.stderr, /not refreshed/);
    assert.equal(fs.readFileSync(mapOf(tmp), 'utf8'), before);
    fs.rmSync(lockFile);

    fs.writeFileSync(path.join(tmp, '.frame', 'config.json'), JSON.stringify({ project: { structure: { limits: { maxFiles: 0 } } } }));
    const invalid = runParser(tmp, ['--json']);
    assert.equal(invalid.status, 2);
    assert.equal(envelopeOf(invalid).reason, 'E_STRUCTURE_POLICY');
    assert.equal(fs.readFileSync(mapOf(tmp), 'utf8'), before);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('cli: unknown flags and conflicting modes fail without writes', () => {
  const tmp = tmpProject({ 'a.js': 'x' });
  try {
    const before = treeState(tmp);
    for (const args of [['--bogus'], ['--check', '--changed'], ['--full', 'a.js'], ['--changed', '--full']]) {
      const res = runParser(tmp, args);
      assert.equal(res.status, 2, args.join(' '));
    }
    assert.deepEqual(treeState(tmp), before);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('cli: --check is 0 in sync, 1 out of date, 2 when unverifiable, and never writes', () => {
  const tmp = tmpProject({ 'src/a.js': '// A' });
  try {
    assert.equal(runParser(tmp, ['--check']).status, 2, 'missing map');
    runParser(tmp);
    let before = treeState(tmp);
    assert.equal(runParser(tmp, ['--check']).status, 0);
    assert.deepEqual(treeState(tmp), before, 'in-sync check wrote nothing');

    fs.writeFileSync(path.join(tmp, 'src', 'b.js'), '// B');
    before = treeState(tmp);
    const drift = runParser(tmp, ['--check', '--json']);
    assert.equal(drift.status, 1);
    assert.equal(envelopeOf(drift).result, 'out-of-date');
    assert.deepEqual(treeState(tmp), before, 'drift check wrote nothing');

    fs.writeFileSync(path.join(tmp, '.frame', 'config.json'), JSON.stringify({ project: { structure: { limits: { maxFiles: 1 } } } }));
    assert.equal(envelopeOf(runParser(tmp, ['--check', '--json'])).reason, 'incomplete-inventory');

    fs.writeFileSync(mapOf(tmp), '{ corrupt');
    fs.rmSync(`${mapOf(tmp)}.bak`, { force: true });
    assert.equal(runParser(tmp, ['--check']).status, 2, 'corrupt map');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('cli: a map last written by a partial update is not reported as drift by mode alone', () => {
  const tmp = tmpProject({ 'src/a.js': '// A', 'src/b.js': '// B' });
  try {
    runParser(tmp);
    fs.writeFileSync(path.join(tmp, 'src', 'a.js'), '// A2');
    assert.equal(runParser(tmp, ['src/a.js']).status, 0);
    assert.equal(JSON.parse(fs.readFileSync(mapOf(tmp), 'utf8')).generation.mode, 'delta');
    assert.equal(runParser(tmp, ['--check']).status, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('cli: a partial update refuses a corrupt map and leaves it for a full repair', () => {
  const tmp = tmpProject({ 'src/a.js': '// A' });
  try {
    fs.mkdirSync(path.join(tmp, '.frame'), { recursive: true });
    fs.writeFileSync(mapOf(tmp), '{ corrupt');
    const res = runParser(tmp, ['src/a.js', '--json']);
    assert.equal(res.status, 2);
    assert.equal(envelopeOf(res).reason, 'E_DELTA_BASELINE');
    assert.match(res.stderr, /--full/);
    assert.equal(fs.readFileSync(mapOf(tmp), 'utf8'), '{ corrupt');

    const repaired = envelopeOf(runParser(tmp, ['--full', '--json']));
    assert.equal(repaired.exitCode, 0);
    assert.equal(repaired.recoveryPaths.length, 1);
    assert.equal(fs.readFileSync(path.join(tmp, repaired.recoveryPaths[0]), 'utf8'), '{ corrupt');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('cli: a no-op partial update leaves the map bytes untouched', () => {
  const tmp = tmpProject({ 'src/a.js': '// A', 'src/b.js': '// B' });
  try {
    runParser(tmp);
    const before = fs.statSync(mapOf(tmp));
    const res = runParser(tmp, ['src/a.js', '--json']);
    assert.equal(res.status, 0);
    assert.equal(envelopeOf(res).artifact, 'unchanged');
    assert.equal(fs.statSync(mapOf(tmp)).mtimeMs, before.mtimeMs);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/* ------------------- STR-01 T10: template and generated docs ------------------- */

test('templates: a fresh STRUCTURE template is marked pending — not a completed empty scan', () => {
  const state = require('../scripts/structure-state');
  const s = templates.getStructureTemplate('demo', null);
  assert.equal(s.version, '1.1');
  assert.deepEqual(s.generation, { schema: 1, state: 'pending' });
  assert.equal(state.isUsableMap(s), false);
});

test('templates: the maintenance reference documents policy, results, limits and the rebuild command', () => {
  const reference = templates.getReferenceTemplate('demo');
  const section = reference.slice(reference.indexOf('## STRUCTURE.json Rules'), reference.indexOf('## QUICKSTART.md Rules'));
  for (const needle of ['update-structure.js --full', '.gitignore', 'ignoredDirectories', 'maxFiles', 'timeoutMs',
    'inventory.coverage', 'partial', 'unsupported', 'scan.json', 'recovery', '"version": "1.1"']) {
    assert.ok(section.includes(needle), `reference mentions ${needle}`);
  }
  assert.ok(!section.includes('"path": "src/module"'), 'the pre-1.1 directory-group format is gone');
  // every .frame/ file it names exists in any initialized project
  const docsHealth = require('../src/shared/docsHealth');
  assert.deepEqual(docsHealth.namedPaths(section), ['.frame/config.json']);

  const quickstart = templates.getQuickstartTemplate('demo', null);
  assert.ok(quickstart.includes('node .frame/bin/update-structure.js --full'));
});
