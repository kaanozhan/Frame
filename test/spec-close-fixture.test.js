/**
 * Spec close step — fixture and runner tests.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 *
 * The test run (scripts/eval/spec-close/) spends real model time, so
 * everything about it that can be checked without an agent is checked here:
 * each fixture kind is built and driven by piping hook payloads through the
 * fixture's own `.frame/bin/`, using the hook commands exactly as its
 * `.claude/settings.json` registers them. If a fixture cannot produce the
 * reminder with no agent in the loop, a session run on it measures nothing.
 *
 * The runner's own arithmetic — reading a transcript, building the launch
 * line, the table — is pure and tested directly. No session is started.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { makeFixture, KINDS, FINISHED, SLUG, PROMPTS, DIGEST_MD, CARD_JSONL } = require('../scripts/eval/spec-close/make-fixture');
const runner = require('../scripts/eval/spec-close/run');
const { SPEC_HINT_HOOKS } = require('../src/shared/frameTemplates');

const POSIX = process.platform !== 'win32';
const skip = !POSIX && 'the registered hook commands are sh';

// Both close items are owed: the fixture ships decision.js, as Frame does.
const REMINDER = `You completed the last task of spec "${SLUG}" in this session and it has no digest or decision cards yet. ` +
  `Finish it: run node .frame/bin/spec-close.js ${SLUG} and write what it asks for.`;
const GOOD_DIGEST = [
  '---', 'keywords: greeting, greet, helper', '---',
  'Added a greet(name) helper and its tests.', '',
  'Chain: spec.md → plan.md → tasks.md → outcome.md', ''
].join('\n');

function withFixture(kind, fn) {
  const fixture = makeFixture({ kind });
  try {
    return fn(fixture);
  } finally {
    fs.rmSync(fixture.base, { recursive: true, force: true });
  }
}

/** The fixture's environment for anything run inside it: its own activity home, nobody else's root. */
function envOf(fixture) {
  const env = { ...process.env, FRAME_ACTIVITY_HOME: fixture.activityHome };
  delete env.FRAME_PROJECT_ROOT;
  delete env.FRAME_SPEC_HINT_MODE;
  return env;
}

/**
 * Run one registered hook the way Claude Code would: the command string from
 * the fixture's own settings, through `sh -c`, in the project, payload on
 * stdin. Returns the additionalContext, or null for no output.
 */
function hook(fixture, event, script, payload) {
  const settings = JSON.parse(fs.readFileSync(path.join(fixture.root, '.claude', 'settings.json'), 'utf8'));
  const command = settings.hooks[event].flatMap((entry) => entry.hooks).map((h) => h.command)
    .find((c) => c.includes(`.frame/bin/${script}`));
  assert.ok(command, `${event} registers ${script}`);
  const stdout = execFileSync('sh', ['-c', command], {
    cwd: fixture.root, input: JSON.stringify({ cwd: fixture.root, ...payload }), encoding: 'utf8', env: envOf(fixture)
  });
  return stdout.trim() ? JSON.parse(stdout).hookSpecificOutput.additionalContext : null;
}

const bash = (fixture, session, command) =>
  hook(fixture, 'PreToolUse', 'docs-hint.js pre-edit', { session_id: session, tool_name: 'Bash', tool_input: { command } });
const prompt = (fixture, session, text) =>
  hook(fixture, 'UserPromptSubmit', 'spec-hint.js prompt', { session_id: session, prompt: text });

/** No close reminder in a hook's output — related specs may still be there, as Frame sends them. */
const noReminder = (ctx) => ctx === null || !ctx.includes('You completed the last task');

const git = (fixture, ...args) => execFileSync('git', args, { cwd: fixture.root, encoding: 'utf8' }).trim();

function closeCheck(fixture) {
  return JSON.parse(execFileSync('node', [path.join(fixture.root, '.frame', 'bin', 'spec-close.js'), SLUG, '--json'], {
    cwd: fixture.root, encoding: 'utf8', env: { ...envOf(fixture), FRAME_ACTIVITY_HOME: path.join(fixture.base, 'measurement') }
  }));
}

