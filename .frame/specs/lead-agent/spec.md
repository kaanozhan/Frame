---
keywords: chief, lead agent, supervisor, read terminals, send to terminal, frame server, osc 7501, program status, approval modes
related: agent-orchestration, lane-orchestrator, agent-dispatch, agent-ready-never-quiet-terminal, server-workspaces, workspaces, sessions-from-transcripts, agentlar-iin-roller-tanmlamay-dnyorum-aklmdaki-f, server-onboarding, multi-server-connections
---

# Lead agent

## User's request (original, Turkish)

> terimanellerin birbiriyle konuşmasını sağlamak zor bir iş mi? istediğim şöyle
> bir şey, ana bir terminal ve session-agent olsun, o bütün terminalleri
> görebilsin, agentların ne yaptığını görsün ve ben ona iş yaptrabileyim

Decisions taken in the conversation: scope is one project including all of its
workspaces, not other projects; it is a new role, not an extended conductor,
but it reuses the conductor's mechanics; it runs on the machine its terminals
live on.

Follow-up (2026-11-24): "bence default supervisor veya chief gibi bir terminal
gelmeli, hep orada durmalı" — the lead is a default, permanent terminal, not
something the user marks.

Follow-up (2026-11-24): "Chief olsun, tek tıkla başlasın, sınıra sayılmasın" —
user-facing name is **Chief**; the session starts on one click; the Chief
terminal does not count toward the terminal cap.

Follow-up (2026-11-24): "benim onayımda olan taraf için yine iki mod
koyabiliriz, full auto ve user-guided gibi bişey. full auto seçerse
terminallere serbestçe yazar, öbüründe onay isteyerek" — `send` gets two
modes; agreed refinements: user-guided is the default, approval lives in
Frame's UI (not Claude's permission prompt), hard refusals hold in both
modes, mode is per project and switchable on the Chief terminal.

Follow-up (2026-11-24, during /spec.plan): `main` is always local in Frame —
only workspaces live on servers — so a Chief pinned to `main` could never run
on a server. The user: "amaç zaten sunucuda chief i çalıştırabilmek aslında,
lokalden daha önemli". After researching off-the-shelf options (OmniRoute is
an LLM gateway, not relevant; claude-session-orchestrator and AWS CAO own
their own tmux terminals and cannot see Frame's PTYs; Claude Code's
cross-session messaging carries text only), the user chose: "local için bir
chief, remote içinde de her sunucu için bir chief … localle remote u
konuşturmaktan feragat ederiz" — one Chief per machine, no local ↔ server
link in this version. Borrowed from claude-session-orchestrator as ideas, not
as a dependency: agent status reported by Claude Code itself, "what is it
doing" from the transcript, send refused while an approval is pending.

Plan review (2026-11-24, "tekrar bir gözden geçir … sağlam yapalım"): Claude
Code ≥ 2.1.295 reports its own state to a terminal that answers its OSC 7501
probe (verified against 2.1.331: probe `ESC]7501;?`, after Frame-style answer
it emits `ESC]7501;state=idle:app=claude-code`; states working / blocked
(kind permission|question|auth) / done / idle / error / clear). Frame is the
terminal, so status comes from the PTY stream — no hooks, no settings files.
A server Chief is shown like a server home terminal: in `main`'s terminal
list, labelled with its host.

Direction (2026-11-25): the user's next goal is a work queue (specs, tasks,
small jobs) that the Chief works through — opening terminals, delegating,
monitoring and checking the results. On the conductor: "conductor kodda
duruyor ama kullanmıyoruz. chief yapısını da ekledikten sonra ve
oturttuktan sonra conductor ı gerçek anlamda emekli edeceğiz … conductor ın
daha yeteneklisini, daha kapsamlısını yapıyoruz … daha iyi alternatiflerin
varsa yeniden de yazabilirsin". On context: "işimiz bittiğinde chief i de
temizlememiz gerekiyor bir noktada".

## Problem

A project's work is now spread over many terminals: `main`, several
workspaces, each with its own Claude session, test runner, dev server. The
user is the only thing connecting them — they switch lanes to read what each
agent is doing and type every instruction by hand. The conductor
(agent-orchestration) is the only agent that can reach another terminal, and
only the worker lanes it spawned for specs; it cannot see or steer anything
else. There is no single place to ask "what is everyone doing?" or "tell the
agent in workspace blue to also run the tests".

## Goal

A **lead agent** per project **per machine**, each living in a **default,
permanent lead terminal** — always present, pinned first, no "mark as lead"
step:

- **Local Chief** — in the project's `main`; sees the project's local
  terminals (`main` + local workspaces).
