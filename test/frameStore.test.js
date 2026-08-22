/**
 * frameStore tests (non-invasive-overlay T01).
 *
 * The seam has to serve two layouts at once: `.frame/` for everything Frame
 * writes from now on, and the pre-overlay project root for as long as an
 * existing project has not consented to migrate. These tests pin the
 * resolution rule (including the fingerprint that gates the fallback), the
 * typed round-trips, the atomic write, and the identity stamp.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const frameStore = require('../src/main/frameStore');
const { FRAME_DIR, FRAME_CONFIG_FILE, FRAME_FILES } = require('../src/shared/frameConstants');

let projectDir;

function frameDir() {
  return path.join(projectDir, FRAME_DIR);
}

function writeConfig(config) {
  fs.mkdirSync(frameDir(), { recursive: true });
  fs.writeFileSync(path.join(frameDir(), FRAME_CONFIG_FILE), JSON.stringify(config, null, 2), 'utf8');
}

/** The record Frame's pre-overlay init wrote — the migration fingerprint. */
function legacyFilesRecord() {
  return {
    agents: FRAME_FILES.AGENTS,
    claudeSymlink: FRAME_FILES.CLAUDE_SYMLINK,
    structure: FRAME_FILES.STRUCTURE,
    notes: FRAME_FILES.NOTES,
    tasks: FRAME_FILES.TASKS,
    quickstart: FRAME_FILES.QUICKSTART
  };
}

function writeOverlayFile(name, content) {
  fs.mkdirSync(frameDir(), { recursive: true });
  fs.writeFileSync(path.join(frameDir(), name), content, 'utf8');
}

function writeRootFile(name, content) {
  fs.writeFileSync(path.join(projectDir, name), content, 'utf8');
}

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-store-'));
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

// ─── Resolution rule ──────────────────────────────────────────

test('overlay wins whenever .frame/<name> exists', () => {
  writeConfig({ version: '1.0', files: legacyFilesRecord() });
  writeOverlayFile(FRAME_FILES.TASKS, JSON.stringify({ tasks: [{ id: 'overlay' }] }));
  writeRootFile(FRAME_FILES.TASKS, JSON.stringify({ tasks: [{ id: 'root' }] }));

  assert.equal(frameStore.resolvePath(projectDir, FRAME_FILES.TASKS), path.join(frameDir(), FRAME_FILES.TASKS));
  assert.equal(frameStore.getTasks(projectDir).data.tasks[0].id, 'overlay');
});

test('legacy root file is read only with the config.files record behind it', () => {
  writeConfig({ version: '1.0', files: legacyFilesRecord() });
  writeRootFile(FRAME_FILES.NOTES, '# root notes');

  assert.equal(frameStore.readNotes(projectDir), '# root notes');
  assert.equal(frameStore.resolvePath(projectDir, FRAME_FILES.NOTES), path.join(projectDir, FRAME_FILES.NOTES));
});

test('a root file without the files record is not Frame\'s — never resolved', () => {
  writeConfig({ version: '1.0' }); // overlay-era config: no files record
  writeRootFile(FRAME_FILES.NOTES, '# someone else\'s notes');

  assert.equal(frameStore.readNotes(projectDir), null);
  assert.equal(frameStore.resolvePath(projectDir, FRAME_FILES.NOTES), path.join(frameDir(), FRAME_FILES.NOTES));
});

test('a file Frame creates today lands in .frame/, even in a legacy project', () => {
  writeConfig({ version: '1.0', files: legacyFilesRecord() });
  writeRootFile(FRAME_FILES.TASKS, JSON.stringify({ tasks: [] })); // legacy, but no QUICKSTART at root

  frameStore.writeAgents(projectDir, '# Agents');

  assert.ok(fs.existsSync(path.join(frameDir(), FRAME_FILES.AGENTS)), 'new file created under .frame/');
  assert.ok(!fs.existsSync(path.join(projectDir, FRAME_FILES.AGENTS)), 'nothing new at the project root');
});

test('a legacy file keeps being written in place until migration moves it', () => {
  writeConfig({ version: '1.0', files: legacyFilesRecord() });
  writeRootFile(FRAME_FILES.TASKS, JSON.stringify({ version: '2.0', tasks: [] }));

  frameStore.saveTasks(projectDir, { version: '2.0', tasks: [{ id: 't1' }] });

  const root = JSON.parse(fs.readFileSync(path.join(projectDir, FRAME_FILES.TASKS), 'utf8'));
  assert.equal(root.tasks[0].id, 't1');
  assert.ok(!fs.existsSync(path.join(frameDir(), FRAME_FILES.TASKS)), 'no second copy under .frame/');
});

