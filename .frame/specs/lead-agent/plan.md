# Plan — Lead agent

## Architecture

### Resolved plan-time decisions

Business:

- **D1 · Where a Chief runs.** `main` is always local (`ptyManager.serverLocationOf('main')` returns null), so a Chief pinned to `main` could never run on a server.
  - **Chosen:** one Chief per (project, machine). The local Chief runs in `main`. Each Frame Server that hosts the project's workspaces gets its own Chief, running in that server's project clone. There is no local ↔ server link.
  - **Rejected:** a single local Chief reaching server terminals over the desktop link, because it stops when the laptop closes.
  - **Rationale:** the user said "amaç zaten sunucuda chief i çalıştırabilmek … lokalden daha önemli" and then "localle remote u konuşturmaktan feragat ederiz".
- **D2 · Off-the-shelf vs. own.** Researched: OmniRoute (an LLM gateway, unrelated), claude-session-orchestrator, AWS CAO, T3 Code, and Claude Code's own cross-session messaging, agent teams and Remote Control. None of them can see Frame's PTYs.
  - **Chosen:** build on Frame's own infrastructure and borrow their ideas: MCP tools, agent-reported status, and transcript reads.
- **D3 · Chief shape.** A permanent terminal named **Chief**, started with one click, not counted toward the terminal cap, with two send modes (user-guided by default, or full auto). Decided while writing the spec.
- **D13 · Where the server Chief appears in the UI** (decided at plan review). The sidebar has one row per workspace, not per terminal, and Frame already shows server home terminals in `main`'s terminal list as "Server · host" (`terminalManager.js:1070`).
  - **Chosen:** the server Chief appears in `main`'s list right after the local Chief, labelled "Chief · <host>".
  - **Rejected:** a pseudo-row inside the server's sidebar group. It would need a virtual workspace, and the file tree, git watch and branch label all key off the selected workspace record.

Technical:

- **D4 · Tool interface.**
  - **Chosen:** a hand-written, dependency-free MCP stdio server. It is registered at Chief launch with `--mcp-config <file>` (additive to `.mcp.json`) and pre-allowed with `--allowedTools 'mcp__frame-lead__*'`, the documented MCP wildcard.
  - **Rejected:** bus scripts that write reply files.
  - **Rationale:** every tool we researched uses MCP. The user approved this.
- **D5 · Local screen read.**
  - **Chosen:** read the renderer's xterm buffer through an IPC request/reply.
  - **Rejected:** a second headless xterm per PTY in main.
  - **Rationale:** the renderer already holds every local screen, and `ptyManager.js` is in another spec's performance footprint. The server keeps using `screenMirror`. The user approved this, and the spec was amended.
- **D6 · Test posture:** pure logic only, following the PROJECT_NOTES `## Testing` convention. CI runs no `npm ci`, so nothing under test may require `xterm-headless` or any other `node_modules` package. The user approved this.
- **D7 · Agent status source** (revised at plan review).
  - **Chosen:** Claude Code's OSC 7501 Program Status protocol, read from the PTY stream by the PTY owner. That is `ptyManager`, which runs on both the desktop and Frame Server, so one code path serves both.
  - **Verified against Claude Code 2.1.331:**
    - At start, Claude writes `ESC ] 7501 ; ? BEL`.
    - Once the terminal answers with an OSC 7501 whose data starts with `?`, Claude emits `ESC ] 7501 ; state=<s>:app=claude-code[:id=…][:kind=…][:progress=…][:title=b64][:msg=b64] BEL`.
    - States are `working`, `blocked` (`kind` = `permission`, `question` or `auth`), `done`, `idle`, `error` and `clear`. An interrupted turn reads as `idle`.
    - Reports carrying an `id` describe subtasks and are ignored. Only the main session's report (no `id`) sets the status.
  - **Rejected:** Claude Code hooks. `Stop` does not fire on Esc/Ctrl+C, so the status would stick at `working`. `AskUserQuestion` fires no Notification. The hooks would also have to be written into every workspace's and server clone's settings, and a session only loads its hooks at start.
  - **Rejected:** the renderer's silence-based `laneStatus`, which has the never-quiet bug and is in another spec's footprint.
  - **Plain shells:** a terminal whose foreground process is the spawned shell is `ready`, and any other foreground process makes it `busy`. When Claude exits, its foreground drops back to the shell and the stale OSC state is discarded.
  - **Everything else** (Claude < 2.1.295, Codex, a session started before Frame answered the probe) is `unknown`, and `send` refuses it with a reason.
