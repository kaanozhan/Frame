---
keywords: plan report, implementation report, report shell, frame mark, light mode, in-app viewer, report section, srcdoc iframe
related: deep-spec-plan, implement-modes-v2, terminals-home-agents, status-bar
---
Frame's two generated reports (`plan-report.html`, `implement-report.html`) were
two different documents, dark-only, and opened in the system browser. They now
share one shell and open in-app.

**The shell** is a marked CSS block — `/* ── frame report shell v1 ── */` —
carried byte-for-byte in `build-implement-report.mjs` and
`plan-report-template.html`, holding Frame's `variables.css` tokens in both
palettes plus the `.rpt-*` header. A third staged asset was rejected: staging is
a flat per-file list in two places and the block must be inlined anyway to keep
reports self-contained. Duplication is guarded by a parity test, and the marker
is load-bearing three times — parity test, pre-shell detection, version bump.
The plan template *aliases* its twelve legacy token names onto the shell rather
than renaming 250 lines of component CSS. The 9KB raster logo is gone, replaced
by `frame-mark.svg` inlined without `xmlns` (which would trip the
no-external-assets test).

**The viewer** is `src/renderer/reportSection.js`, on `diffSection.js`'s
contract, reading over a new `READ_SPEC_REPORT` handler in `specManager` that
returns `{ success, html, mtimeMs, path }`. Mounting the markup into the app was
rejected — the reports open with `*{…}` and a bare `body{}` rule. An iframe with
`sandbox="allow-same-origin"` and deliberately **no** `allow-scripts` is what
lets the theme be stamped onto the report's own `documentElement` while keeping
the file inert. The ~23 pre-shell reports render untouched under a muted note.

A report tab is keyed on `(projectPath, slug, kind)`, **not** reused per type
the way a diff tab is — that was the shipped behaviour for a day and it meant
every open overwrote the last.

Rules for future work: edit both copies of the shell or neither; never add
`allow-scripts` to `.rpt-frame`; a background re-read must pass `notify=false`
to `_load` or the mtime gate does nothing.

Chain: spec.md → plan.md → tasks.md → outcome.md
