# Outcome — Non-Invasive Frame Overlay (.frame-only, zero-touch)

## T01 — Meta path map + frameStore storage seam

Added `FRAME_META_FILES` (the `.frame/`-relative meta path map) and
`LEGACY_ROOT_FILES` to `src/shared/frameConstants.js` — `FRAME_FILES` stays as
an alias while pre-overlay call sites are converted — and built
`src/main/frameStore.js` with a data API (tasks/structure/notes/quickstart/
config/project-AGENTS) plus separately named `…Path(projectPath)` entries for
the file-needing minority; JSON reads pass fsSafe's `{ data, source, error }`
envelope through rather than flattening it, so the recovery signal survives the
seam. Diverged from `plan.md` on one point: `ORCH_META_FILES` was **not**
converted to `.frame/` paths — both consumers (`specManager.js:656`,
`orchestrationManager.js:462`) match a footprint entry's *basename*, which is
already layout-agnostic, and full paths there would have silently stopped every
match; the reason is now a comment on the constant. Files: `frameConstants.js`,
`frameStore.js` (new), `test/frameStore.test.js` (new, 12 cases).

_Captured: 2026-07-29 · 3 file changes_

---

## T02 — Route tasksManager and overviewManager through frameStore

Swapped `tasksManager`'s direct `fsSafe` reads/writes for `frameStore.readTasks`/
`writeTasks` (the recovery envelope arrives from the store, so the corruption
contract is untouched) and made its watcher derive the watch directory from the
store's path entry rather than assuming the project root; `overviewManager`'s
`loadStructure`/`loadTasks`/`loadDecisions` lost their hand-built root paths.
Two touches outside `plan.md`'s Files, both forced by this change rather than
chosen: `specManager.js:1063` kept a private `fs.watch` on the root
`tasks.json` — left alone it would watch a path that no longer exists, so it
now uses `frameStore.tasksPath` — and `test/specTasksSync.test.js` seeded its
fixture at the root. Kept the `tasks-root` activity-watcher label as-is:
renaming it would drag in the `WATCHERS` enum in `activityEvents.js` for a
cosmetic gain. Files: `tasksManager.js`, `overviewManager.js`, `specManager.js`,
`test/tasksManager.test.js` (+2 cases), `test/specTasksSync.test.js`.

Followup: `src/renderer/structureMap.js:276` still reads a root `STRUCTURE.json`
and is in no task's scope — it will show an empty map once T13 moves the
writers.

_Captured: 2026-07-29 · 5 file changes_

---

## T03 — Conditional .git/info/exclude state machine

Built `src/main/gitExclude.js` — exclude file resolved through
`git rev-parse --git-path info/exclude` so linked worktrees and submodules get
their own, then the state machine (no repo → no-op, `.frame/` tracked → remove
our entry, untracked → add it) — and called `ensure()` from both the
project-open IPC and the top of `runProjectInit`, before the first `.frame/`
artifact exists. Diverged from `plan.md` on the signed line: gitignore has no
trailing comments, so the specified `.frame/  # managed by Frame …` would have
been read as a literal pattern that excludes nothing — the signature now sits
on its own comment line above the pattern and the two move together, with the
old single-line form still recognized so an earlier Frame's entry is collapsed
rather than orphaned. Files: `gitExclude.js` (new), `frameProject.js`,
`test/gitExclude.test.js` (new, 12 cases against real temp repos).

_Captured: 2026-07-29 · 3 file changes_

---

## T04 — Read-only instruction discovery + legacy-layout notice

Built `src/main/instructionDiscovery.js`: one root scan covering both the
native instruction conventions and the pre-overlay Frame layout, re-scanned in
full on every project open with the debounced `fs.watch` demoted to a pure
optimization; added `IPC.LEGACY_LAYOUT_DETECTED`, the `healthNotice.js` banner
branch, and the emit from the project-open IPC. The notice is **not** gated on
`isFrameProject` as first written — a pre-overlay init wrote `.frame/config.json`
*and* the root files, so gating on the absence of `.frame/` would have meant the
banner never fires for the only case it exists for. Detection needs a
Frame-specific companion (`STRUCTURE.json`/`PROJECT_NOTES.md`/`QUICKSTART.md`)
or a `CLAUDE.md → AGENTS.md` symlink alongside a root `tasks.json`, so a repo
that merely ships an `AGENTS.md` reads as an instruction file. Files:
`instructionDiscovery.js` (new), `ipcChannels.js`, `healthNotice.js`,
`frameProject.js`, `test/instructionDiscovery.test.js` (new, 16 cases with a
checksum+mtime snapshot proving the scan is read-only).

