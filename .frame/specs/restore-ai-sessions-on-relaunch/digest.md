---
keywords: session restore, relaunch, resume, SessionStart hook, terminal persistence, codex resume, last active project, default project
related: sessions-from-transcripts, codex-parity, lane-orchestrator
---
Frame now resumes Claude Code and Codex sessions after a relaunch. Each PTY gets FRAME_TERMINAL_ID / FRAME_SESSION_DIR; a SessionStart hook (`sh`+`cat`, env-guarded, no node) drops the CLI payload into ~/.frame/session-reports/<term>.<tool>.<pid>.json; main (sessionRestore + pure sessionRestoreStore) accepts it only when pgid($PPID) equals the terminal's tpgid, so nested CLIs are ignored, and keeps one record per project in ~/.frame/session-restore.json (atomic, crash-safe).
Rejected: guessing from the newest transcript (cross-assigns, misses /clear); a user-global ~/.claude hook (the user chose per-project: Claude entry in the project's sharing-mode settings file, Codex entry in CODEX_HOME guarded on .frame/). Both entries ignore the active-tool gate.
Launch opens the last active project only when it has sessions to resume, otherwise the Default project (projects[0]) as before — decided mid-implementation; the Default-project text says so. Other projects restore on first open in a run. Plain shells are never restored; missing transcripts are skipped; restore is capped at 9 and runs in each session's saved cwd (claude --resume resolves transcripts by directory).
Rules for future work:
- Teardown is not a close: ptyManager.destroyAll freezes the store before killing PTYs; destroyExcept orphans are teardown too. Only user/orchestrator close, shell exit or agent→shell ends a session.
- removeSpecHintHook / removeCodexHintHook also remove the session entries; tests that pin Frame's hook set must count them.
- npm test sets CODEX_HOME to .frame/runtime/test-codex-home — init/open now write CODEX_HOME, never let a test reach the real one.
- A restore holds its project's record (SESSION_RESTORE_DONE, 60 s fallback) so partial restores never shrink it.
Not verified in a running app: the GUI quit→relaunch flow.

Chain: spec.md → plan.md → tasks.md → outcome.md
