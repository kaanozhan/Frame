# Project rail — projects move to a far-left expanding rail

> **What we're building:** The prototype's leftmost column: projects leave
> the sidebar list and become a narrow vertical rail at the window's far
> left — initials avatars, active ring, agent-attention dot, "+" at the
> bottom. Hovering or keyboard-focusing the rail expands it as a flyout over
> the sidebar, revealing full names, badges, and remove. The sidebar's
> Projects tab becomes the workspace panel: selected project's header + the
> workspace nav.

## User's request (original, Turkish)

> şu projeleri de sola taşımayı da yapalım, belki oraya focus olunca o dikey
> bar genişleyebilir ve proje isimleri görünür olabilir, bu görünümü hiç
> beğenmiyorum sol taraftaki

## Goal / Acceptance

- New `#project-rail` column left of the sidebar, full height, ~56px wide:
  one initials avatar per project (FRAME projects get the accent ring),
  active project highlighted, bottom "+" opens the Open Project modal.
- Rail `:hover` / `:focus-within` expands a flyout (~240px) OVER the sidebar
  (no layout shift): rows show avatar + name + FRAME tag + agent badges +
  remove button — the same DOM the old list rendered, restyled.
- Collapsed rail still communicates agent attention (corner dot on avatar).
- All existing behaviors survive unchanged: click select, drag reorder
  (persisted), remove with confirm, auto-select-first on boot, active
  scroll-into-view, keyboard navigation, Cmd+Shift+[/] project switching,
  workspace-nav counts/highlights.
- Sidebar Projects tab now shows: selected project header (name + FRAME
  tag) + the workspace nav (re-homed from inside the list).
- No main-process / IPC changes.

## Constraints

- Do NOT rewrite projectListUI's logic — same module, same element ids and
  classes, new home + presentation. The rail is a re-skin of the list.
- Expansion must be an overlay (flyout), not a layout push — hover must not
  reflow the center.
