## T01 — Pure queue rules

Added src/shared/queueRules.js (pure) and test/queueRules.test.js (17 tests): add with refusals, remove, reorder, transition-checked setState, setParallel (1–9, default 9), setFlowMode, nextRunnable(min(parallel − running, freeSlots)), markInterrupted, deriveMissing, mergeQueues/homeOf, worktreeKey/queueBranch/queueWorktreeRel and startCommand (spec.auto in full auto, the next phase in step by step). Beyond the plan, interrupted items are startable so a resume needs no separate path, and a done item may be queued again.

_Captured: 2026-11-25 · 2 file change(s)_

---

## T02 — Queue store and machine-local queue.json

Added src/main/queueStore.js: load/save/update/reconcile over .frame/queue.json, with atomic writes and .bak/corrupt recovery through fsSafe. A refused rule writes nothing. Added 'queue.json' to FRAME_FILE_CLASSES.runtime (src/shared/frameConstants.js), so the managed .frame/.gitignore block lists it the next time Frame regenerates it. test/queueStore.test.js has 6 tests; 'interrupted on load' is reconcile(checkout, liveIds), which the owners call with their live terminal ids.

_Captured: 2026-11-25 · 3 file change(s)_

---

## T03 — Desktop queue manager and IPC

Added src/main/queueManager.js (Mac queue, QUEUE_DATA push per change, missing derived from loadTasks/listSpecs) and the QUEUE_LOAD/DATA/ADD/REMOVE/REORDER/SET/PARALLEL channels, wired in src/main/index.js. The source facts (task status/source, spec phase) come with the add request and queueRules decides; refusals return REFUSAL_TEXT. Smoke-tested in Node with a stubbed electron; no unit test, as the plan puts tests on the pure rules and the store.

_Captured: 2026-11-25 · 3 file change(s)_

---

