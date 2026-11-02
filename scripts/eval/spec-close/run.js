#!/usr/bin/env node
/**
 * Spec close step — test run.
 *
 * Launches headless Claude Code sessions over throwaway fixtures
 * (make-fixture.js), several at a time, and reads off each one whether the
 * spec ended with a well-formed digest. An internal measurement instrument,
 * not a product surface. It spends money: every session is a real model run.
 *
 *   node scripts/eval/spec-close/run.js --n 1                 # one session per kind (the pilot)
 *   node scripts/eval/spec-close/run.js --n 10 --kinds closing-turn,fix-decision
 *   node scripts/eval/spec-close/run.js --dry-run --n 2       # build fixtures, print the launch lines, run nothing
 *
 * Options:
 *   --n <count>              sessions per kind (required; there is no default spend)
 *   --kinds <a,b>            which kinds (default: all three)
 *   --concurrency <count>    sessions at a time (default 3)
 *   --budget-natural <usd>   --max-budget-usd for a natural session (default 4)
 *   --budget-other <usd>     --max-budget-usd for a session of any other kind (default 2)
 *   --timeout <seconds>      per session (default 900)
 *   --model <id>             passed to the CLI; default is the CLI's own default
 *   --agent <command>        the CLI binary (default: claude)
 *   --out <dir>              where results go (default: scripts/eval/results/spec-close-<stamp>)
 *   --keep                   leave the fixtures on disk and print where they are
 *   --dry-run                no session is started
 *
 * What a pass is depends on the kind (see `judge`): the digest `ok` and in
 * the last task's commit (natural), the digest `ok` after the reminder
 * (closing-turn), no reminder and the digest untouched (earlier-close), a Fix
 * entry with the digest unchanged (fix-bug) or revised (fix-decision), the
 * fix itself passing the project's tests. Also read off, because a pass alone
 * does not say why: whether a reminder fired (the hooks' rows in the
 * fixture's own activity record), whether the session ran the close script
 * itself, and what the session cost.
 *
 * How a session is launched is how Frame launches an autonomous implement
 * run: the permission file src/templates/bin/implement-launch.js builds, and
 * `--permission-mode auto`. On top of that, isolation the fixture needs and
 * a user's project does not: project settings only (the fixture's hooks, not
 * the hooks of whoever runs this), no MCP servers, no saved session, and the
 * usual refusals for a headless run that must not reach anything outside its
 * own directory.
 *
 * What it can show, at the sizes it is run at: 10 passes out of 10 bound the
 * miss rate under roughly one in four; 30 out of 30 under one in ten.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..', '..');
const { makeFixture, KINDS } = require('./make-fixture');
const launch = require(path.join(REPO, 'src', 'templates', 'bin', 'implement-launch.js'));

// A headless session cannot be asked "are you sure". These are refused
// outright, on top of the deny list Frame's own permission file carries.
const DISALLOWED = ['Bash(git push:*)', 'Bash(supabase:*)', 'Bash(psql:*)', 'Bash(docker:*)', 'Bash(curl:*)', 'Bash(ssh:*)'];

// Variables that tie a child CLI to the session this script was started
// from, when it is started from inside one. A fixture session must be a
// session of its own. FRAME_* is dropped wholesale and the two the fixture
// needs are set again.
const PARENT_SESSION_VARS = [
  'CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_SESSION_ID', 'CLAUDE_EFFORT', 'CLAUDE_PID'
];

// A second prompt for the kinds whose claim lives in the next turn. A
// closing-turn session may close its spec in the turn's last call, and the
// product then speaks at the session's next prompt — which a single `-p` run
// never sends. Neutral on purpose: a question such as "anything left?" would
// steer the session toward the work and measure the question.
const FOLLOW_UP = { 'closing-turn': 'Thanks.' };

// ─── pure: arguments, environment ─────────────────────────

function parseArgs(argv) {
  const opts = {
    n: null, kinds: [...KINDS], concurrency: 3, budgetNatural: 4, budgetOther: 2,
    timeout: 900, model: null, agent: 'claude', out: null, keep: false, dryRun: false
  };
  const value = (i) => {
    if (argv[i + 1] === undefined) throw new Error(`${argv[i]} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--keep') opts.keep = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--n') opts.n = Number(value(i++));
    else if (a === '--concurrency') opts.concurrency = Number(value(i++));
    else if (a === '--budget-natural') opts.budgetNatural = Number(value(i++));
    else if (a === '--budget-other') opts.budgetOther = Number(value(i++));
    else if (a === '--timeout') opts.timeout = Number(value(i++));
    else if (a === '--kinds') opts.kinds = value(i++).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--model') opts.model = value(i++);
    else if (a === '--agent') opts.agent = value(i++);
    else if (a === '--out') opts.out = value(i++);
    else throw new Error(`unknown option ${a}`);
  }
  if (!Number.isInteger(opts.n) || opts.n < 1) throw new Error('--n <count> is required: sessions per kind');
  for (const kind of opts.kinds) if (!KINDS.includes(kind)) throw new Error(`unknown kind "${kind}"`);
  for (const key of ['concurrency', 'budgetNatural', 'budgetOther', 'timeout']) {
    if (!(opts[key] > 0)) throw new Error(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} must be positive`);
  }
  return opts;
}

/**
 * The CLI arguments for one turn of a fixture session. A session is not kept
 * on disk unless it has a follow-up turn: `--resume` needs the saved session,
 * and resuming keeps its id, which is what lets the helper see the second
 * turn as the session that closed the spec.
 */
