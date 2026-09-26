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

test('the rule file is an inline copy of .frame/AGENTS.md', async () => {
  // Not an @-import: Claude Code does not expand one that resolves above the
  // session's working directory, so a session started in a sub-directory got
  // nothing. The copy is what reaches every session.
  await frameProject.runProjectInit(projectDir, 'demo');

  const rulePath = path.join(projectDir, ...CLAUDE_RULE_PATH.split('/'));
  const rule = fs.readFileSync(rulePath, 'utf8');
  const agents = fs.readFileSync(path.join(projectDir, FRAME_DIR, FRAME_FILES.AGENTS), 'utf8');

  assert.match(rule, /^<!-- Generated by Frame from \.frame\/AGENTS\.md/, 'says where it came from');
  assert.ok(!rule.includes('@../../.frame/AGENTS.md'), 'no import to expand');
  assert.ok(rule.includes(agents.trim()), 'the whole of AGENTS.md is in it');

  // Idempotent, and re-synced when AGENTS.md changes.
  assert.equal(frameProject.syncClaudeRule(projectDir), false, 'nothing to write the second time');
  fs.writeFileSync(path.join(projectDir, FRAME_DIR, FRAME_FILES.AGENTS), agents + '\nCodeword: quixotry.\n', 'utf8');
  assert.equal(frameProject.syncClaudeRule(projectDir), true, 'a changed AGENTS.md rewrites the copy');
  assert.match(fs.readFileSync(rulePath, 'utf8'), /Codeword: quixotry\./);
});

test('hook entries are guarded and land in settings.json under repo sharing', async () => {
  await frameProject.runProjectInit(projectDir, 'demo');

  const settings = JSON.parse(fs.readFileSync(path.join(projectDir, '.claude', 'settings.json'), 'utf8'));
  const commands = Object.values(settings.hooks).flat().flatMap((e) => e.hooks.map((h) => h.command));
  assert.equal(commands.length, 6); // spec-hint x2, module-hint, docs-hint x2, spec-command-hint
  for (const command of commands) {
    // The backreference is the point: the file the guard tests must be the
    // file the guard execs, so a new hook cannot be registered half-wired.
    assert.match(command, /^sh -c '\[ ! -f \.frame\/bin\/(spec|module|docs|spec-command)-hint\.js \] \|\| exec node \.frame\/bin\/\1-hint\.js (pre-edit|prompt|search|session-start)'$/);
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
  assert.equal(Object.values(JSON.parse(text).hooks).flat().length, 6, 'and the hooks did land');
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

test('Frame\'s own older hook command is upgraded in place, not left behind', async () => {
  // The guard Frame shipped first was `[ -f … ] && exec …`, which exits 1 when
  // `.frame/bin` is not there — a reported hook failure on every prompt. The
  // install used to treat it as somebody else's hook and bail, so a project
  // wired in that window never got the fix.
  const { execFileSync } = require('child_process');
  const templates = require('../src/shared/frameTemplates');
  const settingsDir = path.join(projectDir, '.claude');
  fs.mkdirSync(settingsDir, { recursive: true });
  const settingsPath = path.join(settingsDir, 'settings.json');
  const legacy = templates.LEGACY_SPEC_HINT_COMMANDS.find((c) => c.includes('&& exec') && c.endsWith("prompt'"));
  fs.writeFileSync(settingsPath, JSON.stringify({
    hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: legacy }] }] },
    permissions: { allow: ['Bash(npm test)'] }
  }, null, 2) + '\n', 'utf8');

  const summary = frameProject.installSpecHintHook(projectDir, { file: 'settings.json' });
  assert.equal(summary.installed, true);
  assert.equal(summary.upgraded, 1, 'the old entry was taken out');

  const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const commands = Object.values(after.hooks).flat().flatMap((e) => e.hooks.map((h) => h.command));
  assert.equal(commands.length, 6, 'today\'s six entries, and no duplicate of the old one');
  assert.ok(commands.every((c) => c.includes('! -f')), 'all on the exit-0 guard');
  assert.deepEqual(after.permissions, { allow: ['Bash(npm test)'] }, 'the rest of the file survives');

  // The upgraded hook is the whole point: it must exit 0 with no .frame/bin.
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-nohook-'));
  for (const command of commands) {
    assert.equal(execFileSync('sh', ['-c', `${command}; echo $?`], { cwd: bare }).toString().trim(), '0');
  }
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
  assert.equal(Object.values(settings.hooks).flat().length, 6, 'hook entries not duplicated');
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

