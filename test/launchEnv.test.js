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

test('a non-wrapper platform gets its PATH back untouched', () => {
  const original = 'C:\\Windows\\System32;C:\\bin';
  assert.equal(launchEnv.prependFrameBin(original, PROJECT, 'win32'), original);
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
