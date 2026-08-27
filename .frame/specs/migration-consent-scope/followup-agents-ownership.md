---
keywords: AGENTS.md ownership, consumed instructions, init merge, migration restore, .claude/rules, duplicate context, dangling import, CLAUDE.md, GEMINI.md
related: non-invasive-overlay, migration-consent-scope, spec-docs-delivery-invariant
status: findings — not scheduled
---

# Followup — the user's instructions still live inside Frame's file

> **What this is.** Findings gathered while verifying `migration-consent-scope`,
> written up in spec shape but deliberately **not** registered as a spec: a
> teammate is working inside `.frame/` and a new spec folder would collide with
> them. It rides with the migration fix instead.
>
> **Read this before changing anything under `.frame/` that touches
> `AGENTS.md`, the `.claude/` write surface, init or the layout migration.**
> Every measurement below is dated and reproducible; none of it is a
> hypothesis. The two Open Questions at the end are unresolved on purpose.

## Problem

Frame's pre-overlay init did not add its instructions to the user's files. It
did the reverse: it read the user's instruction files, **deleted three of
them**, and pasted their contents into a file it wrote itself. From `ee280c8`
("smart MD file merge on Frame init"):

| Source | What init did |
| --- | --- |
| `CLAUDE.md` (root) | read → `unlinkSync` → replaced by a symlink to `AGENTS.md` |
| `AGENTS.md` (root) | read → `unlinkSync` → replaced by Frame's template, user text appended below |
| `GEMINI.md` (root) | read → appended → `unlinkSync` → replaced by a symlink |
| `.claude/CLAUDE.md` | read → **left in place** |

Each block landed under a marked heading — `## Existing Instructions (from
<label>)` — so what belongs to whom is still legible in the file today. What
came out is a Frame-owned file carrying the user's writing as a subsection,
where before there were separate files with separate owners.

`non-invasive-overlay` already established the rule this broke: *"a user's root
file is never read, moved or replaced."* `migration-consent-scope` corrected
part of it — a consumed `CLAUDE.md` is written back at the root — but stopped
there. The other three are still inside `.frame/AGENTS.md`, and the user's own
`AGENTS.md` is the worst case: it was deleted and has never been given back.

**Today's init is already clean, and that bounds the problem.** Measured on
2026-08-27 by running `runProjectInit` against a project carrying all four
files:

| File the user already had | What today's init did |
| --- | --- |
| `AGENTS.md` (root) | untouched |
| `CLAUDE.md` (root) | untouched |
| `GEMINI.md` (root) | untouched |
| `.claude/CLAUDE.md` | untouched |

`.frame/AGENTS.md` was written with **no `Existing Instructions` heading and
none of the user's text**. So the only source of a mixed `.frame/AGENTS.md` is
a project initialised before `non-invasive-overlay`. Once migration un-merges
those, no code path produces a mixed file again — which is what makes the
prose-rewrite question finite rather than permanent.

**Four live consequences, measured on 2026-08-27 against Claude Code 2.1.247
and against two of the three projects Frame currently has in the field:**

