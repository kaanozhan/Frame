#!/usr/bin/env node
/**
 * Spec Knowledge Layer — index builder
 *
 * Compiles the spec archive (.frame/specs/**) into a derived, gitignored
 * index at .frame/index/spec-index.json with two views:
 *
 *   topics — slug → { title, phase, keywords, related, supersedes,
 *                     digestLine, paths }
 *   files  — posix path → chronological list of records
 *            { slug, task, line, date, phase, flags, deep }
 *
 * Primary sources are the spec artifacts themselves (plan ## Footprint for
 * intent, outcome "Files touched:" for actuals, spec/digest front-matter for
 * declared relationships) so the index survives squash merges. Git supplies
 * enrichment only: rename resolution and post-close stale flags. Non-git
 * projects skip enrichment gracefully.
 *
 * Usage:
 *   node scripts/spec-index.js            # rebuild if stale, print summary
 *   node scripts/spec-index.js --force    # unconditional rebuild
 *   const { build, ensureFresh } = require('./spec-index');  # lib
 *
 * FRAME_PROJECT_ROOT lets the same script run from .frame/bin/ inside a
 * user project (find-module.js pattern). Dependency-free plain node.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const INDEX_VERSION = 1;
const INDEX_DIR_REL = path.join('.frame', 'index');
const INDEX_FILE = 'spec-index.json';
const SPECS_REL = path.join('.frame', 'specs');

// Phase → representation. done+outcome = full records; in-flight = footprint
// warning entries; specified = topic catalog only; superseded/draft = skipped.
const FULL_PHASES = new Set(['done']);
const INFLIGHT_PHASES = new Set(['planned', 'tasks_generated', 'implementing']);
const TOPIC_ONLY_PHASES = new Set(['specified']);

const SOURCE_FILES = ['status.json', 'spec.md', 'plan.md', 'tasks.md', 'outcome.md', 'digest.md'];

function toPosix(p) { return String(p).split(path.sep).join('/'); }

function resolveRoot(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.FRAME_PROJECT_ROOT) return path.resolve(process.env.FRAME_PROJECT_ROOT);
  // Shipped copy lives in <project>/.frame/bin/ — walk two up from there.
  if (path.basename(__dirname) === 'bin' && path.basename(path.dirname(__dirname)) === '.frame') {
    return path.dirname(path.dirname(__dirname));
  }
  return path.join(__dirname, '..');
}

function readSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function readJsonSafe(p) {
  const raw = readSafe(p);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ─── artifact parsers ─────────────────────────────────────

/**
 * Fenced front-matter at the top of spec.md/digest.md:
 *   ---
 *   keywords: a, b, c
 *   related: slug-x, slug-y
 *   supersedes: slug-z
 *   ---
 */
function parseFrontMatter(md) {
  const out = { keywords: [], related: [], supersedes: null };
  if (!md) return out;
  const m = md.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!m) return out;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(keywords|related|supersedes)\s*:\s*(.+)$/i);
    if (!kv) continue;
    const vals = kv[2].split(',').map(s => s.trim()).filter(Boolean);
    const key = kv[1].toLowerCase();
    if (key === 'supersedes') out.supersedes = vals[0] || null;
    else out[key] = vals;
  }
  return out;
}

/** `## Footprint` bullets — same contract getSpecFootprint parses. */
function parseFootprint(md) {
  if (!md) return [];
  const lines = md.split('\n');
  const start = lines.findIndex(l => /^## Footprint\s*$/.test(l));
  if (start < 0) return [];
  const paths = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) break;
    const b = lines[i].match(/^\s*-\s+(\S+)\s*$/);
    if (b) paths.push(b[1]);
  }
  return paths;
}

const PATHLIKE = /^[\w.@$-]+(?:\/[\w.@$*-]+)+$/;

/**
 * Outcome sections: `## T<n> — title` … `_Captured: <date> …_`.
 * Files come from the sentence after a "Files touched" marker when present,
 * else from any path-like backticked token in the section.
 */
