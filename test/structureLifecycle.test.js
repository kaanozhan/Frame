/**
 * structure-lifecycle tests (STR-02 T05+): the clock-injected scheduler —
 * coalescing, max wait, one follow-up per run, full-hash requests, retries
 * and missed bounds, pause/resume and disposal — and the 1,000-event replay.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createScheduler } = require('../scripts/structure-lifecycle');

/* ------------------------------- fake clock ------------------------------ */

const tick = () => new Promise((resolve) => setImmediate(resolve));

function fakeClock() {
  let now = 0;
  let seq = 0;
  const queue = [];
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const handle = { at: now + ms, id: ++seq, fn };
      queue.push(handle);
      return handle;
    },
    clearTimeout(handle) {
      const i = queue.indexOf(handle);
      if (i >= 0) queue.splice(i, 1);
    },
    /** Advance time, firing timers in order and letting promises settle. */
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at || a.id - b.id);
        const next = queue[0];
        if (!next || next.at > end) break;
        queue.shift();
        now = next.at;
        next.fn();
        await tick();
      }
      now = end;
      await tick();
    }
  };
}

/** A scheduler whose jobs take `durationMs` of fake time and return `status`. */
function harness({ durationMs = 0, statuses = [], ...options } = {}) {
  const clock = fakeClock();
  const jobs = [];
  const reports = [];
  const scheduler = createScheduler({
    clock,
    onReport: (r) => reports.push(r),
    ...options,
    run: (job) => {
      jobs.push({ ...job, startedAt: clock.now() });
      const status = statuses.length ? statuses.shift() : 'published';
      if (!durationMs) return Promise.resolve({ status });
      return new Promise((resolve) => clock.setTimeout(() => resolve({ status }), durationMs));
    }
  });
  return { clock, jobs, reports, scheduler };
}

/* --------------------------------- tests --------------------------------- */

test('events coalesce: one job 300 ms after the last event of a short burst', async () => {
  const { clock, jobs, scheduler } = harness();
  scheduler.notify({ reason: 'file-event' });
  await clock.advance(100);
  scheduler.notify({ reason: 'file-event' });
  await clock.advance(100);
  scheduler.notify({ reason: 'file-event' });
  await clock.advance(299);
  assert.equal(jobs.length, 0);
  await clock.advance(1);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].startedAt, 500);
  assert.equal(jobs[0].epoch, 3);
  assert.equal(jobs[0].fullHash, false);
  assert.deepEqual(scheduler.status(), { requestedEpoch: 3, appliedEpoch: 3, dirty: [], pending: false, running: false, paused: false, jobs: 1 });
});

test('a continuous burst is flushed no later than 2 s after its first event', async () => {
  const { clock, jobs, scheduler } = harness();
  for (let t = 0; t < 5000; t += 100) {
    scheduler.notify();
    await clock.advance(100);
  }
  assert.equal(jobs[0].startedAt, 2000);
  assert.ok(jobs.every((j, i) => i === 0 || j.startedAt - jobs[i - 1].startedAt <= 2000));
});

test('events during a run produce exactly one follow-up job', async () => {
  const { clock, jobs, scheduler } = harness({ durationMs: 1000 });
  scheduler.notify();
  await clock.advance(300); // job 1 starts
  for (let i = 0; i < 50; i++) {
    scheduler.notify();
    await clock.advance(10);
  }
  assert.equal(scheduler.status().pending, true, 'newer events keep the map from reading fresh');
  await clock.advance(5000);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[1].epoch, 51);
  assert.equal(scheduler.status().appliedEpoch, 51);
  assert.equal(scheduler.status().pending, false);
});

