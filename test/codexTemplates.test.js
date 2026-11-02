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
  'posthog-node': { PostHog: class { capture() {} captureException() {} identify() {} shutdown() { return Promise.resolve(); } } },
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

// ─── the digest step ──────────────────────────────────────
//
// The digest used to be a conditional section after the last mode, and the
// three specs that ran the whole flow and still skipped it are why it moved.
// What is pinned here is position, not wording: it sits in the shared core
// that binds every mode, it is named wherever the flow says the phase goes to
// `done`, and the old section is gone — for both CLIs, since the template is
// one source.

const section = (prompt, from, to) => {
  const start = prompt.indexOf(from);
  const end = prompt.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `expected "${from}" … "${to}" in the prompt`);
  return prompt.slice(start, end);
};

for (const cli of ['claude-code', 'codex']) {
  test(`${cli}: the digest step sits in the shared core, as numbered steps`, () => {
    const { prompt } = specManager.getCommandPrompt(mkProject(), 'alpha', 'spec.implement', cli);
    const core = section(prompt, '## The shared core', '## Mode · Step by step');
    assert.match(core, /\*\*The digest, when the spec's last task closes\.\*\*/);
    assert.match(core, /\n1\. You write `\.frame\/specs\/alpha\/digest\.md`/);
    assert.match(core, /\n2\. You record the spec's decision cards — at least one — with\s+`node \.frame\/bin\/decision\.js add`/);
    assert.match(core, /\n3\. You run `node \.frame\/bin\/spec-close\.js alpha`/);
    assert.match(core, /\n4\. You fix what it names and run it again, until it reports every item `ok`/);
    assert.match(core, /\n5\. The spec phase goes to `"done"`\./);
    assert.match(core, /\n### The digest\n/);
    assert.match(core, /\nChain: spec\.md → plan\.md → tasks\.md → outcome\.md\n/);
    assert.match(core, /\n### The cards\n/);
    assert.match(core, /\n  "source": "spec:alpha",\n/);
    assert.ok(core.indexOf('### The digest') < core.indexOf('### The cards'), 'the cards follow the digest');
  });

  test(`${cli}: every place the phase goes to done names the digest`, () => {
    const { prompt } = specManager.getCommandPrompt(mkProject(), 'alpha', 'spec.implement', cli);
    const blocks = prompt.split(/\n\s*\n/).filter((block) => block.includes('`"done"`'));
    assert.equal(blocks.length, 4, 'the phase rule, the numbered step, the closing summary, the stop condition');
    for (const block of blocks) {
      assert.match(block, /digest/, `this block sends the phase to done without the digest:\n${block}`);
    }
    assert.match(section(prompt, '### A description governs', '### Saved flows are skills'),
      /one outcome entry per task, the digest when the last task\s+closes, never push/);
  });

  test(`${cli}: the digest rides in the last task's commit, never in one of its own`, () => {
    // The pilot's natural run committed its last task and then the digest
    // separately: the loop committed at its step 7, and the digest step sat in
    // the closing summary that follows the loop. Each mode now runs it before
    // the commit, and the closing summary only reports it.
    const { prompt } = specManager.getCommandPrompt(mkProject(), 'alpha', 'spec.implement', cli);
    assert.match(section(prompt, '## The shared core', '## Mode · Step by step'),
      /part of that last task, not a step after it[\s\S]*never into a commit of their\s+own/);
    assert.match(section(prompt, '## Mode · Step by step', '## Mode · Guided'),
      /\n3\. Write the outcome entry and mark the task `completed`\. If that leaves no\s+pending task for this spec, run the digest step from the shared core now/);

    const loop = section(prompt, 'Per task, in this order:', '### When there is no check');
    const digestAt = loop.indexOf('run the digest step from the shared core now, before the commit');
    const commitAt = loop.indexOf('7. **One atomic commit**');
    assert.ok(digestAt > 0 && commitAt > digestAt, 'the digest step comes before the commit in the loop');
    assert.match(loop, /on the last task the digest and the phase change with them/);

    const closing = section(prompt, '### Closing summary', '## Mode · Describe your own');
    assert.match(closing, /the last task's commit already carries the digest/);
    assert.ok(!/run the digest step/.test(closing), 'nothing is left for after the loop');
  });

  test(`${cli}: a fix after the last task records itself, in the shared core`, () => {
    const { prompt } = specManager.getCommandPrompt(mkProject(), 'alpha', 'spec.implement', cli);
    const core = section(prompt, '## The shared core', '## Mode · Step by step');
    assert.match(core, /\*\*A fix after the last task\.\*\*/);
    assert.match(core, /headed `## Fix — <short title>`/);
    assert.match(core, /a `Revised <YYYY-MM-DD>: <what changed, and why>` line\s+added before the `Chain:` line, and `node \.frame\/bin\/spec-close\.js alpha` run\s+again/);
    assert.match(core, /A bug fixed within the recorded decisions leaves the digest as it is\./);
    assert.match(core, /when the fix overturns a decision one of this spec's cards records, a new\s+card that supersedes it, in the same commit: `node \.frame\/bin\/decision\.js add`/);
    assert.match(core, /if you are not sure, ask the\s+user/);
    assert.match(core, /uses the same shape under `## Fix — <short title>`/);
  });

  test(`${cli}: the conditional section at the end is gone`, () => {
    const { prompt } = specManager.getCommandPrompt(mkProject(), 'alpha', 'spec.implement', cli);
    assert.ok(!prompt.includes('LAST pending task'));
    assert.equal(prompt.split('\n### The digest\n').length, 2, 'the shape is stated once');
    assert.ok(prompt.indexOf('### The digest') < prompt.indexOf('## Mode · Step by step'), 'before the first mode, not after the last');
  });
}

test('the card writer token names the copy that is on disk, for both CLIs', () => {
  const touch = (root, rel) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), '');
  };
  for (const cli of ['claude-code', 'codex']) {
    const render = (root) => specManager.getCommandPrompt(root, 'alpha', 'spec.implement', cli).prompt;
    assert.match(render(mkProject()), /`node \.frame\/bin\/decision\.js add`/, `${cli}: the shipped location`);
    const dev = mkProject();
    touch(dev, 'scripts/decision.js');
    assert.match(render(dev), /`node scripts\/decision\.js add`/, `${cli}: Frame's own repository`);
    touch(dev, '.frame/bin/decision.js');
    assert.match(render(dev), /`node \.frame\/bin\/decision\.js add`/, `${cli}: the shipped copy wins`);
    assert.ok(!render(dev).includes('{decision_script_path}'));
  }
});

test('the /spec.new catalog lists spec-less cards after the specs, and nothing more without a card file', () => {
  const root = mkProject();
  const catalogOf = () => {
    const { prompt } = specManager.getCommandPrompt(root, null, 'spec.new', 'claude-code', 'a description');
    return prompt.slice(prompt.indexOf('## Spec catalog'), prompt.indexOf('## Task'));
  };
  const plain = catalogOf();
  assert.ok(!/\n- card /.test(plain), 'no card lines in the catalog');
  assert.match(plain, /Lines starting `- card <id>` after the specs are decisions recorded outside any spec/);

  const line = (over) => JSON.stringify({
    date: '2026-10-14', decision: 'Card files merge with the union driver.', why: 'A reason.', keywords: ['union merge'],
    files: [], supersedes: null, extends: null, source: 'notes:2026-10-14 Union merge', ...over
  });
  fs.writeFileSync(path.join(root, '.frame', 'decisions.jsonl'),
    [line({ id: '20261014-aaaaaa' }), line({ id: '20261015-bbbbbb', source: 'spec:alpha', decision: 'A spec card.' })].join('\n') + '\n');
  const withCards = catalogOf();
  const specLine = withCards.indexOf('- alpha');
  const cardLine = withCards.indexOf('- card 20261014-aaaaaa · Card files merge with the union driver. · union merge');
  assert.ok(specLine >= 0 && cardLine > specLine, 'the card follows the specs');
  assert.ok(!withCards.includes('A spec card.'), 'a spec card is already its spec\'s line');
});

test('the close script token names the copy that is on disk', () => {
  const render = (root) => specManager.getCommandPrompt(root, 'alpha', 'spec.implement', 'claude-code').prompt;
  const touch = (root, rel) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), '');
  };

  // Neither on disk: the shipped location, which the next project open fills.
  assert.match(render(mkProject()), /`node \.frame\/bin\/spec-close\.js alpha`/);

  // Frame's own repository: the script under development, no shipped copy.
  const dev = mkProject();
  touch(dev, 'scripts/spec-close.js');
  assert.match(render(dev), /`node scripts\/spec-close\.js alpha`/);

  // Both: the shipped copy wins, as it does for every user project.
  touch(dev, '.frame/bin/spec-close.js');
  assert.match(render(dev), /`node \.frame\/bin\/spec-close\.js alpha`/);
  assert.ok(!render(dev).includes('{close_script_path}'));
});
