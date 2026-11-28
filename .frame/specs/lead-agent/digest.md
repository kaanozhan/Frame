---
keywords: chief, lead agent, supervisor, read terminals, send to terminal, frame server, osc 7501, program status, approval modes
related: agent-orchestration, lane-orchestrator, agent-dispatch, agent-ready-never-quiet-terminal, server-workspaces, sessions-from-transcripts, multi-server-connections
---
Every project gets a permanent, pinned **Chief** terminal per machine. The local one lives in `main`, and each connected Frame Server holding the project's workspaces gets its own, shown as "Chief · host". A Chief sits outside the terminal cap, cannot be closed, and starts on one click. Its Claude session gets four MCP tools: `terminals_list`, `terminal_read` (screen plus a 10-event transcript summary), `terminal_send` and `terminal_wait`. They come from a hand-written, dependency-free stdio server (`src/templates/lead/lead-mcp.js`) that relays over a token-checked local socket to `src/main/leadHost.js`. The same host runs on the desktop (`leadManager`) and on Frame Server (`src/server/lead.js`).

Why this path:
- **Agent status comes from Claude Code's own OSC 7501 program-status reports.** ptyManager answers the `ESC]7501;?` probe, then parses `state=working|blocked(kind)|done|idle|error`. It is verified live on 2.1.331. Rejected: hooks, because Stop does not fire on interrupt, AskUserQuestion sends no Notification, and hooks are missing on servers. Also rejected: silence-based laneStatus.
- **One Chief per (project, machine), with no local ↔ server reach (C4).** `main` is always local, and the user's goal was a Chief that keeps working on the server while the laptop is away.
- **Off-the-shelf tools were rejected.** OmniRoute, claude-session-orchestrator, AWS CAO, T3 Code and Claude Code's cross-session messaging cannot see Frame's PTYs; only their ideas were borrowed.

Result:
- Sends are wrapped in bracketed paste, gated on the target being ready and on 4 s of user quiet, and delivered FIFO per target.
- Hard refusals apply in both modes: conductor lanes, terminals waiting on the user, unknown status, busy programs.
- User-guided mode (the default) raises Frame-side approval cards with Approve, Reject and Edit, plus a badge and a sticky toast. The first decision wins, and on servers the server holds that authority. Full auto skips the cards.
- Modes are stored per machine in `~/.frame/lead.json`. The Chief holds no state of its own.

Rules for later work:
- Add tools through `leadHost.register()`. The work-queue spec adds open-terminal, dispatch and check this way.
- Approvals are generic `{ action, target, summary, payload }` records.
- Never answer another agent's prompt.
- The conductor is legacy and will be retired. Its files were not touched.
- Follow-up: run the server Chief live over a real SSH connection.

Chain: spec.md → plan.md → tasks.md → outcome.md
