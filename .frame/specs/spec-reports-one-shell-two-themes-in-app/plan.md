# Plan — Spec Reports — one shell, two themes, in-app

## Architecture

### Resolved plan-time decisions

**Business**

- **B1 · Palette identity** — *Fork:* keep the reports' amber-on-near-black
  document look and give it a light variant, or adopt the app's palette.
  **Chosen: the app's palette.** Both reports take their token *values* from
  `src/renderer/styles/variables.css` — warm charcoal + green accent in dark,
  the parchment set in light — so a report rendered inside Frame is the same
  colour as the window around it. The implementation report already uses the
  app's token *names* (`--bg-deep`, `--accent-primary`, `--space-*`), so this
  is a value swap there, not a rewrite.
- **B2 · Where a report opens** — *Fork:* its own Topbar chip, or a tab inside
  the spec section viewport. **Chosen: its own chip.** The user's words: today
  the report lands in the browser when a plan or an implementation finishes,
  and it should land in a Topbar chip instead. A `report` section type sits
  beside `spec` / `diff` / `task` and inherits their rules for free, and a spec
  and its report can be on screen as two chips.
- **B3 · Theme, in-app and standalone** — *Fork:* follow the reader's system
  when opened from disk, or stay dark unless told otherwise. **Chosen: both
  modes live everywhere.** In Frame the report follows the Topbar toggle, live.
  Opened from disk there is no app to ask and no JavaScript in the file (C7),
  so `prefers-color-scheme` is the only mechanism left — the report honours it,
  and an explicit `data-theme` on its root always wins.
- **B4 · The 23 reports already on disk** — *Fork:* leave them, or regenerate
  the 8 implementation reports from their surviving `report-data.json`.
  **Chosen: leave them.** Only new `/spec.plan` and `/spec.implement` runs
  produce the shared shell. The viewer therefore has to render pre-shell files
  without erroring (S7), which it does by detecting the shell marker and
  showing them untouched under a muted note.

**Technical**

- **T1 · How the viewer renders the file** — *Fork:* an iframe fed by `srcdoc`,
  or the report's markup mounted directly into the section element.
  **Chosen: iframe + `srcdoc`.** An `about:srcdoc` frame inherits the app's
  origin, so the viewer can set `data-theme` on the report's own
  `documentElement` and re-set it when the toggle flips — no reload, no script
  in the report. Mounting was rejected on evidence: the report stylesheets open
  with `*{box-sizing:border-box;margin:0;padding:0}` and a bare `body{}` rule
  (`build-implement-report.mjs:248-249`), which would restyle the whole app,
  and `.card` / `.pill` / `.topbar` collide with the app's own classes.
  The frame carries `sandbox="allow-same-origin"` and deliberately **not**
  `allow-scripts`, so C7 holds even if a future report ever grew a script.
- **T2 · Test posture** — *Fork:* generator only, everything testable, or none.
  **Chosen: generator only.** `test/implementReport.test.js` already drives the
  pure `report-data.json → HTML` transform, so the shell, the mark and both
  palettes are assertable there. The viewer is DOM-coupled renderer code and
  the project has no DOM harness (`jsdom`, `playwright`, `puppeteer`,
  `@testing-library` all absent from `package.json`), so it stays untested like
  every other renderer surface.
- **T3 · Where the shared shell lives (silent)** — *Fork:* a third staged asset
  both reports pull in, or the same block carried literally in each.
  **Chosen: carried literally in both, between markers, with a parity test.**
  Staging is a flat, per-file list (`commandStaging.js:36-39`,
  `specManager.js:558-561`); a third asset would have to be added to both
  lists, to `COMMAND_ASSETS`, to the docs table in
  `src/shared/frameTemplates.js:238-239`, and would still have to be inlined by
  hand at fill time to keep C1. Duplication guarded by a byte-equality test is
  the smaller, more honest mechanism.
- **T4 · The plan template keeps its own token names (silent)** — its 250 lines
  of component CSS are written against `--bg`, `--card`, `--ink`, `--primary`,
  `--line`, `--code`. Rather than rename every rule — a large diff across
  report *content*, which C8 puts out of scope — the shell adds a twelve-line
  alias block (`--card: var(--bg-secondary)` and so on). One place to read, no
  body rules touched.
