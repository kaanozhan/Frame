# Competitive & strategic positioning

> Audit-sourced findings spec (Q3 2026 deep-dive review). Strategic analysis, captured for decision — recorded via the `audit-q3` study.

## Problem

Frame's three headline differentiators — spec-driven development, conductor-led
parallel-agent orchestration, and files-over-DB persistent context — were each
distinctive when conceived. As of mid-2026 all three are being actively
commoditized, and in two of the three the platform vendors themselves are the
ones doing the commoditizing. This is the central strategic risk: a solo-founder
tool whose wedges are being absorbed by the CLIs it wraps.

**Risk 1 — Orchestration is being absorbed by the platform vendor.**
Anthropic shipped **Claude Code Agent Teams** (experimental, gated behind
`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`): 2–16 coordinated sessions with a shared
task list at `~/.claude/tasks/{team}/`, dependency tracking, peer-to-peer
messaging, states (`pending → claimed → in-progress → blocked → completed`), and
**automatic unblocking of downstream tasks when a blocker completes**. That is
strikingly close to Frame's pipeline rail (`queued → running → done → approved`,
with `blocked` on footprint conflict). Anthropic also ships subagent
orchestration ("tens to hundreds of background subagents"), agent checkpointing
(pause/resume the whole agent tree), and a redesigned desktop app with a plan
sidebar and "Routines." The exact coordination layer Frame built is now a
first-party Claude Code feature — free, in the tool, requiring no wrapper.

**Risk 2 — Parallel-agents-in-git-worktrees is now table stakes, not a moat.**
Frame's "each spec in its own worktree, isolated" is matched or exceeded across
the field: **Windsurf Wave 13** runs up to 5 parallel agents in isolated git
worktrees plus a structured Plan Mode; **Cursor 2.0** runs up to 8 parallel
agents with Background Agents in isolated VMs and a "Mission Control" cockpit;
**Warp's Oz** orchestrates parallel cloud agents at the terminal layer;
**Devin** (Fusion architecture, Command Center + Spaces) is built around "dozens
of agents in parallel across cloud and local"; **Google Antigravity 2.0** made
multi-agent orchestration its core model (frontend/backend/test/deploy
subagents, real Chrome browser subagent). Most directly, **Conductor** (Melty
Labs) is a *free* Mac app that does almost exactly Frame's headline job — parallel
Claude Code/Codex agents, each in an isolated git worktree, with GitHub + Linear
integration and PR authoring. Frame is not the only one, or the most funded one,
doing worktree isolation.

**Risk 3 — Persistent context has become an open industry standard.**
Frame's `AGENTS.md` bet was correct — so correct that it's now the ecosystem
default rather than a Frame advantage. `AGENTS.md` is adopted by 60,000+
projects and by Codex, Cursor, Devin, Gemini CLI, GitHub Copilot, Jules, VS
Code, and Claude Code; it was contributed to the **Linux Foundation's Agentic AI
Foundation** (170+ members) alongside MCP. Industry commentary is explicit that
"memory, tool calling, guardrails are becoming commodity features; advantage
moves up the stack into workflow design and domain integration." Frame reading
`AGENTS.md` is no longer differentiating — everyone does. What remains
Frame-specific is the *discipline around it*: the git-commit-as-context-anchor
model, `STRUCTURE.json`/`intentIndex`, and `outcome.md` capturing the story
between plan and reality.

**Risk 4 — Spec-driven has a category king problem.**
Frame did not invent spec-driven development and is not the reference
implementation. **GitHub Spec Kit** (MIT, 93,000+ stars, v0.8.7, supports 30+
agents) owns open-source mindshare; **AWS Kiro** (GA May 2026, a VS Code fork,
replaced Amazon Q) owns the "spec-driven IDE" positioning with a design→tasks
lifecycle nearly identical to Frame's spec→plan→tasks. Both are backed by
platform giants. Frame's spec flow is good but is one of many, and the two
best-known are free/MIT or hyperscaler-funded.

**Where the moat is actually thin vs. actually real.**
- *Thin:* worktree isolation (commodity), reading `AGENTS.md` (standard),
  multi-AI tool switching (Codex/OpenCode/others do this too), "run parallel
  agents" as a headline (crowded, includes a free Conductor and first-party
  Claude Code Agent Teams).
