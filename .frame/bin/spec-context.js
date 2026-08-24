#!/usr/bin/env node
/**
 * Spec Knowledge Layer — query CLI
 *
 * The agent-facing (and human-facing) reader over the spec index. Compact by
 * design: a few lines per hit plus a deep-read pointer — understanding
 * happens on the raw chain (spec.md → plan.md → tasks.md → outcome.md), not
 * here.
 *
 * Usage:
 *   node scripts/spec-context.js <keyword…>        # topic → specs + digest lines
 *   node scripts/spec-context.js --file <path>     # file → chronological history
 *   node scripts/spec-context.js --list            # all indexed specs, one line each
 *
 * Reads the index via ensureFresh (rebuilds lazily when stale). Dependency-
 * free; FRAME_PROJECT_ROOT supported like its siblings.
 */

'use strict';

const path = require('path');
const specIndex = require('./spec-index');

/** ascii-fold + lowercase — Turkish/English tolerant matching. */
function fold(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ç/g, 'c').replace(/ö/g, 'o').replace(/ü/g, 'u');
}

function tokenize(s) {
  return fold(s).split(/[^a-z0-9]+/).filter(w => w.length > 2);
}

function flagText(flags) {
  const out = [];
  if (flags.current) out.push('← current');
  if (flags.stale) out.push('stale: file changed after this spec closed');
  if (flags.laterSpecs) out.push('later specs touched this file');
  if (flags.inflight) out.push('IN-FLIGHT');
  if (flags.movedTo) out.push(`moved → ${flags.movedTo}`);
  if (flags.deleted) out.push('file no longer on disk');
  return out.length ? `  [${out.join(' · ')}]` : '';
}

function printFileHistory(index, rawPath, root) {
  // Accept absolute, ./-prefixed, or repo-relative input.
  let rel = rawPath;
  if (path.isAbsolute(rawPath)) rel = path.relative(root, rawPath);
  rel = rel.split(path.sep).join('/').replace(/^\.\//, '');
  const hist = index.files[rel];
  if (!hist || !hist.length) {
    console.log(`No spec history for ${rel}.`);
    return;
  }
  console.log(`${rel} — ${hist.length} record(s), oldest first:`);
  for (const r of hist) {
    const task = r.task ? ` ${r.task}` : '';
    console.log(`  ${r.date || '????-??-??'}  ${r.slug}${task} — ${r.line}${flagText(r.flags)}`);
  }
  const deeps = [...new Set(hist.map(r => r.deep).filter(Boolean))];
  console.log(`  deep read: ${deeps.join(' · ')}`);
}

function printTopicMatches(index, words) {
  const query = new Set(words.flatMap(tokenize));
  if (!query.size) { console.log('Nothing to search for.'); return; }
  const scored = [];
  for (const [slug, t] of Object.entries(index.topics)) {
    const hay = new Set([
      ...tokenize(slug), ...tokenize(t.title),
      ...t.keywords.flatMap(tokenize),
      ...t.paths.flatMap(p => tokenize(path.basename(p, path.extname(p))))
    ]);
    let score = 0;
    for (const q of query) if (hay.has(q)) score++;
    if (score > 0) scored.push({ slug, t, score });
  }
  scored.sort((a, b) => b.score - a.score);
  if (!scored.length) { console.log('No matching specs.'); return; }
  for (const { slug, t } of scored.slice(0, 8)) {
    const sup = t.supersedes ? ` · supersedes ${t.supersedes}` : '';
    const rel = t.related.length ? ` · related: ${t.related.join(', ')}` : '';
    console.log(`- ${slug} (${t.phase})${sup}${rel}`);
    console.log(`    ${t.digestLine || t.title}`);
    console.log(`    deep read: .frame/specs/${slug}/`);
  }
}

function printList(index) {
  for (const line of specIndex.catalogLines(index)) console.log(line);
}

async function main() {
  const args = process.argv.slice(2);
  const root = process.env.FRAME_PROJECT_ROOT
    ? path.resolve(process.env.FRAME_PROJECT_ROOT)
    : (path.basename(__dirname) === 'bin' ? path.dirname(path.dirname(__dirname)) : path.join(__dirname, '..'));
  const index = await specIndex.ensureFresh(root);

  if (args[0] === '--list') return printList(index);
  if (args[0] === '--file') {
    if (!args[1]) { console.error('Usage: spec-context.js --file <path>'); process.exit(1); }
    return printFileHistory(index, args[1], root);
  }
  if (!args.length) {
    console.error('Usage: spec-context.js <keyword…> | --file <path> | --list');
    process.exit(1);
  }
  return printTopicMatches(index, args);
}

main().catch((e) => { console.error('spec-context failed:', e.message); process.exit(1); });
