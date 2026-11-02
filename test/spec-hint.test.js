/**
 * Spec Knowledge Layer — hook script tests.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 *
 * The hook is exercised the way Claude Code runs it: a child process with
 * hook JSON on stdin. The never-break contract is the core assertion set —
 * any failure must be exit 0 with empty stdout.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HINT = path.join(__dirname, '..', 'scripts', 'spec-hint.js');

function runHook(mode, input, { env = {}, raw = null } = {}) {
  const stdout = execFileSync('node', [HINT, mode], {
    input: raw !== null ? raw : JSON.stringify(input),
    env: { ...process.env, ...env },
    encoding: 'utf8'
  }); // execFileSync throws on non-zero exit — reaching here asserts exit 0
  return stdout.trim() ? JSON.parse(stdout) : null;
}

function mkProject(indexObj) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-hint-'));
  if (indexObj) {
    const dir = path.join(root, '.frame', 'index');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'spec-index.json'), JSON.stringify(indexObj));
  } else {
    fs.mkdirSync(path.join(root, '.frame'), { recursive: true });
  }
  return root;
}

const REC = (slug, over = {}) => ({
  slug, task: 'T01', line: `did the ${slug} work`, date: '2026-06-01',
  phase: 'done', flags: {}, deep: `.frame/specs/${slug}/outcome.md`, ...over
});

const IDX_ONE = {
  version: 1, generatedAt: 'x', root: 'x',
  topics: {
    'perf-spec': { title: 'Performance work', phase: 'done', keywords: ['telemetry', 'polling'], declared: true, related: [], supersedes: null, digestLine: 'Async hot paths and gated polling.', paths: ['src/main/a.js'] },
    'other-spec': { title: 'Other work', phase: 'done', keywords: ['sidebar'], declared: true, related: [], supersedes: null, digestLine: null, paths: [] }
  },
  files: {
    'src/main/a.js': [REC('perf-spec', { flags: { current: true } })],
    'src/many.js': [
      REC('s1', { date: '2026-01-01', flags: { laterSpecs: true } }),
      REC('s2', { date: '2026-02-01', flags: { laterSpecs: true } }),
      REC('s3', { date: '2026-03-01', flags: { current: true } })
    ]
  }
};

// ─── pre-edit: injection content ──────────────────────────

test('pre-edit injects full records with the relay instruction for ≤2 entries', () => {
  const root = mkProject(IDX_ONE);
  const out = runHook('pre-edit', { session_id: 's1', cwd: root, tool_input: { file_path: 'src/main/a.js' } });
  assert.ok(out, 'produced output');
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.match(ctx, /perf-spec T01 — did the perf-spec work/);
  assert.match(ctx, /deep read: \.frame\/specs\/perf-spec\/outcome\.md/);
  assert.match(ctx, /relay it to the user/i);
});

test('pre-edit overflow at 3+ specs: one line each, every spec present, pointer added', () => {
  const root = mkProject(IDX_ONE);
  const out = runHook('pre-edit', { session_id: 's1', cwd: root, tool_input: { file_path: 'src/many.js' } });
  const ctx = out.hookSpecificOutput.additionalContext;
  for (const slug of ['s1', 's2', 's3']) assert.match(ctx, new RegExp(`- 2026-\\d\\d-01 ${slug}`), `${slug} present`);
  assert.match(ctx, /Full history: node .*spec-context\.js --file src\/many\.js/);
  assert.ok(!/did the s1 work/.test(ctx), 'overflow drops one-liner depth');
});

test('pre-edit absolute paths resolve and signal mode swaps content for a pointer', () => {
  const root = mkProject(IDX_ONE);
  const out = runHook('pre-edit',
    { session_id: 's1', cwd: root, tool_input: { file_path: path.join(root, 'src/main/a.js') } },
    { env: { FRAME_SPEC_HINT_MODE: 'signal' } });
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /spec history \(1 record\(s\) from 1 spec\(s\)\)/);
  assert.ok(!/did the perf-spec work/.test(ctx), 'no content in signal mode');
});

// ─── pre-edit: dedup ──────────────────────────────────────

test('pre-edit on a finished spec\'s file says how a fix records itself', () => {
  const root = mkProject(IDX_ONE);
  const ctx = runHook('pre-edit', { session_id: 'fx1', cwd: root, tool_input: { file_path: 'src/main/a.js' } })
    .hookSpecificOutput.additionalContext;
  assert.match(ctx, /If this edit fixes or adjusts the finished work of perf-spec, record it in the same commit: a "## Fix — <title>" entry in \.frame\/specs\/perf-spec\/outcome\.md/);
  assert.match(ctx, /"Revised <YYYY-MM-DD>: …" line before its Chain line\. Ask the user if you are not sure whether it does\.$/);
  // On a file several specs touched, it names the newest — the current truth.
  const many = runHook('pre-edit', { session_id: 'fx1', cwd: root, tool_input: { file_path: 'src/many.js' } })
    .hookSpecificOutput.additionalContext;
  assert.match(many, /finished work of s3,/);
  assert.ok(many.length < 2000);
});

test('the fix sentence stays off a file whose newest spec is still in flight, and out of signal mode', () => {
  const idx = JSON.parse(JSON.stringify(IDX_ONE));
  idx.files['src/live.js'] = [
    REC('perf-spec', { flags: { current: true } }),
    REC('live-spec', { phase: 'implementing', line: 'in the footprint of in-flight spec "live-spec"', flags: { inflight: true } })
  ];
  const root = mkProject(idx);
  const live = runHook('pre-edit', { session_id: 'fx2', cwd: root, tool_input: { file_path: 'src/live.js' } })
    .hookSpecificOutput.additionalContext;
  assert.ok(!live.includes('If this edit fixes'), 'the work is not finished yet');
  const signal = runHook('pre-edit', { session_id: 'fx3', cwd: root, tool_input: { file_path: 'src/main/a.js' } },
    { env: { FRAME_SPEC_HINT_MODE: 'signal' } }).hookSpecificOutput.additionalContext;
  assert.ok(!signal.includes('If this edit fixes'), 'signal mode is one pointer line');
});

test('pre-edit injects once per file per session; new session injects again', () => {
  const root = mkProject(IDX_ONE);
  const input = { session_id: 'dedup', cwd: root, tool_input: { file_path: 'src/main/a.js' } };
  assert.ok(runHook('pre-edit', input), 'first call injects');
  assert.equal(runHook('pre-edit', input), null, 'second call silent');
  assert.ok(runHook('pre-edit', { ...input, session_id: 'fresh' }), 'new session injects');
});

// ─── never-break contract ─────────────────────────────────

test('no index, corrupt index, corrupt stdin, missing fields — all exit 0 silent', () => {
  const bare = mkProject(null);
  assert.equal(runHook('pre-edit', { session_id: 's', cwd: bare, tool_input: { file_path: 'src/x.js' } }), null, 'no index');
  const broken = mkProject(null);
  fs.mkdirSync(path.join(broken, '.frame', 'index'), { recursive: true });
  fs.writeFileSync(path.join(broken, '.frame', 'index', 'spec-index.json'), '{corrupt!!');
  assert.equal(runHook('pre-edit', { session_id: 's', cwd: broken, tool_input: { file_path: 'src/x.js' } }), null, 'corrupt index');
  assert.equal(runHook('pre-edit', {}, { raw: 'THIS IS NOT JSON' }), null, 'corrupt stdin');
  assert.equal(runHook('pre-edit', { session_id: 's', cwd: mkProject(IDX_ONE) }), null, 'no tool_input');
  assert.equal(runHook('bogus-mode', { session_id: 's' }), null, 'unknown mode');
});

test('pre-edit skips .frame/ meta targets and out-of-project paths', () => {
  const root = mkProject(IDX_ONE);
  assert.equal(runHook('pre-edit', { session_id: 's', cwd: root, tool_input: { file_path: '.frame/specs/x/spec.md' } }), null);
  assert.equal(runHook('pre-edit', { session_id: 's', cwd: root, tool_input: { file_path: '/etc/hosts' } }), null);
});

// ─── prompt mode ──────────────────────────────────────────

test('prompt mode surfaces rare-keyword matches with digest lines, dedups per session', () => {
  const root = mkProject(IDX_ONE);
  const input = { session_id: 'p1', cwd: root, prompt: 'telemetry polling davranışını değiştirelim' };
  const out = runHook('prompt', input);
  assert.ok(out, 'match produced output');
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(ctx, /perf-spec \(done\) — Async hot paths and gated polling\./);
  assert.ok(!/other-spec/.test(ctx), 'unrelated spec not suggested');
  assert.equal(runHook('prompt', input), null, 'same topics not re-suggested in session');
});

test('prompt mode stays silent on generic-only prompts', () => {
  const root = mkProject(IDX_ONE);
  const out = runHook('prompt', { session_id: 'p2', cwd: root, prompt: 'fix the app panel button test' });
  assert.equal(out, null);
});

// ─── settings-merge safety (frameProject install contract) ─

test('hook settings merge preserves unrelated keys and is idempotent', () => {
  // The merge helper ships in T06 (frameProject.js). This asserts the
  // contract at the JSON level so the fixture exists before the wiring:
  // installing into an existing settings file must keep foreign keys and
  // must not duplicate hook entries on re-install.
  const merge = (existing, entry) => {
    const s = JSON.parse(JSON.stringify(existing));
    s.hooks = s.hooks || {};
    for (const ev of Object.keys(entry)) {
      s.hooks[ev] = s.hooks[ev] || [];
      for (const h of entry[ev]) {
        const sig = JSON.stringify(h);
        if (!s.hooks[ev].some(x => JSON.stringify(x) === sig)) s.hooks[ev].push(h);
      }
    }
    return s;
  };
  const entry = {
    PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'node .frame/bin/spec-hint.js pre-edit' }] }]
  };
  const existing = { permissions: { allow: ['Bash(npm:*)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] } };
  const once = merge(existing, entry);
  assert.deepEqual(once.permissions, existing.permissions, 'foreign keys preserved');
  assert.equal(once.hooks.PreToolUse.length, 2, 'existing hook kept, new appended');
  const twice = merge(once, entry);
  assert.equal(twice.hooks.PreToolUse.length, 2, 're-install is idempotent');
});

// ─── activity record: every quiet path names itself ───────
//
// Until this landed, all eleven silent returns looked identical from the
// outside — and to "never fired" and "never installed" too. These assert the
// hook says which decision it made, without ever breaking its host.

const activityLog = require('../scripts/activity-log');

function withActivity(root, fn) {
  const home = path.join(root, '.activity-home');
  const prev = process.env.FRAME_ACTIVITY_HOME;
  process.env.FRAME_ACTIVITY_HOME = home;
  try {
    return fn({ FRAME_ACTIVITY_HOME: home });
  } finally {
    if (prev === undefined) delete process.env.FRAME_ACTIVITY_HOME;
    else process.env.FRAME_ACTIVITY_HOME = prev;
  }
}

function recordsFor(root) {
  return activityLog.readRecent(activityLog.projectKey(root), 100);
}

test('pre-edit records an injection with the file and the spec count', () => {
  const root = mkProject(IDX_ONE);
  withActivity(root, (env) => {
    runHook('pre-edit', { cwd: root, session_id: 'a1', tool_input: { file_path: 'src/many.js' } }, { env });
    const rec = recordsFor(root).find((r) => r.ev === 'hint.injected');
    assert.ok(rec, 'an injection must be recorded');
    assert.equal(rec.kind, 'action');
    assert.equal(rec.host, 'claude-hook');
    assert.equal(rec.mode, 'pre-edit');
    assert.equal(rec.path, 'src/many.js');
    assert.equal(rec.specs, 3);
  });
});

test('each quiet path records its own reason, and they are distinguishable', () => {
  const cases = [
    ['no-index', () => mkProject(null), { tool_input: { file_path: 'src/main/a.js' } }],
    ['no-path', () => mkProject(IDX_ONE), { tool_input: {} }],
    ['outside-project', () => mkProject(IDX_ONE), { tool_input: { file_path: '../elsewhere/x.js' } }],
    ['meta-path', () => mkProject(IDX_ONE), { tool_input: { file_path: '.frame/specs/x/spec.md' } }],
    ['no-history', () => mkProject(IDX_ONE), { tool_input: { file_path: 'src/untouched.js' } }]
  ];
  const seen = new Set();
  for (const [reason, makeRoot, extra] of cases) {
    const root = makeRoot();
    withActivity(root, (env) => {
      runHook('pre-edit', { cwd: root, session_id: 'q1', ...extra }, { env });
      const rec = recordsFor(root).find((r) => r.ev === 'hint.quiet');
      assert.ok(rec, `${reason}: a quiet path must still be recorded`);
      assert.equal(rec.reason, reason);
      assert.equal(rec.kind, 'suppression');
      seen.add(rec.reason);
    });
  }
  assert.equal(seen.size, cases.length, 'reasons must not collapse into one code');
});

test('the session-dedup path is recorded, not merely silent', () => {
  const root = mkProject(IDX_ONE);
  withActivity(root, (env) => {
    const input = { cwd: root, session_id: 'dedup', tool_input: { file_path: 'src/main/a.js' } };
    runHook('pre-edit', input, { env });
    runHook('pre-edit', input, { env }); // same file, same session
    const recs = recordsFor(root);
    assert.ok(recs.some((r) => r.ev === 'hint.injected'), 'first call injects');
    const quiet = recs.find((r) => r.ev === 'hint.quiet');
    assert.ok(quiet, 'second call records why it stayed quiet');
    assert.equal(quiet.reason, 'session-dedup');
    assert.equal(quiet.path, 'src/main/a.js');
  });
});

test('prompt mode records both its match and its no-match paths', () => {
  const hit = mkProject(IDX_ONE);
  withActivity(hit, (env) => {
    runHook('prompt', { cwd: hit, session_id: 'p1', prompt: 'telemetry polling work' }, { env });
    const rec = recordsFor(hit).find((r) => r.ev === 'hint.injected');
    assert.ok(rec && rec.mode === 'prompt', 'a surfaced match is recorded');
  });

  const miss = mkProject(IDX_ONE);
  withActivity(miss, (env) => {
    runHook('prompt', { cwd: miss, session_id: 'p2', prompt: 'zzz qqq wwww' }, { env });
    const rec = recordsFor(miss).find((r) => r.ev === 'hint.quiet');
    assert.ok(rec, 'a prompt that matched nothing is still recorded');
    assert.equal(rec.reason, 'no-match');
    assert.equal(rec.mode, 'prompt');
  });
});

test('recording never breaks the hook: unwritable record, injection unaffected', () => {
  const root = mkProject(IDX_ONE);
  const blocked = path.join(root, 'blocked-file');
  fs.writeFileSync(blocked, 'not a directory');
  // Exit 0 with the normal payload is the whole assertion — execFileSync
  // throws on a non-zero exit, and a corrupted stdout would fail the parse.
  const out = runHook(
    'pre-edit',
    { cwd: root, session_id: 'nb', tool_input: { file_path: 'src/main/a.js' } },
    { env: { FRAME_ACTIVITY_HOME: blocked } }
  );
  assert.ok(out.hookSpecificOutput.additionalContext.includes('Spec history for src/main/a.js'));
});

test('quiet paths write nothing to stdout even while recording', () => {
  const root = mkProject(IDX_ONE);
  withActivity(root, (env) => {
    const out = runHook('pre-edit', { cwd: root, session_id: 'silent', tool_input: { file_path: 'src/untouched.js' } }, { env });
    assert.equal(out, null, 'a quiet path must stay silent on stdout');
    assert.ok(recordsFor(root).some((r) => r.ev === 'hint.quiet'), 'but it is recorded');
  });
});

test('a payload larger than the pipe buffer arrives whole', () => {
  // Regression: `process.stdout.write()` followed by `process.exit(0)` tore
  // the process down mid-write, truncating anything past roughly 8 KB and
  // handing the host unparseable JSON rather than an error. Today's real
  // payloads sit under that, but the hook reads the index as it finds it and
  // only the current builder caps `digestLine`, so nothing bounds prompt mode.
  const long = `Telemetry work. ${'It goes on at length. '.repeat(700)}`;
  const root = mkProject({
    version: 1,
    generatedAt: 'x',
    root: 'x',
    topics: {
      'perf-spec': {
        title: 'Performance work', phase: 'done', keywords: ['telemetry'],
        declared: true, related: [], supersedes: null, digestLine: long, paths: []
      }
    },
    files: {}
  });

  const out = runHook('prompt', { session_id: 'big', cwd: root, prompt: 'telemetry' });
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.ok(Buffer.byteLength(ctx, 'utf8') > 12 * 1024, `expected the whole payload, got ${ctx.length} chars`);
  assert.match(ctx, /prior decisions apply/); // the tail survived the write
});

test('the prompt block sends the agent to digest.md before the spec chain', () => {
  const root = mkProject({
    version: 1,
    generatedAt: 'x',
    root: 'x',
    topics: {
      'perf-spec': {
        title: 'Performance work', phase: 'done', keywords: ['telemetry'],
        declared: true, related: [], supersedes: null, digestLine: 'Kept telemetry local.', paths: []
      }
    },
    files: {}
  });

  const out = runHook('prompt', { session_id: 'digest-first', cwd: root, prompt: 'telemetry' });
  const ctx = out.hookSpecificOutput.additionalContext;
  const digest = ctx.indexOf('digest.md');
  assert.ok(digest > -1, 'the block names digest.md');
  assert.ok(digest < ctx.indexOf('spec.md → plan.md'), 'digest.md comes before the chain');
  assert.match(ctx, /where it has one/); // an in-flight spec has no digest yet
});

test('a Codex apply_patch gets the patched file\'s spec history', () => {
  // T01: Codex's edit tool passes a patch envelope rather than file_path.
  const root = mkProject(IDX_ONE);
  const command = ['*** Begin Patch', '*** Update File: src/main/a.js', '+x', '*** End Patch'].join('\n');
  const out = runHook('pre-edit', {
    session_id: 'cx', cwd: root, tool_name: 'apply_patch', tool_input: { command }
  });
  assert.match(out.hookSpecificOutput.additionalContext, /src\/main\/a\.js/);
});

test('a payload carrying a path but no tool name still works', () => {
  // This script read file_path without consulting tool_name for its whole
  // life; the vocabulary must not turn tool_name into a precondition.
  const root = mkProject(IDX_ONE);
  const out = runHook('pre-edit', {
    session_id: 'nameless', cwd: root, tool_input: { file_path: 'src/main/a.js' }
  });
  assert.ok(out, 'a nameless payload with a path must still inject');
});

// ─── the close reminder at prompt time ────────────────────
//
// docs-hint.js says it on the next tool call; this is for the turn that ended
// without one. The helper's decisions are covered in spec-close-state.test.js
// — asserted here is that the reminder arrives whatever the prompt is about,
// goes first, and costs related specs their place only when the two together
// would pass what the host inlines.

const DOCS_HINT = path.join(__dirname, '..', 'scripts', 'docs-hint.js');
const events = require('../src/shared/activityEvents');
const CLOSE_LINE = 'You completed the last task of spec "close-me" in this session and it has no digest yet. ' +
  'Finish it: run node .frame/bin/spec-close.js close-me and write what it asks for.';
const TOPIC_HEADER = 'Specs related to this request (from the project\'s spec archive):';
const BUDGET = 1980; // Claude Code inlines 2000; the hook keeps docs-hint's margin

const closeMeTasks = (last) => JSON.stringify({
  tasks: [1, 2].map((n) => ({
    id: `t${n}`, source: `spec:close-me:T0${n}`, status: n === 1 ? 'completed' : last,
    completedAt: n === 1 || last === 'completed' ? '2026-02-01T10:00:00Z' : null
  }))
});

let bump = 0;
/**
 * Give a project a spec that `session` closed with no digest: the session's
 * first prompt arrives while the last task is open — a prompt with nothing to
 * search, so no related spec is spent on it — and then the task completes.
 */
