/**
 * gitSharing tests (non-invasive-overlay T06/T07).
 *
 * Switching mode has to move four things together — the stored setting, the
 * exclude block, the Claude settings file the hooks live in, and the managed
 * `.frame/.gitignore` block — and must never reach for `git rm`.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const Module = require('node:module');
const EXTERNAL_STUBS = {
  '@aptabase/electron/main': { initialize() {}, trackEvent() {} },
  electron: { app: { getPath: () => os.tmpdir() }, ipcMain: { handle() {}, on() {} } }
};
const loadOriginal = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(EXTERNAL_STUBS, request)) return EXTERNAL_STUBS[request];
  return loadOriginal.call(this, request, ...rest);
};

const gitSharing = require('../src/main/gitSharing');
const gitExclude = require('../src/main/gitExclude');
const frameStore = require('../src/main/frameStore');
const aiToolManager = require('../src/main/aiToolManager');
const templates = require('../src/shared/frameTemplates');

aiToolManager.getActiveTool = () => ({ id: 'claude', name: 'Claude Code' });

let projectDir;

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function hookCommands(file) {
  if (!fs.existsSync(file)) return [];
  const settings = readJson(file);
  if (!settings.hooks) return [];
  return Object.values(settings.hooks).flat().flatMap((e) => e.hooks.map((h) => h.command));
}

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-sharing-'));
  git(projectDir, ['init', '-q']);
  git(projectDir, ['config', 'user.email', 'test@example.com']);
  git(projectDir, ['config', 'user.name', 'Test']);
  const config = templates.getFrameConfigTemplate('demo');
  frameStore.writeConfig(projectDir, config);
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('repo is the default and leaves git alone', () => {
  const state = gitSharing.getState(projectDir);
  assert.equal(state.mode, 'repo');
  assert.equal(state.tracked, false);
  assert.equal(state.warning, null);
  assert.equal(state.hookFile, 'settings.json');
});

test('switching to local excludes, moves the hooks, and back again', () => {
  const local = gitSharing.setMode(projectDir, 'local');
  assert.equal(local.mode, 'local');
  assert.equal(frameStore.readConfig(projectDir).settings.gitSharing, 'local');
  assert.ok(gitExclude.hasBlock(projectDir), 'exclude block present under local');

  const localFile = path.join(projectDir, '.claude', 'settings.local.json');
  const sharedFile = path.join(projectDir, '.claude', 'settings.json');
  assert.equal(hookCommands(localFile).length, 2, 'hooks live in settings.local.json');
  assert.equal(hookCommands(sharedFile).length, 0);

  const repo = gitSharing.setMode(projectDir, 'repo');
  assert.equal(repo.mode, 'repo');
  assert.equal(gitExclude.hasBlock(projectDir), false, 'exclude block withdrawn under repo');
  assert.equal(hookCommands(sharedFile).length, 2, 'hooks moved to settings.json');
  assert.equal(hookCommands(localFile).length, 0, 'and left the local file');
});

test('the managed .gitignore block lists runtime classes but not STRUCTURE.json', () => {
  gitSharing.setMode(projectDir, 'repo');

  const ignoreFile = path.join(projectDir, '.frame', '.gitignore');
  const content = fs.readFileSync(ignoreFile, 'utf8');
  for (const entry of ['runtime/', 'worktrees/', 'orchestration/', 'bin/', 'migration-backup/', '*.bak', 'specs/*/report-data.json']) {
    assert.ok(content.includes(entry), `${entry} is ignored`);
  }
  assert.ok(!/^STRUCTURE\.json$/m.test(content), 'STRUCTURE.json stays tracked');
});

test('user lines outside the managed block survive a rewrite', () => {
  const ignoreFile = path.join(projectDir, '.frame', '.gitignore');
  fs.mkdirSync(path.dirname(ignoreFile), { recursive: true });
  fs.writeFileSync(ignoreFile, '# mine\nscratch-notes.md\n', 'utf8');

  gitSharing.ensureFrameGitignore(projectDir);
  gitSharing.ensureFrameGitignore(projectDir); // idempotent

  const content = fs.readFileSync(ignoreFile, 'utf8');
  assert.match(content, /# mine/);
  assert.match(content, /^scratch-notes\.md$/m);
  assert.equal(content.split(templates.FRAME_GITIGNORE_MARKER_START).length - 1, 1, 'exactly one managed block');
});

test('local with a tracked .frame/ warns with the command instead of running git rm', () => {
  git(projectDir, ['add', '-f', '.frame/config.json']);
  git(projectDir, ['commit', '-q', '-m', 'share frame']);

  const state = gitSharing.setMode(projectDir, 'local');
  assert.equal(state.mode, 'local', 'the preference is still stored');
  assert.equal(state.tracked, true);
  assert.match(state.warning, /git rm -r --cached \.frame/);
  assert.equal(gitExclude.hasBlock(projectDir), false, 'tracked files are never excluded');

  // Frame ran no git command that changed the index.
  assert.equal(git(projectDir, ['ls-files', '--cached', '--', '.frame/']), '.frame/config.json');
});

test('reconcile re-applies the stored mode when tracked state changes', () => {
  gitSharing.setMode(projectDir, 'local');
  assert.ok(gitExclude.hasBlock(projectDir));

  git(projectDir, ['add', '-f', '.frame/config.json']);
  git(projectDir, ['commit', '-q', '-m', 'share frame']);

  const state = gitSharing.reconcile(projectDir);
  assert.equal(state.mode, 'local');
  assert.equal(gitExclude.hasBlock(projectDir), false, 'exclusion withdrawn once the files are committed');
  assert.match(state.warning, /already committed/);
});

test('a non-Frame directory cannot have a mode set', () => {
  const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-plain-'));
  try {
    const state = gitSharing.setMode(plainDir, 'local');
    assert.equal(state.error, 'not a Frame project');
    assert.ok(!fs.existsSync(path.join(plainDir, '.frame')));
  } finally {
    fs.rmSync(plainDir, { recursive: true, force: true });
  }
});
