/**
 * Lane Context Module
 *
 * Whether a lane's shell was set up with Frame's context, renderer-side.
 * `ptyManager` decides it and pushes `TERMINAL_CONTEXT_STATE`; this module is
 * the single consumer, and everything that wants to know asks here.
 *
 * Three states, from the main process:
 *
 *   'installed'   — the shell confirmed setup; a hand-typed `claude` routes
 *                   through Frame's wrapper
 *   'failed'      — setup did not confirm after a retry. Working terminal, no
 *                   Frame context — the lane card says so and offers a start
 *                   button (see laneBoard)
 *   'unsupported' — nothing was sent: not a Frame project, Windows, or a shell
 *                   Frame has no init file for. Not a failure, so nothing is
 *                   shown
 *
 * ── Why `whenReady` exists ──
 * Every flow that starts an agent used to wait a fixed number of milliseconds
 * for the shell to be ready — 800, 1000, 300, each a guess made once and never
 * revisited. The setup marker is *proof* the shell is processing input, so a
 * lane that confirms can be typed into immediately; one that cannot confirm
 * falls back to the number that call site already used. Nothing gets slower,
 * and the common case stops waiting for a worst case that already passed.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

let initialized = false;

// Map<terminalId, 'installed' | 'failed' | 'unsupported'>
const states = new Map();
// Map<terminalId, string> — the one-liner a `failed` lane can be fixed with
const commands = new Map();
// Map<terminalId, Set<resolve>> — callers parked in whenReady
const waiters = new Map();
const listeners = new Set();

/**
 * Start listening. Init-once: a re-init must not stack a second set of
 * ipcRenderer listeners (same reasoning as laneStatus.init).
 */
function init() {
  if (initialized) return;
  initialized = true;

  ipcRenderer.on(IPC.TERMINAL_CONTEXT_STATE, (event, { terminalId, state, command }) => {
    if (!terminalId || !state) return;
    states.set(terminalId, state);
    if (command) commands.set(terminalId, command);
    _wake(terminalId);
    for (const cb of listeners) {
      try { cb(terminalId, state); } catch (_) { /* a bad listener is not the lane's problem */ }
    }
  });

  ipcRenderer.on(IPC.TERMINAL_DESTROYED, (event, { terminalId }) => {
    remove(terminalId);
  });
}

/**
 * Subscribe to context-state changes. Returns an unsubscribe function.
 * Callback signature: (terminalId, state)
 */
function onChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * This lane's context state, or 'pending' if it has not resolved yet.
 */
function getState(terminalId) {
  return states.get(terminalId) || 'pending';
}

/** True only for a lane whose setup was confirmed. */
function isReady(terminalId) {
  return states.get(terminalId) === 'installed';
}

/**
 * The one-liner that would set this lane up by hand, or '' when there is
 * nothing to suggest. Only a `failed` lane has one.
 */
function getManualCommand(terminalId) {
  return commands.get(terminalId) || '';
}

/**
 * Resolve once this lane is ready to be typed into.
 *
 * Resolves immediately for a lane already `installed`, on the state message
 * for one still pending, and after `fallbackMs` for a lane that will never
 * confirm — an unsupported shell, or setup that failed. The fallback is the
 * delay the call site used before this module existed, so the un-confirmable
 * case behaves exactly as it always did.
 *
 * Never rejects: a caller waiting to type into a terminal is not helped by an
 * error, only by eventually going ahead.
 */
function whenReady(terminalId, fallbackMs = 0) {
  if (!terminalId) return Promise.resolve(false);
  if (isReady(terminalId)) return Promise.resolve(true);

  return new Promise((resolve) => {
    let done = false;
    const finish = (ready) => {
      if (done) return;
      done = true;
      const parked = waiters.get(terminalId);
      if (parked) {
        parked.delete(finish);
        if (parked.size === 0) waiters.delete(terminalId);
      }
      clearTimeout(timer);
      resolve(ready);
    };

    // The fallback is armed even for a lane that has already resolved to
    // `failed` or `unsupported`: those lanes still need their old delay before
    // anything is typed, because nothing has confirmed the shell is listening.
    const timer = setTimeout(() => finish(false), Math.max(0, fallbackMs));

    if (!waiters.has(terminalId)) waiters.set(terminalId, new Set());
    waiters.get(terminalId).add(finish);
  });
}

/** Forget a lane. Called on TERMINAL_DESTROYED so the maps don't grow. */
function remove(terminalId) {
  states.delete(terminalId);
  commands.delete(terminalId);
  const parked = waiters.get(terminalId);
  if (parked) {
    // A destroyed lane will never be ready; release anyone still waiting
    // rather than leaving a promise that can only be settled by its timeout.
    for (const finish of Array.from(parked)) finish(false);
    waiters.delete(terminalId);
  }
}

function _wake(terminalId) {
  if (!isReady(terminalId)) return;
  const parked = waiters.get(terminalId);
  if (!parked) return;
  for (const finish of Array.from(parked)) finish(true);
}

module.exports = {
  init,
  onChange,
  getState,
  isReady,
  getManualCommand,
  whenReady,
  remove
};
