# Embedded-Layout Migration — pre-overlay projects migrate themselves on open

> **What we're building:** the automatic migration that moves a project
> initialized by pre-overlay Frame — root `AGENTS.md`, `tasks.json`,
> `STRUCTURE.json`, `PROJECT_NOTES.md`, `QUICKSTART.md`, a `CLAUDE.md →
> AGENTS.md` symlink, possibly `GEMINI.md` — into the `.frame/`-only overlay
> layout, on project open, without asking. Whatever the old init consumed from
> the user is handed back. Whatever Frame created is removed.

> **Supersedes the 2026-07-27 skeleton of this spec.** That draft was written
> before `non-invasive-overlay` (#8) and `project-settings` (#9) shipped. It
> assumed a manual, itemized, user-approved mover and left four forks open;
> the shipped code has since answered two of them and invalidated three of its
> constraints. The reversal of its central rule — *"Migration never runs
> implicitly on open"* → D1 below — is deliberate and argued, not an
> oversight.

---

## Problem

### 1. A legacy project doesn't just fail to work — it misinforms the agent

This is the finding that sets the urgency, and it was not visible when the
skeleton was written.

`src/shared/contextPreamble.js:104` emits, for every Claude Code launch where
the root scan found a `CLAUDE.md`:

> This repository's `CLAUDE.md` is yours to read as usual — Frame has not
> modified it.

In a legacy project that file is a symlink Frame's own init planted, pointing
at an `AGENTS.md` Frame generated. So the preamble tells the agent a
Frame-authored file is the user's, and the agent dutifully reads it — and what
it reads describes the **pre-overlay layout**: meta files at the project root,
the old spec protocol, `tasks.json` in a place nothing writes any more.

The launch preamble simultaneously describes the current layout. The agent
therefore receives two contradictory instruction sets, one of which lies about
its own provenance, on every single session in that project.

This is what rules out the "leave the old files in place, warn forever" posture
the skeleton kept open as a fork. Leaving them is not the conservative option;
it is the broken one.

### 2. Frame's own surfaces are empty on these projects

Every meta read goes through `frameStore`, which resolves `.frame/`-relative
paths (`FRAME_META_FILES`, `src/shared/frameConstants.js:51`). A legacy project
has its tasks, structure and notes at the root, so Tasks, Structure Map and
Overview come up empty while the data sits untouched a directory away.

### 3. The shipped answer is a banner pointing at a mover that does not exist

`instructionDiscovery.detectLegacyLayout` (`src/main/instructionDiscovery.js:97`)
fires `IPC.LEGACY_LAYOUT_DETECTED`, and `healthNotice.js:29` renders:

> …Frame now reads only .frame/ — **migrate the project** to see its tasks,
> specs and notes again.

There is nothing to click and no command to run. The overlay spec's outcome
recorded this as intended "fail loud" pending this spec; it has been the
shipped state since #8.

### 4. Dual layout is the normal case, not an edge case

The skeleton modelled a legacy project as *root files only*. That is wrong:
pre-overlay init already created `.frame/` — `config.json`, `docs/REFERENCE.md`,
`specs/`, `bin/`. Every legacy project is **both** layouts at once.

Two consequences, both good for us:

- Migration does not introduce a new directory into the user's repo. It adds
  four or five files to a directory the repo already has and already tracks (or
  already ignores). The additions carry no new git decision.
- But `.frame/` may already hold a counterpart to what we are moving — specs
  written after the upgrade, a `config.json` newer than the root files. A blind
  move would overwrite live data with stale data.

### 5. What the migration needs to read is being erased

Two inputs exist only because nothing has overwritten them yet:

- **The merge heading.** Old init consumed the user's `CLAUDE.md`/`GEMINI.md`/
  pre-existing `AGENTS.md` into the generated `AGENTS.md` under
  `## Existing Instructions (from <label>)`, blocks separated by `\n\n---\n\n`.
  The code that produced it was deleted in `1202ab2`; the string now survives
  only in git history and in users' files. Migration has to carry it as a
  literal.
- **`config.json.files`.** The legacy config records exactly which root files
  Frame created *for that project*:

  ```json
  "files": { "agents": "AGENTS.md", "claudeSymlink": "CLAUDE.md",
             "structure": "STRUCTURE.json", "notes": "PROJECT_NOTES.md",
             "tasks": "tasks.json", "quickstart": "QUICKSTART.md" }
  ```

  This is a per-project manifest of Frame's own artifacts — a far stronger
  basis for "touch only what Frame created" than matching well-known names. It
  is also the block migration is about to rewrite, so it must be read first.

### 6. Frame's own repository is the reference case

Root `AGENTS.md` (tracked), `CLAUDE.md → AGENTS.md` (tracked symlink),
`PROJECT_NOTES.md` (~80 KB, tracked), `QUICKSTART.md`, `STRUCTURE.json`,
`tasks.json` (~300 KB, tracked) — alongside a tracked `.frame/` holding
`config.json`, `specs/`, `docs/`, `bin/`, `index/`, `runtime/`. Every hard case
in this spec is present in it simultaneously.

### 7. The bundled sample project ships the legacy layout

`src/templates/sample-project/` contains root `AGENTS.md`, `CLAUDE.md`,
`GEMINI.md`, `PROJECT_NOTES.md`, `STRUCTURE.json`, `tasks.json` plus
`.frame/specs/`. `detectLegacyLayout` matches it, so the first project a new
user ever opens announces that it needs migrating. That is a template bug, not
a migration case (see D11).

---

## Goals

1. A pre-overlay project opens, migrates itself, and is fully usable in the
   same open — no prompt, no command, no documented procedure.
2. After migration the project satisfies the overlay spec's success criteria:
   every Frame artifact under `.frame/`, nothing Frame-authored at the root.
3. Instruction files the old init consumed are returned to the user at the
   root, with their original content.
4. No Frame data is lost, and the pre-migration state is recoverable from disk.
5. The project's git sharing posture after migration is the one it already had.
6. The user can tell, without asking, what changed in their working tree and
   why.

## Non-goals

- Changing the overlay architecture itself (`non-invasive-overlay`).
- Staging, committing, or pushing anything, ever.
- Migrating into the future Frame-owned store — the target is `.frame/`.
- Re-deriving or offering the sharing choice (`project-settings` owns it).
- A rollback UI. Recovery is the backup directory plus the user's own git.

---

## Decisions

### D1 — Migration runs automatically, with no prompt

Reverses the skeleton's *"Explicit approval, itemized. Migration never runs
implicitly on open."*

The reasoning that changed:

- **The status quo is not neutral.** Per Problem 1, an unmigrated project feeds
  the agent contradictory instructions every session. An approval gate makes a
  broken state the default for anyone who dismisses the dialog.
- **The additions carry no git decision.** Per Problem 4, `.frame/` already
  exists and already has a tracked-or-ignored posture. Migration adds files to
  it; it does not ask the repo anything new.
- **The deletions are Frame's own dead files.** Every path removed is one this
  same tool created, now read by nothing.
- **Frame is a tool whose agents author diffs the user reviews and commits.**
  A seven-deletion, five-addition, self-describing atomic change is this
  product's ordinary output, not a foreign intrusion.
- **A deferred-cleanup state costs more than it saves.** "Migrate the data now,
  delete the root files when the user approves" means two code paths, a
  persisted half-migrated state, a cleanup surface, and a project that can sit
  in Problem 1's broken condition indefinitely — permanent complexity bought
  for a transient population.

The safety this buys back is D4 (defer on uncommitted work) and D9 (a backup),
not a dialog.

### D1a — A startup sweep over every known project, not a per-open trigger

Frame is not a one-project tool. `~/.frame/workspaces.json` registers a list —
`workspace.getProjects()` — while the renderer holds a single
`currentProjectPath` (`src/renderer/state.js:11`) and fires
`CHECK_IS_FRAME_PROJECT` only when the user switches to a project
(`state.js:100`). Hanging migration off that trigger alone would migrate a
user's five legacy projects one at a time, across five different sessions, with
a separate notice each time — clunky, and it leaves every project the user has
not happened to open sitting in Problem 1's broken state.

So the trigger is a **sweep at startup**: after `workspace.init`, every
registered project is checked and migrated. The per-open path stays as the
**fallback** for projects added or re-added later; migration is idempotent and
detection is cheap, so the two cannot conflict — a per-project in-flight guard
keeps the lazy path from re-entering a project the sweep is still working on.

The sweep runs **asynchronously, after the window is up**, and never blocks
startup. A failure in one project is isolated and does not stop the rest.

**Projects Frame does not know about are not migrated, and that is correct.**
`workspaces.json` *is* the definition of the set Frame is responsible for, and
the only way out of it is the user removing a project — an explicit "stop
tracking this". Scanning the filesystem for stray `.frame/` directories was
rejected: it is slow, it has no defensible starting root, and it would have
Frame writing to repositories it was never pointed at. An old project migrates
the moment the user adds it back.

### D2 — Move, not copy; there is no partially-migrated state

Migration either completes for a project or leaves it untouched and retries on
the next open. It never persists a "moved but not cleaned up" flag. Within a
run the order is copy-verify-then-delete, so an interruption leaves duplicates
that the next run's idempotent copy step reconciles — never a hole.

### D3 — `.frame/` always wins; a losing legacy file goes to the backup

For each artifact, if the `.frame/` counterpart already exists and differs from
the root file, the `.frame/` copy is kept and the root file is written to the
backup instead of moved. Equal content is a plain delete. This is what makes
Problem 4's dual layout safe: post-upgrade work is never overwritten by a stale
root file.

### D4 — Uncommitted modifications to a legacy file defer the whole migration

Not because deletion destroys work — migration *moves* content, so even a dirty
file arrives intact in `.frame/` and in the backup. What this guards against is
subtler: the user is mid-edit on root `PROJECT_NOTES.md`, migration relocates
it, and now `git diff` shows a deletion while their unfinished work sits in an
untracked file at a path they did not choose. Worse, if D3 fires — a differing
`.frame/` counterpart already exists — that edit is demoted to the backup:
preserved, but easy to miss.

So: if `git status` reports any legacy artifact as modified or staged,
migration does not run this open and retries on the next. A tracked-but-clean
file is safe; git holds its content whatever we do.

**Non-git projects get no equivalent guard, deliberately.** There is no diff to
be confused by and no "uncommitted" state to be mid-way through, so the failure
mode above cannot occur; D9 is the recovery path. The only signal available
would be mtime, and an mtime guard has a worse failure than the one it
prevents: a project whose notes are edited regularly would defer on every open
and stay permanently in Problem 1's broken state. The asymmetry is the correct
outcome, not a gap.

### D5 — `config.json.files` is the authoritative artifact list

Migration reads the legacy `files` block before rewriting the config, and
treats it as the definition of "files Frame created here". `LEGACY_ROOT_FILES`
(`src/shared/frameConstants.js:30`) is the fallback when the block is absent or
malformed. Anything at the root not named by either is reported in the receipt
and left alone — the skeleton's "only Frame-created files" constraint, now with
a per-project source of truth instead of a guess.

### D6 — Consumed instruction files are restored; duplicated ones are not

Verified against `main`'s init:

| Old init did | Migration does |
| --- | --- |
| root `CLAUDE.md` → read, `unlink`, symlink planted | restore from the `(from CLAUDE.md)` block; if absent, just remove the symlink |
| root `GEMINI.md` → read, `unlink`, symlink planted | same, from `(from GEMINI.md)` |
| root `AGENTS.md`, only when not already a Frame project → read, `unlink` | restore from the `(from AGENTS.md)` block |
| `.claude/CLAUDE.md` → read, **not unlinked** | nothing — the file is still on disk; do not recreate it |

Restoration writes outside `.frame/`. That is the overlay rule's one sanctioned
exception, and it is narrow: it returns bytes this tool took, to the path it
took them from, only when the file is absent. An existing user file at the
target is never overwritten — the extracted content goes to the backup and the
receipt says so.

### D7 — Git posture is preserved, not decided

Migration calls `gitSharing.resolveMode` and does not reimplement it.
`declaredMode` is null on every legacy config (the block predates
`settings.gitSharing`), so derivation always runs on first migration and
`isFrameTracked` — `git ls-files --cached -- .frame/` — decides: a repo that
committed `.frame/specs/` derives `repo`, and the project keeps sharing exactly
as before.

`resolveMode` persists the derived value. Project Settings will therefore show
a declared mode the user never picked. This is intended: it is a recording of
the posture the project already had, not a new choice, and Project Settings is
where anyone who wants a different one changes it.

### D8 — One receipt for the whole sweep; it reports, it does not advise

A dismissible notification after the fact. No modal before, and **one message
per sweep, not one per project** — a notice for each migrated project would be
exactly the clutter D1a's sweep exists to avoid.

It names the projects migrated, and names any project whose migration
**failed** — with D1 silent and D10's banner gone, a user who later opens a
broken project has no other way to learn why it is empty. It says nothing about
projects **deferred** by D4 — *in the sweep*. That state is normal, resolves
itself the moment the user commits, and reporting it every startup produces a
recurring message with no action attached. A deferral the user runs into in the
foreground is a different situation and is explained there (D13).

It renders on `healthNotice.js`, extended with a neutral `info` kind (an
information icon and `role="status"` instead of `⚠` / `role="alert"` — a
completed migration is not a degraded state) and support for a single optional
action. A new surface was rejected: `notify.js` auto-dismisses in 2–4 seconds
and takes no action button, and a bespoke popover would re-run the lifecycle
that `healthNotice` already owns — against the consolidation `notify.js`'s own
header argues for. Per-project detail lives in the activity log (D12).

It states what moved, what was restored, and where the backup is. It does not
suggest committing, does not mention switching sharing modes, and does not link
to Project Settings. Its job is to answer *"why does my working tree have seven
deletions?"* before the user asks it — attribution, not instruction. When, how,
and whether to commit is the user's repo discipline, and Frame has no standing
in it.

**The git sentence keys off the deleted files' tracked state, not the sharing
mode.** These are different questions and they diverge: a user who gitignored
`.frame/` themselves but committed the root files derives `local` while the
deletions are plainly visible. So the condition is `git ls-files --cached` over
the artifacts actually removed:

- none tracked → the receipt says nothing about git;
- some tracked → it names the counts and states that Frame staged nothing.

Where the change is visible, the receipt's action opens Frame's existing diff
surface (`src/renderer/gitChangesPanel.js`, `diffViewer.js`) so the user can
look at it. Showing the diff is not advice.

### D9 — One backup directory, never overwritten, never pruned

Everything removed is byte-copied to `.frame/migration-backup/` first,
preserving relative paths. It is the recovery path for untracked projects,
which have no git to fall back on.

**One directory, not one per run.** Migration fires once per project — the
moment it completes, `detectLegacyLayout` is false forever — so there is no
accumulating pile to organize by timestamp. A second run only happens after a
failed one, and since the backup is written whole at step 3 before anything
moves, the second run's contents are a subset of the first's. Writing into the
same directory and skipping paths already there yields exactly the union, in
one place the user can understand.

**Nothing is pruned, ever.** The worst realistic case is this repository at
664 KB (`tasks.json` 304 K, `STRUCTURE.json` 262 K, `PROJECT_NOTES.md` 78 K,
`AGENTS.md` 4.2 K, `QUICKSTART.md` 1.8 K); a typical project is 50–100 KB. A
retention timer would make this the one place Frame deletes user data on its
own schedule, to reclaim a one-time cost that never grows — the exact trade
this spec exists to refuse.

`migration-backup/` must be added to the managed block of `.frame/.gitignore`
(`gitSharing.writeFrameGitignore`) — the current block lists `runtime/`,
`index/`, `implement-permissions.json`, `worktrees/`, `orchestration/`, `bin/`,
`*.bak`, `*.tmp`, `*.corrupt-*`, so without this a `repo`-mode project would
commit a duplicate of every file it just deleted.

### D10 — The legacy banner is removed

`IPC.LEGACY_LAYOUT_DETECTED` and its `healthNotice.js` branch are deleted with
this spec. A condition Frame resolves by itself does not get a warning; the
receipt replaces it. `instructionDiscovery.detectLegacyLayout` survives as
migration's trigger.

### D11 — The sample project is fixed at the template, not migrated

`src/templates/sample-project/` is rewritten to the overlay layout so it never
trips detection. Migrating a legacy tree that Frame itself ships on first open
would be an absurd round trip, and the template's root `CLAUDE.md`/`GEMINI.md`
are real files rather than the symlinks migration expects.

### D12 — Rich local trace, and a telemetry event only for failure

D1 makes migration automatic and D10 removes the banner, so a run that breaks
halfway is invisible: the user sees Frame not working and has nothing to point
at. Observability is the compensation for that silence — and only the failure
path buys anything.

- **Every step goes to `activityLog.record()`** (`src/main/activityLog.js`):
  detection, deferral and its reason, each artifact's disposition (moved /
  deleted-as-identical / backed-up-as-conflicted), restorations, the derived
  sharing mode, and the outcome. Local JSONL, per project, no privacy surface,
  no registry cost. This is the forensic record when a user reports something
  odd.
