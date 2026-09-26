# Outcome — STR-01 — Reliable Structure Generation

## T01 — Vendor the pinned `ignore` 7.0.5 matcher

Vendored upstream `ignore@7.0.5` `index.js` unmodified below a provenance header (npm tarball sha512 and sha1 verified against the registry; body sha256 recorded in the header) and shipped its MIT license beside it. No npm dependency, no install step, no Git. Files touched: `scripts/structure-ignore.js` (new), `scripts/structure-ignore.LICENSE` (new).

_Captured: 2026-09-26 · 2 file change(s)_

---

## T02 — Add root-wide discovery with one inspectable policy

Added `structure-discovery.js`: sorted `lstat` walk from the project root, no symlink/special-file following, dot directories walked, hard exclusions (`.git`, `.frame`, generated `.claude/rules/frame.md`, `config.files`-owned legacy meta files and their `.bak`/`.tmp`/`.corrupt-*` copies), replaceable default directory set, per-directory nested `.gitignore` layers outer→inner with `project.structure.exclude` last, validated limits (invalid config throws), BOM-before-NUL sampling, partial coverage with reasons, capped diagnostics, and a policy summary with ignore-file hashes. Also `evaluatePaths()` for delta candidates (ancestors only, never a walk; filesystem errors are never deletions). Decisions made while implementing: (1) the matcher's public `test()` re-decides parents inside one rule set, which breaks cross-layer negation, so single-path matching uses the pinned internal `_rules.test` (pinned by a test); (2) matching is case-sensitive on every platform for reproducibility; (3) Frame's own artifacts are skipped without being counted — counting the `.bak` a publish creates made the next run rewrite the map. A differential test checks decisions against `git ls-files --others --exclude-standard` (skipped without Git). Files touched: `scripts/structure-discovery.js` (new), `test/structureDiscovery.test.js` (new).

_Captured: 2026-09-26 · 2 file change(s)_

---

## T03 — Add full and delta entry builders with identity-safe keys

Added `structure-generation.js`: metadata-only entries for unsupported/oversized/unreadable/bad-encoding/failed files (`extraction.status` parsed | unsupported | partial), two-pass key allocation (existing keys reserved by file identity; legacy derivation if free, else `@file:` + percent-encoded path, numeric suffix on clash), prototype-safe assignment, `curatedKeyOwners` keeping deleted curated keys bound to their file, prose provenance hashes with conservative preservation of unfingerprinted prose, unknown entry/function fields carried over, `legacyModuleGroups` for CoMeety-style `path/purpose` directory records (file-path legacy entries become file entries with their authored fields), IPC channel merge, version 1.1 `generation` block without timestamps, `checkView` for `--check`. Delta starts from the existing map, removes only confirmed-missing/explicitly excluded entries, refuses a corrupt baseline, labels a no-baseline map unverified, and returns the prior object on a no-op. Decision made after a real-repo comparison: automatic intents keep the historical population (supported extensions under `project.sourceRoots`, falling back to `src`), because including tests/scripts changed hook hints and retrieval relevance is STR-03's; the inventory itself stays root-wide and curation may name any file. On Frame's own repo the rebuilt map kept all 161 old keys, `architectureNotes` and all 57 intents unchanged while growing to 425 entries. Files touched: `scripts/structure-generation.js` (new), `test/structureGeneration.test.js` (new).

_Captured: 2026-09-26 · 2 file change(s)_

---

## T04 — Add attempt state, writer lock, recovery and safe publication