const writeDigest = (fixture) =>
  fs.writeFileSync(path.join(fixture.root, '.frame', 'specs', SLUG, 'digest.md'), GOOD_DIGEST);

/** The spec's card, recorded the way the template tells an agent to: through the fixture's own decision.js. */
const writeCard = (fixture) => execFileSync('node', [path.join(fixture.root, '.frame', 'bin', 'decision.js'), 'add', JSON.stringify({
  decision: 'greet(name) is a plain function, not a configurable class.',
  why: 'Nothing asks for a second salutation.',
  keywords: ['greeting', 'greet'],
  files: ['src/greet.js'],
  source: `spec:${SLUG}`
})], { cwd: fixture.root, encoding: 'utf8', env: { ...envOf(fixture), FRAME_ACTIVITY_HOME: path.join(fixture.base, 'measurement') } });

// ─── what every fixture is ────────────────────────────────

for (const kind of KINDS) {
  test(`${kind}: a clean project on the spec's branch, with what Frame installs`, { skip }, () => {
    withFixture(kind, (fixture) => {
      assert.equal(fixture.prompt, PROMPTS[kind]);
      assert.equal(git(fixture, 'status', '--porcelain'), '', 'pre-flight must have nothing to ask');
      assert.equal(git(fixture, 'branch', '--show-current'), `feat/${SLUG}`);
      assert.equal(git(fixture, 'remote'), '', 'no remote to push to');

      const settings = JSON.parse(fs.readFileSync(path.join(fixture.root, '.claude', 'settings.json'), 'utf8'));
      assert.deepEqual(settings, { hooks: SPEC_HINT_HOOKS }, 'the hooks are Frame\'s, not a copy of them');
      for (const file of ['spec-close.js', 'spec-close-state.js', 'docs-hint.js', 'spec-hint.js', 'spec-command-hint.js', 'decision.js', 'decision-cards.js']) {
        assert.ok(fs.existsSync(path.join(fixture.root, '.frame', 'bin', file)), `.frame/bin/${file}`);
      }
      assert.ok(fs.existsSync(path.join(fixture.root, '.frame', 'runtime', 'commands', 'claude-code', 'spec.implement.md')));
      assert.equal(git(fixture, 'ls-files', '.frame/bin', '.frame/runtime'), '', 'machine-local folders stay out of the commit');

      const status = JSON.parse(fs.readFileSync(path.join(fixture.root, '.frame', 'specs', SLUG, 'status.json'), 'utf8'));
      assert.equal(status.implement_mode, 'autonomous');
      const digest = path.join(fixture.root, '.frame', 'specs', SLUG, 'digest.md');
      const cardFile = path.join(fixture.root, '.frame', 'decisions.jsonl');
      if (kind.startsWith('fix-')) {
        assert.equal(fs.readFileSync(digest, 'utf8'), DIGEST_MD, 'a finished spec carries its digest');
        assert.equal(fixture.digestBefore, DIGEST_MD);
        assert.equal(fs.readFileSync(cardFile, 'utf8'), CARD_JSONL, 'and its decision card');
      } else {
        assert.ok(!fs.existsSync(digest), 'only a finished spec starts with a digest');
        assert.equal(fixture.digestBefore, null);
        assert.ok(!fs.existsSync(cardFile), 'and only a finished spec starts with a card');
      }
      assert.equal(status.phase, FINISHED.includes(kind) ? 'done' : kind === 'natural' ? 'tasks_generated' : 'implementing');
      assert.ok(fs.existsSync(path.join(fixture.root, '.frame', 'index', 'spec-index.json')), 'the spec index is built, as Frame keeps it');
      assert.ok(!fixture.activityHome.startsWith(fixture.root), 'the activity home is beside the repository, not in it');
    });
  });
}

test('an unknown kind is refused', () => {
  assert.throws(() => makeFixture({ kind: 'surprise' }), /unknown kind/);
});

// ─── natural ──────────────────────────────────────────────

