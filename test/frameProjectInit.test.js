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
    assert.match(command, /^sh -c '\[ ! -f \.frame\/bin\/spec-hint\.js \] \|\| exec node \.frame\/bin\/spec-hint\.js (pre-edit|prompt)'$/);
  }
  assert.ok(!fs.existsSync(path.join(projectDir, '.claude', 'settings.local.json')));
});

test('the hook guard exits 0 when .frame/bin/spec-hint.js is absent', async () => {
  const { execFileSync } = require('child_process');
  await frameProject.runProjectInit(projectDir, 'demo');

  const settings = JSON.parse(fs.readFileSync(path.join(projectDir, '.claude', 'settings.json'), 'utf8'));
  const commands = Object.values(settings.hooks).flat().flatMap((e) => e.hooks.map((h) => h.command));
  // A project whose .frame/bin was never staged (sharing mode local on a
  // teammate's clone) must not report a failing hook on every prompt.
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-nohint-'));
  try {
    for (const command of commands) {
      execFileSync('sh', ['-c', command], { cwd: emptyDir, stdio: 'ignore' });
    }
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});

test('a settings file Frame writes into keeps its own indentation', async () => {
  const settingsDir = path.join(projectDir, '.claude');
  fs.mkdirSync(settingsDir, { recursive: true });
  const settingsPath = path.join(settingsDir, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({ permissions: { allow: ['Bash(npm test)'] } }, null, 4) + '\n', 'utf8');

  await frameProject.runProjectInit(projectDir, 'demo');

  const text = fs.readFileSync(settingsPath, 'utf8');
  assert.match(text, /^ {4}"permissions": \{$/m, 'four-space indentation preserved');
  assert.ok(!/^ {2}"permissions"/m.test(text), 'not reflowed to Frame\'s two spaces');
  assert.equal(Object.values(JSON.parse(text).hooks).flat().length, 2, 'and the hooks did land');
});

test('a project already wired to spec-hint.js by hand keeps its own hooks', async () => {
  const settingsDir = path.join(projectDir, '.claude');
  fs.mkdirSync(settingsDir, { recursive: true });
  const settingsPath = path.join(settingsDir, 'settings.json');
  const own = {
    hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node scripts/spec-hint.js prompt' }] }] }
  };
  fs.writeFileSync(settingsPath, JSON.stringify(own, null, 2) + '\n', 'utf8');

  const summary = frameProject.installSpecHintHook(projectDir, { file: 'settings.json' });
  assert.equal(summary.installed, false);
  assert.equal(summary.existing, true);
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), JSON.stringify(own, null, 2) + '\n', 'file untouched');

  // And a full init makes the same call, so nothing is added there either.
  await frameProject.runProjectInit(projectDir, 'demo');
  const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.equal(Object.values(after.hooks).flat().length, 1, 'still just the user\'s entry');
});

test('local sharing puts the hook entries in settings.local.json instead', async () => {
  await frameProject.runProjectInit(projectDir, 'demo', { gitSharing: 'local' });

  assert.ok(fs.existsSync(path.join(projectDir, '.claude', 'settings.local.json')));
  assert.ok(!fs.existsSync(path.join(projectDir, '.claude', 'settings.json')));
  assert.equal(frameStore.readConfig(projectDir).settings.gitSharing, 'local');
});

