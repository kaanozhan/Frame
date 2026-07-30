# Embedded-Layout Migration — moving pre-overlay Frame projects into `.frame/`

> **What we're building:** the migration path for projects initialized by
> pre-overlay Frame versions — the ones carrying root-level `AGENTS.md`,
> `tasks.json`, `STRUCTURE.json`, `PROJECT_NOTES.md`, `QUICKSTART.md`, a
> `CLAUDE.md → AGENTS.md` symlink (possibly `GEMINI.md` too), and installed git
> hooks. After migration the project conforms to the non-invasive overlay
> layout: everything Frame-owned lives under `.frame/`, and whatever belonged
> to the user is restored to them.

> **Status: skeleton.** The problem and the coupling are settled; the decision
> forks below are deliberately open and get resolved when this spec is worked.

---

## Coupling

This spec ships **in the same release** as `non-invasive-overlay`. That spec
replaces the embedded behavior outright (single model, no toggle) and reads
only `.frame/` — without this migration path, every existing Frame project,
including Frame's own repo, opens as unusable. Division of labor:

- `non-invasive-overlay` **detects** the embedded layout and tells the user
  migration is needed (its Goal 5).
- this spec provides the **mover** the user is pointed at.

---

## Problem

The overlay spec's strictest rule is: never write outside `.frame/`. Migration
is the one legitimate exception — it must *delete* Frame-created files from the
project root to move them into `.frame/`. That exception has to be tightly
scoped, explicitly user-approved, and provably limited to files Frame itself
created.

The hard cases:

1. **The `CLAUDE.md` symlink.** Old init *consumed* the user's real
   `CLAUDE.md`: its content was merged into `AGENTS.md` under an
   `## Existing Instructions (from CLAUDE.md)` heading, the file deleted, and a
   symlink planted in its place. Migration should give the user their file
   back — the content is recoverable from the heading, but extracting it and
   restoring a root `CLAUDE.md` is a *write outside `.frame/`* on the user's
   behalf and must be exactly right. Same story for `GEMINI.md`.
2. **User edits inside Frame files.** Users were told to extend `AGENTS.md` and
   `PROJECT_NOTES.md`. Root files may contain user-authored content interleaved
   with Frame's template. Moving them into `.frame/` preserves that content,
   but the split into "global layer / project layer" (overlay Goal 3) means
   some of it belongs in the user-scoped store, not in `.frame/AGENTS.md`.
3. **Git history.** In projects where the root files were *committed*,
   migration creates deletions in the working tree. That is visible, reviewable
   change to a tracked repo — the user must see and approve it, and committing
   it stays manual.
4. **Installed hooks and merged config entries.** Pre-overlay Frame installed a
   pre-commit hook (`.git/hooks/` on vanilla projects, **appended to the
   tracked `.husky/pre-commit`** on husky projects) and merged spec-hint hook
   entries into the project's **`.claude/settings.json`**. Migration must
   remove Frame's entries from both tracked files — surgically, leaving the
   user's own hooks/settings intact.

---

## Open forks (to resolve when this spec is planned)

- **Move vs. leave-in-place vs. dual-read.** Default posture is *move with
  explicit approval*; is a read-only "leave in place, warn forever" mode worth
  keeping for repos where even Frame-file deletion is unacceptable?
- **Symlink restoration.** Restore the original `CLAUDE.md`/`GEMINI.md` from
  the merged heading, or leave restoration as a manual step with clear
  instructions?
- **One-shot vs. resumable.** If migration fails halfway (permissions, locked
  files), what state is the project left in, and can the run resume?
- **Where user additions to `AGENTS.md` land** — `.frame/AGENTS.md` (project
  layer) by default, with the user deciding what graduates to the global layer?

---

## Constraints (known already)

- **Explicit approval, itemized.** Migration never runs implicitly on open.
  The user sees the exact list of files to be moved/deleted/restored before
  anything happens.
- **Only Frame-created files.** The mover touches root files only when they
  match Frame's known artifact set; anything unrecognized is reported, not
  moved.
- **No data loss.** Every byte of the old root files survives — in `.frame/`,
  in the restored user files, or in a migration backup — until the user
  confirms the result.
- **No git writes.** Migration changes the working tree (with approval) but
  never stages, commits, or edits `.gitignore`; promotion stays manual, per the
  overlay spec.
- **Git posture is preserved, not decided.** Migration does not choose between
  "visible/shared" and "hidden/local" — the overlay's conditional exclude rule
  (overlay Goal 7) resolves it from what the project already was. Old root
  files tracked → migrated `.frame/` stays tracked and visible (no exclude is
  written for tracked paths). Old files untracked/local → `.frame/` lands
  untracked and the zero-touch exclude applies. A team that had committed its
  Frame files keeps sharing them after migration with no extra step.

---

## Success Criteria (draft)

1. A pre-overlay Frame project, after approved migration, passes the overlay
   spec's success criteria 1–5 (clean tree, `.frame/`-only artifacts).
2. A user-authored `CLAUDE.md` that old init consumed exists again at the root
   with its original content, or the user explicitly declined restoration.
3. Zero task/note/spec data lost: counts and content match before/after.
4. `git status` after migration shows only the expected deletions/moves the
   user approved — nothing surprising.

---

## Out of Scope

- Any change to the overlay architecture itself (that's `non-invasive-overlay`).
- Migrating into the future Frame-owned store — migration targets `.frame/`
  only; the store move is its own later spec.
- Auto-committing the migration result.
