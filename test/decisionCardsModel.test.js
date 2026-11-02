/**
 * Decision cards view — the pure row model (decision-cards-core T08).
 *
 * What the view draws is decided here: rows newest first, the search over
 * decision, why, keywords and files, a label for each source, and a notes
 * source whose heading is gone read as "story not found" rather than a link
 * to nothing.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildModel, storyOf, matchesQuery, rowOf } = require('../src/renderer/decisions/cardsModel');

const card = (over = {}) => ({
  id: '20261014-aaaaaa', date: '2026-10-14', line: 1,
  decision: 'Card files merge with the union driver.',
  why: 'Two branches each append a card, and a union merge keeps both.',
  keywords: ['union merge', 'gitattributes'], files: ['src/main/gitSharing.js'],
  source: 'notes:2026-10-14 Union merge for cards', supersedes: null, extends: null, ...over
});

const NOTES = [{ date: '2026-10-14', title: 'Union merge for cards', line: 12, body: 'Both sides keep their lines.' }];

test('an empty or missing payload is an empty view', () => {
  assert.deepEqual(buildModel(null), { rows: [], total: 0, shown: 0, query: '' });
  assert.deepEqual(buildModel({ cards: [] }, { query: '  ' }), { rows: [], total: 0, shown: 0, query: '' });
});

test('rows are newest first, a later line winning a same-date tie', () => {
  const model = buildModel({
    cards: [
      card({ id: '20261001-aaaaaa', date: '2026-10-01', line: 1 }),
      card({ id: '20261014-bbbbbb', date: '2026-10-14', line: 2 }),
      card({ id: '20261014-cccccc', date: '2026-10-14', line: 3 })
    ],
    notes: NOTES
  });
  assert.deepEqual(model.rows.map((r) => r.id), ['20261014-cccccc', '20261014-bbbbbb', '20261001-aaaaaa']);
  assert.equal(model.total, 3);
});

test('the search matches every word across decision, why, keywords and files', () => {
  const cards = [
    card({ id: '20261001-aaaaaa', decision: 'Cards merge by union.', why: 'Both lines stay.', keywords: ['merge'], files: ['src/main/gitSharing.js'] }),
    card({ id: '20261002-bbbbbb', decision: 'The view lists cards.', why: 'Newest first.', keywords: ['view'], files: ['src/renderer/decisionCardsPanel.js'] })
  ];
  const ids = (q) => buildModel({ cards }, { query: q }).rows.map((r) => r.id);
  assert.deepEqual(ids('union'), ['20261001-aaaaaa'], 'decision');
  assert.deepEqual(ids('newest'), ['20261002-bbbbbb'], 'why');
  assert.deepEqual(ids('MERGE'), ['20261001-aaaaaa'], 'keyword, any case');
  assert.deepEqual(ids('decisionCardsPanel'), ['20261002-bbbbbb'], 'file');
  assert.deepEqual(ids('cards view'), ['20261002-bbbbbb'], 'every word must appear');
  assert.deepEqual(ids('nothing-like-this'), []);
  const model = buildModel({ cards }, { query: ' union ' });
  assert.deepEqual([model.shown, model.total, model.query], [1, 2, 'union']);
});

test('a spec source is labelled and opens its spec', () => {
  assert.deepEqual(storyOf(card({ source: 'spec:decision-cards-core' }), NOTES),
    { kind: 'spec', slug: 'decision-cards-core', label: 'Spec · decision-cards-core' });
});

test('a notes source finds its entry without case or spacing differences', () => {
  const story = storyOf(card({ source: 'notes:2026-10-14 union  MERGE for cards' }), NOTES);
  assert.equal(story.kind, 'notes');
  assert.equal(story.found, true);
  assert.equal(story.body, 'Both sides keep their lines.');
  assert.equal(story.line, 12);
  assert.equal(story.label, 'Notes · 2026-10-14 union  MERGE for cards');
});

test('a notes source whose heading is gone is "story not found", not a dead link', () => {
  const renamed = storyOf(card({ source: 'notes:2026-10-14 A title nobody wrote' }), NOTES);
  assert.equal(renamed.found, false);
  assert.equal(renamed.body, null);
  const wrongDay = storyOf(card({ source: 'notes:2026-10-15 Union merge for cards' }), NOTES);
  assert.equal(wrongDay.found, false, 'the date must match exactly');
  assert.equal(storyOf(card(), []).found, false, 'no notes at all');
});

test('a source in neither form is labelled as it is', () => {
  assert.deepEqual(storyOf(card({ source: 'PROJECT_NOTES.md:120' }), NOTES), { kind: 'unknown', label: 'PROJECT_NOTES.md:120' });
});

test('a row carries the card\'s relation and tolerates missing lists', () => {
  const row = rowOf(card({ supersedes: '20261001-aaaaaa', keywords: undefined, files: undefined }), NOTES);
  assert.equal(row.supersedes, '20261001-aaaaaa');
  assert.deepEqual([row.keywords, row.files], [[], []]);
  assert.equal(matchesQuery(row, ''), true);
});
