#!/usr/bin/env node
/**
 * decision.js — record and look up decision cards.
 *
 *   node .frame/bin/decision.js add '<card json>'          # or the JSON on stdin
 *   node .frame/bin/decision.js related --files a,b --keywords x,y
 *   node .frame/bin/decision.js list
 *
 * Every command takes `--json`. `add` exits 0 when the card was written and 1
 * when it was refused, naming each defect; `related` and `list` always exit 0.
 *
 * `add` takes the fields an agent decides — decision, why, keywords, files,
 * source, and optionally supersedes or extends — and assigns the rest:
 *   - date: the UTC date of writing;
 *   - id:   `<YYYYMMDD>-<6 hex>`, the hex from sha1(decision + source + date),
 *           refused when the file already holds it.
 * It checks what the shared reader cannot without the project on disk: a
 * `spec:<slug>` source names an existing spec folder, a
 * `notes:<YYYY-MM-DD> <title>` source names an existing PROJECT_NOTES.md
 * heading, and `supersedes` / `extends` name a current card. A listed file
 * that does not exist is a warning, not a refusal — a decision can name a file
 * the same change is about to create.
 *
 * The card is appended as one line with a single write on an O_APPEND
 * descriptor, under 4 KB, so a concurrent append cannot interleave with it and
 * an interruption leaves at most one torn line that every reader skips.
 *
 * `related` exists so an agent can name the card a new decision relates to in
 * the one question it asks before recording: it lists every current card that
 * shares a file or a word, ranked. The script guarantees recall; the agent
 * picks the card that matters.
 *
 * Writes nothing but the card and one activity row per `add`. Frame makes no
 * model call: the agent writes the card, this validates and appends it.
 * Dependency-free plain node; FRAME_PROJECT_ROOT lets it run from .frame/bin/.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const cards = require('./decision-cards');

const USAGE = [
  'Usage:',
  "  decision.js add '<card json>' [--json]     (or the JSON on stdin)",
  '  decision.js related --files a,b --keywords x,y [--json]',
  '  decision.js list [--json]'
].join('\n');

function resolveRoot() {
  if (process.env.FRAME_PROJECT_ROOT) return path.resolve(process.env.FRAME_PROJECT_ROOT);
  if (path.basename(__dirname) === 'bin' && path.basename(path.dirname(__dirname)) === '.frame') {
    return path.dirname(path.dirname(__dirname));
  }
  return path.join(__dirname, '..');
}

function specDir(root, slug) { return path.join(root, '.frame', 'specs', slug); }

/** The UTC date of writing. FRAME_DECISION_DATE pins it, for tests only. */
function today() {
  const pinned = process.env.FRAME_DECISION_DATE;
  if (pinned && cards.isRealDate(pinned)) return pinned;
  return new Date().toISOString().slice(0, 10);
}

function cardId(decision, source, date) {
  const hex = crypto.createHash('sha1').update(`${decision}${source}${date}`).digest('hex').slice(0, 6);
  return `${date.replace(/-/g, '')}-${hex}`;
}

/** `--name value` or `--name=value`, as a comma-split list. */
function listFlag(argv, name) {
  const out = [];
  argv.forEach((a, i) => {
    let v = null;
    if (a === `--${name}`) v = argv[i + 1];
    else if (a.startsWith(`--${name}=`)) v = a.slice(name.length + 3);
    if (typeof v === 'string' && !v.startsWith('--')) out.push(...v.split(','));
  });
  return out.map((s) => s.trim()).filter(Boolean);
}

// A refusal is a guard preventing a write, so it is a suppression; a written
// card is an action. Same kinds as the registry in activityEvents.js.
function record(root, ev, fields) {
  try {
    const activity = require('./activity-log');
    const kind = ev === 'decision.rejected' ? 'suppression' : 'action';
    activity.appendSync(activity.projectKey(root), { ev, kind, host: 'cli', ...fields });
  } catch {
    /* older .frame/bin generation, or an unwritable home — the command still ran */
  }
}

// ─── add ──────────────────────────────────────────────────

/**
 * Build and check the card `input` describes. Returns
 * `{ card, defects, warnings }`; the card is written only when defects is
 * empty. Pure apart from reading disk.
 */
