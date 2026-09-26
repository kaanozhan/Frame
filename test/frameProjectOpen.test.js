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
const realStartWatching = specManager.startWatching;
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
      // Per-attempt scan records and publication backups belong to the fresh
      // project's initial scan. An open never scans, and must not fabricate
      // them to match (STR-01): compare durable metadata and tooling only.
      if (rel.startsWith('runtime/structure/')) continue;
      if (rel.endsWith('.bak')) continue;
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

test('an open blocked by a merge writes nothing at all', async () => {
  projectDir = makeLegacyProject();

  // A real conflict on one of the meta files: two branches edit it, then merge.
  const notes = path.join(projectDir, 'PROJECT_NOTES.md');
  git(projectDir, ['checkout', '-q', '-b', 'other']);
  fs.appendFileSync(notes, '\n### [2026-02-02] Theirs\n');
  git(projectDir, ['commit', '-q', '-a', '-m', 'theirs']);
  git(projectDir, ['checkout', '-q', '-']);
  fs.appendFileSync(notes, '\n### [2026-02-02] Ours\n');
  git(projectDir, ['commit', '-q', '-a', '-m', 'ours']);
  try {
    git(projectDir, ['merge', '--no-edit', 'other']);
  } catch (err) {
    /* the conflict is the point */
  }

  const statusBefore = git(projectDir, ['status', '--porcelain']);
  assert.ok(statusBefore.includes('UU '), 'the fixture really is mid-merge');
  const before = snapshotTree(projectDir);

  const result = await frameProject.openProjectLayout(projectDir);

  assert.equal(result.layout, 'legacy', 'the project is left where it was');
  assert.deepEqual(result.migration, {
    ran: false,
    blocked: 'unmerged',
    unmerged: ['PROJECT_NOTES.md']
  });

  assert.deepEqual(snapshotTree(projectDir), before, 'not one byte was written');
  assert.equal(git(projectDir, ['status', '--porcelain']), statusBefore, 'git sees the same tree');
  assert.ok(!fs.existsSync(path.join(projectDir, FRAME_DIR, 'specs')), 'no .frame/specs/ was created');
  assert.ok(!fs.existsSync(path.join(projectDir, FRAME_DIR, 'docs')), 'no stager ran');
});

test('the specs watcher does not create .frame/specs/ while the layout is unsettled', () => {
  projectDir = makeLegacyProject();
  const before = snapshotTree(projectDir);

  realStartWatching(projectDir);

  assert.ok(!fs.existsSync(path.join(projectDir, FRAME_DIR, 'specs')), 'the mkdirSync is gated');
  assert.deepEqual(snapshotTree(projectDir), before, 'watching an unsettled project writes nothing');
});

test('a directory Frame never initialised is answered, not written to', async () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-open-none-'));
  fs.writeFileSync(path.join(projectDir, 'README.md'), '# ours\n', 'utf8');
  const before = snapshotTree(projectDir);

  const result = await frameProject.openProjectLayout(projectDir);

  assert.deepEqual(result, { isFrame: false, layout: 'none', migration: null });
  assert.deepEqual(snapshotTree(projectDir), before);
});


/* ---------------- STR-02: the lifecycle worker is attached ---------------- */

const { EventEmitter } = require('events');
const structureLifecycle = require('../src/main/structureLifecycle');

/** A fake `--supervised` child that records what the supervisor sends. */
function fakeWorkers() {
  const spawned = [];
  structureLifecycle.configure({
    enabled: true,
    ticker: () => ({ dispose() {} }),
    spawn: (execPath, args, options) => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stdout.setEncoding = () => {};
      child.stderr = { resume() {} };
      child.messages = [];
      child.stdin = {
        destroyed: false,
        on() {},
        write: (line) => { child.messages.push(JSON.parse(line)); return true; },
        end: () => setImmediate(() => child.emit('close', 0, null))
      };
      child.kill = () => child.emit('close', null, 'SIGKILL');
      spawned.push({ args, cwd: options.cwd, env: options.env, child, scanRecordAtSpawn: fs.existsSync(path.join(options.cwd, '.frame', 'runtime', 'structure', 'scan.json')) });
      return child;
    }
  });
  return spawned;
}

async function resetWorkers() {
  await structureLifecycle.disposeAll();
  structureLifecycle.configure({ enabled: false, spawn: require('child_process').spawn, ticker: null });
}

/* ------------------------ STR-01: opens never scan ------------------------ */

