---
keywords: upgrade path, managed block, REFERENCE.md, dangling pointer, invariant check, doc health, project open ordering
related: cli-spec-command-parity, non-invasive-overlay, audit-q3-core-value-efficacy
---
Two users reported the same symptom a month apart: asked in natural language to
plan a spec, the agent never entered the deep `spec.plan` flow. Cause: the
2026-07-23 matcher fix removed the stale inline mini-flow from AGENTS.md and
left a pointer at `.frame/docs/REFERENCE.md`, which `upgradeSpecDocs` skipped
with `continue; // missing file — never create it`. Every project born
v1.0.0–v2.4.0 with spec-driven on took that path and came out with no flow at
all. Fixed by ordering: `ensureProjectArtifacts` (which has always known how to
create the reference — `audit-q3-core-value-efficacy` T08 put it there for
exactly this) runs before `upgradeSpecDocs` in one synchronous block, and the
pointer is written only once its target is read back and confirmed to carry the
block. `docsHealth` classifies each doc four ways — managed / legacy / absent /
unmatched — so a doc with no section is appended to and one carrying the user's
own is reported, never written over; collapsing those two would recreate the
07-23 shadowing bug. `docs.repaired` / `docs.degraded` and a popover make a
broken invariant visible, because silence is what let this run for a month.

Rules established: new logic goes only in branches that already returned null
or continued, so healthy projects stay byte-identical; the report describes the
state a pass leaves, not the one it found; and when reasoning about an older
generation of a Frame-written doc, compare headings first — a matcher that
misses may point at a section that was never there. Rejected: `.claude/commands/`
shims (widens the write surface `non-invasive-overlay` pins); a managed block
over navigation prose (D4, reversed mid-implementation on evidence — the seven
migration line-edits *hit* the generation they were written for). The pre-split
AGENTS.md, a wholesale previous-generation document with 13 root-relative meta
mentions, is left to its own spec, to be diagnosed before decided.

Chain: spec.md → plan.md → tasks.md → outcome.md