function prepare(root, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { card: null, defects: ['the card must be a JSON object'], warnings: [] };
  }
  const warnings = [];
  if (input.id !== undefined || input.date !== undefined) warnings.push('id and date are assigned by decision.js; the ones given were ignored');

  const date = today();
  const decision = typeof input.decision === 'string' ? input.decision.trim() : input.decision;
  const source = typeof input.source === 'string' ? input.source.trim() : input.source;
  const card = {
    id: cardId(String(decision || ''), String(source || ''), date),
    date,
    decision,
    why: typeof input.why === 'string' ? input.why.trim() : input.why,
    keywords: input.keywords,
    files: input.files === undefined ? [] : input.files,
    source,
    supersedes: input.supersedes || null,
    extends: input.extends || null
  };

  const defects = cards.validateCard(card);
  const existing = cards.readCards(root);

  const src = cards.parseSource(card.source);
  if (src && src.kind === 'spec' && !fs.existsSync(specDir(root, src.slug))) {
    defects.push(`source names spec "${src.slug}", but .frame/specs/${src.slug}/ does not exist`);
  }
  if (src && src.kind === 'notes') {
    let notes = null;
    try { notes = fs.readFileSync(cards.notesPath(root), 'utf8'); } catch { /* no notes file */ }
    if (!cards.findNotesEntry(notes, src)) {
      defects.push(`source names a PROJECT_NOTES.md entry "### [${src.date}] ${src.title}", but no such heading exists — write the entry first`);
    }
  }

  const byId = new Map(existing.cards.map((c) => [c.id, c]));
  const currentIds = new Set(existing.current.map((c) => c.id));
  for (const rel of ['supersedes', 'extends']) {
    const id = card[rel];
    if (!id || !cards.ID_RE.test(id)) continue;
    if (!byId.has(id)) {
      defects.push(`${rel} names card ${id}, which is not in .frame/decisions.jsonl`);
    } else if (!currentIds.has(id)) {
      const by = existing.cards.find((c) => c.supersedes === id);
      defects.push(`${rel} names card ${id}, which ${by ? `card ${by.id}` : 'a later card'} already supersedes — name ${by ? by.id : 'the current card'} instead`);
    }
  }
  if (byId.has(card.id)) defects.push(`card ${card.id} is already recorded (same decision and source today)`);

  if (Array.isArray(card.files)) {
    for (const f of card.files) {
      if (typeof f !== 'string' || !f.trim()) continue;
      const rel = cards.normalizeRel(f);
      if (!rel.split('/').includes('..') && !path.isAbsolute(f) && !fs.existsSync(path.join(root, rel))) {
        warnings.push(`file ${rel} does not exist (yet)`);
      }
    }
  }

  const out = defects.length ? card : { ...card, files: card.files.map(cards.normalizeRel), keywords: card.keywords.map((k) => k.trim()) };
  const line = JSON.stringify(out);
  if (!defects.length && Buffer.byteLength(line) >= cards.LIMITS.lineBytes) {
    defects.push(`the card is ${Buffer.byteLength(line)} bytes as one line (under ${cards.LIMITS.lineBytes}) — shorten the why or the lists`);
  }
  return { card: out, line, defects, warnings };
}

/**
 * Append one line in a single write. A file whose last line was torn by an
 * interrupted append gets a newline first, in the same write, so the new
 * card never fuses onto it.
 */
function appendLine(root, line) {
  const file = cards.cardsPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'a');
  try {
    const { size } = fs.fstatSync(fd);
    let lead = '';
    if (size > 0) {
      const last = Buffer.alloc(1);
      const rfd = fs.openSync(file, 'r');
      try { fs.readSync(rfd, last, 0, 1, size - 1); } finally { fs.closeSync(rfd); }
      if (last[0] !== 0x0a) lead = '\n';
    }
    fs.writeSync(fd, `${lead}${line}\n`);
  } finally {
    fs.closeSync(fd);
  }
}

