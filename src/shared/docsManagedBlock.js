/**
 * Managed-block engine for Frame's spec docs sections.
 *
 * REFERENCE.md and AGENTS.md are user-owned files; Frame may rewrite only the
 * spec section inside them, and only when it can prove the section is its own.
 * Two proofs exist:
 *
 *   1. Markers — the section is wrapped in versioned HTML comments
 *      (`<!-- frame:managed:spec-section v=N -->` … end marker). Rewrite iff
 *      the stamped version is older than the current one, so user tweaks
 *      inside the block survive between Frame releases.
 *   2. Legacy match — no markers, but a heading-bounded section whose text
 *      byte-matches (whitespace-normalized) a section Frame itself shipped in
 *      an earlier generation. Those sections were unparameterized constants,
 *      so an exact match means Frame wrote it and the user never touched it.
 *      A matching heading over a rewritten body means the user customized the
 *      section — the whole file is left alone.
 *
 * Neither proof exists for a document that never carried the section at all,
 * and "leave it alone" is the wrong answer there: it is how a pointer came to
 * be written at a file nothing ever created. So there is a third, additive
 * move — `appendBlock`, reachable through `upgradeDoc`'s `onAbsent: 'append'`
 * — which adds the block without rewriting a byte of what is already there.
 * Deciding that a document has nothing to conflict with is the caller's
 * judgement, not this module's; the engine only carries it out.
 *
 * Pure string surgery: no fs, no Electron. Every byte outside the replaced
 * span is preserved verbatim.
 */

// The engine carries more than one managed block (the spec section, and the
// navigation prose the `.frame/` layout made stale), so every entry point
// takes a block name and defaults to the spec section — the name every
// existing caller and test means when it passes none. Blocks are independent:
// a document may carry one, both, or neither, and each is versioned on its own.
const SPEC_BLOCK_NAME = 'frame:managed:spec-section';
const BLOCK_NAME = SPEC_BLOCK_NAME;

function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function beginMarkerRe(blockName) {
  return new RegExp(`<!--\\s*${escapeRe(blockName)}\\s+v=(\\d+)\\s*-->`);
}

function endMarkerRe(blockName) {
  return new RegExp(`<!--\\s*/${escapeRe(blockName)}\\s*-->`);
}

function beginMarker(version, blockName) {
  return `<!-- ${blockName} v=${version} -->`;
}

function endMarker(blockName) {
  return `<!-- /${blockName} -->`;
}

const END_MARKER = endMarker(SPEC_BLOCK_NAME);

/**
 * Wrap a section body in stamped markers — the canonical emitted form.
 */
function renderBlock(body, version, blockName = SPEC_BLOCK_NAME) {
  return `${beginMarker(version, blockName)}\n${body}\n${endMarker(blockName)}`;
}

/**
 * Locate the managed block. Returns { start, end, version } — start/end are
 * offsets spanning the markers inclusive — or null when there is no
 * well-formed block (absent, begin without end, end before begin). Malformed
 * markers are deliberately reported as "no block": the legacy gate below
 * cannot match a marker-polluted section, so a corrupted file is left alone.
 */
function findBlock(text, blockName = SPEC_BLOCK_NAME) {
  if (typeof text !== 'string') return null;
  const begin = beginMarkerRe(blockName).exec(text);
  if (!begin) return null;
  const afterBegin = begin.index + begin[0].length;
  const end = endMarkerRe(blockName).exec(text.slice(afterBegin));
  if (!end) return null;
  return {
    start: begin.index,
    end: afterBegin + end.index + end[0].length,
    version: parseInt(begin[1], 10)
  };
}

/**
 * Whitespace-normalized comparison basis. The shipped legacy sections were
 * constants, so text equality modulo whitespace (reflow, trailing spaces,
 * line-ending drift) means Frame's own bytes.
 */
