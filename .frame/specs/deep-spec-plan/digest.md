---
keywords: spec plan, decision gate, convergence, plan report, evidence pass, templates
related: spec-knowledge-layer
---
Rebuilt `/spec.plan` from "write five sections" into a five-stage flow:
evidence pass (claim → file:line, drift detection, G/C/S coverage IDs),
two-stage business→technical AskUserQuestion decision gate (recommendation
first, causal follow-ups only, hard round caps), convergence loop (fixed
checklist, max 4 iterations, surface what still fails), strict plan.md with
`### Resolved plan-time decisions`, and a self-contained dark plan-report.html
staged through `.frame/runtime/assets/` (CLI can't read app.asar — that's
why assets stage on every dispatch). `getSpec` exposes `planReportPath`;
spec panels render a View Plan Report button. spec.new writes Open Questions
only for genuine forks — the gate's primary input.

Chain: spec.md → plan.md → tasks.md (no outcome.md — per-task commits 0d66a7b…6502321 and PROJECT_NOTES 2026-07-16 carry the story)