- **T5 · Reading the file (silent)** — the existing `READ_FILE` channel is a
  fire-and-forget broadcast the editor overlay listens on
  (`fileEditor.js:54-59`, `editor.js:51`); reusing it would pop the editor open
  over the report. A new `READ_SPEC_REPORT` `invoke` handler goes into
  `specManager.setupIPC`, which already owns `PLAN_REPORT_FILE` /
  `IMPLEMENT_REPORT_FILE` and the spec-folder resolution — so no second place
  learns where a report lives (C6), and the renderer keeps its standing rule of
  never touching `fs` (zero `require('fs')` in `src/renderer/`).
- **T6 · Following a regenerating report (silent)** — `pushSpecData` skips a
  push whose payload is byte-identical to the last (`specManager.js:1352-1355`)
  and the payload carries no report mtime, so a rewritten report does not
  reliably announce itself. During an autonomous run `tasks.json` changes with
  every task, so `SPEC_DATA` does arrive; the viewer re-reads on it and swaps
  the frame only when `mtimeMs` moved, and a Refresh button in the viewer
  header covers the case where it does not.
- **T7 · In-flight footprint collision (silent)** — `src/main/specManager.js`
  sits in the footprint of `audit-q3-performance-resources`, which is still
  `implementing`. Its one open task, T10, is a measurement-and-record pass over
  the budgets, not a code edit, and the change here is one additive handler, so
  the collision is nominal. Recorded rather than routed around: moving the
  handler into a new main module would have meant editing `src/main/index.js`,
  which is in that same footprint.

### The shared shell

One block of CSS and one header markup shape, carried identically by both
assets between literal markers:

```
/* ── frame report shell v1 ── */   …tokens + .rpt-* rules…   /* ── end frame report shell v1 ── */
```

The marker is load-bearing three times over: the parity test finds the block,
the viewer detects a pre-shell report by its absence (B4), and a future shell
revision can bump the version in one grep.

*Tokens.* The block mirrors `variables.css`'s own structure — dark values on
bare `:root`, light values under `:root[data-theme="light"]` — and adds the
standalone case as `@media (prefers-color-scheme: light){:root:not([data-theme="dark"])}`
(B3). `color-scheme` becomes `light dark`. The light values are written twice,
once per selector; CSS has no way to share them and `light-dark()` is Chromium
123+, above the Electron 28 runtime. Only the tokens the reports actually use
are carried: the `--bg-*`, `--text-*`, `--accent-*`, semantic, `--border-*`,
`--shadow-*` and `--diff-*` sets, plus `--space-*`, `--radius-*` and the app's
`--font-sans` / `--font-mono`.

*Header.* `<header class="rpt-topbar">` — the mark, the wordmark, a rule, then
the document block (doc type + slug chip) on the left; the report's own
headline pills on the right. Under it `<section class="rpt-head">` carries the
`h1`. New classes are prefixed `rpt-` so they cannot collide with either
report's body CSS (C8); the header's pills are `.rpt-pill`, leaving each file's
existing `.pill` / `.tag` untouched.

*The mark.* The four corner-bracket paths from `assets/frame-mark.svg`, inlined
as SVG markup with `fill="currentColor"` so it takes the accent in both themes.
This deletes `FRAME_LOGO_DATA_URI` — nine kilobytes of base64 raster — from the
generator, and satisfies C1 without an asset reference.

### The viewer

`src/renderer/reportSection.js` follows `diffSection.js` exactly: a module with
`{ setHost, open, createViewport }`, and a viewport returning
`{ type: 'report', key, viewClass: 'section-view', navigate, getChip, render, dispose }`.
`open()` calls `host.openSection('report', ref, api, { newTab: false })`, so one
report viewport is reused and navigated in place — the same behaviour a diff
tab has. Chip rules, `×`, and the drop-from-strip semantics come from the host
untouched (C5).

Reference shape: `{ projectPath, slug, title, kind }` with `kind` one of
`'plan' | 'implement'`.

The render is a small header row — doc type, spec title, Refresh, and an
"Open in browser" escape hatch that keeps the old `shell.openPath` capability
without keeping it as the default — over
`<iframe class="rpt-frame" sandbox="allow-same-origin">`. On every load the
viewer stamps the frame's `documentElement` with the app's current
`data-theme`; a `MutationObserver` on `document.documentElement`'s `data-theme`
re-stamps it on toggle, the pattern `terminalManager.js:784-790` already uses
for the xterm theme (C4).

## Files