test('natural: nothing is said until both tasks close, then the next tool call says it', { skip }, () => {
  withFixture('natural', (fixture) => {
    assert.equal(closeCheck(fixture).verdict, 'not-due');

    // The session's first look: nothing is closed yet.
    assert.ok(noReminder(prompt(fixture, 's', fixture.prompt)));
    assert.equal(bash(fixture, 's', 'npm test'), null);

    // The command the user typed is staged by Frame's own hook, and the flow
    // it stages carries the digest step with the script where this project has it.
    hook(fixture, 'UserPromptSubmit', 'spec-command-hint.js prompt', { session_id: 's', prompt: fixture.prompt });
    const staged = fs.readFileSync(path.join(fixture.root, '.frame', 'runtime', 'prompts', `${SLUG}__spec.implement.md`), 'utf8');
    assert.match(staged, new RegExp(`2\\. You record the spec's decision cards — at least one — with\\s+\`node \\.frame/bin/decision\\.js add\``));
    assert.match(staged, new RegExp(`3\\. You run \`node \\.frame/bin/spec-close\\.js ${SLUG}\``));

    // What the session does: both tasks completed, some time after the baseline.
    const file = path.join(fixture.root, '.frame', 'tasks.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const at = new Date(Date.now() + 5000).toISOString();
    for (const task of data.tasks) Object.assign(task, { status: 'completed', completedAt: at, updatedAt: at });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));

    assert.equal(bash(fixture, 's', 'git add -A'), REMINDER);
    assert.equal(closeCheck(fixture).verdict, 'missing');

    writeDigest(fixture);
    assert.equal(closeCheck(fixture).verdict, 'missing', 'the digest alone leaves the card owed');
    writeCard(fixture);
    assert.equal(bash(fixture, 'another', 'git status'), null, 'absent once the digest and the card are written');
    assert.equal(closeCheck(fixture).verdict, 'ok');
    assert.deepEqual(runner.closeRows(fixture.activityHome).reminders, 1);
  });
});

// ─── earlier-close ────────────────────────────────────────

test('earlier-close: a session that did not close the spec is not told about it', { skip }, () => {
  // The spec closed an hour before this session began: under D16 that is
  // someone else's unfinished work, and the conversation stays clean.
  withFixture('earlier-close', (fixture) => {
    assert.equal(closeCheck(fixture).verdict, 'missing', 'still owed — the close script says so');
    assert.ok(!/digest|spec|close/i.test(fixture.prompt), 'the prompt gives nothing away');

    assert.ok(noReminder(prompt(fixture, 's', fixture.prompt)));
    assert.equal(hook(fixture, 'UserPromptSubmit', 'spec-command-hint.js prompt', { session_id: 's', prompt: fixture.prompt }), null);
    assert.equal(bash(fixture, 's', 'cat src/greet.js'), null);

    const rows = runner.closeRows(fixture.activityHome);
    assert.equal(rows.reminders, 0);
    assert.deepEqual(rows.quiet, ['closed-earlier'], 'why it stayed quiet is recorded, once');
  });
});

// ─── closing-turn ─────────────────────────────────────────

test('closing-turn: the call that closes the task is silent; the next one carries the reminder', { skip }, () => {
  withFixture('closing-turn', (fixture) => {
    assert.equal(closeCheck(fixture).verdict, 'not-due');
    assert.ok(noReminder(prompt(fixture, 's', fixture.prompt)), 'nothing is closed when the prompt arrives');

    // PreToolUse runs before the command: the task is still open.
    assert.equal(bash(fixture, 's', 'node tools/close-task.js'), null);
    assert.equal(execFileSync('node', ['tools/close-task.js'], { cwd: fixture.root, encoding: 'utf8' }).trim(), 'T02 completed');

    assert.equal(bash(fixture, 's', 'git status --short'), REMINDER);
    assert.equal(prompt(fixture, 's', 'thanks'), null, 'not repeated at the next prompt');

    writeDigest(fixture);
    writeCard(fixture);
    assert.equal(bash(fixture, 'another', 'git status --short'), null, 'absent once the digest and the card are written');
    assert.equal(closeCheck(fixture).verdict, 'ok');
    assert.equal(runner.closeRows(fixture.activityHome).reminders, 1);
  });
});