function normalize(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Find the heading-bounded span of a legacy section that passes the
 * confidence gate: the heading line matches the matcher's heading exactly,
 * and the section text (heading through the next same-or-higher-level
 * heading, separators trimmed) normalizes to the matcher's shipped text.
 * Returns { start, end } or null.
 */
function findLegacySpan(text, matcher) {
  const shipped = String(matcher);
  const heading = shipped.slice(0, shipped.indexOf('\n') === -1 ? shipped.length : shipped.indexOf('\n')).trim();
  if (!/^#{1,6}\s/.test(heading)) return null;
  const level = heading.match(/^#+/)[0].length;

  let from = 0;
  while (from < text.length) {
    const idx = text.indexOf(heading, from);
    if (idx === -1) return null;
    from = idx + heading.length;
    // Heading must sit on its own line, matched exactly.
    const lineStart = text.lastIndexOf('\n', idx - 1) + 1;
    const lineEnd = text.indexOf('\n', idx);
    const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
    if (line.trim() !== heading || lineStart !== idx) continue;

    // Section ends at the next heading of the same or higher level, at the
    // next thematic break (`---` on its own line — the docs' section
    // separator), or at EOF. The shipped section bodies contain neither.
    const boundary = new RegExp(`^(#{1,${level}}\\s|-{3,}\\s*$)`, 'm');
    const rest = text.slice(from);
    const next = boundary.exec(rest);
    let end = next ? from + next.index : text.length;

    // Keep trailing `---` separators and blank lines outside the span — they
    // belong to the document's layout, not the section.
    const span = text.slice(lineStart, end);
    const trimmed = span.replace(/(\n+(-{3,})?)*\s*$/, '');
    end = lineStart + trimmed.length;

    if (normalize(text.slice(lineStart, end)) === normalize(shipped)) {
      return { start: lineStart, end };
    }
  }
  return null;
}

/**
 * Where a new block goes in a document that has none: before the trailing
 * Frame footer when the caller names one, otherwise at the end. Mirrors the
 * insertion `frameProject.ensureSpecDrivenArtifacts` has always used, so a
 * document appended to here is shaped exactly like one Frame wrote itself.
 */
function firstFooterIndex(text, footerMarker) {
  const markers = Array.isArray(footerMarker) ? footerMarker : [footerMarker];
  let found = -1;
  for (const marker of markers) {
    if (typeof marker !== 'string' || !marker) continue;
    const idx = text.indexOf(marker);
    if (idx >= 0 && (found === -1 || idx < found)) found = idx;
  }
  return found;
}

/**
 * Add a managed block to a document that carries none, rewriting nothing:
 * every existing byte survives, the block is inserted before the footer (or
 * appended), and it is stamped current so later upgrades take the marker path.
 *
 * This is the additive half of the engine's contract. `upgradeDoc` decides
 * whether a document *may* be appended to; the judgement that there is nothing
 * to conflict with belongs to the caller, because it needs knowledge of the
 * document's own sections that pure string surgery cannot supply.
 *
 * Returns null on the same invalid inputs `upgradeDoc` rejects.
 */
function insertBeforeFooter(text, body, footerMarker) {
  const footerIdx = firstFooterIndex(text, footerMarker);
  if (footerIdx >= 0) {
    // Drop the separator that preceded the footer so the inserted text does
    // not leave two rules stacked on each other.
    const head = text.slice(0, footerIdx).replace(/\n*(-{3,}[ \t]*\n)?\s*$/, '');
    const tail = text.slice(footerIdx);
    return `${head}\n\n---\n\n${body}\n\n---\n\n${tail}`;
  }
  return `${text.replace(/\n*$/, '')}\n\n---\n\n${body}\n`;
}

function appendBlock(text, options) {
  if (typeof text !== 'string' || !options || typeof options.body !== 'string') return null;
  const version = options.version;
  if (!Number.isInteger(version)) return null;

  const blockName = options.blockName || SPEC_BLOCK_NAME;
  const rendered = renderBlock(options.body, version, blockName);
  return insertBeforeFooter(text, rendered, options.footerMarker);
}

/**
 * Two thematic breaks with nothing between them, and runs of blank lines, are
 * what removing a section leaves behind. Collapsed only where the separators
 * are genuinely adjacent, so a `---` inside a fenced block is never touched.
 */
function collapseSeparators(text) {
  let out = text;
  let previous;
  do {
    previous = out;
    out = out.replace(/\n-{3,}[ \t]*\n\s*\n-{3,}[ \t]*\n/g, '\n---\n');
  } while (out !== previous);
  return out.replace(/\n{3,}/g, '\n\n');
}

/**
 * Remove whole sections Frame itself shipped and has since moved elsewhere.
 *
 * Unlike an upgrade, this deletes rather than replaces, so the confidence gate
 * is stricter: **every** matcher must pass or nothing is removed. A document
 * where five of six sections are Frame's and the sixth was edited is a
 * document someone worked on, and stripping the five would leave their one
 * section stranded among prose that no longer surrounds it.
 *
 * Returns `{ text, matched, total }` — `text` is null unless every matcher
 * hit, and `matched` lets the caller tell "not this generation at all" (0)
 * apart from "this generation, edited" (between 1 and total), which are
 * different things to say to a user.
 */
function removeLegacySections(text, matchers) {
  const list = Array.isArray(matchers) ? matchers : [];
  const result = { text: null, matched: 0, total: list.length };
  if (typeof text !== 'string' || list.length === 0) return result;

  const spans = [];
  for (const matcher of list) {
    const span = findLegacySpan(text, matcher);
    if (span) {
      spans.push(span);
      result.matched += 1;
    }
  }
  if (result.matched !== result.total) return result;

  // Back to front, so earlier offsets stay valid as later spans go.
  spans.sort((a, b) => b.start - a.start);
  let out = text;
  let lastStart = Infinity;
  for (const span of spans) {
    if (span.end > lastStart) return result; // overlapping matches — refuse
    lastStart = span.start;
    out = out.slice(0, span.start) + out.slice(span.end);
  }

  result.text = collapseSeparators(out);
  return result;
}

/**
 * Compute the upgraded document text, or null when nothing may change.
 *
 *   - markers present, stamped >= version → null (current or newer)
 *   - markers present, stamped < version  → block replaced in place
 *   - no markers → one-time legacy migration when a matcher passes the
 *     confidence gate; otherwise `onAbsent`'s answer, which defaults to null
 *
 * options: { body, version, legacyMatchers, blockName, onAbsent, footerMarker }
 * — body is the new section text (unwrapped), legacyMatchers an array of full
 * shipped section texts (heading included), blockName the managed block to
 * act on (default: the spec section), and `onAbsent: 'append'` asks for the
 * block to be added when no proof of an existing one was found.
 *
 * `onAbsent` reaches only the final arm. A block at the current version, a
 * block stamped older, a marker fragment and a legacy match all behave exactly
 * as they did before the option existed — which is what keeps a healthy
 * document byte-identical across an upgrade.
 */
function upgradeDoc(text, options) {
  if (typeof text !== 'string' || !options || typeof options.body !== 'string') return null;
  const version = options.version;
  if (!Number.isInteger(version)) return null;
  const blockName = options.blockName || SPEC_BLOCK_NAME;

  const block = findBlock(text, blockName);
  if (block) {
    if (block.version >= version) return null;
    return text.slice(0, block.start)
      + renderBlock(options.body, version, blockName)
      + text.slice(block.end);
  }

  // Any marker fragment without a well-formed block means corrupted Frame
  // state or user surgery — never migrate around it, and never append a
  // second block beside the wreckage of the first.
  if (beginMarkerRe(blockName).test(text) || endMarkerRe(blockName).test(text)) return null;

  for (const matcher of options.legacyMatchers || []) {
    const span = findLegacySpan(text, matcher);
    if (span) {
      return text.slice(0, span.start)
        + renderBlock(options.body, version, blockName)
        + text.slice(span.end);
    }
  }

  if (options.onAbsent === 'append') return appendBlock(text, options);
  return null;
}

module.exports = {
  findBlock,
  upgradeDoc,
  appendBlock,
  removeLegacySections,
  insertBeforeFooter,
  renderBlock,
  BLOCK_NAME,
  SPEC_BLOCK_NAME,
  END_MARKER
};