- **The user's instructions are delivered twice, and it is measurable.**
  `.claude/rules/frame.md` is a copy of the whole `.frame/AGENTS.md`, user
  blocks included, and every path below is loaded independently by Claude
  Code. Measured in `comeety`, a real migrated project, on 2026-08-27:

  | | chars |
  | --- | --- |
  | `.claude/CLAUDE.md` (the user's project memory) | 8,771 |
  | `.claude/rules/frame.md` | 14,397 |
  | the user's own seven files in `.claude/rules/` | 34,413 |
  | **total instruction context per session** | **57,581** |

  Of `frame.md`'s 14,397 characters, **8,596 are a verbatim copy of
  `.claude/CLAUDE.md`** — a file the agent already has. That is **14% of the
  project's entire instruction context, duplicated in every session**.
  Frame's own content is roughly 5,800 characters; what makes its file the
  largest in a directory of the user's own rule files is the copy.

- **The copy is a frozen snapshot with nothing to keep it in step.** In
  `comeety` the two are still byte-identical only because `.claude/CLAUDE.md`
  has not been edited since init. Nothing re-syncs them, so the first edit
  turns exact duplication into two contradicting versions of the same
  document, both in context at once.

- **`.claude/CLAUDE.md` was never removed**, so its content sits in its own
  live file *and* inside `.frame/AGENTS.md`. That duplication predates
  migration entirely; it has been there since init.

- **A pointer Frame did not plant is left dangling.**
  `isFramePlantedSymlink()` recognises only a symlink, so a *real*
  `CLAUDE.md` whose body imports the root `AGENTS.md` (`@AGENTS.md` — a
  documented Claude Code convention a user may well have written themselves)
  is correctly left alone, while its target moves into `.frame/`. Measured on
  a fixture: the file survives untouched, `AGENTS.md` is gone from the root,
  and the receipt's review list is empty. End to end, Claude Code reports
  *"one instruction file failed to load: `CLAUDE.md:5` imports `@AGENTS.md`,
  but no `AGENTS.md` exists"* — the user's own instructions stop arriving and
  Frame never said a word.

There is also a standing cost the merge hides: because `.frame/AGENTS.md`
carries user prose, every rewrite of it is a decision that has to be asked
about (`migration-consent-scope` C4) — which is why a project whose AGENTS.md
is nothing but Frame's own template still gets a modal. Confirmed in the
field: `symfia-qr-generator` carries no `Existing Instructions` block at all
— its `AGENTS.md` is entirely Frame's template — and it is still asked.

What the delivery paths actually load, measured in isolated directories:

| File | Read by Claude Code 2.1.247 |
| --- | --- |
| `CLAUDE.md` (root) | yes |
| `.claude/CLAUDE.md` | yes |
| `.claude/rules/frame.md` | yes |
| `AGENTS.md` (root) | **no** |

## Goal

Migration gives back what init took, so that ownership matches the file
boundary again.

1. **`.frame/AGENTS.md` carries only Frame's text.** Every `## Existing
   Instructions (from …)` block is removed from it.
2. **Each block returns to the path it came from** — `AGENTS.md`,
   `CLAUDE.md`, `GEMINI.md` at the root, `.claude/CLAUDE.md` in its folder —
   as the user's own file, never overwriting anything already there.
3. **Claude Code stops receiving the same instructions twice.**
4. **A file that is entirely Frame's own is Frame's to update**, without
   asking, because after the split it provably carries nothing else.
5. **A pointer the move breaks is reported.** Frame does not repair a file it
   did not write, but it may not break one in silence either.

## Constraints

- **`non-invasive-overlay`'s ownership rule is the reason for this work, not an
  obstacle to it:** a user's root file is never read, moved or replaced.
  Restoring is the correction — and it must never overwrite a file that
  already exists at the destination. The existing behaviour is the pattern:
  report it on the review list and leave both versions alone.
- **`migration-consent-scope`'s safety contract is untouched:** backup, copy,
  byte-compare, then unlink. Nothing here may weaken it, and every restored
  file must be reconstructible from `.frame/migration-backup/`.
- **Two recorded decisions are deliberately reversed**, and each must be named
  in `PROJECT_NOTES.md` with its reason:
  - `migration-consent-scope` C4 — *"AGENTS.md is user-owned. No content
    rewrite without an explicit yes."* It holds while the file is mixed; it
    stops applying once the file is provably Frame's alone.
  - `migration-consent-scope` Out of Scope — *"Restoring a `GEMINI.md`
    equivalent … today's behaviour is carried over as-is."*
- **Frame does not write into the user's restored files.** Not an `@`-import,
  not a pointer, not a header. Writing instructions into a user's file is the
  mistake being corrected. The same rule binds the dangling-pointer case: a
  `CLAUDE.md` Frame did not plant is reported, never repaired.
- **Claude Code does not read a root `AGENTS.md`** (measured). Restoring the
  user's `AGENTS.md` there returns the project to its pre-Frame state, but it
  removes a visibility that works today — so it must be reported, not done
  quietly.
- **No `SPEC_SECTION_VERSION` bump** — the standing rule from
  `spec-docs-delivery-invariant`.
- **Migrated and fresh projects come out byte-identical.** New behaviour lives
  only in branches a project carrying consumed blocks can reach.
- **Idempotent:** once the blocks are out, a second run finds nothing to do.

## Success Criteria

- When a project whose `AGENTS.md` carries consumed blocks is migrated, then
  `.frame/AGENTS.md` contains no `## Existing Instructions (from …)` heading.
- When a block names an origin path that is free, then the block's content is
  written there verbatim and the file is the user's own.
- When a block names an origin path that is already occupied, then nothing is
  written, both versions survive, and the receipt names the file.
- When a migrated project is opened by Claude Code, then no instruction text
  reaches it from more than one path — checked against `comeety`, whose
  instruction context must lose roughly 8,600 characters of duplication
  without losing a line of meaning.
- When a project's `AGENTS.md` is entirely Frame's own template, then its
  prose is brought up to date without a modal appearing.
- When the user's `AGENTS.md` is restored to the root, then the receipt says
  Claude Code does not read that path and what to do about it.
- When a file Frame did not plant points at a meta file the migration moved,
  then that file is left exactly as it is and the receipt names it, the line
  and the broken target.
- When a project carries a user-owned root `AGENTS.md` — whether it was
  already there at init or migration just restored it — then Frame reports
  that Claude Code does not read that path, and writes nothing into it.
- When a project has already migrated under the current build, then reopening
  it moves nothing and shows nothing.
- When migration runs twice, then the second run finds no blocks to restore.

## Out of Scope

- **The `.claude/rules/frame.md` delivery mechanism** — copy versus
  `@`-import was settled by `non-invasive-overlay`.
- **Adding a `GEMINI.md` equivalent of Frame's instructions.** This spec gives
  the user's `GEMINI.md` back; it does not make Frame's own text reach Gemini.
- **`.claude/settings.json` and the hook entries** — `non-invasive-overlay`
  defined that write surface and it is unchanged.
- **A workspace-wide "migrate all projects" surface.**

## Open Questions

- **Does the decision modal survive?** Once `.frame/AGENTS.md` provably carries
  no user content, the prose rewrite is safe to apply automatically and the
  modal, its deferral and its Project Settings row (`migration-consent-scope`
  T08–T10) have nothing left to ask. Options: retire all three, or keep them
  for the one case they would still catch — a user who hand-edited Frame's own
  section after init, which leaves no marker behind.
- **Is `.claude/CLAUDE.md`'s block treated like the other three?** Its origin
  file was never deleted, so removing the block from `.frame/AGENTS.md` ends a
  duplication without restoring anything. The `comeety` measurement argues
  for removing it — the copy is 14% of that project's instruction context and
  will go stale on the owner's next edit — but it is the one case where the
  block's removal restores no file, so it is called out rather than assumed.
  Options: remove it like the rest, or treat only the three deleted files as
  this spec's subject.
