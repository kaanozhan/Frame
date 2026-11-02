/**
 * Spec close step — close script tests.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 *
 * The script is run the way an agent runs it: a child process against a
 * project on disk, its stdout read back. Three promises carry the weight:
 *
 *   - every defect is named, so the agent knows what to change;
 *   - nothing of the digest's text is ever printed or recorded;
 *   - it changes nothing — no phase, no state file, only its activity row.
 *
 * The exit code is asserted on every path because it is a decision, not a
 * detail: an unattended run stops when a check fails, so this one fails only
 * when asked to with `--strict`.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'spec-close.js');
const specClose = require('../scripts/spec-close');
const specIndex = require('../scripts/spec-index');
const events = require('../src/shared/activityEvents');
const activityLog = require('../scripts/activity-log');

const GOOD_DIGEST = [
  '---',
  'keywords: close step, digest',
  'related: spec-knowledge-layer',
  '---',
  'Added a close step that checks the digest. It wraps over',
  'two lines and says more afterwards.',
  '',
  'Chain: spec.md → plan.md → tasks.md → outcome.md',
  ''
].join('\n');

const task = (slug, n, status) => ({
  id: `task-spec-${slug}-T0${n}`, source: `spec:${slug}:T0${n}`, status,
  completedAt: status === 'completed' ? '2026-02-01T10:00:00Z' : null
});

/** A project with one spec. `digest` is the file's text, or null for none. */
function mkProject({ slug = 'a-spec', statuses = ['completed', 'completed'], digest = null, tasksRaw = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-specclose-cli-'));
  const dir = path.join(root, '.frame', 'specs', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ slug, phase: 'implementing' }));
  fs.writeFileSync(path.join(root, '.frame', 'tasks.json'),
    tasksRaw !== null ? tasksRaw : JSON.stringify({ tasks: statuses.map((s, i) => task(slug, i + 1, s)) }));
  if (digest !== null) fs.writeFileSync(path.join(dir, 'digest.md'), digest);
  return root;
}

