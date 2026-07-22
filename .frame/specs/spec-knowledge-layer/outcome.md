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
## T02 — Index builder (`scripts/spec-index.js`)

Built the dependency-free builder lib+CLI: topics + files views, front-matter
parsed declared-first (spec.md then digest.md), plan `## Footprint` as intent
and outcome `Files touched:` backticked paths as actuals, phase filter
(done→full, in-flight→warning, specified→topics-only, `superseded_by`→skip),
posix keys, and single-call git enrichment (rename chains via
`log -M --diff-filter=R`, stale flags via one `log --name-only` since the
oldest close — never per-file). `ensureFresh` rebuilds on mtime staleness
only. Deviation from plan: footprint parsing is imperative line-walking, not
regex — the multiline-`$` regex approach truncated at the first bullet in
testing. `.frame/index/` gitignored. 9 tests green incl. a real-git rename
fixture; real-archive smoke: 24 specs → 121 storied files, perf spec
correctly surfaces as in-flight. Files touched: `scripts/spec-index.js`
(new), `test/spec-index.test.js` (new), `.gitignore`.

_Captured: 2026-07-22 · 3 file change(s)_

---
## T03 — Query CLI (`scripts/spec-context.js`)

Added the reader CLI over `ensureFresh`: topic mode (ascii-folded
Turkish/English tokenization scored against slug+title+keywords+footprint
basenames, top-8), `--file` mode (absolute/relative accepted, chronological
records with human flag text — current/stale/later-specs/IN-FLIGHT/moved —
plus deduped deep-read pointers), and a `--list` catalog mode reusing
`catalogLines`. Real-archive smoke: tasksManager.js correctly shows
reliability history + perf in-flight warning. Files touched:
`scripts/spec-context.js` (new).

_Captured: 2026-07-22 · 1 file change(s)_

---
