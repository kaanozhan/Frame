/**
 * structure-generation tests (STR-01 T03): collision-safe identity, curated
 * key ownership, authored-prose preservation, legacy directory groups,
 * degraded extraction, obsolete entries, IPC merging, auto-intent
 * population, and full → delta → no-op byte stability.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { discover, evaluatePaths } = require('../scripts/structure-discovery');
const {
  buildFull,
  buildDelta,
  serializeStructure,
  checkView,
  legacyKeyFor,
  fallbackKeyFor,
  DeltaBaselineError
} = require('../scripts/structure-generation');

const TODAY = '2026-09-26';
let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-generation-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function scaffold(files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

function remove(rel) {
  fs.rmSync(path.join(root, rel));
}

/** Full build → serialize → parse, like a publish/reload cycle. */
function full(prior = null, extra = {}) {
  const discovery = discover(root, extra.discoveryOptions || {});
  const { structure, report } = buildFull({ rootDir: root, discovery, prior, curation: extra.curation || {}, projectConfig: extra.projectConfig || {}, fs: extra.fs });
  const text = serializeStructure(structure, prior, extra.today || TODAY);
  return { map: JSON.parse(text), text, report };
}

function delta(prior, changed, extra = {}) {
  const evaluation = evaluatePaths(root, changed);
  const { structure, report } = buildDelta({ rootDir: root, evaluation, prior, curation: extra.curation || {}, projectConfig: extra.projectConfig || {}, baseline: extra.baseline, fs: extra.fs });
  const text = serializeStructure(structure, prior, extra.today || TODAY);
  return { map: JSON.parse(text), text, report };
}

const keyOf = (map, file) => Object.keys(map.modules).find((k) => map.modules[k].file === file);

/* ------------------------------ identity ------------------------------ */

test('legacy key derivation is unchanged; fallback keys encode the whole path', () => {
  assert.equal(legacyKeyFor('src/main/pty.js'), 'main/pty');
  assert.equal(legacyKeyFor('lib/util.py'), 'lib/util');
  assert.equal(legacyKeyFor('package.json'), 'package.json');
  assert.equal(legacyKeyFor('app/user.rb'), 'app/user.rb');
  assert.equal(fallbackKeyFor('src/model.ts'), '@file:src/model.ts');
  assert.equal(fallbackKeyFor('a b/ä#1.ts'), '@file:a%20b/%C3%A4%231.ts');
});

test('same-stem files across extensions and root/src keep distinct entries', () => {
  scaffold({
    'src/model.js': '// JS model\nmodule.exports = {};',
    'src/model.ts': '// TS model\nexport const m = 1;',
    'index.js': '// root entry',
    'src/index.js': '// src entry'
  });
  const { map } = full();
  assert.equal(Object.keys(map.modules).length, 4);
  assert.equal(keyOf(map, 'index.js'), 'index');
  assert.equal(keyOf(map, 'src/index.js'), '@file:src/index.js');
  assert.equal(keyOf(map, 'src/model.js'), 'model');
  assert.equal(keyOf(map, 'src/model.ts'), '@file:src/model.ts');
  assert.equal(map.modules.model.description, 'JS model');
  assert.equal(map.modules['@file:src/model.ts'].description, 'TS model');
});

test('existing keys stay bound to their file when a colliding file appears', () => {
  scaffold({ 'src/index.js': '// src entry' });
  const first = full().map;
  assert.equal(keyOf(first, 'src/index.js'), 'index');
  scaffold({ 'index.js': '// root entry' });
  const second = full(first).map;
  assert.equal(keyOf(second, 'src/index.js'), 'index');
  assert.equal(keyOf(second, 'index.js'), '@file:index.js');
});

test('a fallback key already used by a legacy key gets a deterministic suffix', () => {
  scaffold({ 'src/a.js': 'x', 'src/a.ts': 'y', 'weird.txt': 'z' });
  const prior = {
    version: '1.0',
    modules: { '@file:src/a.ts': { file: 'weird.txt', description: '' } }
  };
  const { map } = full(prior);
  assert.equal(keyOf(map, 'weird.txt'), '@file:src/a.ts');
  assert.equal(keyOf(map, 'src/a.js'), 'a');
  assert.equal(keyOf(map, 'src/a.ts'), '@file:src/a.ts#2');
});