function addClosed(root, { digest = false, session = 'p1' } = {}) {
  const frame = path.join(root, '.frame');
  fs.mkdirSync(path.join(frame, 'specs', 'close-me'), { recursive: true });
  if (digest) fs.writeFileSync(path.join(frame, 'specs', 'close-me', 'digest.md'), '---\nkeywords: a\n---\nDone.\n');
  const file = path.join(frame, 'tasks.json');
  fs.writeFileSync(file, closeMeTasks('in_progress'));
  assert.equal(runHook('prompt', { session_id: session, cwd: root, prompt: 'ok' }), null, 'nothing owed at the first look');
  fs.writeFileSync(file, closeMeTasks('completed'));
  bump += 1;
  const at = new Date(Date.now() + bump * 1000);
  fs.utimesSync(file, at, at);
  return root;
}

/** An index whose topics all match "telemetry", each with a digest line of `width` characters. */
function wideIndex(slugs, width) {
  const topics = {};
  for (const slug of slugs) {
    topics[slug] = {
      title: slug, phase: 'done', keywords: ['telemetry'], declared: true, related: [], supersedes: null,
      digestLine: `${slug} ${'x'.repeat(width)}`.slice(0, width), paths: []
    };
  }
  return { version: 2, generatedAt: 'x', root: 'x', topics, files: {} };
}

