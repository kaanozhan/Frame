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
 *   - Read-only: never rebuilds the map, never runs Git, never touches the
 *     network. The only writes are its own session-dedup state and the
 *     activity record.
 *   - Only read-only helpers: `structure-read` (ownership, freshness),
 *     `structure-retrieval` (the shared engine, also used by find-module),
 *     `activity-log` and `toolVocabulary`. Nothing that builds, writes the
 *     map or spawns a process — test/module-hint.test.js checks the import
 *     closure.
 *   - Fast bail: this fires on every Bash call, the most common tool. A
 *     command that is not a search returns before any file is opened.
 *   - Bounded (STR-03): reads `lookup.json` (≤ 2 MiB) or, without a current
 *     one, compiles the map in memory only if it is ≤ 2 MiB; at most 8 files
 *     and 1,800 characters of context.
 *   - Session dedup: one delivery per answer per map revision; state in
 *     .frame/runtime/module-hint/<session_id>.json, stale files cleaned up
 *     after 7 days. Without a session id nothing is remembered.
 *
 * Dependency-free plain node; ships to user projects' .frame/bin/.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const STATE_DIR_REL = path.join('.frame', 'runtime', 'module-hint');
const STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_MODULES = 8;     // output ceiling: a hint, not a file listing
const MAX_CANDIDATES = 3;  // legacy: how many words from one search we bother to try
const MAX_CONTEXT_CHARS = 1800; // below Claude Code's ~2,000-character inline ceiling
const WORKER_BUDGET_MS = 25;    // connect + answer from the lifecycle worker, else read lookup.json

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

// Ownership and freshness come from the shared read contract (built-ins
// only, never writes). Guarded: a .frame/bin/ from before STR-02 lacks it,
// and a hook must never break over a missing sibling.
let structureRead = null;
try {
  structureRead = require('./structure-read');
} catch { /* older tooling: stay quiet */ }

