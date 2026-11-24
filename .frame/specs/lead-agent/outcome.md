# Outcome — Lead agent

## T01 — Add the pure Chief rules module

Added `src/shared/leadRules.js`: OSC 7501 state → status mapping, `deriveStatus` (a stale report is dropped once the foreground is back to the shell), scope filter by project + machine, hard refusals for sends, per-action approval flags, a pure approval book (first decision wins, cancel, prune), and the delivery gate and per-target FIFO. Beyond the plan: a native Claude install's foreground process is named after its version (`2.1.331`), so version-shaped names count as agents. Also beyond the plan: a non-agent program owning the terminal (`busy`) is refused rather than queued, because a dev server never becomes ready. Covered by `test/leadRules.test.js`.

_Captured: 2026-11-25 · 2 file changes_

---

## T02 — Add the OSC 7501 / bracketed-paste stream scanner

Added `src/shared/programStatus.js`: a per-terminal scanner that counts `ESC]7501;?` probes, parses main-session `state=…` reports (drops subtask reports carrying `id`, base64-decodes `title`/`msg`, accepts BEL or ST) and tracks DEC mode 2004. It carries split sequences to the next chunk, bounded by `MAX_CARRY`. Also exports `PROBE_ANSWER` and `bracketedPaste()`; the latter strips embedded paste markers so a payload cannot end the paste early, which goes slightly beyond the plan. The test fixture uses the control sequences captured from a real 2.1.331 start, and one case checks every split point.

_Captured: 2026-11-25 · 2 file changes_

---

## T03 — Read program status in ptyManager

`src/main/ptyManager.js` now feeds every PTY chunk to a per-terminal scanner, answers Claude's `ESC]7501;?` probe from the PTY owner, and keeps the last main-session report and the DEC 2004 paste mode. It exports `agentStatus`, `pasteMode`, `noteUserInput` (stamped in the `TERMINAL_INPUT_ID` handler), `getLastUserInputAt`, `getForegroundName` and `getForegroundPid`. Beyond the plan: `isTerminalReplyOnly()` was added to `programStatus.js` so xterm's automatic answers do not count as typing. Verified live with real node-pty and Claude 2.1.331: `unknown` until the probe is answered, then `ready` 0.9 s later, then back to the shell with the stale state dropped. zsh also turns paste mode on, so multi-line text can go to shells too.

_Captured: 2026-11-25 · 3 file changes_

---

## T04 — Add the Chief's wire protocol

Added `src/shared/leadProtocol.js`. It provides a JSON-lines reader that handles partial, bad and runaway lines, constant-time token checks, host request validation (`hello` / `list` / `call`) and the MCP JSON-RPC shapes: `initialize` with version negotiation and `instructions`, plus tool results. Changed from the plan: the module is self-contained, using node built-ins only, so the host can copy it next to `lead-mcp.js` and both processes share one framing. Also, the tool registry lives in the host, with `list` relayed, so later tools need no change in the MCP server. `test/leadProtocol.test.js` pins the shapes and the built-ins-only rule.

_Captured: 2026-11-25 · 2 file changes_

---

## T05 — Summarise a session's transcript

Added the pure `src/shared/leadTranscript.js`. `summarize` returns the title, last prompt, last 10 events, files changed versus files read, and a truncated flag. `parseLines` parses a tail read and drops its partial first line. `transcriptPathFromSession` handles the `~/.claude/sessions/<pid>.json` fallback and only accepts a UUID session id. Exported `transcriptFor` from `sessionRestore.js` and `projectsDir` / `encodeProjectPath` from `claudeSessionsManager.js`. Verified on a live 4.9 MB transcript by reading only its last 256 KB through the pid file.

_Captured: 2026-11-25 · 4 file changes_

---

## T06 — Add the Chief's MCP server and role

Added `src/templates/lead/lead-mcp.js`, a stdio MCP server that relays `initialize`, `tools/list` and `tools/call` over the host socket with the token. It reports an unreachable host instead of hanging. Added `src/templates/lead/CHIEF.md` (2,627 characters) with the roles-template sections and the context-hygiene rules. Deviation from plan: instructions come from the host's `hello` rather than being read by the MCP server, so the host can add live context (project, machine) and remains the single owner of the role. `test/leadMcp.test.js` spawns the real script against a stub socket host and also asserts the 4,096-character limit.

_Captured: 2026-11-25 · 3 file changes_

---

## T07 — Add the machine-agnostic Chief host

Added `src/main/leadHost.js`. It runs one socket per machine, with tokens mapped to Chiefs and an unauthorized response for revoked tokens. It holds a tool registry (`terminals_list`, `terminal_read`, `terminal_send`, `terminal_wait`) plus `register()` for later tools. Delivery is a FIFO per target, gated on ready and on the user's quiet period, and sends a bracketed paste, waits 350 ms, then Enter. Approvals are generic and wait for at most `wait` seconds, then return `pending_approval` and deliver later. Modes are stored in `~/.frame/lead.json`. `startChief` copies `lead-mcp.js` and `leadProtocol.js` to `~/.frame/run/`, writes a 0600 MCP config and returns `claude --mcp-config … --allowedTools 'mcp__frame-lead__*'`. Deviation: Unix socket paths longer than 100 bytes, which macOS silently truncates, fall back to a private directory under the system temp dir; an integration run hit exactly this. Verified with a scratch run against a real `lead-mcp.js` process (22 checks: scope, refusals, edited approvals, background delivery, the queue, the typing gate, token revocation). The plan has no unit test for this module.

_Captured: 2026-11-25 · 1 file change_

---

