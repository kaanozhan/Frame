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

function runHook(mode, input, { raw = null, env = {}, args = [], hook = HOOK } = {}) {
  const stdout = execFileSync('node', [hook, mode, ...args], {
    input: raw !== null ? raw : JSON.stringify(input),
    env: { ...process.env, ...env },
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

// ─── Codex ────────────────────────────────────────────────

test('a Codex apply_patch into a Frame meta file gets that file\'s rules', () => {
  // Measured in T01: Codex's edit tool carries a patch envelope, not a path.
  const root = mkProject();
  const command = ['*** Begin Patch', '*** Update File: .frame/tasks.json', '+{}', '*** End Patch'].join('\n');
  const ctx = ctxOf(runHook('pre-edit', {
    session_id: 'cx', cwd: root, tool_name: 'apply_patch', tool_input: { command }
  }));
  assert.match(ctx, /The id\/title\/status shape/);
});

test('a Codex patch outside .frame/ is not a Frame meta write', () => {
  const root = mkProject();
  const command = ['*** Begin Patch', '*** Add File: src/tasks.json', '+{}', '*** End Patch'].join('\n');
  assert.equal(runHook('pre-edit', {
    session_id: 'cx', cwd: root, tool_name: 'apply_patch', tool_input: { command }
  }), null);
});

test('a Codex patch touching several files finds the meta one among them', () => {
  const root = mkProject();
  const command = [
    '*** Begin Patch',
    '*** Update File: src/a.js',
    '+x',
    '*** Update File: .frame/PROJECT_NOTES.md',
    '+y',
    '*** End Patch'
  ].join('\n');
  const ctx = ctxOf(runHook('pre-edit', {
    session_id: 'cx', cwd: root, tool_name: 'apply_patch', tool_input: { command }
  }));
  assert.match(ctx, /Append decisions as dated sections/);
});

test('Codex gets the whole section where Claude Code would be trimmed', () => {
  // Claude Code inlines 2 000 characters; Codex showed no truncation at
  // 20 000 (T01). A section too big for one is fine for the other, so the cap
  // is per CLI rather than one shared number.
  const bloated = REFERENCE.replace(
    'Append decisions as dated sections.',
    `Append decisions as dated sections.\n${'padding line to overflow the cap. '.repeat(120)}`
  );
  const root = mkProject(bloated);
  const claude = ctxOf(runHook('pre-edit', {
    session_id: 'cap', cwd: root, tool_name: 'Edit',
    tool_input: { file_path: path.join(root, '.frame', 'PROJECT_NOTES.md') }
  }));
  assert.match(claude, /\[trimmed/, 'Claude Code trims it');

  // A real Codex edit arrives as apply_patch — the tool name is what says
  // which CLI this is, so a Claude tool name would (correctly) win.
  const command = ['*** Begin Patch', '*** Update File: .frame/PROJECT_NOTES.md', '+x', '*** End Patch'].join('\n');
  const codex = ctxOf(runHook('pre-edit', {
    session_id: 'cap2', cwd: root, tool_name: 'apply_patch', tool_input: { command }
  }));
  assert.ok(!codex.includes('[trimmed'), 'Codex takes it whole');
  assert.ok(codex.length > 2000, 'and it is bigger than Claude Code could inline');
});

// ─── the close reminder ───────────────────────────────────
//
// The non-meta path — every call above that asserts `null` — is where a spec
// that this session closed without its digest is announced. The helper's own
// decisions are covered in spec-close-state.test.js; what is asserted here is
// the wiring: which calls carry the line, in which CLI's payload shape, what a
// meta write still delivers, and that each outcome leaves its row.
//
// Each case runs the way it happens: the session's first hook call sees the
// spec open, then its tasks are completed, then the call under test.

const activityLog = require('../scripts/activity-log');
const events = require('../src/shared/activityEvents');

const SLUG = 'close-me';
const tasksOf = (slug, status) => JSON.stringify({
  tasks: [1, 2].map((n) => ({
    id: `t${n}`, source: `spec:${slug}:T0${n}`, status: n === 1 ? 'completed' : status,
    completedAt: n === 1 || status === 'completed' ? '2026-02-01T10:00:00Z' : null
  }))
});

/** A project holding `slug`, its last task still open unless `preClosed`. */
function mkClosable({ slug = SLUG, digest = false, preClosed = false, tasksRaw = null } = {}) {
  const root = mkProject();
  const frame = path.join(root, '.frame');
  fs.mkdirSync(path.join(frame, 'specs', slug), { recursive: true });
  if (digest) fs.writeFileSync(path.join(frame, 'specs', slug, 'digest.md'), '---\nkeywords: a\n---\nDone.\n');
  fs.writeFileSync(path.join(frame, 'tasks.json'), tasksRaw !== null ? tasksRaw : tasksOf(slug, preClosed ? 'completed' : 'in_progress'));
  return root;
}

let bump = 0;
/** Complete the spec's last task, the way a shell script would. */
function closeAll(root, slug = SLUG) {
  const file = path.join(root, '.frame', 'tasks.json');
  fs.writeFileSync(file, tasksOf(slug, 'completed'));
  bump += 1;
  const at = new Date(Date.now() + bump * 1000);
  fs.utimesSync(file, at, at);
}

const homeOf = (root) => path.join(root, '.activity-home');
const closeEnv = (root) => ({ FRAME_ACTIVITY_HOME: homeOf(root) });

/** The session's first look, with the spec still open — then the session closes it. */
function closedBy(root, firstLook, opts = {}) {
  assert.equal(runHook('pre-edit', firstLook, { env: closeEnv(root), ...opts }), null, 'nothing owed at the first look');
  closeAll(root);
}

/** Every activity row the hook wrote for this project, each checked against the registry. */
function rowsOf(root) {
  let rows = [];
  try {
    rows = fs.readFileSync(path.join(homeOf(root), activityLog.projectKey(root), 'activity.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { /* nothing recorded */ }
  for (const row of rows) {
    const kept = events.validateEvent(row.ev, row);
    assert.ok(kept, `${row.ev} is not a registered event`);
    for (const key of ['host', 'mode', 'reason', 'specs']) {
      if (row[key] !== undefined) assert.equal(kept[key], row[key], `${row.ev}.${key}=${row[key]} is outside the registry`);
    }
  }
  return rows;
}

const closeRows = (root) => rowsOf(root).filter((r) => r.mode === 'spec-close');
const LINE = 'You completed the last task of spec "close-me" in this session and it has no digest yet. ' +
  'Finish it: run node .frame/bin/spec-close.js close-me and write what it asks for.';
const srcEdit = (root, session = 'a') =>
  ({ session_id: session, cwd: root, tool_name: 'Edit', tool_input: { file_path: path.join(root, 'src', 'index.js') } });
const codexShell = (root, command) =>
  ({ session_id: 'cx', cwd: root, turn_id: 't', permission_mode: 'default', model: 'm', tool_name: 'Bash', tool_input: { command } });

test('the next shell call after this session closes a spec carries the one-line reminder', () => {
  const root = mkClosable();
  closedBy(root, bash(root, 'npm test'));
  const out = runHook('pre-edit', bash(root, 'git status'), { env: closeEnv(root) });
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(ctxOf(out), LINE);
  assert.deepEqual(closeRows(root).map((r) => [r.ev, r.kind, r.host, r.specs]),
    [['hint.injected', 'action', 'claude-hook', 1]]);
});

test('so does the next edit of an ordinary file', () => {
  const root = mkClosable();
  closedBy(root, srcEdit(root));
  assert.equal(ctxOf(runHook('pre-edit', srcEdit(root), { env: closeEnv(root) })), LINE);
});

test('a Codex shell call carries it, recorded under the Codex host', () => {
  const root = mkClosable();
  closedBy(root, codexShell(root, 'npm test'), { args: ['codex'] });
  const out = runHook('pre-edit', codexShell(root, 'git status'), { env: closeEnv(root), args: ['codex'] });
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(ctxOf(out), LINE);
  assert.deepEqual(closeRows(root).map((r) => [r.ev, r.host]), [['hint.injected', 'codex-hook']]);
});

test('a Codex apply_patch on an ordinary file carries it', () => {
  const root = mkClosable();
  const patch = (file) => ({
    session_id: 'cx', cwd: root, turn_id: 't', tool_name: 'apply_patch',
    tool_input: { command: ['*** Begin Patch', `*** Update File: ${file}`, '+x', '*** End Patch'].join('\n') }
  });
  closedBy(root, patch('src/a.js'), { args: ['codex'] });
  assert.equal(ctxOf(runHook('pre-edit', patch('src/b.js'), { env: closeEnv(root), args: ['codex'] })), LINE);
  assert.equal(closeRows(root)[0].host, 'codex-hook');
});

test('a meta write keeps its own payload and carries no reminder — the next call does', () => {
  const root = mkClosable();
  const env = closeEnv(root);
  closedBy(root, srcEdit(root));
  for (const input of [edit(root, 'tasks.json'), bash(root, 'echo "{}" > .frame/PROJECT_NOTES.md')]) {
    const ctx = ctxOf(runHook('pre-edit', input, { env }));
    assert.match(ctx, /^Frame's rules for writing /);
    assert.ok(!ctx.includes('You completed the last task'), 'the section is delivered alone');
  }
  assert.deepEqual(closeRows(root), [], 'a meta write does not consume the reminder');
  assert.equal(ctxOf(runHook('pre-edit', bash(root, 'git status'), { env })), LINE);
});

test('a spec is announced once per session; the repeat is recorded once, not per call', () => {
  const root = mkClosable();
  const env = closeEnv(root);
  closedBy(root, bash(root, 'npm test'));
  assert.ok(runHook('pre-edit', bash(root, 'ls'), { env }));
  assert.equal(runHook('pre-edit', bash(root, 'ls'), { env }), null);
  assert.equal(runHook('pre-edit', srcEdit(root), { env }), null);
  assert.equal(runHook('pre-edit', bash(root, 'ls'), { env }), null);
  assert.deepEqual(closeRows(root).map((r) => [r.ev, r.reason || null]),
    [['hint.injected', null], ['hint.quiet', 'session-dedup']]);
});

test('a session that started after the spec closed is never told', () => {
  const root = mkClosable();
  const env = closeEnv(root);
  closedBy(root, bash(root, 'npm test'));
  assert.ok(runHook('pre-edit', bash(root, 'ls'), { env }), 'the closing session hears it');
  assert.equal(runHook('pre-edit', srcEdit(root, 'b'), { env }), null, 'a later conversation does not');
  assert.equal(runHook('pre-edit', bash(root, 'ls'), { env }), null);
  assert.deepEqual(closeRows(root).map((r) => r.reason || r.ev), ['hint.injected', 'closed-earlier', 'session-dedup'],
    'the later session records why it was not told; the closing one, that it already was');
});

test('once the digest exists nothing is said and nothing is recorded', () => {
  const root = mkClosable({ digest: true });
  closedBy(root, bash(root, 'npm test'));
  assert.equal(runHook('pre-edit', bash(root, 'ls'), { env: closeEnv(root) }), null);
  assert.deepEqual(rowsOf(root), []);
});

test('a project with no closed spec stays silent and unrecorded on every call', () => {
  const root = mkClosable();
  const env = closeEnv(root);
  assert.equal(runHook('pre-edit', bash(root, 'ls'), { env }), null);
  assert.equal(runHook('pre-edit', srcEdit(root), { env }), null);
  assert.deepEqual(rowsOf(root), []);
});

test('each reason a reminder is withheld leaves its own row', () => {
  const cases = [
    ['closed-earlier', () => mkClosable({ preClosed: true }), false],
    ['orchestrated', () => {
      const root = mkClosable();
      fs.mkdirSync(path.join(root, '.frame', 'worktrees', SLUG), { recursive: true });
      return root;
    }, true],
    ['git-unavailable', () => {
      const root = mkClosable();
      fs.writeFileSync(path.join(root, '.git'), 'gitdir: /nowhere/at/all\n');
      return root;
    }, true]
  ];
  for (const [reason, make, closeInSession] of cases) {
    const root = make();
    const env = closeEnv(root);
    if (closeInSession) closedBy(root, bash(root, 'npm test'));
    assert.equal(runHook('pre-edit', bash(root, 'ls'), { env }), null, `${reason}: no reminder`);
    assert.equal(runHook('pre-edit', bash(root, 'ls'), { env }), null);
    assert.deepEqual(closeRows(root).map((r) => [r.ev, r.kind, r.reason]), [['hint.quiet', 'suppression', reason]],
      `${reason}: one row for the session`);
  }
});

test('an unreadable tasks.json behaves as before, with one row saying why', () => {
  const root = mkClosable({ tasksRaw: '{ "tasks": [ truncated' });
  const env = closeEnv(root);
  assert.equal(runHook('pre-edit', bash(root, 'ls'), { env }), null);
  assert.equal(runHook('pre-edit', srcEdit(root), { env }), null);
  assert.deepEqual(closeRows(root).map((r) => [r.ev, r.reason]), [['hint.quiet', 'no-index']]);
  // …and a meta write is untouched by it.
  assert.match(ctxOf(runHook('pre-edit', edit(root, 'tasks.json'), { env })), /The id\/title\/status shape/);
});

test('a .frame/bin/ without the helper behaves exactly as it did', () => {
  const root = mkClosable();
  const bin = path.join(root, '.frame', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const file of ['docs-hint.js', 'toolVocabulary.js', 'activity-log.js', 'redact.js']) {
    fs.copyFileSync(path.join(REPO, 'scripts', file), path.join(bin, file));
  }
  const opts = { env: closeEnv(root), hook: path.join(bin, 'docs-hint.js') };
  assert.equal(runHook('pre-edit', bash(root, 'ls'), opts), null);
  closeAll(root);
  assert.equal(runHook('pre-edit', srcEdit(root), opts), null);
  assert.deepEqual(closeRows(root), [], 'no helper, so nothing decided and nothing to record');
  assert.match(ctxOf(runHook('pre-edit', edit(root, 'tasks.json'), opts)), /The id\/title\/status shape/);

  // With the helper beside it, the same copy speaks — and names the script where it lives.
  for (const file of ['spec-close-state.js', 'spec-close.js']) {
    fs.copyFileSync(path.join(REPO, 'scripts', file), path.join(bin, file));
  }
  const fresh = mkClosable();
  fs.cpSync(bin, path.join(fresh, '.frame', 'bin'), { recursive: true });
  const freshOpts = { env: closeEnv(fresh), hook: path.join(fresh, '.frame', 'bin', 'docs-hint.js') };
  assert.equal(runHook('pre-edit', bash(fresh, 'npm test'), freshOpts), null);
  closeAll(fresh);
  assert.equal(ctxOf(runHook('pre-edit', bash(fresh, 'ls'), freshOpts)), LINE);
});

test('the reminder stays inside the inline limit at its widest', () => {
  const root = mkProject();
  const frame = path.join(root, '.frame');
  const slugs = ['a', 'b', 'c', 'd', 'e'].map((c) => c.repeat(120));
  for (const slug of slugs) fs.mkdirSync(path.join(frame, 'specs', slug), { recursive: true });
  const write = (status) => fs.writeFileSync(path.join(frame, 'tasks.json'), JSON.stringify({
    tasks: slugs.map((slug) => ({ id: slug, source: `spec:${slug}:T01`, status, completedAt: status === 'completed' ? '2026-02-01T10:00:00Z' : null }))
  }));
  write('in_progress');
  assert.equal(runHook('pre-edit', bash(root, 'npm test'), { env: closeEnv(root) }), null);
  write('completed');
  const ctx = ctxOf(runHook('pre-edit', bash(root, 'ls'), { env: closeEnv(root) }));
  assert.match(ctx, / and 2 more in this session and they have no digest yet\. Finish them: run node \S+ <slug> for each /);
  assert.ok(!ctx.includes('\n'), 'one line');
  assert.ok(ctx.length <= CAP, `${ctx.length} chars exceeds the ${CAP} cap`);
});

// ─── The card file (decision-cards-core T04) ──────────────

const templates = require('../src/shared/frameTemplates');
const managedBlock = require('../src/shared/docsManagedBlock');

/** The repo's REFERENCE.md as a project gets it on open: the decision block appended. */
function referenceWithDecisions() {
  const real = fs.readFileSync(path.join(REPO, '.frame', 'docs', 'REFERENCE.md'), 'utf8');
  if (managedBlock.findBlock(real, managedBlock.DECISION_BLOCK_NAME)) return real;
  return managedBlock.appendBlock(real, {
    body: templates.DECISION_SECTION,
    version: templates.DECISION_SECTION_VERSION,
    blockName: managedBlock.DECISION_BLOCK_NAME,
    footerMarker: '*This file was automatically created by Frame.'
  });
}

test('writing the card file by hand gets the yes rule and the card shape, not the conversation half', () => {
  const root = mkProject(referenceWithDecisions());
  const ctx = ctxOf(runHook('pre-edit', edit(root, 'decisions.jsonl')));
  assert.match(ctx, /^Frame's rules for writing decisions\.jsonl — follow them:/);
  assert.match(ctx, /### On a yes/);
  assert.match(ctx, /### The card/);
  assert.match(ctx, /<YYYYMMDD>-<6 lowercase hex>/);
  assert.doesNotMatch(ctx, /### When to ask/);
  assert.doesNotMatch(ctx, /### The one question/);
});

test('an append with >> into the card file counts as a write', () => {
  const root = mkProject(referenceWithDecisions());
  const out = runHook('pre-edit', bash(root, `echo '{"id":"x"}' >> .frame/decisions.jsonl`));
  assert.match(ctxOf(out), /### The card/);
});

test('running decision.js is not a hand write to the card file', () => {
  const root = mkProject(referenceWithDecisions());
  assert.equal(runHook('pre-edit', bash(root, `node .frame/bin/decision.js add '{"decision":"x"}'`)), null);
});

test('a reference without the decision rules stays quiet on a card write', () => {
  const root = mkProject();
  assert.equal(runHook('pre-edit', edit(root, 'decisions.jsonl')), null);
});

test('the card-file payload from the shipped section stays inlinable for both hosts', () => {
  const root = mkProject(referenceWithDecisions());
  const claude = ctxOf(runHook('pre-edit', edit(root, 'decisions.jsonl')));
  assert.ok(claude.length <= CAP, `${claude.length} chars exceeds the ${CAP} cap`);
  assert.ok(!claude.includes('[trimmed'), 'trimmed — it no longer arrives whole');
  const codex = ctxOf(runHook('pre-edit', {
    session_id: 'a', cwd: root, tool_name: 'apply_patch',
    tool_input: { command: `*** Begin Patch\n*** Add File: ${path.join(root, '.frame', 'decisions.jsonl')}\n+{}\n*** End Patch` }
  }));
  assert.equal(codex, claude);
});
