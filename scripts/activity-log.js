/**
 * Activity log — the append contract.
 *
 * Frame does a lot of work nobody sees, and roughly half of it does not run
 * in Frame's process at all: the git pre-commit hook, Claude Code's tool
 * hooks, the orchestration bus, and `implement-launch.js`, which runs with
 * the app closed. So the sink is a *file contract* rather than a module —
 * this file is required both by `src/main/activityLog.js` and, once copied
 * into a project's `.frame/bin/`, by the out-of-process scripts.
 *
 * Where: `~/.frame/activity/<bucket>/activity.jsonl`, outside the repository.
 * Frame never edits a project's `.gitignore`, so an in-repo record would
 * dirty the user's `git status` on every watcher fire. `promptLogger` already
 * keeps churny personal logs under `~/.frame/`.
 *
 * Bucket is `app` for work that belongs to no project, otherwise a key
 * derived from the project's **absolute** path — `promptLogger` keys by
 * basename today, so `~/work/api` and `~/clients/acme/api` share one file.
 *
 * Contract for every writer:
 *   - best effort. `append` never throws and never writes to stdout, because
 *     its hosts are a git commit and a tool call that must not fail over
 *     telemetry-shaped bookkeeping.
 *   - no free-form strings. Callers pass enum reason codes, counts,
 *     durations and project-relative paths; `redact()` runs anyway as
 *     belt-and-braces, never as the only defence.
 *   - one line stays under 4 KB so a single O_APPEND write is atomic on
 *     POSIX when the app, a git hook and a Claude hook all append at once.
 *     (Windows offers no equivalent guarantee — see audit-q3-cross-platform.)
 *
 * Node 18, no dependencies.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { redact } = require('./redact');

const APP_BUCKET = 'app';
const FILE_NAME = 'activity.jsonl';
const ARCHIVE_NAME = 'activity.jsonl.1';
const SCHEMA_VERSION = 1;

// Rotate at 2 MB into a single generation, and sweep buckets untouched for
// 7 days. Two rules because they fail differently: rotation alone leaves
// months of noise in a quiet project, a time window alone leaves disk
// unbounded on a busy day. The 7 days is spec-hint.js's STATE_TTL_MS, not a
// second retention constant.
const MAX_BYTES = 2 * 1024 * 1024;
const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

// Below the 4 KB POSIX atomic-append threshold, with room for the newline.
const MAX_LINE_BYTES = 3800;
const MAX_VALUE_CHARS = 400;

/** Root of the record. `FRAME_ACTIVITY_HOME` exists so tests can redirect it. */
function activityRoot() {
  if (process.env.FRAME_ACTIVITY_HOME) return process.env.FRAME_ACTIVITY_HOME;
  return path.join(os.homedir(), '.frame', 'activity');
}

/**
 * Stable bucket key for a project. The readable basename is a convenience
 * for anyone browsing the directory; the hash of the absolute path is what
 * actually makes it unique.
 */
function projectKey(projectPath) {
  if (!projectPath) return APP_BUCKET;
  const abs = path.resolve(projectPath);
  const hash = crypto.createHash('sha1').update(abs).digest('hex').slice(0, 10);
  const name = path.basename(abs).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 40) || 'project';
  return `${name}-${hash}`;
}

function bucketDir(bucket) {
  return path.join(activityRoot(), bucket || APP_BUCKET);
}

function filePath(bucket) {
  return path.join(bucketDir(bucket), FILE_NAME);
}

/**
 * Redact and bound one field value. Objects are rejected outright — the
 * registry only ever passes scalars, and allowing nesting is how a payload
 * eventually sneaks in.
 */