- **One telemetry event, on failure only** — a migration that aborts, with the
  failing step and artifact counts. Registered in `telemetryEvents.js` with its
  PRIVACY.md row in the same change, per the rule `project-settings` T04 set.
- **No success event.** It would measure how many pre-overlay users exist,
  which is already known, and a one-time transition does not deserve a
  permanent registry entry and privacy line.

### D13 — The foreground path shows a modal; the sweep never does

The sweep is silent because the user is not waiting on it. The lazy path is the
opposite case, and the distinction needs no stored state to detect: **if the
sweep had succeeded, the project would no longer be legacy** — so the lazy path
firing at all means the project was either added after the sweep or failed or
deferred during it. Either way the user has just selected that project and is
waiting for it, which is exactly when blocking UI is earned.

So: selecting a project that still needs migrating opens a modal that runs the
migration in the foreground, reporting progress artifact by artifact — the
shape `plan()` already returns, so no new data is needed for it. It reuses the
`settings-modal` class vocabulary rather than inventing a dialog.

Its three end states:

- **Migrated** — the modal closes and the project opens. No receipt; the user
  watched it happen.
- **Deferred (D4)** — named files and what to do: *"Frame can't migrate while
  `PROJECT_NOTES.md` has uncommitted changes. Commit or stash them, then
  reopen the project."* This is the one place a deferral is explained: the
  user is blocked on this project right now, and there is a concrete action.
