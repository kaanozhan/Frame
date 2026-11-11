/**
 * reviewModel — the rules behind a workspace review (workspace-review spec).
 *
 * A review lists every file a workspace changes since the merge base with
 * its base branch — committed, uncommitted and untracked — lets the user
 * tick files as viewed (a tick drops when the file's content changes),
 * comment on new-side lines, and send the comments to an agent as one
 * prompt. This module turns git's `-z` output into review files and decides
 * the viewed state and the prompt text. Pure: strings and plain values only.
 */

/** Diffs above this many bytes show a placeholder instead of rendering. */
const MAX_DIFF_BYTES = 2 * 1024 * 1024;

function nulFields(stdout) {
  const parts = String(stdout || '').split('\0');
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/**
 * `git diff -z --numstat <base>` → `[{ path, oldPath?, added, removed, binary }]`.
 * A normal entry is `added\tremoved\tpath\0`; a rename is
 * `added\tremoved\t\0old\0new\0`; binary files report `-\t-`.
 */
function parseNumstat(stdout) {
  const fields = nulFields(stdout);
  const out = [];
  for (let i = 0; i < fields.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(fields[i]);
    if (!m) continue;
    const binary = m[1] === '-' || m[2] === '-';
    const entry = {
      added: binary ? 0 : parseInt(m[1], 10),
      removed: binary ? 0 : parseInt(m[2], 10),
      binary
    };
    if (m[3] === '') {
      entry.oldPath = fields[i + 1];
      entry.path = fields[i + 2];
      i += 2;
    } else {
      entry.path = m[3];
    }
    if (entry.path) out.push(entry);
  }
  return out;
}

/**
 * `git diff -z --name-status <base>` → `{ [path]: { status, oldPath? } }`.
 * Status letters A/M/D/T, and R/C with a similarity score and two paths.
 */
function parseNameStatus(stdout) {
  const fields = nulFields(stdout);
  const out = {};
  for (let i = 0; i < fields.length; i++) {
    const code = fields[i];
    if (!/^[A-Z]\d*$/.test(code)) continue;
    const letter = code[0];
    if (letter === 'R' || letter === 'C') {
      const oldPath = fields[i + 1];
      const path = fields[i + 2];
      if (path) out[path] = { status: letter === 'R' ? 'R' : 'A', oldPath };
      i += 2;
    } else {
      const path = fields[i + 1];
      if (path) out[path] = { status: letter === 'T' ? 'M' : letter };
      i += 1;
    }
  }
  return out;
}

/**
 * The review's file list: tracked changes (numstat + name-status) plus
 * untracked files, each with its content hash (null when the file is gone).
 * Sorted by path so the list reads like a tree.
 *
 * @param {{ numstat: string, nameStatus: string, untracked: string[], hashes: Object<string,string>,
 *           untrackedLines?: Object<string,number> }} input
 * @returns {Array<{ path, oldPath?, status, added, removed, binary, hash }>}
 */
function mergeChangedFiles({ numstat = '', nameStatus = '', untracked = [], hashes = {}, untrackedLines = {} } = {}) {
  const statuses = parseNameStatus(nameStatus);
  const files = [];
  const seen = new Set();
  for (const n of parseNumstat(numstat)) {
    const s = statuses[n.path] || { status: n.oldPath ? 'R' : 'M' };
    files.push({
      path: n.path,
      ...(n.oldPath || s.oldPath ? { oldPath: n.oldPath || s.oldPath } : {}),
      status: s.status,
      added: n.added,
      removed: n.removed,
      binary: n.binary,
      hash: s.status === 'D' ? null : (hashes[n.path] || null)
    });
    seen.add(n.path);
  }
  for (const path of untracked || []) {
    if (!path || seen.has(path)) continue;
    files.push({ path, status: 'U', added: untrackedLines[path] || 0, removed: 0, binary: false, hash: hashes[path] || null });
    seen.add(path);
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Keep only viewed ticks that still describe the file on disk: the path is
 * still in the review and its content hash is unchanged. `viewed` is
 * `{ [path]: hash }`; returns a new object.
 */
function reconcileViewed(files, viewed) {
  const byPath = new Map((files || []).map((f) => [f.path, f]));
  const out = {};
  for (const [path, hash] of Object.entries(viewed || {})) {
    const f = byPath.get(path);
    if (f && f.hash === hash) out[path] = hash;
  }
  return out;
}

/** `{ total, viewed, remaining }` for the header. */
function viewedSummary(files, viewed) {
  const total = (files || []).length;
  const v = (files || []).filter((f) => viewed && Object.prototype.hasOwnProperty.call(viewed, f.path) && viewed[f.path] === f.hash).length;
  return { total, viewed: v, remaining: total - v };
}

/**
 * Where a click in the diff points: the new-side line number and its code.
 * `newLine` is the text of the new-side line-number cell (may be blank for a
 * deleted line); `code` is the row's code text (diff2html prefixes +/-/space).
 * Returns null for lines that only exist on the old side.
 */
function lineAnchor({ newLine, code }) {
  const n = parseInt(String(newLine == null ? '' : newLine).trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const text = String(code == null ? '' : code).replace(/^[+\- ]/, '').replace(/\s+$/, '');
  return { line: n, text };
}

/**
 * The prompt that carries a review to the agent: one entry per comment
 * (path:line, the quoted line, the comment), in file and line order.
 */
function composeReviewPrompt({ branch, comments = [] }) {
  const sorted = (comments || []).slice().sort((a, b) => (a.path === b.path ? a.line - b.line : a.path.localeCompare(b.path)));
  const lines = [`Review comments on this workspace's changes (branch \`${branch}\`). Address each one:`, ''];
  sorted.forEach((c, i) => {
    lines.push(`${i + 1}. ${c.path}:${c.line}${c.outdated ? ' (outdated — the line changed since this comment)' : ''}`);
    if (c.text) lines.push(`   > ${c.text}`);
    lines.push(`   ${String(c.body || '').trim().replace(/\n+/g, ' ')}`);
    lines.push('');
  });
  lines.push('When done, run the project\'s tests and commit. Do not push — the user pushes from Frame.');
  return lines.join('\n');
}

// ─── workspace-hardening (R4, R5, R9, R14) ──────────────────

/**
 * Apply a REVIEW_FILES reply. A failed load keeps what is shown — files,
 * viewed ticks and merge base — and reports the error (R4); a good one
 * replaces the list and keeps only ticks whose content is unchanged.
 */
function applyFileList(prev, res) {
  const before = prev || {};
  if (!res || res.error) {
    return {
      files: before.files || [],
      viewed: before.viewed || {},
      mergeBase: before.mergeBase || null,
      error: (res && res.error) || 'Could not load the changes.'
    };
  }
  const files = res.files || [];
  return { files, viewed: reconcileViewed(files, before.viewed || {}), mergeBase: res.mergeBase || null, error: '' };
}

/** Comments still pending after a send: the ones it did not carry (R5). */
function remainingAfterSend(comments, sentIds) {
  const sent = new Set(sentIds || []);
  return (comments || []).filter((c) => !sent.has(c.id));
}

/** New-side lines of a unified diff: Map(line number → text without the +/space prefix). */
function newSideLines(diffText) {
  const out = new Map();
  let line = 0;
  let inHunk = false;
  for (const raw of String(diffText || '').split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) { line = parseInt(hunk[1], 10); inHunk = true; continue; }
    if (!inHunk) continue;
    if (raw.startsWith('diff --git')) { inHunk = false; continue; }
    if (raw.startsWith('+') || raw.startsWith(' ')) {
      out.set(line, raw.slice(1).replace(/\s+$/, ''));
      line += 1;
    }
    // '-' lines are old-side only; '\ No newline' is a marker.
  }
  return out;
}

/**
 * Re-anchor `path`'s comments after its diff reloads (R9): a comment whose
 * line still holds its quoted text stays; one whose text moved follows it
 * (nearest match); one whose text is gone is marked outdated and is sent
 * flagged. Comments with no quoted text keep their line.
 */
function reanchor(comments, path, lines) {
  return (comments || []).map((c) => {
    if (c.path !== path || !c.text) return c;
    if (lines.get(c.line) === c.text) {
      if (!c.outdated) return c;
      const { outdated, ...rest } = c;
      return rest;
    }
    let best = null;
    for (const [n, text] of lines) {
      if (text !== c.text) continue;
      if (best === null || Math.abs(n - c.line) < Math.abs(best - c.line)) best = n;
    }
    if (best !== null) {
      const { outdated, ...rest } = c;
      return { ...rest, line: best };
    }
    return c.outdated ? c : { ...c, outdated: true };
  });
}

/**
 * Drop `projectPath`'s per-workspace keys (`<projectPath>#<id>`) whose
 * workspace is not in `liveIds` (R14). The bare project key (main) and other
 * projects' keys stay. Returns a new object.
 */
function pruneScopes(all, projectPath, liveIds) {
  const live = new Set(liveIds || []);
  const prefix = `${projectPath}#`;
  const out = {};
  for (const [key, value] of Object.entries(all || {})) {
    if (key.startsWith(prefix) && !live.has(key.slice(prefix.length))) continue;
    out[key] = value;
  }
  return out;
}

module.exports = {
  applyFileList,
  remainingAfterSend,
  newSideLines,
  reanchor,
  pruneScopes,
  MAX_DIFF_BYTES,
  parseNumstat,
  parseNameStatus,
  mergeChangedFiles,
  reconcileViewed,
  viewedSummary,
  lineAnchor,
  composeReviewPrompt
};
