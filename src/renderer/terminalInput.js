/**
 * Terminal Input — the single renderer→PTY stdin path.
 *
 * Every byte the renderer sends to a PTY goes through send(). Two reasons
 * it is one funnel rather than a bare ipcRenderer.send at each call site:
 *
 * 1. Order. stdin is a stream; a keystroke that overtakes a queued chunk
 *    corrupts what the shell reads. One queue per terminal makes ordering
 *    a property of the module instead of a thing each caller must not break.
 *
 * 2. Volume. Input is not only typing — xterm answers the foreground TUI's
 *    questions on the same channel. An agent TUI asks for the cursor
 *    position (`ESC[?6n`) on every render, so a working agent produced a
 *    steady ~55 msg/s of replies here, unbatched, while the output
 *    direction had been coalesced since the resize-storm work
 *    (ptyManager's 16ms flush). Measured over one session's stdin: 198,590
 *    cursor-position replies, 9,261 mouse reports, 973 focus reports.
 *
 * The coalescing window is deliberately a microtask, not a timer. A TUI
 * that asks a question *blocks its own frame* until the answer arrives, so
 * holding replies for even one display frame would slow the very thing
 * producing them. A microtask adds no measurable delay and still merges
 * every chunk xterm emits while parsing one output flush — which is where
 * the surplus lives (a 5s window held 274 input messages against 217
 * output flushes: the queries come in pairs per frame).
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

/** terminalId → text queued for this tick. Insertion-ordered. */
const pending = new Map();
let flushScheduled = false;

function flush() {
  flushScheduled = false;
  for (const [terminalId, data] of pending) {
    ipcRenderer.send(IPC.TERMINAL_INPUT_ID, { terminalId, data });
  }
  pending.clear();
}

/**
 * Queue input for a terminal. Chunks queued in the same tick are sent as
 * one message, in the order they were queued.
 * @param {string} terminalId
 * @param {string} data
 */
function send(terminalId, data) {
  if (!terminalId || !data) return;
  pending.set(terminalId, (pending.get(terminalId) || '') + data);
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(flush);
  }
}

module.exports = { send };
