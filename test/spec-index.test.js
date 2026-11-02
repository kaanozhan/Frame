/**
 * Spec Knowledge Layer — index builder tests.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 *
 * Fixtures are built in a temp dir per test group; the rename fixture
 * initializes a real git repo (skipped silently if git is unavailable).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { build, ensureFresh, writeIndex, parseFrontMatter, parseFootprint, parseOutcome, parseDigest } = require('../scripts/spec-index');

function mkProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-specidx-'));
  fs.mkdirSync(path.join(root, '.frame', 'specs'), { recursive: true });
  return root;
}

function mkSpec(root, slug, { phase = 'done', status = {}, spec, plan, outcome, digest } = {}) {
  const dir = path.join(root, '.frame', 'specs', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({
    slug, title: status.title || slug, phase,
    last_phase_at: status.last_phase_at || '2026-07-01T00:00:00Z', ...status
  }, null, 2));
  if (spec) fs.writeFileSync(path.join(dir, 'spec.md'), spec);
  if (plan) fs.writeFileSync(path.join(dir, 'plan.md'), plan);
  if (outcome) fs.writeFileSync(path.join(dir, 'outcome.md'), outcome);
  if (digest) fs.writeFileSync(path.join(dir, 'digest.md'), digest);
  return dir;
}

function touch(root, rel) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '// x\n');
}

const PLAN_A = '# Plan\n\n## Architecture\nx\n\n## Footprint\n\n- src/main/alpha.js\n- src/main/shared.js\n\n## Sequencing\n1. x\n';
const OUTCOME_A = `# Outcome — A

## T01 — Wire alpha

Added the alpha cache with a self-write guard because the watcher looped. Files touched: \`src/main/alpha.js\`.

_Captured: 2026-06-01 · 1 file change(s)_

---

## T02 — Shared module

Extracted helpers. Files touched: \`src/main/shared.js\`.

_Captured: 2026-06-02 · 1 file change(s)_

---
`;

// ─── parsers ──────────────────────────────────────────────

test('parseFrontMatter reads keywords/related/supersedes and tolerates absence', () => {
  const fm = parseFrontMatter('---\nkeywords: cache, watcher guard, perf\nrelated: other-spec\nsupersedes: old-spec\n---\n# T\n');
  assert.deepEqual(fm.keywords, ['cache', 'watcher guard', 'perf']);
  assert.deepEqual(fm.related, ['other-spec']);
  assert.equal(fm.supersedes, 'old-spec');
  assert.deepEqual(parseFrontMatter('# no front matter\n').keywords, []);
});

test('parseFootprint extracts flat bullets only from the Footprint section', () => {
  const fp = parseFootprint(PLAN_A);
  assert.deepEqual(fp, ['src/main/alpha.js', 'src/main/shared.js']);
  assert.deepEqual(parseFootprint('# Plan\n## Files\n- a.js\n'), []);
});

test('parseOutcome yields per-task sections with files, dates, one-liners', () => {
  const secs = parseOutcome(OUTCOME_A);
  assert.equal(secs.length, 2);
  assert.equal(secs[0].task, 'T01');
  assert.deepEqual(secs[0].files, ['src/main/alpha.js']);
  assert.equal(secs[0].date, '2026-06-01');
  assert.match(secs[0].line, /alpha cache/);
});

test('a fix after the last task is a record of its own, with its files and date', () => {
  const md = [
    '## T02 — Add the helper', '', 'Added it. Files touched: `src/a.js`.', '', '_Captured: 2026-10-01 · 1 file change_', '', '---',
    '## Fix — Empty names greet a stranger', '', 'Found in testing: an empty string printed "Hello, !". Files touched: `src/a.js`, `test/a.test.js`.',
    '', '_Captured: 2026-10-03 · 2 file changes_', '', '---', ''
  ].join('\n');
  const secs = parseOutcome(md);
  assert.deepEqual(secs.map((s) => s.task), ['T02', 'Fix']);
  assert.equal(secs[1].title, 'Empty names greet a stranger');
  assert.deepEqual(secs[1].files, ['src/a.js', 'test/a.test.js']);
  assert.equal(secs[1].date, '2026-10-03');
  assert.match(secs[1].line, /^Found in testing/);
  assert.deepEqual(parseOutcome('## Fixes — not a fix heading\n\nx\n').map((s) => s.task), [], 'only the exact word');
});

test('the digest line is the first sentence, across wrapped lines', () => {
  // Digests wrap near 75 columns; the first physical line used to be the
  // whole hint, and ended mid-sentence in 45 of this repo's 50 digests.
  const md = '---\nkeywords: cache\n---\nMade the archive a delivered memory, not\nadvisory text. Rejected: a tracked index.\n\nChain: spec.md\n';
  assert.equal(parseDigest(md).digestLine, 'Made the archive a delivered memory, not advisory text.');
  assert.equal(parseDigest('---\nkeywords: cache\n---\n').digestLine, null);
});

test('a period ends the line only where a sentence ends', () => {
  const line = (body) => parseDigest(body).digestLine;
  assert.equal(line('`spec-index.js` v1.2 feeds the hooks. Next.'), '`spec-index.js` v1.2 feeds the hooks.');
  assert.equal(line('Caches results, e.g. Footprints, per spec. Next.'), 'Caches results, e.g. Footprints, per spec.');
  assert.equal(line('Runs approx. five times faster. Next.'), 'Runs approx. five times faster.');
  assert.equal(line('1. Wired the cache. Next.'), '1. Wired the cache.');
  assert.equal(line('Feeds the hooks (see\n+ the chain pointer). Next.'), 'Feeds the hooks (see + the chain pointer).');
});

test('a line past its cap is cut at a word boundary with an ellipsis', () => {
  const digest = parseDigest(`Reworked the picker: ${'filter focused on open, '.repeat(20)}and more.`).digestLine;
  assert.ok(digest.length <= 280, `digest line is ${digest.length} characters`);
  assert.match(digest, /(?:filter|focused|on|open)…$/);

  const [sec] = parseOutcome(`## T01 — Long\n\n${'word '.repeat(60)}end. Files touched: \`src/a/b.js\`.\n`);
  assert.ok(sec.line.length <= 160, `outcome line is ${sec.line.length} characters`);
  assert.match(sec.line, /word…$/);
  assert.deepEqual(sec.files, ['src/a/b.js']);
});

// ─── multi-spec file: full history, chronology, flags ─────

test('a file touched by multiple specs keeps every record, chronological, newest current', async () => {
  const root = mkProject();
  touch(root, 'src/main/alpha.js');
  touch(root, 'src/main/shared.js');
  touch(root, 'src/main/beta.js');
  mkSpec(root, 'spec-a', {
    status: { last_phase_at: '2026-06-02T12:00:00Z' },
    plan: PLAN_A, outcome: OUTCOME_A
  });
  mkSpec(root, 'spec-b', {
    status: { last_phase_at: '2026-07-01T12:00:00Z' },
    plan: '# Plan\n\n## Footprint\n\n- src/main/shared.js\n- src/main/beta.js\n',
    outcome: '# Outcome\n\n## T01 — Rework shared\n\nRewrote shared helpers for async. Files touched: `src/main/shared.js`, `src/main/beta.js`.\n\n_Captured: 2026-07-01 · 2 file change(s)_\n\n---\n'
  });
  const idx = await build(root);
  const hist = idx.files['src/main/shared.js'];
  assert.equal(hist.length, 2, 'both specs present');
  assert.equal(hist[0].slug, 'spec-a');
  assert.equal(hist[1].slug, 'spec-b');
  assert.equal(hist[1].flags.current, true, 'newest is current');
  assert.equal(hist[0].flags.laterSpecs, true, 'older record knows later specs touched the file');
  assert.ok(!hist[0].flags.current);
});

// ─── phase filter ─────────────────────────────────────────

test('phase filter: specified → topics only; in-flight → warning records; superseded → excluded', async () => {
  const root = mkProject();
  touch(root, 'src/a.js');
  mkSpec(root, 'only-specified', { phase: 'specified', spec: '---\nkeywords: alpha topic\n---\n# S\n## Problem\nx\n' });
  mkSpec(root, 'in-flight', { phase: 'implementing', plan: '# Plan\n\n## Footprint\n\n- src/a.js\n' });
  mkSpec(root, 'superseded-one', { phase: 'specified', status: { superseded_by: 'other' } });
  const idx = await build(root);
  assert.ok(idx.topics['only-specified'], 'specified spec in topics');
  assert.deepEqual(idx.topics['only-specified'].keywords, ['alpha topic']);
  assert.ok(!Object.values(idx.files).flat().some(r => r.slug === 'only-specified'), 'specified spec has no file records');
  const rec = (idx.files['src/a.js'] || []).find(r => r.slug === 'in-flight');
  assert.ok(rec && rec.flags.inflight, 'in-flight footprint yields warning record');
  assert.ok(!idx.topics['superseded-one'], 'superseded spec fully excluded');
});

// ─── squash survival: no git, artifacts only ──────────────

test('index builds fully from artifacts in a non-git project (squash/no-history survival)', async () => {
  const root = mkProject(); // never git-inited
  touch(root, 'src/main/alpha.js');
  touch(root, 'src/main/shared.js');
  mkSpec(root, 'spec-a', { plan: PLAN_A, outcome: OUTCOME_A });
  const idx = await build(root);
  assert.equal(idx.files['src/main/alpha.js'].length, 1);
  assert.equal(idx.files['src/main/alpha.js'][0].task, 'T01');
});

// ─── footprint-only files get a spec-level record ─────────

test('footprint file never named in outcome still gets a spec-level record', async () => {
  const root = mkProject();
  touch(root, 'src/main/alpha.js');
  touch(root, 'src/main/shared.js');
  mkSpec(root, 'spec-a', {
    plan: PLAN_A,
    outcome: '# Outcome\n\n## T01 — Wire alpha\n\nDid alpha. Files touched: `src/main/alpha.js`.\n\n_Captured: 2026-06-01_\n\n---\n',
    digest: '---\nkeywords: alpha\n---\nAlpha caching layer with watcher guard.\n'
  });
  const idx = await build(root);
  const rec = idx.files['src/main/shared.js'][0];
  assert.equal(rec.slug, 'spec-a');
  assert.equal(rec.task, null);
  assert.match(rec.line, /Alpha caching layer/);
});

// ─── rename resolution via real git ───────────────────────

test('renamed file resolves its history under the new path with a pointer at the old one', async (t) => {
  const root = mkProject();
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  try {
    git('init', '-q');
    git('config', 'user.email', 't@t'); git('config', 'user.name', 'T');
  } catch { t.skip('git unavailable'); return; }
  touch(root, 'src/old-name.js');
  git('add', '.'); git('commit', '-qm', 'add old');
  mkSpec(root, 'spec-a', {
    status: { last_phase_at: '2026-06-02T12:00:00Z' },
    plan: '# Plan\n\n## Footprint\n\n- src/old-name.js\n',
    outcome: '# Outcome\n\n## T01 — Build old\n\nBuilt it. Files touched: `src/old-name.js`.\n\n_Captured: 2026-06-01_\n\n---\n'
  });
  git('add', '.'); git('commit', '-qm', 'spec artifacts');
  git('mv', 'src/old-name.js', 'src/new-name.js');
  git('commit', '-qm', 'rename');
  const idx = await build(root);
  const moved = idx.files['src/new-name.js'];
  assert.ok(moved && moved.some(r => r.slug === 'spec-a' && r.origin === 'src/old-name.js'), 'history lives under new path');
  const stub = idx.files['src/old-name.js'];
  assert.ok(stub && stub.some(r => r.flags.movedTo === 'src/new-name.js'), 'old path keeps moved-to pointer');
  const rec = moved.find(r => r.slug === 'spec-a');
  assert.equal(rec.flags.stale, true, 'post-close rename commit marks the record stale');
});

// ─── ensureFresh ──────────────────────────────────────────

test('ensureFresh rebuilds on missing/stale index and reuses a fresh one', async () => {
  const root = mkProject();
  touch(root, 'src/main/alpha.js');
  touch(root, 'src/main/shared.js');
  mkSpec(root, 'spec-a', { plan: PLAN_A, outcome: OUTCOME_A });
  const idx1 = await ensureFresh(root);
  assert.ok(idx1.files['src/main/alpha.js'], 'built on first call');
  const file = path.join(root, '.frame', 'index', 'spec-index.json');
  const stamp1 = fs.readFileSync(file, 'utf8');
  const idx2 = await ensureFresh(root);
  assert.equal(fs.readFileSync(file, 'utf8'), stamp1, 'fresh index not rewritten');
  assert.equal(idx2.generatedAt, idx1.generatedAt);
  // Touch a source artifact into the future → rebuild. (Small sleep so the
  // rebuilt generatedAt can't collide within the same millisecond.)
  const specMd = path.join(root, '.frame', 'specs', 'spec-a', 'status.json');
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(specMd, future, future);
  await new Promise(r => setTimeout(r, 10));
  await ensureFresh(root);
  assert.notEqual(fs.readFileSync(file, 'utf8'), stamp1, 'stale index rebuilt');
});

test('ensureFresh rebuilds an index an older builder wrote', async () => {
  // Its lines were cut by the old rule; mtime alone would keep serving them.
  const root = mkProject();
  mkSpec(root, 'spec-a', { plan: PLAN_A, digest: 'Old first line that the\nold builder cut here. Next.\n' });
  const file = path.join(root, '.frame', 'index', 'spec-index.json');
  const stale = { ...(await ensureFresh(root)), version: 1 };
  stale.topics['spec-a'].digestLine = 'Old first line that the';
  fs.writeFileSync(file, JSON.stringify(stale, null, 2) + '\n');
  const idx = await ensureFresh(root);
  assert.equal(idx.topics['spec-a'].digestLine, 'Old first line that the old builder cut here.');
});