// The shared retrieval engine (STR-03). Same guard: no engine, no hint.
let retrieval = null;
try {
  retrieval = require('./structure-retrieval');
} catch { /* older tooling: stay quiet */ }

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
  const st = readJson(stateFile(root, sessionId)) || {};
  return {
    concepts: Array.isArray(st.concepts) ? st.concepts : [],
    delivered: Array.isArray(st.delivered) ? st.delivered : [],
    lookedUp: Array.isArray(st.lookedUp) ? st.lookedUp : []
  };
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
  const f = seg.match(/^\s*find\b.*?\s-i?(?:name|path|wholename)\s+(['"]?)([^'"\s]+)\1/);
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

/**
 * The raw pattern of a search call: null when the call is not a search at
 * all (silent, unrecorded), '' when it is one with nothing usable in it.
 */
function patternFrom(toolName, input) {
  const role = vocab ? vocab.roleOf(toolName) : (toolName === 'Grep' || toolName === 'Glob' ? 'search' : (toolName === 'Bash' ? 'shell' : null));
  if (role === 'search') {
    const pattern = vocab ? vocab.searchPattern(toolName, input) : (input.pattern || input.glob);
    return String(pattern || input.path || '');
  }
  if (role === 'shell') {
    const cmd = input.command || '';
    if (!SEARCH_CMD.test(cmd)) return null; // not a search — the fast bail
    const segs = searchSegments(cmd);
    if (!segs.length) return null;          // grep only *mentioned*, not run
    for (const seg of segs) {
      const pattern = extractPattern(seg);
      if (pattern) return pattern;
    }
    return '';
  }
  return '';
}

function keywordsFrom(toolName, input) {
  const pattern = patternFrom(toolName, input);
  return pattern === null ? null : candidates(pattern);
}

// ─── legacy: intentIndex lookup ───────────────────────────
//
// The pre-STR-03 behavior, selectable as the rollback path: only the
// curated tiers (exact → synonym → partial on intentIndex), first keyword
// that hits. find-module's deep tier stays out on measured grounds:
// replayed over 1011 real search commands from this repo's transcripts, the
// curated tiers hit 297 times with usable answers while the deep tier hit
// 136 times almost entirely on noise (`kill`, `process`, `focus`). The
// lookup itself lives in structure-retrieval.legacyRetrieve.

function loadIntentMap() {
  const map = readJson(path.join(__dirname, 'intent-map.json'));
  if (!map) return {};
  delete map._comment;
  return map;
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

/** project.retrieval.engine, else the shipped default; anything else is the default. */
function engineFor(root) {
  const config = readJson(path.join(root, '.frame', 'config.json'));
  const configured = config && config.project && config.project.retrieval && config.project.retrieval.engine;
  return retrieval.ENGINES.includes(configured) ? configured : retrieval.DEFAULT_ENGINE;
}

let rootReal = null;
/** A hinted file must be a regular file inside the project right now. */
function existsInProject(root, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) return false;
  try {
    rootReal = rootReal || fs.realpathSync(root);
    const real = fs.realpathSync(path.join(root, rel));
    if (real !== rootReal && !real.startsWith(rootReal + path.sep)) return false;
    return fs.statSync(real).isFile();
  } catch {
    return false;
  }
}

function legacyMode(root, input, descriptor) {
  const words = keywordsFrom(input.tool_name, input.tool_input || {});
  if (!words.length) return quiet(root, 'no-words');
  const structure = readJson(structureRead.resolveReadPath(root));
  if (!structure || !structure.intentIndex) return quiet(root, 'no-index');
  const result = retrieval.legacyRetrieve(structure, loadIntentMap(), { mode: 'hook', words });
  if (!result.groups.length) return quiet(root, 'no-match');
  const hit = result.groups[0];
  const keyword = result.keyword;

  const state = loadState(root, input.session_id);
  if (state.concepts.includes(hit.feature)) return quiet(root, 'session-dedup');
  cleanupState(root);
  state.concepts.push(hit.feature);
  saveState(root, input.session_id, state);

  note(root, 'hint.injected', { concept: keyword, modules: Math.min(hit.modules.length, MAX_MODULES) });
  emit(render(root, structure, hit, keyword));
}

/** The index to answer from: a current lookup.json, else the map compiled in memory. */
function loadIndex(root) {
  const cap = retrieval.LIMITS.hookIndexBytes;
  const loaded = retrieval.loadLookup(root, { maxBytes: cap, curationPath: path.join(__dirname, 'intent-map.json') });
  if (loaded.state === 'fresh') return { index: loaded.index };
  if (loaded.state === 'oversize') return { reason: 'index-oversize' };
  const compiled = retrieval.indexFromMap(root, { maxBytes: cap, curationPath: path.join(__dirname, 'intent-map.json') });
  if (compiled.state === 'compiled') return { index: compiled.index };
  return { reason: compiled.state === 'oversize' ? 'index-oversize' : 'no-index' };
}

function fingerprint(paths) {
  let h = 0;
  for (const ch of paths.join('\n')) h = (Math.imul(h, 31) + ch.codePointAt(0)) | 0;
  return (h >>> 0).toString(16);
}

/** One line of the query, safe to show and to paste as a shell argument. */
function shownQuery(pattern) {
  return pattern.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80);
}

function shellQuote(text) {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

// ─── find-module awareness (STR-03b) ──────────────────────
//
// An agent told to run find-module before grepping often greps right after
// it anyway, and the hint then repeats the answer find-module just gave.
// The hook already sees every Bash call: a find-module call is remembered
// for the session, and a later search for the same thing stays quiet.

const FIND_MODULE_CALL = /^\s*node\s+(?:"[^"]*find-module\.js"|'[^']*find-module\.js'|\S*find-module\.js)\s+(.+)$/;
const MAX_LOOKED_UP = 64;

/** The query of a `node …/find-module.js <query>` call on Bash, else null. */
function findModuleQuery(toolName, input) {
  const role = vocab ? vocab.roleOf(toolName) : (toolName === 'Bash' ? 'shell' : null);
  if (role !== 'shell') return null;
  const cmd = String((input && input.command) || '');
  if (!cmd.includes('find-module') || cmd.includes('<<')) return null;
  for (const seg of cmd.split(SEGMENT_SPLIT)) {
    const m = FIND_MODULE_CALL.exec(seg.split('|')[0]);
    if (!m) continue;
    const words = [];
    const tokens = m[1].match(/"[^"]*"|'[^']*'|\S+/g) || [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t === '--list') return null;
      if (t === '--limit' || t === '--retrieval') { i++; continue; }
      if (t.startsWith('--')) continue;
      words.push(t.replace(/^["']|["']$/g, ''));
    }
    if (words.length) return words.join(' ');
  }
  return null;
}

/** The same normalized form for a find-module query and a search pattern. */
function lookupKey(text) {
  return retrieval.fold(String(text)).replace(/[^\p{L}\p{N}_-]+/gu, ' ').trim();
}

function recordLookup(root, sessionId, query, revision) {
  if (!sessionId) return;
  const state = loadState(root, sessionId);
  const entry = { q: lookupKey(query), rev: revision || null };
  if (!entry.q || state.lookedUp.some((e) => e.q === entry.q && e.rev === entry.rev)) return;
  cleanupState(root);
  state.lookedUp.push(entry);
  if (state.lookedUp.length > MAX_LOOKED_UP) state.lookedUp.splice(0, state.lookedUp.length - MAX_LOOKED_UP);
  saveState(root, sessionId, state);
}

function renderV2(root, result, pattern, descriptor) {
  const q = shownQuery(pattern);
  const evidence = [...new Set(result.answer.map((c) => c.evidence))].join(', ');
  const verified = descriptor.freshness === 'fresh';
  const head = verified
    ? `Frame's module map points to these files for "${q}" (${evidence}):`
    : `Frame's module map has candidates for "${q}" (${evidence}) — map not verified recently (${descriptor.freshness}):`;
  const withLine = result.answer.some((c) => c.line);
  const tail = `Open ${withLine ? 'it at the line shown' : 'these files'} directly; grep is for searching inside a file. ` +
    `Your search still runs. Full query: node ${finderCliPath(root)} ${shellQuote(q)}`;
  const moreLine = `  … more — ${finderCliPath(root)} lists them`;
  // head \n lines… \n [more \n] tail — the "more" line is always reserved
  const total = (ls) => head.length + 1 + ls.reduce((n, l) => n + l.length + 1, 0) + moreLine.length + 1 + tail.length;
  const lines = [];
  const answer = result.answer.slice(0, MAX_MODULES);
  for (let i = 0; i < answer.length; i++) {
    const c = answer[i];
    const share = Math.floor((MAX_CONTEXT_CHARS - total(lines)) / (answer.length - i)) - 1;
    const base = `  ${c.path}${c.line ? `:${c.line} ${c.symbol}` : ''}`;
    if (share < base.length) break; // stop on a whole candidate, never a cut path
    const room = share - base.length - 3;
    const desc = c.description && room > 12
      ? ` — ${c.description.length > room ? `${c.description.slice(0, room - 1)}…` : c.description}`
      : '';
    lines.push(base + desc);
  }
  if (!lines.length) return null;
  if (result.answer.length > lines.length || result.truncated) lines.push(moreLine);
  return `${head}\n${lines.join('\n')}\n${tail}`;
}

/**
 * Ask the running lifecycle worker (STR-03b): one JSON line over the local
 * socket it announced in lookup.endpoint. Resolves null — and the caller
 * reads lookup.json as before — when there is no live worker of the same
 * algorithm, or no answer within WORKER_BUDGET_MS. Local IPC only: the
 * address is a socket path, never a host or port.
 */
function askWorker(root, query) {
  const endpoint = readJson(retrieval.lookupEndpointPath(root));
  if (!endpoint || endpoint.v !== retrieval.LOOKUP_PROTOCOL || endpoint.algorithm !== retrieval.ALGORITHM
    || typeof endpoint.address !== 'string' || !Number.isInteger(endpoint.pid)) return Promise.resolve(null);
  try {
    process.kill(endpoint.pid, 0);
  } catch (e) {
    if (e.code !== 'EPERM') return Promise.resolve(null); // the announced worker is gone
  }
  let net;
  try {
    net = require('net');
  } catch {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let done = false;
    let buffer = '';
    let socket = null;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch { /* already closed */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), WORKER_BUDGET_MS);
    try {
      socket = net.createConnection({ path: endpoint.address });
    } catch {
      return finish(null);
    }
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify({ v: retrieval.LOOKUP_PROTOCOL, query, mode: 'hook', limit: MAX_MODULES })}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      try {
        const reply = JSON.parse(buffer.slice(0, newline));
        finish(reply && reply.ok && reply.result ? reply : null);
      } catch {
        finish(null);
      }
    });
    socket.on('error', () => finish(null));
    socket.on('close', () => finish(null));
  });
}