- **Failed** — the real error, then the sentence that stops the panic —
  *"Nothing was lost: a copy of everything removed is in
  `.frame/migration-backup/`"* — and **Try again**.

**No "remove the project and re-add it".** Removing only drops the entry from
`workspaces.json`; re-adding re-runs the same code against the same files and
fails in the same place. None of the plausible causes — permission denied, a
locked file, an unremovable symlink, a full disk — travel through the registry,
so the advice would cost the user a round trip that cannot work, while the word
"remove" reads as data loss.

---

## Behaviour

### The sweep (D1a)

```
app start → window up → initModulesWithWindow
  for each project in workspace.getProjects():     async, non-blocking
      path missing on disk?  → skip
      already in flight?     → skip
      run the per-project flow below, failures isolated
  one receipt for the whole pass                   (D8)

later: user adds or switches to a project
  → modal opens, same per-project flow in the foreground   (D13)
  → guarded against a sweep still in progress
       migrated → modal closes, project opens, no receipt
       deferred → names the dirty files and what to do
       failed   → the error, the backup path, [Try again]
```

### Per project

```
detectLegacyLayout(projectPath)  →  false: nothing happens
                                 →  true:
  1. read legacy config.json.files            (D5, before any write)
  2. any legacy artifact dirty in git?        (D4)  → defer, retry next open
  3. write .frame/migration-backup/           (D9, skip paths already there)
  4. for each artifact:
       .frame/ counterpart absent   → move
       present and identical        → delete root
       present and different        → keep .frame/, root copy to backup  (D3)
  5. restore consumed instruction files       (D6)
  6. remove Frame-planted symlinks
  7. rewrite .frame/config.json (drop the files block)
  8. gitSharing.resolveMode + writeFrameGitignore  (D7, D9)
  9. receipt                                  (D8)
```