function parseOutcome(md) {
  if (!md) return [];
  const sections = [];
  const re = /^## (T\d+)\s*[—–-]\s*(.+)$/gm;
  let match; const marks = [];
  while ((match = re.exec(md)) !== null) marks.push({ task: match[1], title: match[2].trim(), start: match.index });
  for (let i = 0; i < marks.length; i++) {
    const body = md.slice(marks[i].start, i + 1 < marks.length ? marks[i + 1].start : md.length);
    const firstPara = body.split('\n').slice(1).map(s => s.trim()).filter(Boolean)[0] || '';
    const line = firstPara.split(/(?<=[.!?])\s/)[0].slice(0, 160);
    const dateM = body.match(/_Captured:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/);
    const scope = (() => {
      const ft = body.match(/Files touched[:.]?([\s\S]*?)(?:\n\n|_Captured|$)/i);
      return ft ? ft[1] : body;
    })();
    const files = [];
    const tick = /`([^`\n]+)`/g;
    let t;
    while ((t = tick.exec(scope)) !== null) {
      const tok = t[1].replace(/\s*\(new\)\s*$/i, '').trim();
      if (PATHLIKE.test(tok) && !files.includes(tok)) files.push(tok);
    }
    sections.push({ task: marks[i].task, title: marks[i].title, line, files, date: dateM ? dateM[1] : null });
  }
  return sections;
}

/** digest.md: front-matter + first non-heading body line. */
function parseDigest(md) {
  if (!md) return { fm: parseFrontMatter(null), digestLine: null };
  const fm = parseFrontMatter(md);
  const body = md.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
  const digestLine = body.split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'))[0] || null;
  return { fm, digestLine };
}

/** Fallback keywords when nothing is declared: title + slug tokens. */
function lexicalKeywords(slug, title) {
  const STOP = new Set(['the', 'and', 'for', 'with', 'via', 'from', 'into', 'a', 'an', 'of', 'to', 'in', 'on', 'as', 'is', 'are', 'q3', 'audit', 'spec', 'frame']);
  const toks = `${slug} ${title || ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w));
  return [...new Set(toks)];
}

// ─── git enrichment (best-effort, silent on failure) ──────

function gitExec(projectPath, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: projectPath, maxBuffer: 32 * 1024 * 1024, timeout: 15000 },
      (err, stdout) => resolve(err ? null : stdout));
  });
}

/** One pass over history: rename chains old→final path. */
async function buildRenameMap(projectPath) {
  const out = await gitExec(projectPath, ['log', '-M', '--diff-filter=R', '--name-status', '--format=', '--no-color']);
  if (!out) return new Map();
  // Newest-first; follow each old name forward to its final destination.
  const step = new Map(); // old → new (latest hop wins because we set only once, newest first)
  for (const line of out.split('\n')) {
    const m = line.match(/^R\d*\t([^\t]+)\t([^\t]+)$/);
    if (m && !step.has(m[1])) step.set(m[1], m[2]);
  }
  const resolved = new Map();
  for (const from of step.keys()) {
    let cur = from; const seen = new Set();
    while (step.has(cur) && !seen.has(cur)) { seen.add(cur); cur = step.get(cur); }
    if (cur !== from) resolved.set(from, cur);
  }
  return resolved;
}

/** file → last commit date (ISO), one git call since the oldest spec close. */
async function buildLastTouchMap(projectPath, sinceIso) {
  const args = ['log', '--name-only', '--format=@%cI', '--no-color'];
  if (sinceIso) args.push(`--since=${sinceIso}`);
  const out = await gitExec(projectPath, args);
  if (!out) return new Map();
  const map = new Map();
  let cur = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('@')) { cur = line.slice(1); continue; }
    const f = line.trim();
    if (f && cur && !map.has(f)) map.set(f, cur); // newest-first → first hit is latest touch
  }
  return map;
}

// ─── build ────────────────────────────────────────────────

