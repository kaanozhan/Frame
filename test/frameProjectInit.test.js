/**
 * Init footprint tests (non-invasive-overlay T04+).
 *
 * The promise this spec makes is measurable: after an init, the only things
 * that changed in a project are `.frame/`, `.claude/rules/frame.md`, the
 * Claude settings file and `.git/` internals. Every file the user owns —
 * CLAUDE.md, .claude/CLAUDE.md, AGENTS.md, .cursorrules, .husky/pre-commit —
 * is byte-identical afterwards, because Frame no longer reads, consumes or
 * replaces anything at the project root.
 *
 * Electron and the telemetry package are stubbed (the specTasksSync pattern):
 * CI runs this suite with no node_modules.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

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
const aiToolManager = require('../src/main/aiToolManager');
const { FRAME_DIR, FRAME_FILES, CLAUDE_RULE_PATH } = require('../src/shared/frameConstants');

// The hook install is gated on Claude Code being the active tool; the test
// asserts the hook entries, so pin it rather than depending on user settings.
aiToolManager.getActiveTool = () => ({ id: 'claude', name: 'Claude Code' });

let projectDir;

/** Files a user might already have. None of them are Frame's to touch. */
const USER_FILES = {
  'CLAUDE.md': '# House rules\n\nIndent with tabs.\n',
  '.claude/CLAUDE.md': '# Subfolder rules\n\nNever force-push.\n',
  'AGENTS.md': '# Our own agents file\n\nRun the linter first.\n',
  '.cursorrules': 'always write tests\n',
  '.husky/pre-commit': '#!/bin/sh\nnpm run lint\n',
  'src/app.js': '/** App — entry point. */\nmodule.exports = {};\n'
};

function writeUserFiles(dir) {
  for (const [rel, content] of Object.entries(USER_FILES)) {
    const target = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Every file in the tree → sha256, excluding paths Frame is allowed to own. */
function snapshotTree(dir, { excludeFrameOwned = true } = {}) {
  const snapshot = {};
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const rel = path.relative(dir, full).split(path.sep).join('/');
      if (rel === '.git' || rel.startsWith('.git/')) continue;
      if (excludeFrameOwned) {
        if (rel === FRAME_DIR || rel.startsWith(`${FRAME_DIR}/`)) continue;
        if (rel === CLAUDE_RULE_PATH || rel === '.claude/rules') continue;
        if (rel === '.claude/settings.json' || rel === '.claude/settings.local.json') continue;
      }
      if (entry.isDirectory()) walk(full);
      else snapshot[rel] = hashFile(full);
    }
  };
  walk(dir);
  return snapshot;
}

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-init-'));
  writeUserFiles(projectDir);
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('init writes only .frame/, the pointer and the Claude settings file', async () => {
  const before = snapshotTree(projectDir);
  await frameProject.runProjectInit(projectDir, 'demo');
  const after = snapshotTree(projectDir);

  assert.deepEqual(after, before, 'no file outside Frame\'s own paths changed or appeared');
});

test('every user file is byte-identical after init', async () => {
  const before = {};
  for (const rel of Object.keys(USER_FILES)) {
    before[rel] = hashFile(path.join(projectDir, ...rel.split('/')));
  }

  await frameProject.runProjectInit(projectDir, 'demo');

  for (const rel of Object.keys(USER_FILES)) {
    const file = path.join(projectDir, ...rel.split('/'));
    assert.ok(fs.existsSync(file), `${rel} still exists`);
    assert.equal(hashFile(file), before[rel], `${rel} is byte-identical`);
    assert.ok(!fs.lstatSync(file).isSymbolicLink(), `${rel} was not replaced by a symlink`);
  }
});

test('the meta files land under .frame/, never at the project root', async () => {
  await frameProject.runProjectInit(projectDir, 'demo');

  for (const name of [FRAME_FILES.AGENTS, FRAME_FILES.STRUCTURE, FRAME_FILES.NOTES, FRAME_FILES.TASKS, FRAME_FILES.QUICKSTART]) {
    assert.ok(fs.existsSync(path.join(projectDir, FRAME_DIR, name)), `.frame/${name} written`);
  }
  // AGENTS.md at the root is the user's file from the fixture — untouched,
  // and definitely not Frame's template.
  assert.equal(fs.readFileSync(path.join(projectDir, 'AGENTS.md'), 'utf8'), USER_FILES['AGENTS.md']);
  assert.ok(!fs.existsSync(path.join(projectDir, FRAME_FILES.STRUCTURE)), 'no root STRUCTURE.json');
  assert.ok(!fs.existsSync(path.join(projectDir, FRAME_FILES.TASKS)), 'no root tasks.json');
  assert.ok(!fs.existsSync(path.join(projectDir, 'GEMINI.md')), 'no GEMINI.md, ever again');
});

test('the pointer file is what reaches Claude Code', async () => {
  await frameProject.runProjectInit(projectDir, 'demo');

  const rule = fs.readFileSync(path.join(projectDir, ...CLAUDE_RULE_PATH.split('/')), 'utf8');
  assert.match(rule, /Written by Frame/);
  assert.match(rule, /@\.\.\/\.\.\/\.frame\/AGENTS\.md/);
});

