# Outcome — resize-storm-watchdog

Shipped 2026-08-24. Live-verified in the running app, 321 tests pass.

## A — the resize storm

`window.addEventListener('resize')` → `terminal.fitTerminal()` →
`manager.fitAll()` now waits 80ms for the drag to settle (the interval the
terminals view's ResizeObserver already used).

| dragging the window, 3 terminals open | `terminal-resize-id` messages |
| --- | --- |
| before | **363** (~205/s) |
| after | **6** |

The terminal still ends at the right size: after shrinking the window the
xterm screen still fills its pane (349px pane / 328px screen).

## B — the warning now leaves evidence

The watchdog logs through `electron-log/renderer`, so the line reaches
`~/Library/Logs/Frame/main.log` (main's redaction hook still runs over it,
and no Frame IPC channel was added). Verified with a forced storm:

```
[2026-08-24 22:59:47.562] [warn] [ipcWatchdog] 81 IPC msg/s sustained for 5s
  — top: out:__watchdog_selftest__ ×400, out:terminal-resize-id ×6
```

Wording no longer states a render loop as fact — it reports the rate and the
channels, and names a loop as the usual cause.

## C — the toast can be read

`notify.error(msg, { sticky: true })` skips the auto-hide and adds an ×.
Verified: still on screen after 5s (the old error toast was gone at 4s),
dismissed by the × click. Ordinary toasts keep their 4000/2000ms timing.

**Found while verifying:** the error toast's background was
`var(--error-subtle)` — 15% alpha — so the tab bar behind it read straight
through the message. That, as much as the fade, is why the warning was
"tam okunaklı değil". The tint is now layered over `--bg-elevated`, opaque
in both themes.

## What was measured but was not the cause

Idle, streaming terminal output (batched per terminal), touching 300 source
files, git churn, and rewriting every spec `status.json` — all ~0 IPC/s.
Window resize was the only source.
