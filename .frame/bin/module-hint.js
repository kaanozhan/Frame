#!/usr/bin/env node
/**
 * Module map hint — Claude Code hook entry
 *
 * The third piece of the code-map layer. `update-structure.js` builds
 * `STRUCTURE.json`'s intentIndex, `find-module.js` queries it from the CLI,
 * and this delivers that same answer *deterministically*: a PreToolUse hook
 * on the search tools, so an agent grepping for a concept gets the exact
 * files alongside its own results — with zero reliance on it remembering
 * AGENTS.md's "before manual grep/glob, run find-module".
 *
 * Why a hook and not advice: measured over this repo's own transcripts,
 * find-module ran 18 times against 937 searches (~2%). The instruction is
 * correct and the index is fresh; only the trigger was missing.
 *
 * STRUCTURE.json is ~294 KB (~73k tokens) and must never enter a context
 * window. It is read here, in a separate process, and only the ~180-token
 * answer is injected — exactly the property find-module was written for.
 *
 * Hard contract (same as scripts/spec-hint.js):
 *   - NEVER block, NEVER break: any failure → exit 0, empty output. The host
 *     is a tool call; a hook error must never surface as a tool error.
 *   - Read-only: consumes STRUCTURE.json as-is, never rebuilds, never runs
 *     git. `find-module.js`'s staleness banner deliberately does NOT apply
 *     here — it shells out to git and can spawn update-structure, which
 *     would blow the per-call budget many times over.
 *   - Fast bail: this fires on every Bash call, the most common tool. A
 *     command that is not a search returns before STRUCTURE.json is opened.
 *   - Session dedup: one injection per matched concept per session; state in
 *     .frame/runtime/module-hint/<session_id>.json, stale files cleaned up
 *     after 7 days.
 *   - No imports from siblings: same rule spec-hint.js states — the hook must
 *     not pull in builder code paths that could rebuild or slow down. The
 *     intentIndex lookup below is a deliberate, trimmed copy of
 *     find-module.js's, not a require of it.
 *
 * Dependency-free plain node; ships to user projects' .frame/bin/.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const STATE_DIR_REL = path.join('.frame', 'runtime', 'module-hint');
const STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_MODULES = 8;     // output ceiling: a hint, not a file listing
const MAX_CANDIDATES = 3;  // how many words from one search we bother to try

// ─── tiny utils ───────────────────────────────────────────

function toPosix(p) { return String(p).split(path.sep).join('/'); }

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// ─── project root + meta paths (read-only) ────────────────

function resolveRoot(hookCwd) {
  if (process.env.FRAME_PROJECT_ROOT) return path.resolve(process.env.FRAME_PROJECT_ROOT);
  if (hookCwd && fs.existsSync(path.join(hookCwd, '.frame'))) return hookCwd;
  if (path.basename(__dirname) === 'bin' && path.basename(path.dirname(__dirname)) === '.frame') {
    return path.dirname(path.dirname(__dirname));
  }
  return process.cwd();
}

/** `.frame/<name>` for a migrated project, the root while one is unmigrated. */
function resolveMetaPath(root, name) {
  const overlay = path.join(root, '.frame', name);
  if (fs.existsSync(overlay)) return overlay;
  const legacy = path.join(root, name);
  if (fs.existsSync(legacy)) return legacy;
  return overlay;
}

function finderCliPath(root) {
  const local = path.join(__dirname, 'find-module.js');
  if (fs.existsSync(local)) return toPosix(path.relative(root, local)) || 'find-module.js';
  return '.frame/bin/find-module.js';
}

// ─── session dedup state ──────────────────────────────────

function stateFile(root, sessionId) {
  const safe = String(sessionId || 'no-session').replace(/[^\w-]/g, '_').slice(0, 80);
  return path.join(root, STATE_DIR_REL, `${safe}.json`);
}

function loadState(root, sessionId) {
  const st = readJson(stateFile(root, sessionId));
  return (st && Array.isArray(st.concepts)) ? st : { concepts: [] };
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
// Guarded exactly as spec-hint.js guards it: `.frame/bin/` is refreshed only
// on project init, so a generation predating activity-log.js must degrade to
// silence, not to an exception. Nothing here may write to stdout (it would
// corrupt the hook payload) or throw (the host is a tool call).

let activity = null;
try {
  activity = require('./activity-log');
} catch {
  /* older .frame/bin generation — no record, same behavior as before */
}

// Which CLI calls a tool what. Guarded for the same reason activity-log is:
// a `.frame/bin/` generation that predates it must degrade to the tool names
// this script used to hardcode, not to an exception.
let vocab = null;
try {
  vocab = require('./toolVocabulary');
} catch {
  /* older generation — the inline fallbacks below are the old behaviour */
}

function note(root, ev, fields) {
  if (!activity || !root) return;
  try {
    activity.appendSync(activity.projectKey(root), {
      ev,
      kind: ev === 'hint.injected' ? 'action' : 'suppression',
      host: 'claude-hook',
      mode: 'search',
      ...fields
    });
  } catch {
    /* the record is never worth a failed tool call */
  }
}

/** Record a quiet path and return, so call sites stay single-expression. */
function quiet(root, reason) {
  note(root, 'hint.quiet', { reason });
}

function emit(context) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: context }
  }));
}

