/**
 * Code-graph pipeline suite (codebase-graph-onboarding). Drives
 * src/main/graphWorker.js as a plain Node child (no Electron) against the
 * cross-project fixtures: per-stack symbol/import assertions, all four
 * graph-query verbs, cycle-safe `affects`, and the honest degradation
 * outcomes (no-languages, unknown-grammar language).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const WORKER = path.join(REPO_ROOT, 'src', 'main', 'graphWorker.js');
const QUERY = path.join(REPO_ROOT, 'scripts', 'graph-query.js');
const DETECTOR = path.join(REPO_ROOT, 'scripts', 'detect-project.js');
const WASM_DIR = path.join(REPO_ROOT, 'resources', 'tree-sitter');
const FIXTURES = path.join(__dirname, 'fixtures');

/**
 * Copy a fixture to a tmp dir, run detect-project --write, then the graph
 * worker. Returns { tmp, graph, meta } — caller removes tmp.
 */
function buildGraph(fixtureName) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-graph-'));
  fs.cpSync(path.join(FIXTURES, fixtureName), tmp, { recursive: true });
  fs.mkdirSync(path.join(tmp, '.frame'), { recursive: true });
  const detect = spawnSync('node', [DETECTOR, '--write', tmp], { encoding: 'utf8' });
  assert.equal(detect.status, 0, detect.stderr);
  const worker = spawnSync('node', [WORKER, tmp, WASM_DIR], { encoding: 'utf8', timeout: 60000 });
  assert.equal(worker.status, 0, `worker failed:\n${worker.stdout}${worker.stderr}`);
  return {
    tmp,
    graph: readJSON(path.join(tmp, '.frame', 'graph', 'graph.json')),
    meta: readJSON(path.join(tmp, '.frame', 'graph', 'meta.json'))
  };
}

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function rm(tmp) {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function fileNode(graph, id) {
  return graph.nodes.files.find((f) => f.id === id);
}

function symbolNames(node) {
  return node.symbols.map((s) => s.name);
}

function runQuery(tmp, args) {
  return spawnSync('node', [QUERY, ...args], {
    env: { ...process.env, FRAME_PROJECT_ROOT: tmp },
    encoding: 'utf8'
  });
}

/* --------------------------- per-stack builds --------------------------- */

test('js-src-app: JS symbols and a resolved relative import edge', () => {
  const { tmp, graph, meta } = buildGraph('js-src-app');
  try {
    assert.equal(meta.status, 'built');
    const index = fileNode(graph, 'src/index.js');
    const utils = fileNode(graph, 'src/lib/mathUtils.js');
    assert.ok(index && utils, 'both fixture files must be in the graph');
    assert.ok(symbolNames(index).includes('greet'), 'greet missing from index.js');
    assert.ok(symbolNames(utils).includes('add'), 'add missing from mathUtils.js');
    assert.ok(symbolNames(utils).includes('multiply'), 'multiply missing from mathUtils.js');
    // require('./lib/mathUtils') must resolve to the actual file id
    assert.ok(
      graph.edges.imports.some((e) => e.from === 'src/index.js' && e.to === 'src/lib/mathUtils.js'),
      'relative require was not resolved to a file id'
    );
  } finally {
    rm(tmp);
  }
});

test('django-app: Python functions, classes, and methods', () => {
  const { tmp, graph, meta } = buildGraph('django-app');
  try {
    assert.equal(meta.status, 'built');
    const views = fileNode(graph, 'mysite/views.py');
    assert.ok(views, 'views.py must be in the graph');
    const byName = Object.fromEntries(views.symbols.map((s) => [s.name, s]));
    assert.equal(byName.index.kind, 'function');
    assert.equal(byName.HealthCheck.kind, 'class');
    assert.equal(byName.status.kind, 'function'); // methods are function_definitions
    // external import kept as raw specifier, not dropped
    assert.ok(
      graph.edges.imports.some((e) => e.from === 'mysite/views.py' && e.to === 'django.http'),
      'unresolved external import must keep its raw specifier'
    );
  } finally {
    rm(tmp);
  }
});

test('go-service: Go functions with import edges', () => {
  const { tmp, graph, meta } = buildGraph('go-service');
  try {
    assert.equal(meta.status, 'built');
    const store = fileNode(graph, 'internal/store/store.go');
    assert.ok(store, 'store.go must be in the graph');
    assert.ok(symbolNames(store).includes('Get'), 'Get missing');
    assert.ok(symbolNames(store).includes('Put'), 'Put missing');
  } finally {
    rm(tmp);
  }
});

test('rust-workspace: Rust fns and structs', () => {
  const { tmp, graph, meta } = buildGraph('rust-workspace');
  try {
    assert.equal(meta.status, 'built');
    const lib = fileNode(graph, 'crates/parser/src/lib.rs');
    assert.ok(lib, 'parser lib.rs must be in the graph');
    const byName = Object.fromEntries(lib.symbols.map((s) => [s.name, s]));
    assert.equal(byName.parse.kind, 'function');
    assert.equal(byName.Document.kind, 'struct');
  } finally {
    rm(tmp);
  }
});

/* ----------------------------- query verbs ------------------------------ */

test('graph-query: where / imports / deps / affects on js-src-app', () => {
  const { tmp } = buildGraph('js-src-app');
  try {
    const where = runQuery(tmp, ['where', 'multiply']);
    assert.equal(where.status, 0, where.stderr);
    assert.match(where.stdout, /src\/lib\/mathUtils\.js:\d+\s+function multiply/);

    const imports = runQuery(tmp, ['imports', 'src/lib/mathUtils.js']);
    assert.equal(imports.status, 0, imports.stderr);
    assert.match(imports.stdout, /src\/index\.js/);

    const deps = runQuery(tmp, ['deps', 'src/index.js']);
    assert.equal(deps.status, 0, deps.stderr);
    assert.match(deps.stdout, /src\/lib\/mathUtils\.js/);

    const affects = runQuery(tmp, ['affects', 'src/lib/mathUtils.js']);
    assert.equal(affects.status, 0, affects.stderr);
    assert.match(affects.stdout, /affects 1 file/);
    assert.match(affects.stdout, /src\/index\.js/);
  } finally {
    rm(tmp);
  }
});

test('graph-query affects: import cycle terminates with each file counted once', () => {
  // Synthesized mini-project: a → b → c → a
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-cycle-'));
  try {
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.writeFileSync(path.join(tmp, 'src', 'a.js'), "const b = require('./b');\nmodule.exports = () => b;\n");
    fs.writeFileSync(path.join(tmp, 'src', 'b.js'), "const c = require('./c');\nmodule.exports = () => c;\n");
    fs.writeFileSync(path.join(tmp, 'src', 'c.js'), "const a = require('./a');\nmodule.exports = () => a;\n");
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'cycle-fixture', version: '1.0.0' }));
    fs.mkdirSync(path.join(tmp, '.frame'), { recursive: true });
    const detect = spawnSync('node', [DETECTOR, '--write', tmp], { encoding: 'utf8' });
    assert.equal(detect.status, 0, detect.stderr);
    const worker = spawnSync('node', [WORKER, tmp, WASM_DIR], { encoding: 'utf8', timeout: 60000 });
    assert.equal(worker.status, 0, worker.stderr);

    const affects = runQuery(tmp, ['affects', 'src/a.js']);
    assert.equal(affects.status, 0, affects.stderr);
    // b and c each appear exactly once — the cycle must not loop or recount
    assert.match(affects.stdout, /affects 2 file/);
    assert.equal((affects.stdout.match(/src\/b\.js/g) || []).length, 1);
    assert.equal((affects.stdout.match(/src\/c\.js/g) || []).length, 1);
  } finally {
    rm(tmp);
  }
});

