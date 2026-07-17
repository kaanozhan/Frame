# Plan — Codebase understanding & agent-readiness on onboarding (code graph)

## Architecture

The spec's 2026-07-06 decision fixes the direction: the **code map is a
commodity, derived layer** — delegate it to a best-in-class OSS engine
(**tree-sitter**, lead candidate, syntax-level first), keep `STRUCTURE.json`'s
intent/why corpus as the moat. This plan builds a **separate, complementary
graph artifact** — it does **not** touch or replace `STRUCTURE.json`, and it
does **not** re-implement the regex extractors. Two hard constraints from the
spec drive every choice below: **permissive OSS + local-only** (never send the
user's code off-machine) and **any project, not just JS**.

### Resolved open questions

- **Enrich `STRUCTURE.json` or new artifact? → new artifact `.frame/graph/`.**
  `STRUCTURE.json` stays the intent index (untouched — its golden-file
  byte-compat guard from `audit-q3-generic-any-project` stays intact). The
  graph lives beside it: `.frame/graph/graph.json` (nodes + edges) and
  `.frame/graph/meta.json` (engine version, languages, counts, `builtAt`,
  status, caps hit). Complements, never duplicates.
- **tree-sitter binding → `web-tree-sitter` (WASM, MIT).** Native node
  bindings would need `electron-rebuild` per-platform and break under asar;
  WASM is a single portable artifact, cross-platform, zero user install,
  cleanly bundleable/redistributable under Apache-2.0. Grammars ship as
  prebuilt `.wasm` (`javascript`, `typescript` + `tsx`, `python`, `go`,
  `rust` — all MIT/Apache; note JS and TS are *separate* grammars) vendored
  under `resources/tree-sitter/` with a README recording exact grammar
  versions and the rebuild command (`tree-sitter build --wasm`), so the
  binaries are reproducible, not mystery blobs.
- **Where does the build run? → an Electron `utilityProcess`, never the git
  hook, never the main thread.** Two separate reasons:
  - `.frame/bin/` scripts must stay dependency-free (they run from a
    pre-commit hook without `node_modules`), so the builder can't live there.
  - Parsing thousands of files is seconds of CPU; doing it on the main
    process would freeze the app's menus/windows. `utilityProcess.fork`
    (Electron ≥22; repo is on 28) runs `src/main/graphWorker.js` as a Node
    child with asar-aware `require`, so it can load `web-tree-sitter` from
    the packaged app and post progress messages back. The **query helper**
    the agent calls is dependency-free (it only reads the JSON artifact) and
    ships into `.frame/bin/` like `find-module.js`. This seam satisfies all
    three constraints at once.
- **Semantic graph (cross-file call/reference edges) → deferred**, per the
  spec. v1 is **syntax-level**: files, symbols, and file→file import edges.
  stack-graphs/SCIP stay out until syntax-level proves insufficient to orient
  an agent.

### Data shape (`.frame/graph/graph.json`)

```json
{
  "version": "1.0",
  "nodes": {
    "files": [
      { "id": "src/main/index.js", "lang": "javascript", "symbols": [
        { "name": "createWindow", "kind": "function", "line": 42 },
        { "name": "AppMenu", "kind": "class", "line": 88 }
      ] }
    ]
  },
  "edges": {
    "imports": [ { "from": "src/main/index.js", "to": "src/main/menu.js" } ]
  }
}
```

- **File + symbol nodes** come from tree-sitter queries per grammar
  (functions, classes, methods, top-level consts — the symbol kinds the regex
  extractors approximate today, now precise and multi-language). Query
  patterns live as inline strings in `graphWorker.js`, one block per grammar
  — no separate `.scm` asset management.
- **Import edges** are file→file, resolved from raw import/require targets to
  repo-relative file ids; unresolved targets (external packages) keep their
  raw specifier in `to` rather than being dropped. **File ids are always
  POSIX-style forward-slash relative paths**, normalized on Windows.
- Reuses the existing discovery groundwork: `detect-project.js`'s
  `languages` + `sourceRoots` (from `.frame/config.json`) select what to
  walk; the walker mirrors `update-structure.js`'s ignore set (`.frame`
  included — the graph never scans itself) and `lstat`/no-symlink-follow
  rule, but has **its own caps** sized for the spec's 10k+-file budget
  instead of inheriting `MAX_SCAN_FILES = 5000`: `MAX_GRAPH_FILES = 20000`,
  skip single files > 1 MB, soft time budget ~60 s. Any cap trip is recorded
  in `meta.json` — never a silent partial graph.

### Honest-degradation matrix (all recorded in `meta.json`, surfaced in UI)

