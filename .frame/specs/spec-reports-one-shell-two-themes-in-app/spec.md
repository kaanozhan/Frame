---
keywords: plan report, implementation report, report shell, frame mark, light mode, in-app viewer, top bar section, report chip
related: deep-spec-plan, implement-modes-v2, terminals-home-agents, status-bar
---

# Spec Reports — one shell, two themes, in-app

## Problem

Frame produces two HTML reports per spec — `plan-report.html` from
`/spec.plan` and `implement-report.html` from `/spec.implement` — and they
are the richest artifacts the flow makes. Today they are also the ones the
product touches least:

- **Two different documents.** The implementation report has a topbar
  (logo, brand, doc-type, slug chip, pills); the plan report opens straight
  into a `.card` with an `h1`. Same project, same folder, two identities.
- **The wrong logo.** The implementation report inlines a 96px raster of
  `assets/logo.png`. Frame's mark is now the four corner brackets
  (`assets/frame-mark.svg`, commit `5bca7a4`) — the sidebar and the dock wear
  it; the reports still wear the thing it replaced.
- **Dark only.** Both files hardcode `color-scheme:dark` and a dark palette.
  Frame has shipped a full light theme since the status-bar work; a user in
  light mode clicks "View Plan Report" and gets a black page.
- **They leave the app.** Both buttons call `shell.openPath`, so the report
  lands in the system browser, detached from the project it describes and
  from the theme the user chose. `specPanel.js` says so in a comment: *"an
  in-app viewer is a follow-up spec."* This is that spec.

The cost of leaving it: the artifact that carries the reasoning — decisions,
diffs, coverage — is the one the user is least likely to look at.

## Goal

1. **One report shell.** A single header structure shared by both reports:
   the Frame mark (from `frame-mark.svg`, inlined), the brand, the document
   type, the spec slug, and the report's own headline pills. The plan report
   gains the header it lacks; the implementation report's header is rebuilt
   on the shared one. Below the header each report keeps its own body.
2. **Dark and light.** Both reports carry both palettes, mirroring the app's
   `variables.css` tokens, and pick one from the app when rendered in Frame
   and from the reader's system when opened standalone.
3. **An in-app viewer.** A report opens as a surface inside Frame, reachable
   from the Topbar, and inherits the app's current theme. The existing
   "View Plan Report" / "View Implementation Report" buttons route there
   instead of to the system browser.

Done means: with a spec that has both reports, a user in light mode opens
each one from the Topbar, sees the same header on both, in light, without
leaving the window.

## Constraints

- **Reports stay single self-contained HTML files** — inline CSS, no external
  assets, no build step (`deep-spec-plan`). They are opened from disk and
  attached to PRs, so the mark must be inlined, not linked.
- **The generator stays Node 18 + stdlib, pure above `main()`**, and its
  existing coverage in `test/implementReport.test.js` must keep passing
  (`deep-spec-plan`, `implement-modes-v2`).
- **The template and generator are staged into `.frame/runtime/assets/` on
  every dispatch** because the CLI cannot read `app.asar` (`deep-spec-plan`).
  A shared shell must survive that staging — whatever both reports import
  has to reach the CLI the same way.
- **The app's theme state is `data-theme` on `documentElement`, backed by
  `frame-theme` in `localStorage`, owned by the top bar** (`status-bar`).
  The viewer reads that state; it does not introduce a second theme source.
- **Top bar chips are for surfaces with live state, and `×` means "drop from
  the strip", never "destroy"** (`terminals-home-agents`). The implementation
  report *is* live — the autonomous mode regenerates it after every task.
- **The report paths already exist on the spec payload** —
  `getSpec` exposes `planReportPath` and `implementReportPath`; three
  surfaces (`specPanel.js`, `specSection.js`, `specsDashboard.js`) render
  the buttons. Reuse them; do not add a fourth path resolver.
- **Reports carry no JavaScript today** and must not start: every generated
  file on disk is pure markup and CSS. Rendering them must not require the
  window to relax `nodeIntegration`/`contextIsolation` further.
- Report **content** — sections, flow diagrams, decision cards, diffs,
  coverage tables — is unchanged. This is a shell, a palette and a host.

## Success Criteria

- When `/spec.plan` and `/spec.implement` generate their reports for the same
  spec, then both files open with the same header block: mark, brand,
  doc-type, slug chip, meta pills — and neither references `assets/logo.png`.
- When either report is opened standalone in a browser set to light, then it
  renders in the light palette; set to dark, the dark palette; and its
  colours match the corresponding tokens in `variables.css`.
- When a user in light mode clicks "View Plan Report" or "View
  Implementation Report" from any of the three spec surfaces, then the report
  renders inside the Frame window, in light, without a system-browser window
  opening.
- When a report is open in-app and the user toggles the theme in the top bar,
  then the rendered report follows the toggle without a reload of the file.
- When a report is open in-app, then it is reachable and dismissable from the
  Topbar under the existing chip rules — `×` drops the chip and leaves the
  file on disk untouched.
- When the autonomous implement mode regenerates `implement-report.html`
  while the report is open in-app, then the open view reflects the new file
  (on its own or via a visible refresh affordance).
- When a report generated before this spec (one of the ~23 already in
  `.frame/specs/`) is opened in-app, then it renders legibly rather than
  erroring or showing a dark page over a light app.
- When `npm test` runs, then the implementation-report generator suite passes
  with the new shell asserted.

## Out of Scope

- The `/spec.plan` decision gate and convergence loop (`deep-spec-plan`).
- The `/spec.implement` mode selection and launch flow (`implement-modes-v2`).
- Rendering `outcome.md`, `digest.md` or any other spec artifact in this
  viewer.
- Report export (PDF, print stylesheet, sharing).
- Reports for tasks, orchestration runs or projects.
- Any change to the app's own theme system or its toggle.

## Open Questions

1. **How the report is rendered in-app.**
   - Load the generated file as-is in a sandboxed frame — one source of
     truth, zero parsing, but the theme has to cross the frame boundary.
   - Read the file and mount its markup into the section, sharing the app's
     DOM and theme directly — at the cost of style collision and sanitizing.
2. **Where the report lives in the Topbar.**
   - A new section type with its own chip (`section:report`), consistent with
     task / spec / diff.
   - A tab inside the existing spec section viewport, so a spec and its
     reports stay one surface and the strip stays short.
3. **What a standalone report does about theme.**
   - Follow `prefers-color-scheme`, with the app overriding it via
     `data-theme` when it hosts the file.
   - Stay dark by default and switch only on an explicit `data-theme`, so
     reports attached to PRs keep one predictable look.
4. **The ~23 reports already on disk.**
   - Leave them; the viewer tolerates the old markup and only new runs get
     the shared shell.
   - Provide a one-shot regeneration path so the existing corpus converges on
     the new shell.
