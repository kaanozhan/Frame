/**
 * Untrusted-Codex-hook detection tests.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 *
 * Codex will not run a hook until the user trusts it in its TUI, and an
 * untrusted hook does nothing and says nothing. T01 went looking for a
 * readable trust flag and found none — not in `config.toml`, not a
 * `hooks.state` file, not a table in Codex's own SQLite. So the state is read
 * behaviourally: the hint scripts record what they did under a host of
 * `codex-hook`, and hooks installed with no such record have never run.
 *
 * The assertions worth having are the two that keep it from crying wolf. A
 * fresh install has not run yet either, and a missing log is not evidence of
 * anything — reporting "untrusted" in either case would train the user to
 * ignore the notice, which is the same failure as not having one.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

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
const { IPC } = require('../src/shared/ipcChannels');
const activity = require('../scripts/activity-log');

const PROJECT = '/tmp/frame-codex-trust-project';

/** A CODEX_HOME with Frame's hooks installed. */
function installedHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-trust-home-'));
  frameProject.installCodexHintHook(PROJECT, { home });
  return home;
}

/** Point the activity root at a temp dir and optionally seed one record. */
function withActivity(records) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-trust-act-'));
  process.env.FRAME_ACTIVITY_HOME = root;
  if (records) {
    const file = activity.filePath(activity.projectKey(PROJECT));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  return root;
}

const priorActivityHome = process.env.FRAME_ACTIVITY_HOME;
test.after(() => {
  if (priorActivityHome === undefined) delete process.env.FRAME_ACTIVITY_HOME;
  else process.env.FRAME_ACTIVITY_HOME = priorActivityHome;
});

// ─── the state it exists to report ────────────────────────

test('installed with nothing ever recorded reads as untrusted', () => {
  const home = installedHome();
  withActivity([]);
  const state = frameProject.codexHookTrustState(PROJECT, { home });
  assert.deepEqual(state, { installed: true, seen: false, untrusted: true });
});

test('one codex-hook record is enough to say they run', () => {
  const home = installedHome();
  withActivity([
    { t: new Date().toISOString(), v: 1, ev: 'hint.quiet', host: 'codex-hook', mode: 'search', reason: 'no-match' }
  ]);
  const state = frameProject.codexHookTrustState(PROJECT, { home });
  assert.equal(state.seen, true);
  assert.equal(state.untrusted, false);
});

// ─── the two ways it must not cry wolf ────────────────────

test('a Claude Code record is not evidence that Codex hooks run', () => {
  const home = installedHome();
  withActivity([
    { t: new Date().toISOString(), v: 1, ev: 'hint.injected', host: 'claude-hook', mode: 'search' }
  ]);
  assert.equal(frameProject.codexHookTrustState(PROJECT, { home }).untrusted, true);
});

test('a log that does not exist yet is not evidence of anything', () => {
  const home = installedHome();
  withActivity(null); // activity root exists, no file in it
  const state = frameProject.codexHookTrustState(PROJECT, { home });
  assert.equal(state.installed, true);
  assert.equal(state.untrusted, false, 'no log is not proof the hooks are dead');
});

test('records older than the install do not count as having run', () => {
  const home = installedHome();
  const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  withActivity([{ t: old, v: 1, ev: 'hint.quiet', host: 'codex-hook', mode: 'search', reason: 'no-match' }]);
  const state = frameProject.codexHookTrustState(PROJECT, { home, sinceMs: Date.now() - 60 * 1000 });
  assert.equal(state.untrusted, true, 'a run from before this install proves nothing about it');
});

// ─── nothing installed, nothing to say ────────────────────

test('hooks that were never installed are not untrusted', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-trust-empty-'));
  withActivity([]);
  assert.deepEqual(frameProject.codexHookTrustState(PROJECT, { home }),
    { installed: false, seen: false, untrusted: false });
});

test("a user's own hooks.json with none of Frame's entries reads as not installed", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-trust-foreign-'));
  fs.writeFileSync(path.join(home, 'hooks.json'), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] }
  }, null, 2) + '\n');
  withActivity([]);
  assert.equal(frameProject.codexHookTrustState(PROJECT, { home }).installed, false);
});

test('a corrupt hooks.json is reported as not installed, never as untrusted', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-trust-bad-'));
  fs.writeFileSync(path.join(home, 'hooks.json'), '{ not json');
  withActivity([]);
  assert.deepEqual(frameProject.codexHookTrustState(PROJECT, { home }),
    { installed: false, seen: false, untrusted: false });
});

test('a torn line in the log is skipped, not treated as evidence', () => {
  const home = installedHome();
  const root = withActivity([]);
  const file = activity.filePath(activity.projectKey(PROJECT));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"host":"codex-hook"  <-- torn\n');
  assert.equal(frameProject.codexHookTrustState(PROJECT, { home }).untrusted, true);
  assert.ok(root);
});

// ─── the notice reaches the user ──────────────────────────

test('project init sends the notice when hooks are installed but never run', async () => {
  // The detection only matters if it surfaces. Codex declines an untrusted
  // hook in silence, so without this the user sees a Frame that looks
  // configured and delivers nothing.
  const sent = [];
  const win = { isDestroyed: () => false, webContents: { send: (ch, p) => sent.push([ch, p]) } };
  frameProject.init(win);

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-notice-home-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-notice-proj-'));
  withActivity([]);
  process.env.CODEX_HOME = home;
  try {
    await frameProject.runProjectInit(project, 'demo');
  } finally {
    delete process.env.CODEX_HOME;
    frameProject.init(null);
  }

  const notice = sent.find(([ch]) => ch === IPC.CODEX_HOOKS_UNTRUSTED);
  assert.ok(notice, 'the untrusted state must reach the renderer');
});

test('no notice when Codex is not the active tool', async () => {
  const sent = [];
  const win = { isDestroyed: () => false, webContents: { send: (ch, p) => sent.push([ch, p]) } };
  frameProject.init(win);

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-notice2-home-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-notice2-proj-'));
  withActivity([]);
  process.env.CODEX_HOME = home;
  ACTIVE.id = 'claude';
  try {
    await frameProject.runProjectInit(project, 'demo');
  } finally {
    ACTIVE.id = 'codex';
    delete process.env.CODEX_HOME;
    frameProject.init(null);
  }

  assert.ok(!sent.some(([ch]) => ch === IPC.CODEX_HOOKS_UNTRUSTED),
    'a Claude Code project must not be told about Codex hooks');
});