const ctxOf = (out) => out.hookSpecificOutput.additionalContext;
const prompt = (root, text, session = 'p1') => ({ session_id: session, cwd: root, prompt: text });

test('a prompt with nothing to search still carries the close reminder', () => {
  for (const make of [() => mkProject(null), () => mkProject(IDX_ONE)]) {
    const root = addClosed(make());
    const out = runHook('prompt', prompt(root, 'ok'));
    assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.equal(ctxOf(out), CLOSE_LINE);
  }
});

test('with related specs the reminder goes first and the block follows as it always was', () => {
  const plain = ctxOf(runHook('prompt', prompt(mkProject(IDX_ONE), 'telemetry polling')));
  assert.ok(plain.startsWith(TOPIC_HEADER), 'without a closed spec the payload is unchanged');

  const root = addClosed(mkProject(IDX_ONE));
  const ctx = ctxOf(runHook('prompt', prompt(root, 'telemetry polling')));
  assert.equal(ctx, `${CLOSE_LINE}\n\n${plain}`);
  // Both were delivered, so neither repeats in the session.
  assert.equal(runHook('prompt', prompt(root, 'telemetry polling')), null);
});

test('once the digest exists the prompt payload is exactly the related specs', () => {
  const root = addClosed(mkProject(IDX_ONE), { digest: true });
  assert.ok(ctxOf(runHook('prompt', prompt(root, 'telemetry polling'))).startsWith(TOPIC_HEADER));
  assert.equal(runHook('prompt', prompt(root, 'ok', 'p2')), null);
});

