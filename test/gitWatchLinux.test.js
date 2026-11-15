/**
 * Git status on Linux watches one folder at a time (server-linux-readiness T04).
 *
 * Linux's recursive fs.watch costs one inotify watch per directory, so a
 * repository with node_modules can exhaust the limit. The real
 * gitStatusManager runs here with its platform forced to 'linux' (non-recursive
 * fs.watch works the same on macOS), against temp repos.
 *
 * Also pinned: the user's no-loops requirement — a burst of new folders is one
 * re-read, and nothing Frame does by itself causes another.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Module = require('node:module');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'frame-gitwatch-')));
process.env.HOME = SANDBOX;
process.env.GIT_CONFIG_NOSYSTEM = '1';
const STUBS = {
  '@aptabase/electron/main': { initialize() {}, trackEvent() {} },
  'posthog-node': { PostHog: class { capture() {} shutdown() { return Promise.resolve(); } } },
  electron: { app: { getPath: () => SANDBOX, getVersion: () => '0.0.0', on() {} }, ipcMain: { on() {}, handle() {} }, BrowserWindow: { getAllWindows: () => [] } }
};
const loadOriginal = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return loadOriginal.call(this, request, ...rest);
};

const gitStatus = require('../src/main/gitStatusManager');
const { IPC } = require('../src/shared/ipcChannels');

// Short timings so a test takes seconds, not the production 1 s / 10 s.
gitStatus.LINUX_WATCH.REBUILD_DEBOUNCE_MS = 150;
gitStatus.LINUX_WATCH.REBUILD_MIN_INTERVAL_MS = 600;

const pushes = [];
gitStatus.init({ on() {}, isDestroyed: () => false, webContents: { send: (ch, p) => { if (ch === IPC.GIT_STATUS_DATA) pushes.push(p); } } });
after(() => gitStatus.stopWatching());

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
const write = (file, body = 'x\n') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return; await sleep(50); }
  throw new Error(`timed out waiting for ${what}`);
}

let seq = 0;
/** A repo with tracked src/ and docs/, an ignored node_modules tree, and an untracked new/ file. */
function repo() {
  const dir = path.join(SANDBOX, `repo-${++seq}`);
  git(['init', '-q', dir]);
  write(path.join(dir, '.gitignore'), 'node_modules/\n');
  write(path.join(dir, 'src', 'a.js'));
  write(path.join(dir, 'docs', 'x.md'));
  git(['add', '.'], dir); git(['commit', '-qm', 'init'], dir);
  for (let i = 0; i < 30; i++) write(path.join(dir, 'node_modules', `pkg${i}`, 'lib', 'index.js'));
  write(path.join(dir, 'new', 'b.js'));
  fs.mkdirSync(path.join(dir, 'empty-untracked'));
  return dir;
}

const changedIn = (p, rel) => !!(p && p.files && p.files[rel]);

test('T04: the folder set is what git cares about — never node_modules, .git or .frame', async () => {
  const dir = repo();
  write(path.join(dir, '.frame', 'specs', 's', 'status.json'));
  const dirs = Array.from(await gitStatus.watchedDirsFor(dir)).sort();
  assert.deepEqual(dirs, ['', 'docs', 'empty-untracked', 'new', 'src']);
});

test('T04: on Linux an edit in a watched folder refreshes the status, with no recursive watch', async () => {
  const dir = repo();
  gitStatus.startWatching(dir, { platform: 'linux' });
  await waitFor(() => gitStatus.linuxWatchStats() && gitStatus.linuxWatchStats().watching.length === 5, 3000, 'the folders to be watched');
  assert.deepEqual(gitStatus.linuxWatchStats().watching, ['', 'docs', 'empty-untracked', 'new', 'src']);
  pushes.length = 0;
  write(path.join(dir, 'src', 'a.js'), 'changed\n');
  await waitFor(() => pushes.some((p) => changedIn(p, 'src/a.js')), 3000, 'src/a.js in a status push');
  gitStatus.stopWatching();
});

test('T04: a new folder is picked up, and files made in it before the re-read still reach the panel', async () => {
  const dir = repo();
  gitStatus.startWatching(dir, { platform: 'linux' });
  await waitFor(() => gitStatus.linuxWatchStats() && gitStatus.linuxWatchStats().watching.length === 5, 3000, 'initial watch');
  pushes.length = 0;
  write(path.join(dir, 'src', 'feature', 'deep', 'c.js'));
  await waitFor(() => gitStatus.linuxWatchStats().watching.includes('src/feature/deep'), 4000, 'the new nested folder to be watched');
  await waitFor(() => pushes.some((p) => changedIn(p, 'src/feature/deep/c.js')), 3000, 'the file made before the re-read');
  pushes.length = 0;
  write(path.join(dir, 'src', 'feature', 'deep', 'd.js'));
  await waitFor(() => pushes.some((p) => changedIn(p, 'src/feature/deep/d.js')), 3000, 'an edit in the new folder');
  gitStatus.stopWatching();
});

test('T04: a burst of new folders is one re-read, not one per folder', async () => {
  const dir = repo();
  gitStatus.startWatching(dir, { platform: 'linux' });
  await waitFor(() => gitStatus.linuxWatchStats() && gitStatus.linuxWatchStats().rebuilds === 1 && gitStatus.linuxWatchStats().watching.length === 5, 3000, 'initial watch');
  for (let i = 0; i < 40; i++) write(path.join(dir, 'src', `burst${i}`, 'f.js'));
  await waitFor(() => gitStatus.linuxWatchStats().watching.includes('src/burst39'), 5000, 'the burst to be watched');
  await sleep(gitStatus.LINUX_WATCH.REBUILD_MIN_INTERVAL_MS + 400);
  const { rebuilds } = gitStatus.linuxWatchStats();
  assert.ok(rebuilds <= 3, `40 new folders took ${rebuilds} re-reads`);
  gitStatus.stopWatching();
});

test('T04: left alone, nothing Frame does triggers another re-read or status run (no loop)', async () => {
  const dir = repo();
  gitStatus.startWatching(dir, { platform: 'linux' });
  await waitFor(() => gitStatus.linuxWatchStats() && gitStatus.linuxWatchStats().watching.length === 5, 3000, 'initial watch');
  await sleep(1500); // let the initial status run and its .git writes settle
  const settled = gitStatus.linuxWatchStats().rebuilds;
  const before = pushes.length;
  // Frame's own reads: a status refresh and the re-read's ls-files.
  gitStatus.pushStatus();
  await gitStatus.watchedDirsFor(dir);
  await sleep(gitStatus.LINUX_WATCH.REBUILD_MIN_INTERVAL_MS * 3);
  assert.equal(gitStatus.linuxWatchStats().rebuilds, settled, 'no re-read without a real change');
  assert.ok(pushes.length - before <= 1, 'no status push storm');
  gitStatus.stopWatching();
});

test('T04: other platforms keep the recursive watch', () => {
  const dir = repo();
  gitStatus.startWatching(dir, { platform: 'darwin' });
  assert.equal(gitStatus.linuxWatchStats(), null);
  gitStatus.stopWatching();
});
