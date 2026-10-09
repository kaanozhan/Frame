## T01 — Measure the hook ground

Probed `SessionStart` for Claude Code 2.1.295 and Codex 0.160.0 under a pty from a Frame lane, recorded in `measurements.md`. Both CLIs pass the env through, send a UUID `session_id` and an existing `transcript_path`, and `$PPID` is the CLI process whose pgid equals the tty's tpgid; a nested CLI from a Bash tool sits in another group, so the planned `pgid($PPID) === tpgid(shell)` check holds with no ancestor walk. `/clear` re-fire was not measurable headless (documented by Claude Code); the plan's command template stands unchanged.

_Captured: 2026-10-09 · 1 file change(s)_

---
## T02 — Pure store core

Added `src/main/sessionRestoreStore.js`: report name/payload parsing (UUID id, absolute `transcript_path`), live-map reducers (register, report, claim, meta, foreground, close) that return the project whose record must be rewritten, record projection, `putRecord` with MRU prune to 20, and `planRestore` (transcript-exists filter, dedupe, cap 9). `seenAgent` keeps a claimed terminal through its first shell prompt; only agent → shell ends a session. Covered by `test/sessionRestoreStore.test.js` (20 tests).

_Captured: 2026-10-09 · 2 file change(s)_

---