// ─── what counts as a search, and what it is searching for ─

// Fast bail gate. This hook is registered on Bash, which is the most-used
// tool by a wide margin; anything that is not a search must cost one regex.
const SEARCH_CMD = /(?:^|[;&|(\n]\s*)(?:grep|rg|ag|ack|find)\s/;

// A search verb appearing *somewhere* in a command is not enough. Validated
// against 959 real search-looking commands from this repo's own transcripts:
// matching anywhere pulled patterns out of `node -e '…JS…'` bodies and
// heredoc payloads, yielding words like "readfilesync" and "pass" that would
// then be looked up as if they were concepts. Only a segment that *starts*
// with a search verb is a search, and a command carrying a heredoc is data,
// not a search — a wrong hint is worse than silence.
const SEGMENT_SPLIT = /[;\n]|&&|\|\|/;
const LEADING_SEARCH = /^\s*(?:grep|rg|ag|ack|find)\s/;

function searchSegments(cmd) {
  if (cmd.includes('<<')) return [];
  return cmd.split(SEGMENT_SPLIT).filter((s) => LEADING_SEARCH.test(s));
}

// Words that carry no concept: file extensions, shell/code noise. Kept short
// on purpose — over-filtering costs a hit, under-filtering costs a miss, and
// a miss is silent.
const NOISE = new Set(('js ts jsx tsx json md css html node npm git src test tests dist out lib bin tmp log ' +
  'true false null const let var function return async await require module exports import export ' +
  'the and for with from that this not all any new type name file path line text data code').split(' '));

/**
 * Pull the pattern operand out of one search segment (already known to start
 * with a search verb). Handles the shapes that actually occur: flags before
 * the pattern, single or double quotes, `-e`, and `find -name`. Anything it
 * cannot parse yields '' and the hook goes quiet — guessing wrong is worse
 * than staying silent.
 */
function extractPattern(seg) {
  const e = seg.match(/^\s*(?:grep|rg|ag|ack)\b.*?\s-e\s+(['"])(.*?)\1/);
  if (e) return e[2];
  const m = seg.match(/^\s*(?:grep|rg|ag|ack)\s+((?:-{1,2}[^\s'"]+\s+)*)(['"])(.*?)\2/);
  if (m) return m[3];
  const bare = seg.match(/^\s*(?:grep|rg|ag|ack)\s+((?:-{1,2}[^\s'"]+\s+)*)([^\s'"|;&]+)/);
  if (bare) return bare[2];
  const f = seg.match(/^\s*find\b.*?\s-i?name\s+(['"]?)([^'"\s]+)\1/);
  return f ? f[2] : '';
}

/**
 * A raw pattern (regex, glob, or plain word) → the concept words worth
 * looking up. Alternations are split, metacharacters dropped; what survives
 * is lowercase word-ish tokens long enough to mean something.
 */
function candidates(raw) {
  const out = [];
  for (const tok of String(raw || '').toLowerCase().split(/[^a-z0-9_-]+/)) {
    const w = tok.replace(/^[-_]+|[-_]+$/g, '');
    if (w.length < 3 || NOISE.has(w)) continue;
    if (!out.includes(w)) out.push(w);
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

function keywordsFrom(toolName, input) {
  const role = vocab ? vocab.roleOf(toolName) : (toolName === 'Grep' || toolName === 'Glob' ? 'search' : (toolName === 'Bash' ? 'shell' : null));
  if (role === 'search') {
    const pattern = vocab ? vocab.searchPattern(toolName, input) : (input.pattern || input.glob);
    return candidates(pattern || input.path || '');
  }
  if (role === 'shell') {
    const cmd = input.command || '';
    if (!SEARCH_CMD.test(cmd)) return null; // not a search — the fast bail
    const segs = searchSegments(cmd);
    if (!segs.length) return null;          // grep only *mentioned*, not run
    for (const seg of segs) {
      const words = candidates(extractPattern(seg));
      if (words.length) return words;
    }
    return [];
  }
  return [];
}

// ─── intentIndex lookup ───────────────────────────────────
//
// A trimmed copy of find-module.js's tiers — trimmed, not shared, per the
// no-sibling-imports rule above.
//
// Deliberately only the *curated* tiers: exact → synonym → partial, all of
// them keyed on intentIndex, which is hand-maintained in intent-map.json.
// find-module's fourth tier (scan every module's description, exports and
// IPC names) is left out on measured grounds: replayed over 1011 real search
// commands from this repo's transcripts, the curated tiers hit 297 times
// with usable answers (`claude-sessions`, `panel`, `implement`) while the
// deep tier hit 136 times almost entirely on noise — `kill` from a
// `pkill|killall` search, `process`, `focus`, and once on a half-typed
// `rchestrator`. A human running find-module asked for that fallback; an
// automatic hint that fires on it is worse than silence. The deep tier stays
// where it belongs, in the CLI.

function loadIntentMap() {
  const map = readJson(path.join(__dirname, 'intent-map.json'));
  if (!map) return {};
  delete map._comment;
  return map;
}

function lookup(structure, keyword) {
  const index = structure.intentIndex;
  if (!index) return null;

  for (const [feature, modules] of Object.entries(index)) {
    if (feature === keyword) return { feature, modules };
  }

  for (const [concept, entry] of Object.entries(loadIntentMap())) {
    const synonyms = (entry.synonyms || []).map((s) => String(s).toLowerCase());
    if (synonyms.includes(keyword) && index[concept]) {
      return { feature: `${concept} (synonym: "${keyword}")`, modules: index[concept] };
    }
  }

  for (const [feature, modules] of Object.entries(index)) {
    if (feature.includes(keyword) || keyword.includes(feature)) return { feature, modules };
  }

  return null;
}

function render(root, structure, hit, keyword) {
  const lines = [`Feature: ${hit.feature}`];
  for (const mod of hit.modules.slice(0, MAX_MODULES)) {
    const desc = mod.description ? ` — ${mod.description}` : '';
    lines.push(`  ${mod.file}${desc}`);
  }
  if (hit.modules.length > MAX_MODULES) {
    lines.push(`  … +${hit.modules.length - MAX_MODULES} more`);
  }

  const channels = [];
  for (const mod of hit.modules) {
    const info = (structure.modules || {})[mod.module];
    if (info && info.ipc) channels.push(...(info.ipc.listens || []), ...(info.ipc.emits || []));
  }
  const uniq = [...new Set(channels)];
  if (uniq.length) lines.push(`  IPC: ${uniq.slice(0, 12).join(', ')}${uniq.length > 12 ? ', …' : ''}`);

  return `Frame's module map already answers "${keyword}" (STRUCTURE.json intentIndex):\n${lines.join('\n')}\n` +
    `Start from these files rather than a broad scan; your search still runs. ` +
    `Full query: node ${finderCliPath(root)} ${keyword}`;
}

// ─── main (never break) ───────────────────────────────────

function searchMode(input) {
  const root = resolveRoot(input.cwd);

  const words = keywordsFrom(input.tool_name, input.tool_input || {});
  if (words === null) return;               // not a search: silent, unrecorded
  if (!words.length) return quiet(root, 'no-words');

  const structureFile = resolveMetaPath(root, 'STRUCTURE.json');
  const structure = readJson(structureFile);
  if (!structure || !structure.intentIndex) return quiet(root, 'no-index');

  let hit = null;
  let keyword = null;
  for (const w of words) {
    hit = lookup(structure, w);
    if (hit) { keyword = w; break; }
  }
  if (!hit) return quiet(root, 'no-match');

  const sessionId = input.session_id;
  const state = loadState(root, sessionId);
  if (state.concepts.includes(hit.feature)) return quiet(root, 'session-dedup');
  cleanupState(root);
  state.concepts.push(hit.feature);
  saveState(root, sessionId, state);

  note(root, 'hint.injected', { concept: keyword, modules: Math.min(hit.modules.length, MAX_MODULES) });
  emit(render(root, structure, hit, keyword));
}

try {
  const input = JSON.parse(readStdin() || '{}');
  if (process.argv[2] === 'search') searchMode(input);
} catch { /* silence is the contract */ }

// Deliberately `exitCode`, not `process.exit(0)`: an explicit exit tears the
// process down before a large stdout write has drained, and stdout here is a
// pipe with a buffer around 8 KB. REFERENCE.md is roughly twice that, so
// `process.exit(0)` truncated the payload mid-string and the host received
// unparseable JSON. Setting the code and letting node flush is the same
// never-break guarantee without the corruption; nothing above holds the
// event loop open.
