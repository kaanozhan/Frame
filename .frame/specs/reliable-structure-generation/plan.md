# Plan — STR-01 — Reliable Structure Generation

## Architecture

### Resolved plan-time decisions

- **D1 · Scope (business, carried from the user).** Deliver initial generation and an explicit full rebuild independently. STR-02 owns live updates, commit semantics, and reopen reconciliation; STR-03 owns retrieval; STR-04 owns Jev. No model or network call participates in generation.
- **D2 · Eligible files (business, silent).** Inventory project-owned source and supporting text, including root files, configuration, documentation, and unsupported languages. Parser support enriches an entry; it never decides whether the entry exists. Source-root detection becomes advisory. This deliberately replaces the narrower discovery rule in `audit-q3-generic-any-project`.
- **D3 · Incomplete results (business, silent; clarified by lifecycle review).** Retain an existing usable map when file enumeration is incomplete or publication fails. On a first scan without a usable map, a partial inventory may be published explicitly. An exhaustive inventory with a file-level extraction failure may publish with an explicit extraction warning and metadata-only entries; one failed extractor must not prevent every other file from updating. Persist the latest attempt separately so preserving the old map cannot disguise failure as success. Frame initialization can succeed while map generation is degraded.
- **D4 · Ignore implementation (technical, silent).** Ship a pinned local copy of the MIT-licensed `ignore` 7.0.5 matcher, with its license and provenance. Frame supplies traversal and nested rule precedence. This replaces the old handwritten subset without requiring Git, network access, or `node_modules` in a user project or CI. It explicitly refines the earlier built-ins-only implementation choice, preserving its standalone delivery requirement.
- **D5 · Identity and compatibility (technical, silent).** The normalized repository-relative `file` path, including extension, is file identity. Preserve existing module keys by that identity; allocate collision-safe keys for new entries. Keep the `modules` object and existing entry fields so current readers remain usable. Reject a wholesale key migration that would break curated intent references and existing graph links.
- **D6 · User-authored metadata (technical, silent).** Preserve architecture notes, unknown annotation fields, and curated intent ownership. Preserve existing prose conservatively when its provenance is unknown; record generated-prose hashes going forward so later scans can distinguish unchanged generated text from edits. Retain removed entries and malformed originals in recovery copies, not as phantom live modules.
- **D7 · Publication and reporting (technical, silent).** Reuse `fsSafe.writeFileAtomic` under an exclusive per-map writer lock, through a standalone helper shipped alongside the parser. Separate stable artifact content from runtime attempt timestamps. Keep `--check` read-only and preserve its 0/1/2 contract.
- **D8 · Existing work and collisions (technical, silent).** Preserve the async child process and init guard already delivered by `audit-q3-performance-resources` T02. Its active footprint and `audit-q3-cross-platform` overlap bootstrap/init/templates/package files; serialize implementation of those files against those specs and rebase onto their accepted changes. Do not mark either spec complete or redo their work. Use the notice tray established by `status-bar-notice-tray`.
- **D9 · Test posture (technical, asked and answered).** The user selected **everything testable**: discovery, data transforms, failure/recovery, real shipped-script execution, initialization, and notice routing. Use the existing Node runner and external-module stubs. No new DOM harness or dependency installation is required; visual layout is unchanged.
- **D10 · Golden compatibility (technical, silent).** New coverage metadata and newly discovered files necessarily change the old golden output once. Update that fixture explicitly, retaining legacy module keys and extracted facts; require byte-identical subsequent regenerations. This replaces only the old byte-for-byte-across-schema-versions promise in `audit-q3-generic-any-project`, not deterministic regeneration.
- **D11 · CoMeety legacy maps (technical, evidence from the user's project).** Accept the earlier `path/purpose/submodules` directory-map shape as recoverable authored context. Preserve those records under `legacyModuleGroups` and generate actual file entries separately. Do not treat directory groups as files or discard them via the existing missing-`file` fallback.
- **D12 · Full versus incremental construction (technical, review).** A full scan replaces the generated file set; `--changed` and explicit-file mode merge only selected entries into the existing set. Share entry construction and eligibility, not the full-scan replacement operation. A no-op changes neither map bytes nor its generation metadata. Keep Git diff selection and hook invocation/staging behavior unchanged.
- **D13 · Reader compatibility (technical, review).** Align only STRUCTURE path ownership and generation-status reporting in the existing readers. Preserve hook matching, payload limits, session deduplication, and its prohibition on importing builders or running Git. These are additive generation-contract adapters, not STR-03 retrieval improvements.
- **D14 · Script activation (technical, review).** Validate the complete bundled asset set, publish helper files atomically, then activate entry scripts last. A failed copy retains the prior entry points. Upgrading scripts on open must not trigger a map rebuild or invalidate the existing map by itself.
- **D15 · Curated key ownership (technical, review).** Reserve keys referenced by curation against their original file identity even after deletion. Store those unresolved bindings until the user changes the curation. A newly added same-stem file must never inherit an old file's curated concept automatically.
- **D16 · Process ownership and publication boundary (technical, review).** Parent cleanup, attempt completion, and lock release must match the originating attempt token. A late callback from run A cannot overwrite run B's state. After an artifact rename succeeds, a lost summary or timeout cannot justify rolling back that valid artifact.
- **D17 · Lifecycle boundary (business/technical, carried from the user review).** Keep initial scan, explicit rebuild, script refresh on open, migration ordering, and commit-hook invocation as separate existing entry points. Add no watcher, automatic re-init repair, hook replacement, or commit blocking. A6 records the behavior that must survive implementation.

### A1. One discovery policy, independent of architecture

Add `scripts/structure-discovery.js`. Walk from the project root using sorted directory entries and `lstat`; do not follow symlinks or special files. Do not skip a directory merely because its name starts with a dot. Never execute project code, load its dependencies, or read paths outside the selected root. Treat nested package manifests as ordinary files; neither the detector's 24-root cap nor its chosen language list limits coverage. Leave `scripts/detect-project.js` unchanged.

Read optional `project.structure` configuration from `.frame/config.json`:

```text
ignoredDirectories: optional replacement for the documented default directory set
exclude: optional root-relative gitignore-style rules, applied last
limits: { maxEntries, maxFiles, maxDepth, timeoutMs, maxParseBytes }
```

Defaults: the current dependency/output directory set, 100,000 visited entries, 50,000 eligible files, depth 128, a 30,000 ms scan budget, and 2 MiB of extractor input per file. Invalid configuration is an explicit error, not a silent fallback. Overrides can raise finite limits; Frame's parent timeout follows the validated budget with a short shutdown grace. These are safety bounds, not performance guarantees.

Hard exclusions are `.git`, `.frame`, the resolved legacy Frame metadata and their recovery files, and Frame's generated delivery artifacts. Other default directory exclusions are replaceable so a project whose own source is named `build/` can include it deliberately. Repository-local `.gitignore` files apply to tracked and untracked files alike for this inventory. Machine-global Git excludes and `.git/info/exclude` do not affect reproducible project coverage; document that this is a project scan policy, not `git status` membership.

Use one matcher per `.gitignore` directory, evaluating paths relative to that directory in outer-to-inner order; only an explicit match or negation changes the inherited decision. An excluded parent is not traversed or re-included by an unseen child rule. Apply the configured root rules last. Record rule source paths and hashes, effective defaults, and limits in the policy summary. The matcher handles pattern syntax; Frame still owns nesting and traversal. References: [matcher and version](https://github.com/kaelzhang/node-ignore/tree/7.0.5), [Git ignore semantics](https://git-scm.com/docs/gitignore).

Known source/config/document extensions and extensionless text are eligible. For unknown extensions, inspect a bounded byte sample; recognize Unicode BOMs before treating NUL bytes as binary. Unsupported text encodings receive a metadata-only entry. Empty regular files are eligible. Binary files, symlinks, and policy exclusions have explicit reason counts; unreadable paths and traversal limits make coverage partial. Count pruned directories as directories, never invent a count of unseen files underneath them. Cap stored diagnostic samples at 100 while retaining total counts and a truncation indicator.

### A2. Build entries and preserve identity

Add `scripts/structure-generation.js` as the testable builder used by `scripts/update-structure.js`. It receives discovery results, the prior map, curation, and the existing language extractors. Extraction success does not certify semantic correctness; regex extraction remains best effort.

Every eligible file yields an entry with `file`, `sizeBytes`, `extraction`, `description`, `exports`, `depends`, and `functions`. Unsupported languages keep empty semantic fields with `extraction.status: unsupported`. Read/parse failures and parsing limits retain basic metadata, attach a reason, and mark extraction partial. Inventory coverage and extraction coverage are separate: a completely enumerated Ruby project is a complete inventory with unsupported extraction, not an empty or failed project.

Allocate keys in two passes. First reserve validated existing keys against their exact normalized `file` identity, including entries being removed in this run. Retain durable `curatedKeyOwners` bindings for removed keys still referenced by the curated map, plus reserved legacy group keys; unresolved bindings produce a diagnostic and no intent hit. Release a removed-file binding only when its curation reference is removed or explicitly retargeted, not merely because another file has the same stem. For each remaining path in bytewise order, use the legacy key derivation if unused; otherwise use `@file:` plus the percent-encoded complete relative path. If that string is already reserved by a legacy key, add a deterministic numeric suffix until free. Build dictionaries without prototype-key hazards. Preserve case and Unicode spelling; only normalize actual platform separators. Do not blindly replace a literal backslash inside a POSIX filename. Reject absolute/out-of-root paths from old metadata. Duplicate old entries for one path are reconciled with an explicit diagnostic and a backup.

Build the new full-scan module set from discovered files, then merge surviving annotations by file identity. Do not retain excluded/deleted generated entries. Known parser facts are replaced; unknown fields and user prose survive. For prose fields such as module descriptions and function purposes, compare prior values with recorded generated hashes; without provenance, preserve nonempty prior prose. Preserve unmatched annotations in the recovery copy. Keep the project-level description, architecture, conventions, and architecture notes. Rebuild `intentIndex` from the existing curated map first; do not rewrite that agent-owned file. If a historical reference cannot be resolved uniquely, report it without silently binding it to another file.

Expose separate builder operations for `full` and `delta`. Delta starts with the existing module set, updates eligible selected paths, and removes only entries confirmed missing or selected paths now explicitly excluded. It must not treat files absent from the change list as deleted. Filesystem errors are not proof of deletion. Use the same policy evaluator on candidate paths and their ancestor ignore files without walking the entire repository. Preserve entries from unsupported languages and supporting-text files added by an earlier full scan. A corrupt baseline is not silently replaced by a delta-only map: retain it for recovery and require an explicit full rebuild. A missing map may receive an explicitly unverified partial-update map, preserving today's linked-worktree hook use case.

Keep existing semantic fields, including language-specific `ipc`, and config-driven `ipcChannels` synchronization. Preserve manually enriched IPC records according to the existing merge contract. Adding inventory-only documents must not change the population used by the existing automatic code-intent grouping; auto-group supported source files as before, while explicit curation may address any indexed file. Derive fallback-key name tokens from the file path, not from its escaped synthetic key. Changing retrieval relevance for the expanded inventory remains STR-03.

Recognize legacy entries with `path` and `purpose`: a verified file path can be normalized into a file entry while retaining its authored fields; a directory or nested group is preserved verbatim under the additive `legacyModuleGroups` object, keyed by its original module name. Preserve any pre-existing group data without overwrite, recording conflicts in recovery data. A group-to-file curation reference is not automatically expanded or redirected. Group records are not counted as indexed files. This migration is required for CoMeety, not a speculative alternate schema.

Keep `version: "1.1"` for the additive artifact contract. A stable `generation` block contains schema version, mode, inventory coverage, extraction coverage, effective policy, counts, and bounded diagnostics. No attempt ID, wall-clock duration, or scan timestamp belongs in that block. Sort generated records consistently and preserve `lastUpdated` when serialized semantic content is unchanged; skip the write entirely when bytes are identical. A delta that changes no entry, annotation, policy, or intent performs no metadata-only invalidation write. A real delta labels full-inventory verification unknown; `--check` compares the generated file/intent/annotation payload and effective policy, excluding audit-only mode/coverage/count/diagnostic fields, so mode alone cannot create perpetual drift. It returns 0 only after a complete in-memory verification; partial discovery returns 2.

### A3. Attempt state, recovery, and publication

Add `scripts/structure-state.js` for standalone path resolution, map validation, attempt state, locking, and publication. In Frame, callers obtain the map path through `frameStore.resolvePath`; shipped scripts mirror the same rule: overlay first, root only when `config.files` names the legacy file, otherwise overlay. A coincidentally named user root file must never become the output. This corrects the script's current broader fallback. Recovery filenames are excluded from discovery.

Store attempt state in `.frame/runtime/structure/scan.json`:

```text
attemptId, pid, startedAt, finishedAt, mode,
state: running | complete | partial | failed | interrupted,
coverage, extraction, counts, diagnostics,
published, artifactDigest, retainedPrevious, recoveryPaths
```

Acquire an exclusive `wx` writer lock before reading the baseline for a mutating operation. Keep the lock through publication and final attempt state; release it only when its token matches. A second writer returns busy without replacing the running attempt. Reclaim a lock only when its recorded owner is demonstrably gone; ambiguous ownership remains busy. This is publication safety, not STR-02's event scheduling. A busy commit-hook invocation preserves the map and remains non-blocking through the existing shell wrapper; it must report that the map was not refreshed. `--check` takes no writer lock and writes no files or activity events; if an active writer or an artifact-digest change is observed during the check, return 2 rather than compare mixed generations.

Validate the old map's shape, not merely its JSON syntax. Read a valid backup when necessary. Before replacing malformed content or discarding unrecoverable annotations, preserve the exact original bytes; if preservation fails, stop without overwriting. Use the existing `fsSafe.writeFileAtomic` via a repo/shipped resolver; copy that same source file to `.frame/bin/fsSafe.js`, avoiding a second implementation. Do not call its recovery helper blindly: its current failed-preservation path does not provide the stronger guarantee this spec needs.

The rolling `.bak` is not sufficient to preserve removed authored content across subsequent rebuilds. When migration, orphan removal, or corruption recovery would discard such data, additionally retain the original bytes at `.frame/runtime/structure/recovery/<content-sha256>.json` and include that path in the attempt result. These content-addressed recovery records are never overwritten by later successful scans; identical originals reuse a record. Their cleanup policy is outside this spec, and a repeat scan must not manufacture new archives solely from timestamps.

Publish only after building and validating a candidate. A complete inventory publishes atomically, including a completed empty inventory. File-level parse/read/size-limit failures keep metadata-only records, clear obsolete generated semantic facts, preserve authored annotations, and publish with explicit partial extraction status; they do not freeze an otherwise complete inventory. An incomplete inventory retains a pre-existing usable map byte-for-byte; if none exists, it can publish the explicitly partial candidate. A fatal generation or publication failure publishes no candidate. A template with no completed scan is not a usable completed empty map. Preserve annotated templates when merging first-run results. Distinguish these cases in exit/result reporting: supported extraction errors yield a degraded result even when the inventory was published; an intentionally unsupported language is represented as such without falsely claiming its semantics were parsed.

Artifact and attempt state are two writes, not a fictitious atomic transaction. Persist `running` first, publish the artifact, then finish the attempt with its content digest. If the process dies between writes, the attempt remains interrupted/unknown and must not claim success. On the next mutating invocation, classify an orphaned running attempt before starting another. A killed parent and child cannot update their state; the retained running record is evidence of an unfinished attempt until reconciled. A filesystem that rejects all writes can only be reported through the caller/stderr; never claim a persisted failure record in that case.

The parent generates/passes an attempt token. Timeout/error handling may update attempt state only after the child has exited and only if that token still owns the attempt under the writer guard. A newer attempt takes precedence. Read the artifact digest before reporting `retainedPrevious`: publication may already have succeeded before the child's response was lost. Preserve a valid newly published artifact in that case, mark the completion acknowledgement unconfirmed, and never restore an older backup automatically. A process that cannot terminate an unresponsive child must not release its live lock or allow a second publisher through it.

### A4. CLI and initial bootstrap

Keep the existing no-argument full rebuild; add an explicit `--full` alias and `--json` summary output. In JSON mode stdout contains one bounded result envelope, not the whole map; human diagnostics go to stderr. Full generation exits 0 on completed inventory without extraction errors, 1 on incomplete inventory or extraction errors (the `published` field distinguishes those cases), and 2 on failure/busy. `--check` retains 0 for verified in-sync, 1 for a completely verifiable but different payload, and 2 for missing/corrupt/unverifiable input; it uses the same builder without recovery writes. Mode-specific result tests pin this compatibility with current freshness consumers. Unknown flags and incompatible mode combinations fail without writes.

Retain `--changed` and explicit-file invocation. Route their entry construction, candidate eligibility, key allocation, and atomic writing through the shared helpers so they cannot recreate collisions or corrupt a version 1.1 map. Use A2's delta merge rather than its full replacement. Retain the current Git diff sources and current staging behavior; changing staged-versus-unstaged snapshot semantics, adding untracked discovery, and scheduling live refresh belong to STR-02. Do not introduce a full scan into a commit hook. Hook templates and existing Husky/lefthook/custom-hook installation policy are unchanged.

Update `runInitialFullScan` to invoke full JSON mode asynchronously, drain both output streams with bounded capture, and validate the result envelope as well as the exit code. Settle once on process error/close. On timeout or signal termination, reconcile the owning attempt as described in A3; retain the artifact actually published, without an automatic rollback. The parent must not report an exit-0 child as successful if its result is missing, invalid, or partial. Preserve the public summary shape (`copied`, `hook`, `initialScan`) and existing `initialScan.status` values `ok`, `error`, and `skipped-existing`; add a `partial` status and structured fields without silently renaming the old values.

`getStructureTemplate` marks generation as pending. Fresh initialization runs the full scan. Existing maps remain untouched by default on re-init, with an explicit `skipped-existing`/unverified result; the supported repair entry point is `node .frame/bin/update-structure.js --full`. No automatic reopen refresh is added. During re-init merge defaults underneath the existing configuration, retaining project identity, creation metadata, settings, feature flags, unknown keys, `project.structure`, and custom project fields such as `ipcChannelsFile`; only explicit user options and detector-owned facts may replace their respective values. Use the existing config storage writer. Preserve an owned legacy layout's fingerprint until the existing migration path resolves it, and honor the unmerged-layout guard before writing. A bootstrap exception returns an explicit failure summary instead of disappearing into a null summary.

Carry structured results through the existing `_structureBootstrap.initialScan` response. Extend `healthNotice.js` to consume `FRAME_PROJECT_INITIALIZED` and use the existing tray for partial/failed/recovered results, naming the project and repair command. A completed empty inventory is reported as empty, not failed. No new IPC channel, popup, or map-screen redesign is needed. Document the policy, result meanings, limits, and rebuild command in generated maintenance reference and QUICKSTART text; do not overwrite existing user-authored documents to refresh this guidance.

Make the STRUCTURE-specific root/overlay ownership rule identical in `find-module.js`, `check-freshness.js`, and `module-hint.js`. Keep tiny read-only mirrors in these readers, pinned by parity tests; do not import `structure-state` or any builder into the hook. Existing hook matching, thresholds, output limits, and session dedup remain unchanged. Explicit CLI lookup and the freshness checker may read latest attempt state to identify retained-old/partial/unverified results; missing runtime state after a clone means unknown, not a failed scan. Neither reader repairs a map on load. This closes generation-status compatibility without implementing STR-03 ranking/cache work.

### A5. Delivery and acceptance

Extend `copyParserScripts` to ship the three helpers, pinned matcher/license, and the existing `fsSafe.js` source. Preserve its returned array and the seed-once behavior of `intent-map.json`. Preflight required source assets before activation; copy helpers/extractors first through temporary files and atomic rename, then activate changed entry scripts last. Do not activate an entry point after a required helper fails to copy. Existing generations that use changed helper interfaces must remain supported during activation. Tests inject a missing asset and a mid-copy failure, proving the old entry remains runnable or a first install explicitly reports unavailable tooling. Add the helper assets to electron-builder's explicit `build.files` list. Tests must stage a minimal packaged source tree containing only declared shipped assets and then run its copied parser with no `node_modules`; this catches imports accidentally satisfied by Frame's development checkout.

Resolve executable assets from the installed parser location, but resolve configuration, map, scan state, lock, backups, and eligible paths from the target project root. A linked worktree borrowing the main checkout's parser must update only that worktree. Pin the existing curation lookup/seed behavior in this case; do not accidentally switch intent-map ownership while extracting the builder. Script refresh is still after successful layout resolution on project open, and does not start a full scan.

The standing testing record already covers the Node source, scripts, templates, and stubbed main-process integration; leave it unchanged. Test notice routing by stubbing Electron IPC and `noticeTray.push`, not by introducing a DOM harness. No claim of automated visual coverage is made.

Behavioral fixtures cover: truly empty init; root/mixed layouts; 26 workspace packages despite detector truncation; Ruby/unknown text; same-stem and root/src collisions; hostile key names; nested ignores, wildcards, negations and excluded parents; hidden source directories; binary/Unicode/large files; symlink cycles; traversal/read/parse failures; exhausted bounds; malformed and wrong-shape maps; valid and invalid backups; preservation failures; interruption before/after publication; unchanged repeat bytes; stale/excluded entry removal; curated references and handwritten prose; owned/unowned legacy root files; and execution after script copying/packaging. Use temporary generated fixtures for combinatorial cases and injected filesystem/extractor failures for portable error tests.

The user's CoMeety checkout was inspected read-only on 2026-09-19. Its root manifest declares `apps/*` and `packages/*` workspaces; there is no root `src/`, no `config.project`, and the installed parser matches Frame's current parser. Its map contains six directory-oriented records rather than file entries. A read-only `rg --files` enumeration found 767 JS/TS-family files under apps/packages, at most seven directory levels deep; this is an observed source-file count, not the final policy's eligibility total. The current 12-level limit does not explain these paths. Current code would fall back to the absent root `src/`; the original historical generation cannot be reconstructed from this snapshot alone.

Generate a small synthetic CoMeety-shaped fixture inside the tests: absent detection config, `apps/api/src/routes`, `apps/mobile/app/(app)/(home)/community/[id].tsx`, `apps/mobile/modules/content-editor/editor/block-types/survey`, `apps/admin`, and `packages/contracts/src`, plus a six-group `path/purpose/submodules` map. Assert file coverage, retained group annotations, and deterministic rebuilds. Add a separate depth-13 fixture to exercise genuine depth behavior independently. Do not copy application code, require the private checkout in CI, or write to CoMeety during this planning work.

### A6. Lifecycle compatibility acceptance

The second review verified the actual callers rather than assuming that the new full-scan builder is their only entry point. These are mandatory implementation acceptance cases, owned by the indicated tests:

| Existing entry point | Required behavior after STR-01 | Owning tests |
| --- | --- | --- |
| Fresh init | One asynchronous full scan; empty/pending/partial states distinguished; project usable if scan fails. | `frameProjectInit`, `structureBootstrap` |
| Re-init with a map | Preserve the map and user config; report skipped rather than silently rebuilding or resetting features. | `frameProjectInit` |
| Ordinary project open | Refresh tools only; map bytes remain unchanged; repeat opens do not churn files. | `frameProjectOpen`, `structureBootstrap` |
| Open/re-init with an unresolved layout merge | No staging, helper copies, config writes, scan state, or map writes before the existing guard is resolved. | `frameProjectOpen`, `frameProjectInit` |
| Existing pre-commit hook | Still uses `--changed`, remains non-blocking, and stages only the existing map target; no source files or runtime files added to the index. Full map → delta → no-op must preserve unaffected entries and no-op bytes. | `scriptsProjectRoot`, `structureGeneration` |
| No Git or custom hook tooling | Full/manual generation works without Git; existing hook files remain untouched and the same manual-install guidance is retained. | `frameProjectInit`, `structureBootstrap` |
| Repo/local Git sharing modes | Existing sharing policy stays authoritative; the parser does not stage anything itself, and the shell hook does not force-add ignored maps or runtime/recovery files. | `frameProjectInit`, `scriptsProjectRoot` |
| Linked worktree borrowing scripts | Assets come from the available installation; every mutable artifact and lock belongs to the target checkout. Main-checkout map/state stay unchanged. | `scriptsProjectRoot` |
| Explicit full rebuild after delta | Reconcile the whole eligible set, preserve curation/prose, and converge deterministically. A repeated read-only check never writes and does not report drift solely from full/delta mode. | `structureGeneration`, `structureState`, `projectAgnostic` |
| Existing CLI and hook readers | Same owned artifact path; v1.0/v1.1 supported fields still readable; supported curated hints retain shape and limits; hook stays silent on invalid input and never loads builder code. | `scriptsProjectRoot`, `module-hint` |

Additional failure sequences: extraction failure during an otherwise complete inventory still refreshes other files; delete a curated file then add a same-stem replacement without rebinding its intent; timeout run A after publication and start run B before A's close callback; copy tools while the prior generation is usable. All are planned in the existing new test files, not deferred as implementation-time scope expansion. Compatibility adapters above are STR-01 obligations; new refresh triggers and staged-snapshot correctness remain STR-02.

Adjust the existing fresh-versus-migrated artifact-set assertion to compare durable metadata and installed tooling, excluding per-attempt runtime state and recovery records. A project opened without a scan must not receive fabricated scan records merely to match a fresh-init fixture. Keep the byte-for-byte blocked-layout assertion over the entire project; this review does not weaken that guard.

## Files

- `scripts/structure-discovery.js` — **New** — project-root discovery, nested ignore policy, classification, bounds, and coverage diagnostics.
- `scripts/structure-generation.js` — **New** — entry building, collision-safe keys, annotation merge, intent derivation, and stable serialization.
- `scripts/structure-state.js` — **New** — storage resolution, validation, attempt records, exclusive writer lock, recovery, and atomic publication.
- `scripts/structure-ignore.js` — **New** — pinned upstream `ignore` 7.0.5 source with provenance header; no runtime package installation.
- `scripts/structure-ignore.LICENSE` — **New** — upstream license shipped with the matcher.
- `scripts/update-structure.js` — **Modified** — compose the shared pipeline, full/JSON/check modes, and minimum partial-update compatibility.
- `scripts/find-module.js` — **Modified** — STRUCTURE path ownership parity and generation-status warnings; lookup/ranking unchanged.
- `scripts/check-freshness.js` — **Modified** — STRUCTURE path ownership parity and honest generation-attempt findings; no automatic repair.
- `scripts/module-hint.js` — **Modified** — tiny STRUCTURE path-ownership mirror only; preserve the no-builder-import hook contract.
- `src/main/structureBootstrap.js` — **Modified** — ship all assets including `fsSafe.js`; consume structured child results and handle process failures.
- `src/main/frameProject.js` — **Modified** — preserve scan configuration and return explicit bootstrap failures through existing init payloads.
- `src/shared/frameTemplates.js` — **Modified** — pending template state and generated policy/rebuild/result documentation.
- `src/renderer/healthNotice.js` — **Modified** — route generation outcomes to the existing notice tray.
- `package.json` — **Modified** — include the new standalone assets in `build.files`; no package dependency or lockfile change.
- `test/structureDiscovery.test.js` — **New** — eligibility, nested ignore semantics, unknown files, bounds, and traversal errors.
- `test/structureGeneration.test.js` — **New** — identity collisions, extraction degradation, annotations, curation, and determinism.
- `test/structureState.test.js` — **New** — corruption, preservation failures, interrupted publication, writer exclusion, and read-only check behavior.
- `test/structureBootstrap.test.js` — **New** — result protocol, stream handling, timeout/error settlement, and isolated packaged asset closure.
- `test/structureNotice.test.js` — **New** — IPC-to-tray routing with stubbed dependencies, including complete-empty and degraded cases.
- `test/projectAgnostic.test.js` — **Modified** — broad fixture coverage, one-time golden upgrade, and deterministic follow-up regeneration.
- `test/frameProjectInit.test.js` — **Modified** — real fresh/empty/imported init, pending/error reporting, config retention, and unchanged user files.
- `test/frameProjectOpen.test.js` — **Modified** — no scan on ordinary open, no churn, and no staging/writes while layout is blocked.
- `test/module-hint.test.js` — **Modified** — v1.1/owned-path compatibility while preserving payload, matching, and quiet-failure behavior.
- `test/scriptsProjectRoot.test.js` — **Modified** — copied-script behavior and legacy ownership, including preserving an unrelated root map.
- `test/fixtures/js-src-app/STRUCTURE.json` — **Modified** — version 1.1 golden result; legacy ownership config is supplied in the temporary test copy.

## Footprint

- scripts/structure-discovery.js
- scripts/structure-generation.js
- scripts/structure-state.js
- scripts/structure-ignore.js
- scripts/structure-ignore.LICENSE
- scripts/update-structure.js
- scripts/find-module.js
- scripts/check-freshness.js
- scripts/module-hint.js
- src/main/structureBootstrap.js
- src/main/frameProject.js
- src/shared/frameTemplates.js
- src/renderer/healthNotice.js
- package.json
- test/structureDiscovery.test.js
- test/structureGeneration.test.js
- test/structureState.test.js
- test/structureBootstrap.test.js
- test/structureNotice.test.js
- test/projectAgnostic.test.js
- test/frameProjectInit.test.js
- test/frameProjectOpen.test.js
- test/module-hint.test.js
- test/scriptsProjectRoot.test.js
- test/fixtures/js-src-app/STRUCTURE.json

## Dependencies

- Vendored `ignore` **7.0.5**, MIT: a local matcher for documented `.gitignore` syntax, with source/license provenance pinned to the upstream release. It has no runtime package dependencies; Frame owns traversal and nested policy composition. No install runs in user projects or CI. [Pinned manifest](https://raw.githubusercontent.com/kaelzhang/node-ignore/7.0.5/package.json).
- No service, model, new npm dependency, or Git runtime requirement. Existing `fsSafe`, extractors, Node test runner, storage seam, and notice tray are reused.

## Sequencing

1. **Discovery contract and implementation.** Add the pinned matcher/license and `structure-discovery.js`, including validated policy/limits and bounded diagnostics. Author `test/structureDiscovery.test.js` with mixed/root/hidden files, a synthetic CoMeety-shaped tree without detection config, 26 packages, depth-13 paths, nested ignore precedence, unsupported/binary/Unicode files, symlinks, and injected traversal failures. Keep existing parser behavior until the new helper is composed.
2. **Entry builder and compatibility.** Add `structure-generation.js`, reusing existing extractors and moving the generation/curation responsibilities behind distinct full and delta operations. Author `test/structureGeneration.test.js` for collisions, reserved curated keys, user prose, CoMeety-style legacy groups, unsupported/failed extraction, obsolete entries, IPC preservation, and full → delta → no-op sequences. Verify inventory-only files do not pollute existing automatic code intents. Define the additive version 1.1 contract here.
3. **Safe publication and attempt records.** Add `structure-state.js` using the existing `fsSafe` implementation. Author `test/structureState.test.js` for ownership resolution, validation, backups, failed preservation, writer exclusion, orphaned attempts, artifact-digest consistency, late-parent callbacks, and interruption on both sides of the artifact rename. Include write-denied behavior, parse-warning publication, and read-only checks during an active writer.
4. **Wire the CLI, readers, and shipped assets together.** Modify `update-structure.js`, the three reader compatibility adapters, script copying in `structureBootstrap.js`, and `package.json` as one usable delivery slice. Implement full/JSON/check contracts, non-destructive delta merging, and helper-before-entry activation. Extend `projectAgnostic.test.js`, `scriptsProjectRoot.test.js`, and `module-hint.test.js`; update the golden fixture; add packaged closure and interrupted-copy cases to `structureBootstrap.test.js`. Pin existing hook snippets, non-blocking commits, reader contracts, and linked-worktree targeting. Keep search ranking/dedup unchanged.
5. **Connect initialization and maintenance documentation.** Update the bootstrap process wrapper, init config/result handling, and `frameTemplates.js`. Extend `structureBootstrap.test.js` for malformed summaries, stream pressure, timeout, and error/close races; extend `frameProjectInit.test.js` for real empty/imported initialization, re-init config preservation, explicit full repair, and failure summaries. Extend `frameProjectOpen.test.js` for unchanged maps on open, stable repeated staging, and the unmerged-layout no-write guard. Document the policy and repair command in generated project docs without replacing user prose.
6. **Surface scan outcomes.** Extend the existing `healthNotice` init listener and add `structureNotice.test.js`, proving degraded scans reach the tray with the correct project/repair text while completed empty scans are not errors. Preserve existing notice behavior and keep visual changes out of scope.
