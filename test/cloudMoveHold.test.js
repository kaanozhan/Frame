/**
 * cloudMoveHold tests — the 5-second Undo window on a move to Done
 * (frame-cloud-brief-manual-done, plan D1, D12).
 *
 * Runs on a fake clock: the hold takes `setTimer`/`clearTimer`, so nothing
 * here waits on real time.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { HOLD_MS, createMoveHold } = require('../src/shared/cloudMoveHold');

/** A fake clock: `setTimer`/`clearTimer` for the hold, `advance(ms)` to move time. */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimer(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now && timers.has(id)) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    pending: () => timers.size,
  };
}

/** A `run` that records its calls and answers `answer` (or a deferred promise). */
function recorder(answer = { ok: true }) {
  const calls = [];
  const run = () => {
    calls.push(Date.now());
    return typeof answer === 'function' ? answer() : Promise.resolve(answer);
  };
  return { run, calls };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

const tick = () => new Promise((r) => setImmediate(r));

function makeHold(clock) {
  return createMoveHold({ holdMs: HOLD_MS, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
}

test('HOLD_MS is five seconds, as on the web', () => {
  assert.equal(HOLD_MS, 5000);
});

test('a held move is sent once its hold passes, and answers with the send', async () => {
  const clock = fakeClock();
  const hold = makeHold(clock);
  const { run, calls } = recorder({ ok: true });
  const answer = hold.hold('a', run);
  assert.equal(hold.size(), 1);
  clock.advance(HOLD_MS - 1);
  assert.equal(calls.length, 0);
  clock.advance(1);
  assert.equal(calls.length, 1);
  assert.equal(hold.size(), 0);
  assert.deepEqual(await answer, { ok: true });
});

test('the send\'s refusal comes back as it is', async () => {
  const clock = fakeClock();
  const hold = makeHold(clock);
  const answer = hold.hold('a', recorder({ ok: false, reason: 'reasonRequired' }).run);
  clock.advance(HOLD_MS);
  assert.deepEqual(await answer, { ok: false, reason: 'reasonRequired' });
});

test('undo before the send cancels it: run is never called and the move answers undone', async () => {
  const clock = fakeClock();
  const hold = makeHold(clock);
  const { run, calls } = recorder();
  const answer = hold.hold('a', run);
  clock.advance(HOLD_MS - 1);
  assert.equal(hold.undo('a'), true);
  assert.equal(hold.size(), 0);
  assert.equal(clock.pending(), 0);
  clock.advance(HOLD_MS * 2);
  assert.equal(calls.length, 0);
  assert.deepEqual(await answer, { ok: false, reason: 'undone' });
});

test('undo after the send started is false and leaves the send alone', async () => {
  const clock = fakeClock();
  const hold = makeHold(clock);
  const gate = deferred();
  const { run, calls } = recorder(() => gate.promise);
  const answer = hold.hold('a', run);
  clock.advance(HOLD_MS);
  assert.equal(calls.length, 1);
  assert.equal(hold.undo('a'), false);
  gate.resolve({ ok: true });
  assert.deepEqual(await answer, { ok: true });
});

test('undo with nothing held is false', () => {
  const hold = makeHold(fakeClock());
  assert.equal(hold.undo('nothing'), false);
});

test('a second hold sends the first at once and holds its own', async () => {
  const clock = fakeClock();
  const hold = makeHold(clock);
  const first = recorder({ ok: true });
  const second = recorder({ ok: true });
  const firstAnswer = hold.hold('a', first.run);
  clock.advance(1000);
  const secondAnswer = hold.hold('b', second.run);
  assert.equal(first.calls.length, 1, 'the first move is sent when another starts');
  assert.equal(second.calls.length, 0);
  assert.equal(hold.size(), 1);
  assert.deepEqual(await firstAnswer, { ok: true });
  // The first move's timer is gone: the clock reaching its 5 s sends nothing twice.
  clock.advance(HOLD_MS - 1000);
  assert.equal(first.calls.length, 1);
  assert.equal(second.calls.length, 0);
  clock.advance(1000);
  assert.equal(second.calls.length, 1);
  assert.deepEqual(await secondAnswer, { ok: true });
});

test('the same key held twice shares one promise and one timer', async () => {
  const clock = fakeClock();
  const hold = makeHold(clock);
  const first = recorder({ ok: true });
  const second = recorder({ ok: false, reason: 'other' });
  const a = hold.hold('a', first.run);
  clock.advance(2000);
  const b = hold.hold('a', second.run);
  assert.equal(a, b);
  assert.equal(hold.size(), 1);
  assert.equal(first.calls.length, 0, 'the same key does not send itself');
  clock.advance(HOLD_MS - 2000);
  assert.equal(first.calls.length, 1);
  assert.equal(second.calls.length, 0);
  assert.deepEqual(await b, { ok: true });
});

test('flush sends every held move now and resolves true once all settle', async () => {
  const clock = fakeClock();
  const hold = makeHold(clock);
  const gate = deferred();
  const a = recorder(() => gate.promise);
  const b = recorder({ ok: true });
  const aAnswer = hold.hold('a', a.run);
  // A second key sends `a` at once; `b` is held.
  const bAnswer = hold.hold('b', b.run);
  assert.equal(a.calls.length, 1);
  assert.equal(b.calls.length, 0);
  let flushed = null;
  const done = hold.flush().then((v) => { flushed = v; });
  assert.equal(b.calls.length, 1, 'flush sends the held move at once');
  assert.equal(hold.size(), 0);
  await tick();
  assert.equal(flushed, null, 'flush also waits for the send already under way');
  gate.resolve({ ok: true });
  await done;
  assert.equal(flushed, true);
  assert.deepEqual(await aAnswer, { ok: true });
  assert.deepEqual(await bAnswer, { ok: true });
});

test('flush with a timeout resolves false when a send outlives it, and leaves no timer behind', async () => {
  const clock = fakeClock();
  const hold = makeHold(clock);
  const gate = deferred();
  const answer = hold.hold('a', recorder(() => gate.promise).run);
  const flushed = hold.flush({ timeoutMs: 3000 });
  clock.advance(2999);
  await tick();
  clock.advance(1);
  assert.equal(await flushed, false);
  assert.equal(clock.pending(), 0);
  // The send itself is not cancelled by the timeout.
  gate.resolve({ ok: true });
  assert.deepEqual(await answer, { ok: true });
});

test('flush with a timeout resolves true when the sends finish first, and clears its timer', async () => {
  const clock = fakeClock();
  const hold = makeHold(clock);
  hold.hold('a', recorder({ ok: true }).run);
  assert.equal(await hold.flush({ timeoutMs: 3000 }), true);
  assert.equal(clock.pending(), 0);
});

test('flush with nothing held or under way resolves true at once', async () => {
  const hold = makeHold(fakeClock());
  assert.equal(await hold.flush({ timeoutMs: 3000 }), true);
  assert.equal(await hold.flush(), true);
});

test('a run that throws, or rejects, answers other and never rejects', async () => {
  const clock = fakeClock();
  const hold = makeHold(clock);
  const thrown = hold.hold('a', () => { throw new Error('boom'); });
  clock.advance(HOLD_MS);
  assert.deepEqual(await thrown, { ok: false, reason: 'other' });
  const rejected = hold.hold('b', () => Promise.reject(new Error('net')));
  assert.equal(await hold.flush(), true);
  assert.deepEqual(await rejected, { ok: false, reason: 'other' });
});

test('holdMs is injectable', async () => {
  const clock = fakeClock();
  const hold = createMoveHold({ holdMs: 10, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const { run, calls } = recorder();
  const answer = hold.hold('a', run);
  clock.advance(10);
  assert.equal(calls.length, 1);
  assert.deepEqual(await answer, { ok: true });
});