test('hostile file names become own keys without touching prototypes', () => {
  scaffold({
    '__proto__.js': '// proto',
    'constructor.js': '// ctor',
    'hasOwnProperty.py': '"""hop"""',
    'toString.md': '# ts'
  });
  const { map, text } = full();
  assert.deepEqual(Object.keys(map.modules).sort(), ['__proto__', 'constructor', 'hasOwnProperty', 'toString']);
  assert.ok(Object.prototype.hasOwnProperty.call(map.modules, '__proto__'));
  assert.equal(map.modules.__proto__.file, '__proto__.js'); // eslint-disable-line no-proto
  assert.ok(text.includes('"__proto__": {'));
  assert.equal({}.file, undefined);
});

test('absolute, out-of-root and duplicate prior entries are reconciled with diagnostics', () => {
  scaffold({ 'src/a.js': '// A' });
  const prior = {
    modules: {
      a: { file: 'src/a.js', description: 'A' },
      'old-alias': { file: './src//a.js', description: 'A (dup)', owner: 'me' },
      escape: { file: '../outside.js' },
      abs: { file: '/etc/passwd' }
    }
  };
  const { map, report } = full(prior, { curation: { feature: { modules: ['old-alias'] } } });
  assert.deepEqual(Object.keys(map.modules), ['a']);
  const reasons = report.diagnostics.map((d) => d.reason).sort();
  assert.deepEqual(reasons, ['duplicate-entry', 'invalid-file-path', 'invalid-file-path']);
  assert.deepEqual(report.discarded.map((d) => d.key).sort(), ['abs', 'escape', 'old-alias']);
  // curation of the duplicate key still resolves to the surviving file
  assert.deepEqual(map.intentIndex.feature.map((e) => e.file), ['src/a.js']);
});

/* ------------------------------ curation ------------------------------ */

test('a deleted curated file keeps its key; a same-stem replacement does not inherit the concept', () => {
  const curation = { data: { modules: ['model'] } };
  scaffold({ 'src/model.js': '// JS model' });
  const first = full(null, { curation }).map;
  assert.deepEqual(first.intentIndex.data.map((e) => e.file), ['src/model.js']);

  remove('src/model.js');
  scaffold({ 'src/model.ts': '// TS model' });
  const second = full(first, { curation });
  assert.deepEqual(second.map.curatedKeyOwners, { model: 'src/model.js' });
  assert.equal(keyOf(second.map, 'src/model.ts'), '@file:src/model.ts');
  assert.equal(second.map.intentIndex.data, undefined);
  assert.ok(second.report.diagnostics.some((d) => d.reason === 'curated-key-unresolved' && d.path === 'model'));

  // the binding survives further rebuilds while curation references it
  const third = full(second.map, { curation }).map;
  assert.deepEqual(third.curatedKeyOwners, { model: 'src/model.js' });

  // restoring the original file reclaims the key and the concept
  scaffold({ 'src/model.js': '// JS model' });
  const fourth = full(third, { curation }).map;
  assert.equal(keyOf(fourth, 'src/model.js'), 'model');
  assert.equal(fourth.curatedKeyOwners, undefined);
  assert.deepEqual(fourth.intentIndex.data.map((e) => e.file), ['src/model.js']);
});

test('removing the curation reference releases the binding', () => {
  scaffold({ 'src/model.js': 'x' });
  const first = full(null, { curation: { data: { modules: ['model'] } } }).map;
  remove('src/model.js');
  const second = full(first, { curation: { data: { modules: ['model'] } } }).map;
  assert.ok(second.curatedKeyOwners);
  const released = full(second, { curation: {} }).map;
  assert.equal(released.curatedKeyOwners, undefined);
  scaffold({ 'src/model.py': '"""py model"""' });
  assert.equal(keyOf(full(released).map, 'src/model.py'), 'model');
});

