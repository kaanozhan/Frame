# Outcome — Frame footprint: meta files move into `.frame/`, delivery stays native

## T01 — Add `src/main/frameStore.js` and the new `frameConstants` entries

Added `src/main/frameStore.js` as the single owner of meta-file paths: the
overlay → legacy-if-`config.files`-record-and-root-file → overlay rule, plus the
`projectPath`-keyed typed API (`getTasks`/`saveTasks`, `readNotes`/`appendNote`,
`getStructure`/`saveStructure`, `readQuickstart`, `readAgents`/`writeAgents`,
`readConfig`/`writeConfig`, `getProjectId`/`ensureProjectId`, `metaDir`,
`isLegacyLayout`, and `resolvePath` for migration and the IPC layer), reading
from disk and writing through `fsSafe.writeFileAtomic` with its `.bak`.
`src/shared/frameConstants.js` gained `CLAUDE_RULE_PATH`, `FRAME_GITIGNORE_FILE`,
`LEGACY_SYMLINKS`, `MIGRATION_BACKUP_DIR` and `FRAME_FILE_CLASSES`, and dropped
`FRAME_FILES.GEMINI_SYMLINK`; `frameProject.js`'s two remaining `GEMINI.md`
references now use a local constant so init keeps working until T04 deletes that
block. Deviation from plan.md: `getTasks` returns fsSafe's
`{ data, source, error }` record instead of a bare object, because tasksManager's
corruption UX distinguishes "restored from `.bak`" from "nothing to restore", and
`setupIPC`/`LOAD_STRUCTURE_MAP` was left to T02 as planned.

_Captured: 2026-08-22 · 4 file change(s)_

---

## T02 — Route every meta-file caller through the seam

Pointed every meta-file caller at `frameStore`: `tasksManager` (path via
`resolvePath`, read via `getTasks`, write via `saveTasks`, watcher on
`metaDir(projectPath)` keeping the `filename === 'tasks.json'` check, plus a new
`restartWatching(projectPath)` for T09 to call after a migration),
`overviewManager`'s `loadStructure`/`loadTasks`/`loadDecisions`, `frameProject`'s
spec-driven AGENTS.md reads and writes, and `specManager`'s tasks.json watcher
path. Added the `LOAD_STRUCTURE_MAP` channel with `frameStore.setupIPC` wired in
`src/main/index.js`, so `src/renderer/structureMap.js` invokes for the parsed map
and no longer requires `fs`/`path`. Beyond plan.md: `specManager`'s watcher path
was routed too (S6 counts it as a meta-path join even though the module is
exempt for specs), and `test/specTasksSync.test.js` needed its fixture under
`.frame/` for the same reason as `test/tasksManager.test.js`, which also gained a
legacy-layout case. The S6 grep now leaves only `frameProject`'s
`checkExistingFrameFiles` list plus the "Created:" line (T05) and
`structureBootstrap`'s hook snippets (T03).
Followup for T08: `frameStore`'s atomic writes leave `<name>.bak` beside a
legacy artifact at the project root (as `tasks.json.bak` already does today), so
migration must treat a `.bak` sibling of a legacy artifact as Frame's — move it
into `.frame/migration-backup/`, never leave it at the root.

_Captured: 2026-08-22 · 10 file change(s)_

---

## T03 — Scripts resolve their own project root; hooks stage `.frame/STRUCTURE.json`

