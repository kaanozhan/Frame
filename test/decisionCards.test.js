/**
 * Decision cards reader (decision-cards-core T01).
 *
 * `scripts/decision-cards.js` is the one reader of `.frame/decisions.jsonl`:
 * the hooks, spec-context, the close check, the CLI and the view all go
 * through it. These tests pin the file's rules — a bad line is skipped and
 * named, never fatal; an id is kept once; a superseded card leaves the
 * current set — plus matching and the lines it renders. A project with no
 * card file reads as empty, which is what keeps every caller unchanged there.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cards = require('../scripts/decision-cards');

let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-cards-'));
  fs.mkdirSync(path.join(root, '.frame'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function card(over = {}) {
  return {
    id: '20261014-3fa9c1',
    date: '2026-10-14',
    decision: 'A missing digest never blocks done; done stays derived from task state.',
    why: 'The index treats a non-done spec as in flight, and old specs would walk back. The close step reminds instead of blocking.',
    keywords: ['spec close', 'digest', 'done'],
    files: ['scripts/spec-close-state.js', 'scripts/spec-close.js'],
    source: 'spec:spec-close-step',
    supersedes: null,
    extends: null,
    ...over
  };
}

function writeCards(lines) {
  fs.writeFileSync(cards.cardsPath(root), lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
}

// ─── reading ──────────────────────────────────────────────────

test('a project with no card file reads as empty, not as an error', () => {
  fs.rmSync(path.join(root, '.frame'), { recursive: true, force: true });
  assert.deepEqual(cards.readCards(root), { exists: false, cards: [], current: [], malformed: [] });
});

test('the card file lives at .frame/decisions.jsonl', () => {
  assert.equal(cards.cardsPath(root), path.join(root, '.frame', 'decisions.jsonl'));
});

test('a well-formed card reads back normalized, with its line number', () => {
  writeCards([card({ files: ['./scripts/spec-close.js'], keywords: [' digest '] })]);
  const out = cards.readCards(root);
  assert.equal(out.exists, true);
  assert.deepEqual(out.malformed, []);
  assert.equal(out.cards.length, 1);
  assert.deepEqual(out.cards[0].files, ['scripts/spec-close.js']);
  assert.deepEqual(out.cards[0].keywords, ['digest']);
  assert.equal(out.cards[0].line, 1);
});

test('a torn or malformed line is skipped and named, the rest still read', () => {
  writeCards([
    card(),
    '{"id":"20261015-aaaaaa","date":"2026-10-15","decis',
    'not json at all',
    card({ id: '20261016-bbbbbb', date: '2026-10-16' })
  ]);
  const out = cards.readCards(root);
  assert.deepEqual(out.cards.map((c) => c.id), ['20261014-3fa9c1', '20261016-bbbbbb']);
  assert.deepEqual(out.malformed.map((m) => m.line), [2, 3]);
  assert.match(out.malformed[0].reason, /not valid JSON/);
});

test('a card that parses but fails validation is skipped with its defects', () => {
  writeCards([card({ id: 'nope', why: '' })]);
  const out = cards.readCards(root);
  assert.equal(out.cards.length, 0);
  assert.equal(out.malformed.length, 1);
  assert.match(out.malformed[0].reason, /id must look like/);
  assert.match(out.malformed[0].reason, /why is missing/);
});

test('an identical repeated line is dropped silently; a different card under a taken id is reported', () => {
  writeCards([card(), card(), card({ decision: 'Something else entirely.' })]);
  const out = cards.readCards(root);
  assert.equal(out.cards.length, 1);
  assert.equal(out.cards[0].decision, card().decision, 'the first card under an id is kept');
  assert.deepEqual(out.malformed.map((m) => m.line), [3]);
  assert.match(out.malformed[0].reason, /duplicate id 20261014-3fa9c1 \(line 1 kept\)/);
});

test('blank lines are ignored and do not shift what is reported', () => {
  fs.writeFileSync(cards.cardsPath(root), `\n${JSON.stringify(card())}\n\n`);
  const out = cards.readCards(root);
  assert.equal(out.cards.length, 1);
  assert.equal(out.cards[0].line, 2);
});

// ─── validation ───────────────────────────────────────────────

test('a well-formed card has no defects', () => {
  assert.deepEqual(cards.validateCard(card()), []);
  assert.deepEqual(cards.validateCard(card({ files: [], source: 'notes:2026-10-14 Union merge for cards' })), []);
});

test('every field rule is enforced', () => {
  const cases = [
    [card({ decision: 'x'.repeat(281) }), /decision is 281 characters/],
    [card({ decision: 'First. Second one here.' }), /decision must be one sentence/],
    [card({ why: 'One. Two. Three. Four.' }), /why is 4 sentences/],
    [card({ keywords: [] }), /keywords holds 0/],
    [card({ keywords: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }), /keywords holds 9/],
    [card({ keywords: ['ok', ''] }), /every keyword must be a non-empty string/],
    [card({ files: '/abs/path.js' }), /files must be a list/],
    [card({ files: ['/abs/path.js'] }), /must be project-relative/],
    [card({ files: ['../outside.js'] }), /must be project-relative/],
    [card({ source: 'PROJECT_NOTES.md:120' }), /source must be/],
    [card({ source: 'notes:2026-13-40 Bad date' }), /source must be/],
    [card({ source: 'spec:../escape' }), /source must be/],
    [card({ supersedes: 'abc' }), /supersedes must be a card id/],
    [card({ extends: '20261014-3fa9c1' }), /extends names the card itself/],
    [card({ supersedes: '20261001-111111', extends: '20261002-222222' }), /cannot both supersede and extend/],
    [card({ date: '2026-02-30' }), /date must be YYYY-MM-DD/],
    [[], /not a JSON object/]
  ];
  for (const [c, re] of cases) {
    const defects = cards.validateCard(c);
    assert.ok(defects.some((d) => re.test(d)), `${re} not in ${JSON.stringify(defects)}`);
  }
});

test('the sentence rule counts real sentences only', () => {
  assert.equal(cards.sentenceCount('One sentence with spec-index.js and v1.2 in it.'), 1);
  assert.equal(cards.sentenceCount('Use a list, e.g. this one, then stop.'), 1);
  assert.equal(cards.sentenceCount('No closing punctuation'), 1);
  assert.equal(cards.sentenceCount('One. Two! Three?'), 3);
  assert.equal(cards.sentenceCount(''), 0);
});

test('sources parse to a spec or a notes heading, never a line number', () => {
  assert.deepEqual(cards.parseSource('spec:decision-cards-core'), { kind: 'spec', slug: 'decision-cards-core' });
  assert.deepEqual(cards.parseSource('notes:2026-10-14 Union merge for cards'),
    { kind: 'notes', date: '2026-10-14', title: 'Union merge for cards' });
  assert.equal(cards.parseSource('notes:120'), null);
  assert.equal(cards.parseSource(null), null);
});

// ─── current set ──────────────────────────────────────────────

test('a superseded card leaves the current set, along a whole chain', () => {
  const a = card({ id: '20261001-aaaaaa', date: '2026-10-01' });
  const b = card({ id: '20261002-bbbbbb', date: '2026-10-02', supersedes: a.id });
  const c = card({ id: '20261003-cccccc', date: '2026-10-03', supersedes: b.id });
  const d = card({ id: '20261004-dddddd', date: '2026-10-04', extends: c.id });
  writeCards([a, b, c, d]);
  const out = cards.readCards(root);
  assert.deepEqual(out.current.map((x) => x.id), [c.id, d.id], 'extends keeps both cards current');
  assert.equal(out.cards.length, 4, 'nothing is removed from the file view');
});

test('spec cards are told apart from spec-less ones', () => {
  const spec = card();
  const notes = card({ id: '20261015-eeeeee', source: 'notes:2026-10-15 Union merge for cards' });
  assert.equal(cards.isSpecCard(spec), true);
  assert.equal(cards.isSpecCard(notes), false);
  assert.deepEqual(cards.specLessCards([spec, notes]).map((c) => c.id), [notes.id]);
  assert.deepEqual(cards.cardsForSpec([spec, notes], 'spec-close-step').map((c) => c.id), [spec.id]);
  assert.deepEqual(cards.cardsForSpec([spec, notes], 'other'), []);
});

// ─── matching ─────────────────────────────────────────────────

test('cards for a file match the normalized path, newest first', () => {
  const older = card({ id: '20261001-aaaaaa', date: '2026-10-01' });
  const newer = card({ id: '20261005-bbbbbb', date: '2026-10-05' });
  const other = card({ id: '20261006-cccccc', date: '2026-10-06', files: ['src/main/other.js'] });
  const hits = cards.cardsForFile([older, newer, other], './scripts/spec-close.js');
  assert.deepEqual(hits.map((c) => c.id), [newer.id, older.id]);
});

test('a bag of words matches at score 3 or more — one rare word is not enough', () => {
  const merge = card({
    id: '20261015-eeeeee', decision: 'Card files merge with the union driver.', keywords: ['union merge', 'gitattributes'],
    files: ['src/main/gitSharing.js'], source: 'notes:2026-10-15 Union merge for cards'
  });
  const close = card();
  assert.deepEqual(cards.scoreCards([merge, close], 'how do gitattributes work'), [], 'one rare word scores 2');
  const hits = cards.scoreCards([merge, close], 'set up the union merge in gitattributes');
  assert.deepEqual(hits.map((h) => h.card.id), [merge.id]);
  assert.ok(hits[0].score >= cards.MATCH_THRESHOLD);
  assert.deepEqual(hits[0].tokens.sort(), ['gitattributes', 'merge', 'union']);
});

test('a word common across the corpus counts 1, a rare one 2', () => {
  const many = Array.from({ length: 10 }, (_, i) => card({
    id: `202610${10 + i}-a0000${i}`,
    date: `2026-10-${10 + i}`,
    decision: `Digest rule number ${i}.`,
    keywords: ['digest', `topic${i}`],
    files: []
  }));
  const [hit] = cards.scoreCards(many, 'digest topic3', { min: 1 });
  assert.equal(hit.card.keywords[1], 'topic3');
  assert.equal(hit.score, 3, 'digest is common (1) and topic3 is rare (2)');
});

test('related lists every card sharing a file or a word, a shared file ranking highest', () => {
  const byFile = card({ id: '20261001-aaaaaa', decision: 'Unrelated wording here.', keywords: ['alpha'], files: ['src/main/gitSharing.js'] });
  const byWord = card({ id: '20261002-bbbbbb', decision: 'Union merge for the card file.', keywords: ['merge'], files: [] });
  const neither = card({ id: '20261003-cccccc', decision: 'Nothing in common.', keywords: ['zeta'], files: ['x/y.js'] });
  const out = cards.relatedCards([byFile, byWord, neither], { files: ['src/main/gitSharing.js'], keywords: ['merge'] });
  assert.deepEqual(out.map((r) => r.card.id), [byFile.id, byWord.id]);
  assert.deepEqual(out[0].files, ['src/main/gitSharing.js']);
  assert.deepEqual(out[1].tokens, ['merge']);
  assert.deepEqual(cards.relatedCards([byFile], {}), []);
});

// ─── rendering ────────────────────────────────────────────────

test('a full card line carries the decision, its why and where its story is', () => {
  const line = cards.renderCard(card());
  assert.equal(line, [
    '- 2026-10-14 20261014-3fa9c1 — A missing digest never blocks done; done stays derived from task state.',
    '  why: The index treats a non-done spec as in flight, and old specs would walk back. The close step reminds instead of blocking.',
    '  story: .frame/specs/spec-close-step/'
  ].join('\n'));
  const notes = cards.renderCard(card({ source: 'notes:2026-10-15 Union merge for cards', supersedes: '20261001-aaaaaa' }));
  assert.match(notes, /^- 2026-10-14 20261014-3fa9c1 \(supersedes 20261001-aaaaaa\) — /);
  assert.match(notes, /story: PROJECT_NOTES\.md "### \[2026-10-15\] Union merge for cards"$/);
});

test('a compact card line is one line, cut at a word boundary', () => {
  const long = card({ decision: `${'word '.repeat(50).trim()}.` });
  const line = cards.renderCard(long, { full: false });
  assert.ok(!line.includes('\n'));
  assert.match(line, /…$/);
  assert.ok(line.length < 200);
});

test('catalog lines follow the spec catalog shape, newest first', () => {
  const a = card({ id: '20261001-aaaaaa', date: '2026-10-01' });
  const b = card({ id: '20261005-bbbbbb', date: '2026-10-05', keywords: ['merge'] });
  assert.deepEqual(cards.catalogLines([a, b]), [
    '- card 20261005-bbbbbb · A missing digest never blocks done; done stays derived from task state. · merge',
    '- card 20261001-aaaaaa · A missing digest never blocks done; done stays derived from task state. · spec close, digest, done'
  ]);
  assert.deepEqual(cards.catalogLines([]), []);
});

// ─── the /spec.new catalog (decision-cards-core T07) ──────

test('catalog lines clip a long decision and cap the keywords at eight', () => {
  const long = card({ decision: `${'word '.repeat(60).trim()}.`, keywords: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] });
  const [line] = cards.catalogLines([long]);
  assert.match(line, /^- card 20261014-3fa9c1 · (word ){20,}word… · a, b, c, d, e, f, g, h$/);
  assert.ok(line.length < 200);
});

test('the catalog takes the current spec-less cards, a superseded one never', () => {
  writeCards([
    card({ id: '20261001-aaaaaa', date: '2026-10-01', source: 'notes:2026-10-01 Old rule' }),
    card({ id: '20261002-bbbbbb', date: '2026-10-02', source: 'notes:2026-10-02 New rule', supersedes: '20261001-aaaaaa' }),
    card({ id: '20261003-cccccc', date: '2026-10-03' })
  ]);
  const lines = cards.catalogLines(cards.specLessCards(cards.readCards(root).current));
  assert.deepEqual(lines.map((l) => l.slice(0, 22)), ['- card 20261002-bbbbbb']);
});