test('over the inline limit, related specs are dropped from the end and come back later', () => {
  // 500-character lines: two fit beside the reminder and the fix sentence for
  // the finished specs they name, three do not.
  const root = addClosed(mkProject(wideIndex(['spec-one', 'spec-two', 'spec-three'], 500)));
  const first = ctxOf(runHook('prompt', prompt(root, 'telemetry')));
  assert.ok(first.startsWith(`${CLOSE_LINE}\n\n${TOPIC_HEADER}`));
  assert.ok(first.length <= BUDGET, `${first.length} chars exceeds ${BUDGET}`);
  assert.match(first, /- spec-one \(done\)/);
  assert.match(first, /- spec-two \(done\)/);
  assert.ok(!first.includes('spec-three'), 'the last line gave way, and is not named in the fix sentence either');
  assert.match(first, /finished work of spec-one or spec-two, record it/, 'the fix sentence names what was sent');
  assert.match(first, /Ask the user if you are not sure whether it does\.$/, 'the block is still whole');

  // The dropped spec was not marked as shown: the next prompt delivers it,
  // and only it — the reminder and the two sent lines are not repeated.
  const second = ctxOf(runHook('prompt', prompt(root, 'telemetry')));
  assert.ok(second.startsWith(TOPIC_HEADER));
  assert.match(second, /- spec-three \(done\)/);
  assert.ok(!second.includes('spec-one') && !second.includes('spec-two'));
  assert.equal(runHook('prompt', prompt(root, 'telemetry')), null);
});

test('when not even one related spec fits, the reminder goes alone and says why in the record', () => {
  const root = addClosed(mkProject(wideIndex(['spec-one'], 2500)));
  withActivity(root, (env) => {
    assert.equal(ctxOf(runHook('prompt', prompt(root, 'telemetry'), { env })), CLOSE_LINE);
    const rows = recordsFor(root);
    assert.deepEqual(rows.map((r) => [r.ev, r.mode, r.reason || null]),
      [['hint.injected', 'spec-close', null], ['hint.quiet', 'prompt', 'no-context']]);
    // Unmarked, so it arrives on the next prompt the way it always did.
    assert.match(ctxOf(runHook('prompt', prompt(root, 'telemetry'), { env })), /- spec-one \(done\)/);
  });
});

