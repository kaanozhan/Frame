/**
 * Command templates across CLIs.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 *
 * Two properties, and the second is why this file exists at all.
 *
 * Codex must resolve a prompt for all four commands — before this work
 * `getCommandPrompt(…, 'codex')` returned an error and spec-driven from Codex
 * had no flow whatsoever.
 *
 * And Claude Code's rendered prompt must be byte-identical to what shipped.
 * Making the templates one source meant tokenising the few CLI-specific
 * phrases, and a tokenised line is one edit away from quietly rewording the
 * flow for the CLI that already had it. The dialect is therefore asserted
 * against the templates as committed, not against itself.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const Module = require('node:module');
const EXTERNAL_STUBS = {
  '@aptabase/electron/main': { initialize() {}, trackEvent() {} },
  electron: { app: {}, ipcMain: { handle() {}, on() {} } }
};
const loadOriginal = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(EXTERNAL_STUBS, request)) return EXTERNAL_STUBS[request];
  return loadOriginal.call(this, request, ...rest);
};

const specManager = require('../src/main/specManager');
const vocabulary = require('../scripts/toolVocabulary');

const REPO = path.join(__dirname, '..');
const COMMANDS = ['spec.new', 'spec.plan', 'spec.tasks', 'spec.implement'];

/** A project with one spec, so getCommandPrompt has a status.json to read. */
function mkProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-tmpl-'));
  const dir = path.join(root, '.frame', 'specs', 'alpha');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'status.json'),
    JSON.stringify({ slug: 'alpha', title: 'Alpha', phase: 'planned' }));
  return root;
}

// ─── every CLI resolves every command ─────────────────────

test('Codex resolves a prompt for all four commands', () => {
  const root = mkProject();
  for (const command of COMMANDS) {
    const res = specManager.getCommandPrompt(root, 'alpha', command, 'codex');
    assert.ok(!res.error, `${command}: ${res.error}`);
    assert.ok(res.prompt.length > 1000, `${command}: suspiciously short`);
  }
});

test('a tool with no templates of its own falls back to the base', () => {
  const root = mkProject();
  const res = specManager.getCommandPrompt(root, 'alpha', 'spec.plan', 'some-future-cli');
  assert.ok(!res.error, 'an unknown CLI still gets the flow rather than nothing');
});

test('no placeholder survives into a rendered prompt', () => {
  const root = mkProject();
  for (const cli of ['claude-code', 'codex']) {
    for (const command of COMMANDS) {
      const { prompt } = specManager.getCommandPrompt(root, 'alpha', command, cli);
      const left = prompt.match(/\{[a-z_]+\}/g) || [];
      assert.deepEqual(left, [], `${cli}/${command} left ${left.join(', ')} unresolved`);
    }
  }
});

// ─── the dialect must not reword Claude Code's flow ───────

test("Claude Code's rendered prompt is byte-identical to the committed templates", () => {
  // The templates as committed, interpolated by hand with the same variables
  // getCommandPrompt uses. If tokenising a line changed its wording, this is
  // where it shows up — the whole point of tokenising was to add a CLI, not
  // to edit the flow.
  const root = mkProject();
  for (const command of COMMANDS) {
    const committed = execFileSync('git',
      ['show', `HEAD:src/templates/commands/claude-code/${command}.md`],
      { cwd: REPO, encoding: 'utf8' });

    const { prompt } = specManager.getCommandPrompt(root, 'alpha', command, 'claude-code');
    // Re-render the committed template with the values this run produced, so
    // only genuine wording differences remain.
    const vars = {
      ...vocabulary.dialect('claude-code'),
      project_path: root,
      description: '',
      slug: 'alpha',
      title: 'Alpha'
    };
    const expected = committed.replace(/\{(\w+)\}/g, (m, key) => {
      if (vars[key] != null) return String(vars[key]);
      // Values this harness does not reproduce (report paths, the catalog)
      // are lifted from the real prompt by leaving the token in both.
      return m;
    });

    // Compare only the lines that carry no unreproduced token.
    const a = expected.split('\n');
    const b = prompt.split('\n');
    for (let i = 0; i < a.length; i += 1) {
      if (/\{[a-z_]+\}/.test(a[i])) continue;
      assert.equal(b[i], a[i], `${command} line ${i + 1} changed wording`);
    }
  }
});

