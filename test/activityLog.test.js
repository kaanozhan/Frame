/**
 * Activity log — the append contract.
 *
 * The record is written by four different host processes, one of which is a
 * git commit, so the properties that matter most here are the boring ones:
 * a bucket key that cannot collide, a line that stays small enough to append
 * atomically, bounded growth, and a writer that never throws whatever it is
 * handed.
 *
 * FRAME_ACTIVITY_HOME redirects the root so nothing touches the real
 * ~/.frame/activity while these run.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const activityLog = require('../scripts/activity-log');

let tmp;
let prevHome;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-activity-'));
  prevHome = process.env.FRAME_ACTIVITY_HOME;
  process.env.FRAME_ACTIVITY_HOME = tmp;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.FRAME_ACTIVITY_HOME;
  else process.env.FRAME_ACTIVITY_HOME = prevHome;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function readLive(bucket) {
  return fs.readFileSync(activityLog.filePath(bucket), 'utf8');
}

// ─── bucket keys ──────────────────────────────────────────

test('projectKey separates two projects that share a directory basename', () => {
  const a = activityLog.projectKey('/Users/x/work/api');
  const b = activityLog.projectKey('/Users/x/clients/acme/api');
  assert.notEqual(a, b, 'basename collision must not share a bucket');
  assert.ok(a.startsWith('api-') && b.startsWith('api-'), 'readable prefix kept');
});

test('projectKey is stable for the same path and normalizes it', () => {
  const direct = activityLog.projectKey('/Users/x/work/api');
  assert.equal(activityLog.projectKey('/Users/x/work/api'), direct);
  assert.equal(activityLog.projectKey('/Users/x/work/other/../api'), direct);
});

test('projectKey falls back to the app bucket with no project', () => {
  assert.equal(activityLog.projectKey(null), activityLog.APP_BUCKET);
});

// ─── the line ─────────────────────────────────────────────

test('buildLine stamps time and schema version and keeps scalar fields', () => {
  const line = activityLog.buildLine({ ev: 'watch.fired', src: 'spec-watcher', changes: 3, ok: true }, '2026-07-26T10:00:00.000Z');
  const rec = JSON.parse(line);
  assert.equal(rec.t, '2026-07-26T10:00:00.000Z');
  assert.equal(rec.v, activityLog.SCHEMA_VERSION);
  assert.equal(rec.ev, 'watch.fired');
  assert.equal(rec.changes, 3);
  assert.equal(rec.ok, true);
});

test('buildLine rejects records with no event name', () => {
  assert.equal(activityLog.buildLine({ src: 'x' }), null);
  assert.equal(activityLog.buildLine(null), null);
  assert.equal(activityLog.buildLine('nope'), null);
  assert.equal(activityLog.buildLine([1, 2]), null);
});

test('buildLine drops nested values so a payload cannot ride along', () => {
  const rec = JSON.parse(activityLog.buildLine({ ev: 'x', body: { secret: 'v' }, list: [1], keep: 2 }));
  assert.ok(!('body' in rec) && !('list' in rec), 'objects and arrays are not recorded');
  assert.equal(rec.keep, 2);
});

test('buildLine redacts secret-shaped values', () => {
  const rec = JSON.parse(activityLog.buildLine({ ev: 'x', note: 'token=sk-ant-api03-AbCdEf0123456789' }));
  assert.ok(!rec.note.includes('sk-ant-api03-AbCdEf0123456789'), `secret leaked: ${rec.note}`);
  assert.ok(rec.note.includes('[REDACTED]'));
});

test('buildLine stays under the atomic-append cap even when handed junk', () => {
  const line = activityLog.buildLine({ ev: 'x', a: 'y'.repeat(9000), b: 'z'.repeat(9000), c: 'w'.repeat(9000) });
  assert.ok(Buffer.byteLength(line) <= activityLog.MAX_LINE_BYTES, `line too long: ${Buffer.byteLength(line)}`);
  const rec = JSON.parse(line);
  assert.equal(rec.ev, 'x', 'identity survives truncation');
});

// ─── appending ────────────────────────────────────────────

test('appendSync writes one parseable line per call', () => {
  activityLog.appendSync('proj', { ev: 'a', src: 's' });
  activityLog.appendSync('proj', { ev: 'b', src: 's' });
  const lines = readLive('proj').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).ev, 'a');
  assert.equal(JSON.parse(lines[1]).ev, 'b');
});

test('append (async) writes without throwing and lands the same shape', async () => {
  const ok = await activityLog.append('proj', { ev: 'async', src: 's' });
  assert.equal(ok, true);
  assert.equal(JSON.parse(readLive('proj').trim()).ev, 'async');
});

// ─── never break the host ─────────────────────────────────

test('append never throws: unwritable root, junk input, missing bucket', async () => {
  const blocked = path.join(tmp, 'blocked');
  fs.writeFileSync(blocked, 'not a directory');
  process.env.FRAME_ACTIVITY_HOME = blocked; // mkdir under a file fails
  assert.equal(activityLog.appendSync('proj', { ev: 'x' }), false);
  assert.equal(await activityLog.append('proj', { ev: 'x' }), false);

  process.env.FRAME_ACTIVITY_HOME = tmp;
  assert.equal(activityLog.appendSync('proj', null), false);
  assert.equal(activityLog.appendSync('proj', undefined), false);
  assert.equal(activityLog.appendSync(undefined, { ev: 'x' }), true, 'no bucket falls back to app');
});

// ─── bounded growth ───────────────────────────────────────

test('the live file rotates at the cap into a single generation', () => {
  const dir = activityLog.bucketDir('proj');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'activity.jsonl'), `${'x'.repeat(activityLog.MAX_BYTES)}\n`);
  activityLog.appendSync('proj', { ev: 'after-rotate' });

  const archive = fs.readFileSync(path.join(dir, 'activity.jsonl.1'), 'utf8');
  assert.ok(archive.length >= activityLog.MAX_BYTES, 'oversized file moved to the archive');
  const live = readLive('proj').trim();
  assert.equal(JSON.parse(live).ev, 'after-rotate', 'live file restarts with the new event');

  // A second rotation must not accumulate a third generation.
  fs.writeFileSync(path.join(dir, 'activity.jsonl'), `${'y'.repeat(activityLog.MAX_BYTES)}\n`);
  activityLog.appendSync('proj', { ev: 'again' });
  const generations = fs.readdirSync(dir).filter((f) => f.startsWith('activity.jsonl'));
  assert.deepEqual(generations.sort(), ['activity.jsonl', 'activity.jsonl.1']);
});

test('prune drops buckets untouched past the window and keeps fresh ones', () => {
  activityLog.appendSync('stale-bucket', { ev: 'old' });
  activityLog.appendSync('fresh-bucket', { ev: 'new' });

  const old = new Date(Date.now() - activityLog.PRUNE_AFTER_MS - 60_000);
  fs.utimesSync(activityLog.filePath('stale-bucket'), old, old);

  assert.equal(activityLog.prune(), 1);
  assert.ok(!fs.existsSync(activityLog.bucketDir('stale-bucket')));
  assert.ok(fs.existsSync(activityLog.filePath('fresh-bucket')));
});

// ─── reading back ─────────────────────────────────────────

test('readRecent returns newest-last, skips malformed lines, reaches the archive', () => {
  const dir = activityLog.bucketDir('proj');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'activity.jsonl.1'), `${JSON.stringify({ ev: 'archived', v: 1 })}\n`);
  activityLog.appendSync('proj', { ev: 'first' });
  fs.appendFileSync(path.join(dir, 'activity.jsonl'), '{ torn line\n');
  activityLog.appendSync('proj', { ev: 'second' });

  const recent = activityLog.readRecent('proj');
  assert.deepEqual(recent.map((r) => r.ev), ['archived', 'first', 'second']);
});

test('readRecent honors the limit and survives a bucket that does not exist', () => {
  for (let i = 0; i < 5; i++) activityLog.appendSync('proj', { ev: `e${i}` });
  assert.deepEqual(activityLog.readRecent('proj', 2).map((r) => r.ev), ['e3', 'e4']);
  assert.deepEqual(activityLog.readRecent('never-written'), []);
});
