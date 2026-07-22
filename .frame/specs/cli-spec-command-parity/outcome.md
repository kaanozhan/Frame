# Outcome — cli-spec-command-parity

## T01 — Managed-block engine (docsManagedBlock.js) with tests

Created `src/shared/docsManagedBlock.js`, a pure engine (no fs/Electron): `findBlock` parses `<!-- frame:managed:spec-section v=N -->` markers, `upgradeDoc` replaces a stamped-older block in place with byte-identical surroundings, and legacy migration fires only when a heading-bounded section whitespace-normalizes to a shipped generation text. Beyond plan.md: any marker fragment without a well-formed block now suppresses legacy migration too — a dangling marker is treated as corruption, never migrated around. `test/docsManagedBlock.test.js` adds 11 tests (version gating, once-only migration, customized-body no-op, malformed markers, H3-containing spans, trailing-separator preservation).

_Captured: 2026-07-22 · 2 file change(s)_

---

## T02 — Current-generation docs content in frameTemplates.js

Added `SPEC_SECTION_VERSION = 1` and froze the previously shipped section texts as `LEGACY_SPEC_DRIVEN_SECTION` / `LEGACY_SPEC_DRIVEN_CORE_SECTION`, exported per-doc as `REFERENCE_SPEC_LEGACY_MATCHERS` / `AGENTS_SPEC_LEGACY_MATCHERS`. Rewrote `SPEC_DRIVEN_SECTION` as the full self-serve protocol (D2 spec resolution, override-first template resolution, placeholder table with runtime/commands paths per D9, follow-exactly rule, C4 autonomous ceiling with the dual handoff) and `SPEC_DRIVEN_CORE_SECTION` as the pointer plus the never-run-from-memory line. Emission is still unwrapped — marker wrapping lands in T03 with the round-trip tests.

_Captured: 2026-07-22 · 1 file change(s)_

---

## T03 — Marked emission wired into templates + round-trip tests

Added `renderSpecSection`/`renderSpecCoreSection` to `frameTemplates.js` and wired them into `getReferenceTemplate`, `getAgentsTemplate` and `enableSpecDriven`'s append path (`frameProject.js`), so new projects are born with marker-wrapped, version-stamped spec sections. Round-trip tests assert emitted docs parse at the current version and legacy constants still migrate. Divergence from T01: `findLegacySpan` now also bounds a section at a thematic break (`---` line) — the round-trip test showed a heading-only boundary overruns when a legacy section is followed by a separator and non-heading prose.

_Captured: 2026-07-22 · 4 file change(s)_

---

## T04 — Generalized command staging module (commandStaging.js) with tests

Created `src/main/commandStaging.js`: pure `resolveStagingPlan` (override-first sources for the four templates + two report assets into `.frame/runtime/commands/<tool>/`, helper into `.frame/bin/` with no override path), `stageCommandFiles` executor iterating packaged tool dirs, and `copyIfChanged` moved verbatim from specManager. `test/commandStaging.test.js` adds 5 pure-resolution tests via injected existsFn. The specManager/frameProject rewiring and retirement of `stageImplementCommandFiles` is T05, per the plan's sequencing.

_Captured: 2026-07-22 · 2 file change(s)_

---

## T05 — Rewire staging call sites; retire stageImplementCommandFiles

Deleted `stageImplementCommandFiles`/`copyIfChanged` (and their constants) from `specManager.js`; WATCH_SPECS and the implement branch of `buildSpecCommandFile` now call `commandStaging.stageCommandFiles`. `frameProject.js` stages at init (`runProjectInit`) and inside `ensureSpecDrivenArtifacts` — placed there rather than in `enableSpecDriven` so the already-enabled short-circuit also restages, covering re-enable on a project whose runtime dir was deleted. Prompt-file writing, `stageCommandAssets` and launch flags in the UI dispatch path are untouched (C3).

_Captured: 2026-07-22 · 2 file change(s)_

---

## T06 — upgradeSpecDocs driver wired into project open

Added `upgradeSpecDocs` to `frameProject.js` — runs the managed-block engine over `.frame/docs/REFERENCE.md` (full protocol) and `AGENTS.md` (core pointer) with the per-doc legacy matchers; writes only on change, never creates files, skips non-Frame projects — and called it from `specManager.js`'s WATCH_SPECS handler beside staging (specManager now requires frameProject; no cycle, frameProject never requires specManager). Smoke-tested outside the suite: legacy REFERENCE migrates once with user prose intact, customized AGENTS untouched, second run no-op.

_Captured: 2026-07-22 · 2 file change(s)_

---

## T07 — Entry-agnostic wording sweep of the four command templates

Swept all four claude-code command templates for Frame-launched-session assumptions. `spec.new.md`, `spec.plan.md` and `spec.tasks.md` had none — left byte-identical. `spec.implement.md`: reworded `$FRAME_NODE` as injected only by a Frame launch (falling back to `node` on PATH otherwise), and added the direct `implement-report.html` path beside the Frame-window button in the watch statement and the guided picker bullet. No stage, mode or output contract changed, so the UI-dispatched run reads identically in behavior (C5).

_Captured: 2026-07-22 · 1 file change(s)_

---