test('rows are read whatever path the hook resolved the project by', { skip }, () => {
  // The pilot's first table read zero reminders off three sessions that had
  // each received one: the CLI hands hooks the resolved path (/private/var/…
  // on macOS, where the temp directory is a symlink), and the rows were filed
  // under that path's key while the runner looked under its own.
  withFixture('earlier-close', (fixture) => {
    const elsewhere = { ...fixture, root: `${fixture.root}-as-the-hook-saw-it` };
    fs.symlinkSync(fixture.root, elsewhere.root);
    try {
      assert.ok(noReminder(prompt(elsewhere, 's', fixture.prompt)));
      const rows = runner.closeRows(fixture.activityHome);
      assert.deepEqual(rows.quiet, ['closed-earlier'], 'the row filed under the other path is still found');
    } finally {
      fs.rmSync(elsewhere.root, { force: true });
    }
  });
});

test('closing-turn: when the closing call is the turn\'s last, the next prompt carries the reminder', { skip }, () => {
  // The third pilot's shape: both commands in one shell call, so the only
  // PreToolUse runs before the task closes and the turn ends there.
  withFixture('closing-turn', (fixture) => {
    assert.ok(noReminder(prompt(fixture, 's', fixture.prompt)));
    assert.equal(bash(fixture, 's', 'node tools/close-task.js; git status --short'), null, 'before the command runs');
    execFileSync('node', ['tools/close-task.js'], { cwd: fixture.root });
    // The second turn, resumed under the same session id.
    assert.equal(prompt(fixture, 's', runner.FOLLOW_UP['closing-turn']), REMINDER);
    assert.equal(runner.closeRows(fixture.activityHome).reminders, 1);
  });
});

// ─── fixes after close ────────────────────────────────────

const editGreet = (fixture, session) =>
  hook(fixture, 'PreToolUse', 'spec-hint.js pre-edit',
    { session_id: session, tool_name: 'Edit', tool_input: { file_path: path.join(fixture.root, 'src', 'greet.js') } });

const FIX_SENTENCE = new RegExp(`If this edit fixes or adjusts the finished work of ${SLUG}, record it in the same commit: ` +
  `a "## Fix — <title>" entry in \\.frame/specs/${SLUG}/outcome\\.md`);

function appendFix(fixture, title) {
  fs.appendFileSync(path.join(fixture.root, '.frame', 'specs', SLUG, 'outcome.md'),
    `## Fix — ${title}\n\nFixed in testing. Files touched: \`src/greet.js\`.\n\n_Captured: 2026-10-14 · 1 file change_\n\n---\n`);
}

const inspected = (fixture) => {
  const runDir = path.join(fixture.base, 'run');
  fs.mkdirSync(runDir, { recursive: true });
  const { rows, facts } = runner.inspect(fixture, runDir);
  return { ...facts, reminders: rows.reminders };
};

test('fix-bug: editing the finished spec\'s file shows the fix rule; a right fix passes, a rewritten digest does not', { skip }, () => {
  withFixture('fix-bug', (fixture) => {
    assert.ok(!/digest|outcome|spec-close/i.test(fixture.prompt), 'the prompt gives nothing away');
    assert.equal(closeCheck(fixture).verdict, 'ok');
    assert.ok(noReminder(prompt(fixture, 's', fixture.prompt)), 'no close reminder: nothing is owed');
    assert.match(editGreet(fixture, 's'), FIX_SENTENCE);

    const before = inspected(fixture);
    assert.equal(before.testsPass, false, 'the planted bug fails the tests');
    assert.equal(runner.judge('fix-bug', before), false);

    // What a session that follows the rule leaves behind.
    const greet = path.join(fixture.root, 'src', 'greet.js');
    fs.writeFileSync(greet, fs.readFileSync(greet, 'utf8').replace('`Hello ${', '`Hello, ${'));
    appendFix(fixture, 'The comma after Hello');
    const after = inspected(fixture);
    assert.deepEqual([after.testsPass, after.behaviour, after.fixEntry, after.digestChanged], [true, true, true, false]);
    assert.equal(runner.judge('fix-bug', after), true);

    // A digest rewritten for a bug fixed within its decisions is not a pass.
    fs.appendFileSync(path.join(fixture.root, '.frame', 'specs', SLUG, 'digest.md'), '\nRevised 2026-10-14: added the comma.\n');
    assert.equal(runner.judge('fix-bug', inspected(fixture)), false);
  });
});

