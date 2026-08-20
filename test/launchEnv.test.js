/**
 * launchEnv tests (T02): the `PATH` entry that makes Frame's terminal carry
 * Frame's context.
 *
 * The load-bearing assertions are that prepending is idempotent — a PTY can be
 * respawned any number of times and must not grow a duplicate entry each time
 * — and that the bin directory ends up **first**, since a real `claude`
 * earlier on the path would win and the session would silently lose the
 * wrapper.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const launchEnv = require('../src/main/launchEnv');

const PROJECT = '/tmp/some project';
const BIN = path.join(PROJECT, '.frame', 'bin');

// ─── frameBinDir ──────────────────────────────────────────────

test('frameBinDir points at the project\'s .frame/bin', () => {
  assert.equal(launchEnv.frameBinDir(PROJECT), BIN);
});

test('frameBinDir has nothing to say without a project', () => {
  assert.equal(launchEnv.frameBinDir(''), '');
  assert.equal(launchEnv.frameBinDir(null), '');
  assert.equal(launchEnv.frameBinDir(undefined), '');
});

// ─── supportsWrappers ─────────────────────────────────────────

test('wrappers are a POSIX affair', () => {
  assert.equal(launchEnv.supportsWrappers('darwin'), true);
  assert.equal(launchEnv.supportsWrappers('linux'), true);
  assert.equal(launchEnv.supportsWrappers('win32'), false);
});

// ─── wrapperFamily ────────────────────────────────────────────

test('the wrapper family follows the platform, not the tool', () => {
  assert.equal(launchEnv.wrapperFamily('darwin'), 'posix');
  assert.equal(launchEnv.wrapperFamily('linux'), 'posix');
  assert.equal(launchEnv.wrapperFamily('win32'), 'cmd');
});

// ─── wrapperFileName ──────────────────────────────────────────

test('POSIX names an extensionless wrapper per tool, path-passing or not', () => {
  for (const platform of ['darwin', 'linux']) {
    assert.equal(launchEnv.wrapperFileName('claude', { platform, canPassPaths: true }), 'claude');
    assert.equal(launchEnv.wrapperFileName('codex', { platform, canPassPaths: false }), 'codex');
  }
});

test('Windows names a .cmd only for a tool that can take paths', () => {
  // .cmd because it is the only extension in the default PATHEXT, which is
  // what makes a bare `claude` resolve to it.
  assert.equal(launchEnv.wrapperFileName('claude', { platform: 'win32', canPassPaths: true }), 'claude.cmd');
});

test('Windows refuses a wrapper for a tool that cannot take paths', () => {
  // A batch file cannot carry a 993-byte, backtick-bearing preamble, and a
  // wrapper that cannot run is worse than none — so Codex and Gemini get
  // nothing here and behave exactly as they do today.
  assert.equal(launchEnv.wrapperFileName('codex', { platform: 'win32', canPassPaths: false }), '');
  assert.equal(launchEnv.wrapperFileName('gemini', { platform: 'win32' }), '');
});

test('no tool id means no wrapper name', () => {
  assert.equal(launchEnv.wrapperFileName('', { platform: 'darwin', canPassPaths: true }), '');
  assert.equal(launchEnv.wrapperFileName(null, { platform: 'win32', canPassPaths: true }), '');
});

test('canPassPaths defaults to false, so Windows opts a tool in explicitly', () => {
  assert.equal(launchEnv.wrapperFileName('claude', { platform: 'win32' }), '');
  assert.equal(launchEnv.wrapperFileName('claude', { platform: 'darwin' }), 'claude');
});

// ─── prependFrameBin ──────────────────────────────────────────

test('the bin directory lands in front of the existing PATH', () => {
  const result = launchEnv.prependFrameBin('/usr/bin:/bin', PROJECT, 'darwin');
  assert.equal(result, `${BIN}:/usr/bin:/bin`);
});

test('prepending twice changes nothing the second time', () => {
  const once = launchEnv.prependFrameBin('/usr/bin:/bin', PROJECT, 'darwin');
  const twice = launchEnv.prependFrameBin(once, PROJECT, 'darwin');
  assert.equal(twice, once, 'a respawned PTY would accumulate duplicates');
});

test('an entry sitting behind a real CLI is moved to the front, not left there', () => {
  // Present-but-not-first is the dangerous case: /usr/local/bin's real
  // `claude` would resolve first and Frame's context would vanish silently.
  const result = launchEnv.prependFrameBin(`/usr/local/bin:${BIN}:/bin`, PROJECT, 'darwin');
  assert.equal(result, `${BIN}:/usr/local/bin:/bin`);
  assert.equal(result.split(':').filter((e) => e === BIN).length, 1, 'duplicated instead of moved');
});

test('the platform separator is respected', () => {
  assert.equal(
    launchEnv.prependFrameBin('/usr/bin:/bin', PROJECT, 'linux'),
    `${BIN}:/usr/bin:/bin`
  );
});

test('Windows gets the entry too, joined with its own separator', () => {
  // The old gate here was a category error: the check is about wrappers, the
  // function is about PATH. Gating it is what kept the ';' below unreachable
  // and left a Windows lane with no route to .frame/bin at all.
  const WIN_PROJECT = 'C:\\Users\\dev\\my project';
  const WIN_BIN = path.join(WIN_PROJECT, '.frame', 'bin');
  const result = launchEnv.prependFrameBin('C:\\Windows\\System32;C:\\bin', WIN_PROJECT, 'win32');
  assert.equal(result, `${WIN_BIN};C:\\Windows\\System32;C:\\bin`);
});

test('Windows prepending is idempotent and moves rather than duplicates', () => {
  const WIN_PROJECT = 'C:\\Users\\dev\\my project';
  const WIN_BIN = path.join(WIN_PROJECT, '.frame', 'bin');
  const once = launchEnv.prependFrameBin('C:\\bin', WIN_PROJECT, 'win32');
  assert.equal(launchEnv.prependFrameBin(once, WIN_PROJECT, 'win32'), once);

  // nvm-windows and friends reorder PATH behind Frame's back; being present
  // but second is the case that silently costs the session its context.
  const behind = launchEnv.prependFrameBin(`C:\\nvm;${WIN_BIN};C:\\bin`, WIN_PROJECT, 'win32');
  assert.equal(behind, `${WIN_BIN};C:\\nvm;C:\\bin`);
  assert.equal(behind.split(';').filter((e) => e === WIN_BIN).length, 1);
});

test('no project means no injection', () => {
  assert.equal(launchEnv.prependFrameBin('/usr/bin:/bin', '', 'darwin'), '/usr/bin:/bin');
  assert.equal(launchEnv.prependFrameBin('/usr/bin:/bin', null, 'darwin'), '/usr/bin:/bin');
});

test('an absent PATH becomes just the bin directory', () => {
  assert.equal(launchEnv.prependFrameBin(undefined, PROJECT, 'darwin'), BIN);
  assert.equal(launchEnv.prependFrameBin('', PROJECT, 'darwin'), BIN);
});

test('empty segments are dropped rather than carried along', () => {
  assert.equal(launchEnv.prependFrameBin('/usr/bin::/bin', PROJECT, 'darwin'), `${BIN}:/usr/bin:/bin`);
});

// ─── purity ───────────────────────────────────────────────────

test('the module touches neither the filesystem nor Electron', () => {
  const source = require('fs').readFileSync(require.resolve('../src/main/launchEnv'), 'utf8');
  for (const forbidden of ['electron', 'node:fs', "require('fs')", 'child_process']) {
    assert.ok(!source.includes(`require('${forbidden}')`), `launchEnv requires ${forbidden}`);
  }

  // Belt and braces: load it with fs and electron poisoned, and exercise it.
  const realLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'fs' || request === 'node:fs' || request === 'electron') {
      throw new Error(`launchEnv must not require ${request}`);
    }
    return realLoad(request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve('../src/main/launchEnv')];
    const fresh = require('../src/main/launchEnv');
    assert.equal(fresh.prependFrameBin('/usr/bin', PROJECT, 'darwin'), `${BIN}:/usr/bin`);
  } finally {
    Module._load = realLoad;
    delete require.cache[require.resolve('../src/main/launchEnv')];
  }
});
