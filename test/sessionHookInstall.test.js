/**
 * Session report hook install/remove (restore-ai-sessions-on-relaunch).
 *
 * The hook tells Frame which AI session runs in which terminal. What matters
 * here: it lands whatever tool is active, merges into a settings file without
 * disturbing anything else, never doubles up, comes back out with Frame's
 * other entries, and does nothing at all outside a Frame terminal.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// frameProject reaches Electron and telemetry transitively; CI runs with no
// node_modules on purpose, so both are stubbed the way codexHookInstall does.
const Module = require('node:module');
const ACTIVE = { id: 'codex' };
const EXTERNAL_STUBS = {
  '@aptabase/electron/main': { initialize() {}, trackEvent() {} },
  electron: { app: {}, ipcMain: { handle() {}, on() {} } }
};
const loadOriginal = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(EXTERNAL_STUBS, request)) return EXTERNAL_STUBS[request];
  const mod = loadOriginal.call(this, request, ...rest);
  if (request === './aiToolManager') return { ...mod, getActiveTool: () => ACTIVE };
  return mod;
};

const frameProject = require('../src/main/frameProject');
const templates = require('../src/shared/frameTemplates');

const PROJECT_FOR_CODEX = '/tmp/does-not-need-to-exist';
const CLAUDE_COMMAND = templates.SESSION_REPORT_HOOKS.SessionStart[0].hooks[0].command;

let projectDir;
beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-sessionhook-'));
  ACTIVE.id = 'codex';
});
afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

const settingsPath = (file = 'settings.json') => path.join(projectDir, '.claude', file);
const readSettings = (file) => JSON.parse(fs.readFileSync(settingsPath(file), 'utf8'));
const commandsIn = (settings) => Object.values(settings.hooks || {})
  .flat().flatMap((e) => (e.hooks || []).map((h) => h.command));

// ─── the command itself ───────────────────────────────────

test('the command writes the payload as <terminal>.<tool>.<pid>.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-reports-'));
  try {
    execFileSync('sh', ['-c', CLAUDE_COMMAND], {
      input: '{"session_id":"x"}',
      env: { ...process.env, FRAME_SESSION_DIR: dir, FRAME_TERMINAL_ID: 'term-4' }
    });
    const files = fs.readdirSync(dir);
    assert.equal(files.length, 1, 'no .tmp left behind');
    assert.match(files[0], /^term-4\.claude\.\d+\.json$/);
    assert.equal(fs.readFileSync(path.join(dir, files[0]), 'utf8'), '{"session_id":"x"}');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('outside a Frame terminal the command does nothing and exits 0', () => {
  const env = { ...process.env };
  delete env.FRAME_SESSION_DIR;
  delete env.FRAME_TERMINAL_ID;
  execFileSync('sh', ['-c', CLAUDE_COMMAND], { input: '{}', env, cwd: projectDir });
  assert.deepEqual(fs.readdirSync(projectDir), []);
});

// ─── installing ───────────────────────────────────────────

test('installs whatever tool is active', () => {
  const res = frameProject.installSessionHook(projectDir, { file: 'settings.json' });
  assert.equal(res.installed, true);
  assert.deepEqual(commandsIn(readSettings()), [CLAUDE_COMMAND]);
});

test('merges into an existing file, keeps its keys and indentation', () => {
  fs.mkdirSync(path.join(projectDir, '.claude'));
  fs.writeFileSync(settingsPath(), JSON.stringify({
    permissions: { allow: ['Bash(npm test)'] },
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] }
  }, null, 4) + '\n');

  frameProject.installSessionHook(projectDir);

  const text = fs.readFileSync(settingsPath(), 'utf8');
  assert.match(text, /^ {4}"permissions"/m);
  const settings = JSON.parse(text);
  assert.deepEqual(settings.permissions.allow, ['Bash(npm test)']);
  assert.deepEqual(commandsIn(settings), ['echo mine', CLAUDE_COMMAND]);
});

test('re-install is idempotent', () => {
  frameProject.installSessionHook(projectDir);
  const before = fs.readFileSync(settingsPath(), 'utf8');
  assert.equal(frameProject.installSessionHook(projectDir).added, 0);
  assert.equal(fs.readFileSync(settingsPath(), 'utf8'), before);
});

test('an unparseable settings file is left alone', () => {
  fs.mkdirSync(path.join(projectDir, '.claude'));
  fs.writeFileSync(settingsPath(), '{ nope');
  const res = frameProject.installSessionHook(projectDir);
  assert.equal(res.installed, false);
  assert.equal(res.manual, true);
  assert.equal(fs.readFileSync(settingsPath(), 'utf8'), '{ nope');
});

test('lands in settings.local.json when asked', () => {
  frameProject.installSessionHook(projectDir, { file: 'settings.local.json' });
  assert.deepEqual(commandsIn(readSettings('settings.local.json')), [CLAUDE_COMMAND]);
  assert.ok(!fs.existsSync(settingsPath()));
});

// ─── removing ─────────────────────────────────────────────

test('comes back out with Frame\'s other entries, leaving the user\'s', () => {
  ACTIVE.id = 'claude';
  fs.mkdirSync(path.join(projectDir, '.claude'));
  fs.writeFileSync(settingsPath(), JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] }
  }, null, 2) + '\n');
  frameProject.installSpecHintHook(projectDir);
  frameProject.installSessionHook(projectDir);

  frameProject.removeSpecHintHook(projectDir);

  assert.deepEqual(commandsIn(readSettings()), ['echo mine']);
});

// ─── Codex ────────────────────────────────────────────────
// CODEX_HOME is the user's global file, so every test points `home` at a
// temp directory; `npm test` also sets CODEX_HOME so that init/open paths
// exercised elsewhere can never reach the real one.

const CODEX_COMMAND = templates.CODEX_SESSION_REPORT_HOOKS.SessionStart[0].hooks[0].command;
const mkHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'frame-cxsession-'));
const codexCommands = (home) => commandsIn(JSON.parse(fs.readFileSync(path.join(home, 'hooks.json'), 'utf8')));

test('codex: installs whatever tool is active, idempotently', () => {
  const home = mkHome();
  ACTIVE.id = 'claude';
  assert.equal(frameProject.installCodexSessionHook({ home }).added, 1);
  assert.equal(frameProject.installCodexSessionHook({ home }).added, 0);
  assert.deepEqual(codexCommands(home), [CODEX_COMMAND]);
});

test('codex: merges beside Frame\'s hint hooks and the user\'s own', () => {
  const home = mkHome();
  fs.writeFileSync(path.join(home, 'hooks.json'), JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] }
  }, null, 2));
  frameProject.installCodexHintHook(PROJECT_FOR_CODEX, { home });
  frameProject.installCodexSessionHook({ home });

  const commands = codexCommands(home);
  assert.ok(commands.includes('echo mine'));
  assert.ok(commands.includes(CODEX_COMMAND));

  frameProject.removeCodexHintHook({ home });
  assert.deepEqual(codexCommands(home), ['echo mine'], 'removal takes the session entry too');
});

test('codex: the command is a no-op outside a Frame project', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-reports-'));
  try {
    const env = { ...process.env, FRAME_SESSION_DIR: dir, FRAME_TERMINAL_ID: 'term-2' };
    execFileSync('sh', ['-c', CODEX_COMMAND], { input: '{}', env, cwd: projectDir });
    assert.deepEqual(fs.readdirSync(dir), [], 'no .frame/ in cwd → nothing written');

    fs.mkdirSync(path.join(projectDir, '.frame'));
    execFileSync('sh', ['-c', CODEX_COMMAND], { input: '{}', env, cwd: projectDir });
    assert.match(fs.readdirSync(dir)[0], /^term-2\.codex\.\d+\.json$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('codex: an unparseable hooks.json is left alone', () => {
  const home = mkHome();
  fs.writeFileSync(path.join(home, 'hooks.json'), '{ nope');
  assert.equal(frameProject.installCodexSessionHook({ home }).manual, true);
  assert.equal(fs.readFileSync(path.join(home, 'hooks.json'), 'utf8'), '{ nope');
});
