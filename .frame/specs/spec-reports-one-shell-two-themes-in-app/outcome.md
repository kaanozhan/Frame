## T01 — The shared shell, in the implementation report

Added `REPORT_SHELL_CSS` to `build-implement-report.mjs`: Frame's tokens in
both themes between the `frame report shell v1` markers, dark on bare `:root`,
light under `[data-theme="light"]` and under `prefers-color-scheme`. Replaced
the 9KB `FRAME_LOGO_DATA_URI` raster with `FRAME_MARK_SVG` — frame-mark.svg's
four paths inlined without `xmlns`, so the existing no-external-assets test
still holds — and rebuilt `.topbar` as `.rpt-topbar` over `.rpt-head`. Beyond
plan.md: the body CSS's hardcoded amber `rgba(212,165,116,…)` literals and its
invented `--diff-fg` had no light values, so they became `--accent-*` /
`--diff-ins-fg` / `--diff-del-fg`; carrying variables.css's `--space-*` and
`--radius-*` also tightens the report's spacing to the app's scale.
Files: `build-implement-report.mjs`, `test/implementReport.test.js`.

_Captured: 2026-08-29 · 2 file changes_

---
## T02 — The same shell, in the plan template

Pasted the marked shell block byte-for-byte into `plan-report-template.html`,
aliased the twelve legacy names (`--bg`, `--card`, `--ink`, …) onto the shell's
tokens so no component rule changed, added the `.rpt-topbar` / `.rpt-head`
markup, and dropped the head comment's "Dark-only" claim. Beyond plan.md: page
padding moved from `body` to `.wrap` so the header is full-bleed like the
implementation report's, `--warn` aliases to `--warning-ink` because it colours
text as well as borders, and four hardcoded literals (two amber tints, a blue
tint, `#0f0f10` badge ink) became tokens. The parity test asserts both shell
copies are identical, that the emitted HTML carries those same bytes, and that
neither asset keeps a literal light cannot reach.
Files: `plan-report-template.html`, `test/implementReport.test.js`.

_Captured: 2026-08-29 · 2 file changes_

---
