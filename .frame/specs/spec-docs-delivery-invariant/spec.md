---
keywords: upgrade path, managed block, REFERENCE.md, dangling pointer, invariant check, health banner, layout migration, staged templates
related: cli-spec-command-parity, non-invasive-overlay
---

# The upgrade path delivers what its prose promises

## Problem

`cli-spec-command-parity` shipped a success criterion that is not met in the
field: *"When a CLI agent is asked conversationally to plan a spec, the
resulting `plan.md` has the current five sections including `## Footprint`."*
Two users have now reported the opposite symptom — the agent never enters the
deep `spec.plan` flow. The first report is recorded in `PROJECT_NOTES.md`
**[2026-07-23] Spec-flow delivery gap**; the second arrived 2026-08-26 and was
attributed to the `.frame/` move.

That 07-23 fix broadened `AGENTS_SPEC_LEGACY_MATCHERS` so a pre-split
AGENTS.md's full legacy section would finally be replaced by the core pointer.
It removed the stale "write exactly one file" text that was shadowing the
staged templates — and left the pointer aimed at `.frame/docs/REFERENCE.md`,
which `upgradeSpecDocs` never creates (`catch (_) { continue; // missing file
— never create it }`). Reproduced end to end on a real v2.4.0-era project
through migration and project open:

| | stale mini-flow in AGENTS.md | deep flow reachable |
| --- | --- | --- |
| before 07-23's fix | **present** (shadowing) | no |
| today | gone | **no** |
| required | gone | yes |

Today's state is the worse of the two: the agent has neither the old flow nor
the new one, and nothing errors — `upgradeDoc` returns `null`, the missing
file `continue`s, staging succeeds, and the agent improvises a plan that looks
like ordinary output. Every layer honoured its local contract; nobody owned
the end-to-end property.

The population is wide. Projects born v1.0.0–v2.4.0 (2026-02-18 → 06-24, six
months of releases) with spec-driven enabled all take this path on their next
open. Projects whose docs were customised take a second path: no marker, no
matcher, `upgradeDoc` returns `null` forever, silently — Frame's own
repository is in that state today.

Three more instances of the same class surfaced in the same audit, all on the
upgrade path (fresh init is clean):

- **Migration prose.** All seven `AGENTS_LINE_EDITS` targets were written
  against the post-split template; on a genuine v2.4.0 AGENTS.md none match.
  The migrated file still says *"Check tasks.json and STRUCTURE.json"* and
  *"Review pending tasks in tasks.json"* — root paths, files now in `.frame/`.
  Occurrences of `.frame/tasks.json`: zero. The failures are listed once in
  the migration receipt as seven "check it by hand" lines and then forgotten.
- **`.frame/specs/.gitkeep`** is written at init only, so an upgraded project
  in `repo` sharing mode does not track an empty specs directory.
- **`.frame/bin/codex`** is written at init only (`frameProject.js:274`) and is
  absent from `copyParserScripts`' file list, so upgraded projects lack it.
  `aiToolManager` falls back to the plain `codex` binary, so this degrades
  rather than breaks.

## Goal

After Frame opens a project, one of two things is true and it is never in
doubt: an agent can reach the current spec flow, or the app has said it
cannot and offered the fix. Concretely:

1. `upgradeSpecDocs` gains the branches it is missing — but only inside the
   paths where today's code already does nothing.
2. A doc-health check verifies, on open, that every `.frame/…` path Frame's
   own always-on prose names actually exists, and reports what it finds.
3. A health-notice banner surfaces a broken invariant with a one-click
   remedy and a dismissal that sticks.
4. `.frame/specs/.gitkeep` and `.frame/bin/codex` are re-ensured on open.

## Constraints

- **`cli-spec-command-parity`'s rule stands:** REFERENCE.md and AGENTS.md are
  user-owned; only the managed block may be rewritten, gated by a version
  stamp, and *when the section cannot be located confidently, do not rewrite*.
  This spec adds one clause — **and do not stay silent**. It may append where
  there is nothing to conflict with, or ask; it may never rewrite what it
  cannot prove is Frame's.
- **Never auto-create `.frame/docs/REFERENCE.md`.** User decision 2026-08-26:
  the banner asks, because the user may keep their own reference doc. The same
  reasoning governs a REFERENCE.md that exists but carries a customised spec
  section: ask, do not append over it.
- **07-23's removal must stay removed.** No change may reinstate the pre-split
  inline section; the stale mini-flow must not come back in any project state.
- **No `SPEC_SECTION_VERSION` bump unless a section body actually changes.** A
  bump rewrites the block in every healthy project and discards the in-block
  edits the version gate exists to preserve. Precedent: the 07-23 fix shipped
  without one.
- **Frame's write surface outside `.frame/` is unchanged** — exactly
  `.claude/rules/frame.md`, Frame's own hook entries, the pre-commit block and
  the git exclude block (`non-invasive-overlay` D-list). `.claude/commands/`
  shims stay rejected, reaffirming the 2026-07-23 decision.
- **Healthy projects must come out byte-identical.** New logic may live only
  in branches that today `return null` or `continue`: `upgradeDoc`'s
  fall-through after all matchers fail, and `upgradeSpecDocs`' missing-file
  catch. A project whose block is stamped at the current version must not be
  read differently, let alone written.
- **Migration prose repair stays anchored** to what each shipped generation
  actually wrote, matched per generation. No generalised regex over prose the
  user may have authored.
- The UI dispatch path (`buildSpecCommandFile` → `.frame/runtime/prompts/`)
  works today and must keep its behaviour.

## Success Criteria

- When a pre-split project (full legacy section in AGENTS.md, no REFERENCE.md)
  is opened, then the stale mini-flow is absent **and** a banner names the
  missing `.frame/docs/REFERENCE.md` and offers to create it; accepting makes
  the deep flow reachable, dismissing is remembered for that project.
- When a doc carries no spec section at all, then the managed block is
  appended without rewriting a byte of existing prose.
- When a doc carries a spec section Frame cannot match, then nothing is
  written and the banner offers the choice.
- When a project whose block is stamped at the current version is opened, then
  `.frame/AGENTS.md` and `.frame/docs/REFERENCE.md` are byte-identical before
  and after.
- When a genuine v2.4.0-era project is migrated, then its AGENTS.md names
  `.frame/`-relative meta paths, and any line the repair cannot place is still
  reported in the receipt.
- When any Frame project is opened, then `.frame/specs/.gitkeep` and
  `.frame/bin/codex` exist.
- The doc-health check reports every `.frame/…` path named in Frame's
  always-on prose that does not exist on disk, and records the result to the
  activity log.

## Out of Scope

- **The pre-split AGENTS.md, and the migration prose inside it.** Dropped from
  this spec after implementation disproved the premise it rested on: all seven
  `AGENTS_LINE_EDITS` targets *hit* the post-split generation they were written
  for, and they miss on pre-split documents because that generation has no
  navigation section at all — it is a wholesale different document carrying the
  maintenance ceremony inline, with 13 root-relative meta mentions across
  sections the current template no longer has. That is a real problem and a
  different question from this one; it gets its own spec, diagnosed before
  decided.
- `.claude/commands/` slash-command shims — decision reaffirmed, not revisited.
- Sharing `.frame/runtime/commands/` in `repo` mode.
- Rewriting or merging a user's own spec section.
- The command templates' own content, including `spec.plan`'s five stages —
  unchanged by this spec.

## Open Questions

- ~~How the migration's meta-path prose repair should work.~~ **Resolved by
  disproof during implementation** — neither option was right. See Out of Scope.
