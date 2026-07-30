/**
 * Init footprint test (T11): the property the whole overlay is for.
 *
 * Initialize Frame in a repository that already ships its own CLAUDE.md,
 * AGENTS.md, GEMINI.md, .cursorrules, .claude/settings.json and
 * .husky/pre-commit, then assert two things:
 *
 *   1. every path init created is inside `.frame/`
 *   2. every pre-existing file is byte-identical, still a real file, and
 *      still not a symlink
 *
 * A walk of the whole tree is the assertion rather than a list of known
 * filenames — a future write to a file nobody thought to name would slip
 * past a list, and that is exactly the failure this guards.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// frameProject reaches electron (dialog, workspace) and @aptabase transitively.
// CI runs this suite with no node_modules, so both are stubbed before it loads;
// nothing here opens a dialog — init is called with `confirmed` semantics by
// going through initializeFrameProject directly.
const Module = require('node:module');
const EXTERNAL_STUBS = {
  '@aptabase/electron/main': { initialize() {}, trackEvent() {} },
  electron: {
    app: { getPath: () => os.tmpdir(), getName: () => 'Frame', on() {} },
    ipcMain: { handle() {}, on() {}, removeHandler() {} },
    dialog: { showMessageBox: async () => ({ response: 1 }) }
  }
};
const loadOriginal = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(EXTERNAL_STUBS, request)) {
    return EXTERNAL_STUBS[request];
  }
  return loadOriginal.call(this, request, ...rest);
};

const frameProject = require('../src/main/frameProject');
const { FRAME_DIR } = require('../src/shared/frameConstants');

let projectDir;

const PRE_EXISTING = {
  'CLAUDE.md': '# The repo owns this\n\nDo not touch.\n',
  'AGENTS.md': '# Our agent rules\n',
  'GEMINI.md': '# Gemini rules\n',
  '.cursorrules': 'be terse\n',
  '.claude/settings.json': '{\n  "hooks": {}\n}\n',
  '.husky/pre-commit': '#!/bin/sh\nnpm test\n',
  '.github/copilot-instructions.md': '# copilot\n',
  'src/index.js': 'module.exports = 1;\n',
  'package.json': '{"name":"victim","version":"1.0.0"}\n',
  '.gitignore': 'node_modules/\n'
};

function snapshot(dir) {
  const out = new Map();
  const walk = (current, rel) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        out.set(relPath + '/', 'dir');
        walk(full, relPath);
      } else if (entry.isSymbolicLink()) {
        out.set(relPath, `symlink:${fs.readlinkSync(full)}`);
      } else {
        out.set(relPath, crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'));
      }
    }
  };
  walk(dir, '');
  return out;
}

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-init-'));
  for (const [rel, content] of Object.entries(PRE_EXISTING)) {
    const target = path.join(projectDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('init creates nothing outside .frame/', async () => {
  const before = snapshot(projectDir);
  await frameProject.initializeFrameProject(projectDir, 'victim');
  const after = snapshot(projectDir);

  const created = [...after.keys()].filter((p) => !before.has(p));
  assert.ok(created.length > 0, 'init created nothing at all');

  const escaped = created.filter((p) => p !== `${FRAME_DIR}/` && !p.startsWith(`${FRAME_DIR}/`));
  assert.deepEqual(escaped, [], `init wrote outside ${FRAME_DIR}/: ${escaped.join(', ')}`);
});

test('every pre-existing file is byte-identical afterwards', async () => {
  const before = snapshot(projectDir);
  await frameProject.initializeFrameProject(projectDir, 'victim');
  const after = snapshot(projectDir);

  for (const [rel, hash] of before) {
    assert.ok(after.has(rel), `${rel} was deleted`);
    assert.equal(after.get(rel), hash, `${rel} was modified`);
  }
});

test('no root instruction file is replaced by a symlink', async () => {
  await frameProject.initializeFrameProject(projectDir, 'victim');

  for (const rel of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']) {
    const stat = fs.lstatSync(path.join(projectDir, rel));
    assert.ok(!stat.isSymbolicLink(), `${rel} became a symlink`);
    assert.ok(stat.isFile());
  }
});

test('.claude/settings.json and .husky/pre-commit are not merged into', async () => {
  await frameProject.initializeFrameProject(projectDir, 'victim');

  assert.equal(
    fs.readFileSync(path.join(projectDir, '.claude', 'settings.json'), 'utf8'),
    PRE_EXISTING['.claude/settings.json']
  );
  assert.equal(
    fs.readFileSync(path.join(projectDir, '.husky', 'pre-commit'), 'utf8'),
    PRE_EXISTING['.husky/pre-commit']
  );
});

test('the meta artifacts land inside .frame/', async () => {
  await frameProject.initializeFrameProject(projectDir, 'victim');

  for (const rel of ['config.json', 'tasks.json', 'STRUCTURE.json', 'PROJECT_NOTES.md', 'QUICKSTART.md']) {
    assert.ok(
      fs.existsSync(path.join(projectDir, FRAME_DIR, rel)),
      `${FRAME_DIR}/${rel} was not created`
    );
  }
});

test('no .frame/AGENTS.md is seeded — the project layer is opt-in', async () => {
  await frameProject.initializeFrameProject(projectDir, 'victim');
  assert.ok(
    !fs.existsSync(path.join(projectDir, FRAME_DIR, 'AGENTS.md')),
    'init seeded a project layer with nothing project-specific to say'
  );
});

test('a second init is still footprint-clean', async () => {
  await frameProject.initializeFrameProject(projectDir, 'victim');
  const before = snapshot(projectDir);
  await frameProject.initializeFrameProject(projectDir, 'victim');
  const after = snapshot(projectDir);

  const created = [...after.keys()].filter((p) => !before.has(p));
  const escaped = created.filter((p) => !p.startsWith(`${FRAME_DIR}/`));
  assert.deepEqual(escaped, [], 're-init wrote outside .frame/');

  for (const rel of Object.keys(PRE_EXISTING)) {
    assert.equal(after.get(rel), before.get(rel), `${rel} changed on re-init`);
  }
});
