/**
 * Decision cards — the shared reader for `.frame/decisions.jsonl`.
 *
 * A card is one JSON object per line: a decision, a why of at most three
 * sentences, keywords, files, a `source` pointing at the decision's story,
 * `supersedes` / `extends`, an id and a date. The story lives elsewhere: the
 * spec chain for spec work, a `PROJECT_NOTES.md` entry for spec-less work.
 *
 * This module reads the file on every call (no index, no cache: the
 * installed app rewrites the spec index with its own code, and the index
 * watcher sees only `.frame/specs/*`), validates each line, drops superseded
 * cards, matches cards to a file or to a bag of words, and renders the lines
 * the hooks, the catalog and the CLI print.
 *
 * Rules of the file:
 *   - Cards are never rewritten in place; a newer card supersedes an old one.
 *   - A card is current unless another card names it in `supersedes`.
 *   - A spec card is one whose source starts with `spec:`; no hook delivers it.
 *   - A line that does not parse or does not validate is skipped and reported,
 *     never fatal: a torn last line from an interrupted append must not take
 *     the other cards down with it.
 *
 * Dependency-free plain node; ships to user projects' `.frame/bin/`, where
 * neither Frame's tree nor node_modules is reachable. Its `.frame` literal
 * mirrors `frameStore.decisionsPath()` and is pinned by
 * `test/metaPathGuard.test.js`. The tokenizer and the rare/common weights are
 * copies of `spec-hint.js`'s, so a card and a spec match a prompt by the same
 * rule; a card needs a stronger match (score 3, not 2) because a card is one
 * decision, not a whole spec's worth of vocabulary.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── shape ────────────────────────────────────────────────

const LIMITS = {
  decisionChars: 280,
  decisionSentences: 1,
  whySentences: 3,
  keywordsMin: 1,
  keywordsMax: 8,
  // One O_APPEND write of a line this size or smaller lands whole.
  lineBytes: 4096
};

/** A card matches a bag of words at this score or more (spec-hint uses 2). */
const MATCH_THRESHOLD = 3;

const ID_RE = /^\d{8}-[0-9a-f]{6}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SPEC_SOURCE_RE = /^spec:([A-Za-z0-9][A-Za-z0-9._-]*)$/;
const NOTES_SOURCE_RE = /^notes:(\d{4}-\d{2}-\d{2}) (\S.*)$/;

/** Where a project keeps its cards. Mirrors frameStore.decisionsPath(). */
function cardsPath(root) {
  return path.join(root, '.frame', 'decisions.jsonl');
}

function toPosix(p) { return String(p).split(path.sep).join('/'); }

