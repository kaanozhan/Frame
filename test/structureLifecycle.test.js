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
