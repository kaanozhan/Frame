---
keywords: layout migration, consent, dirty tree, pre-consent writes, overlay layout, AGENTS.md, spec docs upgrade, migration modal, deferral, file ownership
related: non-invasive-overlay, spec-docs-delivery-invariant
---

# Migration asks about decisions, not about moves

## Problem

`non-invasive-overlay` shipped the move into `.frame/` behind a consent modal
and a dirty-tree guard. In the field the two combine into a state where the
migration can never run at all.

Reproduced end to end on a real v2.6.0-era project (`comeety`, 2026-08-27,
five tracked meta files at the root) and confirmed against the code:

1. Project opens. `CHECK_IS_FRAME_PROJECT` (`frameProject.js:1177`) runs
   `copyParserScripts`, `stageCommandFiles`, `gitSharing.reconcile` and
   `syncClaudeRule` **before** it answers `layout: 'legacy'`.
2. `WATCH_SPECS` (`specManager.js:1345`) then runs `ensureProjectArtifacts`
   and `upgradeSpecDocs`. The latter resolves its target through
   `frameStore.resolvePath`, which in an unmigrated project is the **root**
   `AGENTS.md` — and rewrites it, because `SPEC_SECTION_VERSION` went 1 → 2
   in `97c0e91`.
3. Only then does the modal ask for the plan. `layoutMigration.plan()` runs
   `dirtyAmong` (`layoutMigration.js:159`), sees ` M AGENTS.md`, and returns
   `canRun: false`.
4. The modal says *"Commit or stash them, then reopen this project."*
   Stashing removes the change; reopening re-runs step 2; the file is dirty
   again. The advice is self-cancelling.

The whole diff that blocks the migration:

```diff
-<!-- frame:managed:spec-section v=1 -->
+<!-- frame:managed:spec-section v=2 -->
```

One version stamp, no body change. Frame dirties the file, then refuses to
migrate because the file is dirty.

**What is written before consent.** Everything below lands in a project whose
user has not agreed to the new layout, and stays there even if they click
Later: `.frame/bin/*` (12 files + `lang/`), `.frame/bin/codex`,
`.frame/docs/REFERENCE.md`, `.frame/specs/` (created by `startWatching`'s
`mkdirSync`) and `.frame/specs/.gitkeep`, `.frame/.gitignore`,
`.frame/config.json` (`settings.gitSharing`), `.claude/rules/frame.md`,
`.claude/settings.json` (hook entries), `.git/info/exclude`, and the root
`AGENTS.md`. `layoutMigration.js`'s own header promises the opposite:
*"'Later' leaves the project untouched and working."*

**The guard protects against a loss that cannot happen.** Moving a dirty
tracked file was tested directly — copy to `.frame/`, unlink the root, which
is what `execute()` does:

| Git state before | After the move | Lost |
| --- | --- | --- |
| ` M tasks.json` (worktree only) | ` D tasks.json` + `?? .frame/` | nothing — content is in `.frame/tasks.json`, the old version in `HEAD` |
| `MM tasks.json` (staged *and* worktree) | `MD tasks.json` + `?? .frame/` | nothing — the staged blob is still readable as `:tasks.json` |
| `UU tasks.json` (unmerged) | `UU tasks.json` + `?? .frame/` | **the merge**: `git merge --continue` fails with *"Committing is not possible because you have unmerged files"* |

Only unmerged paths are genuinely unsafe. For every other dirty state the
backup-and-verify contract already in `execute()` is the protection, and the
gate adds nothing but the deadlock above.

**The gate is also mis-scoped.** It treats a pure relocation and a content
rewrite as one decision:

| Artifact | Owner | What migration does | A decision? |
| --- | --- | --- | --- |
| `tasks.json` | Frame writes it, Frame manages it | move | no |
| `STRUCTURE.json` | Frame generates it | move | no |
| `QUICKSTART.md` | Frame's template | move | no |
| `PROJECT_NOTES.md` | Frame creates it, user/agents write in it | move | no |
| `tasks.json.bak` | Frame's own backup | into the backup folder | no |
| `AGENTS.md` | **user-owned**, customised | move **and rewrite** (`upgradeAgentsText`: seven line edits plus the symlink note) | **yes** |
| `CLAUDE.md` symlink | Frame planted it, but it is the user's AI setup | removed; a real `CLAUDE.md` is written back | **yes** |
| `GEMINI.md` symlink | same | removed, nothing written back | **yes** |
| a differing `.frame/` counterpart | both | root copy backed up, `.frame/` kept | **yes** |

Frame writes to `tasks.json` on every task edit already. Relocating it is
inside the contract the user accepted when they initialised Frame; rewriting
their `AGENTS.md` prose and changing what Claude and Gemini read is not.

**Consequences compound across projects.** The offer fires per project, on
open, and `deferred` (`migrationModal.js:34`) is an in-memory `Set` recorded
only when `canRun` is true (`:202`). So a user with five legacy projects gets:
five projects dirtied on open, five migrations refused, no deferral recorded
for any of them, and the modal reopening on every project switch — with the
Run button hidden. Not "five approvals": endless asking, zero migrations.

