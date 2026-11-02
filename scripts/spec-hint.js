#!/usr/bin/env node
/**
 * Spec Knowledge Layer — Claude Code hook entry
 *
 * Deterministic delivery: the harness runs this on every matching tool call,
 * so the agent sees spec history with zero reliance on it remembering
 * AGENTS.md guidance.
 *
 * Modes (argv[2]):
 *   pre-edit   PreToolUse hook for Edit/Write — inject the target file's
 *              spec history, then its spec-less decision cards, at the
 *              moment of intent (never on Grep/Read: exploration must stay
 *              injection-free).
 *   prompt     UserPromptSubmit hook — score the user's prompt against the
 *              topic catalog, surface up to 3 related specs, and up to 2
 *              strongly matching decision cards recorded outside any spec. Also where a
 *              spec that closed without its digest is announced when the
 *              turn that closed it made no further tool call
 *              (spec-close-state.js decides; docs-hint.js covers the
 *              same-turn case).
 *
 * Hard contract (from the spec):
 *   - NEVER block, NEVER break: any failure → exit 0, empty output.
 *   - Read-only: consumes .frame/index/spec-index.json as-is; never rebuilds
 *     (missing/stale index → silence). Frame keeps the index fresh.
 *   - Session dedup: one injection per file (and per suggested spec) per
 *     session; state in .frame/runtime/spec-hint/<session_id>.json,
 *     stale state files cleaned up after 7 days.
 *   - Budget: 1–2 history entries → full compact records; 3+ → one line per
 *     spec + a pointer. Every spec is always present — overflow drops depth,
 *     never entries.
 *   - FRAME_SPEC_HINT_MODE=signal → one-line signal instead of content.
 *
 * Dependency-free plain node; ships to user projects' .frame/bin/.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const STATE_DIR_REL = path.join('.frame', 'runtime', 'spec-hint');
const STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TOPIC_HITS = 3;

// ─── tiny utils (no imports from siblings: the hook must not pull in
//     builder code paths that could rebuild or slow down) ──

function toPosix(p) { return String(p).split(path.sep).join('/'); }

function fold(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ç/g, 'c').replace(/ö/g, 'o').replace(/ü/g, 'u');
}

const STOPWORDS = new Set(('the and for with via from into that this what when where how why can should will just like ' +
  'add fix update change make use new file files code test tests task tasks spec specs plan work run app panel button ' +
  'bir ve ile için gibi şey yap ekle düzelt dosya kod olarak sonra önce daha bu şu').split(/\s+/).map(fold));

function tokenize(s) {
  return fold(s).split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// ─── project root + index (read-only) ─────────────────────

function resolveRoot(hookCwd) {
  if (process.env.FRAME_PROJECT_ROOT) return path.resolve(process.env.FRAME_PROJECT_ROOT);
  if (hookCwd && fs.existsSync(path.join(hookCwd, '.frame'))) return hookCwd;
  if (path.basename(__dirname) === 'bin' && path.basename(path.dirname(__dirname)) === '.frame') {
    return path.dirname(path.dirname(__dirname));
  }
  return process.cwd();
}

function contextCliPath(root) {
  const local = path.join(__dirname, 'spec-context.js');
  if (fs.existsSync(local)) return toPosix(path.relative(root, local)) || 'spec-context.js';
  return '.frame/bin/spec-context.js';
}

// ─── session dedup state ──────────────────────────────────

function stateFile(root, sessionId) {
  const safe = String(sessionId || 'no-session').replace(/[^\w-]/g, '_').slice(0, 80);
  return path.join(root, STATE_DIR_REL, `${safe}.json`);
}

function loadState(root, sessionId) {
  const st = readJson(stateFile(root, sessionId));
  const state = (st && Array.isArray(st.files) && Array.isArray(st.topics)) ? st : { files: [], topics: [] };
  // Card ids shown this session (decision-cards-core). A state file written
  // before cards existed simply has none yet.
  if (!Array.isArray(state.cards)) state.cards = [];
  return state;
}

function saveState(root, sessionId, state) {
  try {
    const f = stateFile(root, sessionId);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(state));
  } catch { /* dedup is best-effort */ }
}

function cleanupState(root) {
  try {
    const dir = path.join(root, STATE_DIR_REL);
    const now = Date.now();
    for (const f of fs.readdirSync(dir)) {
      try {
        const p = path.join(dir, f);
        if (now - fs.statSync(p).mtimeMs > STATE_TTL_MS) fs.unlinkSync(p);
      } catch { /* ignore */ }
    }
  } catch { /* no dir yet */ }
}

