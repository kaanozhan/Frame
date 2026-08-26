/**
 * IPC Watchdog
 *
 * Counts renderer↔main IPC traffic in rolling windows and surfaces a warning
 * when it exceeds a storm threshold. Born from a real incident (see
 * PROJECT_NOTES 2026-08-20): a render/data feedback loop idled at ~100 IPC
 * round-trips per second with zero visual symptoms — only CPU gave it away.
 * This makes the invisible failure mode loud, for us before the user.
 *
 * Pure observation: wraps send/invoke/emit on the shared ipcRenderer object,
 * never blocks or drops a message. Threshold is set well above legitimate
 * bursts (project switch, dashboard load ≈ tens of calls) and requires the
 * rate to be sustained for a full window, so it only fires on loops.
 *
 * Every warning is written to the main log file as well as the console. The
 * first real report of this warning could not be investigated at all: the
 * toast had faded, and `console.warn` never reached `main.log`, so nothing
 * remained of a storm that had already happened (resize-storm-watchdog spec).
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

/**
 * electron-log's renderer entry forwards to the main process's file
 * transport over its own internal channel — no Frame IPC channel involved,
 * and main's redaction hook still runs over the line. Guarded: a watchdog
 * that throws while reporting a storm would be worse than the storm.
 */
function toMainLog(message) {
  try {
    require('electron-log/renderer').warn('[ipcWatchdog]', message);
  } catch (err) {
    console.warn('[ipcWatchdog] could not write to the main log:', err.message);
  }
}

const WINDOW_MS = 5000;
const THRESHOLD = 300;       // messages per window (~60/s sustained)
const REARM_MS = 60000;      // at most one user-facing warning per minute

/**
 * A PTY's stdin and stdout are accounted separately, against a much higher
 * bar. They are the one pair of channels whose legitimate rate is set by
 * something other than Frame: an agent TUI renders continuously and asks
 * the terminal a question (`ESC[?6n`) on each frame, and xterm answers on
 * stdin. ptyManager's 16ms flush caps output near 62 msg/s per terminal and
 * the replies track it, so a working agent sits around 100 msg/s with
 * nothing wrong — which is what used to raise a red "render loop" toast
 * during ordinary use. They are still counted, still written to the log
 * whenever the window is busy, and still able to raise the toast on their
 * own — but only past a rate no number of rendering terminals explains.
 */
const TERMINAL_CHANNELS = new Set([IPC.TERMINAL_INPUT_ID, IPC.TERMINAL_OUTPUT_ID]);
const TERMINAL_THRESHOLD = 1500;  // per window (~300/s)

/**
 * What the stdin traffic actually was. The first investigation of this
 * warning cost an afternoon because the report named the channel but not
 * the payload — and the answer (95% cursor-position replies) was only
 * recoverable from the prompt history by accident.
 */
const INPUT_SHAPES = [
  ['cursor-report', /\x1b\[\??\d+;\d+R/g],
  ['mouse', /\x1b\[<\d+;\d+;\d+[Mm]/g],
  ['focus', /\x1b\[[IO]/g]
];

let counts = {};
let total = 0;
let terminalTotal = 0;
let inputShapes = {};
let lastWarnAt = 0;

function bump(direction, channel) {
  const key = `${direction}:${channel}`;
  counts[key] = (counts[key] || 0) + 1;
  total++;
  if (TERMINAL_CHANNELS.has(channel)) terminalTotal++;
}

/** Tally the escape sequences in one stdin payload. Never throws. */
function classifyInput(args) {
  try {
    const data = args && args[0] && args[0].data;
    if (typeof data !== 'string' || data.indexOf('\x1b') === -1) return;
    let matched = 0;
    for (const [name, re] of INPUT_SHAPES) {
      const n = (data.match(re) || []).length;
      if (n) { inputShapes[name] = (inputShapes[name] || 0) + n; matched += n; }
    }
    if (!matched) inputShapes.other = (inputShapes.other || 0) + 1;
  } catch (_) { /* accounting must never break the send it observes */ }
}

function init() {
  const origSend = ipcRenderer.send.bind(ipcRenderer);
  ipcRenderer.send = (channel, ...args) => {
    bump('out', channel);
    if (channel === IPC.TERMINAL_INPUT_ID) classifyInput(args);
    return origSend(channel, ...args);
  };

  const origInvoke = ipcRenderer.invoke.bind(ipcRenderer);
  ipcRenderer.invoke = (channel, ...args) => {
    bump('out', channel);
    return origInvoke(channel, ...args);
  };

  const origEmit = ipcRenderer.emit.bind(ipcRenderer);
  ipcRenderer.emit = (channel, ...args) => {
    if (typeof channel === 'string') bump('in', channel);
    return origEmit(channel, ...args);
  };

  setInterval(() => {
    // Frame's own channels keep the original bar — that is what caught the
    // 2026-08-20 feedback loop. Terminal I/O has to clear its own.
    const frameTotal = total - terminalTotal;
    const isStorm = frameTotal > THRESHOLD || terminalTotal > TERMINAL_THRESHOLD;
    if (total > THRESHOLD) {
      const top = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([ch, n]) => `${ch} ×${n}`)
        .join(', ');
      const shapes = Object.entries(inputShapes)
        .sort((a, b) => b[1] - a[1])
        .map(([name, n]) => `${name} ×${n}`)
        .join(', ');
      const perSec = Math.round(total / (WINDOW_MS / 1000));
      const detail = `${perSec} IPC msg/s sustained for ${WINDOW_MS / 1000}s — top: ${top}`
        + (shapes ? ` — stdin: ${shapes}` : '');
      console.warn(`[ipcWatchdog] ${detail}${isStorm ? '' : ' (terminal I/O, within budget)'}`);
      toMainLog(detail);
      if (isStorm && Date.now() - lastWarnAt > REARM_MS) {
        lastWarnAt = Date.now();
        try {
          // Sticky: this text names the channels, which is the whole point —
          // it has to survive long enough to be read or copied.
          require('./notify').error(
            `Frame is sending ${detail}. The full breakdown is in the log.`,
            { sticky: true }
          );
        } catch (_) { /* notify not ready — the console and log lines already fired */ }
      }
    }
    counts = {};
    total = 0;
    terminalTotal = 0;
    inputShapes = {};
  }, WINDOW_MS);
}

module.exports = { init };
