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
 * Pure string surgery: no fs, no Electron. Every byte outside the replaced
 * span is preserved verbatim.
 */

const BLOCK_NAME = 'frame:managed:spec-section';
const BEGIN_MARKER_RE = new RegExp(`<!--\\s*${BLOCK_NAME}\\s+v=(\\d+)\\s*-->`);
const END_MARKER_RE = new RegExp(`<!--\\s*/${BLOCK_NAME}\\s*-->`);

function beginMarker(version) {
  return `<!-- ${BLOCK_NAME} v=${version} -->`;
}

const END_MARKER = `<!-- /${BLOCK_NAME} -->`;

/**
 * Wrap a section body in stamped markers — the canonical emitted form.
 */
function renderBlock(body, version) {
  return `${beginMarker(version)}\n${body}\n${END_MARKER}`;
}

/**
 * Locate the managed block. Returns { start, end, version } — start/end are
 * offsets spanning the markers inclusive — or null when there is no
 * well-formed block (absent, begin without end, end before begin). Malformed
 * markers are deliberately reported as "no block": the legacy gate below
 * cannot match a marker-polluted section, so a corrupted file is left alone.
 */
function findBlock(text) {
  if (typeof text !== 'string') return null;
  const begin = BEGIN_MARKER_RE.exec(text);
  if (!begin) return null;
  const afterBegin = begin.index + begin[0].length;
  const end = END_MARKER_RE.exec(text.slice(afterBegin));
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

    // Section ends at the next heading of the same or higher level, or EOF.
    const boundary = new RegExp(`^#{1,${level}}\\s`, 'm');
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
 * Compute the upgraded document text, or null when nothing may change.
 *
 *   - markers present, stamped >= version → null (current or newer)
 *   - markers present, stamped < version  → block replaced in place
 *   - no markers → one-time legacy migration when a matcher passes the
 *     confidence gate; otherwise null
 *
 * options: { body, version, legacyMatchers } — body is the new section text
 * (unwrapped), legacyMatchers an array of full shipped section texts
 * (heading included).
 */
function upgradeDoc(text, options) {
  if (typeof text !== 'string' || !options || typeof options.body !== 'string') return null;
  const version = options.version;
  if (!Number.isInteger(version)) return null;

  const block = findBlock(text);
  if (block) {
    if (block.version >= version) return null;
    return text.slice(0, block.start) + renderBlock(options.body, version) + text.slice(block.end);
  }

  // Any marker fragment without a well-formed block means corrupted Frame
  // state or user surgery — never migrate around it.
  if (BEGIN_MARKER_RE.test(text) || END_MARKER_RE.test(text)) return null;

  for (const matcher of options.legacyMatchers || []) {
    const span = findLegacySpan(text, matcher);
    if (span) {
      return text.slice(0, span.start) + renderBlock(options.body, version) + text.slice(span.end);
    }
  }
  return null;
}

module.exports = {
  findBlock,
  upgradeDoc,
  renderBlock,
  BLOCK_NAME,
  END_MARKER
};