function run(root, args) {
  const home = path.join(root, '.activity-home');
  const res = spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, FRAME_PROJECT_ROOT: root, FRAME_ACTIVITY_HOME: home }
  });
  let rows = [];
  try {
    rows = fs.readFileSync(path.join(home, activityLog.projectKey(root), 'activity.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { /* nothing recorded */ }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, rows };
}

/** Every file under the project, with its content — the activity home aside. */
function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.activity-home') continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else out[path.relative(root, p)] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(root);
  return out;
}

// ─── a well-formed digest ─────────────────────────────────

test('a well-formed digest is reported in one line', () => {
  const root = mkProject({ digest: GOOD_DIGEST });
  const out = run(root, ['a-spec']);
  assert.equal(out.status, 0);
  assert.equal(out.stdout,
    'a-spec: 2 of 2 tasks completed — closed\n' +
    'digest: ok — .frame/specs/a-spec/digest.md\n');
  assert.equal(out.stderr, '');
});

test('a well-formed digest passes --strict', () => {
  const root = mkProject({ digest: GOOD_DIGEST });
  assert.equal(run(root, ['a-spec', '--strict']).status, 0);
});

// ─── a missing digest ─────────────────────────────────────

test('a missing digest prints the shape to write and how to come back', () => {
  const root = mkProject();
  const out = run(root, ['a-spec']);
  assert.equal(out.status, 0, 'the verdict is in the output, not the exit code');
  assert.match(out.stdout, /^a-spec: 2 of 2 tasks completed — closed\n/);
  assert.match(out.stdout, /digest: missing — write \.frame\/specs\/a-spec\/digest\.md from outcome\.md's actuals/);
  assert.ok(out.stdout.includes(`\n${specClose.DIGEST_SHAPE}\n`), 'the whole shape is printed');
  assert.match(out.stdout, /Then run this again: node \S+spec-close\.js a-spec\n$/);
});

test('--strict exits 1 on a missing digest', () => {
  const root = mkProject();
  assert.equal(run(root, ['a-spec', '--strict']).status, 1);
});

// ─── each defect, by name ─────────────────────────────────

const LONG_SENTENCE = `Added ${'a very long clause that keeps going, '.repeat(9)}and only then stopped.`;

const DEFECT_CASES = [
  {
    code: 'no-front-matter',
    digest: 'Added a close step.\n\nChain: spec.md → plan.md → tasks.md → outcome.md\n',
    says: /no front-matter block/
  },
  {
    code: 'no-keywords',
    digest: '---\nrelated: other-spec\n---\nAdded a close step.\n\nChain: spec.md → plan.md → tasks.md → outcome.md\n',
    says: /no "keywords:" line in the front-matter/
  },
  {
    code: 'first-sentence-too-long',
    digest: `---\nkeywords: a\n---\n${LONG_SENTENCE}\n\nChain: spec.md → plan.md → tasks.md → outcome.md\n`,
    says: new RegExp(`first sentence is ${LONG_SENTENCE.length} characters — a hint carries at most 280`)
  },
  {
    code: 'no-chain-line',
    digest: '---\nkeywords: a\n---\nAdded a close step.\n',
    says: /no "Chain:" line — end the file with: Chain: spec\.md → plan\.md → tasks\.md → outcome\.md/
  }
];

for (const { code, digest, says } of DEFECT_CASES) {
  test(`a digest with ${code} is told so, and nothing else`, () => {
    const root = mkProject({ digest });
    const out = run(root, ['a-spec']);
    assert.equal(out.status, 0);
    assert.match(out.stdout, /digest: 1 defect — \.frame\/specs\/a-spec\/digest\.md\n {2}- /);
    assert.match(out.stdout, says);
    assert.match(out.stdout, /Then run this again: /);

    const json = JSON.parse(run(root, ['a-spec', '--json']).stdout);
    assert.equal(json.verdict, 'malformed');
    assert.deepEqual(json.items[0].defects.map((d) => d.code), [code]);
    assert.equal(run(root, ['a-spec', '--strict']).status, 1);
  });
}

test('several defects are each named and counted', () => {
  const root = mkProject({ digest: `${LONG_SENTENCE}\n` });
  const out = run(root, ['a-spec']);
  assert.match(out.stdout, /digest: 3 defects — /);
  const json = JSON.parse(run(root, ['a-spec', '--json']).stdout);
  assert.deepEqual(json.items[0].defects.map((d) => d.code),
    ['no-front-matter', 'first-sentence-too-long', 'no-chain-line']);
  assert.equal(json.defects, 3);
});

test('the length that counts is the sentence a hint would carry, at the same cap', () => {
  assert.equal(specClose.DIGEST_LINE_CAP, specIndex.DIGEST_LINE_CAP);
  const sentence = (n) => `${'x'.repeat(n - 1)}.`;
  const digest = (n) => `---\nkeywords: a\n---\n${sentence(n)} More after it.\n\nChain: spec.md → plan.md\n`;
  assert.deepEqual(specClose.digestDefects(digest(280)), [], 'exactly at the cap is whole');
  assert.deepEqual(specClose.digestDefects(digest(281)).map((d) => d.code), ['first-sentence-too-long']);
  // …and that is the point at which the index starts cutting.
  assert.ok(!specIndex.parseDigest(digest(280)).digestLine.endsWith('…'));
  assert.ok(specIndex.parseDigest(digest(281)).digestLine.endsWith('…'));
});

test('a first sentence wrapped over several lines is measured as one', () => {
  const wrapped = ['---', 'keywords: a', '---',
    ...Array.from({ length: 6 }, () => 'sixty characters of wrapped prose on every one of the lines'),
    'and its end.', '', 'Chain: spec.md → plan.md', ''].join('\n');
  assert.deepEqual(specClose.digestDefects(wrapped).map((d) => d.code), ['first-sentence-too-long']);
});

// ─── paths, never bodies ──────────────────────────────────

test('nothing of the digest text is printed or recorded', () => {
  const marker = 'ZEBRA-MARKER-7731';
  const root = mkProject({ digest: `---\nrelated: x\n---\n${marker} ${LONG_SENTENCE}\n` });
  for (const args of [['a-spec'], ['a-spec', '--json']]) {
    const out = run(root, args);
    assert.ok(!out.stdout.includes(marker), `${args.join(' ')} printed digest text`);
    assert.ok(!out.stderr.includes(marker));
  }
  assert.ok(!JSON.stringify(run(root, ['a-spec']).rows).includes(marker));
});

// ─── it changes nothing ───────────────────────────────────

test('it writes nothing into the project — no phase, no state file', () => {
  for (const digest of [null, GOOD_DIGEST, 'broken']) {
    const root = mkProject({ digest });
    const before = snapshot(root);
    run(root, ['a-spec']);
    run(root, ['a-spec', '--json', '--strict']);
    assert.deepEqual(snapshot(root), before);
  }
});

// ─── the activity row ─────────────────────────────────────

test('each verdict is recorded as one registry-valid row', () => {
  const cases = [
    { digest: GOOD_DIGEST, verdict: 'ok', defects: 0 },
    { digest: null, verdict: 'missing', defects: 0 },
    { digest: `${LONG_SENTENCE}\n`, verdict: 'malformed', defects: 3 }
  ];
  for (const { digest, verdict, defects } of cases) {
    const root = mkProject({ digest });
    const { rows } = run(root, ['a-spec']);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.ev, 'spec.close_checked');
    assert.equal(row.kind, 'action');
    assert.deepEqual(events.validateEvent(row.ev, row), { host: 'cli', slug: 'a-spec', verdict, defects });
  }
});

// ─── a spec that is not closed ────────────────────────────

test('before the last task completes nothing is owed and nothing is recorded', () => {
  const root = mkProject({ statuses: ['completed', 'in_progress'] });
  const out = run(root, ['a-spec', '--strict']);
  assert.equal(out.status, 0);
  assert.equal(out.stdout,
    'a-spec: 1 of 2 tasks completed — not closed yet\n' +
    'digest: not due — it is written when the last task completes\n');
  assert.deepEqual(out.rows, []);
  assert.equal(JSON.parse(run(root, ['a-spec', '--json']).stdout).verdict, 'not-due');
});

test('a digest written early is still checked', () => {
  const root = mkProject({ statuses: ['completed', 'pending'], digest: '---\nkeywords: a\n---\nDone.\n' });
  const out = run(root, ['a-spec']);
  assert.match(out.stdout, /not closed yet\ndigest: 1 defect — /);
  assert.match(out.stdout, /no "Chain:" line/);
});

test('a spec with no tasks in tasks.json is not closed', () => {
  const root = mkProject({ statuses: [] });
  const out = run(root, ['a-spec']);
  assert.match(out.stdout, /^a-spec: no tasks in \.frame\/tasks\.json — not closed\ndigest: not due/);
});

test('an unreadable tasks.json is said plainly, and an existing digest is still checked', () => {
  const root = mkProject({ tasksRaw: '{ truncated', digest: GOOD_DIGEST });
  const out = run(root, ['a-spec']);
  assert.equal(out.status, 0);
  assert.equal(out.stdout,
    'a-spec: .frame/tasks.json could not be read — task state unknown\n' +
    'digest: ok — .frame/specs/a-spec/digest.md\n');
});

// ─── wrong input ──────────────────────────────────────────

test('an unknown spec is an error message, not a stack trace and not a row', () => {
  const root = mkProject();
  for (const slug of ['no-such-spec', '../a-spec', '..']) {
    const out = run(root, [slug]);
    assert.equal(out.status, 0);
    assert.equal(out.stdout, '');
    assert.match(out.stderr, /^No spec ".*" under \.frame\/specs\/\n$/);
    assert.deepEqual(out.rows, []);
    assert.equal(run(root, [slug, '--strict']).status, 1);
  }
  assert.deepEqual(JSON.parse(run(root, ['no-such-spec', '--json']).stdout), { slug: 'no-such-spec', error: 'unknown-spec' });
});

test('no slug prints the usage', () => {
  const root = mkProject();
  const out = run(root, []);
  assert.equal(out.status, 0);
  assert.match(out.stderr, /^Usage: spec-close\.js <slug> \[--json\] \[--strict\]\n$/);
  assert.equal(run(root, ['--strict']).status, 1);
});

// ─── --json ───────────────────────────────────────────────

test('--json carries the same facts as the text', () => {
  const root = mkProject({ digest: GOOD_DIGEST });
  assert.deepEqual(JSON.parse(run(root, ['a-spec', '--json']).stdout), {
    slug: 'a-spec',
    tasks: { total: 2, completed: 2, readable: true },
    closed: true,
    verdict: 'ok',
    defects: 0,
    items: [{ id: 'digest', label: 'digest', path: '.frame/specs/a-spec/digest.md', status: 'ok', defects: [], unchecked: [] }]
  });
});

// ─── it runs from .frame/bin ──────────────────────────────

test('the shipped copy resolves its project from .frame/bin and names itself there', () => {
  const root = mkProject();
  const bin = path.join(root, '.frame', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const file of ['spec-close.js', 'spec-close-state.js', 'spec-index.js', 'activity-log.js', 'redact.js']) {
    fs.copyFileSync(path.join(__dirname, '..', 'scripts', file), path.join(bin, file));
  }
  const res = spawnSync('node', [path.join(bin, 'spec-close.js'), 'a-spec'], {
    encoding: 'utf8',
    env: { ...process.env, FRAME_PROJECT_ROOT: '', FRAME_ACTIVITY_HOME: path.join(root, '.activity-home') }
  });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /^a-spec: 2 of 2 tasks completed — closed\n/);
  assert.match(res.stdout, /Then run this again: node \.frame\/bin\/spec-close\.js a-spec\n$/);
});

