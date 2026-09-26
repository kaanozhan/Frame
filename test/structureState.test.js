/**
 * structure-state tests (STR-01 T04): ownership resolution, shape
 * validation and backups, recovery archives and failed preservation, the
 * writer lock, attempt records across interruption on both sides of the
 * artifact rename, late parent callbacks, write-denied filesystems,
 * extraction-warning publication, and read-only checks.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const state = require('../scripts/structure-state');

const DEAD_PID = 2 ** 22 + 12345; // beyond pid_max on common systems
const isAlive = (pid) => pid !== DEAD_PID;
let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-state-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const overlay = () => path.join(root, '.frame', 'STRUCTURE.json');
const runtime = (...parts) => path.join(root, '.frame', 'runtime', 'structure', ...parts);

function write(rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function map(modules = {}, extra = {}) {
  return JSON.stringify({ version: '1.1', modules, intentIndex: {}, generation: { schema: 1, mode: 'full' }, ...extra }, null, 2) + '\n';
}

const COMPLETE = { inventory: { coverage: 'complete', reasons: [] }, extraction: { coverage: 'complete', counts: { parsed: 1, unsupported: 0, partial: 0 } } };

function run(candidate, extra = {}) {
  return state.runAttempt({
    rootDir: root,
    mode: 'full',
    isAlive,
    build: () => ({ candidate, ...COMPLETE, ...(extra.built || {}) }),
    ...extra.options
  });
}

function crash() {
  const err = new Error('simulated crash');
  err.simulatedCrash = true;
  throw err;
}

/* ---------------------------- ownership ------------------------------- */

test('the map resolves overlay-first and uses a root file only when config.files owns it', () => {
  assert.equal(state.resolveStructurePath(root), overlay());
  write('STRUCTURE.json', '{"user":"own file"}');
  assert.equal(state.resolveStructurePath(root), overlay(), 'unowned root file is never the output');
  write('.frame/config.json', JSON.stringify({ files: { structure: 'STRUCTURE.json' } }));
  assert.equal(state.resolveStructurePath(root), path.join(root, 'STRUCTURE.json'));
  write('.frame/STRUCTURE.json', map());
  assert.equal(state.resolveStructurePath(root), overlay());
});

test('an unowned root STRUCTURE.json is left untouched by a publish', () => {
  write('STRUCTURE.json', '{"user":"own file"}');
  const result = run(map({ a: { file: 'a.js' } }));
  assert.equal(result.artifact, 'written');
  assert.equal(fs.readFileSync(path.join(root, 'STRUCTURE.json'), 'utf8'), '{"user":"own file"}');
  assert.ok(fs.existsSync(overlay()));
});

/* ---------------------------- validation ------------------------------ */

test('validation checks shape, not only JSON syntax', () => {
  assert.equal(state.validateStructure({ modules: {} }), null);
  assert.equal(state.validateStructure({ modules: { a: { path: 'apps/a', purpose: 'x' } } }), null);
  assert.equal(state.validateStructure([]), 'not-an-object');
  assert.equal(state.validateStructure({ modules: [] }), 'modules-not-an-object');
  assert.equal(state.validateStructure({ modules: { a: 'x' } }), 'module-not-an-object');
  assert.equal(state.validateStructure({ modules: { a: { file: 3 } } }), 'module-file-not-a-string');
  assert.equal(state.validateStructure({ modules: {}, intentIndex: [] }), 'intentIndex-not-an-object');
  assert.equal(state.validateStructure({ modules: {}, curatedKeyOwners: { k: 1 } }), 'curatedKeyOwners-value-not-a-string');
});

test('pending or unscanned templates are not usable completed maps', () => {
  assert.equal(state.isUsableMap({ modules: {}, generation: { state: 'pending' } }), false);
  assert.equal(state.isUsableMap({ version: '1.0', modules: {} }), false);
  assert.equal(state.isUsableMap({ version: '1.0', modules: { a: { file: 'a.js' } } }), true);
  assert.equal(state.isUsableMap({ version: '1.1', modules: {}, generation: { mode: 'full' } }), true);
});