## T08 — Add the lead terminal flag and Chief IPC channels

`ptyManager.createTerminal` gained a `{ lead }` option. A second Chief for the same project throws `LEAD_EXISTS` naming the existing terminal. The Chief is skipped in the 9-terminal cap, gets no sessionRestore env, and is never registered for restore. `TERMINAL_CREATE` passes `lead` through and replies with `code` / `existingTerminalId` on a duplicate. New exports are `leadTerminalOf`, `isLeadTerminal` and `listTerminals` (which the adapter uses). Added `LEAD_*` channels to `src/shared/ipcChannels.js`: start, stop, mode get/set, approvals push, pending, decide, and screen request/reply. A real ptyManager run confirmed that a duplicate Chief is refused, 9 regular terminals fit beside a Chief, and a 10th is refused.

_Captured: 2026-11-25 · 2 file changes_

---

## T09 — Wire the desktop adapter

Added `src/main/leadManager.js`, which wires `leadHost` to local PTYs. It reads screens from the renderer's xterm over `LEAD_SCREEN_REQUEST` / `REPLY` with a 3 s timeout, treats conductor lanes as read-only via `orchestrationManager.getState`, and finds transcripts through sessionRestore, falling back to the pid file. It also serves the IPC for start (only for the project's Chief terminal), stop, mode, pending and decide. Wired into `src/main/index.js` with `shutdown()` on will-quit, and added `readScreenText(id, lines)` plus the screen-request listener to `terminalManager.js`. Beyond the plan: `ptyManager.onTerminalExit()` was needed so the host drops queues and approvals aimed at a closed terminal. Verified end to end with real ptyManager, leadManager, the MCP process and a real Claude: list excludes the Chief, Claude reads `ready` via OSC 7501, screen reads go through the renderer, and a closed terminal disappears.

_Captured: 2026-11-25 · 5 file changes_

---

## T10 — Local Chief UI

Added `src/renderer/chiefLane.js` and `styles/components/chief.css` (imported from `main.css`). On every project change the module ensures one Chief terminal in `main` and draws the Start overlay with the user-guided / full-auto switch. It shows a mode chip while the session runs and brings Start back when the foreground returns to the shell. If the shell itself exits, it reopens a fresh Chief. Approval cards offer Approve, Reject and Edit-in-place, with a pending badge and a sticky toast. `terminalManager.js` pins the Chief first, keeps it out of the cap, numbering and focus-on-create, refuses to close it except when its PTY ended, and adds `setLeadPending`. Landing view: a project whose only terminal is the Chief still opens on Home. Deviations from the plan's Files: `terminalTabBar.js` (its chip × also closes terminals) and `src/renderer/index.js` (init) had to change. `readScreenText` from T09 was fixed to read up to the cursor line, because the bottom rows of a short shell screen are blank. Verified in an isolated Frame instance (temp HOME and user-data dir, driven over CDP): Chief pinned and unclosable, Start typed the launch command, a user-guided send raised a card plus toast plus badge and Approve delivered it, full auto delivered without a card, multi-line text went as one paste, and a renderer reload left exactly one Chief.

_Captured: 2026-11-25 · 8 file changes_

---

## T11 — Frame Server side of the Chief

Added `screenMirror.text({ lines })`, which reads up to the cursor line after pending writes. In `src/server/terminals.js`, `terminals.create` gained `lead` (one per server project path via ptyManager; never for home terminals), `describe` now carries `lead`, `terminals.input` stamps `noteUserInput`, and `setup()` exposes `terminalsOf` / `metaOf` / `ptyManager`. Added `src/server/lead.js`, which runs the same `leadHost` on server PTYs. Transcripts come from the pid file only, because Frame Server never initialises sessionRestore. It exposes `lead.start` / `stop` / `mode` / `pending` / `decide` with the server as approval authority, plus the `lead.approvals` event; it is wired in `src/server/index.js`. Verified against a real in-process Frame Server over the WebSocket protocol, with the real `lead-mcp.js`, in 14 checks: duplicate refused, scope excludes Chief and home, the approval event reaches the desktop, first decision wins, mirror screen read, the typing gate via `terminals.input`, and token revoked when the Chief closes.

_Captured: 2026-11-25 · 4 file changes_

---

## T12 — Server Chief on the desktop

`ptyManager` handles `TERMINAL_CREATE` with `location: 'server-lead'`, creating the Chief in the project's server clone and mapping the server's duplicate refusal to `LEAD_EXISTS`. `adoptFrom` accepts lead terminals by server project path and brings them back into `main` with `lead` and `serverProjectPath`. `leadManager` bridges server Chiefs: `LEAD_START` / `LEAD_STOP` / mode / decide route to the terminal's server, `LEAD_PENDING` also asks every connected server, and server `lead.approvals` events become `LEAD_APPROVALS` with desktop ids. The new `LEAD_SERVER_TARGETS` channel lists the connected servers that hold the project's workspaces. In the renderer, `chiefLane` ensures one "Chief · host" per such server, on project open and two seconds after a server comes up. It adopts the existing Chief instead of opening a second one, and shows a running session rather than Start when the Chief was already running. `terminalManager` names adopted lead terminals "Chief · host" and orders the local Chief before server Chiefs. Verified main-side against a real Frame Server process, with only `serverConnection` and `workspaceManager` stubbed by a WebSocket link (11 checks). The renderer's server path was not run live, because no SSH host was available here.

Followup: live-test a server Chief over a real SSH Frame Server connection (create, Start, approve while connected, close the laptop, reconnect).

_Captured: 2026-11-25 · 5 file changes_

---
