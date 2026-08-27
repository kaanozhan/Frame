/**
 * Frame rules hook script tests.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 *
 * Same shape as spec-hint's and module-hint's: a child process with hook
 * JSON on stdin, and the never-break contract as the core assertion set.
 *
 * The load-bearing test in this file is "every real payload stays inlinable".
 * Claude Code inlines a hook's additionalContext up to a measured 2000
 * characters and spills the rest to a file, handing the model a preview and a
 * path — which turns guaranteed delivery back into optional reading, the
 * exact failure this hook exists to end. Nothing in production would report
 * that; the sections would simply stop arriving. So the sizes are asserted
 * here, against the repository's actual REFERENCE.md, and a section that
 * grows past the ceiling fails a test instead.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'scripts', 'docs-hint.js');
const REPO = path.join(__dirname, '..');
const CAP = 1980; // must match scripts/docs-hint.js

function runHook(mode, input, { raw = null } = {}) {
  const stdout = execFileSync('node', [HOOK, mode], {
    input: raw !== null ? raw : JSON.stringify(input),
    encoding: 'utf8'
  }); // execFileSync throws on non-zero exit — reaching here asserts exit 0
  return stdout.trim() ? JSON.parse(stdout) : null;
}

const REFERENCE = [
  '# Frame Reference',
  '',
  '## Task Management (tasks.json)',
  'Intro prose about what a task is.',
  '',
  '### Task Recognition Rules',
  'Whether something is a task at all.',
  '',
  '### Task Structure',
  'The id/title/status shape.',
  '',
  '### Task Content Rules',
  'Write the user request verbatim.',
  '',
  '### Task Status Updates',
  'in_progress on start, completed with completedAt.',
  '',
  '## PROJECT_NOTES.md Rules',
  'Append decisions as dated sections.',
  '',
  '## STRUCTURE.json Rules',
  'Auto-generated — prefer npm run structure.',
  '',
  '## Spec-driven development — how to suggest',
  'Ask once, in plain language.',
  '',
  '## General Rules',
  'Documentation in English; ISO 8601 dates.'
].join('\n');

function mkProject(reference = REFERENCE) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-docshint-'));
  fs.mkdirSync(path.join(root, '.frame', 'docs'), { recursive: true });
  if (reference !== null) {
    fs.writeFileSync(path.join(root, '.frame', 'docs', 'REFERENCE.md'), reference);
  }
  return root;
}

const ctxOf = (out) => out.hookSpecificOutput.additionalContext;
const edit = (root, file) =>
  ({ session_id: 'a', cwd: root, tool_name: 'Edit', tool_input: { file_path: path.join(root, '.frame', file) } });
const bash = (root, command) =>
  ({ session_id: 'a', cwd: root, tool_name: 'Bash', tool_input: { command } });

// ─── session start: the conversation-level rules ──────────

test('session start delivers the rules that have no single moment of use', () => {
  const out = runHook('session-start', { session_id: 'a', cwd: mkProject(), source: 'startup' });
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  const ctx = ctxOf(out);
  assert.match(ctx, /Ask once, in plain language\./);          // Spec-driven
  assert.match(ctx, /Documentation in English/);                // General Rules
});

test('session start does NOT carry the per-file rules — those have their own moment', () => {
  const ctx = ctxOf(runHook('session-start', { session_id: 'b', cwd: mkProject() }));
  assert.ok(!ctx.includes('The id/title/status shape'), 'tasks.json rules belong to the write');
  assert.ok(!ctx.includes('Append decisions as dated sections'), 'notes rules belong to the write');
});

test('it fires on every session, not once — a resume gets the rules too', () => {
  const root = mkProject();
  assert.ok(runHook('session-start', { session_id: 'c', cwd: root, source: 'startup' }));
  assert.ok(runHook('session-start', { session_id: 'c', cwd: root, source: 'resume' }));
});

// ─── the write moment ─────────────────────────────────────

test('writing tasks.json gets the how-to-write subsections, not the whole section', () => {
  const root = mkProject();
  const ctx = ctxOf(runHook('pre-edit', edit(root, 'tasks.json')));
  assert.match(ctx, /The id\/title\/status shape/);              // Task Structure
  assert.match(ctx, /Write the user request verbatim/);          // Task Content Rules
  assert.match(ctx, /in_progress on start/);                     // Task Status Updates
  // "is this a task at all" is a conversation question, not a write rule.
  assert.ok(!ctx.includes('Whether something is a task at all'), 'recognition is not a write rule');
});

test('writing PROJECT_NOTES.md gets its own section', () => {
  const ctx = ctxOf(runHook('pre-edit', edit(mkProject(), 'PROJECT_NOTES.md')));
  assert.match(ctx, /Append decisions as dated sections/);
});

test('writing STRUCTURE.json gets its own section', () => {
  const ctx = ctxOf(runHook('pre-edit', edit(mkProject(), 'STRUCTURE.json')));
  assert.match(ctx, /prefer npm run structure/);
});

test('a redirect into a Frame meta file counts as a write', () => {
  const root = mkProject();
  const ctx = ctxOf(runHook('pre-edit', bash(root, 'echo "{}" > .frame/tasks.json')));
  assert.match(ctx, /The id\/title\/status shape/);
});

test('reading a meta file is not writing one', () => {
  const root = mkProject();
  assert.equal(runHook('pre-edit', bash(root, 'cat .frame/tasks.json | head -20')), null);
});

test('tee counts as a write', () => {
  const root = mkProject();
  const ctx = ctxOf(runHook('pre-edit', bash(root, 'echo hi | tee -a .frame/PROJECT_NOTES.md')));
  assert.match(ctx, /Append decisions as dated sections/);
});

test('a redirect to /dev/null is not a write to whatever else the command names', () => {
  // The exact false positive this guard was added for: a command that only
  // reads, whose `>` goes to /dev/null, in a block that also mentions a meta
  // file by name. The first version of this hook fired on it.
  const root = mkProject();
  const cmd = 'diff -q scripts/docs-hint.js .frame/bin/docs-hint.js >/dev/null\n'
    + 'git status --porcelain -- .frame/PROJECT_NOTES.md .frame/docs/REFERENCE.md';
  assert.equal(runHook('pre-edit', bash(root, cmd)), null);
});

test('a write outside .frame/ is not a Frame meta write', () => {
  const root = mkProject();
  assert.equal(runHook('pre-edit', bash(root, 'echo "{}" > src/tasks.json')), null);
});

test("a project's own tasks.json outside .frame/ is not Frame's", () => {
  const root = mkProject();
  const input = { session_id: 'a', cwd: root, tool_name: 'Edit', tool_input: { file_path: path.join(root, 'src', 'tasks.json') } };
  assert.equal(runHook('pre-edit', input), null);
});

test('an ordinary source edit says nothing', () => {
  const root = mkProject();
  const input = { session_id: 'a', cwd: root, tool_name: 'Edit', tool_input: { file_path: path.join(root, 'src', 'index.js') } };
  assert.equal(runHook('pre-edit', input), null);
});

// ─── the ceiling ──────────────────────────────────────────

test('every payload from the real REFERENCE.md stays inlinable', () => {
  // The host inlines up to 2000 characters. Past that it writes the text to a
  // file and gives the model a preview plus a path — delivery silently
  // becomes optional reading again. If this fails, a section outgrew the
  // ceiling: trim the document, or split that section's delivery. Do not
  // simply raise CAP.
  const payloads = [
    ['session start', runHook('session-start', { session_id: 'cap', cwd: REPO })],
    ['tasks.json', runHook('pre-edit', edit(REPO, 'tasks.json'))],
    ['PROJECT_NOTES.md', runHook('pre-edit', edit(REPO, 'PROJECT_NOTES.md'))],
    ['STRUCTURE.json', runHook('pre-edit', edit(REPO, 'STRUCTURE.json'))],
    ['QUICKSTART.md', runHook('pre-edit', edit(REPO, 'QUICKSTART.md'))]
  ];
  for (const [name, out] of payloads) {
    assert.ok(out, `${name}: expected a payload`);
    const ctx = ctxOf(out);
    assert.ok(ctx.length <= CAP, `${name}: ${ctx.length} chars exceeds the ${CAP} cap`);
    assert.ok(!ctx.includes('[trimmed'), `${name}: was trimmed — it no longer arrives whole`);
  }
});

test('a section that outgrows the cap degrades visibly instead of vanishing', () => {
  // The padding has to land *inside* the section under test, not at the end
  // of the document — otherwise it grows whichever section happens to be last.
  const bloated = REFERENCE.replace(
    'Append decisions as dated sections.',
    `Append decisions as dated sections.\n${'padding line to overflow the cap. '.repeat(120)}`
  );
  const root = mkProject(bloated);
  const ctx = ctxOf(runHook('pre-edit', edit(root, 'PROJECT_NOTES.md')));
  assert.ok(ctx.length <= CAP);
  assert.match(ctx, /\[trimmed/);
  assert.match(ctx, /docs-hint\.js section/); // and says how to get the rest
});

// ─── the manual escape hatch ──────────────────────────────

test('the CLI lists sections and prints one by name', () => {
  const list = execFileSync('node', [HOOK, 'section', '--list'], { cwd: REPO, encoding: 'utf8' });
  assert.match(list, /Task Management/);
  assert.match(list, /Activity Monitor/); // including the ones no hook delivers

  const one = execFileSync('node', [HOOK, 'section', 'Activity Monitor'], { cwd: REPO, encoding: 'utf8' });
  assert.match(one, /^## Activity Monitor/m);
  assert.ok(one.length > 2000, 'the CLI is not subject to the hook ceiling');
});

// ─── it never breaks ──────────────────────────────────────

test('a project with no REFERENCE.md is silent, not an error', () => {
  const root = mkProject(null);
  assert.equal(runHook('session-start', { session_id: 'd', cwd: root }), null);
  assert.equal(runHook('pre-edit', edit(root, 'tasks.json')), null);
});

test('unparseable stdin exits 0 with no output', () => {
  assert.equal(runHook('pre-edit', null, { raw: 'not json at all' }), null);
});

test('a payload larger than the pipe buffer arrives whole', () => {
  // Regression: `process.stdout.write()` followed by `process.exit(0)` tore
  // the process down mid-write, truncating past roughly 8 KB. The CLI path
  // is the one that can still emit that much.
  const out = execFileSync('node', [HOOK, 'section', 'Activity Monitor'], { cwd: REPO, encoding: 'utf8' });
  assert.match(out, /\n$/, 'the tail survived the write');
});
