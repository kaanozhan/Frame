# Tasks — sessions-from-transcripts

- [x] T01 · Rewrite getSessionsForProject: stream every `<id>.jsonl` in the
      project directory into the session shape the panel renders; keep the
      `{ sessions, reason }` contract and the empty-state reasons.
- [x] T02 · Append-only cache: remember consumed offset + derived state per
      file, re-read only the appended tail, rescan on shrink.
- [x] T03 · Resume opens a new terminal: route the session click through
      agentDispatch (create terminal → settle → run Claude with
      `--resume <id>`), using the Claude tool's command and a validated id.
- [x] T04 · Tests over fixture transcripts (title fallback chain, meta/
      command prompts skipped, ordering, missing dir, unreadable file,
      incremental append) + live verification in the panel.
