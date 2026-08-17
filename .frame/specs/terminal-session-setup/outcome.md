# Outcome — Terminal Session Setup

## T01 — Add pure `src/main/shellSetup.js`

Added the pure delivery table: `shellFamily()` (zsh/bash/sh/dash/ksh → `posix`,
fish → `fish`, everything else → none), `shellInitPath()` as the single spelling
of `.frame/runtime/shell/`, `mintMarker()` per terminal and attempt,
`deliveryFor()` returning fish `-C` args / the typed POSIX line / `none` behind
the win32, no-project and not-a-Frame-project gates, and `splitOnMarker()`.
Kept plan.md's positional `deliveryFor(shellPath, platform, projectPath)` and
added a trailing options argument for the two things a pure module cannot
derive — the minted marker and the fs-answered `isFrameProject`. Files:
`src/main/shellSetup.js`, `test/shellSetup.test.js`.

_Captured: 2026-08-02 · 2 file changes_

---

## T02 — Add `getShellInitTemplate` to `src/shared/frameTemplates.js`

Generated the POSIX and fish init files: `FRAME_BIN` exported, `.frame/bin`
moved rather than duplicated to the front of an exported `PATH`, and one
function per configured tool delegating to `"$FRAME_BIN/<id>"` with a
`command <id>` fallback; unparseable tool ids are skipped rather than
escaped. Rebuilt `PATH` with prefix/suffix removal instead of splitting on
`:` — zsh does not word-split unquoted parameters, so the obvious
`for e in $PATH` would have seen one entry there. Beside the string cases,
`test/frameTemplates.test.js` now sources the real file in bash, sh and zsh
and checks routing, PATH order, subshell reach and the missing-wrapper
fallback. Files: `src/shared/frameTemplates.js`, `test/frameTemplates.test.js`.

_Captured: 2026-08-02 · 2 file changes_

---

## T03 — Write the init files from `aiToolManager`

Added `writeShellInit(projectPath)`: both family files written through the
existing `writeIfChanged`, gated on `launchEnv.supportsWrappers()`, with the
layout taken from `shellSetup.shellInitPath` and a function per registered
tool id. Called from `refreshLaunchAssets` behind the existing `.frame/`
check as T03 asked, and additionally once per composed launch from
`getLaunchCommand` — plan.md wants these regenerated on the wrappers'
schedule, which is what gets a mid-session custom tool its function without a
project reopen. Both call sites warn and continue on failure. Files:
`src/main/aiToolManager.js`.

_Captured: 2026-08-02 · 1 file change_

---

## T04 — Deliver setup at spawn in `ptyManager`

`createTerminal` resolves a per-lane delivery through `resolveSetup()`, a
never-throwing wrapper that supplies the fs half of the gate
(`isFrameProject()`); fish's `-C` args are appended to `shellArgs` before
spawn, the POSIX line is typed once the instance is registered, and each
instance carries a `setup` record exposed by `getSetupState()`. Typed
immediately rather than after a delay — the tty holds type-ahead, and a lost
line is what T05's retry is for. Setup output is still visible, as the task
specified. Files: `src/main/ptyManager.js`.

_Captured: 2026-08-02 · 1 file change_

---

## T05 — Make setup invisible and verified

Buffered output (capped) and queued input while a lane's setup is pending,
resolved on the marker by dropping everything through its line, flushed
verbatim and retyped with a fresh marker on a 4s timeout, `failed` on the
second; `finishSetup()` is the single exit path and emits the new
`TERMINAL_CONTEXT_STATE` channel, immediate `unsupported` included. The
marker is matched against the accumulated buffer rather than the chunk —
a PTY splits it across reads, and a per-chunk scan would time out lanes that
worked. Deviation from plan.md: fish gets no retry, because its setup went in
as a spawn flag and there is no line to type again. Files:
`src/main/ptyManager.js`, `src/shared/ipcChannels.js`.

Followup: the PTY wiring stays untested per plan.md, but the throwaway
stubbed-node-pty harness used to verify it would make a real `test/` file
cheaply.

_Captured: 2026-08-02 · 2 file changes_

---

## T06 — Add `src/renderer/laneContext.js`

Per-terminal context-state cache fed by `TERMINAL_CONTEXT_STATE`, cleared on
`TERMINAL_DESTROYED`, with `onChange` in `laneStatus`'s style and
`whenReady(terminalId, fallbackMs)`; initialised from
`multiTerminalUI._setup()`. `whenReady` arms its fallback even for a lane
already `failed` or `unsupported` — nothing confirmed the shell is
listening there, so those lanes still owe their old delay — and a destroyed
lane releases its waiters instead of leaving promises only a timeout could
settle. No consumer yet. Files: `src/renderer/laneContext.js`,
`src/renderer/multiTerminalUI.js`.

_Captured: 2026-08-02 · 2 file changes_

---

## T07 — The failure row on a lane card

`agentDispatch` exports `startAgentInLane` (a named export of the existing
`_startAgentIn`, so there is still one launcher); `laneBoard` renders a
context row that stays hidden unless the lane is `failed`, refreshed through
the existing `_updateCardStatus` plus a `laneContext.onChange`
subscription, with styling in `lane-board.css`. Deviation from plan.md: the
manual one-liner is per shell family and only the main process knows the
lane's shell, so `shellSetup.manualCommand()` was added and the
`TERMINAL_CONTEXT_STATE` payload carries a `command` field the plan did not
list. Files: `src/renderer/agentDispatch.js`, `src/renderer/laneBoard.js`,
`src/renderer/laneContext.js`, `src/renderer/styles/components/lane-board.css`,
`src/main/shellSetup.js`, `src/main/ptyManager.js`, `test/shellSetup.test.js`.

_Captured: 2026-08-02 · 7 file changes_

---

## T08 — Retire the fixed delays

`_startAgentIn` (800/50 ms), `startAiSession` (1000 ms) and
`multiTerminalUI.sendCommand`'s create-then-send path (300 ms) now await
`laneContext.whenReady(id, <their old number>)` instead of a `setTimeout`.
Each keeps its number as the fallback, so an unsupported or failed lane
behaves exactly as it did and only a confirmed lane gets faster. Files:
`src/renderer/agentDispatch.js`, `src/renderer/index.js`,
`src/renderer/multiTerminalUI.js`.

_Captured: 2026-08-02 · 3 file changes_

---