test('Codex inlines more, so nothing is dropped there', () => {
  const root = addClosed(mkProject(wideIndex(['spec-one', 'spec-two', 'spec-three'], 700)));
  const stdout = execFileSync('node', [HINT, 'prompt', 'codex'], {
    input: JSON.stringify({ ...prompt(root, 'telemetry'), turn_id: 't', model: 'm' }), encoding: 'utf8'
  });
  const ctx = ctxOf(JSON.parse(stdout));
  assert.ok(ctx.startsWith(CLOSE_LINE));
  for (const slug of ['spec-one', 'spec-two', 'spec-three']) assert.ok(ctx.includes(`- ${slug} (done)`));
  assert.ok(ctx.length > 2000);
});

test('a prompt naming a finished spec carries the fix rule for it', () => {
  const ctx = ctxOf(runHook('prompt', prompt(mkProject(IDX_ONE), 'telemetry polling')));
  assert.ok(ctx.startsWith(TOPIC_HEADER));
  assert.match(ctx, /\nIf this request fixes or adjusts the finished work of perf-spec, record it in the same commit: a "## Fix — <title>" entry in \.frame\/specs\/perf-spec\/outcome\.md, and, if it changes a decision the digest records, the digest updated in place with a "Revised <YYYY-MM-DD>: …" line before its Chain line\. Ask the user if you are not sure whether it does\.$/);
});

test('an in-flight spec carries no fix rule; several finished ones are named together', () => {
  const idx = wideIndex(['done-a', 'live-b', 'done-c'], 40);
  idx.topics['live-b'].phase = 'implementing';
  const ctx = ctxOf(runHook('prompt', prompt(mkProject(idx), 'telemetry')));
  assert.match(ctx, /- live-b \(implementing\)/);
  assert.match(ctx, /finished work of done-a or done-c, record it in the same commit: a "## Fix — <title>" entry in the outcome\.md of the spec it touches/);
  assert.ok(!/finished work of[^.]*live-b/.test(ctx));
});

test('a prompt in a session that started after the close carries no reminder', () => {
  const root = addClosed(mkProject(IDX_ONE));
  assert.equal(ctxOf(runHook('prompt', prompt(root, 'ok'))), CLOSE_LINE, 'the closing session hears it');
  assert.equal(runHook('prompt', prompt(root, 'ok', 'later')), null);
  assert.ok(ctxOf(runHook('prompt', prompt(root, 'telemetry polling', 'later'))).startsWith(TOPIC_HEADER), 'related specs only');
});

test('a reminder the docs hook already gave on a tool call is not repeated at the prompt', () => {
  const root = addClosed(mkProject(IDX_ONE), { session: 'same' });
  const tool = execFileSync('node', [DOCS_HINT, 'pre-edit'], {
    input: JSON.stringify({ session_id: 'same', cwd: root, tool_name: 'Bash', tool_input: { command: 'git status' } }),
    encoding: 'utf8'
  });
  assert.equal(ctxOf(JSON.parse(tool)), CLOSE_LINE);

  const ctx = ctxOf(runHook('prompt', prompt(root, 'telemetry polling', 'same')));
  assert.ok(ctx.startsWith(TOPIC_HEADER), 'related specs only');
  assert.ok(!ctx.includes('close-me'));
  assert.equal(runHook('prompt', prompt(root, 'ok', 'same')), null);
});

test('and one given at the prompt is not repeated on the next tool call', () => {
  const root = addClosed(mkProject(null), { session: 'same' });
  assert.equal(ctxOf(runHook('prompt', prompt(root, 'ok', 'same'))), CLOSE_LINE);
  const tool = execFileSync('node', [DOCS_HINT, 'pre-edit'], {
    input: JSON.stringify({ session_id: 'same', cwd: root, tool_name: 'Bash', tool_input: { command: 'git status' } }),
    encoding: 'utf8'
  });
  assert.equal(tool.trim(), '');
});

test('the prompt-time reminder and its quiet reasons are recorded under spec-close', () => {
  const root = addClosed(mkProject(null));
  withActivity(root, (env) => {
    runHook('prompt', prompt(root, 'ok'), { env });
    runHook('prompt', prompt(root, 'ok'), { env });
    runHook('prompt', prompt(root, 'ok'), { env });
    const rows = recordsFor(root).filter((r) => r.mode === 'spec-close');
    assert.deepEqual(rows.map((r) => [r.ev, r.kind, r.host, r.specs ?? null, r.reason ?? null]), [
      ['hint.injected', 'action', 'claude-hook', 1, null],
      ['hint.quiet', 'suppression', 'claude-hook', null, 'session-dedup']
    ]);
    for (const row of rows) {
      const kept = events.validateEvent(row.ev, row);
      assert.equal(kept.mode, 'spec-close');
      if (row.reason) assert.equal(kept.reason, row.reason);
    }
  });
});

test('an unreadable tasks.json leaves prompt mode exactly as it was', () => {
  const root = addClosed(mkProject(IDX_ONE));
  fs.writeFileSync(path.join(root, '.frame', 'tasks.json'), '{ truncated');
  assert.ok(ctxOf(runHook('prompt', prompt(root, 'telemetry polling'))).startsWith(TOPIC_HEADER));
  assert.equal(runHook('prompt', prompt(root, 'ok', 'p2')), null);
});

test('a .frame/bin/ without the helper surfaces related specs as before and nothing else', () => {
  const root = addClosed(mkProject(IDX_ONE));
  const bin = path.join(root, '.frame', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const file of ['spec-hint.js', 'toolVocabulary.js', 'activity-log.js', 'redact.js']) {
    fs.copyFileSync(path.join(__dirname, '..', 'scripts', file), path.join(bin, file));
  }
  const run = (input) => {
    const stdout = execFileSync('node', [path.join(bin, 'spec-hint.js'), 'prompt'], { input: JSON.stringify(input), encoding: 'utf8' });
    return stdout.trim() ? JSON.parse(stdout) : null;
  };
  assert.equal(run(prompt(root, 'ok')), null);
  assert.ok(ctxOf(run(prompt(root, 'telemetry polling'))).startsWith(TOPIC_HEADER));
});

// ─── decision cards at edit time (decision-cards-core T06) ──

