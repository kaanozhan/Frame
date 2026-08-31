# Center Specs & Tasks views — dashboards leave the overlay, lifecycle-first specs

> **What we're building:** The Specs and Tasks surfaces become center views
> instead of full-window overlays. Specs is lifecycle-first: the sidebar nav
> opens the linear spec detail (stepper + spec/plan/tasks/outcome) with its
> sibling list rail; the card-grid dashboard stays reachable as an in-center
> switch. Tasks opens the kanban dashboard as the center view.

## User's request (original, Turkish)

> specs/tasks dashboardlarını da merkez görünüme çevirelim o zaman, bir de
> şunu söylemem lazım, sağdaki panelden listelenmiş specs görünümünden bir
> spec e tıkladığımızda daha farklı görünüm çıkıyor, yaşam döngüsünü doğrusal
> bir şekilde görebiliyoruz falan. aslında merkez görünümde böyle göstermek
> daha iyi olabilir. belki büyütme gibi bir seçeneğe tıkladığımızda şimdi
> eklediğin görünüme gidilebilir. ya da yine merkezde kalarak switch
> edilebilir ne dersin?

Agreed design: stay in center (no overlay "maximize") — Specs nav opens the
existing lifecycle surface (specSection, already center-based with a spec
list rail); its rail's dashboard button switches to the card grid, now
rendered inline in the center. Tasks nav opens the kanban dashboard inline.

## Problem

- `specsDashboard` / `tasksDashboard` are `position: fixed; inset: 0`
  overlays (z-index 9000) covering the whole window including the sidebar —
  a separate modal world, against the redesign's "one center surface" model.
- The best spec presentation (linear lifecycle in specSection) is only
  reachable by clicking a spec in a side panel; the nav's Specs entry
  currently opens the overlay grid instead.

## Goal / Acceptance

- Sidebar **Specs** → center shows the lifecycle view of the most relevant
  active spec (same ordering as the rails: active phases first), with the
  section rail for switching specs. Project with no specs → inline grid
  (it owns the New Spec flow).
- Rail's dashboard button, ⌘-palette and instrument-rail Specs/Tasks all land
  on the **inline** center surfaces — no code path opens the overlay anymore.
- Sidebar **Tasks** → kanban dashboard inline in the center content area;
  sidebar, top bar and status surfaces stay visible and interactive.
- Escape / close in an inline dashboard returns to the terminals view.
- Sidebar nav items get active ('on') states for Specs/Tasks surfaces.
- No IPC/main-process changes; PTY and terminals view untouched.

## Constraints

- Reuse the existing dashboard modules — inline mounting, not a rewrite.
- Overlay CSS stays for one release as fallback; inline mode is a class.