test('hook entries are guarded and land in settings.json under repo sharing', async () => {
  await frameProject.runProjectInit(projectDir, 'demo');

  const settings = JSON.parse(fs.readFileSync(path.join(projectDir, '.claude', 'settings.json'), 'utf8'));
  const commands = Object.values(settings.hooks).flat().flatMap((e) => e.hooks.map((h) => h.command));
  assert.equal(commands.length, 2);
  for (const command of commands) {
    assert.match(command, /^sh -c '\[ -f \.frame\/bin\/spec-hint\.js \] && exec node \.frame\/bin\/spec-hint\.js (pre-edit|prompt)'$/);
  }
  assert.ok(!fs.existsSync(path.join(projectDir, '.claude', 'settings.local.json')));
});

test('local sharing puts the hook entries in settings.local.json instead', async () => {
  await frameProject.runProjectInit(projectDir, 'demo', { gitSharing: 'local' });

  assert.ok(fs.existsSync(path.join(projectDir, '.claude', 'settings.local.json')));
  assert.ok(!fs.existsSync(path.join(projectDir, '.claude', 'settings.json')));
  assert.equal(frameStore.readConfig(projectDir).settings.gitSharing, 'local');
});

test('config carries a projectId and no files record', async () => {
  await frameProject.runProjectInit(projectDir, 'demo');

  const config = frameStore.readConfig(projectDir);
  assert.match(config.projectId, /^[0-9a-f-]{36}$/);
  assert.equal(config.files, undefined, 'the files record is the legacy fingerprint — never written again');
  assert.equal(config.settings.gitSharing, 'repo');
  assert.equal(frameStore.isLegacyLayout(projectDir), false);
});

test('re-init is idempotent: same identity, no duplicate hook entries', async () => {
  await frameProject.runProjectInit(projectDir, 'demo');
  const firstId = frameStore.getProjectId(projectDir);
  const agents = fs.readFileSync(path.join(projectDir, FRAME_DIR, FRAME_FILES.AGENTS), 'utf8');
  const userSnapshot = snapshotTree(projectDir);

  await frameProject.runProjectInit(projectDir, 'demo');

  assert.equal(frameStore.getProjectId(projectDir), firstId, 'identity survives re-init');
  assert.equal(fs.readFileSync(path.join(projectDir, FRAME_DIR, FRAME_FILES.AGENTS), 'utf8'), agents);
  assert.deepEqual(snapshotTree(projectDir), userSnapshot, 'still nothing outside Frame\'s paths');

  const settings = JSON.parse(fs.readFileSync(path.join(projectDir, '.claude', 'settings.json'), 'utf8'));
  assert.equal(Object.values(settings.hooks).flat().length, 2, 'hook entries not duplicated');
});

test('a project that was never initialized gets nothing written to it', () => {
  // The launch path only reads: a non-Frame project must survive being opened
  // and having an agent started in it without gaining a single Frame byte.
  const before = snapshotTree(projectDir, { excludeFrameOwned: false });

  assert.equal(frameProject.isFrameProject(projectDir), false);
  assert.equal(frameProject.getFrameConfig(projectDir), null);
  assert.equal(frameStore.getTasks(projectDir).data, null);
  assert.equal(frameStore.readAgents(projectDir), null);
  assert.equal(frameStore.ensureProjectId(projectDir), null);
  frameProject.upgradeSpecDocs(projectDir);

  assert.deepEqual(snapshotTree(projectDir, { excludeFrameOwned: false }), before);
  assert.ok(!fs.existsSync(path.join(projectDir, FRAME_DIR)));
});

test('the sample project ships the new layout with no legacy fingerprint', () => {
  const sampleDir = path.join(__dirname, '..', 'src', 'templates', 'sample-project');
  const config = JSON.parse(fs.readFileSync(path.join(sampleDir, FRAME_DIR, 'config.json'), 'utf8'));

  assert.equal(config.files, undefined, 'no files record — the sample never triggers the migration modal');
  assert.match(config.projectId, /^[0-9a-f-]{36}$/);
  assert.equal(config.settings.gitSharing, 'repo');

  // The sample ships four of the five (it never carried a QUICKSTART), and
  // none of them may sit at its root.
  for (const name of [FRAME_FILES.AGENTS, FRAME_FILES.STRUCTURE, FRAME_FILES.NOTES, FRAME_FILES.TASKS]) {
    assert.ok(fs.existsSync(path.join(sampleDir, FRAME_DIR, name)), `.frame/${name} present`);
  }
  for (const name of Object.values(FRAME_FILES)) {
    assert.ok(!fs.existsSync(path.join(sampleDir, name)), `${name} not at the sample's root`);
  }
  assert.ok(fs.existsSync(path.join(sampleDir, ...CLAUDE_RULE_PATH.split('/'))), 'pointer present');
  assert.ok(!fs.existsSync(path.join(sampleDir, 'CLAUDE.md')), 'no CLAUDE.md');
  assert.ok(!fs.existsSync(path.join(sampleDir, 'GEMINI.md')), 'no GEMINI.md');
});