test('fix-decision: overturning the digest\'s rule passes only with a Fix entry and a Revised line', { skip }, () => {
  withFixture('fix-decision', (fixture) => {
    assert.match(fs.readFileSync(path.join(fixture.root, '.frame', 'specs', SLUG, 'digest.md'), 'utf8'), /greets a `stranger`/,
      'the digest records the rule the prompt overturns');
    assert.match(fixture.prompt, /friend/);
    assert.match(editGreet(fixture, 's'), FIX_SENTENCE);

    // The code and its tests change, and the Fix entry is written — but not the digest.
    const swapIn = (rel, from, to) => {
      const file = path.join(fixture.root, rel);
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split(from).join(to));
    };
    swapIn('src/greet.js', "'stranger'", "'friend'");
    swapIn('test/greet.test.js', 'stranger', 'friend');
    appendFix(fixture, 'An empty name greets a friend');
    const withoutRevision = inspected(fixture);
    assert.deepEqual([withoutRevision.testsPass, withoutRevision.behaviour, withoutRevision.fixEntry], [true, true, true]);
    assert.equal(runner.judge('fix-decision', withoutRevision), false, 'the digest still states the old rule');

    swapIn('.frame/specs/greeting-helper/digest.md', 'greets a `stranger`', 'greets a `friend`');
    swapIn('.frame/specs/greeting-helper/digest.md', '\nChain:', 'Revised 2026-10-14: an empty or missing name greets a friend, not a stranger — asked for in testing.\n\nChain:');
    const revised = inspected(fixture);
    assert.equal(revised.revisedLine, true);
    assert.equal(revised.verdict, 'ok', 'a revised digest still passes the close script');
    assert.equal(runner.judge('fix-decision', revised), true);
  });
});

