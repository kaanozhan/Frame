---
keywords: footprint, .frame layout, meta files, CLAUDE.md pointer, .claude/rules, storage seam, frameStore, projectId, migration, git exclude, local vs repo, file classes
related: embedded-migration, project-settings, spec-knowledge-layer, cli-spec-command-parity, agent-orchestration, activity-monitor, audit-q3-reliability-recovery
supersedes: non-invasive-overlay (2026-06-02 revision)
---

# Frame footprint: meta files move into `.frame/`, delivery stays native

> **Revision note (2026-08-22).** This replaces the 2026-06-02 version of this
> spec. That version asked for two things: (1) move Frame's root files into
> `.frame/`, and (2) *"native prompt injection, composed at launch time — not by
> planting files"*, i.e. no `CLAUDE.md`, no hooks in `.claude/settings.json`,
> context handed to the CLI by flag/wrapper. PR #116 implemented (2) faithfully
> and the review showed why it must not ship: launch-time injection turns a
> guaranteed mechanism (Claude Code loads instruction files and hooks natively,
> every session, every subagent, every shell) into a best-effort one (wrapper →
> PATH → shell init → alias conflicts → no subagents → no context outside
> Frame), and the wrapper/PATH layer is itself a code-execution surface. We keep
> (1) and **explicitly overturn (2)**: Frame's context and hooks stay
> file-based. Full comparison across 15 user scenarios: see the review
> artifact linked from PROJECT_NOTES `### [2026-08-22]`.

---

## Problem

Frame writes its identity into the project root and claims files it does not
own:

- `initializeFrameProject` writes `AGENTS.md`, `STRUCTURE.json`,
  `PROJECT_NOTES.md`, `tasks.json`, `QUICKSTART.md` at the repo root — six
  unfamiliar files in every teammate's `git status`, and a growing diff in
  every commit as `tasks.json`/`STRUCTURE.json` evolve.
- It **consumes** an existing `CLAUDE.md` (and `GEMINI.md`): reads it, deletes
  it, appends the content into `AGENTS.md`, replaces the file with a
  `CLAUDE.md → AGENTS.md` symlink. The team's instruction file silently becomes
  a block inside Frame's file; removing Frame later means knowing that.
- On Windows the symlink falls back to a *copy*, which drifts from `AGENTS.md`.
- There is no solo/team distinction: whether Frame's files are shared depends
  on what happened to get committed.
- Removing Frame is a manual hunt across root files, a symlink, a consumed
  block, `.claude/settings.json` entries and a pre-commit hook block.
- For the coming project-management layer (tasks/specs/notes served from a
  database / cloud) there is no storage seam: `frameProject.js` joins root
  paths in 17 places, `tasksManager`/`overviewManager`/`specManager` each read
  their own files, and there is no stable project identity beyond the path.

What is **not** a problem and must not change: Claude Code loads Frame's
instructions from a file at session start and runs Frame's two spec-hint hooks
from `.claude/settings.json`. That is deterministic today and is the spine of
the spec-driven workflow.

---

## Goal

Frame keeps one data directory, `.frame/`, and touches the repo outside it in
exactly two small, standard, enumerable places: `.claude/rules/frame.md` and
the Frame-signed hook entries in `.claude/settings.json` (or
`settings.local.json` in local mode). Context delivery, hooks, and the
developer workflow are unchanged.

### D1 — Meta files live under `.frame/`

`AGENTS.md`, `tasks.json`, `STRUCTURE.json`, `PROJECT_NOTES.md`,
`QUICKSTART.md` move to `.frame/<name>`. Nothing Frame-authored remains at the
root. `.frame/config.json`, `.frame/bin/`, `.frame/docs/`, `.frame/specs/`
stay where they are.

### D2 — Context delivery stays file-based and native