test('a deleted, uncurated key is released on the following run', () => {
  scaffold({ 'src/model.js': 'x' });
  const first = full().map;
  remove('src/model.js');
  scaffold({ 'src/model.ts': 'y' });
  // same run: the removed file's key is still reserved
  const second = full(first).map;
  assert.equal(keyOf(second, 'src/model.ts'), '@file:src/model.ts');
  // and the new file keeps its identity afterwards
  assert.equal(keyOf(full(second).map, 'src/model.ts'), '@file:src/model.ts');
});

/* ------------------------------ annotations --------------------------- */

test('authored prose and unknown fields survive; generated prose follows the source', () => {
  scaffold({ 'src/a.js': '// Generated A\n\n// does x\nfunction run() {}\nmodule.exports = { run };' });
  const first = full().map;
  const entry = first.modules.a;
  assert.equal(entry.description, 'Generated A');
  assert.equal(entry.functions.run.purpose, 'does x');
  assert.ok(entry.provenance.description);

  // source changes → generated prose updates
  scaffold({ 'src/a.js': '// Generated A v2\n\n// does y\nfunction run() {}\nmodule.exports = { run };' });
  const second = full(first).map;
  assert.equal(second.modules.a.description, 'Generated A v2');
  assert.equal(second.modules.a.functions.run.purpose, 'does y');

  // user edits the description and adds annotations → they win from now on
  second.modules.a.description = 'Hand-written summary';
  second.modules.a.owner = 'team-core';
  second.modules.a.functions.run.notes = 'hot path';
  scaffold({ 'src/a.js': '// Generated A v3\n\n// does z\nfunction run() {}\nmodule.exports = { run };' });
  const third = full(second).map;
  assert.equal(third.modules.a.description, 'Hand-written summary');
  assert.equal(third.modules.a.provenance.description, undefined);
  assert.equal(third.modules.a.owner, 'team-core');
  assert.equal(third.modules.a.functions.run.notes, 'hot path');
  assert.equal(third.modules.a.functions.run.purpose, 'does z');
});

test('legacy prose without provenance is preserved conservatively', () => {
  scaffold({ 'src/a.js': '// New generated text' });
  const prior = { version: '1.0', modules: { a: { file: 'src/a.js', description: 'Old text of unknown origin' } } };
  const { map } = full(prior);
  assert.equal(map.modules.a.description, 'Old text of unknown origin');
});

test('project-level description, architecture, notes and unknown keys are kept in place', () => {
  scaffold({ 'src/a.js': 'x' });
  const prior = {
    _frame_metadata: { generatedBy: 'Frame' },
    version: '1.0',
    description: 'My project',
    lastUpdated: '2026-01-01',
    architecture: { layers: ['ui'] },
    modules: {},
    conventions: { naming: 'camel' },
    intentIndex: {},
    architectureNotes: { 'a-note': 'why' },
    custom: 42
  };
  const { map } = full(prior);
  assert.deepEqual(Object.keys(map).slice(0, 9), [
    '_frame_metadata', 'version', 'description', 'lastUpdated', 'architecture', 'modules', 'conventions', 'intentIndex', 'architectureNotes'
  ]);
  assert.equal(map.version, '1.1');
  assert.equal(map.description, 'My project');
  assert.deepEqual(map.architectureNotes, { 'a-note': 'why' });
  assert.equal(map.custom, 42);
});

/* -------------------------- legacy groups ----------------------------- */