test('Remove Frame strips a hand-pasted husky block but keeps the user\'s file', async () => {
  // The husky snippet is handed over as text for the user to paste into their
  // own — usually committed — hook. Removing Frame takes its block back out;
  // deleting the file because only a shebang is left would delete theirs.
  const { execFileSync } = require('child_process');
  const templates = require('../src/shared/frameTemplates');
  execFileSync('git', ['init', '-q'], { cwd: projectDir });
  execFileSync('git', ['config', 'core.hooksPath', '.husky'], { cwd: projectDir });

  await frameProject.runProjectInit(projectDir, 'demo');

  const huskyHook = path.join(projectDir, '.husky', 'pre-commit');
  fs.writeFileSync(huskyHook, `#!/usr/bin/env sh\n\n${templates.getStructureHookSnippet()}\n`, 'utf8');

  frameProject.removeFrame(projectDir);

  assert.ok(fs.existsSync(huskyHook), 'the user\'s hook file survives');
  const left = fs.readFileSync(huskyHook, 'utf8');
  assert.ok(!left.includes('frame:structure'), 'and Frame\'s block is out of it');
  assert.match(left, /^#!\/usr\/bin\/env sh/, 'their shebang is still theirs');
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

/* ------------------- STR-01: initial generation and re-init ------------------- */

const { spawnSync } = require('child_process');
const structureBootstrap = require('../src/main/structureBootstrap');

const mapPath = (dir) => path.join(dir, FRAME_DIR, 'STRUCTURE.json');
const readMap = (dir) => JSON.parse(fs.readFileSync(mapPath(dir), 'utf8'));
const scanRecord = (dir) => path.join(dir, FRAME_DIR, 'runtime', 'structure', 'scan.json');

test('a truly empty project gets a completed empty map, not a template', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-init-empty-'));
  try {
    const result = await frameProject.runProjectInit(empty, 'empty');
    const scan = result._structureBootstrap.initialScan;
    assert.equal(scan.status, 'ok', scan.message);
    assert.equal(scan.empty, true);
    const map = readMap(empty);
    assert.deepEqual(map.modules, {});
    assert.equal(map.generation.inventory.coverage, 'complete');
    assert.notEqual(map.generation.state, 'pending');
    assert.equal(JSON.parse(fs.readFileSync(scanRecord(empty), 'utf8')).state, 'complete');
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('an imported project with mixed roots and unsupported languages is fully inventoried', async () => {
  const extra = {
    'index.js': '// Root entry\n',
    'lib/util.py': '"""Utilities."""\n',
    'app/models/user.rb': 'class User; end\n',
    'docs/guide.md': '# Guide\n'
  };
  for (const [rel, content] of Object.entries(extra)) {
    fs.mkdirSync(path.dirname(path.join(projectDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(projectDir, rel), content);
  }
  const result = await frameProject.runProjectInit(projectDir, 'demo');
  assert.equal(result._structureBootstrap.initialScan.status, 'ok', result._structureBootstrap.initialScan.message);
  const files = Object.values(readMap(projectDir).modules).map((m) => m.file).sort();
  for (const rel of [...Object.keys(extra), 'src/app.js', 'AGENTS.md', 'CLAUDE.md', '.husky/pre-commit']) {
    assert.ok(files.includes(rel), `${rel} in ${files}`);
  }
  assert.ok(!files.includes(CLAUDE_RULE_PATH), 'Frame\'s generated rule file is not project content');
  assert.ok(!files.some((f) => f.startsWith('.frame/')));
});

test('re-init keeps the existing configuration; only explicit options and detector facts change', async () => {
  await frameProject.runProjectInit(projectDir, 'demo');
  const configFile = path.join(projectDir, FRAME_DIR, 'config.json');
  const original = frameStore.readConfig(projectDir);
  const customized = {
    ...original,
    createdAt: '2020-01-01T00:00:00.000Z',
    settings: { ...original.settings, autoUpdateNotes: true, gitSharing: 'local' },
    features: { ...original.features, specDriven: false, experimentalThing: true },
    custom: { keep: 'me' },
    project: {
      ...original.project,
      languages: ['cobol'],
      ipcChannelsFile: 'src/shared/ipc.js',
      structure: { exclude: ['generated/'], limits: { maxFiles: 1234 } }
    }
  };
  fs.writeFileSync(configFile, JSON.stringify(customized, null, 2));

  await frameProject.runProjectInit(projectDir, 'demo');
  const after = frameStore.readConfig(projectDir);
  assert.equal(after.projectId, original.projectId);
  assert.equal(after.createdAt, '2020-01-01T00:00:00.000Z');
  assert.equal(after.settings.autoUpdateNotes, true);
  assert.equal(after.settings.gitSharing, 'local', 'the previous sharing mode is kept');
  assert.equal(after.features.specDriven, false);
  assert.equal(after.features.experimentalThing, true);
  assert.deepEqual(after.custom, { keep: 'me' });
  assert.equal(after.project.ipcChannelsFile, 'src/shared/ipc.js');
  assert.deepEqual(after.project.structure, { exclude: ['generated/'], limits: { maxFiles: 1234 } });
  const detected = require('../scripts/detect-project').detectProject(projectDir);
  assert.deepEqual(after.project.languages, detected.languages, 'detector-owned facts are refreshed');
  assert.notDeepEqual(after.project.languages, ['cobol']);

  await frameProject.runProjectInit(projectDir, 'demo', { gitSharing: 'repo' });
  assert.equal(frameStore.readConfig(projectDir).settings.gitSharing, 'repo', 'an explicit option replaces its value');
});

test('re-init preserves an existing map untouched and reports it as skipped and unverified', async () => {
  await frameProject.runProjectInit(projectDir, 'demo');
  const map = fs.readFileSync(mapPath(projectDir), 'utf8');
  const record = fs.readFileSync(scanRecord(projectDir), 'utf8');
  fs.writeFileSync(path.join(projectDir, 'src', 'late.js'), '// Late\n');

  const result = await frameProject.runProjectInit(projectDir, 'demo');
  const scan = result._structureBootstrap.initialScan;
  assert.equal(scan.status, 'skipped-existing');
  assert.equal(scan.verified, false);
  assert.equal(scan.repairCommand, 'node .frame/bin/update-structure.js --full');
  assert.equal(fs.readFileSync(mapPath(projectDir), 'utf8'), map, 'no silent rebuild');
  assert.equal(fs.readFileSync(scanRecord(projectDir), 'utf8'), record);
});

test('the documented repair command rebuilds the map and keeps hand-written prose', async () => {
  await frameProject.runProjectInit(projectDir, 'demo');
  const edited = readMap(projectDir);
  edited.modules.app.description = 'Hand-written: the composition root';
  edited.architectureNotes = { boot: 'why startup is ordered this way' };
  fs.writeFileSync(mapPath(projectDir), JSON.stringify(edited, null, 2));
  fs.writeFileSync(path.join(projectDir, 'src', 'late.js'), '// Late\n');

  const run = spawnSync('node', ['.frame/bin/update-structure.js', '--full'], { cwd: projectDir, encoding: 'utf8', env: { ...process.env, FRAME_PROJECT_ROOT: '' } });
  assert.equal(run.status, 0, run.stderr);
  const map = readMap(projectDir);
  assert.ok(map.modules.late, 'new file picked up');
  assert.equal(map.modules.app.description, 'Hand-written: the composition root');
  assert.deepEqual(map.architectureNotes, { boot: 'why startup is ordered this way' });
});

test('a bootstrap exception comes back as an explicit failure summary', async () => {
  const original = structureBootstrap.bootstrapStructure;
  structureBootstrap.bootstrapStructure = async () => { throw new Error('disk on fire'); };
  try {
    const result = await frameProject.runProjectInit(projectDir, 'demo');
    assert.deepEqual(result._structureBootstrap.initialScan, {
      status: 'error',
      reason: 'bootstrap-exception',
      message: 'STRUCTURE bootstrap failed: disk on fire',
      repairCommand: 'node .frame/bin/update-structure.js --full'
    });
    assert.ok(fs.existsSync(path.join(projectDir, FRAME_DIR, 'config.json')), 'the project still initialized');
  } finally {
    structureBootstrap.bootstrapStructure = original;
  }
});

test('generation works without Git and beside a custom hook it never touches', async () => {
  const noGit = await frameProject.runProjectInit(projectDir, 'demo');
  assert.equal(noGit._structureBootstrap.hook.status, 'skipped-no-git');
  assert.equal(noGit._structureBootstrap.initialScan.status, 'ok');

  const custom = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-init-custom-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: custom });
    fs.writeFileSync(path.join(custom, 'a.js'), '// A\n');
    const hookFile = path.join(custom, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hookFile, '#!/bin/sh\necho mine\n', { mode: 0o755 });
    const result = await frameProject.runProjectInit(custom, 'custom');
    assert.equal(result._structureBootstrap.hook.status, 'skipped-custom');
    assert.match(result._structureBootstrap.hook.manualInstructions, /--changed/);
    assert.equal(result._structureBootstrap.initialScan.status, 'ok');
    assert.equal(fs.readFileSync(hookFile, 'utf8'), '#!/bin/sh\necho mine\n');
  } finally {
    fs.rmSync(custom, { recursive: true, force: true });
  }
});

for (const mode of ['repo', 'local']) {
  test(`${mode} sharing never exposes scan state or recovery files to git`, async () => {
    spawnSync('git', ['init', '-q'], { cwd: projectDir });
    await frameProject.runProjectInit(projectDir, 'demo', { gitSharing: mode });
    const recovery = path.join(projectDir, FRAME_DIR, 'runtime', 'structure', 'recovery');
    fs.mkdirSync(recovery, { recursive: true });
    fs.writeFileSync(path.join(recovery, 'x.json'), '{}');
    const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: projectDir, encoding: 'utf8' }).stdout;
    assert.ok(!/\.frame\/runtime\//.test(status), status);
    assert.ok(!/\.bak$/m.test(status), status);
    if (mode === 'repo') assert.match(status, /\.frame\/STRUCTURE\.json/, 'the map itself stays shareable');
  });
}

test('re-init never rewrites user-authored REFERENCE or QUICKSTART text to refresh guidance', async () => {
  await frameProject.runProjectInit(projectDir, 'demo');
  const reference = path.join(projectDir, FRAME_DIR, 'docs', 'REFERENCE.md');
  const quickstart = frameStore.resolvePath(projectDir, FRAME_FILES.QUICKSTART);
  fs.writeFileSync(reference, '# Our reference\n\nHand-written.\n');
  fs.writeFileSync(quickstart, '# Our quickstart\n');
  await frameProject.runProjectInit(projectDir, 'demo');
  await frameProject.openProjectLayout(projectDir);
  // Frame's own managed spec section may be appended (a separate, older
  // contract); the user's prose stays verbatim and no STRUCTURE guidance is
  // pushed into their document.
  const after = fs.readFileSync(reference, 'utf8');
  assert.ok(after.startsWith('# Our reference\n\nHand-written.\n'));
  assert.ok(!after.includes('STRUCTURE.json Rules'));
  assert.equal(fs.readFileSync(quickstart, 'utf8'), '# Our quickstart\n');
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

test('init attaches one lifecycle worker after the initial scan has finished', async (t) => {
  const spawned = fakeWorkers();
  t.after(resetWorkers);
  await frameProject.runProjectInit(projectDir, 'demo');
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].cwd, fs.realpathSync(projectDir));
  assert.deepEqual(spawned[0].args.slice(-1), ['--supervised']);
  assert.match(spawned[0].args[0], /\.frame[\\/]bin[\\/]structure-lifecycle\.js$/);
  assert.equal(spawned[0].env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(spawned[0].scanRecordAtSpawn, true, 'the initial scan completed before the worker started');

  await frameProject.runProjectInit(projectDir, 'demo');
  assert.equal(spawned.length, 1, 're-init reuses the running worker');
});

test('Remove Frame stops the worker before deleting .frame/', async (t) => {
  const spawned = fakeWorkers();
  t.after(resetWorkers);
  await frameProject.runProjectInit(projectDir, 'demo');
  let frameDirWhenStopped = null;
  spawned[0].child.on('close', () => { frameDirWhenStopped = fs.existsSync(path.join(projectDir, FRAME_DIR)); });
  const result = await frameProject.detachThenRemoveFrame(projectDir);
  assert.deepEqual(spawned[0].child.messages.map((m) => m.cmd), ['stop']);
  assert.equal(frameDirWhenStopped, true, 'the worker stopped while .frame/ still existed');
  assert.ok(!fs.existsSync(path.join(projectDir, FRAME_DIR)));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(structureLifecycle.list(), []);
});
