---
keywords: ipc watchdog, resize storm, terminal resize, toast, notify, logging, main.log
related: audit-q3-performance-resources, terminals-view, audit-q3-ux-error-feedback
---
The "unusually high internal traffic" toast users saw was real traffic with
a wrong diagnosis: the window `resize` listener called `fitAll()` per frame,
sending one `TERMINAL_RESIZE_ID` per open terminal — 363 messages in 2.2s
with three terminals. It is now debounced 80ms (matching the terminals
view's ResizeObserver): 363 → 6, terminals still fit. The warning itself
never reached `main.log` (renderer `console.warn` is not bridged), so it now
logs through `electron-log/renderer` — no Frame IPC channel added — and its
wording reports rate + channels instead of asserting a render loop. The
toast gained a sticky mode (`notify.*(msg, { sticky: true })`, × to close),
and the error toast's 15%-alpha background was layered over an opaque base:
content behind it had been reading through the text.

Chain: spec.md → plan.md → tasks.md → outcome.md