async function v2Mode(root, input, descriptor) {
  const pattern = patternFrom(input.tool_name, input.tool_input || {});
  if (!pattern || !pattern.trim()) return quiet(root, 'no-words');
  // A scan that missed files: an answer could be the wrong one. Stay quiet.
  if (descriptor.coverage && descriptor.coverage !== 'complete') return quiet(root, 'map-incomplete');

  // find-module already answered this in the session, at this map revision
  if (input.session_id) {
    const seen = loadState(root, input.session_id).lookedUp;
    const q = lookupKey(pattern);
    if (seen.some((e) => e.q === q && e.rev === (descriptor.revision || null))) return quiet(root, 'already-looked-up');
  }

  // The running worker answers from memory; without one, read lookup.json.
  let result;
  let revisionKey;
  const fromWorker = await askWorker(root, pattern);
  if (fromWorker) {
    result = fromWorker.result;
    revisionKey = fromWorker.revision || 'worker';
    if (result.status === 'no-match') return quiet(root, fromWorker.weak ? 'ambiguous-weak' : 'no-match');
  } else {
    const { index, reason } = loadIndex(root);
    if (!index) return quiet(root, reason);
    const exists = (rel) => existsInProject(root, rel);
    result = retrieval.retrieve(index, pattern, { mode: 'hook', exists });
    if (result.status === 'no-match') {
      const weak = retrieval.retrieve(index, pattern, { mode: 'cli', limit: 1 });
      return quiet(root, weak.status === 'no-match' ? 'no-match' : 'ambiguous-weak');
    }
    revisionKey = index.revision || (index.source && JSON.stringify(index.source.signature)) || 'map';
  }

  const key = `${revisionKey}|${fingerprint(result.answer.map((c) => c.path))}`;
  const sessionId = input.session_id;
  if (sessionId) {
    const state = loadState(root, sessionId);
    if (state.delivered.includes(key)) return quiet(root, 'session-dedup');
    cleanupState(root);
    state.delivered.push(key);
    if (state.delivered.length > 256) state.delivered.splice(0, state.delivered.length - 256);
    saveState(root, sessionId, state);
  }

  const context = renderV2(root, result, pattern, descriptor);
  if (!context) return quiet(root, 'no-context');
  note(root, 'hint.injected', { concept: shownQuery(pattern), modules: result.answer.length });
  emit(context);
}

