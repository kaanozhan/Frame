# Outcome — Implement modes

## T01 — Inject Frame's own runtime into dispatched terminals

Added `FRAME_NODE: process.execPath` to the PTY environment in
`createTerminal` (`src/main/ptyManager.js`), set on the base env just before
`extraEnv` spreads in, so every terminal gets it — not only orchestration
lanes. The comment states the call shape (`ELECTRON_RUN_AS_NODE=1
"$FRAME_NODE" script.mjs`) and why the quotes are required, since the packaged
macOS path contains spaces. No deviation from plan.md (D6).

_Captured: 2026-07-21 · 1 file change_

---
