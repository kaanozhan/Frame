---
keywords: .frame/bin, git tracking, gitignore, sharing mode, repo footprint, file classes, FRAME_TRACKED_DERIVED, parser scripts
related: non-invasive-overlay, migration-consent-scope, settings-by-scope
---

# Frame's own scripts stay out of the user's repo

## Problem

Installing Frame into an empty Next.js project produces a 31-file, 197.631-byte
working tree. **169.702 of those bytes — 86% — are `.frame/bin/`**: Frame's own
parser and hook scripts, byte-identical in every project that installs Frame.
The user's first "added Frame" commit is mostly a copy of Frame's source.

Copying the scripts into the project is correct and not in question. They are
run by Claude Code hooks, the git pre-commit hook and the agent itself — all
outside Frame's process, and a packaged build keeps its code inside `app.asar`
where no external process can reach it (`src/templates/bin/implement-launch.js:14`).
The problem is only that **git tracks them**.

This is recent, and it was not a deliberate design decision:

- `non-invasive-overlay` spec.md D6 classifies `bin/` as **runtime → ignored →
  never synced** (`.frame/specs/non-invasive-overlay/spec.md:152`).
- T15 of that same spec (`a8c1c8c`, 2026-08-23) reversed it during
  implementation: it deleted `bin/` from `.frame/.gitignore`, moved it from the
  `runtime` class to `derived`, and introduced `FRAME_TRACKED_DERIVED` to hold
  it tracked. The reasoning was written into a comment in
  `frameConstants.js:76-80`, not back into the spec.
- T15 was solving a real asymmetry: `.claude/settings.json` hook entries are
  tracked and point at `.frame/bin/*`, so a teammate cloning got hooks without
  scripts. It chose to fix that by tracking the scripts. The other direction —
  let the guard handle it — was available and is what already happens today.

Both rationales recorded for tracking have since lapsed. The "clone without
Frame" user does not exist while Frame ships only as the IDE (`package.json`
declares no `bin` entry). And the worktree argument is contradicted by the code:
both places that touch a worktree already assume `bin/` is absent and fall back
to an absolute path (`orchestrationManager.js:92`, `frameTemplates.js:1055-1064`).

Underneath sits a conflated question. The Git sharing setting asks the user
*"is `.frame/` committed with the repo?"* (`index.html:1282`) when the question
they are actually answering is *"is my Frame context — specs, tasks, notes —
shared with my team?"*. Answering yes to that should never mean shipping
Frame's machinery. Sharing mode decides what **may** be shared; it should not
decide what is **worth** sharing.

## Goal

`.frame/bin/` is never tracked by git, in either sharing mode, in new and
existing projects alike. The scripts keep being copied into every project on
open exactly as they are today; only git's view of them changes. A fresh
install in `repo` mode produces a commit of roughly 11 files / 28 KB, every one
of which says something about *that* project. No migration, warning surface or consent flow ships with
this: the change lands before any release carries the tracking, so there is no
installed base to repair.

The Git sharing setting's description is corrected to name what it actually
governs — the project's Frame context — rather than "the `.frame/` folder".

## Constraints

- **Copying is not in scope for change.** `copyParserScripts`
  (`structureBootstrap.js:41-112`) must keep writing all 13 parsers plus
  `lang/*.js` into `.frame/bin/` on every project open. The asar constraint is
  unchanged.
- **`local` mode must not regress.** It already hides `bin/` by excluding all of
  `.frame/` through `.git/info/exclude` (`gitExclude.js`). This change affects
  `repo` mode only.
- **The hook guard stays as it is.** `[ ! -f .frame/bin/x.js ] || exec node …`
  (`frameTemplates.js:869-882`) is the mechanism that makes a script-less
  checkout silent; its `||` form was chosen deliberately over `&&` and must not
  be touched.
- **Worktree fallbacks stay.** `orchestrationManager.js:92` and the pre-commit
  snippet's `--git-common-dir` fallback already handle a checkout without its
  own `bin/` and become the normal path rather than the exception.