test('without spec-index.js beside it the script still runs, and says what it could not check', () => {
  const root = mkProject({ digest: `---\nkeywords: a\n---\n${LONG_SENTENCE}\n\nChain: spec.md → plan.md\n` });
  const bin = path.join(root, '.frame', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const file of ['spec-close.js', 'spec-close-state.js']) {
    fs.copyFileSync(path.join(__dirname, '..', 'scripts', file), path.join(bin, file));
  }
  const res = spawnSync('node', [path.join(bin, 'spec-close.js'), 'a-spec'], {
    encoding: 'utf8',
    env: { ...process.env, FRAME_PROJECT_ROOT: '', FRAME_ACTIVITY_HOME: path.join(root, '.activity-home') }
  });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /digest: ok — \.frame\/specs\/a-spec\/digest\.md\n {2}\(not checked: first-sentence length — /);
});

// ─── shipping ─────────────────────────────────────────────
//
// The script reaches a project through structureBootstrap, and it is the one
// close-step file that cannot run without the helper. The two hooks that also
// read the helper do so behind a guarded require, so they ship regardless.

const { stageParserScripts } = require('../src/main/structureBootstrap');

test('Frame stages the helper and the script into .frame/bin/, and the staged copy runs', () => {
  const root = mkProject();
  const report = stageParserScripts(root);
  assert.deepEqual(report.unavailable, []);
  assert.ok(report.copied.includes('spec-close-state.js'));
  assert.ok(report.copied.includes('spec-close.js'));
  assert.ok(report.copied.indexOf('spec-close-state.js') < report.copied.indexOf('spec-close.js'), 'helper before entry');

  const res = spawnSync('node', [path.join(root, '.frame', 'bin', 'spec-close.js'), 'a-spec', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, FRAME_PROJECT_ROOT: '', FRAME_ACTIVITY_HOME: path.join(root, '.activity-home') }
  });
  assert.equal(res.status, 0);
  assert.equal(JSON.parse(res.stdout).verdict, 'missing');
});

