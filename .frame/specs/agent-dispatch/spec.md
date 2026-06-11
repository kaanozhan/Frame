# Agent Dispatch — lane-aware task & spec runs

> **What we're building:** The flows that inject prompts into terminals (task
> ▶ run, spec commands) are rebuilt on top of the lane orchestrator. A single
> **Agent Dispatch** layer becomes the only door for "deliver this prompt to
> an agent": it creates/targets lanes, starts the agent, waits for an
> **agent-ready signal** from lane status detection instead of blind
> timeouts, and then injects. Task runs always open a **new Frame**; spec
> runs get a **lane assignment** model (continue in the assigned Frame or
> open a new one — always asked). Lane cards show which spec/task a Frame is
> working on.

---

## Problem

Two flows inject prompts into terminals today, each with its own ad-hoc
mechanics, and both assume the retired tab-bar world:

1. **Task run** (`taskRunModal.js` + `tasksPanel.runTaskWithOptions`):
   - "Use current terminal" writes the prompt into the *active* terminal
     **without verifying an agent is running there** — a bare zsh happily
     receives a multi-paragraph task prompt.
   - "New terminal" stacks **blind timeouts**: create terminal → wait 1 s →
     send CLI start command (`terminal.js:113`) → wait another 4 s → inject
     prompt (`tasksPanel.js:519`). On a slow machine the agent isn't up yet
     and the prompt is lost; on a fast one the user stares at 5 idle seconds.
2. **Spec run** (`specPanel.runSpecCommand`): no target choice at all — the
   instruction is sent to whatever terminal is active (creating a bare one if
   none exists). Works only if the user happens to have an agent focused.

The lane orchestrator breaks the remaining assumptions: from the board there
is no meaningful "current terminal", and lanes now carry live agent/status
detection (`laneStatus`) that makes timeout-guessing obsolete.

User's request (original, Turkish):

> "Spec ya da Task run edilirken terminalde agent çalıştırıp prompt
> injectiyle yapıyoruz bu akışları. Bunu yeni sisteme adapte etmemiz
> gerekiyor. [...] Aslında amacımız Frame'i biraz daha lane orchestration
> yapısına taşımak, o nedenle task direkt yeni bir frame'de açılabilir ama
> branch işlerini falan değiştirmeyelim. Bir spec ya da bir task o frame'e
> atanmışsa onu frame kartlarında göstersek harika olur. Ona atanmış hali
> hazırda bir lane varsa spec'te direkt orada devam edebilir ya da opsiyonel
> olarak yeni bir frame de açabilir ama var olan atanmış olanda sorulmalı
> her zaman."

---

## Goal

### 1. Agent Dispatch layer (single choke point)

A new renderer module (e.g. `agentDispatch.js`) owns "deliver a prompt to an
agent in a lane". Both task and spec runs (and, later, the Frame Starter
overlay) go through it. Contract:

- **Target: existing lane** → verify an agent is detected in that lane
  (foreground process / `laneStatus`); if the agent has exited, **start it
  first** (same start-command machinery), wait for ready, then inject.
- **Target: new lane** → create the terminal (existing
  `createTerminal` path, per-project cap respected), enter it, start the
  chosen agent, **wait for the agent-ready signal**, then inject.
- **Agent-ready signal:** derived from the existing `laneStatus` detection —
  the agent process is in the foreground and the lane has settled into
  `waiting` (input-box prompt visible). No new PTY/main-process machinery.
  A fallback timeout (final value in plan phase, e.g. ~15 s) aborts with a
  visible error toast — the prompt is **never** typed into a bare shell.
- **Injection mechanics preserved:** the text-then-Enter split
  (`terminalSendPromptThenEnter`) and the `.frame/runtime/prompts/` file
  staging for long spec prompts (`BUILD_SPEC_COMMAND_FILE`) stay exactly as
  they are — dispatch wraps them, it does not reinvent them.
- The scattered `window.terminalCreateAndStart` / raw `setTimeout` paths are
  retired in favor of dispatch.

### 2. Task run: always a new Frame

- The task run modal **drops the "current terminal / new terminal" choice**:
  running a task always creates a new Frame and dispatches the agent + prompt
  there.
- **CLI tool choice and all branch options stay unchanged** (current branch /
  new branch + name, prompt-side branch instructions, CLI availability
  pre-flight). Only the terminal-targeting section of the modal changes.
