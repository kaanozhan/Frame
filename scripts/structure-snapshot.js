/**
 * STRUCTURE snapshot — content identity for the working tree (STR-02).
 *
 * Discovery (structure-discovery.js) says which files are eligible; this
 * module says what they contain, cheaply enough to run on every settled
 * burst of edits:
 *
 *   manifest   `.frame/runtime/structure/manifest.json`
 *              path → { size, mtimeMs, ctimeMs, ino, sha256 }
 *              A file whose stat is unchanged reuses its recorded hash — an
 *              optimization only. A full-hash pass (periodic reconciliation)
 *              rehashes everything, which is what catches an edit that kept
 *              size and timestamps.
 *   mixed      The filesystem is not an atomic snapshot. Each hashed file is
 *              re-stat'ed afterwards; a file that changed while being read,
 *              or vanished, marks the observation mixed. A mixed observation
 *              is never published as fresh — the caller retries.
 *   cache      Content-keyed extraction results in
 *              `.frame/runtime/structure/extract/`, bounded by total size with
 *              least-recently-used eviction. Keys include the extractors'
 *              own source digest and the parse limit, so a Frame upgrade or a
 *              policy change never reuses stale facts. Losing the cache only
 *              costs recomputation.
 *
 * Files larger than the parse limit are not hashed (their entries are
 * metadata-only anyway); their identity is their stat.
 *
 * Standalone: ships into `.frame/bin/` with the other structure helpers.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DEFAULT_LIMITS } = require('./structure-discovery');
const { extractFacts } = require('./structure-generation');

const MANIFEST_VERSION = 1;
const DEFAULT_CACHE_BYTES = 128 * 1024 * 1024;
const HASH_CHUNK = 64 * 1024;

function runtimeDir(root) {
  return path.join(root, '.frame', 'runtime', 'structure');
}

function manifestPath(root) {
  return path.join(runtimeDir(root), 'manifest.json');
}

function cacheDir(root) {
  return path.join(runtimeDir(root), 'extract');
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function statIdentity(stat) {
  return { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino };
}

function sameStat(a, b) {
  return Boolean(a) && Boolean(b)
    && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.ino === b.ino;
}

function writeJsonAtomic(fsImpl, file, value) {
  fsImpl.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fsImpl.writeFileSync(tmp, JSON.stringify(value));
  fsImpl.renameSync(tmp, file);
}

/* ------------------------------ manifest ----------------------------- */

function emptyManifest() {
  return { version: MANIFEST_VERSION, entries: {} };
}

/** The recorded manifest, or an empty one when missing or unreadable. */
function loadManifest(root, fsImpl = fs) {
  try {
    const data = JSON.parse(fsImpl.readFileSync(manifestPath(root), 'utf8'));
    if (data && data.version === MANIFEST_VERSION && data.entries && typeof data.entries === 'object') {
      const entries = Object.create(null);
      for (const [key, value] of Object.entries(data.entries)) entries[key] = value;
      return { version: MANIFEST_VERSION, entries };
    }
  } catch (e) {
    /* missing or corrupt: recompute */
  }
  return emptyManifest();
}

function saveManifest(root, manifest, fsImpl = fs) {
  writeJsonAtomic(fsImpl, manifestPath(root), manifest);
}

/** Stream a file through SHA-256 without holding it in memory. */
function hashFile(fsImpl, absPath) {
  const hash = crypto.createHash('sha256');
  const fd = fsImpl.openSync(absPath, 'r');
  try {
    const buf = Buffer.alloc(HASH_CHUNK);
    let read;
    let position = 0;
    do {
      read = fsImpl.readSync(fd, buf, 0, HASH_CHUNK, position);
      if (read > 0) hash.update(buf.subarray(0, read));
      position += read;
    } while (read > 0);
  } finally {
    fsImpl.closeSync(fd);
  }
  return hash.digest('hex');
}

/**
 * Hash the discovered files into a new manifest.
 *
 * options:
 *   manifest      the previous manifest (stat-gated reuse)
 *   fullHash      rehash every file regardless of stat
 *   maxParseBytes files above it are identified by stat, not hashed
 *   fs, shouldStop  injection points; shouldStop() → true aborts (partial)
 *
 * Returns { manifest, sourceDigest, changed, removed, mixed, hashed, reused,
 * stopped }. `changed` lists paths whose content identity differs from the
 * previous manifest; `mixed` lists paths that changed or vanished while
 * being observed.
 */
function observe(root, discovery, options = {}) {
  const fsImpl = options.fs || fs;
  const previous = options.manifest || emptyManifest();
  const limit = options.maxParseBytes
    || (discovery.policy && discovery.policy.limits && discovery.policy.limits.maxParseBytes)
    || DEFAULT_LIMITS.maxParseBytes;
  const entries = Object.create(null);
  const changed = [];
  const mixed = [];
  let hashed = 0;
  let reused = 0;
  let stopped = false;

  for (const record of discovery.files) {
    if (options.shouldStop && options.shouldStop()) {
      stopped = true;
      break;
    }
    const abs = path.join(root, ...record.path.split('/'));
    let before;
    try {
      before = fsImpl.lstatSync(abs);
    } catch (e) {
      mixed.push(record.path); // listed by discovery, gone now
      continue;
    }
    const prior = previous.entries[record.path];
    let sha;
    if (before.size > limit) {
      sha = `stat:${before.size}:${before.mtimeMs}`;
    } else if (!options.fullHash && prior && sameStat(prior, before) && typeof prior.sha256 === 'string') {
      sha = prior.sha256;
      reused++;
    } else {
      try {
        sha = hashFile(fsImpl, abs);
        hashed++;
      } catch (e) {
        mixed.push(record.path);
        continue;
      }
      let after;
      try {
        after = fsImpl.lstatSync(abs);
      } catch (e) {
        after = null;
      }
      if (!sameStat(statIdentity(before), after && statIdentity(after))) {
        mixed.push(record.path);
        continue;
      }
    }
    entries[record.path] = { ...statIdentity(before), sha256: sha };
    if (!prior || prior.sha256 !== sha) changed.push(record.path);
  }

  const removed = stopped ? [] : Object.keys(previous.entries).filter((p) => !(p in entries) && !mixed.includes(p));
  const lines = Object.keys(entries).sort().map((p) => `${p}\0${entries[p].sha256}\n`);
  return {
    manifest: { version: MANIFEST_VERSION, entries },
    sourceDigest: sha256(lines.join('')),
    changed,
    removed,
    mixed,
    hashed,
    reused,
    stopped
  };
}

