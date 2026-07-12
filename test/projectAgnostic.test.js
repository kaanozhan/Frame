/**
 * Cross-project fixture suite (T02+). The committed golden STRUCTURE.json in
 * test/fixtures/js-src-app locks today's src/+CJS+npm parser behavior — the
 * backwards-compat guarantee every parser change (T03-T06) must preserve
 * byte-for-byte. T05 extends this file with per-fixture stack assertions.
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

test('golden: js-src-app STRUCTURE.json is in sync with the parser (--check)', () => {
  const res = runParser(path.join(FIXTURES, 'js-src-app'), ['--check']);
  assert.equal(res.status, 0, `--check reported drift:\n${res.stdout}${res.stderr}`);
});

test('golden: full regen on js-src-app copy is byte-identical to the committed golden', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-golden-'));
  try {
    fs.cpSync(path.join(FIXTURES, 'js-src-app'), tmp, { recursive: true });
    const res = runParser(tmp);
    assert.equal(res.status, 0, res.stderr);
    const regenerated = fs.readFileSync(path.join(tmp, 'STRUCTURE.json'), 'utf8');
    const golden = fs.readFileSync(path.join(FIXTURES, 'js-src-app', 'STRUCTURE.json'), 'utf8');
    assert.equal(regenerated, golden);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
    return JSON.parse(fs.readFileSync(path.join(tmp, 'STRUCTURE.json'), 'utf8'));
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
    const s = JSON.parse(fs.readFileSync(path.join(tmp, 'STRUCTURE.json'), 'utf8'));
    assert.deepEqual(Object.keys(s.modules), ['lib/a']); // no node_modules, no cycle dupes
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
