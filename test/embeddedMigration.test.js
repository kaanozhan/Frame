/**
 * embeddedMigration tests — against real temp git repositories, because every
 * hard case in this spec is a filesystem or a git fact: a symlink Frame
 * planted, a root file the user is mid-edit on, a `.frame/` counterpart that
 * already exists and differs.
 *
 * The properties under test are the ones a user cannot recover from if we get
 * them wrong: nothing Frame did not create is planned, a dirty tree defers the
 * whole run, and the backup is a byte copy that a second run adds to rather
 * than overwrites.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const migration = require('../src/main/embeddedMigration');
const templates = require('../src/shared/frameTemplates');
const { FRAME_DIR } = require('../src/shared/frameConstants');

let root;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/** The manifest a pre-overlay init wrote into `.frame/config.json`. */
const LEGACY_FILES_BLOCK = {
  agents: 'AGENTS.md',
  claudeSymlink: 'CLAUDE.md',
  structure: 'STRUCTURE.json',
  notes: 'PROJECT_NOTES.md',
  tasks: 'tasks.json',
  quickstart: 'QUICKSTART.md'
};

/**
 * A project as pre-overlay Frame left it: meta files at the root, a `.frame/`
 * that already exists (config, specs), and a CLAUDE.md → AGENTS.md symlink.
 * Every legacy project is both layouts at once — that is the normal case, not
 * an edge one.
 */
function makeLegacyProject(name, opts = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  if (opts.git !== false) {
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'Frame Test');
  }

  fs.writeFileSync(path.join(dir, 'README.md'), '# repo\n');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), opts.agents ?? '# Project\n\nFrame instructions.\n');
  fs.writeFileSync(path.join(dir, 'STRUCTURE.json'), '{"modules":[]}\n');
  fs.writeFileSync(path.join(dir, 'PROJECT_NOTES.md'), '# Notes\n');
  fs.writeFileSync(path.join(dir, 'tasks.json'), '{"tasks":[]}\n');
  fs.writeFileSync(path.join(dir, 'QUICKSTART.md'), '# Quickstart\n');
  if (opts.symlinks !== false) {
    fs.symlinkSync('AGENTS.md', path.join(dir, 'CLAUDE.md'));
  }

  fs.mkdirSync(path.join(dir, FRAME_DIR, 'specs'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, FRAME_DIR, 'config.json'),
    JSON.stringify({ version: '1.0', settings: {}, files: opts.files ?? LEGACY_FILES_BLOCK }, null, 2)
  );

  if (opts.git !== false && opts.commit !== false) {
    // The root files only, unless the project committed `.frame/` too. Which
    // of the two it is decides the sharing mode migration derives, so the
    // harness must be able to produce both.
    const rootEntries = fs
      .readdirSync(dir)
      .filter((entry) => entry !== FRAME_DIR && entry !== '.git');
    git(dir, 'add', '--', ...rootEntries);
    if (opts.trackFrame) git(dir, 'add', '-f', '--', FRAME_DIR);
    git(dir, 'commit', '-qm', 'initial');
  }
  return dir;
}

function dispositionOf(result, rel) {
  const entry = result.artifacts.find((a) => a.rel === rel);
  return entry ? entry.disposition : null;
}

