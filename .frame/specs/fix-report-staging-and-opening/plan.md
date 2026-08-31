# Plan — Report staging and opening — one staged copy, opened in Frame

## Architecture

### Resolved plan-time decisions

- **Which reports auto-open** (asked, business) — *both*. `/spec.plan`'s report
  and `/spec.implement`'s first empty report. One rule rather than two; the
  plan report is the half that opens nowhere today, which is where the request
  started.
- **Foreground or background** (asked, business) — *by origin*. A run the user
  dispatched from this window brings its report to the front, matching what
  clicking **View Report** does; any other run (conductor, worker, a CLI
  session) leaves a background chip. Four parallel workers must not throw four
  tabs over the user's work (C9).
- **How the app learns a report is ready** (asked, technical) — *the app
  notices; the agent says nothing*. `listSpecs`'s payload grows a report field
  so `pushSpecData`'s skip-unchanged gate actually opens, and the existing
  `.frame/specs/` watcher carries it (C8). Chosen over a dedicated
  `SPEC_REPORT_READY` channel because the thing being detected is a state
  change, not an event: a path that stays the same across the implement run's
  per-task regenerations produces no payload change and therefore cannot
  re-open a tab (S8), and an event dropped by the 250 ms `SELF_WRITE_GUARD_MS`
  window is recovered by the next push rather than lost. Rejected third option:
  the agent announcing over a `$FRAME_ORCH_BUS`-style command — that bus is
  wired only for orchestration sessions, and an instruction the agent can skip
  is how the current divergence arose.
- **Payload encoding** (silent, technical) — a `reports` array emitted *only
  when non-empty*, not two always-present booleans. Measured on this project
  (45 specs, 17 with a report): always-present booleans grow the SPEC_DATA
  payload 21.9% (10 749 → 13 107 B), `reports`-when-present grows it 4.1%
  (→ 11 192 B), and a spec with no report contributes nothing. The added
  `fs.existsSync` work is 161 µs per push against the ~862 µs `listSpecs`
  already spends, and the watcher is debounced at 250 ms.
- **What suppresses the browser open** (asked, technical) — *the generator
  reads `$FRAME_NODE`*. `ptyManager.js:225` injects it into every PTY Frame
  spawns, so its presence means the session runs in a Frame terminal and a
  window exists to open the tab in. One condition in one place, covering both
  the UI dispatch and the CLI hint path, with no new placeholder. The
  alternative — making `--open` conditional in the template — needs a new
  `{report_open_flag}` var filled correctly on both interpolation paths.
- **Staging consolidates onto `commands/<tool>/`, not `assets/`** (silent) —
  the direction is already settled by everything except the substitution:
  `frameTemplates.js:238-239` documents it, `resolveStagingPlan` already
  implements override-first resolution into it, and it is tool-scoped where
  `assets/` is not. This reverses the constraint recorded in
  `spec-reports-one-shell-two-themes-in-app` naming `.frame/runtime/assets/`;
  that constraint's reason (the CLI cannot read `app.asar`, so the asset must
  reach disk) is preserved — `commands/<tool>/` is equally outside the archive
  (C1, C2).
- **Freshness is preserved by making staging unconditional** (silent) —
  `specManager.js:768` calls `commandStaging.stageCommandFiles()` only for
  `spec.implement` today, while the per-dispatch freshness lives in the
  `stageCommandAsset` being deleted. Making that call fire on every spec
  dispatch is what keeps a project override picked up between project opens
  (C3).
- **The legacy directory is removed, not merely orphaned** (silent) — staged
  prompts under `.frame/runtime/prompts/` carry the *interpolated* old path, so
  a leftover `.frame/runtime/assets/plan-report-template.html` stays reachable
  by re-running an old prompt. A best-effort removal in `stageCommandFiles`
  closes the trap wherever it exists rather than only in this repo (S4).
- **In-flight collision accepted** (silent) — `src/main/specManager.js` sits in
  the footprint of `audit-q3-performance-resources` (phase `implementing`).
  Its T01–T09 are completed and only T10 remains, a measurement pass that
  re-runs T01's budgets rather than editing this file. Proceeding.
- **Test posture: pure logic only** (asked, technical) — assert what pure
  functions return; do not add filesystem-behaviour tests for staging. The
  three suites this touches (`commandStaging`, `implementLaunch`,
  `implementReport`) already test pure functions, so this is the convention in
  force, not a new one. `src/renderer/` stays untested: the testing record's
  **Not covered** line was re-verified this run — `jsdom`, `playwright`,
  `@testing-library/dom`, `puppeteer` and `happy-dom` are all still absent from
  `package.json`.

### Part 1 — one staged copy

`commandStaging.resolveStagingPlan` already produces the correct plan: the four
templates plus both report assets, override-first from
`.frame/templates/commands/<tool>/`, into `.frame/runtime/commands/<tool>/`.
Nothing about staging needs inventing; the work is removing the second
mechanism and repointing the three consumers at the surviving one.

The placeholder constants become tool-scoped. `REPORT_TEMPLATE_REL` /
`REPORT_GENERATOR_REL` are module-level strings today because `assets/` had no
tool segment; `commands/<tool>/` does, and `getCommandPrompt` already has
`tool` in scope, so they become functions of it.

### Part 2 — the report opens in Frame

Three signals meet in the renderer:

1. **Appearance.** `listSpecs` reports which of a spec's two report files
   exist; `pushSpecData`'s payload comparison turns that into a push. A
   module-level `SPEC_DATA` listener in `reportSection` diffs consecutive
   payloads and reacts to a report going absent → present. The first push after
   mount arms the baseline and opens nothing — otherwise a renderer reload
   would read every existing report as new.
