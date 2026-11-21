/**
 * Claude Code hint hooks find Node on a machine without it (server-linux-readiness T01).
 *
 * Each hook command runs through a real `/bin/sh` with an empty PATH, so the
 * only Node it can find is the one the case provides: on PATH, through
 * `$FRAME_NODE` (what Frame gives its terminals; Frame Server's bundled Node
 * on a server), or none at all. The upgrade test runs frameProject's real
 * installSpecHintHook over a settings file holding the previous commands.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Module = require('node:module');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-hinthooks-'));
process.env.HOME = SANDBOX;
const STUBS = {
  '@aptabase/electron/main': { initialize() {}, trackEvent() {} },
  'posthog-node': { PostHog: class { capture() {} captureException() {} identify() {} shutdown() { return Promise.resolve(); } } },
  electron: { app: { getPath: () => SANDBOX, getVersion: () => '0.0.0-test' }, ipcMain: { handle() {}, on() {} }, dialog: { showMessageBox: async () => ({ response: 1 }) } }
};
const loadOriginal = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request === './aiToolManager') {
    const mod = loadOriginal.call(this, request, ...rest);
    return { ...mod, getActiveTool: () => ({ id: 'claude', name: 'Claude Code' }) };
  }
  return loadOriginal.call(this, request, ...rest);
};

const templates = require('../src/shared/frameTemplates');
const frameProject = require('../src/main/frameProject');

const commands = () => {
  const out = [];
  for (const entries of Object.values(templates.SPEC_HINT_HOOKS)) {
    for (const entry of entries) for (const hook of entry.hooks) out.push(hook.command);
  }
  return out;
};

/** A project folder whose .frame/bin scripts report which Node ran them and with what. */
function project({ scripts = true } = {}) {
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'proj-'));
  if (scripts) {
    fs.mkdirSync(path.join(dir, '.frame', 'bin'), { recursive: true });
    for (const name of ['spec-hint.js', 'module-hint.js', 'docs-hint.js', 'spec-command-hint.js']) {
      fs.writeFileSync(path.join(dir, '.frame', 'bin', name), `process.stdout.write('ran ${name} ' + process.argv.slice(2).join(' '));\n`);
    }
  }
  return dir;
}

const EMPTY_PATH = fs.mkdtempSync(path.join(SANDBOX, 'no-node-path-'));
const NODE_DIR = fs.mkdtempSync(path.join(SANDBOX, 'node-path-'));
fs.symlinkSync(process.execPath, path.join(NODE_DIR, 'node'));
// A hook command starts with `sh -c`, so every PATH here has `sh` — and only
// NODE_DIR has `node`.
for (const dir of [EMPTY_PATH, NODE_DIR]) fs.symlinkSync('/bin/sh', path.join(dir, 'sh'));

/** Run a hook command the way Claude Code does: `sh -c` in the project folder. */
function runHook(command, cwd, env) {
  // The command is itself `sh -c '…'`; run it through a shell with the case's env only.
  return spawnSync('/bin/sh', ['-c', command], { cwd, env, encoding: 'utf8' });
}

test('every Claude Code hint hook is built by hintCommand', () => {
  const all = commands();
  assert.equal(all.length, 6);
  for (const c of all) {
    const m = c.match(/\.frame\/bin\/([\w-]+\.js) ([\w-]+);/);
    assert.ok(m, c);
    assert.equal(c, templates.hintCommand(m[1], m[2]));
    assert.doesNotMatch(c, /exec node /, 'no bare node');
  }
});

test('with node on PATH, each hook runs it exactly as before', () => {
  const dir = project();
  for (const c of commands()) {
    const r = runHook(c, dir, { PATH: NODE_DIR });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^ran [\w-]+\.js [\w-]+$/);
  }
});

test('with no node on PATH, each hook runs Frame\'s Node from FRAME_NODE', () => {
  const dir = project();
  for (const c of commands()) {
    const r = runHook(c, dir, { PATH: EMPTY_PATH, FRAME_NODE: process.execPath });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^ran [\w-]+\.js [\w-]+$/, c);
  }
});

test('with neither, and with no .frame/bin, each hook exits 0 silently', () => {
  for (const dir of [project(), project({ scripts: false })]) {
    for (const c of commands()) {
      const r = runHook(c, dir, { PATH: EMPTY_PATH });
      assert.equal(r.status, 0, `${c}\n${r.stderr}`);
      assert.equal(r.stdout, '');
      assert.equal(r.stderr, '');
    }
  }
});

test('an existing project\'s previous hook commands are upgraded on install, not duplicated', () => {
  const dir = project();
  const old = (script, mode) => `sh -c '[ ! -f .frame/bin/${script} ] || exec node .frame/bin/${script} ${mode}'`;
  const settings = {
    permissions: { allow: ['Bash(ls)'] },
    hooks: {
      PreToolUse: [
        { matcher: 'Edit|Write', hooks: [{ type: 'command', command: old('spec-hint.js', 'pre-edit') }] },
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }
      ],
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: old('spec-hint.js', 'prompt') }] }]
    }
  };
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify(settings, null, 2));
  frameProject.installSpecHintHook(dir, { file: 'settings.json' });
  const after = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  const all = [];
  for (const list of Object.values(after.hooks)) for (const e of list) for (const h of e.hooks) all.push(h.command);
  assert.equal(all.filter((c) => /exec node /.test(c)).length, 0, 'the previous commands are gone');
  assert.equal(all.filter((c) => c === templates.hintCommand('spec-hint.js', 'pre-edit')).length, 1, 'today\'s command once');
  assert.ok(all.includes('echo mine'), 'the user\'s own hook stays');
  assert.deepEqual(after.permissions, settings.permissions, 'other keys untouched');
});