/** Project-relative, posix, no leading `./` — the form `files` holds. */
function normalizeRel(p) {
  return toPosix(String(p).trim()).replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

/**
 * What a source points at, or null when it has neither accepted form:
 * `spec:<slug>` or `notes:<YYYY-MM-DD> <title>`. Never a line number:
 * PROJECT_NOTES.md rows are keyed by line elsewhere, and lines move.
 */
function parseSource(source) {
  const s = typeof source === 'string' ? source.trim() : '';
  let m = SPEC_SOURCE_RE.exec(s);
  if (m && !m[1].includes('..')) return { kind: 'spec', slug: m[1] };
  m = NOTES_SOURCE_RE.exec(s);
  if (m && isRealDate(m[1])) return { kind: 'notes', date: m[1], title: m[2].trim() };
  return null;
}

function isRealDate(s) {
  const m = DATE_RE.exec(String(s));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/**
 * How many sentences `text` holds. A period ends a sentence only before
 * whitespace or at the end — so not inside `spec-index.js` or `v1.2` — and
 * not after "e.g.", after the number of a list item, or when a lowercase word
 * follows. The same boundary rule as spec-index.js's firstSentence.
 */
function sentenceCount(text) {
  const s = String(text || '').trim();
  if (!s) return 0;
  let count = 0;
  let last = 0;
  const re = /[.!?]+["'”’)\]`*_]*(?=\s|$)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const stop = m.index + m[0].length;
    const head = s.slice(last, stop);
    if (!/\p{L}/u.test(head)) continue;
    if (/(?:^|[\s(])(?:e\.g|i\.e|vs|cf|etc)\.$/i.test(s.slice(0, stop))) continue;
    if (/^\s+\p{Ll}/u.test(s.slice(stop))) continue;
    count += 1;
    last = stop;
  }
  // Trailing words with no closing punctuation are a sentence of their own.
  if (/\p{L}/u.test(s.slice(last))) count += 1;
  return count;
}

/**
 * Everything wrong with `card`'s shape, as readable defects; empty when it is
 * a well-formed card. Shape only: whether its source resolves and whether the
 * ids it names exist are the writer's checks (decision.js add), because they
 * need the project on disk and the rest of the file.
 */
function validateCard(card) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) return ['not a JSON object'];
  const defects = [];

  if (typeof card.id !== 'string' || !ID_RE.test(card.id)) defects.push('id must look like YYYYMMDD-abcdef');
  if (typeof card.date !== 'string' || !isRealDate(card.date)) defects.push('date must be YYYY-MM-DD');

  if (typeof card.decision !== 'string' || !card.decision.trim()) {
    defects.push('decision is missing');
  } else {
    const d = card.decision.trim();
    if (d.length > LIMITS.decisionChars) defects.push(`decision is ${d.length} characters (at most ${LIMITS.decisionChars})`);
    if (sentenceCount(d) > LIMITS.decisionSentences) defects.push('decision must be one sentence');
  }

  if (typeof card.why !== 'string' || !card.why.trim()) {
    defects.push('why is missing');
  } else if (sentenceCount(card.why) > LIMITS.whySentences) {
    defects.push(`why is ${sentenceCount(card.why)} sentences (at most ${LIMITS.whySentences})`);
  }

  if (!Array.isArray(card.keywords)) {
    defects.push('keywords must be a list');
  } else {
    const kws = card.keywords.filter((k) => typeof k === 'string' && k.trim());
    if (kws.length !== card.keywords.length) defects.push('every keyword must be a non-empty string');
    if (kws.length < LIMITS.keywordsMin || kws.length > LIMITS.keywordsMax) {
      defects.push(`keywords holds ${kws.length} (between ${LIMITS.keywordsMin} and ${LIMITS.keywordsMax})`);
    }
  }

  if (!Array.isArray(card.files)) {
    defects.push('files must be a list (empty when the decision names no file)');
  } else {
    for (const f of card.files) {
      if (typeof f !== 'string' || !f.trim()) { defects.push('every file must be a non-empty string'); continue; }
      const rel = normalizeRel(f);
      if (path.isAbsolute(f) || /^[A-Za-z]:/.test(f) || rel.split('/').includes('..')) {
        defects.push(`file "${f}" must be project-relative`);
      }
    }
  }

  if (!parseSource(card.source)) {
    defects.push('source must be "spec:<slug>" or "notes:<YYYY-MM-DD> <title>"');
  }

  for (const rel of ['supersedes', 'extends']) {
    const v = card[rel];
    if (v === null || v === undefined) continue;
    if (typeof v !== 'string' || !ID_RE.test(v)) defects.push(`${rel} must be a card id or null`);
    else if (v === card.id) defects.push(`${rel} names the card itself`);
  }
  if (card.supersedes && card.extends) defects.push('a card cannot both supersede and extend');

  return defects;
}

/** The card as the rest of Frame reads it: trimmed, posix files, null relations. */
function normalizeCard(card) {
  return {
    ...card,
    decision: card.decision.trim(),
    why: card.why.trim(),
    keywords: card.keywords.map((k) => k.trim()),
    files: card.files.map(normalizeRel),
    source: card.source.trim(),
    supersedes: card.supersedes || null,
    extends: card.extends || null
  };
}

// ─── reading ──────────────────────────────────────────────

/**
 * Every well-formed card in `text`, in file order, plus every line that was
 * skipped and why. A repeated id keeps its first card: an identical repeat
 * (two branches carrying the same line through a union merge) is silent, a
 * different card under a taken id is reported.
 */
function parseCards(text) {
  const cards = [];
  const malformed = [];
  const seen = new Map();
  String(text || '').split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const lineNo = i + 1;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      malformed.push({ line: lineNo, reason: 'not valid JSON (a torn or hand-edited line)' });
      return;
    }
    const defects = validateCard(obj);
    if (defects.length) {
      malformed.push({ line: lineNo, id: obj && typeof obj.id === 'string' ? obj.id : null, reason: defects.join('; ') });
      return;
    }
    const card = normalizeCard(obj);
    const prior = seen.get(card.id);
    if (prior) {
      if (prior.raw !== line) malformed.push({ line: lineNo, id: card.id, reason: `duplicate id ${card.id} (line ${prior.line} kept)` });
      return;
    }
    seen.set(card.id, { line: lineNo, raw: line });
    cards.push({ ...card, line: lineNo });
  });
  return { cards, malformed };
}

