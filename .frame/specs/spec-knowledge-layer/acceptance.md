# Acceptance record — Spec Knowledge Layer

Captured 2026-07-22, on `feat/spec-knowledge-layer` (T01–T12).

## Measured checks

| Check | Criterion | Result |
| --- | --- | --- |
| Hook overhead | ≤ 50 ms incl. node startup | **~20 ms** avg and max over 10 runs (pre-edit, warm 24-spec/121-file index) |
| No-index project | byte-identical silence, exit 0 | **pass** — empty stdout, exit 0 in a bare temp project |
| Corrupt inputs | never surface as tool errors | **pass** — corrupt index / corrupt stdin / missing fields / unknown mode all exit 0 silent (test suite) |
| spec.new catalog | full inventory embedded, token replaced | **pass** — 24 catalog lines in the dispatched prompt, `{spec_catalog}` fully interpolated |
| Overflow contract | 3+ specs → every spec still present | **pass** — unit-tested (6-record file injected all 6 as one-liners + pointer, live) |
| Suite | all tests green | **100/100** (`npm test`), incl. 9 index + 9 hook tests |

## Live dogfood evidence (this implementation session itself)

The hooks went live mid-implementation (T06) and fired on every subsequent
edit — the layer was built under its own surveillance:

- **Real catch:** editing `src/templates/CLAUDE.md` for T11, the injected
  STALE record for `audit-q3-core-value-efficacy` T08 prompted verification
  that revealed the live AGENTS template is `getAgentsTemplate()` in
  `src/shared/frameTemplates.js` — the md file has zero code references.
  Without the injection the advisory block would have shipped only into a
  dead file. This is S1's "history changes the work" behavior, observed.
- **In-flight collisions surfaced:** frameProject.js / specManager.js /
  orchestrationManager.js / frameTemplates.js edits each flagged the
  overlapping in-flight footprints (perf T10 open, cross-platform planned) —
  the merge-order caution is recorded in T06/T11 outcome entries.
- **Dedup observed:** repeated edits to the same file in one session
  produced exactly one injection each.

## Injected-vs-non-injected comparison (S6)

`run-eval.js --hooks` is implemented: frame-arm worktrees receive the three
hint scripts, a freshly built in-worktree index, and the hook registration
(committed pre-run so none of it appears as agent diff); `hooksActive` lands
in each run's meta for score.js grouping. The comparison itself spawns full
headless agent sessions per task × arm — a budgeted run, deliberately not
burned during implementation. Command of record:

```bash
node scripts/eval/run-eval.js --hooks            # both arms; frame arm hooked
node scripts/eval/score.js <results-dir>
```

Directional pass criterion (from the spec): hooked sessions consult/apply
spec history more than un-hooked ones.

## Standing notes

- Default mode is full-content; `FRAME_SPEC_HINT_MODE=signal` kept for the
  dogfooding comparison (D1).
- `src/templates/CLAUDE.md` is a dead copy — deletion candidate (T11).
- Frame UI file-history panel intentionally deferred to a follow-on spec (D2).
