# Plan — sessions-from-transcripts

## Approach

`claudeSessionsManager.getSessionsForProject` becomes async and lists
`*.jsonl` in the encoded project directory instead of parsing an index.
Each file is streamed with `readline` (async iteration yields to the event
loop, so a 50MB directory doesn't freeze the main process) and reduced to
the same session shape the panel already renders: `sessionId`, `summary`,
`firstPrompt`, `messageCount`, `created`, `modified`, `gitBranch`,
`isSidechain`.

First-prompt extraction skips what isn't a user's own words: `isMeta`
records, slash-command wrappers and caveat blocks (`<command-name>`,
`<local-command-caveat>`), and tool-result payloads.

Transcripts are append-only, so the cache stores the byte offset already
consumed along with the derived state; a later open re-reads only the tail
that was appended. A file whose size shrank (rotated or replaced) is
rescanned from zero. The cache lives in memory, keyed by absolute path.

Measured on this project's directory: 14 transcripts, 51MB, 187ms cold —
so the cache is an optimisation for the growing current session, not a
correctness requirement.

The projects directory is resolved through `CLAUDE_CONFIG_DIR` when set,
falling back to `~/.claude` — which is how Claude Code itself resolves it,
and what lets the tests point the module at a fixture directory.

**Resume.** `pluginsPanel.resumeSession` stops calling
`window.terminalSendCommand` (types into the focused terminal) and calls a
new `agentDispatch.resumeClaudeSession(sessionId)` built from the existing
`_startAgentInNewFrame` path: create a terminal for the current project,
enter it, then send `<claude command> --resume <id>` after the same 800ms
settle a fresh shell already gets. The command comes from the Claude tool
entry rather than the active tool, and the id must match a UUID before it
reaches a command line.

## Footprint

- src/main/claudeSessionsManager.js
- src/renderer/agentDispatch.js
- src/renderer/pluginsPanel.js
- test/claudeSessions.test.js (new)
