/**
 * structureBootstrap tests (STR-01 T07/T08): shipping the parser's complete
 * asset closure into `.frame/bin/` with helper-before-entry activation, a
 * packaged tree built only from electron-builder's declared files, and the
 * initial-scan result protocol.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const structureBootstrap = require('../src/main/structureBootstrap');
const { stageParserScripts, PARSER_REQUIRES, LIFECYCLE_REQUIRES } = structureBootstrap;

let project;

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-bootstrap-'));
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src', 'widget.js'), '// Widget\nmodule.exports = {};\n');
});

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true });
});

const bin = (...parts) => path.join(project, '.frame', 'bin', ...parts);

function runBinParser(args = [], root = project) {
  return spawnSync('node', [bin('update-structure.js'), ...args], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    env: { ...process.env, FRAME_PROJECT_ROOT: root },
    timeout: 30000
  });
}

/** A copy of Frame's scripts/ to mutate for fault injection. */
function scriptsCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-scripts-src-'));
  fs.cpSync(path.join(REPO_ROOT, 'scripts'), dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}eval`) });
  return dir;
}

// The last parser generation before STR-01, read from history.
const PREVIOUS_GENERATION = (() => {
  try {
    return execFileSync('git', ['show', 'eff5a6c:scripts/update-structure.js'], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (_) {
    return null; // no git or a shallow clone
  }
})();
const NO_HISTORY = !PREVIOUS_GENERATION && 'previous parser generation not in git history';

/** Install the previous parser generation as if Frame had shipped it earlier. */
function installPreviousGeneration() {
  const previous = PREVIOUS_GENERATION;
  fs.mkdirSync(bin('lang'), { recursive: true });
  fs.writeFileSync(bin('update-structure.js'), previous);
  for (const file of fs.readdirSync(path.join(REPO_ROOT, 'scripts', 'lang'))) {
    fs.copyFileSync(path.join(REPO_ROOT, 'scripts', 'lang', file), bin('lang', file));
  }
  return previous;
}

/* ------------------------------ staging ------------------------------- */

test('the parser ships with its whole closure, including fsSafe and the matcher license', () => {
  const report = stageParserScripts(project);
  assert.deepEqual(report.failed, []);
  assert.deepEqual(report.unavailable, []);
  for (const rel of PARSER_REQUIRES) assert.ok(fs.existsSync(bin(rel)), rel);
  assert.equal(fs.readFileSync(bin('fsSafe.js'), 'utf8'), fs.readFileSync(path.join(REPO_ROOT, 'src', 'main', 'fsSafe.js'), 'utf8'));
  assert.ok(report.copied.includes('update-structure.js'));
  assert.ok(Array.isArray(structureBootstrap.copyParserScripts(project)), 'the historical return value is still an array');
});

test('refreshing unchanged tools rewrites nothing and never runs the parser', () => {
  stageParserScripts(project);
  const mtimes = fs.readdirSync(bin()).map((f) => [f, fs.statSync(bin(f)).mtimeMs]);
  const second = stageParserScripts(project);
  assert.deepEqual(second.copied, []);
  assert.deepEqual(fs.readdirSync(bin()).map((f) => [f, fs.statSync(bin(f)).mtimeMs]), mtimes);
  assert.ok(!fs.existsSync(path.join(project, '.frame', 'STRUCTURE.json')), 'no scan on refresh');
});

test('intent-map.json is seeded once and never overwritten', () => {
  stageParserScripts(project);
  fs.writeFileSync(bin('intent-map.json'), '{"mine":{"modules":["widget"]}}');
  stageParserScripts(project);
  assert.equal(fs.readFileSync(bin('intent-map.json'), 'utf8'), '{"mine":{"modules":["widget"]}}');
});

test('helpers are activated before any entry script', () => {
  const order = [];
  const recording = { ...fs, renameSync: (from, to) => { order.push(path.relative(bin(), to)); return fs.renameSync(from, to); } };
  stageParserScripts(project, { fs: recording });
  const entry = order.indexOf('update-structure.js');
  assert.ok(entry > 0);
  for (const rel of PARSER_REQUIRES) {
    assert.ok(order.indexOf(rel) !== -1 && order.indexOf(rel) < entry, `${rel} before update-structure.js`);
  }
});

test('a missing bundled helper keeps the previous entry runnable', { skip: NO_HISTORY }, () => {
  const previous = installPreviousGeneration();
  const source = scriptsCopy();
  try {
    fs.rmSync(path.join(source, 'structure-state.js'));
    const report = stageParserScripts(project, { sourceDir: source });
    assert.deepEqual(report.unavailable, ['update-structure.js', 'structure-lifecycle.js']);
    assert.ok(report.failed.some((f) => f.file === 'structure-state.js'));
    assert.equal(fs.readFileSync(bin('update-structure.js'), 'utf8'), previous, 'entry not replaced');
    const run = runBinParser();
    assert.equal(run.status, 0, run.stderr);
    assert.ok(fs.existsSync(path.join(project, '.frame', 'STRUCTURE.json')));
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('a mid-copy failure never activates the new entry; a first install reports it unavailable', { skip: NO_HISTORY }, () => {
  const failing = { ...fs, renameSync: (from, to) => {
    if (to.endsWith('structure-generation.js')) { const e = new Error('ENOSPC'); e.code = 'ENOSPC'; throw e; }
    return fs.renameSync(from, to);
  } };
  const first = stageParserScripts(project, { fs: failing });
  assert.deepEqual(first.unavailable, ['update-structure.js', 'structure-lifecycle.js']);
  assert.ok(!fs.existsSync(bin('update-structure.js')), 'first install: no half-installed parser');
  assert.ok(!fs.readdirSync(bin()).some((f) => f.includes('.tmp-')), 'no temporary files left behind');

  const previous = installPreviousGeneration();
  stageParserScripts(project, { fs: failing });
  assert.equal(fs.readFileSync(bin('update-structure.js'), 'utf8'), previous);
  assert.equal(runBinParser().status, 0, 'previous generation still runs beside the new helpers');

  const healed = stageParserScripts(project);
  assert.deepEqual(healed.unavailable, []);
  const run = runBinParser(['--json']);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).schema, 'frame.structure.result/1');
});

/* --------------------------- packaged closure -------------------------- */

/** Stage the app the way electron-builder would: only `build.files`. */
function stagePackagedTree(dest) {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  for (const pattern of pkg.build.files) {
    if (pattern.startsWith('!') || pattern.startsWith('node_modules')) continue;
    if (pattern.endsWith('/**/*')) {
      const dir = pattern.slice(0, -'/**/*'.length);
      if (fs.existsSync(path.join(REPO_ROOT, dir))) fs.cpSync(path.join(REPO_ROOT, dir), path.join(dest, dir), { recursive: true });
    } else if (fs.existsSync(path.join(REPO_ROOT, pattern))) {
      fs.mkdirSync(path.dirname(path.join(dest, pattern)), { recursive: true });
      fs.copyFileSync(path.join(REPO_ROOT, pattern), path.join(dest, pattern));
    }
  }
}

test('a packaged tree with only declared files stages a parser that runs without node_modules', () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-packaged-'));
  try {
    stagePackagedTree(app);
    assert.ok(!fs.existsSync(path.join(app, 'node_modules')));
    const stage = spawnSync('node', ['-e', `
      const r = require(${JSON.stringify(path.join(app, 'src', 'main', 'structureBootstrap.js'))}).stageParserScripts(${JSON.stringify(project)});
      process.stdout.write(JSON.stringify(r));
    `], { cwd: os.tmpdir(), encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } });
    assert.equal(stage.status, 0, stage.stderr);
    const report = JSON.parse(stage.stdout);
    assert.deepEqual(report.unavailable, [], JSON.stringify(report.failed));
    for (const rel of PARSER_REQUIRES) assert.ok(!report.failed.some((f) => f.file === rel), rel);

    const run = spawnSync('node', [bin('update-structure.js'), '--full', '--json'], {
      cwd: os.tmpdir(), encoding: 'utf8', env: { ...process.env, NODE_PATH: '', FRAME_PROJECT_ROOT: project }
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).state, 'complete');
    const map = JSON.parse(fs.readFileSync(path.join(project, '.frame', 'STRUCTURE.json'), 'utf8'));
    assert.ok(map.modules.widget);

    // the lifecycle worker's closure is packaged too (STR-02)
    const once = spawnSync('node', [bin('structure-lifecycle.js'), '--once', '--json'], {
      cwd: os.tmpdir(), encoding: 'utf8', env: { ...process.env, NODE_PATH: '', FRAME_PROJECT_ROOT: project }
    });
    assert.equal(once.status, 0, once.stderr);
    assert.equal(JSON.parse(once.stdout).status, 'unchanged');
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
  }
});

/* ------------------------- initial scan protocol ------------------------ */

const { runInitialFullScan, bootstrapStructure } = structureBootstrap;

/** A stand-in parser: `body` runs with the real env the bootstrap passes. */
function fakeParser(body) {
  const file = path.join(project, 'fake-parser.js');
  fs.writeFileSync(file, body);
  return file;
}

const envelope = (fields) => JSON.stringify({ schema: 'frame.structure.result/1', command: 'full', ...fields });

test('initial scan: a complete envelope with exit 0 is ok; an empty inventory is ok and empty', async () => {
  stageParserScripts(project);
  const full = await runInitialFullScan(project);
  assert.equal(full.status, 'ok', full.message);
  assert.equal(full.state, 'complete');
  assert.equal(full.published, true);
  assert.equal(full.empty, false);

  const emptyProject = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-bootstrap-empty-'));
  try {
    stageParserScripts(emptyProject);
    const empty = await runInitialFullScan(emptyProject);
    assert.equal(empty.status, 'ok');
    assert.equal(empty.empty, true);
    assert.match(empty.message, /no eligible files/);
  } finally {
    fs.rmSync(emptyProject, { recursive: true, force: true });
  }
});

test('initial scan: exit 0 without a valid envelope is never success', async () => {
  for (const body of [
    'process.stdout.write("done\\n");',
    'process.stdout.write("{\\"schema\\":\\"other\\"}\\n");',
    `process.stdout.write(${JSON.stringify(envelope({ exitCode: 0, state: 'complete' }))} + "\\n" + "extra\\n");`,
    ''
  ]) {
    const result = await runInitialFullScan(project, { parserPath: fakeParser(body) });
    assert.equal(result.status, 'error', body);
    assert.equal(result.reason, 'invalid-result');
  }
});

test('initial scan: an exit-0 child reporting a partial result is partial, not ok', async () => {
  const mismatched = await runInitialFullScan(project, {
    parserPath: fakeParser(`process.stdout.write(${JSON.stringify(envelope({ exitCode: 1, state: 'partial' }))} + "\\n");`)
  });
  assert.equal(mismatched.status, 'error', 'exit code and envelope disagree');

  const partial = await runInitialFullScan(project, {
    parserPath: fakeParser(`process.stdout.write(${JSON.stringify(envelope({ exitCode: 1, state: 'partial', published: true, coverage: { coverage: 'partial', reasons: ['timeout'] } }))} + "\\n"); process.exitCode = 1;`)
  });
  assert.equal(partial.status, 'partial');
  assert.equal(partial.published, true);
  assert.match(partial.message, /part of the project \(timeout\)/);
  assert.equal(partial.repairCommand, 'node .frame/bin/update-structure.js --full');
});

test('initial scan: heavy output on both streams is drained without blocking', async () => {
  const ok = await runInitialFullScan(project, {
    parserPath: fakeParser(`
      process.stderr.write('x'.repeat(4 * 1024 * 1024));
      process.stdout.write(${JSON.stringify(envelope({ exitCode: 0, state: 'complete', counts: { indexedFiles: 3 } }))} + "\\n");
    `)
  });
  assert.equal(ok.status, 'ok');

  const flooded = await runInitialFullScan(project, {
    parserPath: fakeParser(`process.stdout.write('y'.repeat(2 * 1024 * 1024));`)
  });
  assert.equal(flooded.status, 'error');
  assert.equal(flooded.reason, 'invalid-result');
});

test('initial scan: a process that never starts settles once with an error', async () => {
  const result = await runInitialFullScan(project, { parserPath: fakeParser(''), nodePath: path.join(project, 'no-such-node') });
  assert.equal(result.status, 'error');
  assert.match(result.message, /ENOENT/);
});

/** A parser that publishes through the real state layer, then hangs. */
function hangingAfterPublish() {
  const statePath = JSON.stringify(path.join(REPO_ROOT, 'scripts', 'structure-state.js'));
  return fakeParser(`
    const state = require(${statePath});
    state.runAttempt({
      rootDir: process.env.FRAME_PROJECT_ROOT,
      mode: 'full',
      attemptId: process.env.FRAME_STRUCTURE_ATTEMPT_ID,
      build: () => ({ candidate: JSON.stringify({ version: '1.1', modules: { hung: { file: 'hung.js' } } }) + '\\n', inventory: { coverage: 'complete', reasons: [] } }),
      hooks: { afterPublish: () => { for (;;) {} } }
    });
  `);
}

test('initial scan: a timeout after publication keeps the published map and records the attempt as unconfirmed', async () => {
  const result = await runInitialFullScan(project, { parserPath: hangingAfterPublish(), timeoutMs: 1500 });
  assert.equal(result.status, 'error');
  assert.equal(result.reason, 'timeout');
  assert.equal(result.reconciliation, 'reconciled');
  assert.equal(result.published, true);
  assert.equal(result.acknowledged, false);
  const map = JSON.parse(fs.readFileSync(path.join(project, '.frame', 'STRUCTURE.json'), 'utf8'));
  assert.ok(map.modules.hung, 'never rolled back');
  const record = JSON.parse(fs.readFileSync(path.join(project, '.frame', 'runtime', 'structure', 'scan.json'), 'utf8'));
  assert.equal(record.attemptId, result.attemptId);
  assert.equal(record.state, 'interrupted');
  assert.ok(!fs.existsSync(path.join(project, '.frame', 'runtime', 'structure', 'lock')), 'the dead child\'s lock was reclaimed and released');
});

test('initial scan: a newer run that starts before the timed-out run\'s close callback wins', async () => {
  stageParserScripts(project);
  let newer = null;
  const result = await runInitialFullScan(project, {
    parserPath: hangingAfterPublish(),
    timeoutMs: 1500,
    onChildExit: () => {
      newer = spawnSync('node', [bin('update-structure.js'), '--full', '--json'], { encoding: 'utf8', env: { ...process.env, FRAME_PROJECT_ROOT: project } });
    }
  });
  assert.equal(newer.status, 0, newer.stderr);
  const newerId = JSON.parse(newer.stdout).attemptId;
  assert.equal(result.reconciliation, 'superseded');
  const record = JSON.parse(fs.readFileSync(path.join(project, '.frame', 'runtime', 'structure', 'scan.json'), 'utf8'));
  assert.equal(record.attemptId, newerId);
  assert.equal(record.state, 'complete');
});

test('bootstrap: summary shape is stable; a pre-existing map is skipped and unverified', async () => {
  const created = await bootstrapStructure(project, true);
  assert.deepEqual(Object.keys(created), ['copied', 'hook', 'initialScan']);
  assert.equal(created.initialScan.status, 'ok');
  assert.equal(created.hook.status, 'skipped-no-git', 'no Git: generation still works, hook guidance unchanged');

  const existing = await bootstrapStructure(project, false);
  assert.equal(existing.initialScan.status, 'skipped-existing');
  assert.equal(existing.initialScan.verified, false);
  assert.match(existing.initialScan.message, /--full/);
});


/* ------------------------ STR-02: lifecycle delivery ------------------------ */

test('the lifecycle worker ships with its helpers and is activated after them', () => {
  const order = [];
  const recording = { ...fs, renameSync: (from, to) => { order.push(path.relative(bin(), to)); return fs.renameSync(from, to); } };
  const report = stageParserScripts(project, { fs: recording });
  assert.deepEqual(report.unavailable, []);
  for (const rel of LIFECYCLE_REQUIRES) assert.ok(fs.existsSync(bin(rel)), rel);
  const entry = order.indexOf('structure-lifecycle.js');
  assert.ok(entry > 0);
  for (const rel of LIFECYCLE_REQUIRES) assert.ok(order.indexOf(rel) < entry, `${rel} before structure-lifecycle.js`);
});

test('a missing lifecycle helper withholds only the lifecycle entry', () => {
  const source = scriptsCopy();
  try {
    fs.rmSync(path.join(source, 'structure-snapshot.js'));
    const report = stageParserScripts(project, { sourceDir: source });
    assert.deepEqual(report.unavailable, ['structure-lifecycle.js']);
    assert.ok(fs.existsSync(bin('update-structure.js')), 'the parser does not depend on it');
    assert.ok(!fs.existsSync(bin('structure-lifecycle.js')));
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
  }
});