async function build(projectPath) {
  const root = resolveRoot(projectPath);
  const specsDir = path.join(root, SPECS_REL);
  let entries = [];
  try {
    entries = fs.readdirSync(specsDir, { withFileTypes: true }).filter(e => e.isDirectory());
  } catch { /* no specs dir → empty index */ }

  const specs = [];
  for (const ent of entries) {
    const dir = path.join(specsDir, ent.name);
    const status = readJsonSafe(path.join(dir, 'status.json'));
    if (!status) continue;
    if (status.superseded_by) continue;                    // excluded by contract
    const phase = status.phase || 'draft';
    if (!FULL_PHASES.has(phase) && !INFLIGHT_PHASES.has(phase) && !TOPIC_ONLY_PHASES.has(phase)) continue;
    const specMd = readSafe(path.join(dir, 'spec.md'));
    const digest = parseDigest(readSafe(path.join(dir, 'digest.md')));
    const specFm = parseFrontMatter(specMd);
    const fm = {
      keywords: specFm.keywords.length ? specFm.keywords : digest.fm.keywords,
      related: specFm.related.length ? specFm.related : digest.fm.related,
      supersedes: specFm.supersedes || digest.fm.supersedes
    };
    specs.push({
      slug: ent.name,
      dir,
      phase,
      title: status.title || ent.name,
      closedAt: status.last_phase_at || status.updated_at || null,
      fm,
      digestLine: digest.digestLine,
      footprint: parseFootprint(readSafe(path.join(dir, 'plan.md'))),
      outcome: FULL_PHASES.has(phase) ? parseOutcome(readSafe(path.join(dir, 'outcome.md'))) : []
    });
  }

  const doneDates = specs.filter(s => FULL_PHASES.has(s.phase) && s.closedAt).map(s => s.closedAt).sort();
  const isGit = fs.existsSync(path.join(root, '.git'));
  const [renames, lastTouch] = isGit
    ? await Promise.all([buildRenameMap(root), buildLastTouchMap(root, doneDates[0] || null)])
    : [new Map(), new Map()];

  const topics = {};
  const files = {};
  const addRecord = (rawPath, rec) => {
    let key = toPosix(rawPath);
    const exists = fs.existsSync(path.join(root, key));
    if (!exists && renames.has(key)) {
      const dest = renames.get(key);
      // Old key keeps a pointer stub; records live under the final path.
      files[key] = files[key] || [];
      if (!files[key].some(r => r.flags && r.flags.movedTo === dest)) {
        files[key].push({ slug: rec.slug, task: null, line: `history moved with file → ${dest}`, date: rec.date, phase: rec.phase, flags: { movedTo: dest }, deep: rec.deep });
      }
      rec = { ...rec, origin: key };
      key = dest;
    } else if (!exists && !key.includes('*')) {
      rec = { ...rec, flags: { ...rec.flags, deleted: true } };
    }
    files[key] = files[key] || [];
    files[key].push(rec);
  };

  for (const s of specs) {
    const deepOutcome = fs.existsSync(path.join(s.dir, 'outcome.md'))
      ? toPosix(path.join(SPECS_REL, s.slug, 'outcome.md'))
      : toPosix(path.join(SPECS_REL, s.slug)) + '/';
    topics[s.slug] = {
      title: s.title,
      phase: s.phase,
      keywords: s.fm.keywords.length ? s.fm.keywords : lexicalKeywords(s.slug, s.title),
      declared: s.fm.keywords.length > 0,
      related: s.fm.related,
      supersedes: s.fm.supersedes,
      digestLine: s.digestLine,
      paths: s.footprint.map(toPosix)
    };
    if (TOPIC_ONLY_PHASES.has(s.phase)) continue;

    if (INFLIGHT_PHASES.has(s.phase)) {
      for (const fp of s.footprint) {
        addRecord(fp, {
          slug: s.slug, task: null,
          line: `in the footprint of in-flight spec "${s.slug}" (${s.phase})`,
          date: s.closedAt ? s.closedAt.slice(0, 10) : null,
          phase: s.phase, flags: { inflight: true },
          deep: toPosix(path.join(SPECS_REL, s.slug)) + '/'
        });
      }
      continue;
    }

    // done — per-task records from outcome, spec-level records for
    // footprint files the outcome never names.
    const covered = new Set();
    for (const sec of s.outcome) {
      for (const f of sec.files) {
        covered.add(toPosix(f));
        addRecord(f, {
          slug: s.slug, task: sec.task, line: sec.line || sec.title,
          date: sec.date || (s.closedAt ? s.closedAt.slice(0, 10) : null),
          phase: s.phase, flags: {}, deep: deepOutcome
        });
      }
    }
    for (const fp of s.footprint) {
      if (covered.has(toPosix(fp))) continue;
      addRecord(fp, {
        slug: s.slug, task: null,
        line: s.digestLine || s.title,
        date: s.closedAt ? s.closedAt.slice(0, 10) : null,
        phase: s.phase, flags: {}, deep: deepOutcome
      });
    }
  }

  // Chronology + flags: sort oldest→newest, mark current, laterSpecs, stale.
  const closeBySlug = Object.fromEntries(specs.map(s => [s.slug, s.closedAt]));
  for (const key of Object.keys(files)) {
    const list = files[key];
    list.sort((a, b) => String(a.date || '') < String(b.date || '') ? -1 : 1);
    const fullRecs = list.filter(r => !r.flags.inflight && !r.flags.movedTo);
    if (fullRecs.length) fullRecs[fullRecs.length - 1].flags.current = true;
    const slugsSeen = list.map(r => r.slug);
    for (let i = 0; i < list.length; i++) {
      if (slugsSeen.slice(i + 1).some(sl => sl !== list[i].slug)) list[i].flags.laterSpecs = true;
      const closed = closeBySlug[list[i].slug];
      const touched = lastTouch.get(key);
      if (closed && touched && touched > closed && !list[i].flags.inflight) list[i].flags.stale = true;
    }
  }

  return { version: INDEX_VERSION, generatedAt: new Date().toISOString(), root: toPosix(root), topics, files };
}

