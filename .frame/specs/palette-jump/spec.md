# Palette jump — ⌘K becomes the prototype's everything-jumper

> **What we're building:** The command palette gains dynamic jump targets:
> projects, terminals (across projects), the current project's specs, and
> the workspace views — alongside the existing commands. One search box,
> prototype-style: "CL" → jump to ClaudeCodeIDE, a spec title → its
> lifecycle view, a terminal name → focus it.

## User's request (original, Turkish)

> ⌘K paletini de yapalım o zaman

(Referencing the prototype's palette: project / rail / frame / view / action
entries in one list.)

## Goal / Acceptance

- ⌘K search surfaces, fuzzy-matched together with commands:
  - **Projects** (category "Project") — select the project (rail flow).
  - **Terminals** (category "Terminal") — every open terminal across all
    projects, labeled "name — project"; picking one focuses it, switching
    project first when needed (presence-chip flow).
  - **Specs** (category "Spec") — current project's specs by title; picking
    one opens the lifecycle view (specSection).
  - **Views** (category "Go to") — the nine workspace destinations
    (Terminals/Specs/Tasks/Overview/GitHub/Claude/Prompts/History/Activity).
- Dynamic items are computed at search time (no stale lists); spec titles
  come from a push-fed cache (SPEC_DATA), never a sync IPC call in search.
- Static commands, recents, shortcuts keep working exactly as before;
  transient items stay out of the recents store.
- No main-process / IPC changes.

## Constraints

- Registry-level feature (providers), not palette-level hacks — the palette
  keeps rendering whatever the registry returns.
