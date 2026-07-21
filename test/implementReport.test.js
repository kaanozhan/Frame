/**
 * Implementation report tests (T05): the pure `report-data.json → HTML`
 * transform. No git, no filesystem — that is the point of the split in
 * build-implement-report.mjs, and these tests are what keeps it honest.
 *
 * The generator is ESM; `npm test` globs test/*.test.js as CommonJS, so the
 * module is pulled in with a dynamic import once, before the suite runs.
 */

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const GENERATOR = path.join(
  __dirname, '..', 'src', 'templates', 'commands', 'claude-code', 'build-implement-report.mjs'
);

let mod;
before(async () => {
  mod = await import(pathToFileURL(GENERATOR).href);
});

/** Minimal well-formed data; individual tests override what they care about. */
function data(overrides = {}) {
  return {
    spec: { slug: 'implement-modes', title: 'Implement modes' },
    generatedAt: '2026-07-21',
    tasks: [{
      id: 'T01',
      title: 'Inject the runtime',
      commit: 'abc1234',
      whatChanged: 'Added FRAME_NODE to the PTY env.',
      whyChanged: 'PATH is not ours to depend on.',
      diff: '+++ b/src/main/ptyManager.js\n@@ -1 +1 @@\n-old\n+new\n context',
      verification: { command: 'npm test', status: 'pass', detail: '84 passed' }
    }],
    ...overrides
  };
}

// ─── escapeHtml ───────────────────────────────────────────────

test('escapeHtml neutralises every character that could break out of markup', () => {
  assert.equal(
    mod.escapeHtml(`<script>a & b "q" 'p'</script>`),
    '&lt;script&gt;a &amp; b &quot;q&quot; &#39;p&#39;&lt;/script&gt;'
  );
});

test('escapeHtml renders null and undefined as empty, not as the word', () => {
  assert.equal(mod.escapeHtml(null), '');
  assert.equal(mod.escapeHtml(undefined), '');
  assert.equal(mod.escapeHtml(0), '0');
});

// ─── diffLineClass ────────────────────────────────────────────

test('diffLineClass reads file headers as headers, not as additions', () => {
  // The ordering trap: +++ starts with + and --- starts with -.
  assert.equal(mod.diffLineClass('+++ b/file.js'), 'dl-file');
  assert.equal(mod.diffLineClass('--- a/file.js'), 'dl-file');
});

test('diffLineClass covers content, hunks, metadata and context', () => {
  assert.equal(mod.diffLineClass('+added'), 'dl-add');
  assert.equal(mod.diffLineClass('-removed'), 'dl-del');
  assert.equal(mod.diffLineClass('@@ -1,2 +1,3 @@'), 'dl-hunk');
  assert.equal(mod.diffLineClass('diff --git a/x b/x'), 'dl-meta');
  assert.equal(mod.diffLineClass('index d68a8e4..ec43ca8 100644'), 'dl-meta');
  assert.equal(mod.diffLineClass('new file mode 100644'), 'dl-meta');
  assert.equal(mod.diffLineClass('rename from a.js'), 'dl-meta');
  assert.equal(mod.diffLineClass(' unchanged'), 'dl-ctx');
  assert.equal(mod.diffLineClass(''), 'dl-ctx');
});

// ─── renderDiff ───────────────────────────────────────────────

test('renderDiff classifies every line it is given', () => {
  const html = mod.renderDiff('+add\n-del\n@@ hunk @@\n ctx');
  assert.match(html, /<pre class="diff">/);
  assert.match(html, /<span class="dl-add">\+add<\/span>/);
  assert.match(html, /<span class="dl-del">-del<\/span>/);
  assert.match(html, /<span class="dl-hunk">/);
  assert.match(html, /<span class="dl-ctx">/);
});

test('renderDiff escapes diff content — a diff of HTML is still just text', () => {
  const html = mod.renderDiff('+<img src=x onerror=alert(1)>');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img/);
});

test('renderDiff keeps blank lines visible instead of collapsing them', () => {
  assert.match(mod.renderDiff('+a\n\n+b'), /&nbsp;/);
});

