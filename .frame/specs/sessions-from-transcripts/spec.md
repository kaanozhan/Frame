# Claude sessions read from transcripts, not a dead index file

> **What we're building:** The Claude panel's session list stops reading
> `sessions-index.json` — a file Claude Code no longer maintains — and
> derives the list from the session transcripts themselves, which are the
> only current source of truth. Resuming a session opens a **new terminal**
> and starts the CLI there instead of typing into whatever is focused.

## User's report (original, Turkish)

> claude için yaptığımız ekranda, sessionları görüntülediğimiz bir yer var,
> orası çok eski sessionları gösteriyor, belki 6 ayda açtığımız yüzlerce
> session ortada yok, yani orası çalışmıyor özetle.

And on resuming, after seeing `claude --resume <id>` land inside a running
Claude session's prompt:

> session için resume yaptığımızda mesela bu session içinden devam etmeye
> çalıştı, hayır, yeni terminal açılmalı, claude başlatılmalı, ve oradan
> resume edilmeli

## What's actually broken (measured on this machine)

- `~/.claude/projects/-Users-kaanozhan-ClaudeCodeIDE/sessions-index.json`
  was last written **2026-01-28** and holds **3 entries**.
- **All three transcripts those entries point to are gone.** Every row the
  panel shows is a dead session: clicking one runs `claude --resume` on an
  id that no longer exists.
- The index exists in **2 of 95** project directories — Claude Code writes
  session data as `<sessionId>.jsonl` and does not maintain this index.
- The same directory holds **14 real transcripts** (151 machine-wide),
  including sessions from today, none of which the panel lists.

Honest limit: transcripts Claude Code has already pruned cannot come back.
This restores everything still on disk, not every session ever opened.

## Goal / Acceptance

- The session list is derived from `<projectDir>/*.jsonl`: id from the
  filename, title from the transcript's `ai-title` / `summary` record,
  falling back to the first real user prompt; message count, first and last
  timestamp, and git branch read from the records themselves.
- Sessions are newest-first by last activity, and every listed session's
  transcript exists — no dead rows.
- Meta/command records (`<command-name>`, caveat blocks, `isMeta`) are not
  mistaken for the user's first prompt.
- `sessions-index.json` is ignored entirely, present or not.
- Scanning does not block the app: transcripts are streamed line by line,
  and results are cached per file (path + size + mtime) so repeat opens and
  the still-growing current session don't re-read what was already read.
- Empty-state reasons stay meaningful: no project, no `~/.claude`, no
  transcripts for this project, read error.
- IPC contract unchanged: `LOAD_CLAUDE_SESSIONS` / `REFRESH_CLAUDE_SESSIONS`
  keep their `{ sessions, reason }` shape and their existing fields.

## Resume opens its own terminal

Clicking a session used to hand `claude --resume <id>` to
`window.terminalSendCommand`, which types into the *focused* terminal. When
that terminal is already running Claude — the normal case, since that is how
the user works — the text lands in Claude's prompt as a message instead of
starting anything. That is exactly how it failed for the user.

- Clicking a session creates a **new terminal in the current project**,
  focuses it, and runs the Claude CLI with `--resume <sessionId>` there.
- It reuses the same path the Start button uses
  (`createTerminalForCurrentProject` → settle → send), including the
  terminal-cap error message when a project is already at its limit.
- The command comes from the **Claude** tool's configured command, not from
  whichever tool is currently selected — these are Claude Code transcripts.
- The session id is validated as a UUID before it is put on a command line.