- **D8 · MCP ↔ host transport** (silent). The MCP server talks to the host over a local socket: a Unix domain socket in a `0700` run directory, or a named pipe on Windows. Messages are JSON lines, and each Chief gets its own random token. The token is stored only in that Chief's MCP config file (`0600`), and the host rejects any request without it.
  - The MCP server is launched with `process.execPath` and `ELECTRON_RUN_AS_NODE=1`, the `FRAME_NODE` precedent in `ptyManager.js:277`, so it works when the user has no `node` on PATH. On Frame Server, `process.execPath` is node itself.
- **D9 · Role delivery** (silent). `src/templates/lead/CHIEF.md` follows the roles template sections and stays under the 4,096-character limit Claude Code puts on MCP instructions. The MCP server returns it as its `instructions`. Only Claude Code can run as Chief in v1.
- **D10 · Mode storage** (silent). The mode lives in a machine-local `~/.frame/lead.json`, keyed by project path, next to `session-restore.json`. The same code on Frame Server gives one mode per (project, machine), and nothing is written to the repo.
- **D11 · One-Chief authority** (silent). The machine that owns the PTY refuses a second lead terminal for the same project path: `ptyManager.createTerminal` on the desktop, `terminals.create` on the server. The renderer's "ensure Chief" step asks before it creates one. Lead terminals are not registered with sessionRestore, so restore never duplicates them.
- **D18 · Relationship to the conductor** (user, 2026-11-25). The conductor is unused and will be retired after the Chief is established.
  - This spec does not modify `orchestrationManager.js`.
  - The Chief's delivery is written fresh in `leadHost`: agent-reported readiness, bracketed paste and a per-target FIFO, instead of `relayToConductor`'s fixed 350/400 ms pauses. Only the 350 ms paste-settle gap before `\r` is kept, because it is proven against Claude's TUI.
  - Conductor lanes are detected through the public `orchestrationManager.getState(projectPath)` (`conductorTerminalId` and `workers[].terminalId`).
- **D19 · Built to grow** (user, 2026-11-25). The work queue is the next spec.
  - The host dispatches tools through a registry (`name → { schema, run, action }`), so new tools register without touching the dispatch path.
  - Adapters expose `createTerminal` already, even though v1 registers no tool that calls it.
  - Approvals are generic `{ action, target, summary, payload }` records, so one card renders "send" today and "open terminal" or "dispatch task" later.
  - Each action declares whether it needs approval in user-guided mode.
- **D20 · Chief context hygiene** (user, 2026-11-25). `terminal_read` defaults to 60 screen lines plus an activity summary capped at the last 10 events. The full transcript is never returned.
  - `CHIEF.md` says: do no work yourself; read short; rebuild the picture from `terminals_list` after a restart or `/clear`; keep reports brief.
  - A restarted Chief loses nothing, because every piece of state lives in the PTY owner (status, queues, approvals, modes).
- **D12 · Footprint collisions** (silent). `ptyManager.js` and `terminalManager.js` are in audit-q3-performance-resources, which is implementing. `ptyManager.js` and `terminalManager.js` are also in audit-q3-cross-platform, which is planned. Changes to those files stay additive, and this spec is not dispatched in parallel with either one.
- **D14 · Delivering text** (plan review).
  - `ptyManager` tracks each terminal's bracketed-paste mode from `ESC[?2004h` / `ESC[?2004l` in the output. Claude Code turns it on, as observed.
  - When the mode is on, the host wraps the text in `ESC[200~ … ESC[201~`, waits 350 ms and sends `\r`. The next delivery to that terminal waits for its status to leave `ready`, or for 2 s, whichever comes first, instead of a fixed pause.
  - When the mode is off (a plain shell), multi-line text is refused and single-line text is sent followed by `\r`.
  - Wrapping stops an embedded newline from submitting early.