test('natural: the digest passes only when it rides in a commit that carries code', { skip }, () => {
  withFixture('natural', (fixture) => {
    const g = (...args) => git(fixture, ...args);
    const file = path.join(fixture.root, '.frame', 'tasks.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const t of data.tasks) Object.assign(t, { status: 'completed', completedAt: new Date().toISOString() });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    fs.writeFileSync(path.join(fixture.root, 'src', 'greet.js'), "module.exports = { greet: (n) => `Hello, ${n || 'stranger'}!` };\n");

    // The pilot's shape: the last task's commit, then the digest alone.
    g('add', '-A');
    g('commit', '-q', '-m', 'T02');
    writeDigest(fixture);
    writeCard(fixture);
    g('add', '-A');
    g('commit', '-q', '-m', 'digest');
    assert.equal(runner.judge('natural', inspected(fixture)), false, 'a digest commit of its own');

    // The template's shape: the digest in the last task's commit.
    g('reset', '-q', '--hard', 'HEAD~2');
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    fs.writeFileSync(path.join(fixture.root, 'src', 'greet.js'), "module.exports = { greet: (n) => `Hello, ${n || 'stranger'}!` };\n");
    writeDigest(fixture);
    writeCard(fixture);
    g('add', '-A');
    g('commit', '-q', '-m', 'T02 with its digest');
    const facts = inspected(fixture);
    assert.equal(facts.digestWithCode, true);
    assert.equal(runner.judge('natural', facts), true);
  });
});

test('every kind has a pass rule, and no rule passes on nothing', () => {
  for (const kind of KINDS) assert.equal(runner.judge(kind, {}), false, kind);
  assert.equal(runner.judge('earlier-close', { reminders: 0, verdict: 'missing' }), true);
  assert.equal(runner.judge('earlier-close', { reminders: 1, verdict: 'missing' }), false, 'a reminder is a failure here');
  assert.equal(runner.judge('closing-turn', { verdict: 'ok' }), true);
  assert.equal(runner.judge('surprise', { verdict: 'ok' }), false);
});

// ─── the runner, without a session ────────────────────────

test('--n is required: there is no default spend', () => {
  assert.throws(() => runner.parseArgs([]), /--n <count> is required/);
  assert.throws(() => runner.parseArgs(['--n', '0']), /--n/);
  assert.throws(() => runner.parseArgs(['--n', '1', '--kinds', 'natural,nope']), /unknown kind "nope"/);
  assert.throws(() => runner.parseArgs(['--n', '1', '--fast']), /unknown option --fast/);
  const opts = runner.parseArgs(['--n', '10', '--kinds', 'closing-turn', '--concurrency', '5', '--keep']);
  assert.deepEqual([opts.n, opts.kinds, opts.concurrency, opts.keep, opts.dryRun], [10, ['closing-turn'], 5, true, false]);
});

test('a session is launched as Frame launches an autonomous run, capped and cut off', () => {
  const args = runner.agentArgs({ prompt: 'hello', settingsPath: '/tmp/p.json', budget: 2, model: null });
  const after = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(after('-p'), 'hello');
  assert.equal(after('--max-budget-usd'), '2');
  assert.equal(after('--settings'), '/tmp/p.json');
  assert.equal(after('--permission-mode'), 'auto');
  assert.equal(after('--setting-sources'), 'project', 'the fixture\'s hooks, not the hooks of whoever runs this');
  assert.equal(after('--mcp-config'), '{"mcpServers":{}}');
  assert.ok(args.includes('--strict-mcp-config') && args.includes('--no-session-persistence'));
  assert.ok(!args.includes('--dangerously-skip-permissions'));
  assert.ok(!args.includes('--bare'), '--bare would skip the hooks under test');
  for (const rule of runner.DISALLOWED) assert.ok(args.includes(rule));
  assert.ok(!args.includes('--model'));
  assert.equal(runner.agentArgs({ prompt: 'x', settingsPath: 'p', budget: 1, model: 'some-model' }).slice(-2).join(' '), '--model some-model');
});

test('only closing-turn has a second turn, and only it keeps its session for --resume', () => {
  assert.deepEqual(Object.keys(runner.FOLLOW_UP), ['closing-turn']);
  assert.equal(runner.FOLLOW_UP['closing-turn'], 'Thanks.', 'neutral — not a question that steers toward the work');

  const base = { prompt: 'p', settingsPath: '/tmp/p.json', budget: 2, model: null };
  assert.ok(runner.agentArgs(base).includes('--no-session-persistence'), 'one-turn sessions leave nothing behind');
  const kept = runner.agentArgs({ ...base, persist: true });
  assert.ok(!kept.includes('--no-session-persistence'));
  assert.ok(!kept.includes('--resume'));
  const second = runner.agentArgs({ ...base, prompt: 'Thanks.', persist: true, resume: 'abc-123' });
  assert.equal(second[second.indexOf('--resume') + 1], 'abc-123');
  assert.equal(second[second.indexOf('-p') + 1], 'Thanks.');
  assert.ok(!second.includes('--fork-session'), 'resuming keeps the session id the helper keys on');
});

test('a session inherits nothing that ties it to the session it was started from', () => {
  const env = runner.sessionEnv({
    PATH: '/usr/bin', HOME: '/home/u',
    FRAME_PROJECT_ROOT: '/somewhere/else', FRAME_NODE: '/Applications/Frame.app/x', FRAME_SPEC_HINT_MODE: 'signal',
    CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'parent', CLAUDE_EFFORT: 'high', CLAUDE_CONFIG_DIR: '/home/u/.claude'
  }, { activityHome: '/fx/activity' });
  assert.deepEqual(Object.keys(env).sort(), ['CLAUDE_CONFIG_DIR', 'FRAME_ACTIVITY_HOME', 'FRAME_NODE', 'HOME', 'PATH']);
  assert.equal(env.FRAME_ACTIVITY_HOME, '/fx/activity');
  assert.equal(env.FRAME_NODE, process.execPath, 'set, so the implement flow leaves opening its report to Frame');
});

test('a transcript is read for cost, turns, tool calls and the two things a session can do about a digest', () => {
  const lines = [
    { type: 'system', subtype: 'init', model: 'some-model', session_id: 's' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', name: 'Bash', input: { command: 'node tools/close-task.js' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'T02 completed' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: '/p/.frame/specs/x/digest.md', content: '…' } }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'node .frame/bin/spec-close.js x' } }] } },
    { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.4321, num_turns: 4, duration_ms: 61000 }
  ];
  const text = `${lines.map((l) => JSON.stringify(l)).join('\n')}\nnot json at all\n`;
  assert.deepEqual(runner.parseTranscript(text), {
    model: 'some-model', sessionId: 's', costUsd: 0.4321, turns: 4, durationMs: 61000, toolCalls: 3, tools: { Bash: 2, Write: 1 },
    resultSubtype: 'success', isError: false, ranCloseScript: 1, wroteDigest: 1
  });
  // Two turns back to back: cost, turns and time add up; the first session id stays.
  const second = [
    { type: 'system', subtype: 'init', model: 'some-model', session_id: 's' },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'node .frame/bin/spec-close.js x' } }] } },
    { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.1, num_turns: 2, duration_ms: 9000 }
  ].map((l) => JSON.stringify(l)).join('\n');
  const both = runner.parseTranscript(`${text}\n${second}`);
  assert.equal(both.sessionId, 's');
  assert.equal(Math.round(both.costUsd * 1e4) / 1e4, 0.5321);
  assert.deepEqual([both.turns, both.durationMs, both.toolCalls, both.ranCloseScript], [6, 70000, 4, 2]);
  assert.equal(runner.parseTranscript('').toolCalls, 0);
  assert.equal(runner.parseTranscript('{"type":"result","subtype":"error_max_budget_usd","is_error":true}').resultSubtype, 'error_max_budget_usd');
});

