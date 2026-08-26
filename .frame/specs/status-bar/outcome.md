# Outcome — status-bar

Shipped 2026-08-26. Live-verified in the running app, 330 tests pass, no
page errors.

## What shipped

- **`#status-bar`** spans the window at the foot: 26px, one line of 11px
  text on the panel background, a hairline top border, nothing else. Fixed
  positioning with a matching `body { padding-bottom }`, both reading the
  same `--status-bar-height` token so they cannot disagree.
- **The usage meters moved there**, right-aligned, and now belong to a new
  `statusBar.js` instead of `terminalTabBar` — the tab bar was rendering and
  updating a widget it did not own. Behaviour was moved, not rewritten:
  live `CLAUDE_USAGE_DATA` pushes, click-to-refresh, main's reason on error,
  warning/critical fills at 50% / 80%, weekly still revealing on hover.
  `terminalTabBar` lost 111 lines.
- **The theme toggle moved to the top bar's right end**, and is wired by
  `terminalTabBar`, which renders it and already owned the boot-time theme
  restore. The `index.js` binding is gone: a listener attached there to an
  element the tab bar renders later is the "Add new Project" bug in waiting.
- **The bar's left half is an empty named slot.** Nothing was invented to
  fill it.

## Verified live

| check | result |
| --- | --- |
| bar geometry | 26px tall, flush with the window bottom |
| overlap | sidebar and main content both end exactly at the bar's top (846px) — nothing slides under |
| usage | `Session 13% (4h 8m)` / `Weekly 2% (6d 6h)`, click-refresh works from the bar |
| theme | button is inside `.terminal-tab-bar`, flips dark → light and persists to localStorage |
| terminals | pane not clipped, xterm still fits after the shell lost 26px |

## Second half: the light-theme pass (same PR, at the user's request)

**First, a correction.** I reported that light theme kept dark backgrounds on
the project switcher and agent selector. That was wrong — the screenshot was
captured in the same tick as the theme flip, so `capturePage` returned a
half-repainted frame. Computed styles were correct all along.

The pass was redone by measurement: real WCAG contrast for every text node,
the element's colour composited over its actual ancestor backgrounds, across
Home / Specs / Specs grid / Tasks / Decisions / Claude, in both themes.

Two real defects, both fixed:

- **`.plugin-status.status-available`: 1.44:1** — `--text-muted` on
  `--bg-hover`. Now `--text-secondary`.
- **Tint-and-same-hue badges: 3.5–4.0:1 in light.** 58 rules pair a 12% tint
  background with text in the same colour (phase badges, priority chips,
  active filter chips, status pills). Fixed once at the token level by
  darkening the light palette's text hues ~12%: `--accent-primary`
  `#2f7d4f→#286b44`, `--success` `#4a7c50→#3e6843`, `--error`
  `#b84040→#a43939`, `--info` `#4070a8→#376090`. All 58 clear AA with no rule
  edited; dark theme is untouched.

`--warning` kept its value — it fills bars and dots, where the darkening text
needs (`#815015`) looks muddy. Warning text on a tint uses a new
`--warning-ink` (`var(--warning)` in dark).

The bar's own meters were part of this: label and reset time measured
2.4–3.1:1 and now clear AA in both themes.

## Left as a decision, not silently changed

The app-wide metadata palette (`--text-tertiary` / `--text-muted` at 9–11px:
nav counts, card slugs, dates, the version string) measures 2.2–3.2:1 in
**both** themes. That is the app's deliberate quiet look, not a light-theme
bug; raising it would change how the whole product reads. It needs a call.