function sanitizeValue(value) {
  if (typeof value === 'string') {
    const clean = redact(value);
    return clean.length > MAX_VALUE_CHARS ? `${clean.slice(0, MAX_VALUE_CHARS)}…` : clean;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  return undefined;
}

/**
 * Pure: turn a record into the line that will be appended, or null when
 * there is nothing worth writing. Exported so the shape can be tested
 * without touching a filesystem.
 */
function buildLine(record, nowIso) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  if (typeof record.ev !== 'string' || !record.ev) return null;

  const out = { t: nowIso || new Date().toISOString(), v: SCHEMA_VERSION };
  for (const [key, value] of Object.entries(record)) {
    if (key === 't' || key === 'v') continue;
    const clean = sanitizeValue(value);
    if (clean !== undefined) out[key] = clean;
  }

  let line = JSON.stringify(out);
  if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
    // Something slipped past the per-value cap (many fields, wide unicode).
    // Keep the identifying fields and drop the rest rather than write a line
    // that could interleave with a concurrent writer's.
    const minimal = { t: out.t, v: out.v, ev: out.ev, truncated: true };
    if (out.src) minimal.src = out.src;
    if (out.kind) minimal.kind = out.kind;
    line = JSON.stringify(minimal);
  }
  return line;
}

/** Rotate when the live file has outgrown the cap. Best effort. */
function rotateIfNeeded(bucket) {
  const live = filePath(bucket);
  try {
    if (fs.statSync(live).size < MAX_BYTES) return;
  } catch {
    return; // no file yet
  }
  try {
    fs.rmSync(path.join(bucketDir(bucket), ARCHIVE_NAME), { force: true });
    fs.renameSync(live, path.join(bucketDir(bucket), ARCHIVE_NAME));
  } catch {
    /* rotation must never cost an event */
  }
}

/**
 * Append synchronously. Used by the short-lived out-of-process scripts,
 * where a promise would outlive the process. Returns true when a line
 * landed — callers ignore it; it exists for the tests.
 */
function appendSync(bucket, record) {
  try {
    const line = buildLine(record);
    if (!line) return false;
    const dir = bucketDir(bucket);
    fs.mkdirSync(dir, { recursive: true });
    rotateIfNeeded(bucket);
    fs.appendFileSync(path.join(dir, FILE_NAME), `${line}\n`);
    return true;
  } catch {
    return false; // never throw: the host is a commit or a tool call
  }
}

/**
 * Append without blocking. Used by the main process, where sync filesystem
 * work on a hot path is against the standing performance budget. Never
 * rejects.
 */
async function append(bucket, record) {
  try {
    const line = buildLine(record);
    if (!line) return false;
    const dir = bucketDir(bucket);
    await fs.promises.mkdir(dir, { recursive: true });
    rotateIfNeeded(bucket);
    await fs.promises.appendFile(path.join(dir, FILE_NAME), `${line}\n`);
    return true;
  } catch {
    return false;
  }
}

function parseLines(text, into) {
  for (const raw of text.split('\n')) {
    if (!raw) continue;
    try {
      into.push(JSON.parse(raw));
    } catch {
      /* a torn or malformed line costs that line, not the read */
    }
  }
  return into;
}

/**
 * Newest-last window over a bucket, reaching into the rotated generation
 * when the live file alone cannot fill it. Malformed lines are skipped.
 */
function readRecent(bucket, limit = 500) {
  const records = [];
  try {
    const live = fs.readFileSync(filePath(bucket), 'utf8');
    parseLines(live, records);
  } catch {
    /* nothing live yet */
  }
  if (records.length < limit) {
    try {
      const archived = fs.readFileSync(path.join(bucketDir(bucket), ARCHIVE_NAME), 'utf8');
      const older = parseLines(archived, []);
      records.unshift(...older);
    } catch {
      /* no archive */
    }
  }
  return records.slice(-limit);
}

/** Drop buckets nothing has written to in PRUNE_AFTER_MS. Best effort. */
function prune(now = Date.now()) {
  let removed = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(activityRoot());
  } catch {
    return removed;
  }
  for (const entry of entries) {
    const dir = path.join(activityRoot(), entry);
    try {
      const stale = fs.readdirSync(dir).every((f) => {
        const st = fs.statSync(path.join(dir, f));
        return now - st.mtimeMs > PRUNE_AFTER_MS;
      });
      if (stale) {
        fs.rmSync(dir, { recursive: true, force: true });
        removed += 1;
      }
    } catch {
      /* skip anything unreadable */
    }
  }
  return removed;
}

module.exports = {
  APP_BUCKET,
  SCHEMA_VERSION,
  MAX_BYTES,
  MAX_LINE_BYTES,
  PRUNE_AFTER_MS,
  activityRoot,
  projectKey,
  bucketDir,
  filePath,
  buildLine,
  append,
  appendSync,
  readRecent,
  prune
};