test('1,000 events over 100 files: at most one main job and one follow-up per settled burst', async () => {
  const { clock, jobs, reports, scheduler } = harness({ durationMs: 400 });
  for (let i = 0; i < 1000; i++) {
    scheduler.notify({ reason: 'file-event', path: `src/f${i % 100}.js` });
    await clock.advance(1);
  }
  await clock.advance(10000);
  assert.ok(jobs.length <= 2, `jobs: ${jobs.length}`);
  assert.equal(scheduler.status().appliedEpoch, 1000);
  const first = jobs[0].startedAt;
  assert.ok(first <= 1000 + 300, `first job started at ${first}ms`);
  assert.equal(reports.filter((r) => r.type === 'missed-bound').length, 0);
});

test('structural signals and reconcile requests ask for a full hash, and coalesce', async () => {
  const { clock, jobs, scheduler } = harness();
  scheduler.notify({ reason: 'file-event' });
  scheduler.notify({ reason: 'gitignore', full: true });
  scheduler.requestReconcile('periodic');
  await clock.advance(300);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].fullHash, true);
  assert.deepEqual(jobs[0].reasons.sort(), ['file-event', 'gitignore', 'periodic']);

  scheduler.notify({ reason: 'file-event' });
  await clock.advance(300);
  assert.equal(jobs[1].fullHash, false, 'the full flag is consumed by the job that ran it');
});

test('mixed observations retry with a full hash, then report a missed bound', async () => {
  const { clock, jobs, reports, scheduler } = harness({ statuses: ['mixed', 'mixed', 'mixed'] });
  scheduler.notify();
  await clock.advance(5000);
  assert.equal(jobs.length, 3, 'one run plus two retries');
  assert.deepEqual(jobs.slice(1).map((j) => j.fullHash), [true, true]);
  assert.deepEqual(reports.filter((r) => r.type === 'missed-bound').map((r) => r.reason), ['changing-files']);
  assert.equal(scheduler.status().pending, true, 'still dirty');

  const recovered = harness({ statuses: ['mixed', 'published'] });
  recovered.scheduler.notify();
  await recovered.clock.advance(5000);
  assert.equal(recovered.jobs.length, 2);
  assert.equal(recovered.scheduler.status().pending, false);
});

test('a busy writer is retried; failures and timeouts keep the change dirty and report', async () => {
  const busy = harness({ statuses: ['busy', 'published'] });
  busy.scheduler.notify();
  await busy.clock.advance(5000);
  assert.equal(busy.jobs.length, 2);
  assert.equal(busy.scheduler.status().pending, false);

  for (const status of ['failed', 'timeout']) {
    const h = harness({ statuses: [status] });
    h.scheduler.notify({ reason: 'file-event' });
    await h.clock.advance(5000);
    assert.equal(h.jobs.length, 1);
    assert.deepEqual(h.reports.filter((r) => r.type === 'missed-bound').map((r) => r.reason), [status]);
    assert.deepEqual(h.scheduler.status().dirty, ['file-event']);
    assert.equal(h.scheduler.status().pending, true);
  }
});

test('a thrown job is a failure, not a crash', async () => {
  const clock = fakeClock();
  const reports = [];
  const scheduler = createScheduler({ clock, onReport: (r) => reports.push(r), run: async () => { throw new Error('boom'); } });
  scheduler.notify();
  await clock.advance(1000);
  assert.deepEqual(reports.map((r) => r.status || r.reason), ['failed', 'failed']);
});

test('a superseded job applies nothing and reports no missed bound', async () => {
  const { clock, reports, scheduler } = harness({ statuses: ['superseded'] });
  scheduler.notify();
  await clock.advance(1000);
  assert.equal(scheduler.status().appliedEpoch, 0);
  assert.equal(reports.filter((r) => r.type === 'missed-bound').length, 0);
});

test('a job slower than the scan budget is applied and reported as a missed bound', async () => {
  const { clock, reports, scheduler } = harness({ durationMs: 40000, scanBudgetMs: 30000 });
  scheduler.notify();
  await clock.advance(50000);
  assert.equal(scheduler.status().pending, false);
  assert.deepEqual(reports.filter((r) => r.type === 'missed-bound').map((r) => r.reason), ['scan-budget']);
});