function agentArgs({ prompt, settingsPath, budget, model, persist = false, resume = null }) {
  const args = [
    '-p', prompt,
    '--output-format', 'stream-json', '--verbose',
    '--max-budget-usd', String(budget),
    '--settings', settingsPath, '--permission-mode', 'auto',
    '--setting-sources', 'project',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'
  ];
  if (!persist) args.push('--no-session-persistence');
  if (resume) args.push('--resume', resume);
  args.push('--disallowedTools', ...DISALLOWED);
  if (model) args.push('--model', model);
  return args;
}

/** The environment for one fixture session: the caller's, minus what binds it to the caller. */
function sessionEnv(base, fixture) {
  const env = {};
  for (const [key, val] of Object.entries(base)) {
    if (key.startsWith('FRAME_') || PARENT_SESSION_VARS.includes(key)) continue;
    env[key] = val;
  }
  env.FRAME_ACTIVITY_HOME = fixture.activityHome;
  // The implement flow generates its report with "$FRAME_NODE" and, seeing it
  // set, leaves opening the report to Frame — so a fixture run never opens a
  // browser window.
  env.FRAME_NODE = process.execPath;
  return env;
}

// ─── pure: reading a session back ─────────────────────────

/**
 * A stream-json transcript → the few facts the table needs. Tolerant of
 * lines it does not know: the stream's shape is the CLI's, not ours.
 */
function parseTranscript(text) {
  const out = {
    model: null, sessionId: null, costUsd: null, turns: null, durationMs: null, toolCalls: 0, tools: {},
    resultSubtype: null, isError: null, ranCloseScript: 0, wroteDigest: 0
  };
  // A two-turn session is two streams back to back: one init and one result
  // per turn. Cost, turns and time add up; the last result says how it ended.
  const add = (key, value) => { out[key] = (out[key] || 0) + value; };
  for (const raw of String(text || '').split('\n')) {
    if (!raw.trim()) continue;
    let ev;
    try { ev = JSON.parse(raw); } catch { continue; }
    if (ev.type === 'system' && ev.subtype === 'init') {
      if (ev.model) out.model = ev.model;
      if (ev.session_id && !out.sessionId) out.sessionId = ev.session_id;
    }
    if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
      for (const block of ev.message.content) {
        if (!block || block.type !== 'tool_use') continue;
        out.toolCalls += 1;
        out.tools[block.name] = (out.tools[block.name] || 0) + 1;
        const input = block.input || {};
        if (typeof input.command === 'string' && /spec-close\.js/.test(input.command)) out.ranCloseScript += 1;
        if (typeof input.file_path === 'string' && /(^|\/)digest\.md$/.test(input.file_path)) out.wroteDigest += 1;
      }
    }
    if (ev.type === 'result') {
      out.resultSubtype = ev.subtype || null;
      out.isError = ev.is_error === true;
      if (typeof ev.total_cost_usd === 'number') add('costUsd', ev.total_cost_usd);
      if (typeof ev.num_turns === 'number') add('turns', ev.num_turns);
      if (typeof ev.duration_ms === 'number') add('durationMs', ev.duration_ms);
    }
  }
  return out;
}