- **D15 · Not typing over the user** (plan review). `ptyManager.noteUserInput(id, data)` stamps `lastUserInputAt` on writes from the user's input path, ignoring chunks that are only escape-sequence replies. On the desktop that path is `ipcMain.on(TERMINAL_INPUT_ID)` (`ptyManager.js:842`). On a server it is the `terminals.input` method. Writes from the host go through `writeToTerminal` and are never stamped. A send waits until 4 s after the last keystroke. A draft the user left unsent in Claude's input box cannot be detected, so `CHIEF.md` tells the Chief to `terminal_read` a target before sending.
- **D16 · Transcript lookup** (plan review).
  - **Desktop:** sessionRestore's terminal → `transcriptPath` mapping, taken from its documented SessionStart hook.
  - **Fallback on both machines:** find the terminal's foreground pid (ptyManager's existing `tpgid` lookup), read `~/.claude/sessions/<pid>.json` (or `$CLAUDE_CONFIG_DIR/sessions`), take `sessionId` and `cwd`, and build `projects/<encoded cwd>/<sessionId>.jsonl` with `claudeSessionsManager.encodeProjectPath`. That file format is internal to Claude Code (observed, not documented), so any failure only turns off the activity summary. Screen reads keep working.
- **D17 · Approvals the user can't miss** (plan review). An approval shows as a card on the Chief terminal. It also raises an attention badge on the Chief's row and a sticky toast naming the project and target (`notify.info(…, { sticky: true })`).
  - The host is the authority: a decision is applied once and later decisions are ignored, so several desktops cannot double-approve.
  - A pending approval is cancelled when its target or its Chief goes away.

### Shape

```
Claude (Chief terminal)
  └─ stdio ─ lead-mcp.js   (materialized to ~/.frame/run/, run with FRAME_NODE)
               └─ socket + token ─ leadHost   (one per machine: desktop main | Frame Server)
                                     ├─ list      → ptyManager terminals of (project, this machine)
                                     ├─ status    → ptyManager.agentStatus(id)   [OSC 7501 + foreground]
                                     ├─ screen    → desktop: renderer xterm via IPC · server: screenMirror.text()
                                     ├─ activity  → transcriptFor(id) → leadTranscript summary
                                     ├─ deliver   → bracketed paste · 350 ms · \r, per-target FIFO gated on ready
                                     └─ approvals → desktop: IPC → card · server: lead.approval event → desktop card
ptyManager.onData (both machines): answer ESC]7501;? · parse ESC]7501;state=… · track ?2004 mode
```

**MCP tools** (exposed to Claude as `mcp__frame-lead__…`):

| Tool | Input | Output |
|---|---|---|
| `terminals_list` | — | `[{ id, workspace, cwd, agent, process, status, kind? }]` |
| `terminal_read` | `id`, `lines?` (60), `mode?` (`screen` \| `activity` \| `both`) | plain screen text; activity: recent prompts, replies, tool calls, files touched |
| `terminal_send` | `id`, `text`, `wait?` (s) | `{ outcome: delivered \| queued \| pending_approval \| rejected \| refused \| cancelled, reason?, deliveredText? }` |
| `terminal_wait` | `id`, `seconds` (≤ 300) | `{ status }` once it leaves `working`/`busy`, or on timeout |

**Rules.** These live in `src/shared/leadRules.js` and are pure.

- **Status mapping:** `idle`/`done` → `ready`, `working` → `working`, `blocked` → `approval` (keeps its kind), `error` → `ready` (the error is reported), `clear` → `ready`.
- **Hard refusals**, applied in both modes, each with a reason: an orchestration lane, the Chief itself, status `approval`/`unknown`/`ended`, multi-line text to a non-paste target, or a target out of scope.
- **Approval queue:** generic `{ action, target, summary, payload }` records, `pending → approved | rejected | edited | cancelled`, and the first decision wins.
- **Delivery:** a per-target FIFO that gates on `ready` and on the user-typing quiet period.

**Server Chief lifecycle.**

1. The renderer asks for `terminals.create({ lead: true, projectPath: serverProjectPath, cwd: serverProjectPath })`.
2. The server keeps the flag in `meta`, the same way it keeps `home`, and `describe` returns `lead: true`.
3. `adoptFrom` accepts lead terminals whose `projectPath` matches the server project path. The desktop names them "Chief · host" and places them in `main`.
4. Approvals travel as protocol events: the server sends `lead.approval`, and the desktop calls `lead.decide`, `lead.pending` (on reconnect) and `lead.mode`.

## Files

