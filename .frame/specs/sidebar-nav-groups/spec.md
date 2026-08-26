# The sidebar nav gets groups, and loses a duplicate

> **What we're building:** The ten flat rows in the workspace nav become
> three named, collapsible groups — Work, Context, Frame — and the History
> panel retires, because it and Prompts are two windows onto the same data.

## User's request (original, Turkish)

> şu sol menüyü de toparlayalım, work, context, Frame, Project olarak
> ayırsak mı? workun altına Terminals, github, Claude gelir, contextin altına
> specs, tasks, decisions, structure, prompts, history yi kaldıralım aynı
> şeyleri yazıyoruz gibi görünüyor. Frame'in altına activity […] bunlar da
> tabi ağaç şeklinde olacak, kapatılıp açılınabilecek.

And then, narrowing it:

> ya da vazgeçtim ya sol bar dursun, project sectionı yapmayalım, diff ve
> proje ağacı orada dursun.

So the **Project** group is not built: the icon rail stays as it is, and
Files / Changes keep their place in it. Settings stays there too — it was
only going to move because the rail was going to empty out.

## The duplicate, verified

`promptsPanel` and `historyPanel` both send `LOAD_PROMPT_HISTORY`, both
render `PROMPT_HISTORY_DATA`, and both listen for `TOGGLE_HISTORY_PANEL`.
Two surfaces, one dataset. Prompts stays (search, per-project, expandable
cards); History retires — the user's call when asked.

## Goal / Acceptance

- The nav renders three groups with quiet headers:
  - **WORK** — Terminals, GitHub, Claude
  - **CONTEXT** — Specs, Tasks, Decisions, Structure, Prompts
  - **FRAME** — Activity
- A header click collapses and expands its group, and the state survives a
  restart (per group, not per project).
- Everything the rows do today keeps working: the Terminals count and the
  running-agent chip, the Specs / Tasks counts, and the active-surface
  highlight — including when a collapsed group holds the active row, which
  must be visible on the header.
- History is gone from the nav, the palette, the panel registry and the
  markup. `LOAD_PROMPT_HISTORY` / `PROMPT_HISTORY_DATA` /
  `TOGGLE_HISTORY_PANEL` stay: they are Prompts' channels too, and the
  toggle now opens Prompts.
- No change to the icon rail, Files, Changes, or Settings.
