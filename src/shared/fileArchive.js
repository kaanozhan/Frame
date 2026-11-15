/**
 * fileArchive — the archive that carries git-ignored files from the desktop
 * to Frame Server (server-copy-files).
 *
 * A tiny format of our own rather than `tar`: bsdtar (macOS) and GNU tar
 * (Linux) differ, and every path must be checked before anything is written.
 * Layout, gzip-compressed:
 *
 *   MAGIC
 *   for each entry:  uint32 BE header length · header JSON · `size` bytes
 *   header:          { path, type: 'file'|'symlink', mode, size, target? }
 *
 * `checkEntries` is the guard the server runs on the whole archive before it
 * writes a single byte: one bad entry refuses everything.
 */

const zlib = require('zlib');
const path = require('path');

const MAGIC = Buffer.from('FRAME-FILES/1\n');
// The desktop refuses selections above 1 GB (server-copy-files B3); this is
// the reader's own ceiling on what it will inflate.
const MAX_INFLATED = 1100 * 1024 * 1024;

/**
 * Build an archive.
 * entries: [{ path, type: 'file', mode, data: Buffer } | { path, type: 'symlink', mode, target }]
 */
function pack(entries) {
  const parts = [MAGIC];
  for (const e of entries) {
    const data = e.type === 'file' ? Buffer.from(e.data || []) : Buffer.alloc(0);
    const header = { path: e.path, type: e.type, mode: e.mode == null ? 0o644 : e.mode, size: data.length };
    if (e.type === 'symlink') header.target = e.target;
    const json = Buffer.from(JSON.stringify(header));
    const len = Buffer.alloc(4);
    len.writeUInt32BE(json.length, 0);
    parts.push(len, json, data);
  }
  return zlib.gzipSync(Buffer.concat(parts));
}

/** Parse an archive into `[{ path, type, mode, size, data?, target? }]`; throws on anything malformed. */
function readEntries(archive) {
  let raw;
  try {
    raw = zlib.gunzipSync(archive, { maxOutputLength: MAX_INFLATED });
  } catch (err) {
    throw new Error(`Not a readable file archive (${err.code || err.message}).`);
  }
  if (raw.length < MAGIC.length || !raw.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Not a Frame file archive.');
  }
  const out = [];
  let at = MAGIC.length;
  while (at < raw.length) {
    if (at + 4 > raw.length) throw new Error('The file archive is truncated.');
    const len = raw.readUInt32BE(at);
    at += 4;
    if (len === 0 || at + len > raw.length) throw new Error('The file archive is truncated.');
    let header;
    try {
      header = JSON.parse(raw.subarray(at, at + len).toString('utf8'));
    } catch (_) {
      throw new Error('The file archive has an unreadable entry.');
    }
    at += len;
    const size = Number(header.size);
    if (!Number.isInteger(size) || size < 0 || at + size > raw.length) throw new Error('The file archive is truncated.');
    const entry = { path: header.path, type: header.type, mode: header.mode, size };
    if (header.type === 'file') entry.data = raw.subarray(at, at + size);
    if (header.type === 'symlink') entry.target = header.target;
    at += size;
    out.push(entry);
  }
  return out;
}

/** Why `p` is not a safe relative path, or null. */
function pathProblem(p) {
  if (typeof p !== 'string' || !p) return 'empty path';
  if (p.includes('\0')) return 'NUL in path';
  if (p.includes('\\')) return 'backslash in path';
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return 'absolute path';
  if (path.posix.normalize(p) !== p || p.endsWith('/')) return 'path is not normalized';
  const segments = p.split('/');
  if (segments.includes('..') || segments.includes('.')) return 'path leaves its folder';
  if (segments[0] === '.git') return 'path inside .git';
  return null;
}

/**
 * The first entry that must not be written, as `{ path, reason }`, or null
 * when every entry is safe. Checked against the archive alone: paths are
 * relative, normalized, outside `.git`, unique; symlinks point inside.
 */
function checkEntries(entries) {
  const seen = new Set();
  for (const e of entries || []) {
    const where = e && typeof e.path === 'string' ? e.path : String(e && e.path);
    const problem = pathProblem(e && e.path);
    if (problem) return { path: where, reason: problem };
    if (seen.has(e.path)) return { path: where, reason: 'duplicate path' };
    seen.add(e.path);
    if (e.type !== 'file' && e.type !== 'symlink') return { path: where, reason: 'unknown entry type' };
    if (!Number.isInteger(e.mode) || e.mode < 0 || e.mode > 0o7777) return { path: where, reason: 'bad file mode' };
    if (e.type === 'symlink') {
      const t = e.target;
      if (typeof t !== 'string' || !t || t.includes('\0')) return { path: where, reason: 'bad symlink target' };
      if (t.startsWith('/') || /^[A-Za-z]:/.test(t)) return { path: where, reason: 'symlink points outside' };
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(e.path), t));
      if (resolved === '..' || resolved.startsWith('../')) return { path: where, reason: 'symlink points outside' };
      if (resolved === '.git' || resolved.startsWith('.git/')) return { path: where, reason: 'symlink points into .git' };
    }
  }
  return null;
}

module.exports = { pack, readEntries, checkEntries, pathProblem, MAGIC };
