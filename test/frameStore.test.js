/**
 * frameStore tests (T01): the storage seam.
 *
 * Three things are worth pinning down here — the data API round-trips, the
 * `.frame/` layout stays the module's private business (nothing lands at the
 * project root), and the pre-overlay root layout is never read as live data.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const frameStore = require('../src/main/frameStore');
const { FRAME_DIR, FRAME_META_FILES, LEGACY_ROOT_FILES } = require('../src/shared/frameConstants');

let projectDir;

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-store-'));
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

// ─── layout ───────────────────────────────────────────────────

test('every path entry resolves inside .frame/', () => {
  const frameDir = path.join(projectDir, FRAME_DIR);
  const entries = [
    frameStore.tasksPath(projectDir),
    frameStore.structurePath(projectDir),
    frameStore.notesPath(projectDir),
    frameStore.quickstartPath(projectDir),
    frameStore.configPath(projectDir),
    frameStore.agentsPath(projectDir)
  ];

  for (const entry of entries) {
    assert.equal(path.dirname(entry), frameDir, `${entry} is not directly under .frame/`);
  }
  assert.equal(frameStore.frameDirPath(projectDir), frameDir);
});

test('FRAME_META_FILES identifiers use posix separators and resolve natively', () => {
  for (const rel of Object.values(FRAME_META_FILES)) {
    assert.ok(rel.startsWith(`${FRAME_DIR}/`), `${rel} is not .frame/-relative`);
    assert.ok(!rel.includes('\\'), `${rel} carries a native separator`);
  }
  assert.equal(
    frameStore.tasksPath(projectDir),
    path.join(projectDir, FRAME_DIR, 'tasks.json')
  );
});

test('writing any artifact creates .frame/ and touches nothing outside it', () => {
  frameStore.writeTasks(projectDir, { version: '2.0', tasks: [] });
  frameStore.writeStructure(projectDir, { modules: {} });
  frameStore.writeConfig(projectDir, { version: '1.0' });
  frameStore.writeNotes(projectDir, '# Notes\n');
  frameStore.writeQuickstart(projectDir, '# Quickstart\n');
  frameStore.writeAgents(projectDir, '# Project layer\n');

  assert.deepEqual(fs.readdirSync(projectDir), [FRAME_DIR], 'project root gained a file');
});

test('ensureFrameDir is idempotent', () => {
  frameStore.ensureFrameDir(projectDir);
  frameStore.ensureFrameDir(projectDir);
  assert.ok(frameStore.hasFrameDir(projectDir));
});

test('hasFrameDir is false before the first write', () => {
  assert.equal(frameStore.hasFrameDir(projectDir), false);
});

// ─── data API ─────────────────────────────────────────────────

test('JSON artifacts round-trip through the data API', () => {
  const tasks = { version: '2.0', tasks: [{ id: 't1', title: 'A', status: 'pending' }] };
  frameStore.writeTasks(projectDir, tasks);
  assert.deepEqual(frameStore.readTasks(projectDir).data, tasks);

  const structure = { modules: { 'src/main/frameStore.js': { purpose: 'storage seam' } } };
  frameStore.writeStructure(projectDir, structure);
  assert.deepEqual(frameStore.readStructure(projectDir).data, structure);

  const config = { version: '1.0', features: { specDriven: true } };
  frameStore.writeConfig(projectDir, config);
  assert.deepEqual(frameStore.readConfig(projectDir).data, config);
});

test('text artifacts round-trip through the data API', () => {
  frameStore.writeNotes(projectDir, '### [2026-07-29] A decision\n');
  assert.equal(frameStore.readNotes(projectDir), '### [2026-07-29] A decision\n');

  frameStore.writeQuickstart(projectDir, 'npm install\n');
  assert.equal(frameStore.readQuickstart(projectDir), 'npm install\n');

  frameStore.writeAgents(projectDir, '# This project\n');
  assert.equal(frameStore.readAgents(projectDir), '# This project\n');
});

test('missing artifacts read as absent, not as an error', () => {
  const tasks = frameStore.readTasks(projectDir);
  assert.equal(tasks.data, null);
  assert.equal(tasks.error, null, 'a project without tasks is a fresh start, not corruption');

  assert.equal(frameStore.readNotes(projectDir), null);
  assert.equal(frameStore.readQuickstart(projectDir), null);
  assert.equal(frameStore.readAgents(projectDir), null);
});

test('JSON reads preserve the recovery envelope', () => {
  frameStore.writeTasks(projectDir, { version: '2.0', tasks: [{ id: 't1' }] });
  frameStore.writeTasks(projectDir, { version: '2.0', tasks: [{ id: 't1' }, { id: 't2' }] }); // makes a .bak
  fs.writeFileSync(frameStore.tasksPath(projectDir), '{"version":"2.0","tasks":[{"id"'); // torn write

  const recovered = frameStore.readTasks(projectDir);
  assert.equal(recovered.source, 'bak', 'recovery is reported, not swallowed');
  assert.ok(recovered.data.tasks.some((t) => t.id === 't1'));
  assert.ok(recovered.error, 'the original parse failure travels with the recovery');
});

test('writes are atomic — a .bak of the previous good copy survives', () => {
  frameStore.writeTasks(projectDir, { version: '2.0', tasks: [] });
  frameStore.writeTasks(projectDir, { version: '2.0', tasks: [{ id: 't1' }] });
  assert.ok(fs.existsSync(frameStore.tasksPath(projectDir) + '.bak'));
});

// ─── legacy layout is never live data ─────────────────────────

test('root-layout artifacts are not read', () => {
  fs.writeFileSync(
    path.join(projectDir, LEGACY_ROOT_FILES.TASKS),
    JSON.stringify({ version: '2.0', tasks: [{ id: 'legacy', title: 'from the root' }] })
  );
  fs.writeFileSync(path.join(projectDir, LEGACY_ROOT_FILES.NOTES), '# legacy notes\n');
  fs.writeFileSync(
    path.join(projectDir, LEGACY_ROOT_FILES.STRUCTURE),
    JSON.stringify({ modules: { legacy: {} } })
  );

  assert.equal(frameStore.readTasks(projectDir).data, null, 'root tasks.json read as live data');
  assert.equal(frameStore.readNotes(projectDir), null);
  assert.equal(frameStore.readStructure(projectDir).data, null);
});

test('writing does not disturb a root-layout file of the same name', () => {
  const legacyTasks = path.join(projectDir, LEGACY_ROOT_FILES.TASKS);
  fs.writeFileSync(legacyTasks, '{"legacy":true}');
  const before = fs.readFileSync(legacyTasks, 'utf8');

  frameStore.writeTasks(projectDir, { version: '2.0', tasks: [] });

  assert.equal(fs.readFileSync(legacyTasks, 'utf8'), before, 'the legacy file was modified');
  assert.deepEqual(frameStore.readTasks(projectDir).data, { version: '2.0', tasks: [] });
});