2. **Origin.** `agentDispatch` is the single door for runs this window starts.
   When it dispatches `spec.plan` or `spec.implement` for a slug it arms an
   expectation on `reportSection`. A report that appears with an expectation
   armed opens in the foreground; one that appears without (conductor, worker,
   a hand-run CLI session) opens as a background chip. No new origin flag is
   needed — the absence of an expectation *is* the signal.
3. **Suppression.** The generator skips `openInBrowser` when `FRAME_NODE` is
   set, so the two paths never both fire. With no Frame window the variable is
   unset and today's behaviour is untouched (C7).

`openSection` always activates the tab it opens (`multiTerminalUI.js:274-275`),
so a background open needs an `activate` option there. Everything else in the
viewer is reused as-is: the tab stays keyed on `(projectPath, slug, kind)`, the
iframe keeps `sandbox="allow-same-origin"` with no `allow-scripts`, and the
existing per-viewport `SPEC_DATA` re-read continues to handle live regeneration
behind its `mtimeMs` gate (C6).

## Files

- `src/main/specManager.js` — **Modified**. Tool-scoped report placeholder
  paths; delete `stageCommandAsset` / `stageCommandAssets` / `COMMAND_ASSETS` /
  `RUNTIME_ASSETS_DIR` / `assetRelPath`; stage on every spec dispatch; carry
  `reports` in the `listSpecs` payload.
- `src/main/commandStaging.js` — **Modified**. Best-effort removal of a
  leftover `.frame/runtime/assets/` directory.
- `scripts/spec-command-hint.js` — **Modified**. `RUNTIME_ASSETS_REL` replaced
  by the tool-scoped commands path the file already computes for templates.
- `src/templates/bin/implement-launch.js` — **Modified**. `REPORT_GENERATOR_REL`
  points at the staged commands copy; `ensureReportGenerator` and its call
  deleted.
- `src/templates/commands/claude-code/build-implement-report.mjs` —
  **Modified**. Pure `shouldOpenInBrowser(env)` above `main()`, honoured by the
  `--open` path.
- `src/templates/commands/claude-code/spec.implement.md` — **Modified**. The
  `--open` prose says what it now does: the browser is the no-Frame-window
  fallback, and in Frame the report arrives as a tab.
- `src/renderer/reportSection.js` — **Modified**. Module-level `SPEC_DATA`
  listener, report-appearance diff with baseline arming, `expectReport()`, and
  background opening.
- `src/renderer/agentDispatch.js` — **Modified**. Arms the expectation when it
  dispatches `spec.plan` / `spec.implement`.
- `src/renderer/multiTerminalUI.js` — **Modified**. `openSection` accepts
  `{ activate }`.
- `test/commandStaging.test.js` — **Modified**. Staging plan assertions for the
  single location.
- `test/implementLaunch.test.js` — **Modified**. Interpolation fixture moves off
  `.frame/runtime/assets/`.
- `test/implementReport.test.js` — **Modified**. `shouldOpenInBrowser`
  assertions across present / absent `FRAME_NODE`.

## Footprint

- src/main/specManager.js
- src/main/commandStaging.js
- scripts/spec-command-hint.js
- src/templates/bin/implement-launch.js
- src/templates/commands/claude-code/build-implement-report.mjs
- src/templates/commands/claude-code/spec.implement.md
- src/renderer/reportSection.js
- src/renderer/agentDispatch.js
- src/renderer/multiTerminalUI.js
- test/commandStaging.test.js
- test/implementLaunch.test.js
- test/implementReport.test.js

## Dependencies

None.

## Sequencing

1. **Repoint the placeholders.** Make `REPORT_TEMPLATE_REL` /
   `REPORT_GENERATOR_REL` tool-scoped in `specManager.js` and replace
   `RUNTIME_ASSETS_REL` in `scripts/spec-command-hint.js`, so both
   interpolation paths resolve under `.frame/runtime/commands/<tool>/`. Update
   `test/implementLaunch.test.js`'s fixture. (S1, S2)
2. **Delete the second stager.** Remove `stageCommandAsset`,
   `stageCommandAssets`, `COMMAND_ASSETS`, `RUNTIME_ASSETS_DIR` and
   `assetRelPath`; call `commandStaging.stageCommandFiles()` on every spec
   dispatch rather than only `spec.implement`. Update
   `test/commandStaging.test.js`. (C3, C4, S3)
3. **Retire the bridge and the directory.** Point `implement-launch.js`'s
   `REPORT_GENERATOR_REL` at the staged commands copy and delete
   `ensureReportGenerator` with its call; add the best-effort removal of a
   leftover `.frame/runtime/assets/` to `stageCommandFiles`; delete the
   directory from this repo. (S4)
4. **Stop the browser open inside Frame.** Add pure `shouldOpenInBrowser(env)`
   to the generator and gate the `--open` path on it; assert both branches in
   `test/implementReport.test.js`; update the `--open` prose in
   `spec.implement.md`. (C5, C7, S7)
5. **Make the report visible to the push.** Carry `reports` in the `listSpecs`
   payload, emitted only when a spec has one, so the skip-unchanged gate fires
   on appearance. (C8)
6. **Allow a background tab.** Give `openSection` an `activate` option and a
   background path through `reportSection.open`. (C9)
7. **Open the report.** Add the module-level `SPEC_DATA` listener with baseline
   arming and appearance diffing, `expectReport()`, and the `agentDispatch`
   call that arms it — foreground when armed, background chip otherwise.
   (G2, S5, S6, S8)
