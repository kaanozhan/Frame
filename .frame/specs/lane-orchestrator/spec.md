# Lane Orchestrator — home screen for terminals as lanes

> **What we're building:** Frame's initial view becomes a **Lane Orchestrator**
> board instead of dropping the user straight into a terminal. Every terminal is
> a **lane**, shown as a card with metadata and a live activity status
> (processing / waiting / idle). The user enters a lane to get the full terminal
> view, returns to the board instantly, and can jump between lanes from inside
> the detail view without going back home. The tab bar paradigm is retired;
> grid view survives as a "watch several lanes at once" mode.

---

## Problem

When Frame opens today, the user lands directly in a single auto-created
terminal with a tab bar on top (`multiTerminalUI.js` auto-creates terminal #1
via `autoCreateInitialTerminal`). This has several consequences:

1. **No orchestration surface.** Frame's vision is managing multiple parallel
   AI-driven work streams, but the first thing the user sees is one terminal —
   there is no place that answers "what is running right now, and what state is
   each session in?"
2. **Tabs hide state.** With N terminals as tabs, only the active one is
   visible. A Claude Code session in tab 3 may be sitting blocked on a
   permission prompt for ten minutes and nothing in the UI says so.
3. **Tabs don't scale conceptually.** Each terminal increasingly represents a
   *work stream* (an AI session on a project/branch), not just a shell. A row of
   small tabs gives no room for that identity (project, tool, activity, status).

User's request (original, Turkish):

> "Frame ilk açıldığında ... initial olarak bir ekran görmek istiyorum. Bunu da
> bir lane orchestrator olarak düşünebiliriz. Bu ekrandan terminal de
> eklenebilecek. Terminalleri tab tab görmektense bir lane olarak görüp
> istediğimiz lane'e girebileceğimiz bir genel ekran yapısı olmalı. Detay
> ekrandan da çok hızlı bir şekilde ana ekrana dönebileceğimiz bir yapı olmalı;
> ayrıca detaydayken bir menüden de kolayca ana ekranda neler varsa onları
> görüp tab gibi geçiş yapabilmeliyiz."

---

## Goal

### 1. Home screen: the Lane Orchestrator board

- On app launch, the user sees a **board of lane cards**, not a terminal.
  No terminal is auto-created (`autoCreateInitialTerminal` behavior retired).
- **Lane = terminal, 1:1.** A lane card is backed by an entry in
  `terminalManager`'s existing terminal state Map — no new data model.
