# Outcome — cli-spec-command-parity

## T01 — Managed-block engine (docsManagedBlock.js) with tests

Created `src/shared/docsManagedBlock.js`, a pure engine (no fs/Electron): `findBlock` parses `<!-- frame:managed:spec-section v=N -->` markers, `upgradeDoc` replaces a stamped-older block in place with byte-identical surroundings, and legacy migration fires only when a heading-bounded section whitespace-normalizes to a shipped generation text. Beyond plan.md: any marker fragment without a well-formed block now suppresses legacy migration too — a dangling marker is treated as corruption, never migrated around. `test/docsManagedBlock.test.js` adds 11 tests (version gating, once-only migration, customized-body no-op, malformed markers, H3-containing spans, trailing-separator preservation).

_Captured: 2026-07-22 · 2 file change(s)_

---

## T02 — Current-generation docs content in frameTemplates.js

Added `SPEC_SECTION_VERSION = 1` and froze the previously shipped section texts as `LEGACY_SPEC_DRIVEN_SECTION` / `LEGACY_SPEC_DRIVEN_CORE_SECTION`, exported per-doc as `REFERENCE_SPEC_LEGACY_MATCHERS` / `AGENTS_SPEC_LEGACY_MATCHERS`. Rewrote `SPEC_DRIVEN_SECTION` as the full self-serve protocol (D2 spec resolution, override-first template resolution, placeholder table with runtime/commands paths per D9, follow-exactly rule, C4 autonomous ceiling with the dual handoff) and `SPEC_DRIVEN_CORE_SECTION` as the pointer plus the never-run-from-memory line. Emission is still unwrapped — marker wrapping lands in T03 with the round-trip tests.

_Captured: 2026-07-22 · 1 file change(s)_

---