test('readBaseline distinguishes missing, valid, backup-recovered, corrupt and wrong-shape maps', () => {
  assert.equal(state.readBaseline(overlay()).status, 'missing');
  write('.frame/STRUCTURE.json', map());
  assert.equal(state.readBaseline(overlay()).source, 'live');

  write('.frame/STRUCTURE.json', '{ truncated');
  assert.equal(state.readBaseline(overlay()).status, 'corrupt');

  write('.frame/STRUCTURE.json.bak', map({ a: { file: 'a.js' } }));
  const recovered = state.readBaseline(overlay());
  assert.equal(recovered.status, 'valid');
  assert.equal(recovered.source, 'backup');
  assert.equal(recovered.liveCorrupt, true);

  write('.frame/STRUCTURE.json', '[1,2,3]');
  write('.frame/STRUCTURE.json.bak', '{"modules": "nope"}');
  const wrong = state.readBaseline(overlay());
  assert.equal(wrong.status, 'corrupt');
  assert.equal(wrong.reason, 'not-an-object');
});

/* ---------------------------- publication ----------------------------- */

test('a complete inventory publishes atomically and records the attempt', () => {
  const candidate = map({ a: { file: 'a.js' } });
  const result = run(candidate);
  assert.equal(result.state, 'complete');
  assert.equal(result.artifact, 'written');
  assert.equal(result.published, true);
  assert.equal(result.persisted, true);
  assert.equal(fs.readFileSync(overlay(), 'utf8'), candidate);
  const record = JSON.parse(fs.readFileSync(runtime('scan.json'), 'utf8'));
  assert.equal(record.state, 'complete');
  assert.equal(record.artifactDigest, state.digest(Buffer.from(candidate)));
  assert.equal(record.baselineDigest, null);
  assert.ok(record.startedAt && record.finishedAt);
  assert.ok(!fs.existsSync(runtime('lock')), 'lock released');
});

test('a completed empty inventory is published, not treated as failure', () => {
  const result = run(map({}), { built: { counts: { eligibleFiles: 0 } } });
  assert.equal(result.state, 'complete');
  assert.equal(result.artifact, 'written');
});

test('identical bytes are not rewritten', () => {
  const candidate = map({ a: { file: 'a.js' } });
  run(candidate);
  const before = fs.statSync(overlay()).mtimeMs;
  const result = run(candidate);
  assert.equal(result.artifact, 'unchanged');
  assert.equal(result.published, true);
  assert.equal(fs.statSync(overlay()).mtimeMs, before);
  assert.ok(!fs.existsSync(`${overlay()}.bak`), 'no backup churn');
});

test('extraction warnings on a complete inventory still publish, as partial', () => {
  const result = run(map({ a: { file: 'a.js' } }), { built: { extraction: { coverage: 'partial', counts: { parsed: 0, unsupported: 0, partial: 1 } } } });
  assert.equal(result.state, 'partial');
  assert.equal(result.reason, 'extraction-errors');
  assert.equal(result.artifact, 'written');
});

test('an incomplete inventory keeps a usable map byte-for-byte', () => {
  const good = map({ a: { file: 'a.js' } });
  write('.frame/STRUCTURE.json', good);
  const result = run(map({}), { built: { inventory: { coverage: 'partial', reasons: ['timeout'] } } });
  assert.equal(result.state, 'partial');
  assert.equal(result.artifact, 'retained');
  assert.equal(result.published, false);
  assert.equal(result.retainedPrevious, true);
  assert.equal(fs.readFileSync(overlay(), 'utf8'), good);
  assert.equal(JSON.parse(fs.readFileSync(runtime('scan.json'), 'utf8')).state, 'partial');
});

test('an incomplete first scan publishes an explicitly partial map; a pending template is replaced too', () => {
  const partial = map({ a: { file: 'a.js' } }, { generation: { mode: 'full', inventory: { coverage: 'partial' } } });
  const first = run(partial, { built: { inventory: { coverage: 'partial', reasons: ['limit-maxFiles'] } } });
  assert.equal(first.artifact, 'written');
  assert.equal(first.state, 'partial');

  fs.rmSync(path.join(root, '.frame'), { recursive: true });
  write('.frame/STRUCTURE.json', JSON.stringify({ version: '1.1', description: 'annotated', modules: {}, generation: { state: 'pending' } }));
  const second = run(partial, { built: { inventory: { coverage: 'partial', reasons: ['timeout'] } } });
  assert.equal(second.artifact, 'written');
});

test('a fatal build publishes nothing and records the failure', () => {
  const good = map({ a: { file: 'a.js' } });
  write('.frame/STRUCTURE.json', good);
  const result = state.runAttempt({ rootDir: root, mode: 'full', isAlive, build: () => { const e = new Error('boom'); e.code = 'E_BOOM'; throw e; } });
  assert.equal(result.state, 'failed');
  assert.equal(result.reason, 'E_BOOM');
  assert.equal(result.artifact, 'retained');
  assert.equal(fs.readFileSync(overlay(), 'utf8'), good);
  assert.equal(JSON.parse(fs.readFileSync(runtime('scan.json'), 'utf8')).state, 'failed');
});

