/**
 * Project-open footprint tests (migration-consent-scope T04+).
 *
 * `openProjectLayout` is the whole open sequence in one function, and the
 * order it enforces is the point: a legacy project's meta files move first,
 * and the stagers only ever run against a settled layout. What is worth
 * pinning is therefore the tree, not the call order — every Frame-owned file
 * arrives byte-verified against its backup, an opened legacy project ends up
 * with the artifacts an already-migrated one has, and five opens produce the
 * tree the first one did.
 *
 * Electron and the telemetry package are stubbed (the frameProjectInit
 * pattern): CI runs this suite with no node_modules.
 */

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const Module = require('node:module');
const EXTERNAL_STUBS = {
  '@aptabase/electron/main': { initialize() {}, trackEvent() {} },
  electron: {
    app: { getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    ipcMain: { handle() {}, on() {} },
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
const frameStore = require('../src/main/frameStore');
const specManager = require('../src/main/specManager');
const tasksManager = require('../src/main/tasksManager');
const aiToolManager = require('../src/main/aiToolManager');
const { FRAME_DIR, MIGRATION_BACKUP_DIR } = require('../src/shared/frameConstants');

aiToolManager.getActiveTool = () => ({ id: 'claude', name: 'Claude Code' });

// The re-arm starts real fs watchers, which would keep this process alive
// past the last assertion. Counting the calls proves the same thing without
// leaving a watcher behind.
const rearmed = { tasks: 0, specs: 0 };
tasksManager.restartWatching = () => { rearmed.tasks += 1; };
specManager.startWatching = () => { rearmed.specs += 1; };

let projectDir;

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

const AGENTS_BODY = `# demo — AI Instructions

## Project Navigation

1. **STRUCTURE.json** — module map, which file is where
2. **PROJECT_NOTES.md** — project vision, past decisions, session notes
3. **tasks.json** — pending tasks

---

**Note:** This file is named \`AGENTS.md\` to be AI-tool agnostic. A \`CLAUDE.md\` symlink is provided for Claude Code compatibility.
`;

const LEGACY_META = {
  'AGENTS.md': AGENTS_BODY,
  'STRUCTURE.json': `${JSON.stringify({ modules: {} }, null, 2)}\n`,
  'PROJECT_NOTES.md': '# Notes\n\n### [2026-01-01] Started\n',
  'tasks.json': `${JSON.stringify({ version: '2.0', tasks: [] }, null, 2)}\n`,
  'QUICKSTART.md': '# Quickstart\n'
};

/** A project as Frame's pre-overlay init left it. */
function makeLegacyProject({ commit = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-open-'));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);

  fs.mkdirSync(path.join(dir, FRAME_DIR), { recursive: true });
  fs.writeFileSync(path.join(dir, FRAME_DIR, 'config.json'), JSON.stringify({
    version: '1.0',
    name: 'demo',
    settings: { autoUpdateStructure: true },
    features: { specDriven: true },
    files: {
      agents: 'AGENTS.md',
      claudeSymlink: 'CLAUDE.md',
      structure: 'STRUCTURE.json',
      notes: 'PROJECT_NOTES.md',
      tasks: 'tasks.json',
      quickstart: 'QUICKSTART.md'
    }
  }, null, 2), 'utf8');

  for (const [name, content] of Object.entries(LEGACY_META)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  fs.symlinkSync('AGENTS.md', path.join(dir, 'CLAUDE.md'));
  fs.symlinkSync('AGENTS.md', path.join(dir, 'GEMINI.md'));

  if (commit) {
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'frame init']);
  }
  return dir;
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Every file in the tree → sha256, with `.git/` internals left out. */
function snapshotTree(dir) {
  const snapshot = {};
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const rel = path.relative(dir, full).split(path.sep).join('/');
      if (rel === '.git' || rel.startsWith('.git/')) continue;
      if (entry.isSymbolicLink()) snapshot[rel] = `symlink:${fs.readlinkSync(full)}`;
      else if (entry.isDirectory()) walk(full);
      else snapshot[rel] = hashFile(full);
    }
  };
  walk(dir);
  return snapshot;
}

/** The paths under `.frame/`, so two projects' artifact sets can be compared. */
function frameLayout(dir) {
  return Object.keys(snapshotTree(path.join(dir, FRAME_DIR))).sort();
}

afterEach(() => {
  if (projectDir) fs.rmSync(projectDir, { recursive: true, force: true });
  projectDir = null;
});

test('a legacy project migrates on open, every file byte-verified against its backup', async () => {
  projectDir = makeLegacyProject();
  const before = rearmed.tasks;

  const result = await frameProject.openProjectLayout(projectDir);

  assert.equal(result.isFrame, true);
  assert.equal(result.layout, 'overlay', 'the open settles the layout question');
  assert.equal(result.migration.ran, true);
  assert.deepEqual(result.migration.moved.sort(), Object.keys(LEGACY_META).sort());

  for (const [name, content] of Object.entries(LEGACY_META)) {
    assert.ok(!fs.existsSync(path.join(projectDir, name)), `${name} left the project root`);
    const moved = path.join(projectDir, FRAME_DIR, name);
    const backup = path.join(projectDir, FRAME_DIR, MIGRATION_BACKUP_DIR, name);
    assert.equal(fs.readFileSync(backup, 'utf8'), content, `${name} was backed up byte-equal`);
    if (name === 'AGENTS.md') continue; // see below
    assert.equal(fs.readFileSync(moved, 'utf8'), content, `${name} arrived byte-equal`);
    assert.equal(hashFile(backup), hashFile(moved), `${name} matches its backup`);
  }

  // AGENTS.md is the one file the open still writes to after the move, and
  // what it writes is Frame's own managed spec section — appended to the copy
  // now in `.frame/`, which is the whole point: the doc upgrade used to land
  // on the root file and dirty it before anything asked to migrate. The
  // user's own prose is untouched, because rewriting it is a decision.
  const agents = fs.readFileSync(path.join(projectDir, FRAME_DIR, 'AGENTS.md'), 'utf8');
  assert.ok(agents.startsWith(LEGACY_META['AGENTS.md'].trimEnd()), 'the user\'s prose survived verbatim');
  assert.match(agents, /frame:managed:spec-section/, 'and the managed section is current');

  assert.ok(!fs.existsSync(path.join(projectDir, 'GEMINI.md')), 'the planted symlinks are gone');
  assert.equal(frameStore.isLegacyLayout(projectDir), false, 'the fingerprint is cleared');
  assert.ok(rearmed.tasks > before, 'the watchers were re-armed after the move');
});

test('an opened legacy project ends up with the artifacts an already-migrated one has', async () => {
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-open-fresh-'));
  try {
    await frameProject.runProjectInit(fresh, 'demo');
    await frameProject.openProjectLayout(fresh);

    projectDir = makeLegacyProject();
    await frameProject.openProjectLayout(projectDir);

    const migrated = new Set(frameLayout(projectDir));
    for (const rel of frameLayout(fresh)) {
      // The backup folder is the migrated project's alone, and the meta files
      // themselves carry different content by construction. The activity log
      // is named after the project directory (FRAME_ACTIVITY_HOME is relative
      // under `npm test`), so it can never match across two fixtures.
      if (rel.startsWith(`${MIGRATION_BACKUP_DIR}/`)) continue;
      if (rel.startsWith('runtime/test-activity/')) continue;
      assert.ok(migrated.has(rel), `.frame/${rel} is present after a migrating open`);
    }
    // The three the stagers are actually here to deliver.
    assert.ok(migrated.has('docs/REFERENCE.md'));
    assert.ok(migrated.has('bin/spec-context.js'));
    assert.ok(migrated.has('runtime/commands/claude-code/spec.implement.md'));
  } finally {
    fs.rmSync(fresh, { recursive: true, force: true });
  }
});

test('five opens in a row produce the tree the first one did', async () => {
  projectDir = makeLegacyProject();
  await frameProject.openProjectLayout(projectDir);
  const afterFirst = snapshotTree(projectDir);

  for (let i = 0; i < 4; i += 1) {
    const result = await frameProject.openProjectLayout(projectDir);
    assert.equal(result.layout, 'overlay');
    assert.equal(result.migration, null, 'there is nothing left to migrate');
  }

  assert.deepEqual(snapshotTree(projectDir), afterFirst, 'opens 2–5 changed nothing');
});

test('an already-migrated project and a fresh one come out of an open unchanged', async () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-open-migrated-'));
  await frameProject.runProjectInit(projectDir, 'demo');
  await frameProject.openProjectLayout(projectDir);

  const before = snapshotTree(projectDir);
  const result = await frameProject.openProjectLayout(projectDir);

  assert.equal(result.layout, 'overlay');
  assert.equal(result.migration, null, 'no migration is proposed, so nothing is reported');
  assert.deepEqual(snapshotTree(projectDir), before, 'the open is a read for a settled project');
});

test('a directory Frame never initialised is answered, not written to', async () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-open-none-'));
  fs.writeFileSync(path.join(projectDir, 'README.md'), '# ours\n', 'utf8');
  const before = snapshotTree(projectDir);

  const result = await frameProject.openProjectLayout(projectDir);

  assert.deepEqual(result, { isFrame: false, layout: 'none', migration: null });
  assert.deepEqual(snapshotTree(projectDir), before);
});