Steps 3–7 are the atomic unit: a failure inside them aborts the run, leaves the
backup, and the next open retries from a state the idempotent copy step can
reconcile (D2).

### What the user sees afterwards

| root artifacts were | `.frame/` was | receipt mentions git | working tree |
| --- | --- | --- | --- |
| untracked | untracked (`local`) | no | unchanged as far as git is concerned |
| untracked | tracked (`repo`) | no | new files under `.frame/` |
| tracked | tracked (`repo`) | yes — the common case | N deletions + additions under `.frame/` |
| tracked | untracked (user-gitignored) | yes | N deletions; `.frame/` invisible |
| — | not a git repo | no | — |

### Receipt copy (shape, not final wording)

> **2 projects migrated to the current Frame layout** — Frame, comeety. Their
> tasks, structure and notes now live in `.frame/`; a copy of everything
> removed is in each project's `.frame/migration-backup/`.
>
> *(only when some removed artifact was tracked)* Frame has six deletions in
> its working tree — Frame staged nothing. **[Show changes]**
>
> *(only on failure)* **comeety could not be migrated.**

Single-project form — the lazy path, or a sweep that found one — names the
project and drops the count.

---

## Acceptance criteria

1. **Frame's own repository** (Problem 6) opens, migrates in that open, and
   afterwards: no Frame artifact at the root, `.frame/tasks.json` holds the
   ~300 KB task set intact, `.frame/PROJECT_NOTES.md` holds the ~80 KB notes,
   the pre-existing `.frame/specs/` is byte-identical to before, and
   `git status` shows exactly the six tracked deletions plus the `.frame/`
   additions — nothing else.
