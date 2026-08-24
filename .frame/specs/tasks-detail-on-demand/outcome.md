# Outcome — tasks-detail-on-demand

Shipped 2026-08-24. Live-verified across nine board states + 311 tests
pass, no boot errors, watchdog quiet.

## What shipped

- **The aside is on demand.** `.tasks-dashboard-detail` defaults to
  `display: none`; an `.open` class puts it back in the layout. With no
  selection and no form, the columns run edge to edge — measured 646px →
  1094px of column width at the default window size (+69%).
- **One owner of the panel state**: `syncAside()` decides form / detail /
  collapsed and every path routes through it — `selectTask`,
  `clearSelection`, `showForm`, `hideForm`, the TASKS_DATA re-render and
  board exit. The three previous "hide this, show that" toggle sites are
  gone, so the aside can no longer disagree with itself.
- **Empty state removed** (markup, CSS, listener): the "Add a new task"
  card duplicated the header's New Task button and existed only to fill a
  panel that is now hidden.
- **`resetAside()` on leaving the board**: no half-typed form waiting on
  return (previously `clearSelection` deliberately kept an open form).

## Verified live

| step | aside | columns |
| --- | --- | --- |
| board opened | collapsed | 1094px |
| card clicked | detail | 646px |
| × on detail | collapsed | 1094px |
| New Task | form | 646px |
| Cancel | collapsed | 1094px |
| New Task over a selected card | form | 646px |
| form × | detail returns | 646px |
| Esc | collapsed | 1094px |
| leave + reopen board | collapsed | 1094px |

No pageerrors in any state.

## Not touched

The Specs dashboard has its own `specs-dashboard-detail-empty` aside with
the same always-on shape. Out of scope here — the user asked about Tasks.