/** Cards no other card supersedes. A chain A ← B ← C leaves C. */
function currentCards(cards) {
  const superseded = new Set(cards.map((c) => c.supersedes).filter(Boolean));
  return cards.filter((c) => !superseded.has(c.id));
}

/**
 * The project's cards, read now. Never throws: no file reads as
 * `{ exists: false }` with empty lists, which is what lets every caller keep
 * a project without cards byte-identical to today.
 */
function readCards(root) {
  let text;
  try {
    text = fs.readFileSync(cardsPath(root), 'utf8');
  } catch {
    return { exists: false, cards: [], current: [], malformed: [] };
  }
  const { cards, malformed } = parseCards(text);
  return { exists: true, cards, current: currentCards(cards), malformed };
}

function isSpecCard(card) {
  const src = parseSource(card && card.source);
  return !!src && src.kind === 'spec';
}

/** The cards a hook may deliver: current and spec-less. */
function specLessCards(cards) {
  return cards.filter((c) => !isSpecCard(c));
}

/** Current cards whose story is spec `slug`. */
function cardsForSpec(cards, slug) {
  return cards.filter((c) => {
    const src = parseSource(c.source);
    return src && src.kind === 'spec' && src.slug === slug;
  });
}

// ─── stories ──────────────────────────────────────────────

// Today's PROJECT_NOTES.md entry heading — the same pattern projectInsights'
// loadDecisions reads, so a notes source resolves wherever an entry shows.
const NOTES_HEADING_RE = /^###\s*\[(\d{4}-\d{2}-\d{2})\]\s*(.+)$/;

/**
 * Where PROJECT_NOTES.md is: `.frame/` once migrated, the root while an
 * unmigrated project still keeps it there. check-freshness.js's rule; the
 * app answers through frameStore.readNotes.
 */
function notesPath(root) {
  const overlay = path.join(root, '.frame', 'PROJECT_NOTES.md');
  if (fs.existsSync(overlay)) return overlay;
  const legacy = path.join(root, 'PROJECT_NOTES.md');
  return fs.existsSync(legacy) ? legacy : overlay;
}

function sameTitle(a, b) {
  const norm = (s) => fold(s).replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
}

/**
 * The `### [date] title` entry a notes source names, as `{ date, title, line }`,
 * or null. Titles compare without case or spacing differences; the date must
 * be exact. The first match wins, as the view lists them.
 */
function findNotesEntry(notesText, source) {
  const src = typeof source === 'string' ? parseSource(source) : source;
  if (!src || src.kind !== 'notes') return null;
  const lines = String(notesText || '').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const m = NOTES_HEADING_RE.exec(lines[i]);
    if (m && m[1] === src.date && sameTitle(m[2], src.title)) return { date: m[1], title: m[2].trim(), line: i + 1 };
  }
  return null;
}

// ─── matching ─────────────────────────────────────────────

function fold(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ç/g, 'c').replace(/ö/g, 'o').replace(/ü/g, 'u');
}

const STOPWORDS = new Set(('the and for with via from into that this what when where how why can should will just like ' +
  'add fix update change make use new file files code test tests task tasks spec specs plan work run app panel button ' +
  'bir ve ile için gibi şey yap ekle düzelt dosya kod olarak sonra önce daha bu şu').split(/\s+/).map(fold));

