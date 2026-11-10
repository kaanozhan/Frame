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
    lines.push(`${i + 1}. ${c.path}:${c.line}`);
    if (c.text) lines.push(`   > ${c.text}`);
    lines.push(`   ${String(c.body || '').trim().replace(/\n+/g, ' ')}`);
    lines.push('');
  });
  lines.push('When done, run the project\'s tests and commit. Do not push — the user pushes from Frame.');
  return lines.join('\n');
}

module.exports = {
  MAX_DIFF_BYTES,
  parseNumstat,
  parseNameStatus,
  mergeChangedFiles,
  reconcileViewed,
  viewedSummary,
  lineAnchor,
  composeReviewPrompt
};
