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
