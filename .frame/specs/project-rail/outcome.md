# Outcome — project-rail

Shipped 2026-08-20. Live-verified + 222 tests pass.

## What shipped

- **#project-rail** — new far-left, full-height column (56px) holding the
  moved `#projects-list` + add button. Rows render an initials avatar
  (`initialsFor`: word initials, e.g. P2P_Payment_Case → PP); Frame projects
  get the accent ring; the active project gets a brighter ring; agent
  attention collapses to a corner dot on the avatar (red approval / amber
  input), full pills in the flyout.
- **Flyout expansion** — the rail body is an absolutely positioned overlay
  whose width animates 56→240px; expansion is class-driven
  (mouseenter/mouseleave/focusin/focusout → `.expanded`) rather than pure
  CSS :hover, so keyboard focus behaves identically and the state is
  scriptable. The sidebar never moves (verified: sidebar x stays 56 while
  expanded). Names, FRAME tags, badges and remove buttons appear expanded.
- **Workspace panel** — the sidebar's Projects tab now shows the selected
  project's header (#workspace-project-head: FRAME pill + name + path) and
  the workspace nav re-homed into #workspace-panel (was injected after the
  active list item).
- **Zero logic rewrite** — projectListUI kept every behavior on the same
  DOM: click select, drag reorder + persist, remove with confirm,
  auto-select-first, scroll-into-view, keyboard nav, Cmd+Shift+[/]
  switching (all re-verified live), agent badge pipeline, nav counts.

## Notes

- Playwright's synthetic mouse cannot drive CSS :hover in Electron — the
  class-driven expansion exists partly for that testability reason.
- Old "Projects" header/help CSS (sidebar-project-section spec) is now
  partially dead; that spec's "projects as sidebar root" presentation is
  superseded by this rail (decision recorded, not silent).
