# Outcome — sessions-from-transcripts

Shipped 2026-08-24. 10 new unit tests (321 total, 0 fail) + live verified in
the running app, no page errors.

## What was actually wrong

`sessions-index.json` on this machine: written **2026-01-28**, **3 entries**,
and **all three transcripts already deleted** — every row in the panel was a
dead session. The file existed in **2 of 95** project directories. Meanwhile
the same directory held **14 transcripts**, including sessions from that day.

## What shipped

- **The list comes from `<sessionId>.jsonl`.** Each transcript is streamed
  line by line and folded into the same shape the panel already rendered:
  title (`ai-title` / `summary` record → first real user prompt), message
  count, first and last timestamps, git branch, sidechain flag.
- **Scaffolding never becomes a title**: `isMeta` records, tool results,
  `<command-name>`/`<system-reminder>` wrappers and the local-command caveat
  are skipped when looking for the user's first words.
- **Sessions that never happened are not listed** — a transcript with zero
  user/assistant records offers a resume that resumes nothing.
- **Append-only cache**: each file remembers the byte offset already folded
  in, so re-opening the panel re-reads only what was appended (the live
  session's transcript is 24MB and growing). A shrunk file is rescanned.
- **`CLAUDE_CONFIG_DIR` is honoured** — the same way Claude Code resolves its
  own data directory, and the seam the tests use.
- **Resume opens its own terminal.** Clicking a session no longer hands the
  command to `window.terminalSendCommand` (the focused terminal, usually one
  already running Claude — which is exactly how it failed for the user, the
  command landing in Claude's prompt as a message). It now creates a terminal
  in the current project, focuses it and runs the **Claude** tool's command
  with `--resume <id>` after the same 800ms settle the Start button uses. The
  id is validated as a UUID before it reaches a command line.

## Verified live

Claude panel → Sessions: **13 sessions** with real titles, relative times,
message counts and branches (was 3 dead rows). Clicking the newest: terminal
count 0 → 1, panel closed, the new lane opened and the resumed conversation
appeared in it. `LOAD_CLAUDE_SESSIONS` / `REFRESH_CLAUDE_SESSIONS` keep their
`{ sessions, reason }` contract; no IPC channel added or removed.

## Honest limit

Transcripts Claude Code has already pruned are gone; this restores everything
still on disk, not every session ever opened.
