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

let counts = {};
let total = 0;
let lastWarnAt = 0;

function bump(direction, channel) {
  const key = `${direction}:${channel}`;
  counts[key] = (counts[key] || 0) + 1;
  total++;
}

function init() {
  const origSend = ipcRenderer.send.bind(ipcRenderer);
  ipcRenderer.send = (channel, ...args) => {
    bump('out', channel);
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
    if (total > THRESHOLD) {
      const top = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([ch, n]) => `${ch} ×${n}`)
        .join(', ');
      const perSec = Math.round(total / (WINDOW_MS / 1000));
      const detail = `${perSec} IPC msg/s sustained for ${WINDOW_MS / 1000}s — top: ${top}`;
      console.warn(`[ipcWatchdog] ${detail}`);
      toMainLog(detail);
      if (Date.now() - lastWarnAt > REARM_MS) {
        lastWarnAt = Date.now();
        try {
          // Sticky: this text names the channels, which is the whole point —
          // it has to survive long enough to be read or copied.
          require('./notify').error(
            `Frame is sending ${detail}. A render loop is the usual cause; the full breakdown is in the log.`,
            { sticky: true }
          );
        } catch (_) { /* notify not ready — the console and log lines already fired */ }
      }
    }
    counts = {};
    total = 0;
  }, WINDOW_MS);
}

module.exports = { init };