test('an installation without the helper withholds the script and still ships both hooks', () => {
  const root = mkProject();
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-scripts-'));
  try {
    fs.cpSync(path.join(__dirname, '..', 'scripts'), source, { recursive: true });
    fs.rmSync(path.join(source, 'spec-close-state.js'));
    const report = stageParserScripts(root, { sourceDir: source });
    assert.deepEqual(report.unavailable, ['spec-close.js']);
    const bin = (file) => path.join(root, '.frame', 'bin', file);
    assert.ok(!fs.existsSync(bin('spec-close.js')), 'never activated without what it requires');
    assert.ok(fs.existsSync(bin('docs-hint.js')) && fs.existsSync(bin('spec-hint.js')), 'the hooks degrade on their own');
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
  }
});

// ─── one shape, stated twice ──────────────────────────────
//
// The implement template states the digest's shape because an agent that
// never runs this script must still know what to write; the script repeats it
// for a session that never saw the template. Two copies drift, so they are
// compared here rather than trusted.

const TEMPLATE = path.join(__dirname, '..', 'src', 'templates', 'commands', 'claude-code', 'spec.implement.md');

test("the template's digest shape is the script's, character for character", () => {
  const template = fs.readFileSync(TEMPLATE, 'utf8');
  const heading = template.indexOf('\n### The digest\n');
  assert.ok(heading >= 0, 'the template has a "### The digest" section');
  const rest = template.slice(heading);
  const fence = rest.match(/\n```\n([\s\S]*?)\n```\n/);
  assert.ok(fence, 'the section carries one fenced shape');
  assert.equal(fence[1], specClose.DIGEST_SHAPE);
  assert.ok(fence[1].endsWith(specClose.CHAIN_LINE));
});