test('an unreadable live map is never replaced', () => {
  write('.frame/STRUCTURE.json', map());
  const denied = { ...fs, readFileSync: (p, ...rest) => {
    if (p === overlay()) { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; }
    return fs.readFileSync(p, ...rest);
  } };
  const result = run(map({ a: { file: 'a.js' } }), { options: { fs: denied } });
  assert.equal(result.state, 'failed');
  assert.equal(result.reason, 'baseline-unreadable');
  assert.equal(fs.readFileSync(overlay(), 'utf8'), map());
});

/* ------------------------------ recovery ------------------------------ */

test('a corrupt live map and the backup it was rebuilt from are preserved before publishing', () => {
  const backup = map({ a: { file: 'a.js', description: 'authored' } });
  write('.frame/STRUCTURE.json', '{ corrupt');
  write('.frame/STRUCTURE.json.bak', backup);
  let seen;
  const result = state.runAttempt({
    rootDir: root, mode: 'full', isAlive,
    build: (baseline) => { seen = baseline; return { candidate: map({ a: { file: 'a.js' } }), ...COMPLETE }; }
  });
  assert.equal(seen.source, 'backup');
  assert.equal(result.artifact, 'written');
  assert.equal(result.recoveryPaths.length, 2);
  const archived = result.recoveryPaths.map((rel) => fs.readFileSync(path.join(root, rel), 'utf8')).sort();
  assert.deepEqual(archived, [backup, '{ corrupt'].sort());
  for (const rel of result.recoveryPaths) assert.match(rel, /^\.frame\/runtime\/structure\/recovery\/[0-9a-f]{64}\.json$/);
});

test('discarded authored content is archived once per distinct original', () => {
  const original = map({ gone: { file: 'gone.js', owner: 'me' } });
  write('.frame/STRUCTURE.json', original);
  const first = run(map({}), { built: { discardsAuthored: true } });
  assert.equal(first.recoveryPaths.length, 1);
  assert.equal(fs.readFileSync(path.join(root, first.recoveryPaths[0]), 'utf8'), original);

  write('.frame/STRUCTURE.json', original);
  const second = run(map({}), { built: { discardsAuthored: true } });
  assert.deepEqual(second.recoveryPaths, first.recoveryPaths);
  assert.equal(fs.readdirSync(runtime('recovery')).length, 1);
});

test('when preservation fails nothing is overwritten', () => {
  write('.frame/STRUCTURE.json', '{ corrupt');
  const failing = { ...fs, openSync: (p, ...rest) => {
    if (String(p).includes(`${path.sep}recovery${path.sep}`)) { const e = new Error('ENOSPC'); e.code = 'ENOSPC'; throw e; }
    return fs.openSync(p, ...rest);
  } };
  const result = run(map({ a: { file: 'a.js' } }), { options: { fs: failing } });
  assert.equal(result.state, 'failed');
  assert.equal(result.reason, 'preservation-failed');
  assert.equal(fs.readFileSync(overlay(), 'utf8'), '{ corrupt');
});

/* -------------------------------- lock -------------------------------- */

test('a second writer is busy and does not replace the running attempt', () => {
  const held = state.acquireLock(state.statePaths(root), { isAlive });
  assert.ok(held.ok);
  const before = fs.existsSync(runtime('scan.json'));
  const result = run(map({ a: { file: 'a.js' } }));
  assert.equal(result.busy, true);
  assert.equal(result.reason, 'busy');
  assert.equal(fs.existsSync(runtime('scan.json')), before);
  assert.ok(!fs.existsSync(overlay()));
  assert.ok(state.releaseLock(state.statePaths(root), held.token));
});

test('a lock is reclaimed only when its owner is demonstrably gone', () => {
  const paths = state.statePaths(root);
  fs.mkdirSync(paths.runtimeDir, { recursive: true });

  fs.writeFileSync(paths.lockFile, JSON.stringify({ token: 't', pid: DEAD_PID, host: os.hostname() }));
  assert.equal(run(map()).artifact, 'written', 'dead owner on this host → reclaimed');

  fs.writeFileSync(paths.lockFile, JSON.stringify({ token: 't', pid: DEAD_PID, host: 'another-machine' }));
  assert.equal(run(map()).busy, true, 'other host → ambiguous');

  fs.writeFileSync(paths.lockFile, 'garbage');
  assert.equal(run(map()).busy, true, 'unreadable owner → ambiguous');

  fs.writeFileSync(paths.lockFile, JSON.stringify({ token: 't', pid: process.pid, host: os.hostname() }));
  assert.equal(run(map()).busy, true, 'live owner');
});

