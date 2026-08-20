/**
 * aiToolManager launch-composition tests: `inlineInjectionFlags`, the pure
 * decision behind the line a lane types when Frame wrote no wrapper for the
 * tool.
 *
 * The whole point of the function being pure and taking `platform` is that
 * Windows behaviour is assertable from a Mac — nobody on this side of the work
 * has a Windows machine, and the real verification is a written handoff. What
 * these tests pin down is that Windows gets two *paths* and POSIX keeps the
 * string form, because the version-dependent flag must not spread to the
 * platform that works today.
 *
 * `aiToolManager` is a main-process module: it requires `electron` directly
 * and, through `telemetry`, `@aptabase/electron/main` at module scope. CI runs
 * no `npm ci` on purpose, so requiring any packaged dependency for real fails
 * there while passing locally — which is exactly how this file once turned all
 * three CI legs red. Every non-builtin, non-relative request is therefore
 * stubbed for the duration of the load, rather than `electron` alone: naming
 * them one by one is what broke, since the list grows with the require graph.
 *
 * Stubbing them is safe here because nothing under test needs one —
 * `inlineInjectionFlags` is pure and `AI_TOOLS` is data.
 *
 * Nothing here touches the filesystem either: the asset object is the fixture.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const BUILTINS = new Set(Module.builtinModules);
const PACKAGED_STUB = { ipcMain: { handle() {}, on() {} } };

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const bare = String(request).replace(/^node:/, '').split('/')[0];
  if (!String(request).startsWith('.') && !path.isAbsolute(request) && !BUILTINS.has(bare)) {
    return PACKAGED_STUB;
  }
  return realLoad(request, parent, isMain);
};
let aiToolManager;
try {
  aiToolManager = require('../src/main/aiToolManager');
} finally {
  Module._load = realLoad;
}

const { inlineInjectionFlags, AI_TOOLS } = aiToolManager;

// What `prepareLaunchAssets` hands back for a project at /tmp/some project.
const ASSETS = {
  preamble: 'Frame context for this session.\n\n- `AGENTS.md`\n',
  settingsPath: '/tmp/some project/.frame/runtime/claude-settings.json',
  preambleRel: '.frame/runtime/preamble-claude.txt',
  settingsRel: '.frame/runtime/claude-settings.json',
  wrapperPath: ''
};

// A flag-type tool that never learned the file form — a custom tool, or Claude
// on a build where the flag was not worth declaring.
const STRING_ONLY = {
  id: 'stringy',
  injection: { type: 'flag', promptFlag: '--append-system-prompt', settingsFlag: '--settings' }
};

// ─── the record ───────────────────────────────────────────────

test('Claude declares both the string flag and the file flag', () => {
  assert.equal(AI_TOOLS.claude.injection.promptFlag, '--append-system-prompt');
  assert.equal(AI_TOOLS.claude.injection.promptFileFlag, '--append-system-prompt-file');
  assert.equal(AI_TOOLS.claude.injection.settingsFlag, '--settings');
});

test('Codex and Gemini declare no file flag, so nothing here changes for them', () => {
  assert.equal(AI_TOOLS.codex.injection.promptFileFlag, undefined);
  assert.equal(AI_TOOLS.gemini.injection.promptFileFlag, undefined);
});

// ─── win32: paths, not prose ──────────────────────────────────

test('a wrapper-less platform passes the file flag and two relative paths', () => {
  const flags = inlineInjectionFlags(AI_TOOLS.claude, ASSETS, 'win32');
  assert.deepEqual(flags, [
    '--append-system-prompt-file',
    '.frame/runtime/preamble-claude.txt',
    '--settings',
    '.frame/runtime/claude-settings.json'
  ]);
});

test('nothing a Windows shell has to parse survives into the line', () => {
  const flags = inlineInjectionFlags(AI_TOOLS.claude, ASSETS, 'win32');
  for (const value of flags) {
    assert.ok(!value.includes('\n'), `a newline reached the typed line: ${value}`);
    assert.ok(!value.includes('`'), `a backtick reached the typed line: ${value}`);
    assert.ok(!value.includes('\\'), `a backslash reached the typed line: ${value}`);
    assert.ok(!/\s/.test(value), `whitespace reached the typed line: ${value}`);
  }
  // The preamble text itself is the thing that must not be there.
  assert.ok(!flags.includes(ASSETS.preamble));
});

// ─── POSIX: unchanged ─────────────────────────────────────────

test('POSIX keeps the string flag and the absolute settings path', () => {
  for (const platform of ['darwin', 'linux']) {
    assert.deepEqual(inlineInjectionFlags(AI_TOOLS.claude, ASSETS, platform), [
      '--append-system-prompt',
      ASSETS.preamble,
      '--settings',
      ASSETS.settingsPath
    ]);
  }
});

test('the file flag does not leak onto the platform that works today', () => {
  // C3: it has no --help row of its own, so an older CLI rejects it outright.
  const flags = inlineInjectionFlags(AI_TOOLS.claude, ASSETS, 'darwin');
  assert.ok(!flags.includes('--append-system-prompt-file'));
});

// ─── a tool with no file flag ─────────────────────────────────

test('a tool with no promptFileFlag gets the string form on both platforms', () => {
  for (const platform of ['darwin', 'win32']) {
    assert.deepEqual(inlineInjectionFlags(STRING_ONLY, ASSETS, platform), [
      '--append-system-prompt',
      ASSETS.preamble,
      '--settings',
      ASSETS.settingsPath
    ]);
  }
});

// ─── nothing to inject ────────────────────────────────────────

test('a wrapper-type tool composes no flags of its own', () => {
  assert.deepEqual(inlineInjectionFlags(AI_TOOLS.codex, ASSETS, 'win32'), []);
  assert.deepEqual(inlineInjectionFlags(AI_TOOLS.gemini, ASSETS, 'darwin'), []);
});

test('a preamble that failed to compose injects nothing anywhere', () => {
  const empty = { ...ASSETS, preamble: '', preambleRel: '' };
  assert.deepEqual(inlineInjectionFlags(AI_TOOLS.claude, empty, 'win32'), []);
  assert.deepEqual(inlineInjectionFlags(AI_TOOLS.claude, empty, 'darwin'), []);
});

test('a settings file that was never written costs the settings flag, not the prompt', () => {
  const noSettings = { ...ASSETS, settingsPath: '', settingsRel: '' };
  assert.deepEqual(inlineInjectionFlags(AI_TOOLS.claude, noSettings, 'win32'), [
    '--append-system-prompt-file',
    '.frame/runtime/preamble-claude.txt'
  ]);
  assert.deepEqual(inlineInjectionFlags(AI_TOOLS.claude, noSettings, 'darwin'), [
    '--append-system-prompt',
    ASSETS.preamble
  ]);
});

test('missing tool or assets is answered, not thrown', () => {
  assert.deepEqual(inlineInjectionFlags(null, ASSETS, 'win32'), []);
  assert.deepEqual(inlineInjectionFlags({ id: 'x' }, ASSETS, 'win32'), []);
  assert.deepEqual(inlineInjectionFlags(AI_TOOLS.claude, null, 'win32'), []);
  assert.deepEqual(inlineInjectionFlags(AI_TOOLS.claude, undefined, 'darwin'), []);
});

// ─── purity ───────────────────────────────────────────────────

test('the flags come out the same however often they are composed', () => {
  const once = inlineInjectionFlags(AI_TOOLS.claude, ASSETS, 'win32');
  const twice = inlineInjectionFlags(AI_TOOLS.claude, ASSETS, 'win32');
  assert.deepEqual(once, twice);
  assert.notEqual(once, twice, 'a shared array would let one caller mutate another\'s flags');
});