test('the Claude Code dialect reproduces the phrase that shipped', () => {
  assert.equal(vocabulary.dialect('claude-code').ask_mechanism, 'the `AskUserQuestion` tool');
  assert.equal(vocabulary.dialect('claude-code').tool_id, 'claude-code');
});

test('Codex gets a mechanism it actually has', () => {
  const d = vocabulary.dialect('codex');
  assert.equal(d.tool_id, 'codex');
  assert.ok(!/AskUserQuestion/.test(d.ask_mechanism),
    'Codex has no structured-question tool; naming one would send it after something that is not there');
});

// ─── the two prompts differ only where they must ──────────

test('Codex and Claude Code prompts differ only in the dialect lines', () => {
  const root = mkProject();
  for (const command of COMMANDS) {
    const a = specManager.getCommandPrompt(root, 'alpha', command, 'claude-code').prompt.split('\n');
    const b = specManager.getCommandPrompt(root, 'alpha', command, 'codex').prompt.split('\n');
    assert.equal(a.length, b.length, `${command}: line count drifted`);
    const differing = a.reduce((n, line, i) => (line === b[i] ? n : n + 1), 0);
    // The dialect is the only thing that may differ, and today that is one
    // line per template except spec.implement, whose autonomous handoff wraps
    // to four. The ceiling is the count of dialect lines, not a round number:
    // a template that starts diverging beyond its dialect is the drift one
    // source was chosen to prevent, and it should fail here.
    const ceiling = command === 'spec.implement' ? 4 : 1;
    assert.ok(differing <= ceiling,
      `${command}: ${differing} lines differ, expected at most ${ceiling} — the templates are drifting apart`);
  }
});

// ─── autonomous is Claude Code's, and says so ─────────────

test('a dialect value that names the spec is filled, not left literal', () => {
  // Claude Code's handoff names the launcher and the slug. A `{slug}` inside
  // a dialect value would otherwise reach the user as literal text, telling
  // them to run the launcher against a spec called "{slug}".
  const root = mkProject();
  const { prompt } = specManager.getCommandPrompt(root, 'alpha', 'spec.implement', 'claude-code');
  assert.match(prompt, /implement-launch\.js alpha`/);
  assert.ok(!prompt.includes('implement-launch.js {slug}'));
});

test('Codex is told autonomous is unavailable, not sent to a launcher that cannot serve it', () => {
  const root = mkProject();
  const { prompt } = specManager.getCommandPrompt(root, 'alpha', 'spec.implement', 'codex');
  assert.match(prompt, /available for Codex yet/, 'the handoff wraps, so match a single line of it');
  assert.ok(!prompt.includes('implement-launch.js alpha'),
    'pointing Codex at a Claude-only launcher would send the user in a circle');
});

test('autonomous launch flags are Claude Code\'s and go nowhere else', () => {
  // `--settings` and `--permission-mode` are Claude Code flags; handing them
  // to another CLI is an unparseable command line, not a degraded run.
  const root = mkProject();
  const dir = path.join(root, '.frame', 'specs', 'alpha');
  const status = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'status.json'),
    JSON.stringify({ ...status, implement_mode: 'autonomous' }));

  assert.deepEqual(specManager.getImplementLaunchFlags(root, 'alpha', 'codex'), []);
  const claude = specManager.getImplementLaunchFlags(root, 'alpha', 'claude-code');
  assert.ok(claude.includes('--permission-mode'), 'Claude Code still gets its flags');
});
