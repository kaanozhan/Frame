# Outcome — cli-spec-command-parity

## T01 — Managed-block engine (docsManagedBlock.js) with tests

Created `src/shared/docsManagedBlock.js`, a pure engine (no fs/Electron): `findBlock` parses `<!-- frame:managed:spec-section v=N -->` markers, `upgradeDoc` replaces a stamped-older block in place with byte-identical surroundings, and legacy migration fires only when a heading-bounded section whitespace-normalizes to a shipped generation text. Beyond plan.md: any marker fragment without a well-formed block now suppresses legacy migration too — a dangling marker is treated as corruption, never migrated around. `test/docsManagedBlock.test.js` adds 11 tests (version gating, once-only migration, customized-body no-op, malformed markers, H3-containing spans, trailing-separator preservation).

_Captured: 2026-07-22 · 2 file change(s)_

---