test('CoMeety-style directory groups are preserved separately from file entries', () => {
  scaffold({
    'apps/api/src/routes/users.ts': '// users route',
    'apps/mobile/app/index.tsx': 'x',
    'packages/contracts/src/index.ts': 'x',
    'src/index.js': '// entry'
  });
  const groups = {
    api: { path: 'apps/api', purpose: 'REST API', submodules: ['routes'] },
    mobile: { path: 'apps/mobile', purpose: 'Expo app', submodules: [] },
    admin: { path: 'apps/admin', purpose: 'Admin panel' },
    contracts: { path: 'packages/contracts', purpose: 'Shared types' },
    editor: { path: 'apps/mobile/modules/content-editor', purpose: 'Block editor' },
    shared: { files: ['packages/ui'], purpose: 'UI kit' }
  };
  const prior = {
    version: '1.0',
    modules: { ...groups, index: { path: 'src/index.js', purpose: 'Entry point' } }
  };
  const { map, report } = full(prior);
  assert.deepEqual(map.legacyModuleGroups, Object.fromEntries(Object.entries(groups).sort(([a], [b]) => (a < b ? -1 : 1))));
  assert.equal(map.generation.counts.legacyGroups, 6);
  assert.equal(map.generation.counts.indexedFiles, 4);
  for (const key of Object.keys(groups)) assert.equal(map.modules[key], undefined);
  // a legacy entry whose path is a real file becomes that file's entry
  assert.equal(map.modules.index.file, 'src/index.js');
  assert.equal(map.modules.index.purpose, 'Entry point');
  assert.equal(map.modules.index.path, 'src/index.js');
  assert.ok(keyOf(map, 'apps/api/src/routes/users.ts'));
  assert.deepEqual(report.discarded, []);

  // deterministic rebuild
  const again = full(map);
  assert.equal(again.text, full(again.map).text);
});

test('an existing group is never overwritten by a conflicting legacy record', () => {
  scaffold({ 'a.js': 'x' });
  const prior = {
    modules: { api: { path: 'apps/api', purpose: 'new text' } },
    legacyModuleGroups: { api: { path: 'apps/api', purpose: 'original' } }
  };
  const { map, report } = full(prior);
  assert.deepEqual(map.legacyModuleGroups.api, { path: 'apps/api', purpose: 'original' });
  assert.deepEqual(report.discarded.map((d) => d.reason), ['legacy-group-conflict']);
});

/* ---------------------------- extraction ------------------------------ */

test('unsupported languages, bad encodings, size limits and read failures keep metadata-only entries', () => {
  scaffold({
    'app/user.rb': 'class User; end',
    'src/big.js': '// big\n' + 'x'.repeat(200),
    'src/utf16.js': Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('// x', 'utf16le')]),
    'src/locked.js': '// locked',
    'src/ok.js': '// fine'
  });
  const failing = { ...fs, readFileSync: (p, ...rest) => {
    if (String(p).endsWith(`${path.sep}locked.js`)) { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; }
    return fs.readFileSync(p, ...rest);
  } };
  const { map, report } = full(null, { fs: failing, discoveryOptions: { structure: { limits: { maxParseBytes: 100 } } } });
  const status = (file) => map.modules[keyOf(map, file)].extraction;
  assert.deepEqual(status('app/user.rb'), { status: 'unsupported', reason: 'no-extractor' });
  assert.deepEqual(status('src/big.js'), { status: 'partial', reason: 'size-limit' });
  assert.deepEqual(status('src/utf16.js'), { status: 'unsupported', reason: 'encoding' });
  assert.deepEqual(status('src/locked.js'), { status: 'partial', reason: 'read-error', code: 'EACCES' });
  assert.deepEqual(status('src/ok.js'), { status: 'parsed' });
  const locked = map.modules[keyOf(map, 'src/locked.js')];
  assert.deepEqual([locked.description, locked.exports, locked.depends, locked.functions], ['', [], [], {}]);
  assert.equal(map.modules.ok.description, 'fine');
  assert.deepEqual(map.generation.extraction, { coverage: 'partial', counts: { parsed: 1, unsupported: 2, partial: 2 } });
  assert.equal(report.extraction.coverage, 'partial');
  assert.deepEqual(report.diagnostics.map((d) => d.reason).sort(), ['extraction-read-error', 'extraction-size-limit']);
});

