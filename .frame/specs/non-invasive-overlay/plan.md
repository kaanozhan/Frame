# Plan — Non-Invasive Frame Overlay (.frame-only, zero-touch)

## Architecture

### Resolved plan-time decisions

- **In-flight collision (business, asked) — RESOLVED 2026-07-29.**
  `audit-q3-performance-resources` overlapped our footprint on
  `frameProject.js`, `tasksManager.js`, `specManager.js`,
  `structureBootstrap.js`; the decision was to plan now and hold the colliding
  files until it landed upstream. It has: commit `f18e334` is in
  `upstream/main`, and this branch was re-synced onto `v2.6.0` (`d985766`).
  Sequencing step 6 is unblocked. (`audit-q3-performance-resources/status.json`
  still reads `implementing` — stale; `outcome.md` exists and the code is
  merged.) `activity-monitor` landed in the same window and overlapped on
  `frameProject.js`, `structureBootstrap.js`, `tasksManager.js`,
  `src/main/index.js`, `ipcChannels.js`, `src/renderer/index.js`,
  `scripts/update-structure.js`, `scripts/check-freshness.js` — also settled.
- **Spec-driven toggle under the global layer (business, asked)** — Goal 3
  makes the AGENTS core a single global copy, so the current toggle mechanism
  (add/remove a `docsManagedBlock` section from the project's `AGENTS.md`) has
  no per-project file to edit. Decision: **the activation signal moves to the
  launch-time preamble.** Concretely:
  - Global `REFERENCE.md` carries the full protocol *unconditionally* — this
    already matches today's behavior (`getReferenceTemplate` emits
    `renderSpecSection()` with no flag check); it is a reference document, not
    an instruction to act.
  - Global `AGENTS.md` core carries **no** spec section at all
    (`SPEC_DRIVEN_CORE_SECTION` stops being emitted into the core).
  - `features.specDriven` in `.frame/config.json` stays the per-project truth
    and gains one new consumer: `contextPreamble` adds a positive
    "spec-driven is active here + pointer into REFERENCE" paragraph when on,
    and says **nothing** about specs when off. No negative instruction is ever
    emitted, so a project with the workflow off has no text anywhere telling
    the agent to write specs.
  - Consequence: `disableSpecDriven`'s AGENTS.md surgery and
    `stripManagedSpecSection` are deleted; the Settings toggle becomes a pure
    config-flag write. `upgradeSpecDocs`' per-project managed-block chase dies
    with the copies it was chasing.
- **Discovery UI (business, asked)** — no UI surfacing in this spec. The
  discovery engine exists solely to feed launch-time injection; a visibility
  panel can be a small follow-up. Spec Goal 4 amended accordingly.
- **Legacy-layout notice (business, silent)** — Goal 5's "tell the user" uses
  the existing `healthNotice.js` dismissible banner (same channel style as
  `TASKS_FILE_ERROR`), not a modal. Migration spec owns the actual flow.
- **Injection mechanism (technical, asked)** — per-tool declarative config in
  `aiToolManager.AI_TOOLS`: `injection: { type: 'flag' }` for Claude Code
  (system-prompt append flag; exact flag name verified at implementation,
  wrapper fallback if absent), `injection: { type: 'wrapper' }` for Codex and
  Gemini (generalization of the existing `.frame/bin/codex` pattern — preamble
  as initial prompt). Composition happens main-side; renderer gets the final
  string over IPC.
- **Test posture (technical, asked)** — *everything testable*: every new
  main/shared module ships with `test/*.test.js` per the recorded convention
  (target the pure module, stub Electron-coupled requires). Renderer pieces
  (banner, call-site switches) have no harness and carry no tests.
- **Storage module shape (technical, silent)** — one new `frameStore.js`
  whose surface is *data* (`readTasks(projectPath)`, `writeTasks(…)`), never
  paths; the `.frame/<file>` layout is its private detail. File-needing
  consumers (watchers, `.frame/bin/`, files handed to AI tools) use
  separately named `…Path(projectPath)` entries on the same module — per the
  spec constraint, so "must be a real file" call sites stay visible.
- **Global layer location (technical, silent)** — `app.getPath('userData')/
  frame-global/{AGENTS.md, REFERENCE.md}`, beside `user-settings.json` and
  `ai-tool-config.json` (existing precedent). Written at app start, upgraded
  via the `docsManagedBlock` pattern once instead of per project; user
  additions outside managed blocks survive.