/**
 * The fixture's own activity rows that concern the close step.
 *
 * Every bucket in the home is read, not the one this process would key the
 * project by. The home belongs to one fixture, and the key is a hash of the
 * path the *hook* resolved: on macOS the temp directory is a symlink
 * (/var → /private/var) and the CLI hands its hooks the resolved path, so the
 * same project lands under a key this process never computes. The pilot read
 * zero reminders off three sessions that had each received one.
 */
function closeRows(activityHome) {
  let rows = [];
  let buckets = [];
  try { buckets = fs.readdirSync(activityHome); } catch { /* nothing recorded */ }
  for (const bucket of buckets) {
    try {
      rows = rows.concat(fs.readFileSync(path.join(activityHome, bucket, 'activity.jsonl'), 'utf8')
        .split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean));
    } catch { /* not a bucket */ }
  }
  rows.sort((a, b) => String(a.t).localeCompare(String(b.t)));
  const close = rows.filter((r) => r.mode === 'spec-close');
  return {
    reminders: close.filter((r) => r.ev === 'hint.injected').length,
    quiet: close.filter((r) => r.ev === 'hint.quiet').map((r) => r.reason),
    checks: rows.filter((r) => r.ev === 'spec.close_checked').map((r) => r.verdict)
  };
}

/**
 * Whether one session did what its kind asks of it. `facts` is what
 * `inspect` read off the fixture after the session; every rule is a plain
 * conjunction, so a failed pass can be traced to the fact that sank it.
 */
function judge(kind, f) {
  const all = (...conditions) => conditions.every((c) => c === true);
  switch (kind) {
    case 'natural': return all(f.verdict === 'ok', f.digestWithCode);
    case 'closing-turn': return all(f.verdict === 'ok');
    case 'earlier-close': return all(f.reminders === 0, f.verdict === 'missing');
    case 'fix-bug': return all(f.fixEntry, f.digestChanged === false, f.verdict === 'ok', f.testsPass, f.behaviour);
    case 'fix-decision': return all(f.fixEntry, f.revisedLine, f.verdict === 'ok', f.testsPass, f.behaviour);
    default: return false;
  }
}

/** One session's row. `facts` come from `inspect`, run after the session. */
function summarize({ id, kind, facts, transcript, rows, timedOut, exitCode }) {
  const { verdict, defects } = facts;
  return {
    id,
    kind,
    pass: judge(kind, { ...facts, reminders: rows.reminders }),
    verdict,
    defects,
    fixEntry: facts.fixEntry === true,
    digestChanged: facts.digestChanged === true,
    revisedLine: facts.revisedLine === true,
    digestWithCode: facts.digestWithCode === true,
    testsPass: facts.testsPass === true,
    behaviour: facts.behaviour === true,
    reminders: rows.reminders,
    quiet: rows.quiet,
    agentChecks: rows.checks,
    toolCalls: transcript.toolCalls,
    turns: transcript.turns,
    costUsd: transcript.costUsd,
    durationMs: transcript.durationMs,
    model: transcript.model,
    result: timedOut ? 'timeout' : (transcript.resultSubtype || `exit ${exitCode}`)
  };
}

const median = (values) => {
  const sorted = values.filter((v) => typeof v === 'number').sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Results → the markdown table recorded in the spec's outcome. */
function table(results) {
  const lines = [
    '| kind | sessions | pass | digest ok | reminder fired | ran the close script | Fix entry | digest revised | median tool calls | cost |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  ];
  for (const kind of KINDS) {
    const rows = results.filter((r) => r.kind === kind);
    if (!rows.length) continue;
    const count = (pred) => rows.filter(pred).length;
    const cost = rows.reduce((sum, r) => sum + (r.costUsd || 0), 0);
    lines.push([
      '', kind, rows.length,
      count((r) => r.pass),
      count((r) => r.verdict === 'ok'),
      count((r) => r.reminders > 0),
      count((r) => r.agentChecks.length > 0),
      count((r) => r.fixEntry),
      count((r) => r.revisedLine),
      median(rows.map((r) => r.toolCalls)) ?? '—',
      `$${cost.toFixed(2)}`, ''
    ].join(' | ').trim());
  }
  return lines.join('\n');
}

// ─── running ──────────────────────────────────────────────

function runTurn(fixture, opts, runDir, { prompt, resume = null, file = 'transcript.jsonl' }) {
  return new Promise((resolve) => {
    const settingsPath = path.join(fixture.base, 'implement-permissions.json');
    fs.writeFileSync(settingsPath, `${JSON.stringify(launch.buildPermissions('npm test'), null, 2)}\n`);
    const budget = fixture.kind === 'natural' ? opts.budgetNatural : opts.budgetOther;
    const persist = Boolean(FOLLOW_UP[fixture.kind]);
    const args = agentArgs({ prompt, settingsPath, budget, model: opts.model, persist, resume });

    const stdout = fs.createWriteStream(path.join(runDir, file));
    const stderr = fs.createWriteStream(path.join(runDir, file.replace(/^transcript/, 'stderr').replace(/\.jsonl$/, '.log')));
    const child = spawn(opts.agent, args, {
      cwd: fixture.root, env: sessionEnv(process.env, fixture), stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);

    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, opts.timeout * 1000);
    const finish = (exitCode) => {
      clearTimeout(timer);
      stdout.end(() => resolve({ exitCode, timedOut }));
    };
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code));
  });
}