2. A project whose `.frame/specs/` was committed derives `repo` and is still
   sharing `.frame/` after migration, with no exclude entry written.
3. A project whose root files were never committed migrates with `git status`
   unchanged, and its receipt says nothing about git.
4. A user's `CLAUDE.md` consumed by old init exists again at the root with its
   original content; a project that never had one ends up with no root
   `CLAUDE.md` at all.
5. `.claude/CLAUDE.md`, present before migration, is present and unmodified
   after — and is not recreated if it was absent.
6. A project with an uncommitted edit to root `PROJECT_NOTES.md` is not
   migrated, keeps the edit, and migrates on the next open once it is clean.
7. Dual layout: where both a root file and a differing `.frame/` counterpart
   exist, the `.frame/` version is the one that survives and the root version
   is in the backup.
8. Killing the app mid-migration leaves no artifact unreachable from either
   `.frame/` or the backup; the next open completes the migration, writes into
   the same `.frame/migration-backup/` without overwriting what is there, and
   emits the failure telemetry event for the aborted run.
9. `.frame/migration-backup/` is never tracked, in either sharing mode, and is
   never deleted by Frame.
10. No project — including the bundled sample — shows a legacy-layout warning
    anywhere in the UI.
11. A migrated project launches an agent whose instructions describe only the
    current layout; no root file claims to be user-authored when Frame wrote it.