function tokenize(s) {
  return fold(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** The words a card answers to: its keywords, its decision, its files' names. */
function cardTokens(card) {
  return new Set([
    ...card.keywords.flatMap(tokenize),
    ...tokenize(card.decision),
    ...card.files.flatMap((f) => tokenize(path.posix.basename(f, path.posix.extname(f))))
  ]);
}

/** Newest first; file order breaks a tie, later lines being newer. */
function newerFirst(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return (b.line || 0) - (a.line || 0);
}

/** Cards listing `rel` among their files, newest first. */
function cardsForFile(cards, rel) {
  const want = normalizeRel(rel);
  return cards.filter((c) => c.files.includes(want)).sort(newerFirst);
}

/**
 * Score `cards` against a bag of words: a shared token counts 2 when it is
 * rare across `corpus` (the same document-frequency rule as spec-hint.js) and
 * 1 when it is common. Returns `[{ card, score, tokens }]` at or above `min`,
 * best first, newest first on a tie.
 */
function scoreCards(cards, query, opts = {}) {
  const min = opts.min === undefined ? MATCH_THRESHOLD : opts.min;
  const corpus = opts.corpus || cards;
  const words = [...new Set(Array.isArray(query) ? query.flatMap(tokenize) : tokenize(query || ''))];
  if (!words.length || !cards.length) return [];

  const df = new Map();
  const bags = new Map();
  for (const c of corpus) {
    const toks = cardTokens(c);
    bags.set(c.id, toks);
    for (const t of toks) df.set(t, (df.get(t) || 0) + 1);
  }
  const rare = Math.max(3, Math.ceil(corpus.length * 0.15));

  const out = [];
  for (const card of cards) {
    const toks = bags.get(card.id) || cardTokens(card);
    let score = 0;
    const hit = [];
    for (const w of words) {
      if (!toks.has(w)) continue;
      score += (df.get(w) || 0) <= rare ? 2 : 1;
      hit.push(w);
    }
    if (score >= min && hit.length) out.push({ card, score, tokens: hit });
  }
  return out.sort((a, b) => (b.score - a.score) || newerFirst(a.card, b.card));
}

/**
 * Cards that share a file or a keyword with a decision about to be recorded.
 * Ranked by shared files first — a file is a precise anchor, words are not —
 * then by the word score scoreCards gives, newest first on a tie. `score`
 * (3 per shared file plus the word score) is reported, not sorted on.
 * Recall over precision on purpose — the agent reads the list and names the
 * one that matters in its question; this only guarantees it is on the list.
 */
function relatedCards(cards, { files = [], keywords = [] } = {}) {
  const wantFiles = new Set(files.map(normalizeRel).filter(Boolean));
  const byWord = new Map(scoreCards(cards, keywords, { min: 1 }).map((r) => [r.card.id, r]));
  const out = [];
  for (const card of cards) {
    const sharedFiles = card.files.filter((f) => wantFiles.has(f));
    const words = byWord.get(card.id);
    if (!sharedFiles.length && !words) continue;
    out.push({
      card,
      score: sharedFiles.length * 3 + (words ? words.score : 0),
      wordScore: words ? words.score : 0,
      files: sharedFiles,
      tokens: words ? words.tokens : []
    });
  }
  return out
    .sort((a, b) => (b.files.length - a.files.length) || (b.wordScore - a.wordScore) || newerFirst(a.card, b.card))
    .map(({ wordScore, ...rest }) => rest);
}

// ─── rendering ────────────────────────────────────────────

/** `s` cut at a word boundary with "…" when it runs past `cap`. */
function clip(s, cap) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= cap) return t;
  const cut = t.slice(0, cap - 1);
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:—–(-]+$/, '') + '…';
}

/** Where the card's story is told, as an agent would go and read it. */
function storyPointer(card) {
  const src = parseSource(card.source);
  if (!src) return card.source;
  if (src.kind === 'spec') return `.frame/specs/${src.slug}/`;
  return `PROJECT_NOTES.md "### [${src.date}] ${src.title}"`;
}

function relationMark(card) {
  if (card.supersedes) return ` (supersedes ${card.supersedes})`;
  if (card.extends) return ` (extends ${card.extends})`;
  return '';
}

/**
 * One card as a hook or the CLI prints it. Full: the decision, its why and
 * where its story lives. Compact: one line, for when several cards share the
 * space.
 */
function renderCard(card, { full = true } = {}) {
  const head = `- ${card.date} ${card.id}${relationMark(card)} — `;
  if (!full) return `${head}${clip(card.decision, 140)}`;
  return `${head}${card.decision}\n  why: ${card.why}\n  story: ${storyPointer(card)}`;
}

/**
 * Catalog lines for /spec.new, in the spec catalog's own shape
 * (`- name · summary · keywords`), so cards read as one more kind of entry
 * after the specs.
 */
function catalogLines(cards) {
  return [...cards].sort(newerFirst).map((c) =>
    `- card ${c.id} · ${clip(c.decision, 120)} · ${c.keywords.slice(0, LIMITS.keywordsMax).join(', ')}`);
}

module.exports = {
  LIMITS,
  MATCH_THRESHOLD,
  ID_RE,
  cardsPath,
  normalizeRel,
  parseSource,
  isRealDate,
  sentenceCount,
  validateCard,
  parseCards,
  currentCards,
  readCards,
  isSpecCard,
  specLessCards,
  cardsForSpec,
  notesPath,
  findNotesEntry,
  tokenize,
  cardTokens,
  cardsForFile,
  scoreCards,
  relatedCards,
  clip,
  storyPointer,
  renderCard,
  catalogLines
};
