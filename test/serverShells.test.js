/**
 * Shells on a Linux Frame Server (server-linux-readiness T02, T03).
 *
 * T02: the default Unix shell when none was chosen, and a requested shell
 * path that does not exist on this machine. The rules take the platform and
 * a file-exists check, so Linux is tested on any machine.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Module = require('node:module');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-shells-'));
process.env.HOME = SANDBOX;
const STUBS = {
  'node-pty': { spawn() { throw new Error('not in this test'); } },
  '@aptabase/electron/main': { initialize() {}, trackEvent() {} },
  'posthog-node': { PostHog: class { capture() {} shutdown() { return Promise.resolve(); } } },
  electron: { app: { getPath: () => SANDBOX, getVersion: () => '0.0.0', on() {} }, ipcMain: { on() {}, handle() {}, removeHandler() {} }, BrowserWindow: { getAllWindows: () => [] } }
};
const loadOriginal = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return loadOriginal.call(this, request, ...rest);
};

const pty = require('../src/main/ptyManager');

const has = (...files) => (p) => files.includes(p);

// ─── T02: default and requested shells ───────────────────────

test('T02: $SHELL wins wherever it is set', () => {
  assert.equal(pty.defaultUnixShell('linux', { SHELL: '/usr/bin/fish' }, has()), '/usr/bin/fish');
  assert.equal(pty.defaultUnixShell('darwin', { SHELL: '/bin/bash' }, has()), '/bin/bash');
});

test('T02: with $SHELL unset, Linux starts bash, else sh; macOS keeps zsh', () => {
  assert.equal(pty.defaultUnixShell('linux', {}, has('/bin/bash', '/bin/sh')), '/bin/bash');
  assert.equal(pty.defaultUnixShell('linux', {}, has('/bin/sh')), '/bin/sh', 'no bash: sh');
  assert.equal(pty.defaultUnixShell('darwin', {}, has()), '/bin/zsh');
});

test('T02: on Linux a requested shell that does not exist there is dropped for the default', () => {
  assert.equal(pty.requestedShell('/bin/zsh', 'linux', has('/bin/bash')), null);
  assert.equal(pty.requestedShell('/bin/bash', 'linux', has('/bin/bash')), '/bin/bash');
  assert.equal(pty.requestedShell(null, 'linux', has()), null);
});

test('T02: macOS and Windows pass a requested shell through as before', () => {
  assert.equal(pty.requestedShell('/opt/homebrew/bin/fish', 'darwin', has()), '/opt/homebrew/bin/fish');
  assert.equal(pty.requestedShell('pwsh.exe', 'win32', has()), 'pwsh.exe');
});
