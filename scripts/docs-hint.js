#!/usr/bin/env node
/**
 * Frame rules hint — Claude Code hook entry
 *
 * Delivers the parts of `.frame/docs/REFERENCE.md` an agent must comply with,
 * at the moment each part applies. Restores a guarantee the docs split
 * dropped, without asking anyone to remember anything.
 *
 * History, because it is the whole justification: from 2026-01-25 to
 * 2026-07-06 these rules lived *inside* the always-on AGENTS.md and reached
 * every session unconditionally. Commit 32aafc2 moved 257 lines into
 * REFERENCE.md and replaced them with a pointer — "loaded only when an agent
 * is about to write a meta file". Nothing was ever put behind that sentence.
 * Replayed over this repo's transcripts: of nine sessions that wrote a Frame
 * meta file, four read the matching section first, three read it only
 * *after* writing, two never opened it. This is the missing mechanism.
 *
 * Why sections and not the whole file. Claude Code inlines a hook's
 * `additionalContext` only up to a threshold; past it the text is written to
 * a file and the model receives `slice(0, threshold)` plus a path. Measured
 * on 2.1.247 by emitting numbered markers through a live hook and reading
 * where the preview cut: **exactly 2000 characters**, reproduced twice.
 * Injecting the whole 14.4 KB document therefore delivered one section and a
 * half — and demoted the rest back to "the model may go and read it", which
 * is the exact failure this file exists to end. Every payload here is one
 * section or less, and `CAP` keeps it clear of the ceiling.
 *
 * What is deliberately NOT delivered: `Spec Knowledge Layer` and `Activity
 * Monitor`. They are the two sections that exceed the ceiling, and they are
 * also the two that contain no instruction to comply with — they document
 * how spec-hint and the activity log work, for a human or for someone
 * changing Frame. The mechanisms they describe deliver themselves; an agent
 * that never reads them loses nothing. `--list` names them, and `section`
 * prints them on request.
 *
 * Hard contract (same as scripts/spec-hint.js):
 *   - NEVER block, NEVER break: any failure → exit 0, empty output.
 *   - Read-only: sections are sliced out and emitted, never written back.
 *     `upgradeSpecDocs` owns repair; this only delivers.
 *   - Degrade visibly: a section that outgrows CAP is trimmed with a pointer
 *     to the CLI, never silently handed to the host to spill.
 *
 * Dependency-free plain node; ships to user projects' .frame/bin/.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// The host inlines additionalContext up to a measured 2000 characters and
// spills the rest to a file. CAP sits just under that.
//
// Trimming here is the last resort, not the safety net — and it is *worse*
// than what the host does: the host's spill keeps the whole text on disk and
// hands the model the path, while a trim here simply loses the tail. So the
// real guard is test/docs-hint.test.js, which composes every payload from
// the actual REFERENCE.md and fails if one reaches CAP. A section that
// outgrows the ceiling is then a decision for a person — trim the document,
// or split its delivery — rather than a silent loss in production.
const CAP = 1980;

// ─── sections an agent must comply with, and when ─────────
//
// Matched on a stable prefix rather than the full heading, so an editorial
// tweak to a heading's tail does not silently unhook a section.

// Delivered every session: the rules that govern conversation-level choices
// and have no single moment of use.
//
// The spec section carries both a conversation rule (when to offer a spec)
// and the self-serve protocol for running a spec command — 2.5 KB of "find
// the staged template and follow it exactly". Only the first belongs in
// every session; the protocol belongs to the moment a command is invoked,
// and sending it here would push the payload past the host's inline ceiling
// and cost the session rules their delivery too. Until that moment has a
// trigger of its own, the protocol stays reachable through
// `docs-hint.js section "Spec-Driven"`.
const SESSION_SECTIONS = [
  { section: 'Spec-driven', subsections: ['When to suggest a spec'] },
  { section: 'General Rules' }
];

// Delivered when the agent is about to write that file.
const FILE_SECTIONS = [
  { file: 'tasks.json', section: 'Task Management', subsections: ['Task Structure', 'Task Content Rules', 'Task Status Updates'] },
  { file: 'PROJECT_NOTES.md', section: 'PROJECT_NOTES.md Rules' },
  { file: 'STRUCTURE.json', section: 'STRUCTURE.json Rules' },
  { file: 'QUICKSTART.md', section: 'QUICKSTART.md Rules' }
];

// `Task Management` as a whole is 2396 characters — over the ceiling — but its
// write-time half is not. `Task Recognition Rules` and `Task Creation Flow`
// answer "is this a task at all", which belongs to the conversation, not to
// the moment of writing; the three subsections above answer "how is one
// written", which is exactly what a write needs. Nothing is removed from the
// document — this only chooses what to hand over when.

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function resolveRoot(hookCwd) {
  if (process.env.FRAME_PROJECT_ROOT) return path.resolve(process.env.FRAME_PROJECT_ROOT);
  if (hookCwd && fs.existsSync(path.join(hookCwd, '.frame'))) return hookCwd;
  if (path.basename(__dirname) === 'bin' && path.basename(path.dirname(__dirname)) === '.frame') {
    return path.dirname(path.dirname(__dirname));
  }
  return process.cwd();
}

function referencePath(root) {
  return path.join(root, '.frame', 'docs', 'REFERENCE.md');
}

function cliPath(root) {
  const local = path.join(__dirname, 'docs-hint.js');
  if (fs.existsSync(local)) {
    const rel = path.relative(root, local).split(path.sep).join('/');
    return rel || 'docs-hint.js';
  }
  return '.frame/bin/docs-hint.js';
}

// ─── parsing ──────────────────────────────────────────────

/** REFERENCE.md → [{ title, body, subs: [{ title, body }] }], in file order. */
function parseSections(text) {
  const out = [];
  let cur = null;
  let sub = null;
  for (const line of String(text).split('\n')) {
    if (/^##\s+/.test(line)) {
      cur = { title: line.replace(/^##\s+/, '').trim(), lines: [], subs: [] };
      sub = null;
      out.push(cur);
    } else if (cur && /^###\s+/.test(line)) {
      sub = { title: line.replace(/^###\s+/, '').trim(), lines: [] };
      cur.subs.push(sub);
      cur.lines.push(line);
    } else if (sub) {
      sub.lines.push(line);
      cur.lines.push(line);
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  return out.map((s) => ({
    title: s.title,
    body: s.lines.join('\n').trim(),
    subs: s.subs.map((x) => ({ title: x.title, body: x.lines.join('\n').trim() }))
  }));
}

const byPrefix = (sections, prefix) =>
  sections.find((s) => s.title.toLowerCase().startsWith(String(prefix).toLowerCase())) || null;

/** One section, or only the named subsections of it, as markdown. */
function renderSection(section, subsetTitles) {
  if (!subsetTitles || !subsetTitles.length) {
    return `## ${section.title}\n${section.body}`;
  }
  const picked = subsetTitles
    .map((t) => section.subs.find((s) => s.title.toLowerCase().startsWith(t.toLowerCase())))
    .filter(Boolean)
    .map((s) => `### ${s.title}\n${s.body}`);
  if (!picked.length) return `## ${section.title}\n${section.body}`; // headings moved — send it all
  return `## ${section.title}\n${picked.join('\n\n')}`;
}

/**
 * Compose the payload and keep it under CAP. Over-length degrades to a
 * trimmed body plus the command that prints the rest — visibly incomplete,
 * rather than handed whole to the host and silently spilled to a file.
 */
function capped(root, preamble, bodies) {
  const full = `${preamble}\n\n${bodies.join('\n\n')}`;
  if (full.length <= CAP) return full;
  const pointer = `\n\n[trimmed — full text: node ${cliPath(root)} section "<name>"]`;
  return full.slice(0, Math.max(0, CAP - pointer.length)) + pointer;
}

// ─── activity record ──────────────────────────────────────
//
// Guarded exactly as spec-hint.js guards it: a `.frame/bin/` generation that
// predates activity-log.js must degrade to silence, not to an exception.
// Nothing here may write to stdout or throw.

let activity = null;
try {
  activity = require('./activity-log');
} catch {
  /* older .frame/bin generation — no record, same behavior as before */
}

function note(root, ev, mode, fields) {
  if (!activity || !root) return;
  try {
    activity.appendSync(activity.projectKey(root), {
      ev,
      kind: ev === 'hint.injected' ? 'action' : 'suppression',
      host: 'claude-hook',
      mode,
      ...fields
    });
  } catch {
    /* the record is never worth a failed tool call */
  }
}

function emit(eventName, context) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: eventName, additionalContext: context }
  }));
}

// ─── modes ────────────────────────────────────────────────

function loadSections(root) {
  try {
    return parseSections(fs.readFileSync(referencePath(root), 'utf8'));
  } catch {
    return null;
  }
}

const SESSION_PREAMBLE = 'Frame project rules (.frame/docs/REFERENCE.md), for the whole session. ' +
  'A meta file\'s own rules arrive when you write it.';

function sessionStart(input) {
  const root = resolveRoot(input.cwd);
  const sections = loadSections(root);
  if (!sections) return note(root, 'hint.quiet', 'session-start', { reason: 'no-index' });

  const bodies = SESSION_SECTIONS
    .map((entry) => {
      const found = byPrefix(sections, entry.section);
      return found ? renderSection(found, entry.subsections) : null;
    })
    .filter(Boolean);
  if (!bodies.length) return note(root, 'hint.quiet', 'session-start', { reason: 'no-match' });

  const text = capped(root, SESSION_PREAMBLE, bodies);
  note(root, 'hint.injected', 'session-start', { bytes: text.length });
  emit('SessionStart', text);
}

/**
 * Every path a shell command would actually write to: redirect destinations,
 * `tee` operands, and the file `sed -i` edits in place. `/dev/null` and other
 * non-project destinations fall out naturally because they are matched
 * against `.frame/` meta names afterwards.
 */
function writeTargets(cmd) {
  const out = [];
  let m;
  const redirect = /(?:^|[^0-9<>])>>?\s*(["']?)([^\s"'|;&]+)\1/g;
  while ((m = redirect.exec(cmd)) !== null) out.push(m[2]);
  const tee = /\btee\b((?:\s+-{1,2}\S+)*)\s+(["']?)([^\s"'|;&]+)\2/g;
  while ((m = tee.exec(cmd)) !== null) out.push(m[3]);
  const sed = /\bsed\s+(?:-\S+\s+)*-i(?:\s*\S*)?\s+(?:-\S+\s+)*(?:(["'])(?:.*?)\1\s+)?(["']?)([^\s"'|;&]+)\2/g;
  while ((m = sed.exec(cmd)) !== null) out.push(m[3]);
  return out;
}

/**
 * One path → the meta file it is, or null. The `.frame/` requirement is the
 * whole guard: a project's own `tasks.json` is not Frame's, and Frame's rules
 * would be wrong advice for it.
 */
function sectionForPath(p) {
  const s = String(p);
  if (!/(^|\/)\.frame\//.test(s)) return null;
  const base = s.split('/').pop();
  return FILE_SECTIONS.find((f) => base === f.file) || null;
}

/** The meta file this write targets, or null. */
function metaTargetOf(toolName, input) {
  if (toolName === 'Edit' || toolName === 'Write' || toolName === 'NotebookEdit') {
    return sectionForPath(input.file_path || input.notebook_path || '');
  }
  if (toolName === 'Bash') {
    // The *target* of a write, never merely the presence of a write
    // operator. The looser form — "the command contains `>` and mentions a
    // meta file" — fired on `diff scripts/x .frame/bin/x >/dev/null` inside a
    // block that also named PROJECT_NOTES.md, i.e. on a command that only
    // read. Same failure module-hint had, same rule: a wrong hint is worse
    // than none, so only an explicit destination counts.
    return writeTargets(String(input.command || '')).map(sectionForPath).find(Boolean) || null;
  }
  return null;
}

function preEdit(input) {
  const root = resolveRoot(input.cwd);
  const target = metaTargetOf(input.tool_name, input.tool_input || {});
  if (!target) return; // not a Frame meta write — silent and unrecorded

  const sections = loadSections(root);
  if (!sections) return note(root, 'hint.quiet', 'meta-write', { reason: 'no-index' });
  const section = byPrefix(sections, target.section);
  if (!section) return note(root, 'hint.quiet', 'meta-write', { reason: 'no-match' });

  // Kept terse on purpose: every character here is one the rules cannot use.
  const preamble = `Frame's rules for writing ${target.file} — follow them:`;
  const text = capped(root, preamble, [renderSection(section, target.subsections)]);
  note(root, 'hint.injected', 'meta-write', { bytes: text.length });
  emit('PreToolUse', text);
}

/** CLI: print one section, or list them. The manual escape hatch. */
function sectionCli(root, name) {
  const sections = loadSections(root);
  if (!sections) {
    process.stderr.write('No .frame/docs/REFERENCE.md in this project\n');
    return;
  }
  if (!name || name === '--list') {
    for (const s of sections) process.stdout.write(`${s.title}\n`);
    return;
  }
  const hit = byPrefix(sections, name);
  if (!hit) {
    process.stderr.write(`No section starting with "${name}". Try: --list\n`);
    return;
  }
  process.stdout.write(`## ${hit.title}\n${hit.body}\n`);
}

// ─── main (never break) ───────────────────────────────────

try {
  const mode = process.argv[2];
  if (mode === 'section') {
    sectionCli(resolveRoot(process.cwd()), process.argv[3]);
  } else {
    const input = JSON.parse(readStdin() || '{}');
    if (mode === 'session-start') sessionStart(input);
    else if (mode === 'pre-edit') preEdit(input);
  }
} catch { /* silence is the contract */ }

// Deliberately `exitCode`, not `process.exit(0)`: an explicit exit tears the
// process down before a large stdout write has drained, and stdout here is a
// pipe with a buffer around 8 KB. The same pattern truncated this script's
// own payload mid-string, and the host receives that as unparseable JSON
// rather than as an error. Nothing above holds the event loop open.
process.exitCode = 0;