test('init applies the sharing mode: .frame/.gitignore always, the exclude block only under local', async () => {
  const { execFileSync } = require('child_process');
  execFileSync('git', ['init', '-q'], { cwd: projectDir });
  const gitExclude = require('../src/main/gitExclude');

  await frameProject.runProjectInit(projectDir, 'demo');

  const ignoreFile = path.join(projectDir, FRAME_DIR, '.gitignore');
  assert.ok(fs.existsSync(ignoreFile), 'repo mode still writes the managed .frame/.gitignore');
  const ignored = fs.readFileSync(ignoreFile, 'utf8');
  assert.match(ignored, /^runtime\/$/m);
  assert.equal(gitExclude.hasBlock(projectDir), false, 'nothing is excluded under repo sharing');

  await frameProject.runProjectInit(projectDir, 'demo', { gitSharing: 'local' });

  assert.ok(fs.existsSync(ignoreFile), 'and under local sharing');
  assert.ok(gitExclude.hasBlock(projectDir), 'local sharing excludes Frame\'s paths');
  const exclude = fs.readFileSync(gitExclude.excludeFilePath(projectDir), 'utf8');
  assert.match(exclude, /^\/\.frame\/$/m);
  assert.match(exclude, /^\/\.claude\/rules\/frame\.md$/m);
  assert.match(exclude, /^\/\.claude\/settings\.local\.json$/m);
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

test('Remove Frame leaves no Frame-authored bytes and no user file changed', async () => {
  const { execFileSync } = require('child_process');
  execFileSync('git', ['init', '-q'], { cwd: projectDir });

  const before = {};
  for (const rel of Object.keys(USER_FILES)) {
    before[rel] = hashFile(path.join(projectDir, ...rel.split('/')));
  }

  await frameProject.runProjectInit(projectDir, 'demo', { gitSharing: 'local' });
  assert.ok(fs.existsSync(path.join(projectDir, FRAME_DIR)), 'init wrote .frame/');

  const result = frameProject.removeFrame(projectDir);
  assert.deepEqual(result.errors, []);

  assert.ok(!fs.existsSync(path.join(projectDir, FRAME_DIR)), '.frame/ is gone');
  assert.ok(!fs.existsSync(path.join(projectDir, ...CLAUDE_RULE_PATH.split('/'))), 'pointer is gone');
  for (const file of ['settings.json', 'settings.local.json']) {
    const settingsPath = path.join(projectDir, '.claude', file);
    if (!fs.existsSync(settingsPath)) continue;
    const text = fs.readFileSync(settingsPath, 'utf8');
    assert.ok(!text.includes('spec-hint.js'), `${file} carries no Frame hook`);
  }
  const excludePath = path.join(projectDir, '.git', 'info', 'exclude');
  if (fs.existsSync(excludePath)) {
    assert.ok(!fs.readFileSync(excludePath, 'utf8').includes('.frame'), 'exclude block removed');
  }
  const hookPath = path.join(projectDir, '.git', 'hooks', 'pre-commit');
  if (fs.existsSync(hookPath)) {
    assert.ok(!fs.readFileSync(hookPath, 'utf8').includes('frame:structure'), 'hook block removed');
  }

  for (const rel of Object.keys(USER_FILES)) {
    const file = path.join(projectDir, ...rel.split('/'));
    assert.equal(hashFile(file), before[rel], `${rel} is untouched`);
  }
});

test('Remove Frame keeps hooks and pre-commit content the user wrote', async () => {
  const settingsDir = path.join(projectDir, '.claude');
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.writeFileSync(path.join(settingsDir, 'settings.json'), JSON.stringify({
    permissions: { allow: ['Bash(npm test)'] },
    hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node my-own-hook.js' }] }] }
  }, null, 2), 'utf8');

  const hookDir = path.join(projectDir, '.git', 'hooks');
  fs.mkdirSync(hookDir, { recursive: true });
  fs.writeFileSync(path.join(hookDir, 'pre-commit'), '#!/bin/sh\nnpm run lint\n', 'utf8');

  await frameProject.runProjectInit(projectDir, 'demo');
  frameProject.removeFrame(projectDir);

  const settings = JSON.parse(fs.readFileSync(path.join(settingsDir, 'settings.json'), 'utf8'));
  assert.deepEqual(settings.permissions.allow, ['Bash(npm test)']);
  assert.equal(settings.hooks.UserPromptSubmit[0].hooks[0].command, 'node my-own-hook.js');
  assert.equal(fs.readFileSync(path.join(hookDir, 'pre-commit'), 'utf8'), '#!/bin/sh\nnpm run lint\n');
});

test('a husky project keeps its own pre-commit file byte-for-byte', async () => {
  // Spec D10: Frame writes one hook file, and only where there is none.
  // `.husky/pre-commit` is the user's, usually committed, often generated.
  const { execFileSync } = require('child_process');
  execFileSync('git', ['init', '-q'], { cwd: projectDir });
  execFileSync('git', ['config', 'core.hooksPath', '.husky'], { cwd: projectDir });

  const huskyHook = path.join(projectDir, '.husky', 'pre-commit');
  const before = hashFile(huskyHook);

  const config = await frameProject.runProjectInit(projectDir, 'demo');

  assert.equal(hashFile(huskyHook), before, '.husky/pre-commit is untouched');
  assert.equal(fs.readFileSync(huskyHook, 'utf8'), USER_FILES['.husky/pre-commit']);
  assert.ok(!fs.existsSync(path.join(projectDir, '.git', 'hooks', 'pre-commit')), 'and no second hook was written');

  const hook = config._structureBootstrap && config._structureBootstrap.hook;
  assert.equal(hook.status, 'skipped-husky');
  assert.match(hook.manualInstructions, /frame:structure \(managed\)/, 'the snippet is handed over as text');
});

test('Remove Frame takes the hook file and an empty settings file with it', async () => {
  const { execFileSync } = require('child_process');
  execFileSync('git', ['init', '-q'], { cwd: projectDir });
  fs.rmSync(path.join(projectDir, '.husky'), { recursive: true, force: true }); // vanilla hook path

  await frameProject.runProjectInit(projectDir, 'demo');
  const hookPath = path.join(projectDir, '.git', 'hooks', 'pre-commit');
  assert.ok(fs.existsSync(hookPath), 'init wrote the vanilla hook');
  assert.ok(fs.existsSync(path.join(projectDir, '.claude', 'settings.json')), 'and the settings file');

  frameProject.removeFrame(projectDir);

  assert.ok(!fs.existsSync(hookPath), 'the hook file Frame created is gone, header and all');
  assert.ok(!fs.existsSync(path.join(projectDir, '.claude', 'settings.json')), 'no {} settings file left behind');
  // The user's own .claude/CLAUDE.md is still there, so the directory stays.
  assert.ok(fs.existsSync(path.join(projectDir, '.claude', 'CLAUDE.md')));
});
