## T01 — Measure the hook ground

Probed `SessionStart` for Claude Code 2.1.295 and Codex 0.160.0 under a pty from a Frame lane, recorded in `measurements.md`. Both CLIs pass the env through, send a UUID `session_id` and an existing `transcript_path`, and `$PPID` is the CLI process whose pgid equals the tty's tpgid; a nested CLI from a Bash tool sits in another group, so the planned `pgid($PPID) === tpgid(shell)` check holds with no ancestor walk. `/clear` re-fire was not measurable headless (documented by Claude Code); the plan's command template stands unchanged.

_Captured: 2026-10-09 · 1 file change(s)_

---