Gave `update-structure.js`, `find-module.js` and `check-freshness.js` the
`spec-index.js` root rule (`FRAME_PROJECT_ROOT` → `.frame/bin` two up →
`scripts/..` → cwd) and a local `resolveMetaPath` that prefers `.frame/`, falls
back to an existing root file and never creates one at the root; the parser
mkdirs `.frame/` before writing. `.githooks/pre-commit` and
`frameTemplates.getStructureHookSnippet` stage `.frame/STRUCTURE.json` when it
exists and the root copy otherwise, and `structureBootstrap`'s lefthook
instructions and prose follow (`copyParserScripts` was already exported, so
migration's refresh path needed no change). Departure from plan.md:
`check-freshness`'s `resolveMetaPath` returns `{ path, rel }` because its
QUICKSTART check hands the path to git as a pathspec, and
`test/projectAgnostic.test.js` had to follow the parser's new target — the
js-src-app fixture keeps its root golden, so it now covers the legacy fallback
while the other five cover the overlay case.

_Captured: 2026-08-22 · 8 file change(s)_

---

## T04 — Init writes the new layout, delivered natively

Rewrote `runProjectInit` to write only `.frame/*` and `.claude/rules/frame.md`
(new `ensureClaudePointer`), stamp identity via `frameStore.ensureProjectId`,
and install the guarded `sh -c '[ -f .frame/bin/spec-hint.js ] && …'` hooks
through `installSpecHintHook(projectPath, {file})` chosen by sharing mode;
`createSymlinkSafe`, the consume block and every `GEMINI.md` path are deleted,
and `removeSpecHintHook` lands ready for T10. `frameTemplates` moved to `.frame/`
paths throughout and gained `getClaudeRuleTemplate`, `getFrameGitignoreBlock`,
`SPEC_HINT_HOOKS` + `LEGACY_SPEC_HINT_COMMANDS`, a `projectId` and
`settings.gitSharing` in the config template and no `files` record. Departures
from plan.md: re-init carries the existing `projectId`/`gitSharing` forward
rather than regenerating them, and the sample-project conversion (nominally T05)
landed here because the init suite asserts it. `test/nativeContext.test.js`
skips without the CLI but ran for real here — `claude -p` returned both the
repo's own CLAUDE.md codeword and the `.frame/AGENTS.md` one, which is success
criterion 3.

_Captured: 2026-08-23 · 12 file change(s)_

---

## T05 — User-facing layout surfaces follow the new layout

Rewrote the init modal's file list around `.frame/` and the pointer, added the
"nothing is added to your project root" promise, the Claude Code requirement
note (2.1.x line, `/context` to confirm) and the `repo`-pre-selected sharing
radios T07 will wire, with matching styles in `panels.css`. Narrowed
`checkExistingFrameFiles` to Frame's own paths and dropped the
CLAUDE.md-consumption paragraph from the confirmation dialog, since init no
longer reads or replaces a root file. The renderer's "Created:" line,
`sampleBanner`'s two strings, both spotlight cards and the static
`src/templates/CLAUDE.md` now name `.frame/` paths; the sample-project
conversion this task nominally owned shipped in T04.

_Captured: 2026-08-23 · 6 file change(s)_

---

## T06 — Sharing mode: `gitExclude` and `gitSharing`

Added `src/main/gitExclude.js` (marker block in the file `git rev-parse
--git-path info/exclude` names, anchored entries with `show-prefix` for
sub-directory projects, tracked detection, user lines preserved, no-op outside
git) and `src/main/gitSharing.js` (mode read/write, managed `.frame/.gitignore`
block from the file classes with `STRUCTURE.json` deliberately absent, hook
entries moved between `settings.json` and `settings.local.json`, UI state with
the tracked-under-local warning). Beyond plan.md: `ensureExcluded` *withdraws*
an existing block when `.frame/` becomes tracked instead of merely declining to
add one, and `gitSharing.reconcile()` exists so project open and post-migration
re-derive that; both follow from tracked state changing outside Frame. Frame
never runs `git rm` — the warning carries the command instead.

_Captured: 2026-08-23 · 4 file change(s)_

---

## T07 — Sharing mode wired into the UI

Wired `GET_GIT_SHARING_STATE`/`SET_GIT_SHARING` (and the migration/remove
channels for T09/T10) through `frameProject.setupIPC` into `gitSharing`, made
`CHECK_IS_FRAME_PROJECT` answer `layout`, and had init take the modal's radio
value (`state.js`) and call `gitSharing.reconcile` so the exclude block and
`.frame/.gitignore` exist from the first run. Settings → Workflow gained the
Git-sharing select plus warning line and the Remove Frame row, wired with the
same `ipcRenderer.invoke` pattern as the spec-driven toggle. The select renders
wholly from main's state object so the tracked-under-local warning cannot drift
from what git reports; the `layout` answer and the Remove Frame markup landed
early because both were one-liners in surfaces this task already touched.

_Captured: 2026-08-23 · 8 file change(s)_

---

## T08 — `layoutMigration`: pure `plan()`, consented `run()`

Added `src/main/layoutMigration.js`: a pure `plan()` (narrow fingerprint,
dispositions incl. `backup-only` for `.bak` siblings, Frame-planted symlinks
only, restorable CLAUDE.md block, dirty and tracked lists, derived sharing
mode) and a `run()` that backs up before it touches anything, copies through
`fsSafe` and byte-verifies before unlinking, restores CLAUDE.md verbatim, makes
targeted AGENTS.md edits with a review list, writes the pointer, stamps the id,
drops the `files` record, replaces the unguarded hooks and refreshes
`.frame/bin`. Departure from plan.md: untracked files are not treated as dirty
— in an unshared project every meta file is untracked, so counting them would
block migration exactly where it is safest; only tracked modifications defer.
Two bugs the tests caught: porcelain lines must be regex-matched rather than
sliced at a fixed column (the git helper trims, shifting the first line), and
`sharing.mode_changed` had to be added to the activity registry or T06's record
was silently dropped.

_Captured: 2026-08-23 · 3 file change(s)_

---

## T09 — Migration consent wired end to end

Handled `GET_LAYOUT_MIGRATION_PLAN`/`RUN_LAYOUT_MIGRATION` in
`frameProject.setupIPC` (progress streamed to `event.sender`, then
`tasksManager.restartWatching` once the run succeeds), inited `layoutMigration`
with the activity log, and added `src/renderer/migrationModal.js` — one modal
with four states (plan, progress, receipt, dirty-tree deferral) — opened from
`state.js` when `IS_FRAME_PROJECT_RESULT` reports `layout: 'legacy'`. The Later
choice is remembered per project for the session only: the offer should return
next launch, since the layout is still what it was, but never twice while the
user is working. `run()` re-plans in main rather than trusting the renderer's
copy, so a stale plan can never be executed.

_Captured: 2026-08-23 · 7 file change(s)_

---

## T10 — Remove Frame from a project

Added `frameProject.removeFrame` (`.frame/`, the pointer and an emptied
`rules/`, Frame's hook entries in both settings files, the pre-commit marker
block, the exclude block, then `workspace.removeProject`) behind
`REMOVE_FRAME_FROM_PROJECT` and a confirming button in Settings → Workflow that
names what will be deleted. The exclude block goes first because it names the
directory being deleted. Stripping the pre-commit block also takes back the
blank-line separator Frame's appender had inserted — without that the user's
`.husky/pre-commit` came back one byte different, which the checksum test
caught — and a hook file left with only a shebang was Frame's own creation, so
it is removed rather than left as a stub.

_Captured: 2026-08-23 · 4 file change(s)_

---

## T11 — Prose follows the layout

Repointed the orchestration and spec-command templates plus
`orchestrationManager`'s merge-reconcile message at `.frame/` paths, and
rewrote the layout sections of `README.md`, `docs/index.html` and
`docs/capabilities/index.html` around the `.frame/` directory, the
`.claude/rules/frame.md` pointer, the two sharing modes and the Claude Code
minimum version. Prose only, no behaviour. The docs' Gemini entries described a
symlink Frame no longer creates, so they now describe what is true — plain
markdown and JSON under `.frame/` that any CLI can be pointed at.

_Captured: 2026-08-23 · 9 file change(s)_

---

## T12 — Dogfood: migrate this repository

Drove `layoutMigration.plan()`/`run()` **headlessly** on this repo (Electron
stubbed as the tests do — a Frame window cannot host its own migration mid-run;
the modal path is exercised separately in the live app). `AGENTS.md`,
`STRUCTURE.json`, `PROJECT_NOTES.md`, `tasks.json` and `QUICKSTART.md` moved
into `.frame/` with byte-equal copies in `.frame/migration-backup/`,
`tasks.json.bak` travelled with them, the `CLAUDE.md` symlink is gone, and
`.claude/rules/frame.md`, `.frame/.gitignore`, `projectId` and
`settings.gitSharing: repo` are in place. `npm test` (286), `npm run structure`
(116 modules → `.frame/STRUCTURE.json`), `spec-context.js` and `find-module.js`
all pass on the migrated layout. The dogfood earned its place: this repo's
symlink note is a two-line blockquote, and the single-line regex left the
continuation behind — the matcher now replaces the whole paragraph and keeps
its prefix, with a regression test. This repo's hooks call
`scripts/spec-hint.js`, not the `.frame/bin` form, so they were correctly left
untouched; the guarded entries migration added alongside them were reverted to
keep this repo's wiring exactly as it was.

_Captured: 2026-08-23 · migrated in place_

---

## T13 — Fix the sharing-mode engine at init and on open

`runProjectInit` declared a local named `gitSharing`, shadowing the module
required at the top of the file, so `gitSharing.reconcile(projectPath)` threw
into a swallowing catch: no init had ever written `.frame/.gitignore` or the
exclude block. Renamed the local to `sharingMode`, and `CHECK_IS_FRAME_PROJECT`
now reconciles the stored mode on every project open (tracked state changes
behind Frame's back). `gitExclude` grew per-project markers — a sub-directory
project qualifies them with its `show-prefix` while a root project keeps the
historical plain form, so two Frame projects in one repository no longer
clobber each other's block — plus a whole-line, CRLF- and EOF-safe `splitBlock`
that `gitSharing` reuses for `.frame/.gitignore`, and `/.claude/settings.local.json`
among the excluded entries. `setMode` refuses a non-object config, writes
`config.json` only when the mode actually changes (reconcile runs on every
open now), and returns `installSpecHintHook`'s result as `hooks`.

_Captured: 2026-08-23 · 5 file change(s)_

---

## T14 — Make the hook guard exit 0 and preserve user formatting

Replaced the hook command's `[ -f … ] && exec …` guard with `[ ! -f … ] || exec …`
(the `&&` form made the whole `sh -c` exit 1 when `.frame/bin/spec-hint.js` was
absent, so a clone without it reported a failing hook on every prompt) and put
both older forms into `LEGACY_SPEC_HINT_COMMANDS` so removal still matches them.
`installSpecHintHook`/`removeSpecHintHook` now detect the settings file's own
indentation and write it back instead of reflowing a four-space file to two,
and install declines outright when a hook already runs `spec-hint.js` by a
route Frame does not currently install — a hand-wired project (this repository
runs `node scripts/spec-hint.js`) or Frame's own earlier command form. That one
guard covers both call sites the audit named, init and migration's step 5, so
no separate matcher was needed there.

_Captured: 2026-08-23 · 4 file change(s)_

---

## T15 — Ship `.frame/bin` with the project

Moved `bin/` out of the ignored runtime class into `derived`, with a new
`FRAME_TRACKED_DERIVED` list (`STRUCTURE.json`, `bin/`) naming what the managed
`.frame/.gitignore` block leaves out. `copyParserScripts` became copy-if-changed
(reusing `commandStaging.copyIfChanged`) and now runs — with
`commandStaging.stageCommandFiles` — from the `CHECK_IS_FRAME_PROJECT` handler,
so a checkout carrying older scripts heals on open without churning an
up-to-date one. `getStructureHookSnippet` falls back to the main worktree's
parser through `git rev-parse --git-common-dir` while keeping
`FRAME_PROJECT_ROOT` on the current checkout, which is what makes the hook work
in `.frame/worktrees/<slug>`. This repository's `.frame/bin` is staged and the
root `.gitignore` line that hid it (`.frame/bin/*.js`) is gone.

_Captured: 2026-08-23 · 8 file change(s)_

---

## T16 — Stop spec-phase regression when task data is unavailable

`derivePhase` now returns `currentPhase` untouched when it is handed no task
data, so `reconcilePhase` can no longer rewrite a `status.json` on the strength
of a file it never read — the failure that walked 21 finished specs in this
repository from `done` back to `tasks_generated` when an older Frame (still
reading the root `tasks.json`) opened the migrated repo. Exported
`reconcilePhase` so the regression test in `test/specTasksSync.test.js` can
drive it, and pinned that real task data still rewinds a phase when a task
really is pending. Also restored the 19 `status.json` files the working tree
had already been damaged in, and added the upgrade note to README ("update
Frame before pulling a repository migrated to `.frame/`") and a matching rule
to the spec digest.

Followup: the same "absence is not data" audit is worth running over the other
derived-state writers (`tasksManager` sync, `overviewManager`).

_Captured: 2026-08-23 · 5 file change(s) + 19 restored_

---

## T17 — Harden the migration engine

`plan()` now reads the consumed `CLAUDE.md` block from the root `AGENTS.md`
directly — `frameStore.readAgents` is overlay-first by design, which is exactly
wrong for reading what the *legacy* init wrote — and the receipt speaks up in
both previously silent cases (no block found, a `CLAUDE.md` already in the
way). An empty or unparseable `.frame/` counterpart gets a third disposition,
`replace-invalid`: the bad overlay goes to `migration-backup/<name>.unusable`
and the root file takes its place, so a half-written `tasks.json` can no longer
win a conflict. The steps moved into `execute()` so `run()` can return a
truthful partial receipt (`ran: true`, `failedAt`, what got through) with a
`migration.failed` event instead of a modal reading "migration did not run"
over a half-moved tree; the handler catches around it, re-arms
`specManager.startWatching` and pushes a fresh file tree. The modal defers only
a project the user actually decided about (a dirty tree is re-offered on the
next selection) and renders the partial receipt, and `dialogs.js` replaces a
legacy-layout `sample-project` copy rather than offering to migrate a demo.

_Captured: 2026-08-23 · 5 file change(s)_

---

## T18 — Honour D10 and tidy removal

`installPreCommitHook`'s husky branch now hands the snippet back as manual
instructions instead of writing `.husky/pre-commit`, which makes
`.git/hooks/pre-commit` in a repository that has no hook the only file Frame
writes — `appendToHookFile` and `hasFrameSnippet` went with it. `removeFrame`
deletes that file when nothing but Frame's own header and marker block remain
(matched against what the template leaves, not a loose "only comments" regex,
so a user's comment-only hook is safe), deletes a settings file that now parses
to `{}` — and its `.claude/` directory when nothing else is in it — and the
renderer calls the new `state.noteFrameRemoved()` so the spec panel and the
workflow toggles see a non-Frame project, with the init prompt suppressed
rather than bouncing straight back.

_Captured: 2026-08-23 · 5 file change(s)_

---

## T19 — Make `.claude/rules/frame.md` an inline copy of `.frame/AGENTS.md`

Verified against the real CLI that the import never worked from a
sub-directory: `.claude/rules/frame.md` loads, but `@../../.frame/AGENTS.md`
resolves above the working directory and is not expanded, so the session got an
empty rule. `getClaudeRuleTemplate(agentsText)` now emits a "generated from
.frame/AGENTS.md — edit that file" header plus the whole file, and
`ensureClaudePointer` became `syncClaudeRule(projectPath)` (writes only when
the content differs), called at init, on project open, after migration, after
every spec-driven enable/disable/upgrade, and from `tasksManager`'s
meta-directory watcher via the new `onMetaFileChange` hook — one watcher, not
two. The AGENTS and CLAUDE templates and migration's note replacement now say
Claude reads the generated copy; this repository's and the sample project's
rule files were regenerated, and spec.md D2 records the import finding.
`test/nativeContext.test.js` gained the sub-directory launch case, which passes
against the real `claude` where the import version returned NONE.

_Captured: 2026-08-24 · 10 file change(s)_

---

## T20 — Finish the prose and the report helper

`build-implement-report.mjs`'s `readTasks` reads `.frame/tasks.json` with a
project-root fallback (exported now, with a regression test) — the report's
progress banner had been counting a file that no longer exists at the root and
silently reporting nothing; it reads 19 of 20 on this spec. The QUICKSTART
template's Key Files and For AI Assistants sections, the REFERENCE template's
intro and General Rules, and this repository's `.frame/docs/REFERENCE.md` name
`.frame/…` paths; the init modal, README and `docs/index.html` say "verified
with Claude Code 2.1.x; run `/context` to confirm `.claude/rules/frame.md`
loaded"; `.frame/bin` is "Frame's parser and helper scripts" in the modal, the
native confirmation dialog and the capabilities page; and the `GEMINI.md`/
symlink passages in `docs/blog/multi-ai-support`,
`docs/blog/context-preservation` and `docs/capabilities` describe the generated
rule file instead.

Deviation: REFERENCE's section headings ("Task Management (tasks.json)",
"STRUCTURE.json Rules") keep their bare names on purpose — the AGENTS.md table
cross-references them by exact text, so renaming them would break the pointer
this prose fix exists to serve.

_Captured: 2026-08-24 · 9 file change(s)_

---

## Verification round — adversarial re-audit of the fix round

The same four-audit treatment the rejected PR got was turned on this branch's
own T13–T20. T13, T15, T17 and T19 came back verified end to end; the worry
that T19 had been left half-finished by an interrupted worker did not hold —
all seven `AGENTS.md` mutation paths call `syncClaudeRule`, no `@`-import
remnant survives anywhere, and the generated copy is byte-identical to its
source. Three fixes were narrower than their own commit messages claimed, and
each was measured before being closed:

**T14 never reached the projects that needed it.** `installSpecHintHook` bailed
out on any `spec-hint.js` command that was not today's — which includes Frame's
own earlier `[ -f … ] && exec …` form. A project initialised between T04 and
T14 therefore kept the guard that exits 1, reporting a hook failure on every
prompt whenever `.frame/bin` was absent, and no path other than migration could
heal it. Frame's own past command forms are now recognised as ours and upgraded
in place; a hook the user wrote by hand is still left alone.

**T16 guarded the wrong half of "unavailable".** `tasksManager.loadTasks` does
not return null on unrecoverable corruption — it writes a fresh empty
`tasks.json` and returns `{ tasks: [], corrupt: true }`, which sails past a
`!tasksData` check. The finished spec walked back to `tasks_generated` anyway,
and because the empty replacement is now on disk, the next open regressed it
again with no `corrupt` flag left to notice. `derivePhase` now also holds the
recorded phase when `status.json` lists generated task ids that `tasks.json` no
longer carries; a regenerate that legitimately ends with no tasks clears those
ids and the file-based fallback applies as before.

**T20's sweep stopped roughly halfway.** The REFERENCE and spec-driven
templates, the sample project, `.frame/QUICKSTART.md` (untouched until now, and
still documenting the `CLAUDE.md` symlink this spec deleted), this repository's
own `.frame/docs/REFERENCE.md` and `.frame/AGENTS.md`, and the init modal's
"two lines" description all still described the old layout. A fresh init now
generates docs whose only bare root-level names are the four REFERENCE headings
the AGENTS.md table cross-references by text.

One asymmetry in T18 was closed alongside: Frame never writes `.husky/pre-commit`
(D10), so a Frame block there was pasted by the user into a file they usually
track — removal strips the block but no longer deletes the file. The Remove
Frame confirmation now names everything the removal actually touches, including
the settings files it may delete outright and the `.git/info/exclude` block.

Local-mode orchestration remains the recorded non-goal it always was: a worker
worktree in `local` mode has no `.frame/` and no rule file, because neither is
tracked. Verified, not fixed — it belongs to the separate spec the Non-goals
section already names.

_Captured: 2026-08-24 · verification round_

---
