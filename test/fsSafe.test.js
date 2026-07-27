/**
 * fsSafe tests — durable write / corruption recovery / watcher errors.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeFileAtomic, readJsonWithRecovery, safeWatch } = require('../src/main/fsSafe');

let dir;
let file;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fssafe-'));
  file = path.join(dir, 'state.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// ─── writeFileAtomic ──────────────────────────────────────

test('writeFileAtomic writes the file and leaves no .tmp behind', () => {
  writeFileAtomic(file, '{"a":1}');
  assert.equal(fs.readFileSync(file, 'utf8'), '{"a":1}');
  assert.ok(!fs.existsSync(file + '.tmp'));
  assert.ok(!fs.existsSync(file + '.bak'), 'first write has nothing to back up');
});

test('writeFileAtomic backs up the previous copy to .bak', () => {
  writeFileAtomic(file, '{"v":1}');
  writeFileAtomic(file, '{"v":2}');
  assert.equal(fs.readFileSync(file, 'utf8'), '{"v":2}');
  assert.equal(fs.readFileSync(file + '.bak', 'utf8'), '{"v":1}');
});

test('writeFileAtomic does not back up an empty file over a good .bak', () => {
  writeFileAtomic(file, '{"v":1}');
  writeFileAtomic(file, '{"v":2}'); // .bak = v1
  fs.writeFileSync(file, ''); // simulate truncation-to-empty
  writeFileAtomic(file, '{"v":3}');
  assert.equal(fs.readFileSync(file + '.bak', 'utf8'), '{"v":1}', 'empty file must not shadow the good .bak');
});

// ─── readJsonWithRecovery ─────────────────────────────────

test('readJsonWithRecovery parses a valid file', () => {
  writeFileAtomic(file, '{"ok":true}');
  const res = readJsonWithRecovery(file);
  assert.deepEqual(res.data, { ok: true });
  assert.equal(res.source, 'file');
  assert.equal(res.error, null);
});

test('readJsonWithRecovery treats a missing file as fresh start, not corruption', () => {
  const res = readJsonWithRecovery(file);
  assert.equal(res.data, null);
  assert.equal(res.source, null);
  assert.equal(res.error, null);
});

test('corrupt file with a good .bak: restores it and preserves the corrupt copy', () => {
  writeFileAtomic(file, '{"projects":["real"]}');
  writeFileAtomic(file, '{"projects":["real","newer"]}'); // .bak = ["real"]
  fs.writeFileSync(file, '{"projects":["real","new'); // mid-write kill

  const res = readJsonWithRecovery(file);
  assert.deepEqual(res.data, { projects: ['real'] });
  assert.equal(res.source, 'bak');
  assert.ok(res.error instanceof Error, 'parse error is reported');

  // live file restored to the good copy
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { projects: ['real'] });
  // corrupt original preserved aside, never deleted
  const corrupt = fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'));
  assert.equal(corrupt.length, 1);
  assert.ok(fs.readFileSync(path.join(dir, corrupt[0]), 'utf8').startsWith('{"projects":["real","new'));
});

test('corrupt file with no .bak: moved aside so a default save cannot clobber it', () => {
  fs.writeFileSync(file, '{"projects":["only-copy"'); // corrupt, no .bak
  const res = readJsonWithRecovery(file);
  assert.equal(res.data, null);
  assert.equal(res.source, null);
  assert.ok(res.error instanceof Error);

  assert.ok(!fs.existsSync(file), 'corrupt file no longer sits at the live path');
  const corrupt = fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'));
  assert.equal(corrupt.length, 1, 'corrupt copy is preserved aside');

  // the workspace.js scenario: falling back to a default and saving is now safe
  writeFileAtomic(file, '{"projects":[]}');
  assert.ok(fs.existsSync(path.join(dir, corrupt[0])), 'recoverable copy survives the default save');
});

test('recovery round-trip: restored file keeps working on subsequent writes', () => {
  writeFileAtomic(file, '{"v":1}');
  writeFileAtomic(file, '{"v":2}');
  fs.writeFileSync(file, '{"v":2'); // corrupt
  readJsonWithRecovery(file); // restores v1
  writeFileAtomic(file, '{"v":3}');
  assert.deepEqual(readJsonWithRecovery(file), { data: { v: 3 }, source: 'file', error: null });
  assert.equal(fs.readFileSync(file + '.bak', 'utf8'), '{"v":1}');
});

// ─── safeWatch ────────────────────────────────────────────

test('safeWatch attaches an error handler: watcher error does not throw, onError fires', () => {
  const watched = path.join(dir, 'watched');
  fs.mkdirSync(watched);
  let seen = null;
  const watcher = safeWatch(watched, null, () => {}, (err) => {
    seen = err;
  });
  // Emitting 'error' on a bare fs.watch watcher would crash the process
  // (unhandled EventEmitter error). With safeWatch it must be absorbed.
  watcher.emit('error', new Error('simulated ENOENT on watch root'));
  assert.ok(seen instanceof Error);
  assert.match(seen.message, /simulated/);
});

test('safeWatch still throws synchronously for a missing target (call-site contract)', () => {
  assert.throws(() => safeWatch(path.join(dir, 'does-not-exist'), null, () => {}));
});

// ─── recovery is recorded, not silent ─────────────────────
//
// A corrupt state file is moved aside and the .bak restored without the user
// ever knowing. That self-healing is exactly the kind of invisible work the
// activity record exists to surface.

test('corruption recovery records both the preserved copy and the restore', async () => {
  const activityHome = path.join(dir, 'activity-home');
  const prev = process.env.FRAME_ACTIVITY_HOME;
  process.env.FRAME_ACTIVITY_HOME = activityHome;
  try {
    const activityLog = require('../scripts/activity-log');
    const file = path.join(dir, 'recorded-state.json');
    writeFileAtomic(file, JSON.stringify({ good: true }));
    writeFileAtomic(file, JSON.stringify({ good: 'second' })); // now a .bak exists
    fs.writeFileSync(file, '{ not json');

    const result = readJsonWithRecovery(file);
    assert.equal(result.source, 'bak', 'the .bak is still what gets restored');

    // The record is appended asynchronously on purpose — sync filesystem work
    // on a recovery path would sit inside the standing perf budget. Poll for
    // it rather than sleeping a fixed amount: a fixed wait passes on a quiet
    // machine and fails on a loaded CI runner, which is how this first went
    // red on ubuntu while macOS stayed green.
    let records = [];
    let preserved;
    let recovered;
    for (let i = 0; i < 200; i++) {
      records = activityLog.readRecent(activityLog.projectKey(null), 50);
      preserved = records.find((r) => r.ev === 'state.corrupt_preserved');
      recovered = records.find((r) => r.ev === 'state.recovered');
      if (preserved && recovered) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(preserved, 'preserving the corrupt copy is recorded');
    assert.equal(preserved.path, 'recorded-state.json', 'basename only — no home path in the record');
    assert.ok(recovered, 'the restore is recorded');
    assert.equal(recovered.source, 'bak');
  } finally {
    if (prev === undefined) delete process.env.FRAME_ACTIVITY_HOME;
    else process.env.FRAME_ACTIVITY_HOME = prev;
  }
});

test('recovery still works when the activity record cannot be written', () => {
  const blocked = path.join(dir, 'blocked-activity');
  fs.writeFileSync(blocked, 'not a directory');
  const prev = process.env.FRAME_ACTIVITY_HOME;
  process.env.FRAME_ACTIVITY_HOME = blocked;
  try {
    const file = path.join(dir, 'unrecorded-state.json');
    writeFileAtomic(file, JSON.stringify({ v: 1 }));
    writeFileAtomic(file, JSON.stringify({ v: 2 }));
    fs.writeFileSync(file, 'broken{');
    const result = readJsonWithRecovery(file);
    assert.equal(result.source, 'bak', 'an unwritable record never costs a recovery');
  } finally {
    if (prev === undefined) delete process.env.FRAME_ACTIVITY_HOME;
    else process.env.FRAME_ACTIVITY_HOME = prev;
  }
});