function backupPath(dir, rel) {
  return path.join(dir, FRAME_DIR, migration.BACKUP_DIR, rel);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-migration-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// ─── detection ────────────────────────────────────────────────

test('a project already on the overlay layout plans nothing', () => {
  const dir = path.join(root, 'modern');
  fs.mkdirSync(path.join(dir, FRAME_DIR, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(dir, FRAME_DIR, 'config.json'), '{"version":"1.0"}');
  fs.writeFileSync(path.join(dir, FRAME_DIR, 'tasks.json'), '{"tasks":[]}');

  const result = migration.plan(dir);
  assert.equal(result.legacy, false);
  assert.deepEqual(result.artifacts, []);
});

test('a path that no longer exists plans nothing instead of throwing', () => {
  const result = migration.plan(path.join(root, 'gone'));
  assert.equal(result.legacy, false);
});

// ─── D5: the manifest is the authority ────────────────────────

test('the artifact list comes from config.json.files', () => {
  const dir = makeLegacyProject('manifest');
  const result = migration.plan(dir);

  assert.equal(result.legacy, true);
  assert.equal(result.manifest, 'config');
  assert.deepEqual(
    result.artifacts.map((a) => a.rel).sort(),
    ['AGENTS.md', 'PROJECT_NOTES.md', 'QUICKSTART.md', 'STRUCTURE.json', 'tasks.json']
  );
  assert.equal(dispositionOf(result, 'tasks.json'), 'move');
  assert.equal(
    result.artifacts.find((a) => a.rel === 'tasks.json').target,
    `${FRAME_DIR}/tasks.json`
  );
});

// ─── D5: Frame's fingerprint, or nothing happens ──────────────
//
// A name match alone was enough when it produced a banner. It is not enough
// now that it moves files: `tasks.json` and `QUICKSTART.md` belong to plenty
// of repositories Frame never touched.

test('a project Frame never initialized is left alone, whatever its root files are called', () => {
  const dir = path.join(root, 'not-ours');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tasks.json'), '{"npmTasks":["build"]}\n');
  fs.writeFileSync(path.join(dir, 'QUICKSTART.md'), '# My own quickstart\n');

  const result = migration.plan(dir);
  assert.equal(result.legacy, false, "a stranger's files were planned for migration");
  assert.deepEqual(result.artifacts, []);
  assert.equal(migration.migrateProject(dir).status, 'skipped');
  assert.ok(fs.existsSync(path.join(dir, 'tasks.json')), 'a file Frame never wrote was moved');
});

test('a project initialized after the overlay is left alone too', () => {
  // The current init writes no `files` record and plants no symlink, so a
  // project of its making carries no fingerprint — even when the user's own
  // root files happen to share the names.
  const dir = path.join(root, 'post-overlay');
  fs.mkdirSync(path.join(dir, FRAME_DIR, 'specs'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, FRAME_DIR, 'config.json'),
    JSON.stringify(templates.getFrameConfigTemplate('post-overlay'), null, 2)
  );
  fs.writeFileSync(path.join(dir, FRAME_DIR, 'tasks.json'), '{"tasks":[{"title":"Frame task"}]}\n');
  fs.writeFileSync(path.join(dir, 'tasks.json'), '{"npmTasks":["build"]}\n');
  fs.writeFileSync(path.join(dir, 'QUICKSTART.md'), '# My own quickstart\n');

  assert.equal(migration.plan(dir).legacy, false);
  assert.equal(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8'), '{"npmTasks":["build"]}\n');
});

test('the current config template writes no files record', () => {
  // The record is what proves a pre-overlay init. Writing one on a project
  // where nothing was created at the root would make it a formality — and
  // would hand this engine the user's own files.
  assert.ok(!('files' in templates.getFrameConfigTemplate('MyProject')));
});

test('a Frame-planted symlink is fingerprint enough on its own', () => {
  // The other half of the rule: a config that lost its record still migrates,
  // because nothing but Frame's init creates a CLAUDE.md → AGENTS.md link.
  const dir = makeLegacyProject('symlink-evidence');
  const configPath = path.join(dir, FRAME_DIR, 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  delete config.files;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  const result = migration.plan(dir);
  assert.equal(result.legacy, true, 'a real legacy project was stranded');
  assert.equal(result.manifest, 'fallback');
  assert.deepEqual(result.symlinks, ['CLAUDE.md']);
});

test('a missing or malformed files block falls back to the well-known names', () => {
  // Both fixtures still carry the planted symlink, which is what keeps them
  // legacy at all — this is about which names get used once that is settled.
  const absent = makeLegacyProject('no-manifest', { files: undefined });
  fs.writeFileSync(
    path.join(absent, FRAME_DIR, 'config.json'),
    JSON.stringify({ version: '1.0', settings: {} }, null, 2)
  );
  const fallback = migration.plan(absent);
  assert.equal(fallback.manifest, 'fallback');
  assert.equal(fallback.artifacts.length, 5);

  const malformed = makeLegacyProject('bad-manifest', { files: 'AGENTS.md, tasks.json' });
  assert.equal(migration.plan(malformed).manifest, 'fallback');
});

test('a root file this project\'s manifest does not claim is reported, not planned', () => {
  // Frame created tasks.json and STRUCTURE.json here; PROJECT_NOTES.md and the
  // rest arrived some other way, so they are not ours to move.
  const dir = makeLegacyProject('partial-manifest', {
    files: { tasks: 'tasks.json', structure: 'STRUCTURE.json' }
  });
  const result = migration.plan(dir);

  assert.deepEqual(result.artifacts.map((a) => a.rel).sort(), ['STRUCTURE.json', 'tasks.json']);
  assert.deepEqual(result.unrecognized.sort(), ['AGENTS.md', 'PROJECT_NOTES.md', 'QUICKSTART.md']);
});

test('only a Frame-planted symlink is planned for removal', () => {
  const dir = makeLegacyProject('symlinks');
  fs.symlinkSync('README.md', path.join(dir, 'GEMINI.md')); // someone else's link

  const result = migration.plan(dir);
  assert.deepEqual(result.symlinks, ['CLAUDE.md']);
});

// ─── D4: a dirty tree defers ──────────────────────────────────

test('an uncommitted edit to a legacy file defers the whole run', () => {
  const dir = makeLegacyProject('dirty');
  fs.writeFileSync(path.join(dir, 'PROJECT_NOTES.md'), '# Notes\n\nHalf a thought I was mid-way through.\n');

  const result = migration.plan(dir);
  assert.deepEqual(result.dirty, ['PROJECT_NOTES.md']);
});

test('a staged edit counts as dirty too', () => {
  const dir = makeLegacyProject('staged');
  fs.writeFileSync(path.join(dir, 'tasks.json'), '{"tasks":[{"id":1}]}\n');
  git(dir, 'add', 'tasks.json');

  assert.deepEqual(migration.plan(dir).dirty, ['tasks.json']);
});

test('a tracked-but-clean project is not deferred', () => {
  assert.deepEqual(migration.plan(makeLegacyProject('clean')).dirty, []);
});

test('an untracked root file is not dirty — there is no diff to be confused by', () => {
  const dir = makeLegacyProject('untracked', { commit: false });
  assert.deepEqual(migration.plan(dir).dirty, []);
});

test('a non-git project is never deferred', () => {
  const dir = makeLegacyProject('no-git', { git: false });
  const result = migration.plan(dir);
  assert.equal(result.legacy, true);
  assert.deepEqual(result.dirty, []);
  assert.deepEqual(result.tracked, []);
});

// ─── D8: what the receipt's git sentence keys off ─────────────

test('tracked artifacts are reported, and only the tracked ones', () => {
  const dir = makeLegacyProject('tracked-some', { commit: false });
  git(dir, 'add', 'tasks.json', 'AGENTS.md');
  git(dir, 'commit', '-qm', 'track two');

  const result = migration.plan(dir);
  assert.deepEqual(result.tracked.sort(), ['AGENTS.md', 'tasks.json']);
});

// ─── D3: dual layout ──────────────────────────────────────────

test('an identical .frame/ counterpart makes the root copy a plain delete', () => {
  const dir = makeLegacyProject('identical');
  fs.copyFileSync(path.join(dir, 'tasks.json'), path.join(dir, FRAME_DIR, 'tasks.json'));

  assert.equal(dispositionOf(migration.plan(dir), 'tasks.json'), 'delete-identical');
});

test('a differing .frame/ counterpart sends the root copy to the backup', () => {
  const dir = makeLegacyProject('conflict');
  fs.writeFileSync(path.join(dir, FRAME_DIR, 'tasks.json'), '{"tasks":[{"id":"newer"}]}\n');

  assert.equal(dispositionOf(migration.plan(dir), 'tasks.json'), 'backup-conflict');
});

// ─── D6: what can be handed back ──────────────────────────────

test('a consumed instruction file is planned for restoration', () => {
  const dir = makeLegacyProject('consumed', {
    agents:
      '# Frame\n\nGenerated.\n\n---\n\n## Existing Instructions (from CLAUDE.md)\n\nMy own rules.\n'
  });
  const result = migration.plan(dir);

  assert.deepEqual(result.restore.map((r) => r.rel), ['CLAUDE.md']);
  assert.match(result.restore[0].from, /^AGENTS\.md#Existing Instructions/);
});

test('nothing is planned for restoration when init consumed nothing', () => {
  assert.deepEqual(migration.plan(makeLegacyProject('never-consumed')).restore, []);
});

test('extraction returns the block verbatim and stops at the next one', () => {
  const merged = [
    '# Frame template',
    '',
    '---',
    '',
    '## Existing Instructions (from CLAUDE.md)',
    '',
    'Rule one.',
    '',
    '---',
    '',
    'Still my file — a rule after a horizontal rule.',
    '',
    '---',
    '',
    '## Existing Instructions (from GEMINI.md)',
    '',
    'Gemini rules.',
    ''
  ].join('\n');

  const claude = migration.extractExisting(merged, 'CLAUDE.md');
  assert.match(claude, /Rule one\./);
  // The user's own `---` must not truncate their file.
  assert.match(claude, /a rule after a horizontal rule/);
  assert.ok(!claude.includes('Gemini rules'), 'the next block bled into this one');
  assert.equal(migration.extractExisting(merged, 'GEMINI.md'), 'Gemini rules.\n');
  assert.equal(migration.extractExisting(merged, 'AGENTS.md'), null);
});

// ─── D9: the backup ───────────────────────────────────────────

test('the backup is a byte copy under .frame/migration-backup/', () => {
  const dir = makeLegacyProject('backup');
  const written = migration.writeBackup(dir, ['tasks.json', 'PROJECT_NOTES.md']);

  assert.deepEqual(written, ['tasks.json', 'PROJECT_NOTES.md']);
  assert.ok(
    fs.readFileSync(backupPath(dir, 'tasks.json')).equals(fs.readFileSync(path.join(dir, 'tasks.json'))),
    'the backup is not byte-identical'
  );
});

test('a second run adds only what is missing and never overwrites', () => {
  const dir = makeLegacyProject('backup-twice');
  migration.writeBackup(dir, ['tasks.json']);
  // The interrupted run's copy is the one that must survive: the live file may
  // have moved on since.
  fs.writeFileSync(backupPath(dir, 'tasks.json'), '{"tasks":["the first run\'s copy"]}\n');
  fs.writeFileSync(path.join(dir, 'tasks.json'), '{"tasks":["changed since"]}\n');

  const written = migration.writeBackup(dir, ['tasks.json', 'QUICKSTART.md']);

  assert.deepEqual(written, ['QUICKSTART.md'], 'an existing backup entry was rewritten');
  assert.match(fs.readFileSync(backupPath(dir, 'tasks.json'), 'utf8'), /the first run's copy/);
});

test('a file that is not there is skipped, not failed', () => {
  const dir = makeLegacyProject('backup-absent');
  assert.deepEqual(migration.writeBackup(dir, ['GEMINI.md']), []);
});

test('a dangling symlink is skipped — there is nothing to preserve', () => {
  const dir = makeLegacyProject('backup-dangling', { symlinks: false });
  fs.symlinkSync('AGENTS.md', path.join(dir, 'GEMINI.md'));
  fs.unlinkSync(path.join(dir, 'AGENTS.md'));

  assert.deepEqual(migration.writeBackup(dir, ['GEMINI.md']), []);
  assert.ok(!fs.existsSync(backupPath(dir, 'GEMINI.md')));
});

// ─── D2 / D3: executing a plan ────────────────────────────────

test('a clean legacy project migrates: root artifacts land under .frame/', () => {
  const dir = makeLegacyProject('migrate');
  const result = migration.migrateProject(dir);

  assert.equal(result.status, 'migrated');
  for (const rel of ['tasks.json', 'STRUCTURE.json', 'PROJECT_NOTES.md', 'QUICKSTART.md', 'AGENTS.md']) {
    assert.ok(!fs.existsSync(path.join(dir, rel)), `${rel} survived at the root`);
    assert.ok(fs.existsSync(path.join(dir, FRAME_DIR, rel)), `${rel} never arrived under .frame/`);
  }
  assert.equal(fs.readFileSync(path.join(dir, FRAME_DIR, 'tasks.json'), 'utf8'), '{"tasks":[]}\n');
});

test('nothing outside the manifest is touched', () => {
  const dir = makeLegacyProject('untouched');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"mine"}\n');
  migration.migrateProject(dir);

  assert.ok(fs.existsSync(path.join(dir, 'README.md')));
  assert.ok(fs.existsSync(path.join(dir, 'package.json')));
  assert.ok(fs.existsSync(path.join(dir, FRAME_DIR, 'specs')), 'the pre-existing .frame/specs/ was disturbed');
});

test('an identical counterpart is deleted at the root, not copied over', () => {
  const dir = makeLegacyProject('apply-identical');
  fs.copyFileSync(path.join(dir, 'tasks.json'), path.join(dir, FRAME_DIR, 'tasks.json'));
  const before = fs.statSync(path.join(dir, FRAME_DIR, 'tasks.json')).mtimeMs;

  migration.migrateProject(dir);

  assert.ok(!fs.existsSync(path.join(dir, 'tasks.json')));
  assert.equal(fs.statSync(path.join(dir, FRAME_DIR, 'tasks.json')).mtimeMs, before, '.frame/ copy was rewritten');
});

test('dual layout: the .frame/ version survives and the root copy goes to the backup', () => {
  const dir = makeLegacyProject('apply-conflict');
  // Work done after the upgrade — a blind move would overwrite it with the
  // stale root file, which is the whole reason .frame/ wins.
  fs.writeFileSync(path.join(dir, FRAME_DIR, 'tasks.json'), '{"tasks":[{"id":"post-upgrade"}]}\n');

  const result = migration.migrateProject(dir);

  assert.equal(result.status, 'migrated');
  assert.match(fs.readFileSync(path.join(dir, FRAME_DIR, 'tasks.json'), 'utf8'), /post-upgrade/);
  assert.equal(fs.readFileSync(backupPath(dir, 'tasks.json'), 'utf8'), '{"tasks":[]}\n');
  assert.ok(!fs.existsSync(path.join(dir, 'tasks.json')));
});

test('everything removed is in the backup, whatever its disposition', () => {
  const dir = makeLegacyProject('apply-backup');
  fs.writeFileSync(path.join(dir, FRAME_DIR, 'QUICKSTART.md'), '# different\n');
  migration.migrateProject(dir);

  for (const rel of ['tasks.json', 'STRUCTURE.json', 'PROJECT_NOTES.md', 'QUICKSTART.md', 'AGENTS.md']) {
    assert.ok(fs.existsSync(backupPath(dir, rel)), `${rel} was removed without a backup`);
  }
});

test('a deferred project is left exactly as it was', () => {
  const dir = makeLegacyProject('apply-deferred');
  fs.writeFileSync(path.join(dir, 'PROJECT_NOTES.md'), '# Notes\n\nMid-edit.\n');

  const result = migration.migrateProject(dir);

  assert.equal(result.status, 'deferred');
  assert.deepEqual(result.dirty, ['PROJECT_NOTES.md']);
  assert.match(fs.readFileSync(path.join(dir, 'PROJECT_NOTES.md'), 'utf8'), /Mid-edit/);
  assert.ok(fs.existsSync(path.join(dir, 'tasks.json')), 'a deferred run moved something anyway');
  assert.ok(!fs.existsSync(path.join(dir, FRAME_DIR, migration.BACKUP_DIR)), 'a deferred run wrote a backup');
});

test('a project already on the overlay layout is skipped', () => {
  const dir = path.join(root, 'apply-modern');
  fs.mkdirSync(path.join(dir, FRAME_DIR), { recursive: true });
  fs.writeFileSync(path.join(dir, FRAME_DIR, 'config.json'), '{"version":"1.0"}');

  assert.equal(migration.migrateProject(dir).status, 'skipped');
});

test('the config keeps everything but its files block', () => {
  const dir = makeLegacyProject('apply-config');
  migration.migrateProject(dir);

  const config = JSON.parse(fs.readFileSync(path.join(dir, FRAME_DIR, 'config.json'), 'utf8'));
  assert.ok(!('files' in config), 'the stale root-file manifest survived');
  assert.equal(config.version, '1.0');
  // `settings` gains the derived sharing mode — a recording of the posture the
  // project already had, not a new choice (D7).
  assert.equal(config.settings.gitSharing, 'local');
});

test('an interrupted run reconciles on the next pass', () => {
  const dir = makeLegacyProject('interrupted');
  // Stop after the backup and one artifact — the state a killed app leaves.
  migration.writeBackup(dir, ['tasks.json', 'STRUCTURE.json', 'PROJECT_NOTES.md', 'QUICKSTART.md', 'AGENTS.md']);
  fs.copyFileSync(path.join(dir, 'tasks.json'), path.join(dir, FRAME_DIR, 'tasks.json'));

  const result = migration.migrateProject(dir);

  assert.equal(result.status, 'migrated');
  // The duplicate left behind is reconciled as identical, not as a conflict.
  assert.equal(dispositionOf(result, 'tasks.json'), 'delete-identical');
  assert.ok(!fs.existsSync(path.join(dir, 'tasks.json')));
  assert.equal(fs.readFileSync(path.join(dir, FRAME_DIR, 'tasks.json'), 'utf8'), '{"tasks":[]}\n');
});

test('a second full run changes nothing — migration is not re-entrant damage', () => {
  const dir = makeLegacyProject('idempotent');
  migration.migrateProject(dir);
  const after = fs.readdirSync(path.join(dir, FRAME_DIR)).sort();
  const tasks = fs.readFileSync(path.join(dir, FRAME_DIR, 'tasks.json'), 'utf8');

  migration.migrateProject(dir);

  assert.deepEqual(fs.readdirSync(path.join(dir, FRAME_DIR)).sort(), after);
  assert.equal(fs.readFileSync(path.join(dir, FRAME_DIR, 'tasks.json'), 'utf8'), tasks);
});

test('the progress callback reports each artifact as it lands', () => {
  const dir = makeLegacyProject('progress');
  const seen = [];
  migration.migrateProject(dir, { onProgress: (a) => seen.push(a.rel) });

  assert.deepEqual(seen.sort(), ['AGENTS.md', 'PROJECT_NOTES.md', 'QUICKSTART.md', 'STRUCTURE.json', 'tasks.json']);
});

test('a failure aborts the run, keeps the backup, and reports the step it died at', () => {
  // Not a git repo: swapping the artifact below would otherwise read as an
  // uncommitted change and defer the run before it could fail.
  const dir = makeLegacyProject('failing', { git: false });
  const events = [];
  const sent = [];
  migration.init({ record: (name, fields) => events.push({ name, fields }), telemetry: (e, p) => sent.push({ e, p }) });

  // An unreadable artifact — the stand-in for the real causes: a locked file,
  // a permission the user does not have, a full disk.
  fs.unlinkSync(path.join(dir, 'tasks.json'));
  fs.mkdirSync(path.join(dir, 'tasks.json'));

  const result = migration.migrateProject(dir);
  migration.init({ record: () => {}, telemetry: () => {} });

  assert.equal(result.status, 'failed');
  assert.equal(result.step, 'backup');
  assert.equal(result.error.length > 0, true, 'the underlying error was swallowed');
  // Whatever it managed before dying stays in the backup: that is the sentence
  // the failure screen makes to the user.
  assert.ok(fs.existsSync(backupPath(dir, 'PROJECT_NOTES.md')), 'the failure took the backup with it');
  assert.ok(events.some((e) => e.name === 'migration.failed'), 'the failure went unrecorded');
  assert.deepEqual(sent.map((s) => s.e), ['migration_failed']);
  assert.equal(sent[0].p.step, 'backup');
  assert.equal(sent[0].p.artifacts, '4-6', 'the count reached telemetry unbucketed');
});

// ─── D6: what old init took, migration hands back ─────────────

/** An AGENTS.md as old init left it: the template plus what it consumed. */
function mergedAgents(blocks) {
  const merged = Object.entries(blocks)
    .map(([label, content]) => `## Existing Instructions (from ${label})\n\n${content}`)
    .join('\n\n---\n\n');
  return `# Frame\n\nGenerated instructions.\n\n---\n\n${merged}`;
}

test('a consumed CLAUDE.md is a real file again, with its original content', () => {
  const dir = makeLegacyProject('restore-claude', {
    agents: mergedAgents({ 'CLAUDE.md': 'Always run the linter.\n' })
  });

  const result = migration.migrateProject(dir);

  const restored = path.join(dir, 'CLAUDE.md');
  assert.ok(!fs.lstatSync(restored).isSymbolicLink(), 'CLAUDE.md is still a symlink');
  assert.match(fs.readFileSync(restored, 'utf8'), /Always run the linter\./);
  assert.ok(!fs.readFileSync(restored, 'utf8').includes('Generated instructions'), 'Frame content leaked back to the root');
  assert.deepEqual(result.restored.filter((r) => r.source === 'merge-block').map((r) => r.rel), ['CLAUDE.md']);
});

test('a project that never had one ends up with no root CLAUDE.md at all', () => {
  const dir = makeLegacyProject('restore-none');
  migration.migrateProject(dir);

  assert.ok(!fs.existsSync(path.join(dir, 'CLAUDE.md')), 'a CLAUDE.md the user never had was recreated');
  assert.ok(!fs.existsSync(path.join(dir, 'AGENTS.md')), 'the generated AGENTS.md survived at the root');
});

test('CLAUDE.md, GEMINI.md and AGENTS.md are each restored from their own block', () => {
  const dir = makeLegacyProject('restore-all', {
    agents: mergedAgents({
      'CLAUDE.md': 'Claude rules.\n',
      'AGENTS.md': 'Agent rules.\n',
      'GEMINI.md': 'Gemini rules.\n'
    }),
    symlinks: false
  });
  fs.symlinkSync('AGENTS.md', path.join(dir, 'CLAUDE.md'));
  fs.symlinkSync('AGENTS.md', path.join(dir, 'GEMINI.md'));

  migration.migrateProject(dir);

  assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), 'Claude rules.\n');
  assert.equal(fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8'), 'Gemini rules.\n');
  assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), 'Agent rules.\n');
});

test('a symlink with nothing behind it is simply removed', () => {
  const dir = makeLegacyProject('restore-symlink-only');
  const result = migration.migrateProject(dir);

  assert.ok(!fs.existsSync(path.join(dir, 'CLAUDE.md')));
  assert.deepEqual(result.restored, []);
});

test("a user's own file at the target is never overwritten", () => {
  const dir = makeLegacyProject('restore-occupied', {
    agents: mergedAgents({ 'GEMINI.md': 'What Frame took.\n' }),
  });
  fs.writeFileSync(path.join(dir, 'GEMINI.md'), 'What I wrote since.\n');

  const result = migration.migrateProject(dir);

  assert.equal(fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8'), 'What I wrote since.\n');
  assert.deepEqual(result.restored, [{ rel: 'GEMINI.md', source: 'backup-conflict' }]);
  assert.equal(
    fs.readFileSync(path.join(dir, FRAME_DIR, migration.BACKUP_DIR, 'restored', 'GEMINI.md'), 'utf8'),
    'What Frame took.\n'
  );
});

test('.claude/CLAUDE.md is left alone, and never recreated', () => {
  const dir = makeLegacyProject('restore-claude-dir', {
    agents: mergedAgents({ '.claude/CLAUDE.md': 'Subfolder rules.\n' })
  });
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'CLAUDE.md'), 'Subfolder rules.\n');

  migration.migrateProject(dir);

  assert.equal(fs.readFileSync(path.join(dir, '.claude', 'CLAUDE.md'), 'utf8'), 'Subfolder rules.\n');

  const absent = makeLegacyProject('restore-claude-dir-absent', {
    agents: mergedAgents({ '.claude/CLAUDE.md': 'Subfolder rules.\n' })
  });
  migration.migrateProject(absent);
  assert.ok(!fs.existsSync(path.join(absent, '.claude')), '.claude/ was conjured out of a merge block');
});

test('a restored file is the user\'s content, not a symlink target', () => {
  // Writing through the dangling symlink would recreate the root AGENTS.md
  // this migration exists to remove — so the link goes first.
  const dir = makeLegacyProject('restore-order', {
    agents: mergedAgents({ 'CLAUDE.md': 'Mine.\n' })
  });
  migration.migrateProject(dir);

  assert.ok(!fs.existsSync(path.join(dir, 'AGENTS.md')), 'a root AGENTS.md came back through the symlink');
});

test('a migrated project is no longer a legacy project', () => {
  const dir = makeLegacyProject('no-longer-legacy', {
    agents: mergedAgents({ 'CLAUDE.md': 'Mine.\n' })
  });
  migration.migrateProject(dir);

  assert.equal(migration.plan(dir).legacy, false, 'the project would migrate again on the next open');
  assert.equal(migration.migrateProject(dir).status, 'skipped');
});

// ─── D7: the posture the project already had ──────────────────

test('a project that committed .frame/ still shares it after migration', () => {
  const dir = makeLegacyProject('posture-repo', { trackFrame: true });

  migration.migrateProject(dir);

  const config = JSON.parse(fs.readFileSync(path.join(dir, FRAME_DIR, 'config.json'), 'utf8'));
  assert.equal(config.settings.gitSharing, 'repo');
  // The migrated meta files are visible to git — that is what sharing means.
  assert.match(git(dir, 'status', '--porcelain', '-uall'), new RegExp(`${FRAME_DIR}/tasks\\.json`));
});

test('a project that never committed .frame/ derives local and hides it', () => {
  const dir = makeLegacyProject('posture-local');
  migration.migrateProject(dir);

  const config = JSON.parse(fs.readFileSync(path.join(dir, FRAME_DIR, 'config.json'), 'utf8'));
  assert.equal(config.settings.gitSharing, 'local');
});

test('the backup is ignored the moment it is written', () => {
  const dir = makeLegacyProject('posture-backup', { trackFrame: true });

  migration.migrateProject(dir);

  const status = git(dir, 'status', '--porcelain', '-uall');
  assert.ok(!status.includes(migration.BACKUP_DIR), 'the backup showed up in git status');
});

test('a non-git project migrates without a posture', () => {
  const dir = makeLegacyProject('posture-none', { git: false });
  assert.equal(migration.migrateProject(dir).status, 'migrated');
});

// ─── D1a: the sweep ───────────────────────────────────────────

test('every registered project migrates in one pass', async () => {
  const dirs = ['sweep-a', 'sweep-b', 'sweep-c'].map((n) => makeLegacyProject(n));
  const results = await migration.sweep(dirs);

  assert.deepEqual(results.map((r) => r.status), ['migrated', 'migrated', 'migrated']);
  assert.deepEqual(results.map((r) => r.name), ['sweep-a', 'sweep-b', 'sweep-c']);
  for (const dir of dirs) {
    assert.ok(fs.existsSync(path.join(dir, FRAME_DIR, 'tasks.json')), `${dir} was not migrated`);
  }
});

test('one project failing does not stop the rest', async () => {
  const first = makeLegacyProject('sweep-fails', { git: false });
  fs.unlinkSync(path.join(first, 'tasks.json'));
  fs.mkdirSync(path.join(first, 'tasks.json'));
  const second = makeLegacyProject('sweep-survives');

  const results = await migration.sweep([first, second]);

  assert.equal(results[0].status, 'failed');
  assert.ok(results[0].error, 'the failure carries no error to report');
  assert.equal(results[1].status, 'migrated');
});

test('a registered project whose path is gone is skipped, not failed', async () => {
  const alive = makeLegacyProject('sweep-alive');
  const results = await migration.sweep([path.join(root, 'deleted-last-week'), alive]);

  assert.equal(results[0].status, 'skipped');
  assert.equal(results[0].reason, 'missing-path');
  assert.equal(results[1].status, 'migrated');
});

test('a mixed workspace reports each project on its own terms', async () => {
  const clean = makeLegacyProject('sweep-clean');
  const deferred = makeLegacyProject('sweep-deferred');
  fs.writeFileSync(path.join(deferred, 'PROJECT_NOTES.md'), '# Notes\n\nMid-edit.\n');
  const modern = path.join(root, 'sweep-modern');
  fs.mkdirSync(path.join(modern, FRAME_DIR), { recursive: true });
  fs.writeFileSync(path.join(modern, FRAME_DIR, 'config.json'), '{"version":"1.0"}');

  const results = await migration.sweep([clean, deferred, modern]);

  assert.deepEqual(results.map((r) => r.status), ['migrated', 'deferred', 'skipped']);
  assert.deepEqual(results[1].dirty, ['PROJECT_NOTES.md']);
  assert.ok(fs.existsSync(path.join(deferred, 'PROJECT_NOTES.md')), 'a deferred project was migrated anyway');
});

test('the receipt learns how many removed artifacts were tracked', async () => {
  const dir = makeLegacyProject('sweep-tracked');
  const [result] = await migration.sweep([dir]);

  assert.equal(result.tracked, 6, 'five meta files plus the CLAUDE.md symlink were committed');
});

test('an empty registry sweeps to an empty result', async () => {
  assert.deepEqual(await migration.sweep([]), []);
  assert.deepEqual(await migration.sweep(undefined), []);
});

test('a project already in flight is not migrated a second time', () => {
  const dir = makeLegacyProject('reentrant');
  let reentered = null;

  // Selecting the project while the sweep has it open reaches the engine
  // again; the guard is what keeps that from being a second migration.
  migration.migrateProject(dir, {
    onProgress: () => {
      if (!reentered) reentered = migration.migrateProject(dir);
    }
  });

  assert.equal(reentered.status, 'skipped');
  assert.equal(reentered.reason, 'in-flight');
  assert.ok(fs.existsSync(path.join(dir, FRAME_DIR, 'tasks.json')), 'the first migration was disturbed');
});

test('plan writes nothing at all', () => {
  const dir = makeLegacyProject('read-only', { commit: false });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'baseline');

  migration.plan(dir);

  assert.equal(git(dir, 'status', '--porcelain', '-uall').trim(), '', 'plan() touched the working tree');
  assert.ok(!fs.existsSync(path.join(dir, FRAME_DIR, migration.BACKUP_DIR)), 'plan() created the backup dir');
});

