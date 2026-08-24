# The resize storm, and a watchdog that leaves evidence

> **What we're building:** Window resizing stops flooding IPC, and when the
> traffic watchdog does fire, its warning survives — written to the log file
> and shown in a toast the user can actually read.

## User's report (original, Turkish)

> arada bir hata mesajı çıkıyor yukarıda, unusual high traffic vs gibi tam
> okunaklı da değil, kayboluyor, loglara düşmüş mü kontrol eder misin?

Answer to the question asked: **no, it never reached the log.** The warning
is a renderer `console.warn` plus a 4-second toast; `electron-log` bridges
the main process only, so `~/Library/Logs/Frame/main.log` contains not a
single watchdog line. The toast fades and nothing remains.

## What was actually firing (measured)

`window.addEventListener('resize')` → `terminal.fitTerminal()` →
`manager.fitAll()` → per terminal `fitAddon.fit()` + one `TERMINAL_RESIZE_ID`
send, with **no debounce**. Dragging the window with three terminals open:
**363 resize messages in 2.2 s (~205/s)** — past the watchdog's 300-per-5s
threshold, so a few seconds of dragging produces the toast.

The traffic is real waste (each message resizes a PTY; the pty only needs the
final size), but it is not the render loop the warning accuses it of. Idle,
streaming terminal output, touching 300 source files, git churn and spec
file churn were all measured at ~0 messages.

## Goal / Acceptance

- **A.** Window resize is debounced before it reaches `fitAll()`, matching
  the 80ms the terminals view's ResizeObserver already uses. Dragging sends
  a handful of resize messages instead of hundreds; the terminal still ends
  at the correct size.
- **B.** A watchdog warning is written to the main log file — channel
  breakdown included — so the next unexplained storm leaves evidence after
  the toast is gone. The wording stops asserting "render loop" as fact.
- **C.** The warning toast stays until dismissed instead of fading after
  four seconds, with an × to close it. Only messages that opt in are sticky;
  ordinary toasts keep their current timing.