/* --------------------------- honest degradation ------------------------- */

test('no-languages: meta says so and graph-query explains instead of guessing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-nolang-'));
  try {
    fs.mkdirSync(path.join(tmp, '.frame'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.frame', 'config.json'),
      JSON.stringify({ project: { languages: [], sourceRoots: ['.'], confidence: 'none' } })
    );
    const worker = spawnSync('node', [WORKER, tmp, WASM_DIR], { encoding: 'utf8', timeout: 60000 });
    assert.equal(worker.status, 0, worker.stderr);
    const meta = readJSON(path.join(tmp, '.frame', 'graph', 'meta.json'));
    assert.equal(meta.status, 'no-languages');
    assert.ok(!fs.existsSync(path.join(tmp, '.frame', 'graph', 'graph.json')), 'no graph.json for a no-languages build');

    const q = runQuery(tmp, ['where', 'anything']);
    assert.equal(q.status, 1);
    assert.match(q.stderr, /could not detect any languages/);
  } finally {
    rm(tmp);
  }
});

test('unknown-grammar language: recorded as skipped, build still succeeds', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-skiplang-'));
  try {
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.writeFileSync(path.join(tmp, 'src', 'app.rb'), "def hello\n  'hi'\nend\n");
    fs.writeFileSync(path.join(tmp, 'src', 'util.js'), 'function helper() { return 1; }\nmodule.exports = { helper };\n');
    fs.mkdirSync(path.join(tmp, '.frame'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.frame', 'config.json'),
      JSON.stringify({ project: { languages: ['ruby', 'javascript'], sourceRoots: ['src'] } })
    );
    const worker = spawnSync('node', [WORKER, tmp, WASM_DIR], { encoding: 'utf8', timeout: 60000 });
    assert.equal(worker.status, 0, worker.stderr);
    const meta = readJSON(path.join(tmp, '.frame', 'graph', 'meta.json'));
    assert.equal(meta.status, 'built');
    assert.deepEqual(meta.skippedLanguages, ['ruby']);
    const graph = readJSON(path.join(tmp, '.frame', 'graph', 'graph.json'));
    assert.ok(fileNode(graph, 'src/util.js'), 'the known language must still be parsed');
    assert.equal(fileNode(graph, 'src/app.rb'), undefined, 'the unknown language must not be guessed at');
  } finally {
    rm(tmp);
  }
});

test('missing graph: graph-query exits 1 with the open-in-Frame hint', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-nograph-'));
  try {
    const q = runQuery(tmp, ['where', 'anything']);
    assert.equal(q.status, 1);
    assert.match(q.stderr, /open the project in Frame/);
  } finally {
    rm(tmp);
  }
});