| Situation | Behavior |
| --- | --- |
| Detection found no languages (`confidence: "none"`) | `status: "no-languages"`; UI and `graph-query` say so, never guess |
| Detected language has no vendored grammar (e.g. Ruby) | Those files skipped; language listed in `meta.skippedLanguages` |
| File cap / size cap / time budget tripped | Graph written with what was parsed; `meta.capsHit` lists which |
| Worker crash / wasm load failure | `meta.status: "error"` + message; init and app never blocked |
| Rebuild requested while a build runs | Single-flight: return current build's status, don't start a second |
| Markdown / plain-docs files | Not graph material — skipped (STRUCTURE.json's markdown extractor already covers docs repos) |

### Query surface (`scripts/graph-query.js`, shipped to `.frame/bin/`)

Dependency-free CLI, sibling to `find-module.js`, reads `FRAME_PROJECT_ROOT`:

- `where <symbol>` — file(s) + line defining a symbol.
- `imports <file>` — who imports this file (reverse lookup).
- `deps <file>` — what this file imports.
- `affects <file>` — blast radius: transitive reverse-import closure
  (BFS with a visited set — import cycles must terminate, not hang).

Honesty affordances, mirroring `find-module.js`'s `stalenessBanner`:
- Artifact missing → "graph not built — open the project in Frame to
  analyze" (no stack trace).
- `meta.builtAt` older than the last commit touching the source roots →
  one-line staleness warning (silently skipped when not a git repo).

### Trigger + UI

- **Onboarding.** `frameProject.js` init already runs detection + structure
  bootstrap; after that it *starts* the graph build (async, non-fatal — a
  build failure never blocks init) and returns `{ status: "building" }` in
  its summary. The final result **cannot** be in the init return value (the
  build outlives the call) — completion flows through the push channel below.
- **Manual re-analyze + status.** New `graphManager.js` owns the
  `utilityProcess` lifecycle and exposes IPC: invoke channels
  `LOAD_CODE_GRAPH_STATUS` / `REBUILD_CODE_GRAPH`, plus a push channel
  `CODE_GRAPH_STATUS` (`webContents.send`, same pattern as
  `AI_TOOL_CHANGED`/`CLAUDE_USAGE_DATA`) relaying worker progress →
  building/built/error states. Registered in `index.js` via the existing
  `setupIPC(ipcMain)` / `init(window)` manager pattern.
- **Progress/state on first open.** `overviewManager` includes graph meta
  (counts, `builtAt`, caps, status) in its payload; `overviewPanel` renders a
  graph-status card with a "Re-analyze" button; `sampleBanner`'s post-init
  path shows build-in-progress / built / degraded state on first open.

### Packaging (pre-existing gap this spec depends on)

`build.files` in `package.json` currently ships only
`update-structure.js`, `find-module.js`, `check-freshness.js`,
`intent-map.json` — but `structureBootstrap.PARSER_FILES` already lists
`detect-project.js`, and the copy loop also needs `scripts/lang/**`. In a
packaged app those copies silently fail today. This spec touches the same
copy step (adding `graph-query.js`), so the packaging edit fixes all three
together: add `scripts/detect-project.js`, `scripts/lang/**`,
`scripts/graph-query.js` to `build.files`, and add a **new `extraResources`
block** (none exists yet) for `resources/tree-sitter/**` so the wasm lives
outside the asar. The wasm directory is resolved by `graphManager.js`
(`app.isPackaged ? process.resourcesPath : <repo>/resources`) and **passed to
the worker** via argv/env — `graphWorker.js` itself never requires
`electron`, which is what lets the test suite drive it as a plain Node child.

## Files

- `src/main/graphBuilder.js` — **New** — walk logic + graph assembly (pure Node, testable without Electron): source-root walk, caps, id normalization, JSON write.
- `src/main/graphWorker.js` — **New** — `utilityProcess` entry: loads `web-tree-sitter` + grammar wasm, per-language symbol/import queries, calls `graphBuilder`, posts progress.
- `src/main/graphManager.js` — **New** — worker lifecycle (single-flight), IPC invoke + `CODE_GRAPH_STATUS` push (`setupIPC`/`init` pattern).
- `scripts/graph-query.js` — **New** — dependency-free query CLI (`where`/`imports`/`deps`/`affects` + staleness warning), shipped into user `.frame/bin/`.
- `resources/tree-sitter/` — **New** — `tree-sitter.wasm` runtime + grammar `.wasm` (javascript, typescript, tsx, python, go, rust) + README with versions/rebuild command.
- `src/main/frameProject.js` — **Modified** — start graph build after structure bootstrap (async, non-fatal); `{ status: "building" }` in summary.
- `src/main/structureBootstrap.js` — **Modified** — add `graph-query.js` to `PARSER_FILES` (build stays Frame-side, not in the git hook).
- `src/main/overviewManager.js` — **Modified** — load `.frame/graph/meta.json` into the overview payload.
- `src/main/index.js` — **Modified** — require + register `graphManager`.
- `src/shared/ipcChannels.js` — **Modified** — add `LOAD_CODE_GRAPH_STATUS`, `REBUILD_CODE_GRAPH`, `CODE_GRAPH_STATUS`.
- `src/renderer/overviewPanel.js` — **Modified** — graph-status card + "Re-analyze" button, listens to `CODE_GRAPH_STATUS`.
- `src/renderer/sampleBanner.js` — **Modified** — first-open graph build progress/built/degraded state.
- `src/shared/frameTemplates.js` — **Modified** — QUICKSTART/AGENTS guidance: use `node .frame/bin/graph-query.js …` for where/imports/affects lookups.
- `package.json` — **Modified** — `web-tree-sitter` dep; `build.files` additions (incl. the pre-existing `detect-project.js` + `lang/**` gap); new `extraResources` for the wasm.
- `test/codeGraph.test.js` — **New** — build against `test/fixtures/*` (exist since `audit-q3-generic-any-project`), assert stack-appropriate symbols + import edges per fixture, all four query verbs, cycle-safe `affects`, and the missing-graph/no-languages honest misses.

## Footprint

- src/main/graphBuilder.js
- src/main/graphWorker.js
- src/main/graphManager.js
- scripts/graph-query.js
- resources/tree-sitter/**
- src/main/frameProject.js
- src/main/structureBootstrap.js
- src/main/overviewManager.js
- src/main/index.js
- src/shared/ipcChannels.js
- src/renderer/overviewPanel.js
- src/renderer/sampleBanner.js
- src/shared/frameTemplates.js
- package.json
- test/codeGraph.test.js

## Dependencies

- **`web-tree-sitter`** (MIT) — WASM tree-sitter runtime, loaded in the
  `utilityProcess` worker; no native compile, works with asar, satisfies the
  permissive-OSS + local + multi-language constraints. Note: grammar npm
  packages do **not** ship prebuilt `.wasm` — the binaries are built once
  with `tree-sitter build --wasm` and committed under `resources/tree-sitter/`
  (~1–2 MB total), with provenance in that folder's README. No grammar npm
  packages become runtime deps.

`graph-query.js` and the test use only Node built-ins / the existing
`node --test` runner — no new deps in the `.frame/bin/` (hook) path.
`test/codeGraph.test.js` drives `graphWorker.js` directly as a plain Node
child (it only needs Node + the repo's `node_modules`), so CI keeps its
no-`npm ci`/no-Electron constraint.

## Sequencing

1. **Vendor the engine** — add `web-tree-sitter`; build + commit grammar wasm
   under `resources/tree-sitter/` with the provenance README. Smoke-test
   loading each grammar from plain Node.
2. **Builder + worker** — `graphBuilder.js` (walk/caps/normalize/write) and
   `graphWorker.js` (grammar load, symbol/import queries, progress posts,
   degradation matrix → `meta.json`). Verify on Frame's own repo.
3. **Query CLI** — `scripts/graph-query.js` with the four verbs, missing-graph
   message, and git-aware staleness warning.
4. **Tests** — `test/codeGraph.test.js` against the existing fixtures: per-stack
   symbols/edges, query verbs, `affects` on an import cycle, no-languages and
   missing-grammar degradation; wire into `npm test`.
5. **Onboarding trigger + packaging** — `frameProject.js` starts the build
   (async, non-fatal); `PARSER_FILES` += `graph-query.js`; `package.json`
   `build.files` + `extraResources` edits (incl. the pre-existing
   `detect-project.js`/`lang/**` packaging gap).
6. **Manual re-analyze IPC** — `graphManager.js` (single-flight worker
   lifecycle, `LOAD_CODE_GRAPH_STATUS`, `REBUILD_CODE_GRAPH`,
   `CODE_GRAPH_STATUS` push); register in `index.js`; channels in
   `ipcChannels.js`.
7. **Overview + banner UI** — `overviewManager` surfaces graph meta;
   `overviewPanel` status card + "Re-analyze" wired to the push channel;
   `sampleBanner` first-open build state.
8. **Agent guidance** — `frameTemplates.js` adds `graph-query.js` usage to
   generated QUICKSTART/AGENTS so a warm-started agent reaches for the graph
   before cold grep. Verify end-to-end by onboarding a non-JS scratch repo in
   the packaged app (asar + extraResources path) and running `affects`.
