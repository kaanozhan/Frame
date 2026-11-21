/**
 * cloudMoveHold — the 5-second Undo window on a move to Done.
 *
 * A move to Done that needs no reason is not sent at once: it is held for
 * `HOLD_MS`, so the "Moved #N to Done" toast can offer Undo (plan D1, D3,
 * D12). The hold lives in main, not the renderer, so a held move is sent
 * when the time passes, when another move starts, or when Frame quits —
 * closing the Briefs view or switching projects neither cancels nor hastens
 * it. (The web accepts losing a move whose tab closes inside the window,
 * FrameCloud D1; Frame owns its process, so it does not.)
 *
 * Pure by design: no Electron, no DOM, and the timers are injectable, so
 * `node --test` drives it on a fake clock. Shared because the renderer's
 * toast lives exactly `HOLD_MS` too.
 */

/** How long a move to Done waits for Undo before it is sent. */
const HOLD_MS = 5000;

const UNDONE = Object.freeze({ ok: false, reason: 'undone' });
const FAILED = Object.freeze({ ok: false, reason: 'other' });

/**
 * One hold for the whole app. `run` is the send: an async function that
 * answers `{ ok, reason? }`. Nothing here ever rejects — a `run` that throws
 * answers `{ ok: false, reason: 'other' }`.
 *
 * - `hold(key, run)` → a promise of the send's answer, or of
 *   `{ ok: false, reason: 'undone' }`. Any other held move is sent at once
 *   ("another move starts"); a move already held under `key` keeps its timer
 *   and returns its promise.
 * - `undo(key)` → true when a held move was cancelled (its `run` is never
 *   called); false when nothing is held under `key`, for example once the
 *   send has started.
 * - `flush({ timeoutMs })` → sends every held move now and resolves when
 *   every send (also those already under way) settles — true — or when
 *   `timeoutMs` passes first — false.
 * - `size()` → how many moves are still held, not yet sent.
 */
function createMoveHold({ holdMs = HOLD_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  /** key → { run, resolve, promise, timer } — held, not yet sent. */
  const held = new Map();
  /** Sends under way, each a promise that never rejects. */
  const sending = new Set();

  function send(key) {
    const entry = held.get(key);
    if (!entry) return null;
    held.delete(key);
    clearTimer(entry.timer);
    let answer;
    try {
      answer = Promise.resolve(entry.run()).catch(() => FAILED);
    } catch {
      answer = Promise.resolve(FAILED);
    }
    sending.add(answer);
    answer.then((result) => {
      sending.delete(answer);
      entry.resolve(result);
    });
    return answer;
  }

  function hold(key, run) {
    const existing = held.get(key);
    if (existing) return existing.promise;
    for (const other of [...held.keys()]) send(other);
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    const entry = { run, resolve, promise, timer: null };
    held.set(key, entry);
    entry.timer = setTimer(() => send(key), holdMs);
    return promise;
  }

  function undo(key) {
    const entry = held.get(key);
    if (!entry) return false;
    held.delete(key);
    clearTimer(entry.timer);
    entry.resolve(UNDONE);
    return true;
  }

  function flush({ timeoutMs } = {}) {
    for (const key of [...held.keys()]) send(key);
    const all = Promise.all([...sending]).then(() => true);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) return all;
    let timer = null;
    const late = new Promise((resolve) => { timer = setTimer(() => resolve(false), timeoutMs); });
    return Promise.race([all, late]).then((settled) => {
      clearTimer(timer);
      return settled;
    });
  }

  function size() {
    return held.size;
  }

  return { hold, undo, flush, size };
}

module.exports = { HOLD_MS, createMoveHold };