function readInput(argv) {
  const arg = argv.find((a) => !a.startsWith('--'));
  if (arg !== undefined) return arg;
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function add(root, argv, json) {
  const raw = readInput(argv);
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    input = undefined;
  }
  const result = input === undefined
    ? { card: null, defects: ['the card is not valid JSON'], warnings: [] }
    : prepare(root, input);

  if (result.defects.length) {
    record(root, 'decision.rejected', { defects: result.defects.length });
    if (json) process.stdout.write(`${JSON.stringify({ ok: false, defects: result.defects, warnings: result.warnings }, null, 2)}\n`);
    else process.stderr.write(['Card not recorded:', ...result.defects.map((d) => `  - ${d}`), ...result.warnings.map((w) => `  (warning: ${w})`)].join('\n') + '\n');
    return 1;
  }

  appendLine(root, result.line);
  const src = cards.parseSource(result.card.source);
  const relation = result.card.supersedes ? 'supersedes' : result.card.extends ? 'extends' : 'none';
  record(root, 'decision.added', src.kind === 'spec'
    ? { source: 'spec', slug: src.slug, relation }
    : { source: 'notes', relation });

  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: true, card: result.card, warnings: result.warnings }, null, 2)}\n`);
  } else {
    const lines = [`Recorded card ${result.card.id} in .frame/decisions.jsonl:`, cards.renderCard(result.card)];
    for (const w of result.warnings) lines.push(`(warning: ${w})`);
    process.stdout.write(`${lines.join('\n')}\n`);
  }
  return 0;
}

// ─── related / list ───────────────────────────────────────

function malformedLines(malformed) {
  return malformed.map((m) => `Skipped line ${m.line}${m.id ? ` (${m.id})` : ''}: ${m.reason}`);
}

function related(root, argv, json) {
  const files = listFlag(argv, 'files');
  const keywords = listFlag(argv, 'keywords');
  const read = cards.readCards(root);
  const hits = cards.relatedCards(read.current, { files, keywords });

  if (json) {
    process.stdout.write(`${JSON.stringify({
      cards: hits.map((h) => ({ ...h.card, score: h.score, sharedFiles: h.files, sharedWords: h.tokens })),
      malformed: read.malformed
    }, null, 2)}\n`);
    return 0;
  }
  const lines = [];
  if (!read.exists) lines.push('No decision cards in this project yet.');
  else if (!hits.length) lines.push('No current card shares a file or a keyword with this decision.');
  else {
    lines.push(`${hits.length} current card${hits.length === 1 ? '' : 's'} share${hits.length === 1 ? 's' : ''} a file or a keyword, best match first:`);
    for (const h of hits) {
      const shares = [...h.files, ...h.tokens.map((t) => `"${t}"`)].join(', ');
      lines.push(`${cards.renderCard(h.card, { full: false })}\n  shares: ${shares}`);
    }
  }
  lines.push(...malformedLines(read.malformed));
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

function list(root, json) {
  const read = cards.readCards(root);
  // Newest first; file order breaks a same-date tie, later lines being newer.
  const current = [...read.current].sort((a, b) => (a.date === b.date ? b.line - a.line : a.date < b.date ? 1 : -1));
  if (json) {
    process.stdout.write(`${JSON.stringify({ cards: current, malformed: read.malformed }, null, 2)}\n`);
    return 0;
  }
  const lines = [];
  if (!read.exists) lines.push('No decision cards in this project yet.');
  else if (!current.length) lines.push('No current decision cards.');
  else {
    lines.push(`${current.length} current decision card${current.length === 1 ? '' : 's'}, newest first:`);
    for (const c of current) lines.push(cards.renderCard(c));
  }
  lines.push(...malformedLines(read.malformed));
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

function main(argv) {
  const [command, ...rest] = argv;
  const json = rest.includes('--json');
  const root = resolveRoot();
  if (command === 'add') return add(root, rest.filter((a) => a !== '--json'), json);
  if (command === 'related') return related(root, rest, json);
  if (command === 'list') return list(root, json);
  process.stderr.write(`${USAGE}\n`);
  return 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    // Never a stack trace into an agent's turn.
    process.stderr.write(`decision.js could not run: ${e && e.message ? e.message : 'unknown error'}\n`);
    process.exitCode = 1;
  }
}

module.exports = { prepare, appendLine, cardId, main };