- Frame writes **`.claude/rules/frame.md`** containing a generated **copy** of
  `.frame/AGENTS.md`, under a one-line comment naming Frame as the owner and
  `.frame/AGENTS.md` as the file to edit. Frame rewrites the copy whenever
  `AGENTS.md` changes (init, project open, migration, spec-driven toggles, and
  the meta-directory watcher). Claude Code loads `.claude/rules/*.md` at launch
  from any working directory (verified 2026-08-22/23 with `claude -p` against a
  scratch repo: the rule alone, the rule alongside a user-owned root
  `CLAUDE.md`, and a session started in a sub-directory, all loaded).
  **An `@`-import is not usable here**: the first revision of this spec used
  `@../../.frame/AGENTS.md`, and a session started in a sub-directory loads the
  rule file but does *not* expand an import that resolves above its working
  directory — the session got an empty rule. The copy costs a few KB of
  duplication; `.frame/AGENTS.md` remains canonical.
- Frame **never** creates, deletes, symlinks, appends to or rewrites
  `CLAUDE.md`, `.claude/CLAUDE.md`, `AGENTS.md` at the root, or any other
  instruction file it did not author. The consume-and-symlink code path is
  removed.
- `.frame/AGENTS.md` opens with the precedence sentence: *the repository's own
  instruction files own code conventions; Frame owns its workflow.*
- `GEMINI.md` handling is removed entirely (Gemini support is being dropped).
  Codex keeps its existing `.frame/bin/codex` wrapper, updated to point at
  `.frame/AGENTS.md`.

### D3 — Hooks stay where they are

The two spec-hint hooks (`PreToolUse Edit|Write`, `UserPromptSubmit`) are
merged into `.claude/settings.json` exactly as today (merge-safe, idempotent,
no write on invalid JSON). Two refinements:

- The hook command guards its own presence:
  `[ -f .frame/bin/spec-hint.js ] && node .frame/bin/spec-hint.js <mode>` —
  so a clone that received `.claude/` but not `.frame/bin` does not error on
  every prompt.
- Entries carry a Frame marker (a stable, recognisable command string is
  enough) so "Remove Frame" can delete exactly its own entries.

### D4 — Solo vs. team is an explicit setting

`settings.gitSharing: "local" | "repo"` in `.frame/config.json`, chosen at
init (default: ask; pre-select `repo` when the repo already tracks `.frame/`)
and changeable in Project Settings.

- **local:** `.frame/` and `.claude/rules/frame.md` are added to
  `.git/info/exclude` (never the tracked `.gitignore`); hooks go to
  `.claude/settings.local.json`. `git status` shows nothing Frame-made.
- **repo:** nothing is excluded; `.frame/.gitignore` (managed block) keeps
  machine-local classes out (see D6); hooks go to `.claude/settings.json`.
- The exclude entry is conditional as PR #116 designed it: present only while
  `.frame/` is untracked, removed once any `.frame/` path is tracked, so
  committing `.frame/` is the whole opt-in and files never go invisible on a
  teammate's clone. Entries are anchored (`/.frame/`) so a monorepo's other
  `.frame/` dirs are unaffected. Frame never runs `git rm`; if `.frame/` is
  tracked while `local` is set, it warns and shows the command.

### D5 — Storage seam is data-centric

One module (`src/main/frameStore.js`) owns every read and write of the meta
files: `getTasks / saveTasks`, `getNotes / appendNote`, `getStructure /
saveStructure`, `getQuickstart`, `getAgentsInstructions`, plus `specs` access
delegated to `specManager`. Callers never join `.frame/<name>` themselves.

- Files remain the source of truth; reads go to disk (no write-behind cache),
  because agents edit these files directly with their own tools and Frame
  must see the result immediately — this is what keeps today's behaviour
  deterministic.
- The interface is keyed by project (see D7), not by path, so a later
  database/cloud backend replaces the implementation without touching callers.