- Each card shows **metadata only** (no embedded xterm preview in v1):
  - lane name (today's terminal name, renameable from the card)
  - project (name/path) the terminal belongs to
  - AI tool indicator if one was launched in it
  - last-activity time (relative, e.g. "2m ago")
  - **activity status badge** — see Goal 3
- A **"+ New Lane"** card/button creates a new terminal (same options as
  today's new-terminal flow: shell picker, project cwd) and enters it.
- Empty state: no lanes yet → designed empty state with a single CTA to create
  the first lane.

### 2. Lane detail: enter / leave / switch

- Clicking a card **enters the lane**: the full-screen terminal view rendered
  with the existing `mountTerminal` machinery. No re-architecture of terminal
  rendering.
- **Fast return home:** a persistent home button in the detail header plus a
  keyboard shortcut (must not collide with terminal input — e.g. `Cmd+Esc` or
  `Cmd+H`; final binding decided in plan phase via `commandRegistry`).
- **Switching without going home:** from the detail view, a **lane switcher**
  surface lists all lanes (with the same status badges) and switches on click —
  the tab-like fast path. Existing shortcuts `Ctrl+Tab` / `Ctrl+Shift+Tab` /
  `Ctrl+1-9` are rebound to lane switching and keep working from detail view.
- The current **tab bar is removed**. Toolbar functions living in the tab bar
  today (overview toggle, panels, etc.) are rehomed in the plan phase — no
  functionality silently dropped.

### 3. Activity status detection (processing / waiting / idle)

Each lane card and the lane switcher show one of:

- **`processing`** — the PTY is actively producing output (AI tool or command
  running). Heuristic: output chunks observed within a rolling window
  (e.g. last 2–3 s).
- **`waiting`** — a tool is blocked on user input: Claude Code's input-box
  prompt pattern (`╭` frame), permission prompts (`y/n`), or similar
  awaiting-input signatures after output has gone quiet.
- **`idle`** — shell prompt, nothing running (covers "completed": a lane that
  finished work and returned to prompt reads as idle, with last-activity time
  telling the user how long ago).

Notes:

- Detection is **heuristic over the existing PTY output stream** (output
  watcher + pattern matching + quiet-period timers). This intentionally
  overlaps `task-claude-detect` in tasks.json — that task is effectively
  absorbed by this slice of the spec.
- Status transitions must update cards **live** while the user is on the board
  (the board subscribes to terminal output events, throttled).

### 4. Grid view survives, tabs do not

- **Grid view** remains as the "watch multiple lanes side by side" mode,
  reachable from the board (e.g. a "Grid" action) and from the existing
  shortcut. Leaving grid returns to the board.
- The **tabs view mode is removed** (`viewMode: 'tabs'` paradigm replaced by
  board ↔ detail navigation).

---

## Constraints

- **No main-process/PTY architecture changes.** `ptyManager` stays as is; lane
  status detection lives renderer-side on the already-streamed output
  (`TERMINAL_OUTPUT_ID`). New IPC channels only if strictly necessary.
- **Terminal sessions must survive navigation.** Entering/leaving lanes
  re-mounts existing xterm instances (as tab switching does today); never
  recreate or lose a PTY when moving between board, detail, and grid.
- Max-9-terminals limit unchanged.
- Existing integrations that target "the active terminal" (task play button,
  spec commands, menu `sendCommand`, Discuss flow) must keep working — when
  invoked from the board with no lane entered, behavior is defined in the plan
  phase (e.g. enter most recent lane or create one).
- Theme system and existing CSS architecture (`styles/components/*.css`)
  respected; new styles in a dedicated `lane-orchestrator.css`.
- Status detection must be cheap: no polling loops per terminal beyond
  lightweight timers; no parsing cost when a lane's buffer is quiet.

---

## Success Criteria

1. **When the app launches**, the Lane Orchestrator board is shown and no
   terminal has been auto-created.
2. **When the user clicks "+ New Lane"**, a terminal is created and its full
   detail view opens; pressing the home shortcut or button returns to the board
   in a single action with the session intact.
3. **When the user clicks an existing lane card**, the detail view shows that
   terminal exactly as it was (scrollback preserved, process untouched).
4. **When a lane's terminal is producing output**, its card/switcher badge
   shows `processing` within ~1 s; **when Claude Code stops at an input or
   permission prompt**, the badge flips to `waiting`; **when the shell is at
   prompt**, it reads `idle` — all without entering the lane.
5. **When the user is inside a lane**, the lane switcher lists all lanes with
   status badges and switches on click; `Ctrl+Tab` / `Ctrl+1-9` switch lanes
   directly.
6. **Grid view** is reachable from the board, shows multiple lanes live, and
   exiting it returns to the board. The old tab bar no longer exists anywhere.
7. All previously tab-bar-hosted actions (overview toggle, new terminal,
   rename, close) remain reachable in the new UI.
8. Existing flows that send commands to terminals (task ▶ button, spec
   commands, menu AI commands) still work.

---

## Out of Scope

- **Lane = work-context model** (lane bundling spec + tasks + branch metadata).
  Lane stays 1:1 with terminal in this spec; richer lane identity is a future
  spec.
- **Live xterm mini-previews on cards** — v1 cards are metadata-only; a
  preview/snapshot upgrade can ship later.
- **Window/layout state persistence** across app restarts
  (`task-prod-window-restore` is separate).
- **Detachable lane windows / multi-monitor** (`task-prod-detach-window`).
- Autopilot/activity-feed features from Slice 4 — the status badge here is a
  lightweight heuristic, not the full live activity feed (`spec-4.3`).
- Renaming the "terminal" concept in code — internal naming stays; "lane" is a
  UI-level term in v1.
