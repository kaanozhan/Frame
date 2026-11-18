/**
 * githubManager.checkAccess caching (server-github-setup G5).
 *
 * Frame Server never changes project, and the cache used to keep "gh not
 * signed in" until it restarted: after `gh auth login` on the server, Create
 * Pull Request stayed disabled. Only a signed-in result is cached now. A
 * stand-in `gh` on PATH plays signed out, then signed in.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('node:module');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-ghcache-'));
const bin = path.join(dir, 'bin');
fs.mkdirSync(bin);
const signedIn = path.join(dir, 'signed-in');
const calls = path.join(dir, 'calls.log');
fs.writeFileSync(path.join(bin, 'gh'), [
  '#!/bin/sh',
  `echo "$*" >> "${calls}"`,
  'case "$1 $2" in',
  `  "auth status") [ -f "${signedIn}" ] && exit 0 || exit 1 ;;`,
  '  "repo view") echo \'{"nameWithOwner":"owner/repo"}\'; exit 0 ;;',
  'esac',
  'exit 0'
].join('\n'), { mode: 0o755 });

const STUBS = {
  electron: { shell: {}, ipcMain: { handle() {}, on() {}, removeHandler() {} } },
  '@aptabase/electron/main': { initialize() {}, trackEvent() {} },
  'posthog-node': { PostHog: class { capture() {} shutdown() { return Promise.resolve(); } } }
};
const ENV_PATH = path.join(__dirname, '..', 'src', 'main', 'envPath.js');
const loadOriginal = Module._load;
Module._load = function (request, parent, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('.') && parent && parent.filename) {
    try {
      if (Module._resolveFilename(request, parent) === ENV_PATH) {
        return { childEnv: async () => ({ ...process.env, PATH: `${bin}:/usr/bin:/bin` }) };
      }
    } catch (_) { /* fall through */ }
  }
  return loadOriginal.call(this, request, parent, ...rest);
};
const github = require('../src/main/githubManager');
Module._load = loadOriginal;

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('G5: a signed-out result is not kept — signing in shows on the next check, without a restart or a project change', async () => {
  const project = dir;
  const first = await github.checkAccess(project);
  assert.deepEqual({ gh: first.gh, authed: first.authed }, { gh: true, authed: false });

  fs.writeFileSync(signedIn, '');                      // the user ran gh auth login
  const second = await github.checkAccess(project);
  assert.equal(second.authed, true, 'not the stale signed-out answer');
  assert.equal(second.repoName, 'owner/repo');
});

test('G5: a signed-in result is still cached — no gh calls until forced', async () => {
  const project = dir;
  fs.writeFileSync(signedIn, '');
  await github.checkAccess(project, true);
  const before = fs.readFileSync(calls, 'utf8').split('\n').length;
  const again = await github.checkAccess(project);
  assert.equal(again.authed, true);
  assert.equal(fs.readFileSync(calls, 'utf8').split('\n').length, before, 'served from the cache');
});
