# Outcome — Lead agent

## T01 — Add the pure Chief rules module

Added `src/shared/leadRules.js`: OSC 7501 state → status mapping, `deriveStatus` (a stale report is dropped once the foreground is back to the shell), scope filter by project + machine, hard refusals for sends, per-action approval flags, a pure approval book (first decision wins, cancel, prune), and the delivery gate and per-target FIFO. Beyond the plan: a native Claude install's foreground process is named after its version (`2.1.331`), so version-shaped names count as agents. Also beyond the plan: a non-agent program owning the terminal (`busy`) is refused rather than queued, because a dev server never becomes ready. Covered by `test/leadRules.test.js`.

_Captured: 2026-11-25 · 2 file changes_

---