// ─── activity record ──────────────────────────────────────
//
// This hook exits 0 with no output on eleven different paths, so until now
// "ran and deliberately stayed quiet" was indistinguishable from "never
// fired" and from "never installed" — and determinism is the entire claim of
// the Spec Knowledge Layer. Every path now records its reason.
//
// The require is guarded because `.frame/bin/` is refreshed only on project
// init: a user may be running a generation that predates activity-log.js,
// and that must degrade to exactly today's behavior, not to an exception.
// Nothing here may write to stdout (it would corrupt the hook payload) or
// throw (the host is a tool call).

let activity = null;
try {
  activity = require('./activity-log');
} catch {
  /* older .frame/bin generation — no record, same behavior as before */
}

// How each CLI names its edit tool and where it puts the path. Guarded like
// activity-log: an older `.frame/bin/` generation degrades to reading
// `file_path`, which is what this script did before.
let vocab = null;
try {
  vocab = require('./toolVocabulary');
} catch {
  /* older generation — the inline fallback below is the old behaviour */
}

// What a closed spec still owes. Guarded like the two above: a `.frame/bin/`
// that predates spec-close-state.js surfaces related specs exactly as before.
let closeState = null;
try {
  closeState = require('./spec-close-state');
} catch {
  /* older generation — no reminder */
}

// Decision cards. Guarded like the rest: a `.frame/bin/` that predates
// decision-cards.js delivers spec history exactly as before, and so does a
// project with no card file — readCards answers it with empty lists.
let decisionCards = null;
try {
  decisionCards = require('./decision-cards');
} catch {
  /* older generation — no cards */
}

/** The card CLI, as a path an agent can run from the project root. */
function decisionCliPath(root) {
  const local = path.join(__dirname, 'decision.js');
  if (fs.existsSync(local)) {
    const rel = toPosix(path.relative(root, local));
    if (rel && !rel.startsWith('..')) return rel;
  }
  return '.frame/bin/decision.js';
}

/**
 * The current spec-less cards that name `rel`, newest first. Spec cards are
 * never delivered by a hook (decision-cards-core D6): the spec's own history
 * line already reaches the agent, and whether a card replaces it is left to
 * the final measurement.
 */
function fileCards(root, rel) {
  if (!decisionCards) return [];
  try {
    const { current } = decisionCards.readCards(root);
    return decisionCards.cardsForFile(decisionCards.specLessCards(current), rel);
  } catch {
    return [];
  }
}

/**
 * Which host this record came from. The activity registry keeps one value per
 * CLI so "Codex hooks are installed but nothing has ever run" is answerable
 * from the log alone — which is how Frame detects an untrusted Codex hook,
 * since Codex writes nothing to disk when it declines to run one.
 */
let hookCli = null;

/** Called once, from the entry point, with the parsed payload. */
function setHookCli(payload) {
  hookCli = (vocab && vocab.cliOf(payload, process.argv[3])) || 'claude-code';
}

function hookHost() {
  return hookCli === 'codex' ? 'codex-hook' : 'claude-hook';
}

function note(root, ev, fields) {
  if (!activity || !root) return;
  try {
    activity.appendSync(activity.projectKey(root), {
      ev,
      kind: ev === 'hint.injected' ? 'action' : 'suppression',
      host: hookHost(),
      ...fields
    });
  } catch {
    /* the record is never worth a failed tool call */
  }
}

/** Record a quiet path and return, so call sites stay single-expression. */
function quiet(root, mode, reason, rel) {
  note(root, 'hint.quiet', rel ? { mode, reason, path: rel } : { mode, reason });
}

// ─── output ───────────────────────────────────────────────

function emit(eventName, context, ctx) {
  if (!context) {
    if (ctx) quiet(ctx.root, ctx.mode, 'no-context');
    return;
  }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: eventName, additionalContext: context }
  }));
}

const RELAY_INSTRUCTION = 'If this history affects your work, relay it to the user in 1-2 sentences before changing the file ' +
  '(what was done here before, how it shapes your change); if it does not, stay silent about it. Do not repeat this for the same file.';

