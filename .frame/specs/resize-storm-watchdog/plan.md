# Plan — resize-storm-watchdog

## Approach

**A.** `index.js`'s window `resize` listener gets an 80ms trailing debounce
around `terminal.fitTerminal()` — the same interval `terminalsView`'s
ResizeObserver uses, so both resize paths behave alike. Nothing else about
fitting changes.

**B.** `ipcWatchdog` logs through `electron-log/renderer`, which forwards to
the main process's file transport on electron-log's own internal channel —
no Frame IPC channel is added, and the existing redaction hook still runs
over it. The require is guarded so a missing/failed logger never breaks the
watchdog's console path. Message rewritten to report what was observed
(rate + top channels) and name a render loop as the usual cause rather than
the verdict.

**C.** `notify` gains an options argument: `notify.error(msg, { sticky:
true })` renders a close button and skips the auto-hide timer. Default
behavior — 4000ms for errors, 2000ms otherwise, one toast at a time — is
untouched. The watchdog is the only caller that opts in.

## Footprint

- src/renderer/index.js
- src/renderer/ipcWatchdog.js
- src/renderer/notify.js
- src/renderer/styles/components/ui.css (toast close button)