- **`STRUCTURE.json` stays tracked.** It is the other entry in
  `FRAME_TRACKED_DERIVED` and is out of scope here; whatever shape the fix takes
  must leave its tracking untouched.
- **No installed base to repair.** Decided 2026-08-28, verified against the
  repo: `git tag --contains a8c1c8c` is empty and the latest release `v2.6.0`
  predates T15, so no shipped Frame version tracks `bin/`. The only affected
  checkouts are the author's own, handled by hand. This spec therefore adds no
  detection, no warning row and no migration step for already-committed
  `bin/` — and leaves the "Frame never runs `git rm`" principle
  (`gitSharing.js:15-20`) completely untouched.
- **Reverses a recorded decision.** T15 of `non-invasive-overlay` must be named
  as reversed, with its two lapsed rationales, wherever the new classification
  is recorded — not silently flipped.
- **Frame's own repository keeps its `.frame/bin/` tracked.** Decided
  2026-08-28: the 24 committed files stay as a worked example of what Frame
  writes into a project, and their diffs stay visible in this repo's history.
  The change is still verified here — the `bin/` line must appear in this
  repo's `.frame/.gitignore` managed block after the next open, while the
  already-tracked files keep showing up in `git status`. Accepted cost: a *new*
  script added to `.frame/bin/` later will be silently ignored here and needs
  `git add -f` (verified: a tracked file under an ignored directory still
  reports ` M`, an untracked sibling does not appear at all). The duplication
  with `scripts/` — 17 of the 24 files are byte-identical copies — is accepted
  for now.
- The managed `.frame/.gitignore` block regenerates on every project open
  (`ensureFrameGitignore` via `gitSharing.reconcile`, `frameProject.js:319`), so
  the new rule reaches existing projects without a migration. Tracked files do
  not untrack themselves.

## Success Criteria

- When Frame initializes a new project in `repo` mode, then `git status
  --porcelain -uall` lists no `.frame/bin/` entry, and the managed block of
  `.frame/.gitignore` contains `bin/`.
- When Frame opens an existing project, then `.frame/bin/` still contains all 13
  parser scripts plus `lang/*.js`, refreshed from the shipped copies.
- When a project is in `local` mode, then its behavior is byte-identical to
  today.
- When a teammate clones a `repo`-mode project that has no `.frame/bin/` and
  triggers an Edit, a prompt or a search, then no hook error is reported.
- When a pre-commit runs in a linked worktree without its own `.frame/bin/`,
  then the parser still resolves through the main worktree and writes that
  checkout's `STRUCTURE.json`.
- When the change ships, then `STRUCTURE.json` is still tracked in `repo` mode.
- When a project that already has `.frame/bin/` committed is opened, then
  Frame changes nothing about its tracking and shows no new warning — the files
  stay tracked and visible, exactly as they are today.
- When a user opens the Git sharing row in Project Settings, then its
  description names the project's Frame context as what the setting governs,
  and no longer frames the choice as being about the `.frame/` folder.
- When Frame's own project is opened after the change, then `bin/` appears in
  its `.frame/.gitignore` managed block, its 24 already-tracked `.frame/bin/`
  files are still tracked, and edits to them still show in `git status`.

## Out of Scope

- The two-axis rework of `FRAME_FILE_CLASSES` (authorship × lifetime) that would
  remove `FRAME_TRACKED_DERIVED` entirely — separate spec.
- `STRUCTURE.json`'s classification, its `derived` label and its staleness /
  coverage problems — separate spec.
- Moving `intent-map.json` out of `bin/`.
- Reclassifying the orchestration bus scripts (`dispatch.js`, `merge.js`,
  `report-done.js`, `status.js`).
- Whether the `STRUCTURE.json` pre-commit hook should exist at all, and its
  `git add` of an unstaged file.
- `.claude/rules/frame.md`'s tracking status.

