# A status bar at the foot of the window

> **What we're building:** A thin bar across the bottom of the window for
> ambient state. The Claude usage meters move there from the top bar, the
> theme toggle moves to the top-right, and the bar's left half is left as a
> declared slot for what comes next.

## User's request (original, Turkish)

> acaba alt tarafa da mı bir bar eklesek, mesela session limit göstergesini
> sağ alta taşıyabiliriz, light mode tuşunu sağ en üste koyarız, ileride de
> bir şeyler eklenebilir ne dersin?

## Why this is the right split

The top bar currently carries both *actions* (agent selector, Start, layout,
update) and *ambient readouts* (Session / Weekly usage). Those are different
kinds of thing: one you click, the other you glance at. Every editor that has
grown this far — VS Code, JetBrains — ends up with the same division, and the
usage meters have already caused one crowding complaint here ("start butonu
çok dip dibe", sidebar-project-section era).

## Goal / Acceptance

- A `#status-bar` spans the full window width at the bottom, thin (26px) and
  quiet: it must not read as a second toolbar.
- The Session and Weekly usage meters render there, right-aligned, keeping
  every behaviour they have today — live `CLAUDE_USAGE_DATA` updates,
  click-to-refresh, the error state with main's reason, and the
  warning/critical fills at 50% / 80%.
- The theme toggle moves from the sidebar rail's foot to the **right end of
  the top bar**, and keeps working from its first click (no binding that
  outlives the element it points at).
- The bar's left half is an empty, named slot — nothing is invented to fill
  it now.
- The terminal grid loses exactly the bar's height and nothing else: no
  double scrollbar, no clipped last row, terminals still fit after a resize.
- No IPC changes: `LOAD_CLAUDE_USAGE` / `CLAUDE_USAGE_DATA` /
  `REFRESH_CLAUDE_USAGE` keep their contract and their only consumer.
