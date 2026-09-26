# Outcome — STR-02 — Structure Lifecycle

## T01 — Add generation.revision and injectable extraction

Stamped `generation.revision` (SHA-256 of the `checkView` payload) in `serializeStructure`, so it always matches the written bytes, excludes itself and audit-only counts, and stays constant across no-op rebuilds; exported `revisionOf`. Added an optional `extract(record, { rootDir, fs, maxParseBytes })` to `buildFull` (default `extractFacts`) with annotation merging unchanged. The js-src-app golden gained only the revision line. Files touched: `scripts/structure-generation.js`, `test/structureGeneration.test.js`, `test/fixtures/js-src-app/STRUCTURE.json`.

_Captured: 2026-09-26 · 3 file change(s)_

---

## T02 — Add the structure-read freshness contract

Added `scripts/structure-read.js` (built-ins only, never writes or spawns) with `readDescriptor` (receipt plus artifact `lstat` signature, no parse) and `readStructure` (adds the map and a SHA-256 digest check), the STR-01 ownership rule, and freshness fresh/dirty/stale/unknown from `lifecycle.json`. The module header now defines the `lifecycle.json` receipt shape the T06 worker must write, including `leaseMs` (default 90 s = 60 s reconciliation + 30 s budget) and `coverage`/`extraction` as coverage strings. Files touched: `scripts/structure-read.js` (new), `test/structureRead.test.js` (new).

_Captured: 2026-09-26 · 2 file change(s)_

---