test('the cap the template quotes is the cap the script enforces', () => {
  const template = fs.readFileSync(TEMPLATE, 'utf8');
  const quoted = template.match(/first sentence, cut\s+at (\d+) characters/);
  assert.ok(quoted, 'the template says where the first sentence is cut');
  assert.equal(Number(quoted[1]), specClose.DIGEST_LINE_CAP);
});

test('a digest written exactly to the template shape passes the check', () => {
  // Filled in the way an agent would fill it: placeholders replaced, layout kept.
  const digest = specClose.DIGEST_SHAPE
    .replace(/<3-8 comma-separated[^>]*>/, 'close step, digest')
    .replace(/<comma-separated slugs, or omit>/, 'spec-knowledge-layer')
    .replace(/<slug, or omit>/, 'old-spec')
    .replace(/<≤15 lines:[\s\S]*?>/, 'Added a close step. It checks the digest.');
  assert.deepEqual(specClose.digestDefects(`${digest}\n`), []);
});

// ─── decision cards (decision-cards-core T05) ─────────────

/** mkProject, plus the card writer Frame ships, which is what makes cards owed. */
function mkCardProject(opts) {
  const root = mkProject(opts);
  fs.mkdirSync(path.join(root, '.frame', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, '.frame', 'bin', 'decision.js'), '// stub\n');
  return root;
}

const card = (over = {}) => JSON.stringify({
  id: '20261014-aaaaaa', date: '2026-10-14', decision: 'A decision.', why: 'A reason.',
  keywords: ['close'], files: [], source: 'spec:a-spec', supersedes: null, extends: null, ...over
});

const writeCards = (root, lines) => fs.writeFileSync(path.join(root, '.frame', 'decisions.jsonl'), `${lines.join('\n')}\n`);

test('without decision.js the check reads exactly as before — no cards line', () => {
  const root = mkProject({ digest: GOOD_DIGEST });
  writeCards(root, [card()]);
  const { stdout } = run(root, ['a-spec']);
  assert.ok(!/cards/.test(stdout));
  assert.deepEqual(JSON.parse(run(root, ['a-spec', '--json']).stdout).items.map((i) => i.id), ['digest']);
});

