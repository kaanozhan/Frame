## T01 — Pure queue rules

Added src/shared/queueRules.js (pure) and test/queueRules.test.js (17 tests): add with refusals, remove, reorder, transition-checked setState, setParallel (1–9, default 9), setFlowMode, nextRunnable(min(parallel − running, freeSlots)), markInterrupted, deriveMissing, mergeQueues/homeOf, worktreeKey/queueBranch/queueWorktreeRel and startCommand (spec.auto in full auto, the next phase in step by step). Beyond the plan, interrupted items are startable so a resume needs no separate path, and a done item may be queued again.

_Captured: 2026-11-25 · 2 file change(s)_

---