Migration also has no other entry point (`RUN_LAYOUT_MIGRATION` has exactly
one caller, the modal), so a user who closes it cannot reach it again without
restarting the app.

## Goal

A project's move into `.frame/` happens on its own; the user is asked only
about the things that are genuinely their call.

1. **Nothing is written to an unmigrated project before consent.** Read-only
   until the layout question is settled; every stager runs afterwards.
2. **Frame-owned files migrate without asking.** `tasks.json`,
   `STRUCTURE.json`, `QUICKSTART.md`, `PROJECT_NOTES.md` and Frame's `.bak`
   files move, are backed up and verified as they are today, and the user is
   told afterwards rather than asked beforehand.
3. **The modal asks about decisions only** — the `AGENTS.md` prose rewrite,
   the symlink removal and `CLAUDE.md` restoration, and `.frame/` conflicts.
   A project with none of those never sees a modal.
4. **The guard narrows to what is actually unsafe** — unmerged paths. A
   modified, staged or untracked meta file no longer defers anything.

## Constraints

- **`non-invasive-overlay`'s safety contract is untouched:** copy to
  `.frame/migration-backup/<name>`, copy to `.frame/<name>`, compare bytes,
  and only then unlink the root copy. A differing `.frame/` counterpart is
  still never overwritten. Nothing in this spec may weaken that.
- **The fingerprint stays narrow:** `config.files` plus at least one listed
  file at the root. A repo Frame never initialised is never a candidate, and
  a `CLAUDE.md → AGENTS.md` symlink remains proof of nothing.
- **Silent means silent, not invisible.** An automatic move is reported —
  receipt, activity log, and a surface the user can read after the fact —
  including where the backup is. Frame may move its own files without asking;
  it may not move them without saying so.
- **`AGENTS.md` is user-owned.** No content rewrite without an explicit yes,
  and the existing rule holds: a section Frame cannot prove is its own is
  never rewritten.
- **Read paths are unchanged.** `frameStore.resolvePath`'s legacy fallback is
  what keeps an unmigrated project working while it waits; this spec changes
  who may *write*, never what a reader resolves.
- **Migrated and fresh projects come out byte-identical.** New behaviour lives
  only in branches an unmigrated project reaches.
- **Migration stays idempotent and re-entrant:** after a run the fingerprint
  is gone and a second `plan()` finds nothing to do.
- **No `SPEC_SECTION_VERSION` bump** as part of this work — the standing rule
  from `spec-docs-delivery-invariant`.

## Success Criteria

- When a legacy project is opened and left alone, then `git status` is
  byte-for-byte what it was before the open — no tracked file modified, no
  untracked file created, `.frame/specs/` not created.
- When a legacy project is opened, then its Frame-owned meta files are moved
  into `.frame/`, each byte-verified against its backup, and the result is
  visible to the user without them having asked a question.
- When a legacy project's only remaining artifacts are Frame-owned, then no
  modal is shown at any point.
- When `AGENTS.md`, a Frame-planted symlink or a differing `.frame/`
  counterpart is in play, then the modal appears and names exactly those, and
  nothing in that set changes without a click.
- When a meta file is modified, staged, or both, then the migration proceeds
  and the user's uncommitted content is present in `.frame/` afterwards.
- When a meta file is in an unmerged (`U`) state, then nothing is moved, and
  the reason names the merge — not "commit or stash".
- When the user defers a decision, then reopening the project does not ask
  again, and the deferral survives an app restart.
- When migration has run, then the staged artifacts (`.frame/bin`, command
  templates, `REFERENCE.md`, the managed sections, hooks, sharing mode) are
  present exactly as an already-migrated project would have them.
- A project opened five times in a row produces the same tree as after the
  first open.

## Out of Scope

- **Frame's write surface outside `.frame/`** stays as `non-invasive-overlay`
  defined it: `.claude/rules/frame.md`, Frame's hook entries, the pre-commit
  block, the git exclude block. This spec changes *when* they are written, not
  *what* is written.
- **`tasksManager`'s corruption recovery** (a fresh `tasks.json` written over
  an unparseable one) — data recovery, not layout churn. Unchanged.
- **A workspace-wide "migrate all projects" surface.** Per-project remains the
  unit; a bulk UI is a separate question and only worth asking once the modal
  has stopped appearing for the no-decision case.
- **Restoring a `GEMINI.md` equivalent** of the `CLAUDE.md` block. Today's
  behaviour (symlink removed, nothing written back) is carried over as-is.

## Open Questions

- **How is an automatic move surfaced?** A receipt panel the user can open, a
  transient notice, or an activity-log entry alone. The constraint says it
  must be readable after the fact; the shape is undecided.
- **Are Frame-planted symlinks a decision or a move?** They are Frame's own
  files by origin, but removing them changes what Claude and Gemini read.
  Currently classed as a decision.
- **How long does a deferral last?** Forever for that project, until the next
  Frame version, or a fixed window. A permanent no also needs an entry point
  back in — Settings is the obvious candidate, and migration has none today.
- **Should an automatic move stage anything in git?** Leaving `?? .frame/`
  untracked in a `repo`-mode project means the user's next commit decides. An
  alternative is `git add`-ing the moved files so the rename is legible as a
  rename. Currently: touch the index for nothing.