// ─── the staged scripts ───────────────────────────────────────
//
// `.frame/bin/` and `.git/hooks/pre-commit` are written at init and never
// again, so a project reaching migration is still running the generation that
// initialized it — one that resolves the meta files at the root migration is
// about to empty. Refreshing them is part of the move, not a follow-up.

/** Give a legacy project the stale parser and hook an old init left behind. */
function stagePreOverlayTooling(dir) {
  const binDir = path.join(dir, FRAME_DIR, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    path.join(binDir, 'update-structure.js'),
    "const STRUCTURE_FILE = path.join(ROOT_DIR, 'STRUCTURE.json');\n"
  );
  fs.mkdirSync(path.join(dir, '.git', 'hooks'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.git', 'hooks', 'pre-commit'),
    `#!/bin/sh\n${templates.FRAME_HOOK_MARKER_START}\n`
      + `if [ -f "$FRAME_ROOT/STRUCTURE.json" ]; then\n`
      + `  git add "$FRAME_ROOT/STRUCTURE.json" || true\n`
      + `fi\n${templates.FRAME_HOOK_MARKER_END}\nexit 0\n`,
    { mode: 0o755 }
  );
}

test('migration refreshes the parser and the hook it is about to invalidate', () => {
  const dir = makeLegacyProject('tooling');
  stagePreOverlayTooling(dir);

  const result = migration.migrateProject(dir);
  assert.equal(result.status, 'migrated');

  const parser = fs.readFileSync(path.join(dir, FRAME_DIR, 'bin', 'update-structure.js'), 'utf8');
  assert.ok(parser.includes('resolveMetaPath'), 'the parser would rebuild STRUCTURE.json at the root');

  const hook = fs.readFileSync(path.join(dir, '.git', 'hooks', 'pre-commit'), 'utf8');
  assert.ok(hook.includes('.frame/STRUCTURE.json'), 'the hook would stage a root map that should not exist');
});

test('the refresh happens before the move, so a half-finished run still leaves it done', () => {
  // The shipped parser reads either layout, so refreshing first is safe and
  // covers the window a mid-move failure would otherwise leave open.
  const dir = makeLegacyProject('ordering');
  stagePreOverlayTooling(dir);

  const seen = [];
  migration.migrateProject(dir, { onProgress: (a) => seen.push(a.rel) });

  assert.ok(seen.length > 0, 'no artifact moved, so the ordering claim is untested');
  const parser = fs.readFileSync(path.join(dir, FRAME_DIR, 'bin', 'update-structure.js'), 'utf8');
  assert.ok(parser.includes('resolveMetaPath'));
});

test('a project with neither a hook nor a bin still migrates', () => {
  const dir = makeLegacyProject('bare');
  const result = migration.migrateProject(dir);

  assert.equal(result.status, 'migrated');
  assert.equal(fs.existsSync(path.join(dir, FRAME_DIR, 'bin')), false, 'planted machinery the project never had');
});
