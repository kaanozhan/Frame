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