- **Server Chief** — one for each Frame Server that hosts workspaces of the
  project; runs on that server in the project's server clone
  (`~/frame/projects/<repo>`, from `projects.ensure`); sees the project's
  terminals on that server; keeps running while the desktop is away. In the
  UI it sits in `main`'s terminal list right after the local Chief, labelled
  "Chief · <host>" — the placement server home terminals already use
  (server-onboarding), since the sidebar has rows per workspace, not per
  terminal.
 In the UI it is called **Chief**; code ids,
files and IPC say `lead` (the lane-orchestrator naming rule: code says one
thing, the UI another). Driven by a lead role file, it can:

1. **List** every terminal of the project on its machine — with id,
   workspace, cwd, what runs in it (agent name / process) and agent status.
2. **Read** any of them as clean text: the current screen (last N lines) from
   a headless screen mirror, and for Claude terminals a structured summary of
   recent activity from the session transcript (tools used, files touched,
   last messages). Agent status (working / waiting for input / waiting for
   approval or a question) comes from Claude Code's own OSC 7501 status
   reports in the terminal stream; plain shells from the foreground process.
3. **Send** a prompt to a terminal, delivered only when that terminal's agent
   is ready, queued otherwise, with the conductor's paste-and-submit pacing.
   `send` runs in one of two modes, per project:
   - **User-guided** (default) — every send waits for the user's approval on
     a card over the Chief terminal (target + text; Approve / Reject / Edit).
   - **Full auto** — sends go out without asking.

The command layer is one shared module that both the desktop main process and
Frame Server run, so a local and a server Chief behave the same. How the agent
calls it (bus scripts like `.frame/bin/dispatch.js`, or an MCP server) is a
plan decision.

## Constraints

- **The Chief succeeds the conductor.** The conductor is unused legacy and
  will be retired once the Chief is established; the Chief is its more
  capable replacement, not a peer. This spec neither depends on nor extends
  conductor code: it reuses an idea only where it is still the best answer
  and otherwise writes the better one (e.g. delivery uses bracketed paste and
  agent-reported readiness instead of `relayToConductor`'s fixed pauses).
  Conductor files are not modified.
- **One steerer per terminal while the conductor still exists.** If a
  conductor session happens to be running, the Chief may list and read its
  lanes but `send` to them is refused (read from the conductor's public
  state).
- **Built to grow into the work queue.** The tool layer and the host adapters
  are shaped so later tools (open a terminal, create a workspace, take the
  next queue item, check a result) slot in without reworking this spec; the
  approval card is a general "Chief wants to do X" card, not send-specific,
  and both modes (user-guided / full auto) are defined per action.
- **The Chief keeps no state of its own.** It reads, summarises and routes;
  the work happens in the target sessions. Reads are compact by default (a
  screen and an activity summary, never a whole transcript). The truth lives
  in terminals, transcripts and (later) the queue, so a Chief can be cleared
  or restarted at any time and rebuild its picture with one list call; the
  role says so.
- **Scope = one project on one machine.** Terminals are already tagged
  `projectPath` + `workspaceId` (`ptyManager`; `src/server/terminals.js`
  meta). Never another project's terminals. Orchestration stays per-project
  (agent-orchestration decision).
- **One Chief per (project, machine).** A Chief only lists, reads and writes
  terminals on its own machine. The local Chief never reaches server
  terminals, and a server Chief never reaches desktop terminals — the access
  direction stays desktop → server (server-workspaces / server-hardening
  security decision). Server home terminals (server-onboarding) belong to no
  project and are not listed.
- **Readiness is not silence.** `send` must not rely on 1.8 s of terminal
  quiet (the agent-ready-never-quiet-terminal bug). Agent status comes from
  Claude Code's OSC 7501 Program Status reports, which the PTY owner (desktop
  main or Frame Server) enables by answering Claude's probe. A terminal with
  no report (Claude < 2.1.295, Codex, a session started before Frame answered)
  is `unknown` and `send` refuses it with a reason; plain shells are judged by
  their foreground process.
- **Never type over the user.** A send to a terminal the user typed into in
  the last few seconds waits until they stop.
- **Reading means clean text.** No raw ANSI byte logs. Server reuses
  `src/server/screenMirror.js`; the desktop reads the renderer's own xterm
  buffer instead of adding a second headless parser per PTY (decided at
  /spec.plan, 2026-11-24 — the renderer already holds every local screen). Transcripts are read with sessions-from-transcripts' parser and honour
  `CLAUDE_CONFIG_DIR`.