Note: Frame's own repo is a legacy layout, so it will show this banner until
the `embedded-migration` spec runs — that is the intended "fail loud".

_Captured: 2026-07-29 · 5 file changes_

---

## T06 — Global instruction layer in userData

Built `src/main/globalLayer.js` owning `userData/frame-global/{AGENTS.md,
REFERENCE.md}` — core without the spec section, REFERENCE keeping the full
protocol as a managed block, upgrades in place — and called `init(app.getPath(
'userData'))` + `ensure()` from `index.js` beside `userSettings.init()`, where
userData first resolves. `userDataPath` is injected rather than required from
Electron so the module and its tests stay Electron-free, matching the suite's
convention. Ahead of `plan.md`'s sequencing (it assigns `frameTemplates` to
step 5) `getAgentsTemplate` gained the `global` and `referencePath` options
this needed — without them the shared copy would have carried a Project Facts
block about no project and a claim that a `CLAUDE.md` symlink exists. Files:
`globalLayer.js` (new), `index.js`, `frameTemplates.js`,
`test/globalLayer.test.js` (new, 11 cases), `test/docsManagedBlock.test.js`
(+1 single-copy case).

_Captured: 2026-07-29 · 5 file changes_

---

## T07 — Pure launch-time preamble composer

Built `src/shared/contextPreamble.js`: pointers only, the domain-precedence
rule stated outright, and the spec-driven activation paragraph gated on the
flag; tools that read the repo's own file natively are acknowledged rather than
instructed, everything else discovered is pointed at. One correction the tests
forced: the precedence sentence originally listed "the spec workflow" as part
of Frame's domain unconditionally, which still tells an agent specs exist here
when the feature is off — the enumeration is now conditional, and a test
asserts `/spec/i` matches nothing in the off case. Files:
`contextPreamble.js` (new), `test/contextPreamble.test.js` (new, 17 cases).

_Captured: 2026-07-29 · 2 file changes_

---

## T08 — Declarative injection config and getLaunchCommand

Added `injection: { type: 'flag'|'wrapper' }` to `AI_TOOLS` — Claude Code's
`--append-system-prompt` and `--settings` verified against the shipping CLI's
`--help` — and `aiToolManager.getLaunchCommand(projectPath, toolId, extraFlags)`,
which composes the preamble main-side, reads `features.specDriven` per launch,
writes `.frame/runtime/{preamble.txt,claude-settings.json}`, regenerates the
wrapper and returns the finished string over `IPC.GET_LAUNCH_COMMAND`. The
wrapper reads the preamble from a file instead of carrying it inline: it is
multi-line prose full of quotes and backticks, and inlining is how generated
shell scripts break. Gemini moved onto a wrapper command with `gemini` as
`fallbackCommand`, so a project whose wrapper does not exist yet still probes
and launches; any injection failure degrades to the bare CLI. Files:
`aiToolManager.js`, `frameTemplates.js`, `ipcChannels.js`, `frameProject.js`
(wrapper writing + one spec-hint hook definition), `test/frameTemplates.test.js`
(new, 13 cases).

_Captured: 2026-07-29 · 5 file changes_

---

## T10 — Renderer launch sites use the composed command

Added async `aiToolSelector.getLaunchCommand(projectPath, launchFlags)` over
`IPC.GET_LAUNCH_COMMAND` (bare command as fallback on any failure) and switched
`index.js`'s `startAiSession` and `agentDispatch._startAgentIn` — plus its two
callers — to await it. Went beyond the three listed call sites for one reason:
`dispatch()` is the path every task and spec run actually takes, and leaving it
on `CHECK_AI_TOOL_AVAILABLE` alone would have launched all of them with no
Frame context — the regression this spec exists to prevent. It now fetches the
composed flags *before* the availability probe, because for a wrapper-based CLI
that call is also what writes `.frame/bin/<tool>`. Files:
`aiToolSelector.js`, `index.js`, `agentDispatch.js`.

_Captured: 2026-07-29 · 3 file changes_

---

## T13 — Structure hook and scripts stop writing the project root

Taken **before T11**, out of numeric order: T11's footprint test proved init
still wrote a root `STRUCTURE.json`, and that write belongs to this task — T11
could not have been committed green first. `installStructureHook` stops
appending to the tracked `.husky/pre-commit` (degrades to the existing
show-the-snippet path; vanilla `.git/hooks/` installs stay), the snippet stages
`.frame/STRUCTURE.json` and only when `git ls-files` says it is tracked —
adding an excluded file would drag all of `.frame/` into the user's commit —
and the three scripts resolve meta artifacts `.frame/`-first with a root
fallback while `ROOT_DIR` keeps pointing at the project root so
`activityLog.projectKey` stays bucketed. The resolver is inline in each script
rather than shared: they are copied standalone into `.frame/bin/`, so a shared
require would have to join `PARSER_FILES` to survive the copy. Files:
`structureBootstrap.js`, `frameTemplates.js`, `scripts/update-structure.js`,
`scripts/find-module.js`, `scripts/check-freshness.js`,
`test/projectAgnostic.test.js` (reads the map from wherever it lands).