const decisionCards = require('../scripts/decision-cards');

const CARD = (over = {}) => ({
  id: '20261014-aaaaaa', date: '2026-10-14',
  decision: 'Card files merge with the union driver.',
  why: 'Two branches each append a card, and a union merge keeps both.',
  keywords: ['union merge'], files: ['src/main/a.js'],
  source: 'notes:2026-10-14 Union merge for cards', supersedes: null, extends: null, ...over
});

function withCards(root, cards) {
  fs.writeFileSync(decisionCards.cardsPath(root), cards.map((c) => JSON.stringify(c)).join('\n') + '\n');
  return root;
}

const editAt = (root, file, session = 'dc') => runHook('pre-edit', { session_id: session, cwd: root, tool_input: { file_path: file } });
const ctxOfEdit = (out) => out && out.hookSpecificOutput.additionalContext;

test('a file with no spec history still gets its spec-less card, once per session', () => {
  const root = withCards(mkProject(IDX_ONE), [CARD({ files: ['src/untouched.js'] })]);
  const ctx = ctxOfEdit(editAt(root, 'src/untouched.js'));
  assert.ok(ctx.startsWith('Recorded decisions for src/untouched.js (newest first):\n'));
  assert.match(ctx, /- 2026-10-14 20261014-aaaaaa — Card files merge with the union driver\.\n  why: Two branches/);
  assert.match(ctx, /story: PROJECT_NOTES\.md "### \[2026-10-14\] Union merge for cards"/);
  assert.match(ctx, /Respect them; to overturn one, say so to the user first/);
  assert.ok(!/Spec history/.test(ctx));
  assert.equal(editAt(root, 'src/untouched.js'), null, 'once per session');
  assert.ok(ctxOfEdit(editAt(root, 'src/untouched.js', 'another-session')), 'a new session hears it again');
});

test('a file with spec history gets the history unchanged, then its cards', () => {
  const plain = ctxOfEdit(editAt(mkProject(IDX_ONE), 'src/main/a.js'));
  const ctx = ctxOfEdit(editAt(withCards(mkProject(IDX_ONE), [CARD()]), 'src/main/a.js'));
  assert.ok(ctx.startsWith(`${plain}\n\nRecorded decisions for src/main/a.js (newest first):\n`));
});

test('a card added later reaches a file already announced, and only the new card is sent', () => {
  const root = withCards(mkProject(IDX_ONE), [CARD()]);
  assert.ok(ctxOfEdit(editAt(root, 'src/main/a.js')));
  withCards(root, [CARD(), CARD({ id: '20261015-bbbbbb', date: '2026-10-15', decision: 'A newer decision here.' })]);
  const ctx = ctxOfEdit(editAt(root, 'src/main/a.js'));
  assert.ok(ctx.startsWith('Recorded decisions for src/main/a.js'), 'the history is not repeated');
  assert.match(ctx, /A newer decision here\./);
  assert.ok(!/union driver/.test(ctx), 'the card already shown is not repeated');
});

test('spec cards and superseded cards are never delivered', () => {
  const root = withCards(mkProject(IDX_ONE), [
    CARD({ id: '20261001-aaaaaa', date: '2026-10-01', files: ['src/x.js'], source: 'spec:perf-spec', decision: 'A spec decision.' }),
    CARD({ id: '20261002-bbbbbb', date: '2026-10-02', files: ['src/x.js'], decision: 'The old rule.' }),
    CARD({ id: '20261003-cccccc', date: '2026-10-03', files: ['src/x.js'], decision: 'The new rule.', supersedes: '20261002-bbbbbb' })
  ]);
  const ctx = ctxOfEdit(editAt(root, 'src/x.js'));
  assert.match(ctx, /The new rule\./);
  assert.match(ctx, /\(supersedes 20261002-bbbbbb\)/);
  assert.ok(!/A spec decision\.|The old rule\./.test(ctx));
  const specOnly = withCards(mkProject(IDX_ONE), [CARD({ files: ['src/y.js'], source: 'spec:perf-spec' })]);
  assert.equal(editAt(specOnly, 'src/y.js'), null);
});

test('three or more cards go one line each, with the command that prints them whole', () => {
  const cards = [1, 2, 3].map((n) => CARD({ id: `2026101${n}-00000${n}`, date: `2026-10-1${n}`, files: ['src/z.js'], decision: `Decision number ${n}.` }));
  const ctx = ctxOfEdit(editAt(withCards(mkProject(IDX_ONE), cards), 'src/z.js'));
  assert.ok(ctx.indexOf('Decision number 3.') < ctx.indexOf('Decision number 1.'), 'newest first');
  assert.ok(!/why:/.test(ctx), 'compact');
  assert.match(ctx, /Full cards: node .*decision\.js list/);
});

test('cards give way under the inline cap; the ones left out come on a later edit', () => {
  const long = (n) => CARD({
    id: `2026101${n}-00000${n}`, date: `2026-10-1${n}`, files: ['src/main/a.js'],
    decision: `Decision ${n} ${'word '.repeat(45).trim()}.`, why: `${'reason '.repeat(35).trim()}.`
  });
  const idx = JSON.parse(JSON.stringify(IDX_ONE));
  idx.files['src/main/a.js'] = [REC('perf-spec', { line: 'y'.repeat(330), flags: { current: true } })];
  const root = withCards(mkProject(idx), [1, 2, 3, 4, 5, 6].map(long));
  const first = ctxOfEdit(editAt(root, 'src/main/a.js'));
  assert.ok(first.length <= 1980, `${first.length} chars`);
  assert.ok(first.includes('Recorded decisions for'), 'at least one card fits');
  assert.ok(!/why:/.test(first), 'one line per card before any card is dropped');
  const sent = first.match(/2026101\d-00000\d/g) || [];
  assert.ok(sent.length >= 1 && sent.length < 6, `${sent.length} sent`);
  const second = ctxOfEdit(editAt(root, 'src/main/a.js'));
  const rest = second.match(/2026101\d-00000\d/g) || [];
  assert.ok(rest.length > 0 && rest.every((id) => !sent.includes(id)), 'the rest arrive next time, and only the rest');
});