// ─── freshness + IO ───────────────────────────────────────

function indexPath(projectPath) {
  return path.join(resolveRoot(projectPath), INDEX_DIR_REL, INDEX_FILE);
}

function newestSourceMtime(root) {
  let newest = 0;
  const specsDir = path.join(root, SPECS_REL);
  let entries = [];
  try { entries = fs.readdirSync(specsDir, { withFileTypes: true }).filter(e => e.isDirectory()); } catch { return 0; }
  for (const ent of entries) {
    for (const f of SOURCE_FILES) {
      try {
        const st = fs.statSync(path.join(specsDir, ent.name, f));
        if (st.mtimeMs > newest) newest = st.mtimeMs;
      } catch { /* absent */ }
    }
  }
  return newest;
}

async function writeIndex(projectPath) {
  const root = resolveRoot(projectPath);
  const idx = await build(root);
  const file = indexPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(idx, null, 2) + '\n');
  return { path: file, index: idx };
}

/**
 * Rebuild only when the index is missing or older than the newest spec
 * artifact. Returns the index object (parsed from disk when fresh).
 */
async function ensureFresh(projectPath) {
  const root = resolveRoot(projectPath);
  const file = indexPath(root);
  try {
    const st = fs.statSync(file);
    if (st.mtimeMs >= newestSourceMtime(root)) {
      const cached = readJsonSafe(file);
      if (cached && cached.version === INDEX_VERSION) return cached;
    }
  } catch { /* missing → rebuild */ }
  return (await writeIndex(root)).index;
}

/** One compact line per spec — the {spec_catalog} embed for spec.new. */
function catalogLines(index) {
  return Object.entries(index.topics)
    .map(([slug, t]) => {
      const title = t.title.length > 90 ? t.title.slice(0, 87) + '…' : t.title;
      return `- ${slug} · ${title} · ${t.phase}${t.keywords.length ? ' · ' + t.keywords.slice(0, 8).join(', ') : ''}`;
    });
}

module.exports = { build, writeIndex, ensureFresh, indexPath, catalogLines, parseFrontMatter, parseFootprint, parseOutcome, parseDigest };

// ─── CLI ──────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    const force = process.argv.includes('--force');
    const root = resolveRoot(null);
    const { path: file, index } = force ? await writeIndex(root) : { path: indexPath(root), index: await ensureFresh(root) };
    const nFiles = Object.keys(index.files).length;
    const nTopics = Object.keys(index.topics).length;
    console.log(`spec-index: ${nTopics} specs, ${nFiles} storied files → ${toPosix(path.relative(root, file))}`);
  })().catch((e) => { console.error('spec-index failed:', e.message); process.exit(1); });
}
