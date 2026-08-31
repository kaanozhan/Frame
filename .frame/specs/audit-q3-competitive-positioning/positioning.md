# Frame — Positioning (decided 2026-07-02)

> Deliverable of the `audit-q3-competitive-positioning` spec. This document is
> the source of truth for how Frame is positioned; downstream specs (README/site
> copy, Agent Teams dispatch, Frame Server scope) cite this file, not the plan.

## Positioning statement

**Frame turns spec-driven development into durable, structural context — built
on Claude Code — so every future agent arrives knowing what was done and why,
and parallel work lands in `main` only through a code-enforced, human-approved
gate.**

The two clauses are the two moats in priority order: the compounding context
corpus first, guardrailed landing second. "Built on Claude Code" is stated
plainly — depth on Claude Code is the bet, not vendor-neutral breadth.

### Single-vendor test

The statement passes if no single-vendor competitor could truthfully claim it.

- **Claude Code Agent Teams** — Coordinates sessions through an ephemeral task
  list under `~/.claude/tasks/` and auto-merges/auto-resolves. It produces no
  git-versioned spec→plan→outcome record in the repo, and there is no
  code-enforced pre-dispatch conflict guard or human approval gate before
  `main`. It cannot claim either clause.
- **Conductor (Melty Labs)** — Runs parallel agents in worktrees but has no
  spec discipline and no memory: nothing captures what was done and why after
  the agents finish, and nothing code-level refuses conflicting work before it
  starts. It cannot claim the first clause and only weakly the second.
- **Cursor / Windsurf** — Background agents and worktrees are locked inside
  their own tool and VMs; the working context is not a portable, git-versioned
  corpus the user owns, and their direction is more autonomy, not
  human-steered merges. Neither clause holds.
- **Kiro / GitHub Spec Kit** — Own the spec workflow but stop at the spec:
  no footprint-aware scheduling, no drift check, no guarded merge, no
  `outcome.md` capturing what actually happened. The second clause fails, and
  the first fails on "durable" — the story between plan and reality is exactly
  what they don't record.

The residual truth that keeps the sentence Frame's: the context is *yours* —
plain files, git-versioned, readable by any tool — and the governance is
human-steered, never auto-merged.

## The wedge

The honest answer to "why not just use X?", one structural property per
competitor — never feature parity. Expected to survive 2–3 vendor release
cycles because each rests on something the vendor is not incentivized to
build: vendors optimize for autonomy and throughput inside their own tool;
Frame optimizes for control over what merges, and for what the work leaves
behind.

- **Why not Claude Code Agent Teams?** Use it — Frame treats it as substrate,
  not a competitor. Agent Teams coordinates *execution*; it auto-merges, keeps
  its task state outside your repo, and forgets everything when the team
  disbands. Frame owns the layer above: the spec that scoped the work, the
  footprint guard that decided what could run in parallel, the human approval
  gate before `main`, and the `outcome.md` that survives in git after the
  agents are gone.
- **Why not Conductor (free)?** Conductor runs agents; Frame *remembers* and
  *governs* what they did. Conductor has no code-enforced footprint conflict
  guard (refusing to dispatch overlapping work is deterministic code in Frame,
  not a model prompt), no drift check comparing declared footprint to the
  actual diff before merge, and no spec→plan→tasks→outcome corpus that
  persists after the run. The demo looks the same for ten minutes; the
  difference is what exists in the repo a month later.
- **Why not Cursor / Windsurf?** Their parallelism is locked to their editor
  and their model choices, and their trajectory is more autonomy per release.
  Frame's structural bet is the opposite and cannot be absorbed by shipping
  "more agents": a human-steered gate where `main` is never auto-touched, and
  a context corpus in plain git-versioned files that outlives any editor.
- **Why not Spec Kit / Kiro?** Ride their standard, don't fight it — Frame
  does not compete on spec-format mindshare. Their lifecycle ends where
  Frame's begins: after tasks are generated, nothing in Spec Kit or Kiro
  schedules parallel work by file footprint, verifies the diff matches the
  plan, gates the merge on a human, or records the outcome as context for the
  next agent.

## Structural differentiation

Three pillars, in moat order. Each is structural — a property of how Frame
works, not a feature a vendor can match with one release.

1. **Context craft (primary moat).** `outcome.md` capturing the story between
   plan and reality, git-commit-anchored context, and
   `STRUCTURE.json`/`intentIndex` project memory. This is the compounding
   corpus that makes a future agent arrive knowing what was done and why —
   workflow/context craft, the layer the industry itself says advantage is
   moving to as primitives commoditize. *Honest caveat:* this moat is only as
   good as the corpus is fresh, accurate, and demonstrably useful —
   defensibility depends on `audit-q3-core-value-efficacy` proving the corpus
   actually helps agents. If that spec finds the corpus stale or unused, this
   pillar is a story, not a moat.
2. **Code-enforced safety.** The footprint conflict guard (Frame refuses, in
   code, to dispatch a spec whose declared files overlap in-flight work), the
   drift check (declared footprint vs. actual diff before merge), and the
   human approval gate — with `main` never auto-touched. Competitors isolate
   *branches* and leave conflict avoidance to the model or to post-hoc merge;
   Frame's guarantees are deterministic. *Honest caveat:* individually these
   are copyable features; what's defensible is the assembled, opinionated
   whole — and that vendors are pointed the other way (auto-merge, more
   autonomy).