/** One session: its prompt, and the follow-up turn when its kind has one. */
async function runSession(fixture, opts, runDir) {
  const first = await runTurn(fixture, opts, runDir, { prompt: fixture.prompt });
  const followUp = FOLLOW_UP[fixture.kind];
  if (!followUp || first.timedOut) return first;
  const { sessionId } = parseTranscript(fs.readFileSync(path.join(runDir, 'transcript.jsonl'), 'utf8'));
  if (!sessionId) return first;
  return runTurn(fixture, opts, runDir, { prompt: followUp, resume: sessionId, file: 'transcript-2.jsonl' });
}

/** Every turn's transcript of a run, back to back. */
const transcriptsOf = (runDir) => ['transcript.jsonl', 'transcript-2.jsonl']
  .map((file) => { try { return fs.readFileSync(path.join(runDir, file), 'utf8'); } catch { return ''; } })
  .join('\n');

const readOr = (file, fallback) => { try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; } };

/** What each fix kind's code must do once the session is over. */
const BEHAVIOUR = {
  'fix-bug': ['Ada', 'Hello, Ada!'],
  'fix-decision': ['', 'Hello, friend!']
};

/**
 * Whether the commit that added the digest also carries code — the digest
 * rode in a task's commit rather than one of its own. False when the digest
 * was never committed.
 */
function digestWithCode(root, slug) {
  try {
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    const added = git('log', '--diff-filter=A', '--format=%H', '--', `.frame/specs/${slug}/digest.md`).split('\n').filter(Boolean).pop();
    if (!added) return false;
    return git('show', '--name-only', '--format=', added).split('\n').some((f) => f && !f.startsWith('.frame/'));
  } catch {
    return false;
  }
}

/** What the fixture looks like after its session, read without changing it. */
function inspect(fixture, runDir) {
  const rows = closeRows(fixture.activityHome);
  const specDir = path.join(fixture.root, '.frame', 'specs', fixture.slug);
  const digestNow = readOr(path.join(specDir, 'digest.md'), null);
  const facts = {
    fixEntry: /^## Fix\s*[—–-]/m.test(readOr(path.join(specDir, 'outcome.md'), '')),
    digestChanged: digestNow !== fixture.digestBefore,
    revisedLine: /^Revised \d{4}-\d{2}-\d{2}:/m.test(digestNow || ''),
    digestWithCode: digestWithCode(fixture.root, fixture.slug),
    testsPass: false,
    behaviour: false
  };
  try {
    // Never the outer runner's NODE_TEST_CONTEXT: inherited under `node --test`, it makes the
    // fixture's own runner report to a parent and exit 0 on failing tests (Node 20.19).
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    execFileSync('npm', ['test'], { cwd: fixture.root, env, stdio: 'ignore', timeout: 120000 });
    facts.testsPass = true;
  } catch { /* the tests fail, or will not run */ }
  if (BEHAVIOUR[fixture.kind]) {
    const [input, expected] = BEHAVIOUR[fixture.kind];
    try {
      const got = execFileSync(process.execPath, ['-e', `process.stdout.write(require('./src/greet').greet(${JSON.stringify(input)}))`],
        { cwd: fixture.root, encoding: 'utf8', timeout: 30000 });
      facts.behaviour = got === expected;
    } catch { /* it does not load */ }
  }
  let check = { verdict: 'unreadable', defects: 0 };
  try {
    // Its own activity home: the measurement must not add a row to the record it is about to be judged by.
    const stdout = execFileSync(process.execPath, [path.join(fixture.root, '.frame', 'bin', 'spec-close.js'), fixture.slug, '--json'], {
      cwd: fixture.root, encoding: 'utf8',
      env: { ...sessionEnv(process.env, fixture), FRAME_ACTIVITY_HOME: path.join(fixture.base, 'measurement-activity') }
    });
    check = JSON.parse(stdout);
  } catch { /* leave it unreadable */ }
  try {
    fs.copyFileSync(path.join(fixture.root, '.frame', 'specs', fixture.slug, 'digest.md'), path.join(runDir, 'digest.md'));
  } catch { /* no digest was written */ }
  return { rows, facts: { ...facts, verdict: check.verdict, defects: check.defects || 0 } };
}

