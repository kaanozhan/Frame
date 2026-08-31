# Business model & project sustainability

> Audit-sourced findings spec (Q3 2026 deep-dive review). Strategic/business analysis, captured for decision — recorded via the `audit-q3` study.

## Problem

Frame is a genuinely capable product (spec-driven workflow, orchestration, multi-AI) with real early traction (~316 stars, free binaries for macOS/Windows/Linux) but **no revenue mechanism and no coherent path to one today**. The gaps compound:

- **No monetization surface.** Every capability — terminals, specs, orchestration, GitHub panel — ships free in the desktop app. The intended paid wedge is the **Frame Server / team-collaboration platform** (`.frame/specs/team-collaboration-platform/`), but it is entirely unbuilt: the spec's own "first concrete step" (Server MVP: auth + one IPC channel over WebSocket) has not started. The foundations are only stubbed as low-priority tasks (`task-prod-account-sync`, `task-prod-licensing` — "no actual paid features yet, just the plumbing"). Net: the free product currently gives away close to the whole of today's value, and the thing that would be paid does not exist.

- **Solo bus-factor on fragile ops.** One founder, one machine. There are **no CI workflows** (`.github/workflows` absent), **no test suite** (`tests/` holds only a `fixtures/` dir; `package.json` has no runnable `test` script), and **no contributor pipeline** (no `CONTRIBUTING.md`; README's "Contributing" is a generic fork/PR blurb with no CLA, no dev-setup, no review norms). Releases and notarized builds are produced manually on the founder's machine with Apple credentials in a local file. If the founder is unavailable, releases stop, security fixes stop, and the community has no on-ramp to carry it.

- **Licensing / IP is inconsistent and incomplete for a commercial move.** The public repo is **Apache-2.0** (README, LICENSE, NOTICE present) — but the team-collab spec repeatedly assumes the app is **MIT**. That contradiction must be resolved before any open-core split. There is **no CLA/DCO**, so a future proprietary Frame Server built on community contributions has murky rights. "Frame" has **no visible trademark strategy**, yet the open-core model depends on the mark to prevent rebrand-and-resell. (Dependency licenses are, at least, clean: node-pty, xterm, marked, d3, @aptabase/electron are all permissive MIT/ISC/BSD — no copyleft that would block a proprietary server.)

- **Blind to usage — cannot make data-driven decisions.** Telemetry is a **single `app_started` event** (per PRIVACY.md: version, OS, anonymous launch count). The founder can count installs and rough retention but has **zero signal on feature usage, activation, funnel, or which capability people actually value** — exactly the data needed to draw the free-vs-paid line and prioritize the Server bet. Deciding what to charge for while blind to what's used is a guess.

- **Cost asymmetry is unpriced.** Running Frame today costs near-zero (GitHub releases, a static site, Aptabase). Frame Server introduces a step-change the plan hasn't costed: hosting, auth/identity, uptime/on-call, and support load — real recurring cost and founder time that a solo operator must fund from revenue that doesn't yet exist.

## Goal

Turn Frame from a free artifact into a **sustainable open-core project**: draw a defensible free-vs-paid boundary, ship a first monetizable offering (the Frame Server wedge), materially reduce bus-factor (CI, tests, a real contributor path, automated releases), close the licensing/CLA/trademark gaps before the open-core split, and add **minimal, privacy-respecting usage instrumentation** so business decisions are made from data instead of intuition.

## Constraints

- **Solo-founder bandwidth is the binding constraint** — every initiative competes with product work; favor high-leverage, low-maintenance moves.
- **The free desktop product must stay genuinely compelling** — the wedge is team/server value, not crippling the solo experience; "feature-gated OSS" perception is a known failure mode to avoid.
- **The Apache-2.0 core is already public** — any relicensing or open-core boundary must respect what is already released and contributor expectations.
- **PRIVACY.md is a commitment** — it explicitly promises no file paths/contents, no prompts, no PII, opt-out default-on. Any new analytics must live inside those promises (aggregate, anonymous, opt-out) or the doc must be transparently revised.

## Success criteria

- A **written free-vs-paid line**: what stays free forever in the desktop app vs what lives behind Frame Server / Cloud, with rationale.
- A **first monetizable offering** exists and is validated — Frame Server MVP in front of the 3-5 friendly early-access teams named in the team-collab spec, with at least a signal on pricing willingness.
- **Reduced bus-factor**: CI running on PRs, a smoke/E2E test baseline, `CONTRIBUTING.md` + release automation, and Apple/signing secrets out of a local file into managed secrets.
- **Licensing clarity**: the Apache-vs-MIT contradiction resolved, a CLA/DCO decision made and enforced, and a trademark posture defined; NOTICE kept accurate.
- **Minimal ethical usage analytics** live and within PRIVACY.md — enough feature/activation signal to make the free-vs-paid and prioritization calls from data.

## Out of scope

- Detailed pricing tiers and packaging (per-seat vs flat-rate is a decision, not a spec deliverable here).
- Fundraising / investment.
- Hiring and team-building.

## Open questions for /spec.plan

1. **Fork vs single-codebase — the 2026-11 revisit.** The team-collab spec committed to single-codebase (Cal.com/PostHog model) and to revisiting in ~6 months. Do we hold that, given solo bandwidth makes maintaining two codebases nearly impossible?
2. **What exactly do we charge for?** Team/presence/assignment (server-only) vs cloud-only add-ons (SSO, audit log, SCIM) vs a Pro desktop tier — and does anything currently free move behind the line?
3. **CLA/DCO: yes or no?** Required to keep the door open for a proprietary Frame Server built partly on outside contributions — but it adds contributor friction on a project that has none yet.
4. **License coherence:** reconcile Apache-2.0 (actual) vs MIT (assumed in team-collab spec); pick the Server license (BSL/Sentry-style vs pure proprietary).
5. **Which usage events** minimally unblock decisions without breaking PRIVACY.md — and do we need a clearer opt-out/consent story before expanding telemetry?
6. **How is Server cost funded** in the gap before revenue, and what is the smallest operationally-sustainable Server a solo founder can run on-call?