- *Real (for now):* the **code-enforced footprint conflict guard** — refusing to
  dispatch a spec whose declared file footprint overlaps in-flight work is a
  deterministic, code-level safety property, not a model prompt. Competitors
  isolate *branches* but mostly leave conflict avoidance to the model or to
  post-hoc merge. The **drift check** (declared footprint vs. actual diff before
  merge) is similarly concrete. And the **integrated cockpit** — spec authoring,
  footprint-aware scheduling, human approval gate, and merge all on one screen
  with `main` never auto-touched — is a coherent, opinionated whole that no
  single competitor assembles the same way (Claude Code Agent Teams
  auto-merges/auto-resolves; Frame's bet is *human-steered, guardrailed*
  parallelism).

## Goal

> **Founder's decided direction (2026-07-02).** The analysis above surfaced
> several forks; the founder has resolved the primary axis: **depth on Claude
> Code + the compounding context corpus as the moat, all in one place (Frame) —
> not vendor-neutral breadth as the headline.** Frame is built *on* Claude Code
> ("without Claude, Frame is meaningless"); the durable asset is the structural
> context spec-driven development produces for future agents (the story of *what*
> was done, *why*, and *what resulted*). Vendor-neutrality/portability is kept as
> a **hedge that protects the value of that context corpus** (it stays
> git-versioned and tool-readable), not the lead wedge. Consuming first-party
> orchestration (Agent Teams) as substrate is acceptable *as long as Frame remains
> the one place* the work, context, and governance live. Read the bullets below
> through that lens — where a bullet leads with neutrality, treat it as secondary.

Reposition Frame from "a tool that runs parallel agents / reads context files"
(commoditized) to "the **governance and orchestration layer** that makes
multi-agent, multi-tool development *safe, reviewable, and portable across
vendors*." Concretely:

- **Double down (defensible):** the code-enforced conflict guard + drift check +
  human approval gate as a *trust/safety* story, not a *parallelism* story.
  "Fire-and-forget swarms are easy; landing their work into `main` without chaos
  is the hard part — that's Frame." This survives vendor feature-creep because
  vendors optimize for autonomy/throughput inside their own tool, while Frame
  optimizes for control across tools and for what merges.
- **Keep as a hedge (secondary to Claude-native depth):** **vendor-neutrality /
  portability — insurance on the context corpus, not the headline.**
  Claude Code Agent Teams, Cursor Background Agents, Windsurf worktrees are each
  locked to their own model/tool. Frame *can* orchestrate Claude Code *and* Codex
  *and* Gemini/OpenCode against one shared, git-versioned spec + context — and
  because the context stays portable, its value survives any single vendor. But
  per the decided direction this is a hedge that protects the corpus, not the lead
  wedge; the primary bet is depth on Claude Code.
- **Double down — this is the primary moat:** `outcome.md` + git-commit-anchored
  context + `STRUCTURE.json`/`intentIndex` — the *story-between-plan-and-reality*
  and the project-memory discipline. This is the compounding context corpus that
  makes a future agent arrive *knowing* what was done and why, and it is
  workflow/context craft (the layer moving "up the stack"), not a commodity
  primitive. Its defensibility depends on the corpus actually being fresh,
  accurate, and proven to help — see `audit-q3-core-value-efficacy`.
- **De-emphasize / stop leading with:** "run N agents in parallel" and "reads
  your context files" as headlines — these now read as table stakes and invite a
  losing feature-for-feature comparison against better-funded tools.
- **Stay ahead of commoditization:** treat first-party features (Agent Teams,
  Routines, desktop app) as *substrate to orchestrate*, not competitors to
  out-build. When Claude Code ships better in-tool coordination, Frame should
  *consume* it (dispatch to Agent Teams) while owning the cross-tool governance,
  approval, and merge layer above it.

## Constraints

- **Solo founder, limited resources.** Cannot win a feature race against
  Anthropic, Google, AWS, Cognition, or Cursor/Windsurf funding. Must pick a
  narrow, defensible wedge and refuse breadth. Every feature that merely matches
  a vendor is wasted runway.
- **Business model = open-source app + proprietary Frame Server.** Value/pricing
  live in the Server (presence, auth, team coordination, cloud-only SSO/audit).
  The OSS app must stay compelling standalone or the funnel dies; the moat that
  monetizes is server-side, so defensibility should increasingly live there
  (shared team governance) rather than in client features vendors can copy.
