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
  // payloads sit under that, but `digestLine` is whatever the first body
  // line of a digest happens to be, so nothing bounds prompt mode.
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
  assert.match(ctx, /read the spec chain/); // the tail survived the write
});