test('renderDiff says so when there is no diff rather than emitting an empty block', () => {
  for (const empty of ['', null, undefined, 42]) {
    const html = mod.renderDiff(empty);
    assert.doesNotMatch(html, /<pre/);
    assert.match(html, /No diff/);
  }
});

// ─── renderVerification ───────────────────────────────────────

test('renderVerification distinguishes pass, fail and not-run', () => {
  assert.match(mod.renderVerification({ status: 'pass', command: 'npm test' }), /pill good/);
  assert.match(mod.renderVerification({ status: 'fail', command: 'npm test' }), /pill bad/);
  assert.match(mod.renderVerification({ status: 'none' }), /pill warn/);
});

test('renderVerification treats a missing check as unverified, never as a pass', () => {
  // A task with no recorded check must not read as a green one — the whole
  // reason the missing-verification case is stated rather than hidden.
  for (const value of [null, undefined, {}, { command: 'npm test' }]) {
    const html = mod.renderVerification(value);
    assert.match(html, /not verified/);
    assert.doesNotMatch(html, /pill good/);
  }
});

// ─── renderTask ───────────────────────────────────────────────

test('renderTask shows the commit hash once the amend has filled it in', () => {
  const html = mod.renderTask(data().tasks[0]);
  assert.match(html, /abc1234/);
  assert.doesNotMatch(html, /uncommitted/);
});

test('renderTask flags an entry written before its commit landed', () => {
  const task = { ...data().tasks[0], commit: '', diff: '' };
  const html = mod.renderTask(task);
  assert.match(html, /uncommitted/);
  // Nothing to collapse, so the section opens rather than hiding a stub.
  assert.match(html, /<details open>/);
});

test('renderTask omits the why block when the mode recorded none', () => {
  const { whyChanged, ...task } = data().tasks[0];
  assert.doesNotMatch(mod.renderTask(task), />Why</);
  assert.match(mod.renderTask(data().tasks[0]), />Why</);
});

test('renderTask escapes a hostile task title', () => {
  const html = mod.renderTask({ ...data().tasks[0], title: '<script>x</script>' });
  assert.doesNotMatch(html, /<script>/);
});

// ─── renderReport ─────────────────────────────────────────────

test('renderReport emits one self-contained document with no external assets', () => {
  const html = mod.renderReport(data());
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<style>/);
  assert.doesNotMatch(html, /<link|<script|https?:\/\//);
});

test('renderReport counts verified against unverified tasks', () => {
  const html = mod.renderReport(data({
    tasks: [
      { id: 'T01', verification: { status: 'pass' } },
      { id: 'T02', verification: { status: 'fail' } },
      { id: 'T03' }
    ]
  }));
  assert.match(html, /3 tasks/);
  assert.match(html, /1 verified/);
  assert.match(html, /2 unverified/);
});

test('renderReport drops the unverified pill when every task passed', () => {
  const html = mod.renderReport(data());
  assert.match(html, /1 task<\/span>/); // singular, not "1 tasks"
  assert.doesNotMatch(html, /unverified/);
});

test('renderReport survives malformed data instead of throwing at the user', () => {
  // A half-written report-data.json must still produce a readable page —
  // the report is never allowed to be load-bearing.
  for (const value of [undefined, null, {}, { tasks: null }, { tasks: 'nope' }]) {
    const html = mod.renderReport(value);
    assert.match(html, /^<!DOCTYPE html>/);
    assert.match(html, /No tasks recorded yet/);
  }
});

test('renderReport falls back to the slug when the spec has no title', () => {
  assert.match(mod.renderReport({ spec: { slug: 'my-spec' } }), /my-spec/);
});

test('renderReport is a pure function of its input', () => {
  // Same input, same bytes: no clock, no randomness, nothing read from disk.
  // If a timestamp ever creeps into the transform, this fails.
  const input = data();
  assert.equal(mod.renderReport(input), mod.renderReport(data()));
  assert.deepEqual(input, data(), 'input must not be mutated');
});

// ─── contract ─────────────────────────────────────────────────

test('EXCLUDED_PATHS keeps Frame bookkeeping out of every diff', () => {
  assert.deepEqual(mod.EXCLUDED_PATHS, ['.frame', 'tasks.json', 'STRUCTURE.json']);
});
