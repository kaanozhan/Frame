/**
 * Decision cards view — the pure row model (decision-cards-core T08).
 *
 * Turns what `LOAD_DECISION_CARDS` returns — the project's current cards and
 * today's PROJECT_NOTES.md entries — into the rows the view draws: newest
 * first, filtered by a search over the decision, its why, its keywords and
 * its files, each with a source label and where its story is.
 *
 * A card's story is either a spec (`spec:<slug>`, opened in its own tab) or a
 * PROJECT_NOTES.md entry (`notes:<YYYY-MM-DD> <title>`, shown in place). A
 * notes source whose heading is gone — renamed, or written by hand with a
 * typo — reads "story not found" rather than pointing at nothing.
 *
 * Pure: no DOM, no IPC, no fs, so it runs under `node --test`. The source
 * forms mirror scripts/decision-cards.js's parseSource; the renderer does not
 * reach into scripts/.
 */

'use strict';

const SPEC_SOURCE_RE = /^spec:([A-Za-z0-9][A-Za-z0-9._-]*)$/;
const NOTES_SOURCE_RE = /^notes:(\d{4}-\d{2}-\d{2}) (\S.*)$/;

/** Lowercased, accents and Turkish letters folded, spacing collapsed. */
function fold(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ç/g, 'c').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Where a card's story is, for the view:
 *   { kind: 'spec', slug, label }
 *   { kind: 'notes', date, title, label, found, body, line }
 *   { kind: 'unknown', label }   a source in neither form
 */
function storyOf(card, notes) {
  const source = typeof card.source === 'string' ? card.source.trim() : '';
  let m = SPEC_SOURCE_RE.exec(source);
  if (m) return { kind: 'spec', slug: m[1], label: `Spec · ${m[1]}` };
  m = NOTES_SOURCE_RE.exec(source);
  if (m) {
    const [, date, title] = m;
    const entry = (notes || []).find((n) => n && n.date === date && fold(n.title) === fold(title));
    return {
      kind: 'notes',
      date,
      title: title.trim(),
      label: `Notes · ${date} ${title.trim()}`,
      found: Boolean(entry),
      body: entry ? entry.body || '' : null,
      line: entry ? entry.line : null
    };
  }
  return { kind: 'unknown', label: source || 'no source' };
}

/** One card as a row. */
function rowOf(card, notes) {
  return {
    id: card.id,
    date: card.date,
    decision: card.decision,
    why: card.why,
    keywords: Array.isArray(card.keywords) ? card.keywords : [],
    files: Array.isArray(card.files) ? card.files : [],
    supersedes: card.supersedes || null,
    extends: card.extends || null,
    line: card.line || 0,
    story: storyOf(card, notes)
  };
}

/**
 * Whether a row matches the search: every word of the query appears in the
 * decision, the why, a keyword or a file. An empty query matches everything.
 */
function matchesQuery(row, query) {
  const terms = fold(query).split(' ').filter(Boolean);
  if (!terms.length) return true;
  const hay = fold([row.decision, row.why, ...row.keywords, ...row.files].join('\n'));
  return terms.every((t) => hay.includes(t));
}

/** Newest first; a later line breaks a same-date tie, being written later. */
function newerFirst(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return (b.line || 0) - (a.line || 0);
}

/**
 * The whole view: `{ rows, total, shown, query }`. `rows` are the visible
 * ones; `total` counts every card, so the header can say "3 / 12".
 */
function buildModel(data, { query = '' } = {}) {
  const cards = (data && Array.isArray(data.cards) ? data.cards : []).filter((c) => c && c.id);
  const notes = data && Array.isArray(data.notes) ? data.notes : [];
  const all = cards.map((c) => rowOf(c, notes)).sort(newerFirst);
  const rows = all.filter((r) => matchesQuery(r, query));
  return { rows, total: all.length, shown: rows.length, query: String(query || '').trim() };
}

module.exports = { buildModel, rowOf, storyOf, matchesQuery, fold };