test('the table counts each kind by its own rule', () => {
  const row = (kind, facts, over = {}) => runner.summarize({
    id: `${kind}-01`, kind, facts: { defects: 0, ...facts },
    transcript: { toolCalls: 4, turns: 3, costUsd: 0.5, durationMs: 1000, model: 'm', resultSubtype: 'success' },
    rows: { reminders: 1, quiet: [], checks: ['missing', 'ok'] }, timedOut: false, exitCode: 0, ...over
  });
  const fixed = { verdict: 'ok', fixEntry: true, testsPass: true, behaviour: true };
  const results = [
    row('closing-turn', { verdict: 'ok' }),
    row('closing-turn', { verdict: 'malformed' }),
    row('closing-turn', { verdict: 'missing' }, { rows: { reminders: 1, quiet: [], checks: [] } }),
    row('fix-decision', { ...fixed, revisedLine: true, digestChanged: true }, { rows: { reminders: 0, quiet: [], checks: [] } }),
    row('fix-decision', { ...fixed }, { rows: { reminders: 0, quiet: [], checks: [] }, timedOut: true })
  ];
  assert.deepEqual(results.map((r) => r.pass), [true, false, false, true, false]);
  assert.equal(results[4].result, 'timeout');
  assert.equal(runner.table(results), [
    '| kind | sessions | pass | digest ok | reminder fired | ran the close script | Fix entry | digest revised | median tool calls | cost |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    '| closing-turn | 3 | 1 | 1 | 3 | 2 | 0 | 0 | 4 | $1.50 |',
    '| fix-decision | 2 | 1 | 2 | 0 | 0 | 2 | 1 | 4 | $1.00 |'
  ].join('\n'));
});
