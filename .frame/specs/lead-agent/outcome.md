# Outcome — Lead agent

## T01 — Add the pure Chief rules module

Added `src/shared/leadRules.js`: OSC 7501 state → status mapping, `deriveStatus` (a stale report is dropped once the foreground is back to the shell), scope filter by project + machine, hard refusals for sends, per-action approval flags, a pure approval book (first decision wins, cancel, prune), and the delivery gate and per-target FIFO. Beyond the plan: a native Claude install's foreground process is named after its version (`2.1.331`), so version-shaped names count as agents. Also beyond the plan: a non-agent program owning the terminal (`busy`) is refused rather than queued, because a dev server never becomes ready. Covered by `test/leadRules.test.js`.

_Captured: 2026-11-25 · 2 file changes_

---

## T02 — Add the OSC 7501 / bracketed-paste stream scanner

Added `src/shared/programStatus.js`: a per-terminal scanner that counts `ESC]7501;?` probes, parses main-session `state=…` reports (drops subtask reports carrying `id`, base64-decodes `title`/`msg`, accepts BEL or ST) and tracks DEC mode 2004. It carries split sequences to the next chunk, bounded by `MAX_CARRY`. Also exports `PROBE_ANSWER` and `bracketedPaste()`; the latter strips embedded paste markers so a payload cannot end the paste early, which goes slightly beyond the plan. The test fixture uses the control sequences captured from a real 2.1.331 start, and one case checks every split point.

_Captured: 2026-11-25 · 2 file changes_

---

## T03 — Read program status in ptyManager

`src/main/ptyManager.js` now feeds every PTY chunk to a per-terminal scanner, answers Claude's `ESC]7501;?` probe from the PTY owner, and keeps the last main-session report and the DEC 2004 paste mode. It exports `agentStatus`, `pasteMode`, `noteUserInput` (stamped in the `TERMINAL_INPUT_ID` handler), `getLastUserInputAt`, `getForegroundName` and `getForegroundPid`. Beyond the plan: `isTerminalReplyOnly()` was added to `programStatus.js` so xterm's automatic answers do not count as typing. Verified live with real node-pty and Claude 2.1.331: `unknown` until the probe is answered, then `ready` 0.9 s later, then back to the shell with the stale state dropped. zsh also turns paste mode on, so multi-line text can go to shells too.

_Captured: 2026-11-25 · 3 file changes_

---