- **`send` never auto-answers prompts.** A terminal waiting on a permission
  or y/n prompt is reported as such; the lead's `send` to it is refused.
- **Hard refusals are mode-independent.** Conductor/worker lanes and
  terminals on a permission or y/n prompt are refused in full auto too; full
  auto only removes the per-send approval.
- **Approval is enforced by Frame, not by the agent.** In user-guided mode
  the command layer holds the send until the user approves in Frame's UI;
  Claude Code's own Bash permission prompt is not the gate (an "always
  allow" would silently disable it). A server Chief's pending approval waits
  until a desktop connects and shows it; in full auto the server Chief needs
  no desktop.
- The lead role file follows the roles template
  (agentlar-iin-roller-…: `src/templates/roles/AGENTS.md`) and stays within
  Claude Code's 4,096-character limit for MCP server instructions.
- No new runtime dependency beyond the xterm-headless/serialize pair Frame
  Server already ships. claude-session-orchestrator, CAO and similar tools are
  references, not dependencies.

## Success Criteria

- When a project opens, then its local Chief terminal exists in `main`,
  pinned first and visibly distinct, showing a one-click Start — no Claude
  session runs until the user clicks it. Exactly one local Chief per project.
- When a project has workspaces on a connected Frame Server, then `main`'s
  terminal list shows that server's Chief ("Chief · <host>") right after the
  local Chief, with the same one-click Start; the session runs on the server
  in the project's server clone. Exactly one Chief per (project, server).
- When the user clicks Start, then a Claude session starts there with the
  lead role loaded and the bus scripts in its env.
- When the Chief exists, then `main` still allows 9 regular terminals
  besides it — the Chief does not count toward the per-workspace cap.
- When the user tries to close the lead terminal, or its process exits, then
  the lead terminal stays (closing is not offered; an exited session can be
  restarted in place) — it is never simply gone.
- When the app restarts or the renderer reloads, then the same project still
  has exactly one lead terminal (no duplicates from session restore).
- When the local Chief lists terminals, then it gets `main` and every local
  workspace's terminals, with workspace, cwd, process/agent and status — and
  no server terminal and nothing from other projects.
- When a server Chief lists terminals, then it gets the project's terminals
  on that server — and no desktop terminal, no other server's, no home
  terminal, nothing from other projects.
- When Claude Code (≥ 2.1.295) in a target terminal starts working, finishes
  or is interrupted, or raises a permission prompt or a question, then its
  status changes as soon as Claude's status report arrives, with no
  dependence on terminal silence; an older CLI shows `unknown`.
- When the user typed into the target in the last few seconds, then a send
  waits until they stop.
- When the lead runs `read <id>` on a terminal running Claude Code, then it
  gets the visible screen as plain text (no escape codes) and a transcript
  summary of recent tool calls and messages.
- When the lead runs `send <id> "…"` and the target agent is ready, then the
  text is submitted as one prompt; when the target is busy, then it is queued
  and delivered once ready; the command reports which.
- When the target is the conductor or one of its workers, or is sitting on a
  permission / y/n prompt, then `send` is refused with a reason.
- When a server Chief is running and the desktop disconnects, then its list /
  read / send keep working (sends in full auto go out; user-guided sends wait),
  and on reconnect the Chief terminal redraws what happened and pending
  approval cards appear.
- When a Chief runs on a Frame Server, then no command it can issue reaches a
  desktop terminal (covered by a test).
- When a project has never set a mode, then `send` is user-guided.
- When the mode is user-guided and the lead runs `send`, then nothing reaches
  the target until the user approves the card; Reject tells the lead it was
  rejected; Edit delivers the user's edited text instead.
- When the mode is full auto, then an allowed `send` is delivered without a
  card, and a refused target is still refused.
- When the user switches the mode on the Chief terminal, then it is saved for
  the project, visible on the Chief terminal, and applies from the next send.
- When the Chief session is restarted, then its first list call shows the
  same terminals and statuses as before, with nothing lost.
- When two `send`s target the same terminal, then they are delivered in order,
  never interleaved.

## Out of Scope

- Cross-project / global overview mode
- Local ↔ server link: local Chief reading server terminals, or Chief-to-Chief
  messaging (candidate: Claude Code cross-session messaging)
- Work queue: queue screen, Chief taking queue items, opening terminals /
  workspaces, delegating, monitoring and checking results, cleaning up after
  (next spec; it may reuse or replace the conductor's worktree dispatch and
  footprint guard)
- Retiring the conductor (after the Chief and the queue are established)
- A dedicated lead UI panel beyond the pinned lead terminal itself
- Per-terminal send permissions in user-guided mode ("this terminal is free")