test('paused maintenance records changes without running; resume reconciles', async () => {
  const { clock, jobs, scheduler } = harness();
  scheduler.pause();
  scheduler.notify({ reason: 'file-event' });
  await clock.advance(10000);
  assert.equal(jobs.length, 0);
  assert.deepEqual(scheduler.status().dirty, ['file-event']);
  assert.equal(scheduler.status().paused, true);

  scheduler.resume();
  await clock.advance(300);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].fullHash, true);
  assert.deepEqual(jobs[0].reasons.sort(), ['file-event', 'resume']);
});

test('idle() resolves when work drains; dispose stops everything', async () => {
  const { clock, jobs, scheduler } = harness({ durationMs: 100 });
  scheduler.notify();
  const drained = scheduler.idle();
  await clock.advance(1000);
  await drained;
  assert.equal(jobs.length, 1);

  scheduler.notify();
  scheduler.dispose();
  await clock.advance(1000);
  assert.equal(jobs.length, 1);
  await scheduler.idle();
});

/* ====================== the worker (STR-02 T06) ====================== */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const lifecycle = require('../scripts/structure-lifecycle');
const { readDescriptor } = require('../scripts/structure-read');
const structureState = require('../scripts/structure-state');

const SCRIPTS = path.join(__dirname, '..', 'scripts');

