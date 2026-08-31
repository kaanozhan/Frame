# Project dropdown — the rail retires, selection moves to the top switcher

> **What we're building:** The far-left project rail (shipped earlier today
> by project-rail) is removed. Project selection happens in the existing
> current-project dropdown at the top of the sidebar — now visible on every
> tab including Projects — exactly like the Files/Changes views already do.
> "Add new Project" is tucked at the bottom of the left panel.

## User's request (original, Turkish)

> projects barını da kaldıralım ya, projeleri tepeden dropdowndan
> seçebilelim, ona göre değişsin. zaten mesela folder view e geçtiğimiz
> zaman görebiliyoruz. sadece ilk bölümde de öyle olsun, böylece proje
> seçimi yapılabilsin, add new projecti de soldaki panelde en alta gömeriz

## Decisions overturned (explicitly)

- **project-rail (done, same day) → overturned.** The rail column, avatars
  and flyout go; the workspace-head block goes too (the dropdown button is
  the project identity now). The workspace nav stays exactly as is.
- Known regression accepted: drag-to-reorder projects loses its UI (the
  REORDER IPC stays; a future surface may revive it).

## Goal / Acceptance

- No #project-rail; sidebar back at the window's left edge.
- The current-project switcher (#sidebar-current-project) is visible on all
  tabs, including Projects; clicking a menu row selects the project (same
  path as before), menu rows keep FRAME tags and gain agent-attention dots
  and a remove (×) affordance.
- Projects tab shows the workspace nav; "Add new Project" is pinned at the
  bottom of that panel.
- Auto-select-first on boot, Cmd+Shift+[/] switching, workspace-nav counts
  and badges pipeline all keep working; "Focus Project List" opens the
  switcher.
- projectListUI becomes a headless controller (no list DOM): data, selection,
  auto-select, badges store, workspace nav.
- No main-process / IPC changes; IPC watchdog stays quiet.
