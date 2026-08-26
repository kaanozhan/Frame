# Outcome — sidebar-nav-groups

Shipped 2026-08-26. Live-verified, 330 tests pass, no page errors.

## What shipped

- **Three groups** where ten flat rows were: **WORK** (Terminals, GitHub,
  Claude) · **CONTEXT** (Specs, Tasks, Decisions, Structure, Prompts) ·
  **FRAME** (Activity). Headers are quiet uppercase labels, not buttons.
- **Collapse/expand per group**, persisted in `localStorage`
  (`frame-nav-groups`), keyboard-operable (Enter / Space on the header).
- **A collapsed group holding the active surface marks its header.** Without
  that, folding Context while sitting in Tasks made "where am I" vanish.
- Everything the rows already did still works: Terminals count, the
  running-agent chip, Specs / Tasks counts, active-row highlight.
- **History retired** — nav row, `PANEL_REGISTRY` entry, palette entry,
  `#history-panel` markup and `historyPanel.js`, plus the duplicate
  `panel.toggleHistory` command. `promptsPanel` and `historyPanel` both sent
  `LOAD_PROMPT_HISTORY` and rendered `PROMPT_HISTORY_DATA`: two surfaces, one
  dataset. The channels stay; Prompts is their consumer.
- The icon rail, Files, Changes and Settings are untouched — the user
  withdrew the Project group mid-request.

## Found while verifying: four commands that never worked

`registerCommands()` is a top-level function, but four of its commands closed
over `multiTerminalUI` — a `const` declared inside `init()`. Every one threw
`ReferenceError: multiTerminalUI is not defined`, and `runById`'s catch
turned that into a console line nobody reads. So **Toggle Prompts (⌘⇧L),
Toggle Claude (⌘⇧X), Toggle GitHub (⌘⇧G)** and the retired history toggle
have been dead for as long as they have existed. They now resolve the UI the
way the sidebar rows do; ⌘⇧L and ⌘⇧G verified opening their panels live.

Also renamed `panel.togglePlugins`' title from "Toggle Plugins Panel" to
"Toggle Claude Panel": it opens the Claude panel, and every other surface
already called it that.

## Verified live

Groups render with the right rows and counts (Specs 13, Tasks 61) · clicking
Tasks lights its row · collapsing Context hides its rows and moves the
highlight to the header · Terminals count tracks a new terminal · History is
gone from nav, markup and palette · the panel shortcuts open their panels ·
after a window reload the stored collapse state is applied (work + frame
folded, context open) and expanding writes back.

**One claim I could not verify here:** survival across a full process
restart. In the Playwright harness *no* localStorage key survives a relaunch
— a plain canary written and given 6s to settle came back `null`, because the
app is killed rather than quit, so Chromium never flushes its LevelDB. The
read path is proven by the reload test, and the mechanism is the same one
`frame-theme` and `frame-terminals-view` already ship with.