- **Spec-hint hooks delivery (technical, silent)** — `registerSpecHintHooks`
  stops merging into the project's tracked `.claude/settings.json`. Frame
  generates `.frame/runtime/claude-settings.json` (inside its own footprint)
  and passes it at launch via Claude's settings flag (exact flag verified at
  implementation). Non-Claude tools already get the "run spec-context
  yourself" line from templates; the preamble keeps it.
- **Exclude mechanics (technical, silent)** — `gitExclude.ensure(projectPath)`
  on project open: resolve the real exclude file via
  `git rev-parse --git-path info/exclude` (worktree-safe), manage exactly one
  signed line (`.frame/ # managed by Frame …`). State machine: no repo → no-op;
  `.frame/` tracked (`git ls-files --cached -- .frame/` non-empty) → remove our
  line; untracked → add it. Idempotent, self-healing per open.
- **`.frame/AGENTS.md` at init (technical, silent)** — not created. The spec
  says the project layer may be absent; init seeds nothing, the file appears
  only when there is genuinely project-specific Frame context to record.
- **Scripts stay dual-layout until migration (technical, silent)** —
  `update-structure.js` / `find-module.js` / `check-freshness.js` resolve
  `STRUCTURE.json` (and notes) at `.frame/` first, then fall back to the root
  layout, because Frame's own repo remains embedded until the
  `embedded-migration` spec runs. The fallback is read/write compatibility,
  not a second operating model (spec constraint "single model" governs Frame's
  behavior toward *new* projects).

### Key components

- **`frameStore` (new)** — the single storage seam. All meta artifacts
  (tasks, notes, structure, quickstart, config) read/written through it;
  layout `.frame/<file>` private. Path entries only for the file-needing
  minority. A later Frame-owned store becomes a new backend here, touching no
  caller.
- **`globalLayer` (new)** — owns `userData/frame-global/`: renders Frame's
  generic instruction content (slim AGENTS core + REFERENCE) from
  `frameTemplates`, applies managed-block upgrades on app start.