test('release only succeeds for the owning token', () => {
  const paths = state.statePaths(root);
  const held = state.acquireLock(paths, { isAlive });
  assert.equal(state.releaseLock(paths, 'someone-else'), false);
  assert.ok(fs.existsSync(paths.lockFile));
  assert.equal(state.releaseLock(paths, held.token), true);
});

/* ------------------------------ interruption -------------------------- */

function crashedRun(candidate, hook) {
  assert.throws(() => state.runAttempt({
    rootDir: root, mode: 'full', attemptId: 'attempt-A', pid: DEAD_PID, isAlive,
    build: () => ({ candidate, ...COMPLETE }),
    hooks: { [hook]: crash }
  }), /simulated crash/);
}

test('interruption before the rename leaves the old map and an interrupted, unpublished attempt', () => {
  const good = map({ a: { file: 'a.js' } });
  write('.frame/STRUCTURE.json', good);
  crashedRun(map({ b: { file: 'b.js' } }), 'beforePublish');
  assert.equal(fs.readFileSync(overlay(), 'utf8'), good);
  assert.equal(JSON.parse(fs.readFileSync(runtime('scan.json'), 'utf8')).state, 'running');

  const next = run(good);
  assert.equal(next.artifact, 'unchanged');
  const record = JSON.parse(fs.readFileSync(runtime('scan.json'), 'utf8'));
  assert.deepEqual(record.previous, { attemptId: 'attempt-A', state: 'interrupted', published: false, acknowledged: false, artifactDigest: state.digest(Buffer.from(good)) });
});

test('interruption after the rename keeps the published map and marks it unacknowledged', () => {
  write('.frame/STRUCTURE.json', map());
  const candidate = map({ b: { file: 'b.js' } });
  crashedRun(candidate, 'afterPublish');
  assert.equal(fs.readFileSync(overlay(), 'utf8'), candidate);

  const reconciled = state.reconcileAttempt(root, 'attempt-A', { isAlive });
  assert.equal(reconciled.outcome, 'reconciled');
  assert.equal(reconciled.record.state, 'interrupted');
  assert.equal(reconciled.record.published, true);
  assert.equal(reconciled.record.acknowledged, false);
  assert.equal(reconciled.record.retainedPrevious, false);
  assert.equal(fs.readFileSync(overlay(), 'utf8'), candidate, 'never rolled back');
});

test('a late parent callback cannot overwrite a newer attempt', () => {
  crashedRun(map({ a: { file: 'a.js' } }), 'afterPublish');
  const b = state.runAttempt({ rootDir: root, mode: 'full', attemptId: 'attempt-B', isAlive, build: () => ({ candidate: map({ b: { file: 'b.js' } }), ...COMPLETE }) });
  assert.equal(b.state, 'complete');
  const late = state.reconcileAttempt(root, 'attempt-A', { isAlive });
  assert.equal(late.outcome, 'superseded');
  const record = JSON.parse(fs.readFileSync(runtime('scan.json'), 'utf8'));
  assert.equal(record.attemptId, 'attempt-B');
  assert.equal(record.state, 'complete');
});

test('reconciliation while the child still holds its lock is busy and releases nothing', () => {
  const paths = state.statePaths(root);
  const childLock = state.acquireLock(paths, { pid: process.pid, isAlive, attemptId: 'attempt-A' });
  const result = state.reconcileAttempt(root, 'attempt-A', { isAlive });
  assert.equal(result.outcome, 'busy');
  assert.ok(fs.existsSync(paths.lockFile));
  assert.equal(JSON.parse(fs.readFileSync(paths.lockFile, 'utf8')).token, childLock.token);
});

/* ---------------------------- write denied ---------------------------- */

test('a filesystem that rejects writes reports through the caller without claiming a record', () => {
  write('.frame/STRUCTURE.json', map());
  const readOnly = { ...fs };
  for (const method of ['openSync', 'mkdirSync', 'renameSync', 'copyFileSync']) {
    readOnly[method] = (p, flags, ...rest) => {
      if (method === 'openSync' && (flags === 'r' || flags === undefined)) return fs.openSync(p, flags, ...rest);
      if (method === 'mkdirSync' && fs.existsSync(p)) return undefined;
      const e = new Error('EROFS'); e.code = 'EROFS'; throw e;
    };
  }
  const result = run(map({ a: { file: 'a.js' } }), { options: { fs: readOnly } });
  assert.equal(result.state, 'failed');
  assert.equal(result.persisted, false);
  assert.match(result.reason, /EROFS/);
  assert.equal(fs.readFileSync(overlay(), 'utf8'), map());
});

