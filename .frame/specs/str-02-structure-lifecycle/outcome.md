# Outcome — STR-02 — Structure Lifecycle

## T01 — Add generation.revision and injectable extraction

Stamped `generation.revision` (SHA-256 of the `checkView` payload) in `serializeStructure`, so it always matches the written bytes, excludes itself and audit-only counts, and stays constant across no-op rebuilds; exported `revisionOf`. Added an optional `extract(record, { rootDir, fs, maxParseBytes })` to `buildFull` (default `extractFacts`) with annotation merging unchanged. The js-src-app golden gained only the revision line. Files touched: `scripts/structure-generation.js`, `test/structureGeneration.test.js`, `test/fixtures/js-src-app/STRUCTURE.json`.

_Captured: 2026-09-26 · 3 file change(s)_

---
