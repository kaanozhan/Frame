/**
 * isPathLike — which custom-tool commands name a file instead of a PATH
 * lookup (#203). The Windows rules run through path.win32, so they are
 * checked on every CI platform.
 *
 * Electron and the analytics packages are stubbed (the frameProjectOpen
 * pattern).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

const Module = require('node:module');
const EXTERNAL_STUBS = {
  '@aptabase/electron/main': { initialize() {}, trackEvent() {} },
  'posthog-node': { PostHog: class { capture() {} captureException() {} identify() {} shutdown() { return Promise.resolve(); } } },
  electron: {
    app: { getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    ipcMain: { handle() {}, on() {} }
  }
};
const loadOriginal = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(EXTERNAL_STUBS, request)) {
    return EXTERNAL_STUBS[request];
  }
  return loadOriginal.call(this, request, ...rest);
};

const { isPathLike } = require('../src/main/aiToolManager');

test('POSIX: absolute and ./ ../ paths are paths; bare names are PATH lookups', () => {
  for (const cmd of ['/usr/local/bin/agent', './agent', '../bin/agent']) {
    assert.equal(isPathLike(cmd, path.posix), true, cmd);
  }
  for (const cmd of ['claude', 'codex', 'agent.sh', '', null, undefined]) {
    assert.equal(isPathLike(cmd, path.posix), false, String(cmd));
  }
});

test('POSIX: a backslash prefix is not a path separator', () => {
  assert.equal(isPathLike('.\\agent', path.posix), false);
});

test('Windows: drive, UNC, rooted and .\\ ..\\ paths are paths (#203)', () => {
  for (const cmd of [
    'C:\\tools\\agent.exe',
    'c:/tools/agent.exe',
    '\\\\host\\share\\agent.exe',
    '\\tools\\agent.exe',
    '.\\agent.exe',
    '..\\bin\\agent.exe',
    './agent.exe',
    '../bin/agent.exe'
  ]) {
    assert.equal(isPathLike(cmd, path.win32), true, cmd);
  }
  for (const cmd of ['claude', 'agent.exe', 'C:agent.exe']) {
    assert.equal(isPathLike(cmd, path.win32), false, cmd);
  }
});