_Captured: 2026-07-29 · 6 file changes_

---

## T11 — Init writes only inside .frame/

Deleted the consume-and-symlink block from `runProjectInit` — no reading and
unlinking `CLAUDE.md`, no `GEMINI.md` merge, no root `AGENTS.md`, and
`createSymlinkSafe` removed with it — and routed STRUCTURE/NOTES/tasks/
QUICKSTART through `frameStore`'s path entries; `installSpecHintHook` no longer
reads or writes `.claude/settings.json` and instead reports that the hooks
travel by launch flag. `checkExistingFrameFiles` and the init dialog were
rewritten around the `.frame/`-only footprint, the dialog now naming the
discovered instruction files it will leave untouched. The new
`test/frameProjectInit.test.js` walks the whole tree and diffs snapshots rather
than checking named files — that is what caught the root `STRUCTURE.json`
escape (fixed in T13, taken first). No `.frame/AGENTS.md` is seeded. Files:
`frameProject.js`, `test/frameProjectInit.test.js` (new, 7 cases).

_Captured: 2026-07-29 · 2 file changes_

---

## T12 — Spec-driven toggle collapses to a config-flag write

Deleted `stripManagedSpecSection`, `disableSpecDriven`'s AGENTS.md surgery, the
AGENTS.md branch of `ensureSpecDrivenArtifacts` and `upgradeSpecDocs`' AGENTS.md
entry: both directions of the toggle are now a `.frame/config.json` write and
nothing else, with the launch preamble deciding what an agent is told. Rewrote
`test/specDrivenToggle.test.js` (13 cases) against that contract — snapshots
prove only the config changes, including for a repo whose own `AGENTS.md`
happens to contain a "Spec-Driven Development" heading, which the old strip
path would have edited. Files: `frameProject.js`, `settingsModal.js`,
`test/specDrivenToggle.test.js`.

_Captured: 2026-07-29 · 3 file changes_

---

## T15 — Staged spec templates point at the global reference

Added a pure `substitutePlaceholders` and a staging-time `{frame_global_path}`
substitution to `commandStaging`, resolved once per pass from
`globalLayer.referencePath()`, with `resolveStagingPlan` marking only the
markdown templates (the HTML template and the report generator use braces for
their own purposes) and `copyIfChanged` taking an optional transform — applied
before the content comparison, so a second project open is still a no-op. All
four shipped `spec.*.md` templates carry the placeholder in their Context
block. It is filled at staging rather than per dispatch because the path is
machine-wide, so a CLI session that opens the staged file directly sees
something it can follow; an unresolved placeholder is left visible rather than
blanked, since an empty value would silently point a reader at `/REFERENCE.md`.
Files: `commandStaging.js`, the four `src/templates/commands/claude-code/spec.*.md`,
`test/commandStaging.test.js` (+6 cases).

_Captured: 2026-07-29 · 6 file changes_

---

## Post-implementation fixes

Two gaps surfaced after the spec closed, both from the same cause — `plan.md`'s
Files list covered the main process but not the renderer surfaces that describe
it:

- **The init modal advertised the old layout.** Its file list is static markup
  in `index.html`; T11 rewrote `frameProject.js`'s native dialog, which is only
  the fallback. Five further strings were stale for the same reason (both
  spotlight cards, the Settings and specPanel spec-driven copy, `sampleBanner`'s
  "your AI agent starts from AGENTS.md", the post-init terminal line). Fixed in
  `d10df3a`.
- **Structure Map read the root `STRUCTURE.json`** — recorded as a followup on
  T02 and now closed. It went through IPC to `frameStore.readStructure` rather
  than gaining a `.frame/`-first resolver, because it was the last place in the
  renderer opening a project file directly; `frameStore` is now the only module
  that knows where the map lives, which is what the spec's storage constraint
  asked for. `structureMap.js` lost its `fs` and `path` imports entirely.

Still open, deliberately: `.frame/` visibility (private vs shared) has a working
mechanism but no UI, so Goal 7's "Frame surfaces this as an explicit choice" is
only half delivered — `plan.md` never turned that sentence into a task. Carried
to a follow-up spec together with an init-time spec-driven choice.