// STR-02 D10 overturns STR-01's "an open never asks for a scan": the open
// now asks the lifecycle worker to reconcile. The open itself still scans
// nothing and invalidates nothing — the worker does the work, off-thread.
test('an open refreshes tools and requests reconciliation, but itself scans nothing', async (t) => {
  const spawned = fakeWorkers();
  t.after(resetWorkers);
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-open-tools-'));
  fs.writeFileSync(path.join(projectDir, 'a.js'), '// A\n');
  await frameProject.runProjectInit(projectDir, 'demo');
  const map = path.join(projectDir, FRAME_DIR, 'STRUCTURE.json');
  const record = path.join(projectDir, FRAME_DIR, 'runtime', 'structure', 'scan.json');
  const before = [fs.readFileSync(map, 'utf8'), fs.readFileSync(record, 'utf8')];

  // an older checkout's tooling, and a source change the map does not know about
  fs.writeFileSync(path.join(projectDir, FRAME_DIR, 'bin', 'update-structure.js'), '// stale generation\n');
  fs.writeFileSync(path.join(projectDir, 'b.js'), '// B\n');
  await frameProject.openProjectLayout(projectDir);

  assert.notEqual(fs.readFileSync(path.join(projectDir, FRAME_DIR, 'bin', 'update-structure.js'), 'utf8'), '// stale generation\n', 'tools refreshed');
  assert.deepEqual([fs.readFileSync(map, 'utf8'), fs.readFileSync(record, 'utf8')], before, 'the open wrote no map and no scan record');
  assert.equal(spawned.length, 1, 'the worker started at init is reused');
  assert.deepEqual(spawned[0].child.messages, [{ cmd: 'reconcile', reason: 'reopen' }]);
});

test('a re-init blocked by a merge writes nothing at all', async () => {
  projectDir = makeLegacyProject();
  const notes = path.join(projectDir, 'PROJECT_NOTES.md');
  git(projectDir, ['checkout', '-q', '-b', 'other']);
  fs.appendFileSync(notes, '\n### [2026-02-02] Theirs\n');
  git(projectDir, ['commit', '-q', '-a', '-m', 'theirs']);
  git(projectDir, ['checkout', '-q', '-']);
  fs.appendFileSync(notes, '\n### [2026-02-02] Ours\n');
  git(projectDir, ['commit', '-q', '-a', '-m', 'ours']);
  try {
    git(projectDir, ['merge', '--no-edit', 'other']);
  } catch (err) {
    /* the conflict is the point */
  }
  const before = snapshotTree(projectDir);

  await assert.rejects(frameProject.runProjectInit(projectDir, 'demo'), (err) => err.code === 'E_LAYOUT_UNMERGED');
  assert.deepEqual(snapshotTree(projectDir), before, 'no config, staging, scan state or map writes');
});

test('repeated opens drive one worker; an open of a project without one starts it', async (t) => {
  const spawned = fakeWorkers();
  t.after(resetWorkers);
  projectDir = makeLegacyProject();
  for (let i = 0; i < 3; i++) await frameProject.openProjectLayout(projectDir);
  assert.equal(spawned.length, 1);
  assert.deepEqual(spawned[0].child.messages.map((m) => m.reason), ['reopen', 'reopen']);
});

test('a blocked open and a blocked re-init start no worker', async (t) => {
  const spawned = fakeWorkers();
  t.after(resetWorkers);
  projectDir = makeLegacyProject();
  const notes = path.join(projectDir, 'PROJECT_NOTES.md');
  git(projectDir, ['checkout', '-q', '-b', 'other']);
  fs.appendFileSync(notes, '\n### [2026-02-02] Theirs\n');
  git(projectDir, ['commit', '-q', '-a', '-m', 'theirs']);
  git(projectDir, ['checkout', '-q', '-']);
  fs.appendFileSync(notes, '\n### [2026-02-02] Ours\n');
  git(projectDir, ['commit', '-q', '-a', '-m', 'ours']);
  try {
    git(projectDir, ['merge', '--no-edit', 'other']);
  } catch (err) {
    /* the conflict is the point */
  }
  await frameProject.openProjectLayout(projectDir);
  await assert.rejects(frameProject.runProjectInit(projectDir, 'demo'));
  assert.equal(spawned.length, 0);
});

test('removing a project from the workspace stops its worker', { skip: process.platform === 'win32' && 'HOME redirection is POSIX-only' }, async (t) => {
  const spawned = fakeWorkers();
  t.after(resetWorkers);
  // workspace.init resolves ~/.frame from HOME: point it at a scratch home so
  // the user's real workspace file is never read or written.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-open-home-'));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  t.after(() => {
    process.env.HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  });
  const workspace = require('../src/main/workspace');
  const { IPC: CHANNELS } = require('../src/shared/ipcChannels');
  workspace.init({}, null);
  const handlers = {};
  workspace.setupIPC({ on: (channel, fn) => { handlers[channel] = fn; }, handle() {} });

  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-open-ws-'));
  await frameProject.runProjectInit(projectDir, 'demo');
  workspace.addProject(projectDir, 'demo', true);
  assert.equal(spawned.length, 1);

  handlers[CHANNELS.REMOVE_PROJECT_FROM_WORKSPACE]({ sender: { send() {} } }, projectDir);
  assert.deepEqual(spawned[0].child.messages.map((m) => m.cmd), ['stop']);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(structureLifecycle.list(), []);
  assert.ok(!workspace.getProjects().some((p) => p.path === projectDir));
  assert.ok(fs.existsSync(path.join(home, '.frame')), 'the scratch home was used');
});