Added `structure-state.js`: overlay-first ownership mirroring `frameStore.resolvePath`, shape validation with `.bak` fallback, `wx` writer lock taken before the baseline read (stale locks reclaimed only for a dead pid on the same host, moved aside and re-verified), `scan.json` attempt records written running → artifact → finished-with-digest, orphan classification by artifact digest (published-but-unacknowledged is kept, never rolled back), `reconcileAttempt` for the parent (superseded/busy never touch a newer attempt or a live child's lock), content-addressed recovery archives, and `snapshot()` for read-only checks. Publication rules follow D3; an unreadable live map is never replaced. Found while implementing: `fsSafe.writeFileAtomic` copies the current file to `.bak` unconditionally, so replacing a corrupt live map rebuilt from a valid `.bak` would overwrite that backup — both the corrupt live bytes and the used backup are archived before publishing. Files touched: `scripts/structure-state.js` (new), `test/structureState.test.js` (new).

_Captured: 2026-09-26 · 2 file change(s)_

---

## T05 — Recompose update-structure.js on the shared pipeline

Rewrote the CLI over discovery/generation/state: `--full` alias, one bounded `--json` envelope on stdout (human text to stderr), exits 0/1/2 for full and delta, `--check` 0/1/2 comparing `checkView` only, taking no lock and recording no activity, returning 2 for missing/corrupt/incomplete/writer-active/changed-during-check. `--changed` keeps the staged + unstaged Git sources; explicit files resolve against the project root; busy runs say "not refreshed"; unknown flags and mode combinations exit 2 without writes. The js-src-app golden was upgraded once to 1.1 (legacy keys and facts unchanged) with legacy ownership supplied in the test copy; repeat regens are byte-identical. Files touched: `scripts/update-structure.js`, `test/projectAgnostic.test.js`, `test/fixtures/js-src-app/STRUCTURE.json`.

_Captured: 2026-09-26 · 3 file change(s)_

---

## T06 — Align reader ownership and generation-status reporting

`find-module.js`, `check-freshness.js` and `module-hint.js` now resolve STRUCTURE.json with a tiny read-only mirror of the ownership rule (an unowned root file is never Frame's map). `find-module` and `check-freshness` report partial coverage, no-baseline maps and latest attempts that did not replace the map (`structure-generation` finding); a missing attempt record and an ordinary delta stay silent; nothing is repaired on load. The hook still imports no builder, runs no Git, and keeps its matching, limits and dedup. The old "root STRUCTURE.json updated in place" test now supplies the `config.files` record. Files touched: `scripts/find-module.js`, `scripts/check-freshness.js`, `scripts/module-hint.js`, `test/module-hint.test.js`, `test/scriptsProjectRoot.test.js`.

_Captured: 2026-09-26 · 5 file change(s)_

---

## T07 — Ship the parser's closure with helper-before-entry activation

`stageParserScripts()` preflights required assets, stages helpers, extractors and the app's own `fsSafe.js` through temp files and atomic rename, seeds `intent-map.json` once, and activates entry scripts last; `update-structure.js` is not activated when a required helper is missing or fails to copy (a previous generation keeps running beside the new helpers; a first install reports it unavailable). `copyParserScripts()` keeps returning the copied-name array; refresh never scans. New helpers added to `build.files`. Tests cover order, missing assets, mid-copy failure, a packaged tree built only from `build.files` running without `node_modules`, the unchanged hook snippet, full → hook delta → no-op, busy hooks, and linked worktrees leaving the main checkout's map and state alone. The fresh-vs-migrated artifact comparison in `frameProjectOpen.test.js` now excludes per-attempt runtime records and `.bak` files (A6). Found here and fixed separately on `fix/build-files-hook-scripts`: `module-hint.js`, `docs-hint.js` and `spec-command-hint.js` were missing from `build.files` in the shipped 2.8.2 app. Files touched: `src/main/structureBootstrap.js`, `package.json`, `test/structureBootstrap.test.js` (new), `test/scriptsProjectRoot.test.js`, `test/frameProjectOpen.test.js`.

_Captured: 2026-09-26 · 5 file change(s)_

---

## T08 — Consume the structured result in runInitialFullScan

Kept the async spawn; the child runs `--full --json` with an attempt token, both streams are drained with bounded capture, the envelope is validated against the exit code (exit 0 without a valid complete envelope is never `ok`), the promise settles once, the timeout is the validated `timeoutMs` plus a grace with SIGTERM → SIGKILL escalation, and after exit only the call's own attempt is reconciled; an unterminated child keeps its lock. `initialScan` adds `partial` beside `ok`/`error`/`skipped-existing`, plus structured fields (`empty`, `published`, `coverage`, `extraction`, `repairCommand`); a pre-existing map reports `verified: false`. Summary shape stays `{ copied, hook, initialScan }`. Files touched: `src/main/structureBootstrap.js`, `test/structureBootstrap.test.js`.

_Captured: 2026-09-26 · 2 file change(s)_

---

## T09 — Preserve configuration and guard re-init

Re-init merges the template underneath the existing config (identity, `createdAt`, settings, features, unknown keys, `project.structure`, custom project fields, the legacy `files` fingerprint all survive); only explicit options and detector-owned facts replace values; the config is written through `frameStore.writeConfig`. A legacy project with an unmerged meta file throws `E_LAYOUT_UNMERGED` before any write. A bootstrap exception returns an explicit failure summary. Tests cover real empty/imported init, re-init skip, the documented repair command preserving prose, no-Git and custom-hook projects, repo/local sharing never exposing runtime or recovery files, opens that refresh tools without touching the map, and the blocked re-init. Files touched: `src/main/frameProject.js`, `test/frameProjectInit.test.js`, `test/frameProjectOpen.test.js`.

_Captured: 2026-09-26 · 3 file change(s)_

---

## T10 — Mark the template pending and document generation

`getStructureTemplate` now emits version 1.1 with `generation: { schema: 1, state: "pending" }`, which the state layer treats as not a completed scan. The generated REFERENCE "STRUCTURE.json Rules" replaces the stale `path/purpose` format with the 1.1 format, the inventory policy, result meanings, limits and the rebuild command; QUICKSTART names the rebuild command. Paths are phrased so docsHealth only checks files every initialized project has. Existing user documents are only created when missing, never rewritten. Files touched: `src/shared/frameTemplates.js`, `test/projectAgnostic.test.js`, `test/frameProjectInit.test.js`.

_Captured: 2026-09-26 · 3 file change(s)_

---

## T11 — Route initial-scan outcomes to the notice tray

`healthNotice` listens to `FRAME_PROJECT_INITIALIZED` and pushes through the existing tray: failed scans as errors, partial coverage or unparsed files as warnings, empty projects and recovered maps as info — each naming the project and the repair command; complete scans, preserved maps and failed inits stay quiet. The wording is a pure `describeStructureScan()`. Files touched: `src/renderer/healthNotice.js`, `test/structureNotice.test.js` (new).

_Captured: 2026-09-26 · 2 file change(s)_

---

Verification: full suite 976/976, renderer bundle builds. Not done here: Frame's own `.frame/STRUCTURE.json` was not regenerated; the init order still writes `.claude/settings.json` after the initial scan.