/**
 * How a fix to a finished spec's work records itself. Test-time fixes used to
 * reach the code and nothing else, so the next agent read a digest describing
 * the work before the fix. Said at two moments: the prompt that asks for the
 * fix, when it names a finished spec, and an edit to a file whose newest
 * record is one — the second alone missed every fix made through the shell,
 * because this hook is registered on Edit and Write only. Whether a change is
 * such a fix is the agent's call; the sentence is conditional on purpose.
 */
function fixInstruction(slugs, subject = 'edit') {
  const list = [].concat(slugs);
  const where = list.length === 1
    ? `.frame/specs/${list[0]}/outcome.md`
    : 'the outcome.md of the spec it touches';
  return `If this ${subject} fixes or adjusts the finished work of ${list.join(' or ')}, record it in the same commit: ` +
    `a "## Fix — <title>" entry in ${where}, and, if it changes a decision the digest records, the digest updated in ` +
    'place with a "Revised <YYYY-MM-DD>: …" line before its Chain line. Ask the user if you are not sure whether it does.';
}

// ─── pre-edit mode ────────────────────────────────────────

function formatEntry(r, full) {
  const task = r.task ? ` ${r.task}` : '';
  const marks = [];
  if (r.flags.current) marks.push('current');
  if (r.flags.stale) marks.push('STALE: file changed after this spec closed — verify against the code');
  if (r.flags.inflight) marks.push('IN-FLIGHT RIGHT NOW — coordinate before touching');
  if (r.flags.movedTo) marks.push(`moved to ${r.flags.movedTo}`);
  const mark = marks.length ? ` [${marks.join(' · ')}]` : '';
  if (!full) return `- ${r.date || '?'} ${r.slug}${task}${mark}`;
  return `- ${r.date || '?'} ${r.slug}${task} — ${r.line}${mark}\n  deep read: ${r.deep}`;
}

