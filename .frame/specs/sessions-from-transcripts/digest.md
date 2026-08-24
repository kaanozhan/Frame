---
keywords: claude sessions, session history, resume session, sessions-index, transcripts, jsonl
related: agent-dispatch, custom-api-per-tool
---
The Claude panel's session list stopped reading `sessions-index.json` — a
file Claude Code no longer maintains (present in 2 of 95 project dirs, last
written seven months earlier, all three of its entries pointing at deleted
transcripts) — and now derives sessions from the `<sessionId>.jsonl`
transcripts themselves: title from the `ai-title`/`summary` record falling
back to the first real user prompt, plus message count, timestamps and
branch. Harness scaffolding (isMeta, tool results, `<command-name>`, caveat
blocks) never becomes a title; zero-message transcripts are not listed;
an append-only per-file cache keeps re-opens cheap; `CLAUDE_CONFIG_DIR` is
honoured. Resuming now opens a NEW terminal and runs the Claude tool's
command with `--resume <id>` there, instead of typing into the focused
terminal where a running Claude swallowed it as a message. 13 real sessions
replaced 3 dead rows. No IPC contract change.

Chain: spec.md → plan.md → tasks.md → outcome.md
