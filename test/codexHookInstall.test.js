/**
 * Codex hook install/remove tests.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 *
 * The assertions that matter are about a file Frame does not own. Codex loads
 * hooks only from `CODEX_HOME/hooks.json` — a project-local `.codex/hooks.json`
 * was measured not to fire — so this is the user's global config, shared with
 * every project they open and with whatever they put there themselves. Merging
 * into it safely, and taking Frame's entries back out without residue, is the
 * whole contract; `CODEX_HOME` is pointed at a temp directory throughout so no
 * test can reach the real one.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// frameProject reaches Electron and telemetry transitively; CI runs with no
// node_modules on purpose, so both are stubbed the way specTasksSync does it.
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
  // The installer asks which tool is active; drive that from the test.
  if (request === './aiToolManager') return { ...mod, getActiveTool: () => ACTIVE };
  return mod;
};

const frameProject = require('../src/main/frameProject');
const templates = require('../src/shared/frameTemplates');

const mkHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'frame-cxhome-'));
const hooksIn = (home) => JSON.parse(fs.readFileSync(path.join(home, 'hooks.json'), 'utf8'));
const commandsIn = (home) => Object.values(hooksIn(home).hooks || {})
  .flat().flatMap((e) => (e.hooks || []).map((h) => h.command));

const PROJECT = '/tmp/does-not-need-to-exist';

// ─── installing ───────────────────────────────────────────

test('every Frame entry lands, guarded and naming the CLI', () => {
  const home = mkHome();
  const res = frameProject.installCodexHintHook(PROJECT, { home });
  assert.equal(res.installed, true);

  const commands = commandsIn(home);
  const expected = Object.values(templates.CODEX_HINT_HOOKS).flat()
    .flatMap((e) => e.hooks.map((h) => h.command));
  assert.deepEqual(commands.sort(), expected.sort());

  for (const command of commands) {
    // The guard is what makes a global config safe: in a project with no
    // .frame/bin the shell exits without ever starting node.
    assert.match(command, /^sh -c '\[ ! -f \.frame\/bin\/[a-z-]+\.js \] \|\| exec node \.frame\/bin\/[a-z-]+\.js [a-z-]+ codex'$/);
  }
});

test('the edit matcher is Codex\'s tool, not Claude Code\'s', () => {
  const home = mkHome();
  frameProject.installCodexHintHook(PROJECT, { home });
  const matchers = Object.values(hooksIn(home).hooks).flat().map((e) => e.matcher).filter(Boolean);
  assert.ok(matchers.includes('apply_patch'), 'apply_patch is the Codex edit tool');
  assert.ok(!matchers.some((m) => m.includes('Edit')), 'no Claude Code tool name leaks in');
});

test('a foreign hooks.json survives install untouched', () => {
  const home = mkHome();
  const mine = {
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] },
    somethingElse: { keep: true }
  };
  fs.writeFileSync(path.join(home, 'hooks.json'), JSON.stringify(mine, null, 4) + '\n');

  frameProject.installCodexHintHook(PROJECT, { home });
  const after = hooksIn(home);
  assert.deepEqual(after.somethingElse, { keep: true }, 'unrelated keys survive');
  assert.ok(commandsIn(home).includes('echo mine'), "the user's own hook survives");
});

test('a file Frame writes into keeps its own indentation', () => {
  const home = mkHome();
  fs.writeFileSync(path.join(home, 'hooks.json'), JSON.stringify({ hooks: {} }, null, 4) + '\n');
  frameProject.installCodexHintHook(PROJECT, { home });
  const text = fs.readFileSync(path.join(home, 'hooks.json'), 'utf8');
  assert.match(text, /^ {4}"hooks": \{$/m, 'four-space indentation preserved');
});

test('re-installing adds nothing', () => {
  const home = mkHome();
  frameProject.installCodexHintHook(PROJECT, { home });
  const first = commandsIn(home).length;
  const again = frameProject.installCodexHintHook(PROJECT, { home });
  assert.equal(again.added, 0, 'idempotent');
  assert.equal(commandsIn(home).length, first);
});

test("a hook the user wired to a hint script themselves stops the install", () => {
  const home = mkHome();
  fs.writeFileSync(path.join(home, 'hooks.json'), JSON.stringify({
    hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node ~/mine/spec-hint.js prompt' }] }] }
  }, null, 2) + '\n');
  const res = frameProject.installCodexHintHook(PROJECT, { home });
  assert.equal(res.installed, false);
  assert.equal(res.existing, true, 'Frame does not run the hint twice beside a hand-wired one');
});

test('corrupt JSON is reported for a human, never overwritten', () => {
  const home = mkHome();
  fs.writeFileSync(path.join(home, 'hooks.json'), '{ not json');
  const res = frameProject.installCodexHintHook(PROJECT, { home });
  assert.equal(res.installed, false);
  assert.equal(res.manual, true);
  assert.equal(fs.readFileSync(path.join(home, 'hooks.json'), 'utf8'), '{ not json', 'left as it was');
});

// ─── the opt-out and the active tool ──────────────────────

test('nothing is written when the setting is off', () => {
  const home = mkHome();
  const res = frameProject.installCodexHintHook(PROJECT, { home, enabled: false });
  assert.equal(res.installed, false);
  assert.ok(!fs.existsSync(path.join(home, 'hooks.json')), 'no file created');
});

test('nothing is written when Codex is not the active tool', () => {
  const home = mkHome();
  ACTIVE.id = 'claude';
  try {
    const res = frameProject.installCodexHintHook(PROJECT, { home });
    assert.equal(res.installed, false);
    assert.ok(!fs.existsSync(path.join(home, 'hooks.json')));
  } finally {
    ACTIVE.id = 'codex';
  }
});

// ─── removing ─────────────────────────────────────────────

test('removal takes every Frame entry out and leaves no residue', () => {
  const home = mkHome();
  frameProject.installCodexHintHook(PROJECT, { home });
  const res = frameProject.removeCodexHintHook({ home });
  assert.ok(res.removed > 0);
  const after = JSON.parse(fs.readFileSync(path.join(home, 'hooks.json'), 'utf8'));
  assert.ok(!after.hooks, 'an emptied hooks object is cleaned up, not left as {}');
});

test("removal leaves the user's own hooks and keys alone", () => {
  const home = mkHome();
  fs.writeFileSync(path.join(home, 'hooks.json'), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] },
    somethingElse: { keep: true }
  }, null, 2) + '\n');
  frameProject.installCodexHintHook(PROJECT, { home });
  frameProject.removeCodexHintHook({ home });

  const after = JSON.parse(fs.readFileSync(path.join(home, 'hooks.json'), 'utf8'));
  assert.deepEqual(after.somethingElse, { keep: true });
  assert.deepEqual(commandsIn(home), ['echo mine'], "only the user's hook is left");
});

test('removing from a home with no hooks.json is not an error', () => {
  assert.deepEqual(frameProject.removeCodexHintHook({ home: mkHome() }), { removed: 0 });
});

test('install then remove returns the file to exactly what it was', () => {
  const home = mkHome();
  const original = JSON.stringify({
    hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'echo after' }] }] }
  }, null, 2) + '\n';
  fs.writeFileSync(path.join(home, 'hooks.json'), original);
  frameProject.installCodexHintHook(PROJECT, { home });
  frameProject.removeCodexHintHook({ home });
  assert.equal(fs.readFileSync(path.join(home, 'hooks.json'), 'utf8'), original);
});
