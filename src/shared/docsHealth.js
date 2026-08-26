/**
 * Doc health — does Frame's own prose still describe a project that exists?
 *
 * Frame's always-on documents tell an agent where to look. On the upgrade path
 * they came to name files that were never created: `upgradeSpecDocs` rewrote
 * AGENTS.md into a pointer at `.frame/docs/REFERENCE.md` and, two lines away,
 * skipped that file with `continue; // missing file — never create it`. Nothing
 * errored, so nothing was noticed for a month.
 *
 * This module is the check that would have caught it, and the classifier the
 * repair pass needs before it may write. Given the documents' texts and a
 * predicate that answers whether a project-relative path exists, it reports:
 *
 *   - **missingPaths** — every `.frame/…` path the prose names that is not
 *     there. A pointer with no target.
 *   - **sections** — per document, per managed block, which of four states it
 *     is in. This is what separates "append, nothing can conflict" from "ask,
 *     the user wrote their own".
 *
 * The four states, and why there are four rather than two:
 *
 *   | state       | what it means                            | what may be done |
 *   | ----------- | ---------------------------------------- | ---------------- |
 *   | `managed`   | the block is present, whatever version   | upgradeDoc's own |
 *   | `legacy`    | no block, but a shipped generation hits  | upgradeDoc's own |
 *   | `absent`    | no block, no match, no section like it   | append           |
 *   | `unmatched` | no block, no match, but a section like   | ask — never write|
 *   |             | it is there: the user wrote their own    |                  |
 *
 * Collapsing the last two is precisely the mistake that produced the
 * 2026-07-23 "spec-flow delivery gap": a second protocol beside the user's own
 * leaves the agent reading two overlapping flows and following the wrong one.
 *
 * Pure: no fs, no Electron, no knowledge of any particular project. The caller
 * supplies the documents, the block descriptors and the existence predicate.
 */

const managedBlock = require('./docsManagedBlock');

// A path Frame's prose names. Bounded by the characters a path may contain, so
// it stops at whitespace, a backtick or a closing bracket on its own. Matches
// inside fenced command examples as well as backticked prose — both are
// instructions an agent will follow.
const FRAME_PATH_RE = /\.frame\/[A-Za-z0-9_.\/-]+/g;

// Placeholders, not paths: `.frame/specs/<slug>/spec.md`,
// `.frame/runtime/commands/<tool>/`, a glob. Nothing to check on disk.
function isPlaceholder(path) {
  return path.includes('<') || path.includes('*') || path.includes('…');
}

/**
 * Trim what sentence punctuation glued onto the end of a match. A trailing dot
 * is the ambiguous one — `.frame/AGENTS.md.` at the end of a sentence — so it
 * is stripped only when what remains still looks like a file or a directory.
 */
function trimTrailing(path) {
  return path.replace(/[.,;:)\]]+$/, (tail, offset) => {
    const kept = path.slice(0, offset);
    return /\.[A-Za-z0-9]+$/.test(kept) || !kept.includes('.') ? '' : tail;
  });
}

/**
 * Every distinct `.frame/…` path a document names, placeholders dropped, in
 * the order they first appear.
 */
function namedPaths(text) {
  if (typeof text !== 'string') return [];
  const seen = new Set();
  const out = [];
  for (const match of text.match(FRAME_PATH_RE) || []) {
    const path = trimTrailing(match);
    if (!path || path.endsWith('/') || isPlaceholder(path)) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

/**
 * A heading's comparable stem: the words, lowercased, with the decoration
 * Frame and its users have both used stripped — a parenthetical, an em-dash
 * tail, trailing punctuation.
 *
 * Deliberately loose. `## Spec-Driven Development (.frame/specs/)` is Frame's
 * own; `## Spec-driven development — how to suggest` is a hand-written variant
 * of the same section. Both must read as "this document already has a section
 * about this", because appending beside either is the thing not to do.
 */
function headingStem(line) {
  return line
    .replace(/^#+\s*/, '')
    .replace(/\s*[(—–-]\s.*$/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/[.:;,]+\s*$/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Does this document carry a heading that reads like the block's own section,
 * whoever wrote it? `stems` are the lowercased heading stems Frame has shipped
 * for the block.
 */
function hasSectionLike(text, stems) {
  if (typeof text !== 'string' || !Array.isArray(stems) || stems.length === 0) return false;
  for (const line of text.split('\n')) {
    if (!/^#{1,6}\s/.test(line)) continue;
    const stem = headingStem(line);
    if (!stem) continue;
    if (stems.some((s) => stem === s || stem.startsWith(`${s} `))) return true;
  }
  return false;
}

/**
 * Classify one managed block within one document. `block` is
 * `{ name, legacyMatchers, headingStems }`.
 */
function classifySection(text, block) {
  const name = block.name || managedBlock.SPEC_BLOCK_NAME;
  if (managedBlock.findBlock(text, name)) return 'managed';

  // The block's name appearing while `findBlock` found nothing means a
  // dangling marker — corruption or user surgery. `upgradeDoc` refuses to
  // touch such a file, so calling it appendable would promise a repair that
  // can never happen; it belongs with the cases a human has to look at.
  if (text.includes(name)) return 'unmatched';

  // `upgradeDoc` is the oracle for the legacy gate rather than a second
  // implementation of it: whatever this says is what the repair pass will
  // actually do, which is the only useful definition of the state.
  for (const matcher of block.legacyMatchers || []) {
    if (managedBlock.upgradeDoc(text, { body: '', version: 1, blockName: name, legacyMatchers: [matcher] })) {
      return 'legacy';
    }
  }

  return hasSectionLike(text, block.headingStems) ? 'unmatched' : 'absent';
}

/**
 * The whole report.
 *
 * `docs` is `[{ path, text, blocks }]` — `path` names the document for the
 * report, `text` is its content, `blocks` the managed blocks it is expected to
 * carry. A document the caller could not read is passed with `text: null` and
 * reported as unreadable rather than silently skipped.
 *
 * `exists(relPath)` answers whether a project-relative path is on disk.
 */
function report(docs, exists) {
  const missingPaths = [];
  const sections = [];
  const unreadable = [];

  for (const doc of docs || []) {
    if (typeof doc.text !== 'string') {
      unreadable.push({ doc: doc.path });
      continue;
    }
    for (const path of namedPaths(doc.text)) {
      if (!exists(path)) missingPaths.push({ doc: doc.path, path });
    }
    for (const block of doc.blocks || []) {
      sections.push({
        doc: doc.path,
        block: block.name || managedBlock.SPEC_BLOCK_NAME,
        state: classifySection(doc.text, block)
      });
    }
  }

  const unmatchedSections = sections.filter((s) => s.state === 'unmatched');
  const appendableSections = sections.filter((s) => s.state === 'absent');

  return {
    missingPaths,
    sections,
    unmatchedSections,
    appendableSections,
    unreadable,
    // The invariant itself: an agent reading this prose can reach what it
    // names, and no document is carrying a section Frame must not touch.
    ok: missingPaths.length === 0 && unmatchedSections.length === 0 && unreadable.length === 0
  };
}

module.exports = {
  report,
  namedPaths,
  hasSectionLike,
  headingStem,
  classifySection
};