test('a failing file clears its generated facts but keeps authored prose', () => {
  scaffold({ 'src/a.js': '// gen\nfunction f() {}\nmodule.exports = { f };' });
  const first = full().map;
  first.modules.a.functions.f.purpose = 'authored purpose';
  first.modules.a.note = 'keep me';
  const failing = { ...fs, readFileSync: (p, ...rest) => {
    if (String(p).endsWith(`${path.sep}a.js`)) { const e = new Error('EIO'); e.code = 'EIO'; throw e; }
    return fs.readFileSync(p, ...rest);
  } };
  const { map, report } = full(first, { fs: failing });
  assert.equal(map.modules.a.description, ''); // generated, now unknown
  assert.deepEqual(map.modules.a.functions, {});
  assert.equal(map.modules.a.note, 'keep me');
  assert.deepEqual(report.discarded.map((d) => d.reason), ['function-removed']);
});

test('an entirely unsupported project is a complete inventory, not an empty one', () => {
  scaffold({ 'Gemfile': "source 'https://rubygems.org'", 'app/models/user.rb': 'x', 'config/routes.rb': 'y' });
  const { map } = full();
  assert.equal(map.generation.inventory.coverage, 'complete');
  assert.equal(map.generation.extraction.coverage, 'complete');
  assert.equal(Object.keys(map.modules).length, 3);
});

/* --------------------------- obsolete entries -------------------------- */

test('deleted and newly excluded files leave the map; authored ones are reported for recovery', () => {
  scaffold({ 'src/a.js': 'x', 'src/b.js': 'y', 'src/gen.js': 'z' });
  const first = full().map;
  first.modules.b.owner = 'someone';
  remove('src/b.js');
  scaffold({ '.gitignore': 'src/gen.js\n' });
  const { map, report } = full(first);
  assert.deepEqual(Object.keys(map.modules).sort(), ['.gitignore', 'a']);
  assert.deepEqual(report.discarded, [{ key: 'b', file: 'src/b.js', reason: 'file-removed' }]);
});

/* --------------------------------- IPC -------------------------------- */

test('IPC channels sync keeps enriched records and adds skeletons; module ipc is extracted', () => {
  scaffold({
    'src/shared/ipcChannels.js': "const IPC = {\n  LOAD_TASKS: 'load-tasks',\n  OPEN_FILE: 'open-file'\n};\nmodule.exports = { IPC };",
    'src/main/tasks.js': "ipcMain.handle(IPC.LOAD_TASKS, () => {});"
  });
  const prior = {
    modules: {},
    ipcChannels: { tasks: { LOAD_TASKS: { name: 'load-tasks', direction: 'renderer→main', description: 'enriched' } } }
  };
  const { map } = full(prior, { projectConfig: { ipcChannelsFile: 'src/shared/ipcChannels.js' } });
  assert.deepEqual(map.ipcChannels.tasks.LOAD_TASKS, { name: 'load-tasks', direction: 'renderer→main', description: 'enriched' });
  assert.deepEqual(map.ipcChannels.file.OPEN_FILE, { name: 'open-file', direction: '', description: '' });
  assert.ok(map.modules['main/tasks'].ipc);
});

/* ---------------------------- intent index ---------------------------- */

test('inventory-only files do not join automatic code intents', () => {
  scaffold({
    'src/terminalA.js': 'x',
    'src/terminalB.js': 'y',
    'docs/terminal-guide.md': '# Terminal guide',
    'terminal.config.json': '{}',
    'src/other1.js': '', 'src/other2.js': '', 'src/other3.js': '', 'src/other4.js': '', 'src/other5.js': '',
    'src/other6.js': '', 'src/other7.js': '', 'src/other8.js': '', 'src/other9.js': ''
  });
  const codeRepo = full().map;
  assert.deepEqual(codeRepo.intentIndex.terminal.map((e) => e.file), ['src/terminalA.js', 'src/terminalB.js']);
  const docsRepo = full(null, { projectConfig: { languages: ['javascript', 'markdown'], sourceRoots: ['.'] } }).map;
  assert.deepEqual(docsRepo.intentIndex.terminal.map((e) => e.file).sort(), ['docs/terminal-guide.md', 'src/terminalA.js', 'src/terminalB.js']);
});