/* --------------------------- extraction cache ------------------------ */

let extractorsDigestMemo = null;

/** Digest of the extractor sources this installation runs. */
function extractorsDigest() {
  if (extractorsDigestMemo) return extractorsDigestMemo;
  const hash = crypto.createHash('sha256');
  const langDir = path.join(__dirname, 'lang');
  let names = [];
  try {
    names = fs.readdirSync(langDir).filter((f) => f.endsWith('.js')).sort();
  } catch (e) {
    /* no extractors: key on the generator alone */
  }
  for (const name of names) hash.update(`${name}\0`).update(fs.readFileSync(path.join(langDir, name)));
  try {
    hash.update(fs.readFileSync(path.join(__dirname, 'structure-generation.js')));
  } catch (e) {
    /* ignore */
  }
  extractorsDigestMemo = hash.digest('hex');
  return extractorsDigestMemo;
}

/**
 * A content-keyed extraction cache bound to one observation's manifest.
 *
 * `extract(record, options)` has buildFull's extractor signature. It reuses a
 * cached result when the file's manifest hash is known; otherwise it runs
 * extractFacts, hashes the bytes it actually parsed, and stores the result
 * only when they match the manifest — a file edited between hashing and
 * parsing is reported in `mixed` and never cached under the wrong key.
 * Transient read errors are not cached.
 */
function createExtractionCache(root, manifest, options = {}) {
  const fsImpl = options.fs || fs;
  const dir = cacheDir(root);
  const maxBytes = options.maxBytes || DEFAULT_CACHE_BYTES;
  const now = options.now || Date.now;
  const stats = { hits: 0, misses: 0, stored: 0 };
  const mixed = [];

  const keyFor = (sha, maxParseBytes) => sha256(`${extractorsDigest()}\0${maxParseBytes}\0${sha}`);

  function extract(record, extractOptions) {
    const entry = manifest.entries[record.path];
    const sha = entry && typeof entry.sha256 === 'string' && !entry.sha256.startsWith('stat:') ? entry.sha256 : null;
    const maxParseBytes = extractOptions.maxParseBytes || DEFAULT_LIMITS.maxParseBytes;
    const file = sha ? path.join(dir, `${keyFor(sha, maxParseBytes)}.json`) : null;

    if (file) {
      try {
        const cached = JSON.parse(fsImpl.readFileSync(file, 'utf8'));
        if (cached && cached.facts && cached.extraction) {
          const t = new Date(now());
          try { fsImpl.utimesSync(file, t, t); } catch (e) { /* recency is best-effort */ }
          stats.hits++;
          return cached;
        }
      } catch (e) {
        /* miss */
      }
    }

    stats.misses++;
    let parsed = null;
    const capturing = {
      ...fsImpl,
      readFileSync: (p, ...rest) => {
        const buf = fsImpl.readFileSync(p, ...rest);
        parsed = buf;
        return buf;
      }
    };
    const result = extractFacts(extractOptions.rootDir, record, { ...extractOptions, fs: capturing });
    if (!sha || !parsed) return result;
    if (sha256(parsed) !== sha) {
      mixed.push(record.path);
      return result;
    }
    if (result.extraction.reason === 'read-error') return result;
    try {
      writeJsonAtomic(fsImpl, file, result);
      stats.stored++;
    } catch (e) {
      /* a cache that cannot be written only costs time */
    }
    return result;
  }

  /** Evict least-recently-used entries until the cache fits its bound. */
  function prune() {
    let names;
    try {
      names = fsImpl.readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch (e) {
      return { evicted: 0, bytes: 0 };
    }
    const files = [];
    let total = 0;
    for (const name of names) {
      try {
        const st = fsImpl.statSync(path.join(dir, name));
        files.push({ name, size: st.size, used: st.mtimeMs });
        total += st.size;
      } catch (e) {
        /* raced away */
      }
    }
    files.sort((a, b) => a.used - b.used || (a.name < b.name ? -1 : 1));
    let evicted = 0;
    for (const f of files) {
      if (total <= maxBytes) break;
      try {
        fsImpl.unlinkSync(path.join(dir, f.name));
        total -= f.size;
        evicted++;
      } catch (e) {
        /* ignore */
      }
    }
    return { evicted, bytes: total };
  }

  return { extract, prune, stats, mixed };
}

module.exports = {
  observe,
  loadManifest,
  saveManifest,
  createExtractionCache,
  extractorsDigest,
  manifestPath,
  cacheDir,
  DEFAULT_CACHE_BYTES
};