function project(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-lifecycle-'));
  fs.mkdirSync(path.join(dir, '.frame'), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

const mapOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.frame', 'STRUCTURE.json'), 'utf8'));
const filesOf = (dir) => Object.values(mapOf(dir).modules).map((m) => m.file).sort();

/** A full reconciliation, as the worker records it. */
function reconcileAndRecord(dir, job = { fullHash: true }) {
  const result = lifecycle.reconcile(dir, job);
  if (result.receipt) lifecycle.writeLifecycle(dir, { epoch: { requested: 0, applied: 0 }, dirty: [], receipt: result.receipt });
  return result;
}

/** update-structure --check: is the map what a full scan would produce? */
function inSync(dir) {
  return spawnSync('node', [path.join(SCRIPTS, 'update-structure.js'), '--check'], { encoding: 'utf8', env: { ...process.env, FRAME_PROJECT_ROOT: dir } }).status;
}

async function waitFor(predicate, timeoutMs = 8000, stepMs = 50) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return predicate();
}

test('reconcile publishes the map and a receipt that reads fresh', () => {
  const dir = project({ 'src/a.js': '// A', 'app/user.rb': 'x' });
  try {
    const result = reconcileAndRecord(dir);
    assert.equal(result.status, 'published');
    assert.deepEqual(filesOf(dir), ['app/user.rb', 'src/a.js']);
    const d = readDescriptor(dir);
    assert.equal(d.freshness, 'fresh', d.reasons.join(','));
    assert.equal(d.revision, mapOf(dir).generation.revision);
    assert.equal(d.coverage, 'complete');
    for (const key of ['sourceDigest', 'policyDigest', 'curationDigest', 'artifactDigest']) assert.match(result.receipt[key], /^[0-9a-f]{64}$/);
    assert.equal(result.receipt.leaseMs, 90000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an unchanged tree renews the receipt without rewriting the map', () => {
  const dir = project({ 'src/a.js': '// A' });
  try {
    reconcileAndRecord(dir);
    const before = fs.statSync(path.join(dir, '.frame', 'STRUCTURE.json'));
    const revision = mapOf(dir).generation.revision;
    const again = reconcileAndRecord(dir, { fullHash: false });
    assert.equal(again.status, 'unchanged');
    assert.equal(again.hashed, 0);
    assert.equal(fs.statSync(path.join(dir, '.frame', 'STRUCTURE.json')).mtimeMs, before.mtimeMs);
    assert.equal(mapOf(dir).generation.revision, revision);
    assert.equal(readDescriptor(dir).freshness, 'fresh');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('untracked files, new roots, renamed directories and deletions converge to the full-scan map', () => {
  const dir = project({ 'src/a.js': '// A', 'src/old/b.js': '// B', 'gone.js': '// G' });
  try {
    reconcileAndRecord(dir);
    fs.writeFileSync(path.join(dir, 'untracked.js'), '// new');
    fs.mkdirSync(path.join(dir, 'packages', 'core'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'packages', 'core', 'index.ts'), 'export {}');
    fs.renameSync(path.join(dir, 'src', 'old'), path.join(dir, 'src', 'renamed'));
    fs.rmSync(path.join(dir, 'gone.js'));
    const result = reconcileAndRecord(dir, { fullHash: false });
    assert.equal(result.status, 'published');
    assert.deepEqual(filesOf(dir), ['packages/core/index.ts', 'src/a.js', 'src/renamed/b.js', 'untracked.js']);
    assert.equal(inSync(dir), 0, 'identical to what a full scan would produce');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ignore-policy and config changes add and remove entries while curation and prose survive', () => {
  const dir = project({ 'src/a.js': '// A', 'src/gen.js': '// G', 'build/tool.js': '// T' });
  try {
    reconcileAndRecord(dir);
    const map = mapOf(dir);
    map.modules.a.description = 'Hand-written';
    fs.writeFileSync(path.join(dir, '.frame', 'STRUCTURE.json'), JSON.stringify(map, null, 2));

    fs.writeFileSync(path.join(dir, '.gitignore'), 'src/gen.js\n');
    fs.writeFileSync(path.join(dir, '.frame', 'config.json'), JSON.stringify({ project: { structure: { ignoredDirectories: [] } } }));
    reconcileAndRecord(dir, { fullHash: true });
    assert.deepEqual(filesOf(dir), ['.gitignore', 'build/tool.js', 'src/a.js']);
    assert.equal(mapOf(dir).modules.a.description, 'Hand-written');
    assert.equal(inSync(dir), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a branch switch reconciles to the checked-out tree', () => {
  const dir = project({ 'src/a.js': '// A' });
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  try {
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    fs.writeFileSync(path.join(dir, '.gitignore'), '.frame/\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'a');
    git('checkout', '-q', '-b', 'feature');
    fs.writeFileSync(path.join(dir, 'src', 'feature.js'), '// F');
    git('add', '-A');
    git('commit', '-q', '-m', 'f');
    reconcileAndRecord(dir);
    assert.ok(filesOf(dir).includes('src/feature.js'));

    git('checkout', '-q', '-');
    reconcileAndRecord(dir, { fullHash: true });
    assert.deepEqual(filesOf(dir), ['.gitignore', 'src/a.js']);
    assert.equal(inSync(dir), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a busy writer is reported busy and nothing is published', () => {
  const dir = project({ 'src/a.js': '// A' });
  try {
    const held = structureState.acquireLock(structureState.statePaths(dir), {});
    assert.equal(lifecycle.reconcile(dir, { fullHash: true }).status, 'busy');
    assert.ok(!fs.existsSync(path.join(dir, '.frame', 'STRUCTURE.json')));
    structureState.releaseLock(structureState.statePaths(dir), held.token);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('notifications are classified; Frame\'s own writes are ignored', () => {
  const c = (rel, owned) => lifecycle.classify(rel, owned);
  assert.deepEqual(c('src/a.js'), { reason: 'file-event', full: false, path: 'src/a.js' });
  assert.deepEqual(c('pkg/.gitignore'), { reason: 'gitignore', full: true });
  assert.deepEqual(c('.frame/config.json'), { reason: 'config', full: true });
  assert.deepEqual(c('.frame/bin/intent-map.json'), { reason: 'curation', full: true });
  assert.deepEqual(c('.git/HEAD'), { reason: 'git-state', full: true });
  assert.deepEqual(c(null), { reason: 'unknown-change', full: true });
  for (const own of ['.frame/STRUCTURE.json', '.frame/STRUCTURE.json.bak', '.frame/runtime/structure/lifecycle.json', '.frame/bin/update-structure.js', '.frame/tasks.json', '.git/index', '.git/objects/ab/cd']) {
    assert.equal(c(own), null, own);
  }
  assert.equal(c('STRUCTURE.json', true), null, 'an owned root map is ours');
  assert.equal(c('STRUCTURE.json', false).reason, 'file-event', 'an unowned one is project content');
});

test('Git directories resolve for a repository and for a linked worktree without running Git', () => {
  const dir = project();
  try {
    assert.equal(lifecycle.resolveGitDirs(dir), null);
    fs.mkdirSync(path.join(dir, '.git'));
    assert.deepEqual(lifecycle.resolveGitDirs(dir), { gitDir: path.join(dir, '.git'), inside: true });
    fs.rmSync(path.join(dir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /repos/main/.git/worktrees/wt\n');
    assert.deepEqual(lifecycle.resolveGitDirs(dir), { gitDir: '/repos/main/.git/worktrees/wt', inside: false });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('one coordinator owns a checkout; a dead owner is reclaimed', () => {
  const dir = project();
  try {
    const first = lifecycle.acquireOwner(dir);
    assert.ok(first.ok);
    assert.equal(lifecycle.acquireOwner(dir).reason, 'busy');
    lifecycle.releaseOwner(dir, first.token);
    fs.writeFileSync(path.join(dir, '.frame', 'runtime', 'structure', 'lifecycle.owner'), JSON.stringify({ token: 'x', pid: 2 ** 22 + 99, host: os.hostname() }));
    assert.ok(lifecycle.acquireOwner(dir, { isAlive: () => false }).ok);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const forcePerDirectory of [false, true]) {
  test(`a running worker keeps the map current (${forcePerDirectory ? 'per-directory' : 'platform'} watching)`, async () => {
    const dir = project({ 'src/a.js': '// A' });
    const worker = lifecycle.startWorker(dir, { forcePerDirectory, periodicMs: 3600000 });
    try {
      assert.ok(worker.ok);
      await waitFor(() => readDescriptor(dir).freshness === 'fresh');
      assert.equal(readDescriptor(dir).freshness, 'fresh');

      fs.mkdirSync(path.join(dir, 'src', 'new'), { recursive: true });
      await new Promise((r) => setTimeout(r, 100));
      fs.writeFileSync(path.join(dir, 'src', 'new', 'b.js'), '// B');
      fs.writeFileSync(path.join(dir, 'src', 'a.js'), '// A edited');
      const converged = await waitFor(() => {
        try {
          const map = mapOf(dir);
          return map.modules['new/b'] && map.modules.a.description === 'A edited' && readDescriptor(dir).freshness === 'fresh';
        } catch (e) {
          return false;
        }
      });
      assert.ok(converged, JSON.stringify(worker.status()));

      // our own writes never trigger more work
      await worker.idle();
      const jobs = worker.status().jobs;
      await new Promise((r) => setTimeout(r, 1200));
      assert.equal(worker.status().jobs, jobs, 'no self-triggered loop');
    } finally {
      worker.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('while paused, changes are recorded and readers see the map as dirty', async () => {
  const dir = project({ 'src/a.js': '// A' });
  const worker = lifecycle.startWorker(dir, { periodicMs: 3600000, forcePerDirectory: true });
  try {
    await waitFor(() => readDescriptor(dir).freshness === 'fresh');
    worker.pause();
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), '// A paused edit');
    assert.ok(await waitFor(() => readDescriptor(dir).freshness === 'dirty'), readDescriptor(dir).reasons.join(','));
    assert.ok(!mapOf(dir).modules.a.description.includes('paused'));
    worker.resume();
    assert.ok(await waitFor(() => readDescriptor(dir).freshness === 'fresh' && mapOf(dir).modules.a.description === 'A paused edit'));
  } finally {
    worker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ---------------------------------- CLI ---------------------------------- */

function spawnLifecycle(dir, args) {
  const child = spawn('node', [path.join(SCRIPTS, 'structure-lifecycle.js'), ...args], { env: { ...process.env, FRAME_PROJECT_ROOT: dir }, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [];
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) !== -1) {
      lines.push(JSON.parse(buffer.slice(0, i)));
      buffer = buffer.slice(i + 1);
    }
  });
  const exited = new Promise((resolve) => child.on('close', (code) => resolve(code)));
  return { child, lines, exited };
}

test('--once --json reconciles and reports one envelope', () => {
  const dir = project({ 'src/a.js': '// A' });
  try {
    const res = spawnSync('node', [path.join(SCRIPTS, 'structure-lifecycle.js'), '--once', '--json'], { encoding: 'utf8', env: { ...process.env, FRAME_PROJECT_ROOT: dir } });
    assert.equal(res.status, 0, res.stderr);
    const envelope = JSON.parse(res.stdout.trim());
    assert.equal(envelope.schema, 'frame.structure.lifecycle/1');
    assert.equal(envelope.status, 'published');
    assert.equal(readDescriptor(dir).freshness, 'fresh');
    assert.equal(spawnSync('node', [path.join(SCRIPTS, 'structure-lifecycle.js'), '--bogus']).status, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--watch owns the checkout; a second coordinator is busy; a killed owner is reclaimed', async () => {
  const dir = project({ 'src/a.js': '// A' });
  const first = spawnLifecycle(dir, ['--watch']);
  try {
    assert.ok(await waitFor(() => first.lines.some((l) => l.type === 'started')));
    const second = spawnLifecycle(dir, ['--watch']);
    assert.equal(await second.exited, 2);
    assert.ok(second.lines.some((l) => l.type === 'busy'));

    first.child.kill('SIGKILL');
    await first.exited;
    const third = spawnLifecycle(dir, ['--watch']);
    assert.ok(await waitFor(() => third.lines.some((l) => l.type === 'started')), 'dead owner reclaimed');
    third.child.kill('SIGTERM');
    assert.equal(await third.exited, 0);
    assert.ok(!fs.existsSync(path.join(dir, '.frame', 'runtime', 'structure', 'lifecycle.owner')), 'released on a clean stop');
  } finally {
    first.child.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--supervised takes commands on stdin and exits when stdin closes', async () => {
  const dir = project({ 'src/a.js': '// A' });
  const worker = spawnLifecycle(dir, ['--supervised']);
  try {
    assert.ok(await waitFor(() => worker.lines.some((l) => l.type === 'job')), 'attach reconciliation ran');
    const before = worker.lines.filter((l) => l.type === 'job').length;
    worker.child.stdin.write(`${JSON.stringify({ cmd: 'reconcile', reason: 'reopen' })}\n`);
    assert.ok(await waitFor(() => worker.lines.filter((l) => l.type === 'job').length > before));
    assert.deepEqual(worker.lines.filter((l) => l.type === 'job').pop().reasons, ['reopen']);
    worker.child.stdin.end();
    assert.equal(await worker.exited, 0);
  } finally {
    worker.child.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------ measurement ------------------------------ */

test('10,000-file fixture: refresh times and scan counts', (t) => {
  const dir = project();
  try {
    for (let d = 0; d < 100; d++) {
      const sub = path.join(dir, 'src', `pkg${d}`);
      fs.mkdirSync(sub, { recursive: true });
      for (let f = 0; f < 100; f++) {
        fs.writeFileSync(path.join(sub, `mod${f}.js`), `// Module ${d}.${f}\nfunction f${f}() {}\nmodule.exports = { f${f} };\n`);
      }
    }
    const time = (fn) => { const s = process.hrtime.bigint(); const r = fn(); return [Number(process.hrtime.bigint() - s) / 1e6, r]; };
    const [cold, coldResult] = time(() => reconcileAndRecord(dir, { fullHash: true }));
    assert.equal(coldResult.status, 'published');
    assert.equal(Object.keys(mapOf(dir).modules).length, 10000);

    const refresh = [];
    for (let i = 0; i < 7; i++) {
      fs.writeFileSync(path.join(dir, 'src', 'pkg0', `mod${i}.js`), `// Edited ${i}\n`);
      const [ms, r] = time(() => reconcileAndRecord(dir, { fullHash: false }));
      assert.equal(r.status, 'published');
      assert.equal(r.hashed, 1, 'only the edited file is rehashed');
      refresh.push(ms);
    }
    const [full, fullResult] = time(() => reconcileAndRecord(dir, { fullHash: true }));
    assert.equal(fullResult.status, 'unchanged');
    assert.equal(fullResult.hashed, 10000);
    assert.equal(fullResult.cacheHits, 10000, 'unchanged content is never re-extracted');

    refresh.sort((a, b) => a - b);
    const pct = (p) => refresh[Math.min(refresh.length - 1, Math.ceil(p * refresh.length) - 1)];
    const summary = `cold ${cold.toFixed(0)}ms · refresh p50 ${pct(0.5).toFixed(0)}ms p95 ${pct(0.95).toFixed(0)}ms · full-hash ${full.toFixed(0)}ms · jobs ${refresh.length + 2}`;
    t.diagnostic(summary);
    fs.writeFileSync(path.join(os.tmpdir(), 'frame-str02-measurement.txt'), summary + '\n');
    assert.ok(pct(0.95) < 30000, 'a settled edit completes within the default scan budget');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a job report is emitted after its epoch is applied', async () => {
  const seen = [];
  const clock = fakeClock();
  let scheduler;
  scheduler = createScheduler({
    clock,
    run: async () => ({ status: 'published' }),
    onReport: (r) => { if (r.type === 'job') seen.push(scheduler.status().pending); }
  });
  scheduler.notify();
  await clock.advance(1000);
  assert.deepEqual(seen, [false]);
});

/* ===================== the app supervisor (STR-02 T08) ===================== */

const supervisor = require('../src/main/structureLifecycle');
const { stageParserScripts } = require('../src/main/structureBootstrap');

function supervised(t) {
  const reports = [];
  let tickFn = null;
  let tickerDisposed = 0;
  supervisor.configure({
    onReport: (r) => reports.push(r),
    ticker: (fn) => { tickFn = fn; return { dispose: () => { tickerDisposed++; tickFn = null; } }; }
  });
  t.after(async () => {
    await supervisor.disposeAll();
    supervisor.configure({ onReport: null, ticker: null });
  });
  return { reports, tick: () => tickFn && tickFn(), ticker: () => ({ active: Boolean(tickFn), disposed: tickerDisposed }) };
}

function stagedProject(files = { 'src/a.js': '// A' }) {
  const dir = project(files);
  stageParserScripts(dir);
  return dir;
}

const jobs = (reports, dir) => reports.filter((r) => r.type === 'job' && r.projectPath === fs.realpathSync(dir));

test('attach starts one worker per checkout, whatever path reaches it', async (t) => {
  const s = supervised(t);
  const dir = stagedProject();
  const link = `${dir}-link`;
  fs.symlinkSync(dir, link);
  t.after(() => { fs.rmSync(link, { force: true }); fs.rmSync(dir, { recursive: true, force: true }); });

  const first = supervisor.attach(dir);
  assert.ok(first);
  assert.equal(supervisor.attach(dir), first);
  assert.equal(supervisor.attach(link), first, 'deduplicated by real path');
  assert.deepEqual(supervisor.list(), [fs.realpathSync(dir)]);
  assert.ok(await waitFor(() => readDescriptor(dir).freshness === 'fresh'), 'the attach reconciliation ran');
  assert.deepEqual(jobs(s.reports, dir)[0].reasons, ['attach']);
});

test('periodic ticks and reconcile requests reach the worker', async (t) => {
  const s = supervised(t);
  const dir = stagedProject();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  supervisor.attach(dir);
  assert.ok(await waitFor(() => jobs(s.reports, dir).length === 1));
  assert.equal(s.ticker().active, true);

  s.tick();
  assert.ok(await waitFor(() => jobs(s.reports, dir).length === 2));
  assert.deepEqual(jobs(s.reports, dir)[1].reasons, ['periodic']);

  assert.equal(supervisor.requestReconcile(dir, 'reopen'), true);
  assert.ok(await waitFor(() => jobs(s.reports, dir).length === 3));
  assert.deepEqual(jobs(s.reports, dir)[2].reasons, ['reopen']);
  assert.equal(jobs(s.reports, dir)[2].fullHash, true);
});

test('detach stops the worker, releases its lease and the shared ticker', async (t) => {
  const s = supervised(t);
  const dir = stagedProject();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  supervisor.attach(dir);
  assert.ok(await waitFor(() => jobs(s.reports, dir).length === 1));
  assert.equal(await supervisor.detach(dir), true);
  assert.deepEqual(supervisor.list(), []);
  assert.ok(!fs.existsSync(path.join(dir, '.frame', 'runtime', 'structure', 'lifecycle.owner')));
  const exited = s.reports.find((r) => r.type === 'exited');
  assert.equal(exited.expected, true);
  assert.deepEqual(s.ticker(), { active: false, disposed: 1 });
  assert.equal(await supervisor.detach(dir), false, 'detaching twice is harmless');
});

test('a project without staged tooling is not attached', (t) => {
  supervised(t);
  const dir = project({ 'src/a.js': '// A' });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(supervisor.attach(dir), null);
  assert.deepEqual(supervisor.list(), []);
});

test('a crashed worker is restarted by the next reconcile request', async (t) => {
  const s = supervised(t);
  const dir = stagedProject();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const first = supervisor.attach(dir);
  assert.ok(await waitFor(() => jobs(s.reports, dir).length === 1));
  first.child.kill('SIGKILL');
  await first.exited;
  assert.equal(s.reports.find((r) => r.type === 'exited').expected, false);
  assert.deepEqual(supervisor.list(), []);

  assert.equal(supervisor.requestReconcile(dir), true);
  assert.notEqual(supervisor.attach(dir), first);
  assert.ok(await waitFor(() => jobs(s.reports, dir).length === 2), 'the new worker reclaimed the dead owner lease');
});

test('a checkout owned by a foreground watcher is left to it', async (t) => {
  const s = supervised(t);
  const dir = stagedProject();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const held = lifecycle.acquireOwner(dir);
  t.after(() => lifecycle.releaseOwner(dir, held.token));
  const record = supervisor.attach(dir);
  await record.exited;
  const exited = s.reports.find((r) => r.type === 'exited');
  assert.equal(exited.foreignOwner, true);
  assert.equal(exited.code, 2);
  assert.deepEqual(supervisor.list(), []);
});

test('disposeAll stops every worker', async (t) => {
  supervised(t);
  const a = stagedProject();
  const b = stagedProject();
  t.after(() => { fs.rmSync(a, { recursive: true, force: true }); fs.rmSync(b, { recursive: true, force: true }); });
  const ra = supervisor.attach(a);
  const rb = supervisor.attach(b);
  await supervisor.disposeAll();
  await Promise.all([ra.exited, rb.exited]);
  assert.deepEqual(supervisor.list(), []);
});