- After dispatch the user lands in the new Frame (lane detail), watching the
  agent receive the task.

### 3. Spec run: lane assignment, always asked when one exists

- Each spec (slug) can have an **assigned lane**. Assignment is established
  the first time a spec command runs: a new Frame is created, dispatched to,
  and recorded as that spec's lane.
- **No assigned lane (or it was closed):** run creates a new Frame directly —
  no question — and assigns it.
- **Assigned lane exists:** every spec command run asks the user:
  - **"Continue in \<Frame name\>"** (default) → dispatch to the assigned
    lane; if its agent has exited, dispatch restarts it there first.
  - **"Open a new Frame"** → new lane is created, dispatched to, and becomes
    the new assignment (the old lane is simply unassigned, not closed).
- Assignment lives in renderer state alongside the existing per-terminal
  state (same place lane name/project live). Session-scoped; persistence
  across app restarts is out of scope.

### 4. Lane cards show their work

- A lane card (board) and the lane switcher entry show **what is assigned to
  that Frame**:
  - spec assignment → badge/line with the spec title or slug (e.g.
    `spec: agent-dispatch`)
  - task run → badge/line with the task title (truncated)
- One assignment label per lane (the most recent dispatch wins the label).
- The label clears when the lane is closed; it is presentation metadata, not
  a lifecycle binding (closing a lane never touches the task/spec itself).

---

## Constraints

- **No main-process / PTY changes.** Dispatch, readiness detection, and
  assignments are renderer-side. Existing IPC (`TERMINAL_INPUT_ID`,
  `BUILD_SPEC_COMMAND_FILE`, `CHECK_AI_TOOL_AVAILABLE`) is reused; no new
  channels unless strictly necessary.
- **Branch behavior untouched.** `buildTaskPrompt`'s branch instructions and
  the modal's branch UI/logic are not modified by this spec.
- **Prompt content untouched.** Task prompt building and spec command
  templates (`.frame/templates/commands/...`) stay as they are.
- Per-project max-terminal cap applies to dispatch-created lanes; hitting the
  cap surfaces a clear error instead of silently failing.
- Existing `multiTerminalUI.sendCommand` consumers that are *not* prompt
  injection (menu accelerators Cmd+K/Cmd+I, Discuss flow) keep working
  unchanged; migrating them to dispatch is optional and only where behavior
  is identical.
- Status/agent detection heuristics are reused as-is from the lane
  orchestrator work; this spec may *consume* `laneStatus` events but does not
  redesign detection.

---

## Success Criteria

1. **Running a task** (▶) opens the run modal without any terminal choice;
   confirming creates a new Frame, starts the chosen CLI, and the prompt is
   injected **only after** the agent is detected ready — no fixed sleeps. The
   user ends up inside that Frame.
2. **Running a spec command for the first time** creates a new Frame, runs
   the agent, injects the instruction, and the spec is now assigned to that
   Frame.
3. **Running a subsequent spec command** with the assigned Frame alive always
   asks "Continue in \<Frame\> / Open a new Frame"; choosing continue reuses
   the same agent session, choosing new re-assigns to a fresh Frame.
4. **If the assigned Frame's agent has exited**, choosing continue restarts
   the agent in that Frame and then injects — the prompt never lands in a
   bare shell, in any flow.
5. **If agent readiness is never detected** (CLI hangs/fails), the flow
   aborts with a visible error and no prompt text appears in the terminal.
6. **Lane cards and the switcher** show the assigned spec/task label for
   Frames that received a dispatch, and stop showing it when the lane is
   closed.
7. **Branch options on the task modal** behave byte-for-byte as before.
8. Menu AI commands (Cmd+K/Cmd+I) and the Discuss flow are unaffected.

---

## Out of Scope

- **Frame Starter overlay** (create-then-decide UX for the + buttons) — next
  spec; it will consume this dispatch layer.
- **Persisting lane assignments across app restarts.**
- **Multiple concurrent assignments per lane** (a queue/history of dispatched
  work) — one label per lane in v1.
- **Task/spec status sync back from the lane** (e.g. auto-completing a task
  when the agent finishes) — separate, future concern.
- Changes to prompt templates, branch logic, or the
  `.frame/runtime/prompts/` staging mechanism.
- Removing the sidebar "Start \<agent\>" button — stays parked for the Frame
  Starter spec (per the sidebar-project-section spec's deferral).