- The `.frame/bin/` scripts (`find-module.js`, `check-freshness.js`,
  `update-structure.js`, `spec-*.js`, `detect-project.js`) resolve the project
  root from their own location (`<project>/.frame/bin` → `<project>`) or
  `FRAME_PROJECT_ROOT`, never from `__dirname/..`; running them by hand from a
  user project must never erase `STRUCTURE.json` (PR #116 finding).

### D6 — Files are classified, and the class decides git and sync

| Class | Files | Git (repo mode) | Future cloud |
| --- | --- | --- | --- |
| instruction | `.frame/AGENTS.md`, `.claude/rules/frame.md`, hook entries | tracked | stays a file (Claude reads files) |
| data | `tasks.json`, `specs/*` (spec/plan/tasks/outcome/digest/status), `PROJECT_NOTES.md` | tracked | source in DB; file is projection or synced copy — decided later |
| derived | `STRUCTURE.json`, `index/`, `specs/*/{implement,plan}-report.html`, `report-data.json` | **ignored** | regenerated locally |
| runtime | `runtime/`, `worktrees/`, `orchestration/`, `bin/`, `migration-backup/`, `*.bak`, `*.tmp`, `*.corrupt-*`, `implement-permissions.json` | **ignored** | never |

`.frame/.gitignore`'s managed block is generated from this table. Users may add
lines outside the block; Frame preserves them.

> Open point for planning: `STRUCTURE.json` is derived but today it is
> committed and teammates rely on it being present. Decide in plan.md whether
> it stays tracked for now (with regeneration on open) or moves to ignored.

### D7 — Stable project identity

`.frame/config.json` gains `projectId` (UUID v4), written at init and, for
existing projects, during migration (D8). All `frameStore` calls take the id;
the path↔id map lives in the app's workspace registry. This is the anchor the
cloud layer will need and is cheapest to add while every project is being
touched once anyway.

### D8 — Existing projects migrate with consent

On opening a project that has the pre-overlay layout **and** a
`config.json.files` record (Frame's own init signature — the only fingerprint
accepted; a `CLAUDE.md → AGENTS.md` symlink alone is *not* proof, it is a
public convention), Frame shows a modal: which files move where, where the
backup goes, **[Migrate] [Later]**. Nothing happens without the click.

The migration:
1. defers if any listed file is dirty in git (paths compared repo-root-relative
   so sub-directory projects are covered);
2. copies each file to `.frame/migration-backup/` and to `.frame/<name>` with
   `fsSafe` (fsync), verifies bytes, then removes the root copy; a `.frame/`
   counterpart that already exists and differs is never silently overwritten —
   the root file goes to the backup and the user is told;
3. removes the `CLAUDE.md`/`GEMINI.md` symlinks Frame planted; if `AGENTS.md`
   contains a consumed block, restores the original `CLAUDE.md` from it
   verbatim (`GEMINI.md` is not restored as a file — the block is kept in the
   backup);
4. writes `.claude/rules/frame.md`, updates hook entries to the guarded form,
   stamps `projectId`, drops the `files` record, upgrades `.frame/AGENTS.md`
   to the current template (the migrated instruction text must describe the
   new layout, or agents recreate root `tasks.json`);
5. is idempotent, logs every step to the activity log, and ends with a receipt
   listing moved / restored / backed-up files and the suggested commit.

### D9 — Removing Frame is one enumerable action

Project Settings → "Remove Frame from this project": deletes `.frame/`,
`.claude/rules/frame.md`, Frame's hook entries, the pre-commit hook block and
the exclude entries, then removes the project from the registry. Because Frame
never modified user-owned files, nothing has to be restored.

### D10 — Pre-commit hook

Vanilla `.git/hooks/pre-commit` is written/appended as today (local-only).
Husky and lefthook: show the snippet, never write the tracked file.

---

## Constraints

- **No behaviour change in delivery.** After this spec, a Claude session
  started from a Frame lane, from a hand-typed `claude` in a Frame terminal,
  from VS Code, as a subagent, or with `-p` sees Frame's instructions and runs
  Frame's hooks exactly as before. No wrapper, no `PATH` manipulation, no
  shell init, no `--append-system-prompt`.
- **Write surface outside `.frame/` is exactly:** `.claude/rules/frame.md`,
  Frame's own entries in `.claude/settings.json` or `settings.local.json`,
  `.git/info/exclude`, `.git/hooks/pre-commit`. Nothing else, ever — not
  `.gitignore`, not `CLAUDE.md`, not `.husky/`.
- **Non-initialized projects stay untouched.** Starting an agent in a project
  that is not a Frame project writes nothing (PR #116 regressed this).
- **Agents edit files; Frame must see it.** `frameStore` reads from disk;
  watchers stay as they are.
- **Orchestration keeps today's contract:** worker worktrees contain whatever
  is committed; `.frame/` and `.claude/rules/frame.md` must be tracked for
  workers to have their spec and context. Local-mode orchestration (copying
  `.frame/` into worktrees) is a separate spec.
- **Claude Code version.** `.claude/rules/` requires a recent Claude Code;
  record the minimum in the init modal and `docs`. No root `CLAUDE.md`
  fallback is written (one mechanism).
- **Cross-platform.** No symlinks anywhere. `@import` is Claude Code's own
  Windows recommendation.
- **This repository migrates too** (it is a pre-overlay Frame project); after
  migration its root `CLAUDE.md` symlink and `AGENTS.md` are gone and plain
  `claude` sessions load `.claude/rules/frame.md`. The repo's own
  `.claude/settings.json` hooks (`scripts/spec-hint.js`) are unaffected.

---

## Success Criteria

1. **Clean root.** Fresh repo → init → full session (tasks, a spec, notes,
   agent launch) → `git status` shows only `.frame/` and `.claude/` (repo mode)
   or nothing (local mode). No file Frame made at the root. Asserted by a test
   that walks the tree, hidden files included.
2. **User files byte-identical.** A repo with its own `CLAUDE.md`,
   `.claude/CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.husky/pre-commit`: all
   checksum-equal before and after init, a session, and "Remove Frame".
3. **Context both ways, natively.** In a repo with its own `CLAUDE.md`, a
   `claude -p` run without any Frame launch flags reports both the repo's rule
   and Frame's (the scratch-repo test from 2026-08-22, automated). The same
   holds for a subagent.
4. **Hooks fire as before.** `spec-hint.js` emits on `UserPromptSubmit` and on
   `Edit|Write` in a migrated project and in a fresh one; a clone without
   `.frame/bin` produces no hook error.
5. **Migration is consented, lossless, idempotent.** On a copy of this
   repository: modal → Migrate → every moved file byte-equal to its backup and
   its new location; second run is a no-op; a dirty tree defers with zero
   writes; a repo with a `CLAUDE.md → AGENTS.md` symlink but no Frame `files`
   record is left exactly as it was.
6. **Seam.** No module outside `frameStore.js` (and `specManager.js` for
   specs) joins a meta-file path; `grep -rn "tasks.json\|STRUCTURE.json\|PROJECT_NOTES.md\|QUICKSTART.md" src/` outside those two files hits only
   constants and UI strings.
7. **Scripts safe by hand.** `node .frame/bin/update-structure.js` run from a
   user project root without env vars updates `.frame/STRUCTURE.json`
   correctly; `find-module.js`/`check-freshness.js` report real modules.
8. **Feature parity.** Tasks, specs, notes, structure map, overview, spec
   dashboard, implement modes, orchestration (repo mode) all function as
   before.
9. **Removal.** "Remove Frame" leaves the repo with no Frame-authored bytes
   and the user's files untouched (criterion 2 applies).

---

## Out of Scope

- Launch-time injection of any kind (wrappers, `PATH`, shell init,
  `--append-system-prompt`, Windows `.cmd`/`.ps1`) — rejected, see revision
  note.
- Cloud/database backend for the data class — separate spec; this spec only
  guarantees the seam (D5), the classification (D6) and the identity (D7) it
  will need.
- Agent-facing CLI/API replacing direct file edits (`frame task start …`) —
  separate decision, taken with the cloud spec.
- Local-mode orchestration (materialising `.frame/` into worktrees) — separate
  spec.
- Gemini CLI support — being removed; only the symlink cleanup in D8 touches it.
- Editing the user's tracked `.gitignore`; auto-committing anything.
- Parsing or importing existing instruction files into Frame's structure.
