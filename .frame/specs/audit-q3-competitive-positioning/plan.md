# Plan — Competitive & strategic positioning

## Architecture

This is a strategy spec: the spec itself rules out code implementation, so the
"architecture" here is the shape of the decision document this spec produces
and the decision framework it locks in. There is exactly **one deliverable**:
`positioning.md` inside this spec's folder — a git-versioned strategy record
that downstream specs (product copy, README repositioning, Frame Server scope)
reference as the source of truth. Concrete product changes flow from it later,
as their own specs, per the spec's out-of-scope section.

**Decision framework (resolving the spec's seven open questions).** The
founder's decided direction (2026-07-02) fixes the primary axis, and the other
questions resolve consistently underneath it:

1. **Positioning axis** — Headline: *spec-driven project memory / compounding
   context corpus, built on Claude Code* ("every future agent arrives knowing
   what was done and why"). First support: *human-steered, guardrailed landing
   of parallel work into `main`* (conflict guard + drift check + approval
   gate). Second support / hedge: *the corpus is yours — git-versioned,
   tool-readable, portable*. Vendor-neutrality is explicitly demoted from
   headline to insurance clause.
2. **Consume vs. compete on orchestration** — Consume. First-party features
   (Agent Teams, Routines) are substrate Frame dispatches into; Frame owns the
   governance, approval, and merge layer above them. Own worktree workers
   remain the current mechanism, but the plan records that they are an
   implementation detail, not the moat, and may be swapped for Agent Teams
   dispatch without changing the positioning.
3. **The Conductor question** — What Frame does that Conductor structurally
   cannot: the code-enforced footprint conflict guard, the pre-merge drift
   check, and the spec→plan→tasks→outcome context corpus that persists after
   the agents finish. Conductor runs agents; Frame *remembers* and *governs*
   what they did. This sentence goes verbatim into the document.
4. **Spec-driven: own it or ride the standard** — Ride. Do not compete with
   Spec Kit/Kiro on spec workflow mindshare; differentiate on what happens
   *after* the spec (footprint-aware scheduling, guarded merge, `outcome.md`).
   Format-level compatibility with Spec Kit is noted as a candidate future
   spec, not committed here.
5. **CLI-gets-a-GUI hedge** — Frame's identity moves to the
   governance/context layer, which is GUI-agnostic. "Nicer terminal" claims
   are added to the not-running list.
6. **Where defensibility lives long-term** — Monetizable moat is server-side
   (team governance, multi-human + multi-agent audit trail); the OSS app is
   the on-ramp and must stay compelling standalone. The document maps each
   wedge element to client (funnel) or server (revenue).
7. **Multi-AI breadth** — Depth on Claude Code plus one maintained
   alternative; neutrality marketed as a *principle* (the corpus stays
   portable) rather than exhaustive N-CLI support.

**Document shape.** `positioning.md` has six fixed sections — the first five
mirror the spec's success criteria one-to-one, the sixth puts the question
resolutions on the record so downstream specs cite the deliverable, not this
plan: `## Positioning statement` (one sentence + the single-vendor test
applied to it), `## The wedge` (why-not-X answers for Agent Teams, Conductor,
Cursor/Windsurf, Spec Kit/Kiro — each honest and expected to survive 2–3
release cycles), `## Structural differentiation` (code-enforced safety,
context craft, portability hedge — with the dependency on
`audit-q3-core-value-efficacy` called out), `## Races Frame will not run`
(explicit de-scoping list), `## Monetization mapping` (wedge element → OSS
client vs. Frame Server), and `## Decision record` (the seven open questions
with their resolutions 1–7 above, stated as decisions with a one-line
rationale each).

## Files

- `.frame/specs/audit-q3-competitive-positioning/positioning.md` — **New** —
  The decided positioning: statement, wedge, differentiation, de-scoping list,
  monetization mapping; resolves the spec's seven open questions on the record.

## Footprint

- .frame/specs/audit-q3-competitive-positioning/positioning.md

## Dependencies

None.

## Sequencing

1. Draft `## Positioning statement`: write the one-sentence statement per the
   founder's decided direction (context corpus + built on Claude Code + safe
   landing into `main`), then apply the single-vendor test from the spec's
   success criteria — for each of Claude Code Agent Teams, Conductor, Cursor,
   and Kiro, state why that vendor could not truthfully claim the sentence;
   sharpen the sentence until all four fail.
2. Draft `## The wedge`: one crisp, honest "why not just use X?" answer each
   for Agent Teams, Conductor (free), Cursor/Windsurf, and Spec Kit/Kiro,
   using resolutions 2–4 above; each answer must rest on a structural property
   (conflict guard, drift check, outcome/context corpus, human-steered merge),
   never on feature parity.
3. Draft `## Structural differentiation` and `## Races Frame will not run`:
   enumerate the three structural pillars with their honest caveats (context
   craft depends on corpus freshness — cross-reference
   `audit-q3-core-value-efficacy`), and the explicit not-running list
   (most-agents, fastest-autonomy, best-terminal, spec-format mindshare,
   exhaustive multi-CLI breadth).
4. Draft `## Monetization mapping`: map each wedge element to OSS client
   (funnel) or Frame Server (revenue), confirming the strategy and business
   model point the same direction per the spec's last success criterion.
5. Draft `## Decision record`: restate the seven open questions from the spec
   with their resolutions (per the Architecture section's decision framework),
   each as a decision plus a one-line rationale; then assemble the full
   `positioning.md` and verify each spec success criterion is satisfied by a
   specific section.