function searchMode(input) {
  const root = resolveRoot(input.cwd);

  // A find-module call is remembered (v2), never answered: it is the answer.
  const lookedUp = findModuleQuery(input.tool_name, input.tool_input || {});
  if (lookedUp !== null) {
    if (structureRead && retrieval && engineFor(root) !== 'legacy') {
      recordLookup(root, input.session_id, lookedUp, structureRead.readDescriptor(root).revision);
    }
    return;
  }

  if (patternFrom(input.tool_name, input.tool_input || {}) === null) return; // not a search: silent, unrecorded

  if (!structureRead || !retrieval) return quiet(root, 'no-index');
  const descriptor = structureRead.readDescriptor(root);
  // Changes are being applied: an answer from the old map could point at
  // files that just moved. Stay quiet until the worker catches up.
  if (descriptor.freshness === 'dirty') return quiet(root, 'map-dirty');

  if (engineFor(root) === 'legacy') return legacyMode(root, input, descriptor);
  return v2Mode(root, input, descriptor);
}

try {
  const input = JSON.parse(readStdin() || '{}');
  setHookCli(input);
  if (process.argv[2] === 'search') Promise.resolve(searchMode(input)).catch(() => { /* silence is the contract */ });
} catch { /* silence is the contract */ }

// Deliberately `exitCode`, not `process.exit(0)`: an explicit exit tears the
// process down before a large stdout write has drained, and stdout here is a
// pipe with a buffer around 8 KB. REFERENCE.md is roughly twice that, so
// `process.exit(0)` truncated the payload mid-string and the host received
// unparseable JSON. Setting the code and letting node flush is the same
// never-break guarantee without the corruption; nothing above holds the
// event loop open.
