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
 *              spec history at the moment of intent (never on Grep/Read:
 *              exploration must stay injection-free).
 *   prompt     UserPromptSubmit hook — score the user's prompt against the
 *              topic catalog, surface up to 3 related specs.
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
  return (st && Array.isArray(st.files) && Array.isArray(st.topics)) ? st : { files: [], topics: [] };
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

  const hist = index.files[rel];
  if (!hist || !hist.length) return quiet(root, 'pre-edit', 'no-history', rel);

  cleanupState(root);
  const sessionId = input.session_id;
  const state = loadState(root, sessionId);
  if (state.files.includes(rel)) return quiet(root, 'pre-edit', 'session-dedup', rel); // once per file per session
  state.files.push(rel);
  saveState(root, sessionId, state);

  const cli = contextCliPath(root);
  const signalMode = process.env.FRAME_SPEC_HINT_MODE === 'signal';
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

  note(root, 'hint.injected', { mode: 'pre-edit', path: rel, specs: specCount });
  emit('PreToolUse', `Spec history for ${rel} (oldest first — the newest entry is the current truth):\n${body}\n${RELAY_INSTRUCTION}`, { root, mode: 'pre-edit' });
}

// ─── prompt mode ──────────────────────────────────────────

function promptMode(input) {
  const root = resolveRoot(input.cwd);
  const index = readJson(path.join(root, '.frame', 'index', 'spec-index.json'));
  if (!index || !index.topics) return quiet(root, 'prompt', 'no-topics');

  const words = tokenize(input.prompt || '');
  if (!words.length) return quiet(root, 'prompt', 'no-words');

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
  if (!scored.length) return quiet(root, 'prompt', 'no-match');
  scored.sort((a, b) => b.score - a.score);

  const sessionId = input.session_id;
  const state = loadState(root, sessionId);
  const fresh = scored.filter(s => !state.topics.includes(s.slug)).slice(0, MAX_TOPIC_HITS);
  if (!fresh.length) return quiet(root, 'prompt', 'no-stale-free-match');
  cleanupState(root);
  state.topics.push(...fresh.map(s => s.slug));
  saveState(root, sessionId, state);

  const lines = fresh.map(({ slug }) => {
    const t = index.topics[slug];
    const sup = t.supersedes ? ` (supersedes ${t.supersedes})` : '';
    return `- ${slug} (${t.phase})${sup} — ${t.digestLine || t.title} → .frame/specs/${slug}/`;
  });
  note(root, 'hint.injected', { mode: 'prompt', specs: fresh.length });
  emit('UserPromptSubmit',
    `Specs related to this request (from the project's spec archive):\n${lines.join('\n')}\n` +
    'If relevant, read the spec chain (spec.md → plan.md → outcome.md) before working, and let the user know which prior decisions apply.',
    { root, mode: 'prompt' });
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
// them in under 1 KB — but `digestLine` is whatever the first body line of a
// digest happens to be, so nothing bounds the prompt-mode payload. The same
// pattern did truncate docs-hint.js mid-string, and the host receives the
// result as unparseable JSON rather than as an error. Setting the code and
// letting node flush is the same never-break guarantee without that edge;
// nothing above holds the event loop open.