// ─── Layout answers ───────────────────────────────────────────

test('isLegacyLayout needs both the record and a root file', () => {
  writeConfig({ version: '1.0', files: legacyFilesRecord() });
  assert.equal(frameStore.isLegacyLayout(projectDir), false, 'record alone is not the fingerprint');

  writeRootFile(FRAME_FILES.STRUCTURE, '{}');
  assert.equal(frameStore.isLegacyLayout(projectDir), true);

  writeConfig({ version: '1.0' }); // record dropped, as migration does
  assert.equal(frameStore.isLegacyLayout(projectDir), false, 'a migrated project reads as overlay');
});

test('metaDir points at the directory tasks.json actually lives in', () => {
  writeConfig({ version: '1.0', files: legacyFilesRecord() });
  writeRootFile(FRAME_FILES.TASKS, '{}');
  assert.equal(frameStore.metaDir(projectDir), projectDir, 'legacy layout: watch the root');

  writeOverlayFile(FRAME_FILES.TASKS, '{}');
  assert.equal(frameStore.metaDir(projectDir), frameDir(), 'overlay layout: watch .frame/');
});

// ─── Typed read/write ─────────────────────────────────────────

test('typed read/write round-trips', () => {
  writeConfig({ version: '1.0', name: 'demo' });

  frameStore.saveTasks(projectDir, { version: '2.0', tasks: [{ id: 't1', status: 'pending' }] });
  assert.equal(frameStore.getTasks(projectDir).data.tasks[0].id, 't1');

  frameStore.saveStructure(projectDir, { project: 'demo', modules: {} });
  assert.equal(frameStore.getStructure(projectDir).project, 'demo');

  frameStore.writeAgents(projectDir, '# Agents\n');
  assert.equal(frameStore.readAgents(projectDir), '# Agents\n');

  writeOverlayFile(FRAME_FILES.QUICKSTART, '# Quickstart\n');
  assert.equal(frameStore.readQuickstart(projectDir), '# Quickstart\n');

  const config = frameStore.readConfig(projectDir);
  config.settings = { gitSharing: 'repo' };
  frameStore.writeConfig(projectDir, config);
  assert.equal(frameStore.readConfig(projectDir).settings.gitSharing, 'repo');
});

test('missing files read as null, not as a throw', () => {
  assert.equal(frameStore.readNotes(projectDir), null);
  assert.equal(frameStore.readAgents(projectDir), null);
  assert.equal(frameStore.readQuickstart(projectDir), null);
  assert.equal(frameStore.getStructure(projectDir), null);
  assert.equal(frameStore.readConfig(projectDir), null);
  assert.equal(frameStore.getTasks(projectDir).data, null);
});

test('appendNote creates the file and keeps one blank line between entries', () => {
  frameStore.appendNote(projectDir, '### [2026-08-22] First');
  assert.equal(frameStore.readNotes(projectDir), '### [2026-08-22] First\n');

  frameStore.appendNote(projectDir, '### [2026-08-23] Second');
  assert.equal(
    frameStore.readNotes(projectDir),
    '### [2026-08-22] First\n\n### [2026-08-23] Second\n'
  );
});

test('writes are atomic and leave a .bak of the previous copy', () => {
  frameStore.saveTasks(projectDir, { version: '2.0', tasks: [{ id: 'first' }] });
  frameStore.saveTasks(projectDir, { version: '2.0', tasks: [{ id: 'second' }] });

  const tasksPath = path.join(frameDir(), FRAME_FILES.TASKS);
  assert.equal(JSON.parse(fs.readFileSync(tasksPath, 'utf8')).tasks[0].id, 'second');
  assert.equal(JSON.parse(fs.readFileSync(tasksPath + '.bak', 'utf8')).tasks[0].id, 'first');
  assert.ok(!fs.existsSync(tasksPath + '.tmp'), 'no tmp file left behind');
});

// ─── Project identity ─────────────────────────────────────────

test('ensureProjectId stamps once and is idempotent', () => {
  writeConfig({ version: '1.0', name: 'demo' });
  assert.equal(frameStore.getProjectId(projectDir), null);

  const id = frameStore.ensureProjectId(projectDir);
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(frameStore.ensureProjectId(projectDir), id, 'second call keeps the id');
  assert.equal(frameStore.getProjectId(projectDir), id);
  assert.equal(JSON.parse(fs.readFileSync(path.join(frameDir(), FRAME_CONFIG_FILE), 'utf8')).name, 'demo');
});

test('ensureProjectId does nothing for a directory that is not a Frame project', () => {
  assert.equal(frameStore.ensureProjectId(projectDir), null);
  assert.ok(!fs.existsSync(frameDir()), 'no config invented');
});