// ─── hooks-run-from-project-root ──────────────────────────────
//
// Claude Code runs a hook in the session's current directory, which follows
// the agent's `cd`; $CLAUDE_PROJECT_DIR stays the folder the session started
// in (measured with Claude Code 2.1.328, including a worktree).

test('after the agent cd\'d into a subfolder, each hook still runs — from $CLAUDE_PROJECT_DIR', () => {
  const dir = project();
  const sub = path.join(dir, 'src', 'deep');
  fs.mkdirSync(sub, { recursive: true });
  for (const c of commands()) {
    const r = runHook(c, sub, { PATH: NODE_DIR, CLAUDE_PROJECT_DIR: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^ran [\w-]+\.js [\w-]+$/, c);
  }
});

test('without $CLAUDE_PROJECT_DIR, or with one that does not exist, a hook behaves as before', () => {
  const dir = project();
  const sub = path.join(dir, 'sub');
  fs.mkdirSync(sub);
  for (const c of commands()) {
    for (const env of [{ PATH: NODE_DIR }, { PATH: NODE_DIR, CLAUDE_PROJECT_DIR: path.join(SANDBOX, 'gone') }]) {
      const atRoot = runHook(c, dir, env);
      assert.equal(atRoot.status, 0, atRoot.stderr);
      assert.match(atRoot.stdout, /^ran /, 'from the project root it runs, as before');
      const inSub = runHook(c, sub, env);
      assert.equal(inSub.status, 0, inSub.stderr);
      assert.equal(inSub.stdout, '', 'from a subfolder it skips silently, as before');
      assert.equal(inSub.stderr, '');
    }
  }
});

test('a project path with spaces works', () => {
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'with space '));
  fs.mkdirSync(path.join(dir, '.frame', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.frame', 'bin', 'spec-hint.js'), "process.stdout.write('ran');\n");
  fs.mkdirSync(path.join(dir, 'a b'));
  const r = runHook(templates.hintCommand('spec-hint.js', 'prompt'), path.join(dir, 'a b'), { PATH: NODE_DIR, CLAUDE_PROJECT_DIR: dir });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'ran');
});

test('the commands shipped before it are upgraded in place on install, once each', () => {
  const dir = project();
  const before = (script, mode) => `sh -c '[ ! -f .frame/bin/${script} ] || { n=$(command -v node || printf %s "$FRAME_NODE"); `
    + `[ -z "$n" ] || ELECTRON_RUN_AS_NODE=1 exec "$n" .frame/bin/${script} ${mode}; }'`;
  const settings = {
    hooks: {
      PreToolUse: [
        { matcher: 'Edit|Write', hooks: [{ type: 'command', command: before('spec-hint.js', 'pre-edit') }] },
        { matcher: 'Edit|Write|NotebookEdit|Bash', hooks: [{ type: 'command', command: before('docs-hint.js', 'pre-edit') }] }
      ],
      UserPromptSubmit: [
        { hooks: [{ type: 'command', command: before('spec-hint.js', 'prompt') }] },
        { hooks: [{ type: 'command', command: before('spec-command-hint.js', 'prompt') }] }
      ],
      SessionStart: [{ hooks: [{ type: 'command', command: before('docs-hint.js', 'session-start') }] }]
    }
  };
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify(settings, null, 2));
  const res = frameProject.installSpecHintHook(dir, { file: 'settings.json' });
  assert.equal(res.installed, true, JSON.stringify(res));
  const after = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  const all = [];
  for (const list of Object.values(after.hooks)) for (const e of list) for (const h of e.hooks) all.push(h.command);
  assert.equal(all.filter((c) => !c.includes('CLAUDE_PROJECT_DIR')).length, 0, 'no command of the previous form is left');
  for (const c of new Set(all)) assert.equal(all.filter((x) => x === c).length, 1, `once: ${c}`);
  assert.ok(all.includes(templates.hintCommand('spec-command-hint.js', 'prompt')));

  // Installing again changes nothing.
  const raw = fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8');
  frameProject.installSpecHintHook(dir, { file: 'settings.json' });
  assert.equal(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'), raw);
});

test('Codex hooks keep their command (they are machine-wide and trust-tracked)', () => {
  const codex = [];
  for (const list of Object.values(templates.CODEX_HINT_HOOKS)) for (const e of list) for (const h of e.hooks) codex.push(h.command);
  assert.ok(codex.length > 0);
  for (const c of codex) assert.match(c, /^sh -c '\[ ! -f \.frame\/bin\/[\w-]+\.js \] \|\| exec node \.frame\/bin\/[\w-]+\.js [\w-]+ codex'$/);
});