- `src/shared/leadRules.js` — **New**. Pure rules: status mapping, scope filter, refusals, approval state machine, FIFO with user-typing gate.
- `src/shared/leadProtocol.js` — **New**. Pure JSON-lines framing, MCP JSON-RPC shapes, host request validation, token check.
- `src/shared/programStatus.js` — **New**. Pure OSC 7501 and bracketed-paste stream scanner with a carry buffer for split chunks. It returns the probe-seen flag, the main-session state report and the paste mode.
- `src/shared/leadTranscript.js` — **New**. Pure transcript records → activity summary. Harness and meta records are skipped, following `claudeSessionsManager.js`'s rules.
- `src/main/leadHost.js` — **New**. Machine-agnostic host:
  - socket and token, a tool registry dispatching to an adapter;
  - per-target delivery (paste wrap, pacing), waits;
  - approval routing and the mode store (`~/.frame/lead.json`);
  - materializes `lead-mcp.js` and the MCP config, and builds the Claude launch command.
- `src/main/leadManager.js` — **New**. Desktop adapter: local PTYs, screen read via renderer IPC, conductor-lane check via `orchestrationManager.getState`, transcript lookup (sessionRestore, then the pid file), IPC for Start, mode and approvals.
- `src/server/lead.js` — **New**. Frame Server adapter: server PTYs, `screenMirror.text()`, transcript via the pid file, `lead.*` methods and the `lead.approval` event.
- `src/templates/lead/lead-mcp.js` — **New**. Dependency-free MCP stdio server: relays tool calls to the host socket and serves `CHIEF.md` as instructions.
- `src/templates/lead/CHIEF.md` — **New**. Chief role (Purpose / Steps / Commands / Notes), ≤ 4,096 characters, with the context-hygiene rules from D20.
- `src/renderer/chiefLane.js` — **New**. Ensures the Chiefs exist (local and per connected server), pins them, and draws the Start overlay, mode toggle, approval cards, attention badge and sticky toast.
- `src/renderer/styles/components/chief.css` — **New**. Styles for the Chief badge, overlay and cards.
- `src/renderer/styles/main.css` — **Modified**. `@import 'components/chief.css'`.
- `src/main/ptyManager.js` — **Modified**:
  - `lead` flag on create: one per project, out of the cap, not registered with sessionRestore;
  - `programStatus` scan in `onData`, which answers the probe;
  - `agentStatus(id)`, `pasteMode(id)`, `lastUserInputAt` stamp, `getForegroundName(id)`, `getForegroundPid(id)`;
  - lead terminals recognised in `adoptFrom` and passed through `createServerTerminal`.
- `src/main/sessionRestore.js` — **Modified**. Exports `transcriptFor(terminalId)` from the live map.
- `src/main/claudeSessionsManager.js` — **Modified**. Exports `encodeProjectPath` and `projectsDir`, if they are not exported already.
- `src/server/terminals.js` — **Modified**. `lead` flag on `terminals.create` (one per `projectPath`), `lead` in `describe`, `noteUserInput` in `terminals.input`, wiring for `src/server/lead.js`.
- `src/server/screenMirror.js` — **Modified**. `text({ lines })`: plain visible text from the headless buffer.
- `src/server/index.js` — **Modified**. Sets up `lead.js` next to `terminals`.
- `src/shared/ipcChannels.js` — **Modified**. `LEAD_*` channels: start, mode get/set, approval request/decide/pending, screen-read request/reply.
- `src/renderer/terminalManager.js` — **Modified**. Lead terminals are skipped in the cap count and refused in `closeTerminal` except on teardown. Adds `readScreenText(id, lines)` for the IPC reply and names server lead terminals "Chief · host".
- `src/renderer/terminalsView.js` — **Modified**. The Chief(s) are pinned first in the list and rail, with no close affordance.
- `src/main/index.js` — **Modified**. Init and `setupIPC` for `leadManager`.
- `test/leadRules.test.js` — **New**. Status mapping, scope (local vs. server machine, home terminals, other projects), refusals in both modes, approval transitions (first decision wins, cancel), FIFO and the user-typing gate.
- `test/programStatus.test.js` — **New**. Probe detection, state reports with and without `id`, base64 `msg`, BEL vs. ST terminators, sequences split across chunks, `?2004h/l`. Uses the captured 2.1.331 bytes as a fixture.
- `test/leadProtocol.test.js` — **New**. Framing, partial lines, bad JSON, token rejection, MCP `initialize` / `tools/list` / `tools/call` shapes.
- `test/leadTranscript.test.js` — **New**. Summary from fixture records, with harness and meta records excluded.
- `test/leadMcp.test.js` — **New**. Spawns `src/templates/lead/lead-mcp.js` against a stub socket server built from node built-ins. Checks the instructions, the tool relay and the token header.