test('automatic intents keep the historical source-root population; the inventory does not', () => {
  scaffold({
    'src/searchIndex.js': 'x', 'src/searchQuery.js': 'y',
    'test/searchIndex.test.js': 'z', 'scripts/searchTool.js': 'w',
    'src/o1.js': '', 'src/o2.js': '', 'src/o3.js': '', 'src/o4.js': '', 'src/o5.js': '', 'src/o6.js': ''
  });
  const { map } = full();
  assert.deepEqual(map.intentIndex.search.map((e) => e.file), ['src/searchIndex.js', 'src/searchQuery.js']);
  assert.ok(keyOf(map, 'test/searchIndex.test.js') && keyOf(map, 'scripts/searchTool.js'), 'still inventoried');
  const curated = full(null, { curation: { search: { modules: ['test/searchIndex.test'] } } }).map;
  assert.deepEqual(curated.intentIndex.search.map((e) => e.file), ['test/searchIndex.test.js'], 'curation may name any indexed file');
  const configured = full(null, { projectConfig: { sourceRoots: ['src', 'scripts'] } }).map;
  assert.deepEqual(configured.intentIndex.search.map((e) => e.file), ['scripts/searchTool.js', 'src/searchIndex.js', 'src/searchQuery.js']);
});

test('fallback keys group by their file name, not the escaped key', () => {
  scaffold({ 'src/searchIndex.js': 'x', 'src/searchIndex.ts': 'y', 'src/searchQuery.js': 'z', 'src/a1.js': '', 'src/a2.js': '', 'src/a3.js': '', 'src/a4.js': '', 'src/a5.js': '', 'src/a6.js': '', 'src/a7.js': '', 'src/a8.js': '', 'src/a9.js': '' });
  const { map } = full();
  assert.deepEqual(map.intentIndex.search.map((e) => e.file).sort(), ['src/searchIndex.js', 'src/searchIndex.ts', 'src/searchQuery.js']);
});

/* ------------------------ determinism and format ---------------------- */

test('an unchanged tree regenerates byte-identical output and keeps lastUpdated', () => {
  scaffold({ 'src/a.js': '// A\nfunction f() {}\nmodule.exports = { f };', 'README.md': '# R' });
  const first = full(null, { today: '2026-09-01' });
  const second = full(first.map, { today: '2026-09-26' });
  assert.equal(second.text, first.text);
  assert.equal(second.map.lastUpdated, '2026-09-01');
});

test('the generation block is version 1.1 metadata with no timestamps or durations', () => {
  scaffold({ 'a.js': 'x' });
  const { map } = full();
  assert.equal(map.version, '1.1');
  assert.deepEqual(Object.keys(map.generation), ['schema', 'mode', 'inventory', 'extraction', 'policy', 'counts', 'diagnostics']);
  const flat = JSON.stringify(map.generation);
  assert.ok(!/"(startedAt|finishedAt|timestamp|durationMs|attemptId|lastUpdated)"/.test(flat), flat);
});

/* -------------------------------- delta ------------------------------- */

test('full → delta → no-op: only the changed entry moves and a no-op writes identical bytes', () => {
  scaffold({
    'src/a.js': '// A\nfunction a() {}\nmodule.exports = { a };',
    'src/b.js': '// B',
    'app/user.rb': 'class User; end',
    'docs/guide.md': '# Guide'
  });
  const base = full();
  scaffold({ 'src/a.js': '// A changed\nfunction a2() {}\nmodule.exports = { a2 };' });

  const changed = delta(base.map, ['src/a.js']);
  assert.equal(changed.report.changed, true);
  assert.equal(changed.map.modules.a.description, 'A changed');
  for (const key of Object.keys(base.map.modules)) {
    if (key !== 'a') assert.deepEqual(changed.map.modules[key], base.map.modules[key], key);
  }
  assert.deepEqual(changed.map.generation.inventory, { coverage: 'unknown', reasons: ['delta'] });
  assert.deepEqual(changed.map.generation.policy, base.map.generation.policy);

  const noop = delta(changed.map, ['src/a.js'], { today: '2027-01-01' });
  assert.equal(noop.report.changed, false);
  assert.equal(noop.text, changed.text);

  const empty = delta(changed.map, [], { today: '2027-01-01' });
  assert.equal(empty.report.changed, false);
  assert.equal(empty.text, changed.text);

  // a full rebuild after the delta converges, and check views agree
  const rebuilt = full(changed.map);
  assert.deepEqual(checkView(rebuilt.map), checkView(full(rebuilt.map).map));
  assert.deepEqual(rebuilt.map.modules, changed.map.modules);
});

