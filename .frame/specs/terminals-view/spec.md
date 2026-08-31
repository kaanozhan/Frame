# Terminals view — prototype-style project navigation, terminals in the center

> **What we're building:** Selecting a project shows a workspace nav under it
> in the sidebar (first item: **Terminals**), and the center area renders the
> prototype's terminals view — every terminal of the project live in an
> N-column pane grid with a layout switcher, drag-to-reorder, and per-pane
> maximize. User-facing naming returns from "Frame" to "Terminal".

## User's request (original, Turkish)

> şu an frame in ui-ux, daha çok ux tarafından nefret ediyorum. ben açıkçası
> sana verdiğim prototipteki kullanımı çok beğendim. dikkat edersen en soldan
> proje seçiyorsun, sonra seçtiğimiz projenin ilgili yerleri alttan açılıyor,
> specs vs. şimdi sağda mesela açık duran paneller var, collapsable olsa da,
> specs, tasks görünür halde oluyor ve çalışan agentları görüyoruz. mesela
> prototipteki gibi, projenin altında soldaki gibi listelense bunlar ve panel
> yerine aynı prototipteki gibi merkezde, ortada görsek bence güzel olabilir
> diye düşünüyorum. prototipteki isimlere takılma, frames bizim kastettiğimiz
> burada kullandığımız frame değil. bence frame isimlendirmesinden de
> vazgeçebiliriz. terminal-terminals olarak geri dönebiliriz. şimdi proje
> seçildiğinde altında neler görülmeli, orada biliyorsun memory ve teams var,
> şimdilik onlar olmasın. rails kısmını da unutalım. terminaller olacak,
> istersen terminallerden başlayalım. oradaki terminal görünümüne bayıldım.

Reference prototype: `~/Downloads/frame-ui-prototype.html` (terminals view:
per-agent panes, LAYOUT bar with 1/2/3 columns, drag header to reorder,
⤢ maximize / ❐ back to grid, pane header = status dot + name + tool).

## Problem

1. The home screen is a lane-card board (`laneBoard`) with SPECS/TASKS rails
   embedded next to it; terminals are behind an extra click ("enter a lane").
   The user finds this UX poor: what they want on project selection is the
   project's terminals, live, in the center — not cards about them.
2. Navigation is spread across a sidebar rail, a right instrument rail,
   slide-in panels and full-page dashboards. The prototype's model — leftmost
   project rail → workspace nav under the project → one center view — is the
   direction of record for the incremental redesign.
3. "Frame" is overloaded: product name, "Frame project" (init sense), and
   Frame = a terminal work-stream. The third sense confuses more than it
   brands.

## Goal

- Selecting a project makes its **Terminals** view the center view: all of the
  project's terminals rendered as live panes at once.
- Prototype interactions: column layout (1/2/3), drag pane header to reorder,
  maximize one pane / back to grid, "+ new terminal" ghost pane, pane header
  with live status dot (reuse `laneStatus` derivation), terminal name and tool.
- Sidebar (Projects tab): a workspace nav under the selected project with a
  single item for now — `Terminals` with a live count.
- User-facing strings say **Terminal/terminals** where they meant the
  work-stream sense of "Frame".

## Decisions overturned (explicitly, not silently)

From `lane-orchestrator` (done):
- **"User-facing UI says Frame" → overturned.** UI says Terminal. Code/DOM may
  keep `lane`/existing ids where renaming is churn without user value.
- **"Home board is the default view" → demoted.** The Terminals view is the
  default center view on project selection. The board code stays and remains
  reachable (Home button) in this step; its removal is a later decision.
- **Kept from that spec:** live derived status (`laneStatus`, PTY-output
  timing) — it now feeds the pane-header status dots; the 9-per-project
  terminal cap; per-project session save/restore.

## Constraints

- Incremental redesign rule: this step touches navigation + terminals view
  only. Do not build Specs/Tasks nav items, Memory, Team, or rails.
- Right-side slide-in panels, dashboards and the instrument rail stay as they
  are in this step (their fate is a later step).
- "Frame" as product name and "Frame project" (initialize sense) are NOT
  renamed.
- Don't regress: agent dispatch, orchestrator overlay, section views, and
  per-project session restore must keep working.

## Acceptance

- Open app → select project A: center shows A's terminals as live panes;
  sidebar shows `Terminals (n)` under project A.
- Layout bar switches 1/2/3 columns; choice persists per project across
  restarts (localStorage).
- Dragging a pane header reorders panes; order persists per project.
- ⤢ maximizes a pane (single visible, taller); ❐ returns to grid.
- "+ new terminal" pane creates a terminal in the current project (respects
  the 9 cap with the existing feedback pattern).
- Every pane header shows the live status dot (processing/waiting/idle) that
  updates without reload.
- No user-visible "Frame" string left in the work-stream sense.