- **`instructionDiscovery` (new)** — read-only scan on project open:
  native instruction files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`,
  `.claude/CLAUDE.md`, `.cursorrules`, `.cursor/rules/*`,
  `.github/copilot-instructions.md`) **and** legacy embedded-Frame layout
  (root `tasks.json`/`AGENTS.md`/`CLAUDE.md→AGENTS.md` symlink). Debounced
  `fs.watch` re-read (specManager pattern). Never writes.
- **`contextPreamble` (new, shared, pure)** — composes the short injected
  text from {global layer path, project layer path?, discovered native
  files, tool id, `specDriven` flag}: pointers only, no content copying, plus
  the one-sentence domain-precedence rule (repo owns code conventions, Frame
  owns meta-workflow). When `specDriven` is on it appends the activation
  paragraph (ladder + REFERENCE pointer); when off it emits nothing about
  specs — never a "do not use specs" instruction.
- **`gitExclude` (new)** — conditional exclude state machine (above).
- **`aiToolManager` (modified)** — per-tool `injection` config;
  `getLaunchCommand(projectPath)` IPC: start command + `launchFlags` +
  injection flags via existing `composeLaunchCommand`/`quoteArg`. Wrapper
  tools get `.frame/bin/<tool>` regenerated from a generalized template.
- **`frameProject` (modified)** — init writes only inside `.frame/`;
  CLAUDE/GEMINI consume-and-symlink logic deleted; `.claude/settings.json`
  merge deleted; open-path calls `gitExclude.ensure`, `instructionDiscovery`,
  legacy notice. Also the spec-driven toggle trio arriving from upstream
  v2.6.0 — `enableSpecDriven` / `disableSpecDriven` / `ensureSpecDrivenArtifacts`
  / `upgradeSpecDocs` all currently read or write the **root** `AGENTS.md`
  (`frameProject.js` lines 269/292/314/325/332/536/614/663, via
  `FRAME_FILES.AGENTS`), which the no-write rule forbids. Per the toggle
  decision above these collapse to a config-flag write:
  `stripManagedSpecSection` and the AGENTS.md branches of
  `ensureSpecDrivenArtifacts` / `upgradeSpecDocs` are deleted, not relocated.

### Data shapes

- Discovery result: `{ nativeFiles: [{ path, kind }], legacyLayout: boolean }`
  (in-memory; consumed by preamble composition and the legacy banner — not
  persisted).
- Injection config: `AI_TOOLS.<id>.injection = { type: 'flag'|'wrapper' }`
  (+ flag name resolved at implementation).
- Preamble input: `{ globalPath, projectLayerPath?, nativeFiles, toolId,
  specDriven: boolean }` — `specDriven` read from `.frame/config.json`
  (`features.specDriven`) at launch, not cached across launches.
- Signed exclude line: `.frame/  # managed by Frame — removed automatically when .frame/ is committed`.

## Files

**New**
- `src/main/frameStore.js` — storage module: data API + named path entries; `.frame/` layout private.
- `src/main/gitExclude.js` — conditional `.git/info/exclude` management (worktree-safe).
- `src/main/instructionDiscovery.js` — read-only native-instruction + legacy-layout scan with debounced watch.
- `src/main/globalLayer.js` — userData/frame-global AGENTS+REFERENCE ensure/upgrade via docsManagedBlock.
- `src/shared/contextPreamble.js` — pure preamble composition (3 layers, precedence sentence).
- `test/frameStore.test.js` — data API, path entries, `.frame/` layout privacy, legacy non-reads.
- `test/gitExclude.test.js` — state machine on temp git repos (untracked→add, tracked→remove, no-repo, worktree, user lines preserved).
- `test/instructionDiscovery.test.js` — fixture trees: native sets, legacy layout, read-only guarantee (mtime/checksum unchanged).
- `test/globalLayer.test.js` — first render, managed-block upgrade, user-addition survival (userData stubbed to temp dir).
- `test/contextPreamble.test.js` — composition per tool/layer combinations; no file content embedded; precedence sentence present.
- `test/frameTemplates.test.js` — generalized wrapper template per tool; templates reference `.frame/` paths, no root-file references left.

**Modified**
- `src/main/frameProject.js` — `.frame/`-only init; delete consume/symlink + settings-merge; wire open-path calls; collapse the spec-driven toggle to a config-flag write (delete `stripManagedSpecSection`, the AGENTS.md branches of `ensureSpecDrivenArtifacts`, and `upgradeSpecDocs`' AGENTS.md doc entry).
- `src/main/structureBootstrap.js` — husky: stop appending to tracked `.husky/pre-commit`, return the manual-snippet result (existing `skipped-custom` path); hook template output → `.frame/STRUCTURE.json`. Note `PARSER_FILES` (line 40) grew upstream to include `redact.js` and `activity-log.js` — the `.frame/bin/` copy list is the source of truth for what the pre-commit scripts can require.
- `src/main/tasksManager.js` — reads/writes and watcher path through `frameStore`.
- `src/main/overviewManager.js` — `loadStructure`/`loadTasks`/`loadDecisions` through `frameStore`.
- `src/main/aiToolManager.js` — `injection` config, launch-command IPC, spec-hint settings flag, wrapper regeneration.
- `src/main/index.js` — app-ready `globalLayer.ensure()`; project-open wiring.
- `src/main/commandStaging.js` — `{frame_global_path}` placeholder substitution in staged templates.
- `src/shared/frameConstants.js` — `.frame/`-relative meta path map; `ORCH_META_FILES` updated to `.frame/` paths; legacy root names kept exported for detection only.
- `src/shared/frameTemplates.js` — wrapper template generalized per tool; AGENTS-core/REFERENCE content parameterized for the global layer; root-file/symlink references removed.
- `src/shared/ipcChannels.js` — launch-command channel + legacy-layout notice message.
- `src/renderer/aiToolSelector.js` — composed launch command via IPC (async), replacing bare `getStartCommand` at call sites.
- `src/renderer/index.js` — await composed launch command (`index.js:742` call site).
- `src/renderer/agentDispatch.js` — same switch (`agentDispatch.js:277` call site).
- `src/renderer/healthNotice.js` — legacy-layout banner message type.
- `src/renderer/settingsModal.js` — Workflow toggle now writes only the config flag (no AGENTS.md side effect to await/report).
- `scripts/update-structure.js` — output path resolves `.frame/STRUCTURE.json` first, root fallback. Upstream added an activity record keyed by `activityLog.projectKey(ROOT_DIR)`; `ROOT_DIR` must keep resolving to the *project root*, not the `.frame/` dir, so the record stays bucketed per project.
- `scripts/find-module.js` — same resolution for reads.
- `scripts/check-freshness.js` — same resolution for reads; same `ROOT_DIR`/`projectKey` caveat as above.
- `test/tasksManager.test.js` — path expectations move to `.frame/tasks.json`.
- `test/commandStaging.test.js` — `{frame_global_path}` substitution coverage.
- `test/docsManagedBlock.test.js` — global-layer (single-copy) upgrade case.
- `test/specDrivenToggle.test.js` — arrived upstream in v2.6.0; asserts the toggle writes/strips the section in the **root** `AGENTS.md` (lines 30/35). Rewritten to assert the config-flag-only contract plus preamble composition, per the toggle decision.

**Deleted**
- None (behavioral removals happen inside modified files).

## Footprint

- src/main/frameStore.js
- src/main/gitExclude.js
- src/main/instructionDiscovery.js
- src/main/globalLayer.js
- src/shared/contextPreamble.js
- src/main/frameProject.js
- src/main/structureBootstrap.js
- src/main/tasksManager.js
- src/main/overviewManager.js
- src/main/aiToolManager.js
- src/main/index.js
- src/main/commandStaging.js
- src/shared/frameConstants.js
- src/shared/frameTemplates.js
- src/shared/ipcChannels.js
- src/renderer/aiToolSelector.js
- src/renderer/index.js
- src/renderer/agentDispatch.js
- src/renderer/healthNotice.js
- src/renderer/settingsModal.js
- scripts/update-structure.js
- scripts/find-module.js
- scripts/check-freshness.js
- test/frameStore.test.js
- test/gitExclude.test.js
- test/instructionDiscovery.test.js
- test/globalLayer.test.js
- test/contextPreamble.test.js
- test/frameTemplates.test.js
- test/tasksManager.test.js
- test/commandStaging.test.js
- test/docsManagedBlock.test.js
- test/specDrivenToggle.test.js

## Dependencies

None — git is already invoked via `child_process`, storage is `fs`, no new
packages.

## Sequencing

1. **Storage seam.** Add the `.frame/`-relative meta path map to
   `frameConstants` (legacy root names kept for detection); build
   `frameStore.js` (data API + named path entries); route `tasksManager` and
   `overviewManager` through it. Write `test/frameStore.test.js`; update
   `test/tasksManager.test.js` to the `.frame/tasks.json` expectations.
2. **Conditional exclude.** Build `gitExclude.js` with the signed-line state
   machine and worktree-safe path resolution; call it from the project-open
   path in `frameProject.js`. Write `test/gitExclude.test.js` against temp
   git repos (add/remove/no-repo/worktree/user-lines-preserved).
3. **Discovery + legacy notice.** Build `instructionDiscovery.js` (native
   files + legacy layout, debounced watch, strictly read-only); add the
   legacy-layout message to `ipcChannels.js` and the banner type to
   `healthNotice.js`; emit on project open. Write
   `test/instructionDiscovery.test.js` with fixture trees.
4. **Global layer.** Build `globalLayer.js` rendering the AGENTS core +
   REFERENCE from `frameTemplates` into `userData/frame-global/` with
   managed-block upgrades; call `ensure()` at app ready in `src/main/index.js`.
   The global AGENTS core is rendered **without** the spec section
   (`specDriven: false` is no longer a parameter there — the section stops
   being part of the core); global REFERENCE keeps the full spec protocol
   unconditionally, as it already does. Write `test/globalLayer.test.js`;
   extend `test/docsManagedBlock.test.js` with the single-copy upgrade case.
5. **Injection.** Build `contextPreamble.js` (pure), including the
   `specDriven` branch — activation paragraph when on, silence when off. Add
   per-tool `injection` config and `getLaunchCommand(projectPath)` IPC to
   `aiToolManager` (verify Claude's system-prompt/settings flags here; wrapper
   fallback); read `features.specDriven` from `.frame/config.json` at launch
   and feed it to the preamble; generalize the wrapper template in
   `frameTemplates` and regenerate `.frame/bin/<tool>`; generate
   `.frame/runtime/claude-settings.json` for spec-hint hooks and pass it by
   flag; switch `aiToolSelector`, `index.js`, `agentDispatch.js` to the
   composed command. Write `test/contextPreamble.test.js` and
   `test/frameTemplates.test.js`.
6. **Init rewrite (the no-write flip).** `frameProject.js`: all init writes go
   inside `.frame/`; delete CLAUDE/GEMINI consume-and-symlink and the
   `.claude/settings.json` merge; collapse the spec-driven toggle to a pure
   config-flag write (delete `stripManagedSpecSection`, the AGENTS.md branches
   of `ensureSpecDrivenArtifacts`, and `upgradeSpecDocs`' AGENTS.md entry) and
   rewrite `test/specDrivenToggle.test.js` against that contract;
   `structureBootstrap.js`: husky path returns the manual snippet, hook
   template writes `.frame/STRUCTURE.json`; `scripts/*` resolve `.frame/`
   first with root fallback. **Unblocked** — the
   `audit-q3-performance-resources` collision this step waited on has landed
   (see Resolved decisions).
7. **Staged-template linkage.** `commandStaging.js` substitutes
   `{frame_global_path}`; staged spec.* templates reference the global
   REFERENCE location through it. Update `test/commandStaging.test.js`.