- `src/templates/commands/claude-code/build-implement-report.mjs` — **Modified**
  Shell block + app palette + inlined mark replace the dark-only `:root` and
  `FRAME_LOGO_DATA_URI`; `.topbar` markup becomes the shared `.rpt-*` header.
- `src/templates/commands/claude-code/plan-report-template.html` — **Modified**
  Gains the identical shell block, the header markup, and the alias mapping its
  legacy token names onto the shell's; head comment loses "Dark-only".
- `src/shared/ipcChannels.js` — **Modified** — `READ_SPEC_REPORT` channel.
- `src/main/specManager.js` — **Modified** — `READ_SPEC_REPORT` handler:
  `{ projectPath, slug, kind }` → `{ success, html, mtimeMs }`, resolved
  through the existing report-file constants.
- `src/renderer/reportSection.js` — **New** — the report section viewport.
- `src/renderer/styles/components/report-section.css` — **New** — header row
  and full-bleed frame for the report section.
- `src/renderer/styles/main.css` — **Modified** — one `@import` line.
- `src/renderer/multiTerminalUI.js` — **Modified** — `reportSection.setHost(this)`
  beside the other three.
- `src/renderer/terminalTabBar.js` — **Modified** — the `report` chip icon.
- `src/renderer/specPanel.js` — **Modified** — both report buttons route to the
  section instead of `shell.openPath`.
- `src/renderer/specSection.js` — **Modified** — same two buttons.
- `src/renderer/specsDashboard.js` — **Modified** — same two buttons.
- `test/implementReport.test.js` — **Modified** — header, mark, palette and
  shell-parity assertions.

## Footprint

- src/templates/commands/claude-code/build-implement-report.mjs
- src/templates/commands/claude-code/plan-report-template.html
- src/shared/ipcChannels.js
- src/main/specManager.js
- src/renderer/reportSection.js
- src/renderer/styles/components/report-section.css
- src/renderer/styles/main.css
- src/renderer/multiTerminalUI.js
- src/renderer/terminalTabBar.js
- src/renderer/specPanel.js
- src/renderer/specSection.js
- src/renderer/specsDashboard.js
- test/implementReport.test.js

## Dependencies

None. The mark is inlined from `assets/frame-mark.svg`, the chip icon is
`FileBarChart` from the `lucide` package already in `package.json`, and the
viewer uses nothing the renderer does not already require.

## Sequencing

1. **The shell, in the implementation report.** In
   `build-implement-report.mjs`: write the marked shell block (both palettes,
   `variables.css` values, `color-scheme: light dark`, the
   `prefers-color-scheme` case), replace `FRAME_LOGO_DATA_URI` with the inlined
   `frame-mark.svg` paths, and rebuild the `.topbar` markup as the shared
   `.rpt-topbar` + `.rpt-head`. Extend `test/implementReport.test.js` in the
   same step: the mark is present, no `data:image/png` survives, the doc type
   and slug chip render, and both palette blocks are emitted.
2. **The same shell, in the plan template.** Paste the marked block into
   `plan-report-template.html` byte-for-byte, add the `.rpt-topbar` /
   `.rpt-head` markup filled from `{{SPEC_TITLE}}`, `{{SLUG}}`, `{{DATE}}` and
   the existing headline `{{N}}` pills, add the legacy-name alias block, and
   correct the head comment. Add the parity test asserting the two files' shell
   blocks are identical — the guard that makes T3's duplication safe.
3. **Reading a report.** `READ_SPEC_REPORT` in `ipcChannels.js` and its handler
   in `specManager.setupIPC`, returning the file's text and `mtimeMs`, or a
   failure the viewer can render.
4. **The section.** `reportSection.js` with its viewport, the CSS component and
   its `@import`, `setHost` in `multiTerminalUI.js`, the chip icon in
   `terminalTabBar.js`, and the six button call sites in `specPanel.js`,
   `specSection.js` and `specsDashboard.js` switched from `shell.openPath` to
   `reportSection.open`. At the end of this step a report opens in a Topbar
   chip and `×` drops it.
5. **Theme.** Stamp `data-theme` onto the frame's document on load, add the
   `MutationObserver` that re-stamps on toggle, and the pre-shell detection
   that renders an old report untouched under a muted note.
6. **Following a live report.** The `SPEC_DATA` listener that re-reads and
   swaps the frame when `mtimeMs` moved, and the Refresh button beside it.