function preEdit(input) {
  const root = resolveRoot(input.cwd);
  const index = readJson(path.join(root, '.frame', 'index', 'spec-index.json'));
  if (!index || !index.files) return quiet(root, 'pre-edit', 'no-index'); // no index → exactly today's behavior

  // Claude Code passes a path; Codex passes a patch envelope naming one or
  // more. Spec history is per file, so the first target is the one to speak
  // about — a patch touching several is rare and the rest still get their
  // history the next time one of them is edited alone.
  // A direct path field still wins: this script read `file_path` without ever
  // consulting `tool_name`, and a payload that carries the path but no tool
  // name — an older host, a hand-rolled hook — must keep working exactly as
  // it did. The vocabulary is the fallback that adds Codex, not a new
  // precondition on Claude Code's path.
  const ti = input.tool_input || {};
  const rawPath = ti.file_path || ti.notebook_path
    || (vocab ? vocab.editPaths(input.tool_name, ti)[0] : null);
  if (!rawPath) return quiet(root, 'pre-edit', 'no-path');
  let rel = path.isAbsolute(rawPath) ? path.relative(root, rawPath) : rawPath;
  rel = toPosix(rel).replace(/^\.\//, '');
  if (rel.startsWith('..')) return quiet(root, 'pre-edit', 'outside-project');
  if (rel.startsWith('.frame/')) return quiet(root, 'pre-edit', 'meta-path', rel);

  const hist = index.files[rel] || [];
  // Looked up before the no-history return: a decision recorded outside any
  // spec names files no spec ever touched.
  const cards = fileCards(root, rel);
  if (!hist.length && !cards.length) return quiet(root, 'pre-edit', 'no-history', rel);

  cleanupState(root);
  const sessionId = input.session_id;
  const state = loadState(root, sessionId);
  const freshCards = cards.filter((c) => !state.cards.includes(c.id));
  const historyDue = hist.length > 0 && !state.files.includes(rel);
  if (!historyDue && !freshCards.length) return quiet(root, 'pre-edit', 'session-dedup', rel); // once per file per session
  if (!hist.length) quiet(root, 'pre-edit', 'no-history', rel);
  else if (!historyDue) quiet(root, 'pre-edit', 'session-dedup', rel);

  const signalMode = process.env.FRAME_SPEC_HINT_MODE === 'signal';
  const history = historyDue ? historyBlock(root, rel, hist, signalMode) : null;
  const cardsOut = freshCards.length
    ? cardBlock(root, rel, freshCards, signalMode, history ? history.length + 2 : 0)
    : null;

  if (historyDue) state.files.push(rel);
  if (cardsOut) state.cards.push(...cardsOut.sent.map((c) => c.id));
  saveState(root, sessionId, state);

  if (history) note(root, 'hint.injected', { mode: 'pre-edit', path: rel, specs: new Set(hist.map((r) => r.slug)).size });
  if (cardsOut) note(root, 'hint.injected', { mode: 'decision-edit', path: rel, cards: cardsOut.sent.length });
  const context = [history, cardsOut && cardsOut.text].filter(Boolean).join('\n\n');
  emit('PreToolUse', context, { root, mode: 'pre-edit' });
}

const CARD_RELAY = 'These are decisions recorded for this file. Respect them; to overturn one, say so to the user first ' +
  'and record a card that supersedes it. Do not repeat this for the same card.';

/**
 * The cards block for a pre-edit payload, or null when nothing fits. 1–2
 * cards go in full, 3 or more as one line each plus the command that prints
 * them whole — the same budget rule as spec history. `used` is what the
 * history block already takes of the host's inline cap: cards are what gives
 * way, from the end, and a card left out stays unmarked for a later edit.
 */
function cardBlock(root, rel, cards, signalMode, used) {
  const cli = decisionCliPath(root);
  if (signalMode) {
    return fitCards(cards, used, (list) =>
      `This file has ${list.length} recorded decision card(s). Before editing, run: node ${cli} related --files ${rel}`);
  }
  return fitCards(cards, used, (list, full) =>
    `Recorded decisions for ${rel} (newest first):\n${cardLines(cli, list, full)}\n${CARD_RELAY}`);
}

/** Cards as lines: in full, or one line each plus the command that prints them whole. */
function cardLines(cli, list, full) {
  return (full
    ? list.map((c) => decisionCards.renderCard(c))
    : [...list.map((c) => decisionCards.renderCard(c, { full: false })), `Full cards: node ${cli} list`]
  ).join('\n');
}

/**
 * The most of `cards` that `render(list, full)` fits into what the host
 * inlines, less `used`: `{ sent, text }`, or null when not even one card
 * fits. Depth gives way before cards do — every card as one line beats fewer
 * cards in full — and a card left out is the caller's to leave unmarked.
 */
function fitCards(cards, used, render) {
  const budget = inlineBudget() - used;
  for (let n = cards.length; n >= 1; n -= 1) {
    const sent = cards.slice(0, n);
    for (const full of n <= 2 ? [true, false] : [false]) {
      const text = render(sent, full);
      if (text.length <= budget) return { sent, text };
    }
  }
  return null;
}

/** The spec-history block for a pre-edit payload — the text this hook has always sent. */
function historyBlock(root, rel, hist, signalMode) {
  const cli = contextCliPath(root);
  const specCount = new Set(hist.map(r => r.slug)).size;

  let body;
  if (signalMode) {
    body = `This file has spec history (${hist.length} record(s) from ${specCount} spec(s)). ` +
      `Before editing, run: node ${cli} --file ${rel}`;
  } else if (hist.length <= 2) {
    body = hist.map(r => formatEntry(r, true)).join('\n');
  } else {
    body = hist.map(r => formatEntry(r, false)).join('\n') +
      `\nFull history: node ${cli} --file ${rel}`;
  }

  // The fix rule rides only on a finished spec's file, and not in signal mode,
  // which is one pointer line by contract.
  const newest = hist[hist.length - 1];
  const fix = !signalMode && newest && newest.phase === 'done' && !(newest.flags && newest.flags.inflight)
    ? `\n${fixInstruction(newest.slug, 'edit')}` : '';

  return `Spec history for ${rel} (oldest first — the newest entry is the current truth):\n${body}\n${RELAY_INSTRUCTION}${fix}`;
}

// ─── prompt mode ──────────────────────────────────────────

/**
 * How much this host inlines, less the margin docs-hint.js keeps. Only the
 * combined payload is held to it: related specs alone are sent as they
 * always were.
 */
function inlineBudget() {
  return (vocab ? vocab.inlineCap(hookCli) : 2000) - 20;
}

/**
 * The close reminder for this prompt, or null. The helper decides everything
 * — closed by this session, not orchestrated, not yet said this session,
 * which includes "docs-hint.js already said it on a tool call"; this records
 * what it reports and hands back the line.
 */
function closeReminder(root, input) {
  if (!closeState) return null;
  const out = closeState.reminder(root, input.session_id);
  if (!out) return null;
  for (const reason of out.reasons || []) quiet(root, 'spec-close', reason);
  if (!out.line) return null;
  note(root, 'hint.injected', { mode: 'spec-close', specs: out.slugs.length });
  return out.line;
}

/**
 * Specs related to this prompt that the session has not been shown, or null
 * with the reason already recorded. Nothing is marked as shown here: only
 * the lines that are actually sent are, and that is the caller's to know.
 */
function freshTopics(root, input) {
  const index = readJson(path.join(root, '.frame', 'index', 'spec-index.json'));
  if (!index || !index.topics) return quiet(root, 'prompt', 'no-topics') || null;

  const words = tokenize(input.prompt || '');
  if (!words.length) return quiet(root, 'prompt', 'no-words') || null;

  // Document frequency per token → rare matches count double, so a single
  // specific word ("telemetry") clears the threshold while a generic one
  // ("panel") alone does not.
  const df = new Map();
  const specTokens = new Map();
  for (const [slug, t] of Object.entries(index.topics)) {
    const toks = new Set([
      ...tokenize(slug), ...tokenize(t.title), ...t.keywords.flatMap(tokenize),
      ...t.paths.flatMap(p => tokenize(path.basename(p, path.extname(p))))
    ]);
    specTokens.set(slug, toks);
    for (const tok of toks) df.set(tok, (df.get(tok) || 0) + 1);
  }
  const nSpecs = specTokens.size || 1;
  const query = [...new Set(words)];
  const scored = [];
  for (const [slug, toks] of specTokens) {
    let score = 0;
    for (const q of query) {
      if (!toks.has(q)) continue;
      score += (df.get(q) <= Math.max(3, Math.ceil(nSpecs * 0.15))) ? 2 : 1;
    }
    if (score >= 2) scored.push({ slug, score });
  }
  if (!scored.length) return quiet(root, 'prompt', 'no-match') || null;
  scored.sort((a, b) => b.score - a.score);

  const state = loadState(root, input.session_id);
  const fresh = scored.filter(s => !state.topics.includes(s.slug)).slice(0, MAX_TOPIC_HITS);
  if (!fresh.length) return quiet(root, 'prompt', 'no-stale-free-match') || null;
  return { index, state, fresh };
}

function topicBlock(index, list) {
  const lines = list.map(({ slug }) => {
    const t = index.topics[slug];
    const sup = t.supersedes ? ` (supersedes ${t.supersedes})` : '';
    return `- ${slug} (${t.phase})${sup} — ${t.digestLine || t.title} → .frame/specs/${slug}/`;
  });
  // Only the finished ones among the specs actually sent: a spec dropped for
  // the budget is not named, and an in-flight spec's work is not done yet.
  const finished = list.map(({ slug }) => slug).filter((slug) => index.topics[slug].phase === 'done');
  const fix = finished.length ? `\n${fixInstruction(finished, 'request')}` : '';
  return `Specs related to this request (from the project's spec archive):\n${lines.join('\n')}\n` +
    'If relevant, read each spec\'s digest.md before working where it has one, and its chain (spec.md → plan.md → outcome.md) when you need the detail; let the user know which prior decisions apply.' +
    fix;
}

// A prompt hears at most this many recorded decisions (decision-cards-core D5).
const MAX_PROMPT_CARDS = 2;

const PROMPT_CARD_RELAY = 'If one of these decisions bears on this request, respect it — or tell the user before overturning it, ' +
  'and record a card that supersedes it; if none does, stay silent about them.';

/**
 * The spec-less cards this prompt matches strongly — score 3 or more on the
 * same rare/common weights as specs, the document frequency taken over every
 * current card — that this session has not been shown, best first, at most
 * two. Empty for a project with no card file, which is what keeps its
 * prompts on the path below byte for byte.
 */
function promptCards(root, input) {
  if (!decisionCards) return [];
  try {
    const { current } = decisionCards.readCards(root);
    if (!current.length) return [];
    const hits = decisionCards.scoreCards(decisionCards.specLessCards(current), input.prompt || '', { corpus: current });
    if (!hits.length) return [];
    const seen = loadState(root, input.session_id).cards;
    return hits.map((h) => h.card).filter((c) => !seen.includes(c.id)).slice(0, MAX_PROMPT_CARDS);
  } catch {
    return [];
  }
}

function promptMode(input) {
  const root = resolveRoot(input.cwd);
  // Owed whatever the prompt is about, so it is asked before any of the
  // topic paths can return — a prompt with no searchable word still gets it.
  const reminder = closeReminder(root, input);
  const topics = freshTopics(root, input);
  const cards = promptCards(root, input);
  if (cards.length) return promptWithCards(root, input, reminder, topics, cards);
  if (!topics) {
    if (reminder) emit('UserPromptSubmit', reminder, { root, mode: 'prompt' });
    return;
  }

  // The reminder goes first and whole. If the two together would pass what
  // the host inlines, related specs are dropped from the end — and left
  // unmarked, so they come back on a later prompt instead of being lost.
  const { index, state, fresh } = topics;
  let sent = fresh;
  if (reminder) {
    const budget = inlineBudget();
    while (sent.length && `${reminder}\n\n${topicBlock(index, sent)}`.length > budget) sent = sent.slice(0, -1);
    if (!sent.length) {
      quiet(root, 'prompt', 'no-context');
      return emit('UserPromptSubmit', reminder, { root, mode: 'prompt' });
    }
  }

  cleanupState(root);
  state.topics.push(...sent.map(s => s.slug));
  saveState(root, input.session_id, state);
  note(root, 'hint.injected', { mode: 'prompt', specs: sent.length });
  const block = topicBlock(index, sent);
  emit('UserPromptSubmit', reminder ? `${reminder}\n\n${block}` : block, { root, mode: 'prompt' });
}

/**
 * The prompt path when recorded decisions match. Everything above it is sent
 * exactly as it would be without them — the close reminder whole, related
 * specs trimmed against it as before — and the cards come last and give way
 * first: they fill what is left under the host's inline cap, in full or one
 * line each, and a card that does not fit stays unmarked for a later prompt.
 */
function promptWithCards(root, input, reminder, topics, cards) {
  const state = topics ? topics.state : loadState(root, input.session_id);

  let sent = topics ? topics.fresh : [];
  if (topics && reminder) {
    const budget = inlineBudget();
    while (sent.length && `${reminder}\n\n${topicBlock(topics.index, sent)}`.length > budget) sent = sent.slice(0, -1);
    if (!sent.length) quiet(root, 'prompt', 'no-context');
  }
  const base = [reminder, sent.length ? topicBlock(topics.index, sent) : null].filter(Boolean).join('\n\n');

  const cli = decisionCliPath(root);
  const fitted = fitCards(cards, base ? base.length + 2 : 0, (list, full) =>
    `Recorded decisions that may apply (from the project's decision cards):\n${cardLines(cli, list, full)}\n${PROMPT_CARD_RELAY}`);
  if (!fitted) quiet(root, 'decision-prompt', 'no-context');

  if (!sent.length && !fitted) {
    if (reminder) emit('UserPromptSubmit', reminder, { root, mode: 'prompt' });
    return;
  }

  cleanupState(root);
  if (sent.length) state.topics.push(...sent.map((s) => s.slug));
  if (fitted) state.cards.push(...fitted.sent.map((c) => c.id));
  saveState(root, input.session_id, state);
  if (sent.length) note(root, 'hint.injected', { mode: 'prompt', specs: sent.length });
  if (fitted) note(root, 'hint.injected', { mode: 'decision-prompt', cards: fitted.sent.length });
  emit('UserPromptSubmit', [base, fitted && fitted.text].filter(Boolean).join('\n\n'), { root, mode: 'prompt' });
}

// ─── main (never break) ───────────────────────────────────

try {
  const mode = process.argv[2];
  const input = JSON.parse(readStdin() || '{}');
  setHookCli(input);
  if (mode === 'pre-edit') preEdit(input);
  else if (mode === 'prompt') promptMode(input);
} catch { /* silence is the contract */ }

// Deliberately `exitCode`, not `process.exit(0)`: an explicit exit tears the
// process down before a large stdout write has drained, and stdout here is a
// pipe whose buffer is around 8 KB. Today's payloads sit well under that —
// the widest file in this repo carries 15 records, and compact mode renders
// them in under 1 KB — but this hook reads the index as it finds it, and only
// the current builder caps `digestLine`, so nothing here bounds the
// prompt-mode payload. The same
// pattern did truncate docs-hint.js mid-string, and the host receives the
// result as unparseable JSON rather than as an error. Setting the code and
// letting node flush is the same never-break guarantee without that edge;
// nothing above holds the event loop open.