test('delta removes confirmed-missing and excluded entries but never unlisted or unreadable ones', () => {
  scaffold({ 'src/a.js': 'x', 'src/b.js': 'y', 'src/c.js': 'z', 'src/d.js': 'w', 'notes.txt': 't' });
  const base = full().map;
  remove('src/b.js');
  scaffold({ '.gitignore': 'src/c.js\n' });
  const failing = { ...fs, lstatSync: (p, ...rest) => {
    if (String(p).endsWith(`${path.sep}d.js`)) { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; }
    return fs.lstatSync(p, ...rest);
  } };
  const evaluation = evaluatePaths(root, ['src/c.js']);
  const { structure, report } = buildDelta({ rootDir: root, evaluation, prior: base, fs: failing });
  // b: unlisted but confirmed missing → removed; c: listed and excluded → removed;
  // d: unreadable → kept; notes.txt (inventory-only) → kept
  assert.deepEqual(Object.keys(structure.modules).sort(), ['a', 'd', 'notes.txt']);
  assert.equal(report.changed, true);
});

test('delta refuses a corrupt baseline and labels a missing one as unverified', () => {
  scaffold({ 'src/a.js': 'x' });
  const evaluation = evaluatePaths(root, ['src/a.js']);
  assert.throws(() => buildDelta({ rootDir: root, evaluation, prior: null, baseline: 'corrupt' }), DeltaBaselineError);
  const { structure } = buildDelta({ rootDir: root, evaluation, prior: null, baseline: 'missing' });
  assert.deepEqual(structure.generation.inventory, { coverage: 'unknown', reasons: ['no-baseline'] });
  assert.deepEqual(Object.keys(structure.modules), ['a']);
});

test('delta adds a same-stem file under a collision-safe key and reports ignore-file changes', () => {
  scaffold({ 'src/model.js': 'x' });
  const base = full().map;
  scaffold({ 'src/model.ts': 'y', '.gitignore': '' });
  const { map, report } = delta(base, ['src/model.ts', '.gitignore']);
  assert.equal(keyOf(map, 'src/model.js'), 'model');
  assert.equal(keyOf(map, 'src/model.ts'), '@file:src/model.ts');
  assert.equal(report.policyInputChanged, true);
});

test('delta keeps a deleted curated key reserved', () => {
  const curation = { data: { modules: ['model'] } };
  scaffold({ 'src/model.js': 'x' });
  const base = full(null, { curation }).map;
  remove('src/model.js');
  scaffold({ 'src/model.ts': 'y' });
  const { map } = delta(base, ['src/model.js', 'src/model.ts'], { curation });
  assert.deepEqual(map.curatedKeyOwners, { model: 'src/model.js' });
  assert.equal(keyOf(map, 'src/model.ts'), '@file:src/model.ts');
  assert.equal(map.intentIndex.data, undefined);
});

/* ---------------------------- golden compat --------------------------- */

test('the js-src-app golden keeps its module keys and extracted facts under 1.1', () => {
  const fixture = path.join(__dirname, 'fixtures', 'js-src-app');
  fs.cpSync(fixture, root, { recursive: true });
  const golden = JSON.parse(fs.readFileSync(path.join(fixture, 'STRUCTURE.json'), 'utf8'));
  const discovery = discover(root, { legacyFiles: ['STRUCTURE.json'] });
  const { structure } = buildFull({ rootDir: root, discovery, prior: golden });
  for (const [key, entry] of Object.entries(golden.modules)) {
    const now = structure.modules[key];
    assert.ok(now, key);
    for (const field of ['file', 'description', 'exports', 'depends', 'functions']) {
      assert.deepEqual(now[field], entry[field], `${key}.${field}`);
    }
  }
});