test('with decision.js a closed spec owes a card, and is told the command that writes one', () => {
  const root = mkCardProject({ digest: GOOD_DIGEST });
  const out = run(root, ['a-spec']);
  assert.match(out.stdout, /^cards: missing — record at least one decision card for this spec/m);
  assert.ok(out.stdout.includes(`\n${specClose.cardShape('.frame/bin/decision.js', 'a-spec')}\n`), 'the whole shape is printed');
  assert.match(out.stdout, /Then run this again: node .*spec-close\.js a-spec/);
  assert.equal(JSON.parse(run(root, ['a-spec', '--json']).stdout).verdict, 'missing');
  assert.equal(run(root, ['a-spec', '--strict']).status, 1);
  assert.equal(out.rows[0].verdict, 'missing');
});

test('a current card for the spec settles the item', () => {
  const root = mkCardProject({ digest: GOOD_DIGEST });
  writeCards(root, [card()]);
  const { stdout, status } = run(root, ['a-spec', '--strict']);
  assert.equal(status, 0);
  assert.match(stdout, /^cards: ok — \.frame\/decisions\.jsonl$/m);
});

test('a card for another spec, or one superseded since, does not count', () => {
  const root = mkCardProject({ digest: GOOD_DIGEST });
  writeCards(root, [card({ source: 'spec:other' })]);
  assert.match(run(root, ['a-spec']).stdout, /^cards: missing/m);
  writeCards(root, [card(), card({ id: '20261015-bbbbbb', date: '2026-10-15', source: 'spec:other', supersedes: '20261014-aaaaaa' })]);
  assert.match(run(root, ['a-spec']).stdout, /^cards: missing/m);
});

test('a skipped line that names the spec is reported, beside a good card or in place of one', () => {
  const root = mkCardProject({ digest: GOOD_DIGEST });
  writeCards(root, [card({ why: '' }), '{"id":"x","source":"spec:a-spec","decis']);
  const missing = run(root, ['a-spec']);
  assert.match(missing.stdout, /^cards: missing/m);
  assert.match(missing.stdout, /line 1 of decisions\.jsonl was skipped — why is missing/);
  assert.match(missing.stdout, /line 2 of decisions\.jsonl was skipped — not valid JSON/);

  writeCards(root, [card(), card({ id: '20261016-cccccc', keywords: [] }), card({ id: '20261017-dddddd', source: 'spec:other', why: '' })]);
  const result = JSON.parse(run(root, ['a-spec', '--json']).stdout);
  assert.equal(result.verdict, 'malformed');
  const cards = result.items.find((i) => i.id === 'cards');
  assert.equal(cards.status, 'malformed');
  assert.equal(cards.defects.length, 1, 'only the line that names this spec');
  assert.match(cards.defects[0].message, /line 2 .* keywords holds 0/);
});

test("the template's card shape is the script's, character for character", () => {
  const template = fs.readFileSync(TEMPLATE, 'utf8');
  const heading = template.indexOf('\n### The cards\n');
  assert.ok(heading >= 0, 'the template has a "### The cards" section');
  const fence = template.slice(heading).match(/\n```\n([\s\S]*?)\n```\n/);
  assert.ok(fence, 'the section carries one fenced shape');
  assert.equal(fence[1], specClose.cardShape('{decision_script_path}', '{slug}'));
});

test('a card written exactly to the template shape is accepted by decision.js', () => {
  const root = mkCardProject();
  const shape = specClose.cardShape('decision.js', 'a-spec');
  const json = shape.slice(shape.indexOf("'") + 1, shape.lastIndexOf("'"))
    .replace('<one sentence, at most 280 characters>', 'A missing card never blocks done.')
    .replace('<at most 3 sentences>', 'Done stays derived from task state.')
    .replace('<1-8 concepts>', 'spec close')
    .replace('<project-relative paths the decision governs>', 'scripts/spec-close.js');
  const { prepare } = require('../scripts/decision');
  assert.deepEqual(prepare(root, JSON.parse(json)).defects, []);
});