test('signal mode sends one pointer line for the cards', () => {
  const root = withCards(mkProject(IDX_ONE), [CARD({ files: ['src/untouched.js'] })]);
  const out = runHook('pre-edit', { session_id: 'sig', cwd: root, tool_input: { file_path: 'src/untouched.js' } },
    { env: { FRAME_SPEC_HINT_MODE: 'signal' } });
  assert.match(ctxOfEdit(out), /^This file has 1 recorded decision card\(s\)\. Before editing, run: node .*decision\.js related --files src\/untouched\.js$/);
});

test('a Codex apply_patch gets the patched file\'s cards', () => {
  const root = withCards(mkProject(IDX_ONE), [CARD({ files: ['src/untouched.js'] })]);
  const command = ['*** Begin Patch', '*** Update File: src/untouched.js', '+x', '*** End Patch'].join('\n');
  const stdout = execFileSync('node', [HINT, 'pre-edit', 'codex'], {
    input: JSON.stringify({ session_id: 'cx', cwd: root, tool_name: 'apply_patch', tool_input: { command }, turn_id: 't', model: 'm' }),
    encoding: 'utf8'
  });
  assert.match(JSON.parse(stdout).hookSpecificOutput.additionalContext, /Card files merge with the union driver/);
});

test('a card delivery is recorded under its own mode, beside the history row', () => {
  const root = withCards(mkProject(IDX_ONE), [CARD()]);
  withActivity(root, (env) => {
    runHook('pre-edit', { cwd: root, session_id: 'r1', tool_input: { file_path: 'src/main/a.js' } }, { env });
    const injected = recordsFor(root).filter((r) => r.ev === 'hint.injected').map((r) => [r.mode, r.path, r.cards ?? null]);
    assert.deepEqual(injected, [['pre-edit', 'src/main/a.js', null], ['decision-edit', 'src/main/a.js', 1]]);
  });
});