3. **Portability hedge (insurance, not headline).** Specs, plans, outcomes,
   and structure live as plain files in git, readable by any tool. This is
   deliberately *not* the lead wedge — the bet is depth on Claude Code — but
   it protects the value of the corpus: if the vendor landscape shifts, the
   context survives, because it was never locked inside anyone's tool,
   including Frame's.

## Races Frame will not run

Explicit de-scoping. Every feature that merely matches a vendor is wasted
runway; these races are conceded to free it.

- **Most agents in parallel.** Cursor runs 8, Devin runs dozens, Agent Teams
  runs 16. Frame does not compete on N and stops leading with "run N agents
  in parallel" as a headline.
- **Fastest / most autonomous.** Fire-and-forget swarms are the vendors' race.
  Frame's premise is the opposite: human-steered, guardrailed parallelism.
- **Best terminal.** Claude Code's desktop app, Kiro, and Antigravity make
  "nicer terminal wrapper" a shrinking identity. Frame's identity is the
  governance/context layer, which is GUI-agnostic.
- **Spec-format mindshare.** No head-on fight with a 93k-star MIT tool (Spec
  Kit) or an AWS-funded IDE (Kiro). Frame differentiates on what happens
  *after* the spec. Format-level Spec Kit compatibility is a candidate future
  spec, not a commitment here.
- **Exhaustive multi-CLI breadth.** No chasing every agent CLI's breaking
  changes with solo-founder resources. Depth on Claude Code plus one
  maintained alternative; neutrality is marketed as a principle (the corpus
  stays portable), not as exhaustive support.
- **"Reads your context files" as a differentiator.** `AGENTS.md` is an
  industry standard now. Frame's claim is the discipline around the files,
  never the reading of them.

## Monetization mapping

The strategy and the business model must point the same direction: the OSS
app is the on-ramp and must stay compelling standalone; the moat that
monetizes is server-side.

| Wedge element | Lives in | Role |
| --- | --- | --- |
| Context corpus (`outcome.md`, commit anchors, `STRUCTURE.json`) | OSS client | Funnel — the habit that creates the corpus; compelling solo |
| Conflict guard + drift check + approval gate | OSS client | Funnel — the trust story, experienced first-hand solo |
| Spec→plan→tasks flow | OSS client | Funnel — table stakes done well; rides the open standard |
| Portability (plain git-versioned files) | OSS client | Trust — proof there is no lock-in, including to Frame |
| **Shared team governance** (the same guard/gate across many humans + agents) | **Frame Server** | **Revenue** — governance only matters more with more actors |
| **Cross-vendor, multi-human + multi-agent audit trail** | **Frame Server** | **Revenue** — the corpus and approvals as a team asset; SSO/audit are cloud-only |
| Presence, auth, team coordination | Frame Server | Revenue — existing model, unchanged |

The mapping confirms the direction: every client-side wedge element becomes
*more* valuable with a team on top of it, and the team version is exactly
what a single-vendor tool is least incentivized to build cross-vendor. Client
features vendors copy; the server-side governance layer is where
defensibility accrues over time.

## Decision record

The spec's seven open questions, resolved under the founder's decided
direction (2026-07-02): depth on Claude Code + the compounding context corpus
as the moat, all in one place (Frame); vendor-neutrality kept as a hedge.

1. **Positioning axis — pick one.** *Decision:* headline is spec-driven
   project memory / the context corpus, built on Claude Code; guardrailed
   landing into `main` is first support; portability is second support.
   *Rationale:* the corpus is the only pillar that compounds with use and
   that no vendor is incentivized to replicate.
2. **Consume vs. compete on orchestration.** *Decision:* consume — first-party
   features (Agent Teams, Routines) are substrate Frame dispatches into; own
   worktree workers remain the current mechanism but are an implementation
   detail, swappable without changing the positioning. *Rationale:* racing
   the vendor on its own primitive is unwinnable; owning the governance layer
   above it survives vendor feature-creep.
3. **The Conductor question.** *Decision:* the named answer is the conflict
   guard + drift check + the persistent spec→outcome corpus — "Conductor runs
   agents; Frame remembers and governs what they did." *Rationale:* these are
   deterministic, code-level properties Conductor structurally lacks; the
   free demo overlaps only in the first ten minutes.
4. **Spec-driven: own it or ride the standard?** *Decision:* ride — no
   competition with Spec Kit/Kiro on spec workflow; differentiate after the
   spec. Spec Kit format compatibility is a candidate future spec.
   *Rationale:* fighting a 93k-star MIT tool and a hyperscaler IDE head-on is
   a loss; the post-spec layer is uncontested.
5. **CLI-gets-a-GUI hedge.** *Decision:* Frame's identity moves to the
   governance/context layer, which is GUI-agnostic; "nicer terminal" is on
   the not-running list. *Rationale:* the terminal-wrapper identity shrinks
   with every vendor GUI release; the governance layer doesn't.
6. **Where does defensibility live long-term?** *Decision:* server-side —
   Frame Server's team governance and multi-human + multi-agent audit trail;
   the OSS app is the on-ramp and must stay compelling standalone.
   *Rationale:* client features are copyable by vendors; cross-vendor team
   governance is the layer no single vendor will build.
7. **Multi-AI: real advantage or maintenance tax?** *Decision:* depth on
   Claude Code plus one maintained alternative; neutrality marketed as
   principle (the corpus stays portable), not exhaustive support.
   *Rationale:* solo-founder runway can't chase three-plus CLIs' breaking
   changes, and the hedge's real job is protecting the corpus, not breadth.