12. A migration deferred by D4, one that hits a D3 conflict, and one that fails
    mid-run are each reconstructable in full from the activity log alone.
13. A workspace holding several legacy projects migrates all of them in one
    startup, produces exactly one receipt, and is not slowed at launch — the
    window appears before the sweep finishes.
14. A project whose migration fails is named in the receipt; a project deferred
    by D4 is not mentioned anywhere in the UI.
15. Opening a project while the sweep is still working on it does not start a
    second migration of that project.
16. A project registered in `workspaces.json` whose path no longer exists on
    disk is skipped without failing the sweep.
17. Selecting a project that still needs migrating opens the modal, which
    reports progress per artifact and closes into the opened project on
    success — while the startup sweep shows no modal at all.
18. A project the modal cannot migrate shows the underlying error, states that
    a copy of everything removed is in `.frame/migration-backup/`, and offers
    a retry that re-runs against the current disk state.
19. A project deferred by D4 and then selected by the user names the files
    holding it up and what to do about them — the same project during a sweep
    stays silent.

---

## Resolved during specification

Three questions were left open in drafting and closed on 2026-07-31:

- **Backup retention** → D9. Never pruned, single directory. Migration runs
  once per project, so the cost is one-time and bounded (664 KB at this
  repository's size); a retention timer would buy nothing and would make Frame
  delete user data on its own schedule.
- **Telemetry** → D12. Failure event only, plus a full local trace in the
  activity log. A success event measures a population already known.
- **Non-git projects and D4** → D4. The asymmetry is deliberate: the failure
  mode D4 guards against needs a git diff to exist, and the only alternative
  signal — mtime — would strand actively-edited projects in the broken state
  permanently.

Three more were opened and closed at plan time, and are recorded here because
they changed the spec rather than only the plan:

- **Trigger scope** → D1a. A per-open trigger would have migrated a multi-
  project workspace one project per session. Replaced by a startup sweep over
  `workspace.getProjects()`, with the per-open path kept as the fallback.
- **Projects outside the registry** → D1a. Not migrated, and no filesystem
  scan. They migrate when the user adds them back.
- **Receipt scope** → D8. One receipt per sweep; failures named, D4 deferrals
  not.
