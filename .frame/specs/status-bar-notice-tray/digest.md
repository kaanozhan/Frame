---
keywords: health notice, main process error, error banner, status bar, notification tray, problems indicator, crash guard
related: status-bar, status-bar-branch-picker, audit-q3-reliability-recovery, migration-consent-scope, codex-parity, audit-q3-ux-error-feedback
---
Replaced `healthNotice`'s top-of-window banner, which covered `#app-header` and kept only the latest message, with an indicator at the status bar's right end and a popover listing every notice of the session, newest first, with repeats merged as `×N`.

- Shape: pure `src/renderer/statusBar/noticeTrayModel.js` beside the DOM host `noticeTray.js`, the branchPicker split. Rows merge on severity + source + message, capped at `MAX_NOTICES = 50`; the tone is the worst unread severity (error red, warning amber, info a blue dot) and the count leaves info out. 12 model tests; the host is untested (no DOM harness). Built from JS into `.status-bar-right`, since `index.html` sat in audit-q3-performance-resources' footprint.
- Renderer-only: `crashGuard.notify` and every IPC payload are unchanged. `healthNotice.js` keeps its listeners and message strings and calls `noticeTray.push()` with a source key for `MAIN_PROCESS_ERROR`, `STATE_FILE_RECOVERED`, `CODEX_HOOKS_UNTRUSTED`, `TASKS_FILE_ERROR` and `showMigration`; `health-notice.css` is deleted.
- Decisions: the migration receipt is an info row with the blue dot; rejected an extra `notify.info` toast, because migration-consent-scope already refused a second receipt surface. An error never opens the tray by itself (the bar is ambient), the indicator is always present and muted when idle, and only one bar popover is open at a time (branch picker, agents menu, tray).
- Deviations: the spec's `!` (`CircleAlert`) became lucide `TriangleAlert` right after close (`942c741`); the tooltip is a fixed "Notices" because `tooltip.attach` takes fixed text, so the state lives in the aria-label and count; a `main-process` source label was added; the banner's `role="alert"` went with it, so new notices are not announced to screen readers.
- Checked by hand in a dev Frame: no header overlay, tones and counts, wrapped messages, `×5` merge, dismiss, Escape, tray and branch picker closing each other. Not checked: light theme. Notices are not persisted across reloads (out of scope).
- Rules: a new health notice is a `noticeTray.push({ severity, source, message })` call rendered with `textContent` only, never a new banner; `notify.js` toasts stay outside the tray.

Chain: spec.md → plan.md → tasks.md → outcome.md