## Footprint

- src/shared/leadRules.js
- src/shared/leadProtocol.js
- src/shared/programStatus.js
- src/shared/leadTranscript.js
- src/main/leadHost.js
- src/main/leadManager.js
- src/server/lead.js
- src/templates/lead/lead-mcp.js
- src/templates/lead/CHIEF.md
- src/renderer/chiefLane.js
- src/renderer/styles/components/chief.css
- src/renderer/styles/main.css
- src/main/ptyManager.js
- src/main/sessionRestore.js
- src/main/claudeSessionsManager.js
- src/server/terminals.js
- src/server/screenMirror.js
- src/server/index.js
- src/shared/ipcChannels.js
- src/renderer/terminalManager.js
- src/renderer/terminalsView.js
- src/main/index.js
- test/leadRules.test.js
- test/programStatus.test.js
- test/leadProtocol.test.js
- test/leadTranscript.test.js
- test/leadMcp.test.js

## Dependencies

None. The MCP server is hand-written on node built-ins. `xterm-headless` and `xterm-addon-serialize` already ship for Frame Server.

## Sequencing

1. **Rules core.** `src/shared/leadRules.js`, with `test/leadRules.test.js`.
2. **Status scanner.** `src/shared/programStatus.js`, with `test/programStatus.test.js` (2.1.331 fixture).
3. **Status in ptyManager.** Run the scanner in `onData`, answer the probe and keep the per-terminal state and paste mode. Add `agentStatus`, `pasteMode`, `noteUserInput` (called from the `TERMINAL_INPUT_ID` handler), `getForegroundName` and `getForegroundPid` (the existing `tpgid` lookup). This one change covers both machines. A Frame terminal running Claude ≥ 2.1.295 now has a live status.
4. **Protocol.** `src/shared/leadProtocol.js`, with `test/leadProtocol.test.js`.
5. **Transcript summary.**
   - `src/shared/leadTranscript.js`, with `test/leadTranscript.test.js`.
   - Export `transcriptFor` from `sessionRestore.js`.
   - Export the path helpers from `claudeSessionsManager.js`.
6. **MCP server and role.** `src/templates/lead/lead-mcp.js` and `CHIEF.md`, with `test/leadMcp.test.js` against a stub socket.
7. **Host.** `src/main/leadHost.js`:
   - socket and token, a tool registry with per-action approval flags;
   - per-target delivery (bracketed paste, readiness-gated FIFO);
   - waits, generic approval records (first decision wins, cancel), mode store;
   - materialize the files and build the launch command (`FRAME_NODE`, `--mcp-config`, `--allowedTools 'mcp__frame-lead__*'`).
8. **Local lead terminal.**
   - `lead` flag in `ptyManager.createTerminal`: one per project, out of the cap, not registered with sessionRestore.
   - Add the `LEAD_*` channels to `ipcChannels.js`.
9. **Desktop adapter.** `src/main/leadManager.js`, wired in `src/main/index.js`. Add `readScreenText` to `terminalManager.js`.
10. **Local Chief UI.**
    - `src/renderer/chiefLane.js` and `styles/components/chief.css` (imported from `main.css`): ensure and pin, Start overlay, mode toggle, approval cards, badge, sticky toast.
    - In `terminalManager.js`, leave Chief out of the cap and refuse to close it.
    - In `terminalsView.js`, pin Chief first with no close button.
    - The local Chief is usable end to end after this step.
11. **Server side.**
    - `screenMirror.text()`.
    - `lead` flag on `terminals.create` and in `describe`, one per `projectPath`; `noteUserInput` in `terminals.input`.
    - `src/server/lead.js`: server adapter, `lead.approval` event, `lead.decide` / `lead.pending` / `lead.mode` methods. Wire it in `src/server/index.js`.
12. **Server Chief on the desktop.**
    - `ptyManager.js`: `createServerTerminal` passes `lead`, and `adoptFrom` recognises lead terminals by server project path.
    - `terminalManager.js`: names them "Chief · host" in `main`.
    - `chiefLane.js`: ensures one per connected server that holds the project, shows the server's approval cards and fetches pending ones on reconnect.