- **Dependence on third-party CLIs Frame does not control.** Frame wraps Claude
  Code / Codex / Gemini; those vendors can change CLIs, absorb Frame's features,
  or ship official GUIs (Claude Code desktop app, Kiro) that reduce the need for
  a wrapper. Frame's roadmap must assume the CLIs get GUIs and plan to sit
  *above* them (governance/portability), not *beside* them (nicer terminal).
- **~316 GitHub stars, Apache-2.0.** Modest distribution vs. Spec Kit's 93k;
  can't rely on mindshare — must rely on a sharp, opinionated point of view.

## Success criteria

- A **one-sentence positioning statement that is literally true and not
  claimable by a single-vendor competitor** — per the decided direction, leading
  with the context/Claude-native axis, e.g. "Frame turns spec-driven development
  into durable, structural context — built on Claude Code — so every future agent
  arrives knowing what was done and why, with parallel work landed safely into
  `main`." The single-vendor test still applies: if a closed vendor tool could say
  the same, sharpen it — Frame's answer is that the context is *yours*,
  git-versioned and portable, and the governance is human-steered, not
  auto-merged.
- A **clear defensible wedge** that survives the next 2–3 vendor release cycles:
  the answer to "why not just use Claude Code Agent Teams / Conductor (free) /
  Cursor?" is crisp, honest, and holds even after those tools improve.
- **Differentiation that is structural, not feature-parity:** code-enforced
  safety (conflict guard + drift check + human approval), cross-vendor
  portability (git-versioned files, no lock-in), and context craft (`outcome.md`,
  commit-anchored memory) — none of which a single-vendor tool is incentivized to
  replicate.
- **Honest de-scoping:** an explicit list of races Frame will *not* run
  (most-agents, fastest-autonomy, best-terminal), freeing runway for the wedge.
- Evidence the wedge maps to the **monetizable layer** (Frame Server / team
  governance), so the strategy and the business model point the same direction.

## Out of scope

- Detailed go-to-market, distribution, and launch tactics.
- Pricing model and licensing decisions (per-seat vs. flat, MIT vs. BSL) — these
  live in the separate team-collaboration / business spec.
- Any code implementation. This is a positioning/strategy spec; concrete product
  changes flow from the decisions made in planning, as their own specs.

## Open questions for /spec.plan

1. **Positioning axis — pick one.** "Vendor-neutral governance layer for
   agentic dev" vs. "human-in-the-loop safety cockpit for parallel agents" vs.
   "spec-driven project memory that outlives any tool." All three are defensible;
   leading with more than one dilutes. Which is the headline, which are support?
2. **Consume vs. compete on orchestration.** Should Frame's orchestrator learn to
   *dispatch into* Claude Code Agent Teams / Cursor Background Agents (owning the
   governance layer above them), or keep running its own worktree workers (owning
   the full stack, but racing the vendors)? This is the single biggest fork.
3. **The Conductor question.** Conductor is free and does Frame's headline demo
   (parallel Claude Code/Codex in worktrees, GitHub/Linear). What does Frame do
   that Conductor structurally cannot — and is it the conflict guard + drift
   check + spec discipline, or something else? Name it or the demo loses.
4. **Spec-driven: own it or ride the standard?** Compete with Spec Kit / Kiro on
   spec workflow, or adopt Spec Kit's format under the hood and differentiate on
   orchestration + governance? Fighting a 93k-star MIT tool and an AWS-funded IDE
   head-on is likely a loss.
5. **CLI-gets-a-GUI hedge.** As Claude Code's desktop app, Kiro, and Antigravity
   mature, "terminal-first wrapper" shrinks. Is Frame's future the *terminal*
   (differentiator fading) or the *governance/context/portability layer* (which
   is GUI-agnostic)? What must move off the terminal-first identity?
6. **Where does defensibility live long-term — client or server?** If client
   features are copyable by vendors, should the durable moat be Frame Server's
   *team* governance (cross-vendor, multi-human + multi-agent audit trail), and
   should the OSS app be positioned as the on-ramp to it?
7. **Multi-AI: real advantage or maintenance tax?** Vendor-neutrality is the
   strongest structural claim, but it means chasing three+ CLIs' breaking
   changes with solo-founder resources. Is the breadth worth it, or should Frame
   go deep on Claude Code + one alternative and market neutrality as *principle*
   rather than exhaustive support?