async function pool(items, size, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane));
  return results;
}

async function main(argv) {
  const opts = parseArgs(argv);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.resolve(opts.out || path.join(REPO, 'scripts', 'eval', 'results', `spec-close-${stamp}`));
  const plan = opts.kinds.flatMap((kind) => Array.from({ length: opts.n }, (_, i) => ({ kind, id: `${kind}-${String(i + 1).padStart(2, '0')}` })));

  if (opts.dryRun) {
    for (const { kind, id } of plan) {
      const fixture = makeFixture({ kind });
      const budget = kind === 'natural' ? opts.budgetNatural : opts.budgetOther;
      const settingsPath = path.join(fixture.base, 'implement-permissions.json');
      const persist = Boolean(FOLLOW_UP[kind]);
      const args = agentArgs({ prompt: fixture.prompt, settingsPath, budget, model: opts.model, persist });
      process.stdout.write(`${id}\n  cwd: ${fixture.root}\n  ${opts.agent} ${args.map((a) => JSON.stringify(a)).join(' ')}\n`);
      if (FOLLOW_UP[kind]) {
        const again = agentArgs({ prompt: FOLLOW_UP[kind], settingsPath, budget, model: opts.model, persist, resume: '<session id from turn 1>' });
        process.stdout.write(`  then: ${opts.agent} ${again.map((a) => JSON.stringify(a)).join(' ')}\n`);
      }
      if (!opts.keep) fs.rmSync(fixture.base, { recursive: true, force: true });
    }
    return 0;
  }

  fs.mkdirSync(outDir, { recursive: true });
  process.stdout.write(`${plan.length} session(s), ${opts.concurrency} at a time → ${path.relative(process.cwd(), outDir) || outDir}\n`);

  const results = await pool(plan, opts.concurrency, async ({ kind, id }) => {
    const runDir = path.join(outDir, id);
    fs.mkdirSync(runDir, { recursive: true });
    const fixture = makeFixture({ kind });
    const { exitCode, timedOut } = await runSession(fixture, opts, runDir);
    const transcript = parseTranscript(transcriptsOf(runDir));
    const { rows, facts } = inspect(fixture, runDir);
    const row = summarize({ id, kind, facts, transcript, rows, timedOut, exitCode });
    fs.writeFileSync(path.join(runDir, 'result.json'), `${JSON.stringify({ ...row, fixture: opts.keep ? fixture.base : null }, null, 2)}\n`);
    if (opts.keep) process.stdout.write(`  ${id}: fixture kept at ${fixture.base}\n`);
    else fs.rmSync(fixture.base, { recursive: true, force: true });
    process.stdout.write(`  ${id}: ${row.verdict}${row.reminders ? ' · reminded' : ''}${row.agentChecks.length ? ' · ran the script' : ''}` +
      ` · ${row.toolCalls} tool calls · ${row.costUsd === null ? 'cost unknown' : `$${row.costUsd.toFixed(2)}`} · ${row.result}\n`);
    return row;
  });

  const summary = table(results);
  fs.writeFileSync(path.join(outDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'summary.md'), `${summary}\n`);
  process.stdout.write(`\n${summary}\n`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((e) => {
    process.stderr.write(`${e.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, agentArgs, sessionEnv, parseTranscript, closeRows, judge, summarize, table, inspect, DISALLOWED, FOLLOW_UP };
