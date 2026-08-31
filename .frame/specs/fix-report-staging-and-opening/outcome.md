## T01 — Point the report placeholders at `.frame/runtime/commands/<tool>/`

Replaced `specManager.js`'s module-level `REPORT_TEMPLATE_REL` / `REPORT_GENERATOR_REL`
strings with tool-scoped `reportTemplateRel(tool)` / `reportGeneratorRel(tool)` over a new
`commandRelPath(tool, file)`, and swapped `RUNTIME_ASSETS_REL` for `RUNTIME_COMMANDS_REL` in
`scripts/spec-command-hint.js` so both interpolation paths resolve under the staged commands
directory. Departed from `tasks.md` only in naming: the two became camelCase functions rather
than keeping SCREAMING_CASE names that no longer denote constants. Files: `src/main/specManager.js`,
`scripts/spec-command-hint.js`, `test/implementLaunch.test.js`.

_Captured: 2026-08-31 · 3 file changes_

---
## T02 — Delete the second stager; stage on every spec dispatch

Removed `stageCommandAsset`, `stageCommandAssets`, `COMMAND_ASSETS`, `RUNTIME_ASSETS_DIR` and
`assetRelPath` from `src/main/specManager.js`, and made `commandStaging.stageCommandFiles()` run on
every spec dispatch instead of only `spec.implement` — the deleted stager was what kept a project
override fresh between project opens, so the call had to become unconditional in the same change.
Added a `test/commandStaging.test.js` case asserting no staging-plan entry targets
`.frame/runtime/assets/`, pinning the single location against a future split.

_Captured: 2026-08-31 · 2 file changes_

---
## T03 — Retire the legacy location and the bridge that hid it

Repointed `REPORT_GENERATOR_REL` in `src/templates/bin/implement-launch.js` at the staged
`commands/claude-code/` copy, dropped the now-duplicate `GENERATOR_STAGED_REL` constant, and deleted
`ensureReportGenerator` with its call — the copy step existed only to bridge the two locations.
`stageCommandFiles` now calls a best-effort `removeLegacyAssetsDir()`, so the retired directory goes
wherever it exists rather than only here, because prompts staged earlier carry the interpolated old
path. `.frame/runtime/assets/` deleted from this project (untracked — `.frame/.gitignore` covers
`runtime/`). Files: `src/templates/bin/implement-launch.js`, `src/main/commandStaging.js`.

_Captured: 2026-08-31 · 2 file changes_

---
## T04 — Stop the browser open inside Frame

Added a pure `shouldOpenInBrowser(env)` above `main()` in
`src/templates/commands/claude-code/build-implement-report.mjs` — false when `FRAME_NODE` is set —
and gated the `--open` path on it, so the flag stays harmless in a prompt that always passes it.
`test/implementReport.test.js` pins both branches; the `--open` prose in `spec.implement.md` now
describes the browser as the no-Frame-window fallback rather than the destination.

_Captured: 2026-08-31 · 3 file changes_

---
## T05 — Carry a `reports` array in the `listSpecs` payload

Added `listSpecReports()` to `src/main/specManager.js` and spread its result into each `listSpecs`
entry only when the spec actually has a report, so `pushSpecData`'s serialized-payload comparison
stops swallowing the push that a report's appearance triggers. Checked against this project: 37
specs, 17 carrying the field. The array is deliberately stable across the implement run's per-task
regenerations — it says a report exists, not that it changed.

_Captured: 2026-08-31 · 1 file change_

---
## T06 — Allow a background section tab

Gave `openSection` an `activate` option (default `true`) in `src/renderer/multiTerminalUI.js`: when
false the viewport is created and navigated but `activeSectionKey` / `isSectionVisible` are left
alone, so the chip appears without the tab taking the screen. `reportSection.open` grew a
`{ background }` option over it, and a background call now leaves an already-open tab where it is
rather than activating it. Renderer code stays untested — no DOM harness exists in this project,
which the plan settled as the posture.

_Captured: 2026-08-31 · 2 file changes_

---
## T07 — Open the report when it appears

Added a module-level `SPEC_DATA` listener to `src/renderer/reportSection.js`: it keeps a slug→kinds
map, arms it silently on the first push (a reload must not read every existing report as new), and
opens a tab on each absent→present transition — foreground when `expectReport()` armed that slug and
kind, background chip otherwise. `src/renderer/agentDispatch.js` arms it after a *successful*
`spec.plan` / `spec.implement` dispatch, so a cancelled implement modal arms nothing. Verified by
hand against a stubbed host (baseline silent, unexpected → background, expected → foreground,
regeneration → nothing); the suite does not reach renderer code.

_Captured: 2026-08-31 · 2 file changes_

---