test('a runtime directory that rejects the attempt record blocks publication', () => {
  write('.frame/STRUCTURE.json', map());
  const failing = { ...fs, openSync: (p, ...rest) => {
    if (String(p).endsWith('scan.json.tmp')) { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; }
    return fs.openSync(p, ...rest);
  } };
  const result = run(map({ a: { file: 'a.js' } }), { options: { fs: failing } });
  assert.equal(result.state, 'failed');
  assert.equal(result.persisted, false);
  assert.equal(result.reason, 'state-unwritable-EACCES');
  assert.equal(fs.readFileSync(overlay(), 'utf8'), map());
  assert.ok(!fs.existsSync(runtime('lock')));
});

/* ----------------------------- read-only ------------------------------ */

function listTree(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      const abs = path.join(d, name);
      const st = fs.statSync(abs);
      out.push(`${path.relative(root, abs)}:${st.size}:${st.mtimeMs}`);
      if (st.isDirectory()) walk(abs);
    }
  };
  walk(dir);
  return out;
}

test('snapshot is read-only and reports instability when a writer is active or the map changes', () => {
  write('.frame/STRUCTURE.json', map());
  const before = listTree(root);
  const snap = state.snapshot(root, { isAlive });
  assert.equal(snap.baseline.status, 'valid');
  assert.equal(snap.stable(), true);
  assert.deepEqual(listTree(root), before);

  const changed = state.snapshot(root, { isAlive });
  write('.frame/STRUCTURE.json', map({ z: { file: 'z.js' } }));
  assert.equal(changed.stable(), false);

  const held = state.acquireLock(state.statePaths(root), { isAlive });
  const busy = state.snapshot(root, { isAlive });
  assert.equal(busy.writerActive, true);
  assert.equal(busy.stable(), false);
  state.releaseLock(state.statePaths(root), held.token);
});

/* ---------------------- STR-02: superseded publication ---------------------- */

test('a job whose precondition fails publishes nothing, archives nothing and ends superseded', () => {
  const good = map({ a: { file: 'a.js', owner: 'me' } });
  write('.frame/STRUCTURE.json', good);
  const checks = [];
  const result = state.runAttempt({
    rootDir: root, mode: 'full', isAlive,
    build: () => ({ candidate: map({ b: { file: 'b.js' } }), ...COMPLETE, discardsAuthored: true }),
    precondition: () => {
      checks.push(fs.existsSync(runtime('lock')));
      return false;
    }
  });
  assert.deepEqual(checks, [true], 'evaluated once, under the writer lock');
  assert.equal(result.state, 'superseded');
  assert.equal(result.reason, 'superseded');
  assert.equal(result.artifact, 'retained');
  assert.equal(result.published, false);
  assert.deepEqual(result.recoveryPaths, []);
  assert.equal(fs.readFileSync(overlay(), 'utf8'), good);
  assert.ok(!fs.existsSync(runtime('recovery')));
  assert.equal(JSON.parse(fs.readFileSync(runtime('scan.json'), 'utf8')).state, 'superseded');
  assert.ok(!fs.existsSync(runtime('lock')));
});

test('a passing precondition publishes as usual; a throwing one fails without writing', () => {
  write('.frame/STRUCTURE.json', map());
  const ok = run(map({ a: { file: 'a.js' } }), { options: { precondition: () => true } });
  assert.equal(ok.artifact, 'written');

  const before = fs.readFileSync(overlay(), 'utf8');
  const boom = run(map({ z: { file: 'z.js' } }), { options: { precondition: () => { throw new Error('epoch store unreadable'); } } });
  assert.equal(boom.state, 'failed');
  assert.equal(boom.reason, 'precondition-error');
  assert.equal(fs.readFileSync(overlay(), 'utf8'), before);
});

test('an identical-bytes result from a stale job is superseded, not reported unchanged', () => {
  const current = map({ a: { file: 'a.js' } });
  write('.frame/STRUCTURE.json', current);
  const result = run(current, { options: { precondition: () => false } });
  assert.equal(result.state, 'superseded');
});