// With no card file, every pre-edit payload and record is the one the hook
// sent before cards existed. Pinned against the last commit before this spec.
const BEFORE_CARDS = (() => {
  try {
    return execFileSync('git', ['show', '8ce2aa8:scripts/spec-hint.js'],
      { cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null; // a shallow clone
  }
})();

test('with no card file, pre-edit is byte-identical to the hook before cards', { skip: !BEFORE_CARDS && 'history unavailable' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-hint-before-'));
  for (const f of ['activity-log.js', 'redact.js', 'toolVocabulary.js', 'spec-close-state.js', 'decision-cards.js']) {
    fs.copyFileSync(path.join(__dirname, '..', 'scripts', f), path.join(dir, f));
  }
  fs.writeFileSync(path.join(dir, 'spec-hint.js'), BEFORE_CARDS);
  // The current hook in a twin folder with the same siblings, so the paths
  // each one names for its helpers resolve alike.
  const twin = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-hint-after-'));
  for (const f of fs.readdirSync(dir)) fs.copyFileSync(path.join(dir, f), path.join(twin, f));
  fs.copyFileSync(HINT, path.join(twin, 'spec-hint.js'));
  const run = (script, root, payload, env = {}) => execFileSync('node', [script, 'pre-edit'], {
    input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, ...env }
  });
  for (const file of ['src/main/a.js', 'src/many.js', 'src/none.js', '.frame/tasks.json', '../out.js']) {
    for (const env of [{}, { FRAME_SPEC_HINT_MODE: 'signal' }]) {
      const a = mkProject(IDX_ONE);
      const b = mkProject(IDX_ONE);
      const payload = (root) => ({ session_id: 'same', cwd: root, tool_input: { file_path: file } });
      const before = [run(path.join(dir, 'spec-hint.js'), a, payload(a), env), run(path.join(dir, 'spec-hint.js'), a, payload(a), env)];
      const after = [run(path.join(twin, 'spec-hint.js'), b, payload(b), env), run(path.join(twin, 'spec-hint.js'), b, payload(b), env)];
      assert.deepEqual(after.map((o) => o.split(b).join('<root>')), before.map((o) => o.split(a).join('<root>')), `${file} ${JSON.stringify(env)}`);
    }
  }
});

// ─── decision cards at prompt time (decision-cards-core T09) ──

const CARD_HEADER = 'Recorded decisions that may apply (from the project\'s decision cards):';
const mergeCard = (over = {}) => CARD({ files: [], keywords: ['union merge', 'gitattributes'], ...over });

test('a prompt that matches a spec-less card strongly gets it; one rare word is not enough', () => {
  const root = withCards(mkProject(IDX_ONE), [mergeCard()]);
  assert.equal(runHook('prompt', prompt(root, 'how do gitattributes work')), null, 'one rare word scores 2');
  const ctx = ctxOf(runHook('prompt', prompt(root, 'set up the union merge in gitattributes')));
  assert.ok(ctx.startsWith(`${CARD_HEADER}\n- 2026-10-14 20261014-aaaaaa — Card files merge with the union driver.\n  why: `));
  assert.match(ctx, /If one of these decisions bears on this request, respect it/);
});

test('at most two cards, the strongest first, and each once per session', () => {
  const root = withCards(mkProject(IDX_ONE), [
    mergeCard({ id: '20261011-aaaaaa', date: '2026-10-11', decision: 'Union merge keeps both card lines.', keywords: ['union merge'] }),
    mergeCard({ id: '20261012-bbbbbb', date: '2026-10-12', decision: 'Gitattributes carries the union merge rule.', keywords: ['union merge', 'gitattributes'] }),
    mergeCard({ id: '20261013-cccccc', date: '2026-10-13', decision: 'A union merge never conflicts on cards.', keywords: ['union merge'] })
  ]);
  const first = ctxOf(runHook('prompt', prompt(root, 'union merge gitattributes rule')));
  const sent = first.match(/2026101\d-[a-c]{6}/g);
  assert.equal(sent.length, 2);
  assert.equal(sent[0], '20261012-bbbbbb', 'the best match leads');
  const second = ctxOf(runHook('prompt', prompt(root, 'union merge gitattributes rule')));
  assert.deepEqual(second.match(/2026101\d-[a-c]{6}/g), ['20261011-aaaaaa', '20261013-cccccc'].filter((id) => !sent.includes(id)));
  assert.equal(runHook('prompt', prompt(root, 'union merge gitattributes rule')), null, 'nothing new is left');
});

test('a card shown before an edit is not shown again at a prompt', () => {
  const root = withCards(mkProject(IDX_ONE), [mergeCard({ files: ['src/untouched.js'] })]);
  assert.ok(ctxOfEdit(editAt(root, 'src/untouched.js', 'p1')));
  assert.equal(runHook('prompt', prompt(root, 'union merge in gitattributes', 'p1')), null);
});

test('spec cards and superseded cards never reach a prompt', () => {
  const root = withCards(mkProject(IDX_ONE), [
    mergeCard({ id: '20261001-aaaaaa', date: '2026-10-01', source: 'spec:perf-spec', decision: 'A spec decision on union merge.' }),
    mergeCard({ id: '20261002-bbbbbb', date: '2026-10-02', decision: 'The old union merge rule.' }),
    mergeCard({ id: '20261003-cccccc', date: '2026-10-03', decision: 'The new union merge rule.', supersedes: '20261002-bbbbbb' })
  ]);
  const ctx = ctxOf(runHook('prompt', prompt(root, 'union merge gitattributes')));
  assert.match(ctx, /The new union merge rule\./);
  assert.ok(!/A spec decision|The old union merge rule/.test(ctx));
});

test('related specs come first as they always were, and the cards follow', () => {
  const plain = ctxOf(runHook('prompt', prompt(mkProject(IDX_ONE), 'telemetry polling union merge gitattributes')));
  const root = withCards(mkProject(IDX_ONE), [mergeCard()]);
  const ctx = ctxOf(runHook('prompt', prompt(root, 'telemetry polling union merge gitattributes')));
  assert.ok(ctx.startsWith(`${plain}\n\n${CARD_HEADER}\n`));
});

test('cards give way first under the cap: the reminder and related specs stay whole', () => {
  // A reminder plus related specs that leave little room: the cards shrink
  // to one line each, then drop — the rest arrives unchanged.
  const index = wideIndex(['spec-one', 'spec-two'], 600);
  const without = addClosed(mkProject(index));
  const expected = ctxOf(runHook('prompt', prompt(without, 'telemetry union merge gitattributes')));
  const root = withCards(addClosed(mkProject(index)), [mergeCard({ why: `${'reason '.repeat(60).trim()}.` })]);
  const ctx = ctxOf(runHook('prompt', prompt(root, 'telemetry union merge gitattributes')));
  assert.ok(ctx.startsWith(expected), 'the reminder and the specs are untouched');
  assert.ok(ctx.length <= BUDGET, `${ctx.length} chars`);
  assert.ok(ctx.includes(CARD_HEADER), 'the card still fits');
  assert.ok(!/why:/.test(ctx.slice(expected.length)), 'one line, because in full it would not');

  const tight = wideIndex(['spec-one', 'spec-two'], 850);
  const full = withCards(addClosed(mkProject(tight)), [mergeCard()]);
  const alone = ctxOf(runHook('prompt', prompt(addClosed(mkProject(tight)), 'telemetry union merge gitattributes')));
  const out = ctxOf(runHook('prompt', prompt(full, 'telemetry union merge gitattributes')));
  assert.equal(out, alone, 'no room: exactly what was sent without cards');
  assert.match(ctxOf(runHook('prompt', prompt(full, 'union merge gitattributes'))), /Card files merge/, 'the card waited, unmarked');
});

test('Codex inlines more, so both cards arrive in full', () => {
  const root = withCards(mkProject(IDX_ONE), [
    mergeCard({ id: '20261011-aaaaaa', date: '2026-10-11', why: `${'reason '.repeat(60).trim()}.` }),
    mergeCard({ id: '20261012-bbbbbb', date: '2026-10-12', why: `${'reason '.repeat(60).trim()}.` })
  ]);
  const stdout = execFileSync('node', [HINT, 'prompt', 'codex'], {
    input: JSON.stringify({ ...prompt(root, 'union merge gitattributes'), turn_id: 't', model: 'm' }), encoding: 'utf8'
  });
  const ctx = ctxOf(JSON.parse(stdout));
  assert.equal((ctx.match(/\n  why: /g) || []).length, 2);
});

test('a prompt card delivery is recorded under its own mode', () => {
  const root = withCards(mkProject(IDX_ONE), [mergeCard()]);
  withActivity(root, (env) => {
    runHook('prompt', prompt(root, 'union merge gitattributes'), { env });
    const rows = recordsFor(root).filter((r) => r.ev === 'hint.injected').map((r) => [r.mode, r.cards ?? null]);
    assert.deepEqual(rows, [['decision-prompt', 1]]);
  });
});

test('with no card file, prompt mode is byte-identical to the hook before cards', { skip: !BEFORE_CARDS && 'history unavailable' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-hint-before-p-'));
  for (const f of ['activity-log.js', 'redact.js', 'toolVocabulary.js', 'spec-close-state.js', 'decision-cards.js']) {
    fs.copyFileSync(path.join(__dirname, '..', 'scripts', f), path.join(dir, f));
  }
  const twin = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-hint-after-p-'));
  for (const f of fs.readdirSync(dir)) fs.copyFileSync(path.join(dir, f), path.join(twin, f));
  fs.writeFileSync(path.join(dir, 'spec-hint.js'), BEFORE_CARDS);
  fs.copyFileSync(HINT, path.join(twin, 'spec-hint.js'));
  const run = (script, payload, args = []) => execFileSync('node', [script, 'prompt', ...args], {
    input: JSON.stringify(payload), encoding: 'utf8'
  });
  const shapes = [
    () => mkProject(IDX_ONE),
    () => addClosed(mkProject(IDX_ONE)),
    () => addClosed(mkProject(wideIndex(['spec-one', 'spec-two', 'spec-three'], 700))),
    () => mkProject(null)
  ];
  for (const text of ['telemetry polling', 'ok', 'telemetry', 'nothing relevant at all']) {
    for (const [i, make] of shapes.entries()) {
      for (const args of [[], ['codex']]) {
        const a = make();
        const b = make();
        const before = [run(path.join(dir, 'spec-hint.js'), prompt(a, text), args), run(path.join(dir, 'spec-hint.js'), prompt(a, text), args)];
        const after = [run(path.join(twin, 'spec-hint.js'), prompt(b, text), args), run(path.join(twin, 'spec-hint.js'), prompt(b, text), args)];
        assert.deepEqual(after.map((o) => o.split(b).join('<root>')), before.map((o) => o.split(a).join('<root>')), `"${text}" shape ${i} ${args.join(' ')}`);
      }
    }
  }
});
