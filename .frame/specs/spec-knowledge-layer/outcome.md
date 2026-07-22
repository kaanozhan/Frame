# Outcome — Spec Knowledge Layer

## T01 — Inventory hygiene pass

Deleted the four `test-orch-1..4` probe spec folders (untracked, no git surgery
needed) and purged their tasks from `tasks.json` — including an orphan
`spec:test-orch-5:T01` task whose spec folder never existed. Added
`"superseded_by": "audit-q3-generic-any-project"` to
`structure-non-standard-layouts/status.json`. Corrected `deep-spec-plan`:
its T08 was `in_progress` in tasks.json despite the merged commit (6502321),
so T08 → completed and phase → `done`. Deviation from plan: `agentlar-iin-roller-…`
was left at `implementing` — verification showed that IS its real state
(T01 shipped, T02–T05 pending), so the index will correctly treat it as
in-flight rather than done.

_Captured: 2026-07-22 · 4 folders deleted, 3 files changed_

---
