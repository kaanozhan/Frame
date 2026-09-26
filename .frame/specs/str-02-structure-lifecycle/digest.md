---
keywords: STR, structure, lifecycle, freshness, working tree, watcher, reconciliation, revision
related: reliable-structure-generation, str-03-local-file-retrieval, str-04-jev-evaluation, audit-q3-performance-resources, frame-storage-seam
---
Keeps the working-tree STRUCTURE.json current while Frame (or a foreground
`structure-lifecycle.js --watch`) runs, and gives consumers a freshness answer.
Re-planned after STR-01 and split: commit publication from the Git index moved
to a follow-up spec, so commits still carry the working-tree map. Every worker
update is a full STR-01 build made cheap by stat-gated content hashes and a
content-keyed extraction cache; candidate-path deltas were rejected (their own
convergence proof). `generation.revision` hashes the checkView payload; input
digests live in the runtime receipt, so a fact-free edit never rewrites the
map. `structure-read.js` (built-ins only) defines fresh/dirty/stale/unknown
from `.frame/runtime/structure/lifecycle.json` for readers and STR-03. Rules:
the supervisor is off unless `index.js` enables it; opens request
reconciliation but never scan; the Git index is not a trigger; native
recursive watching only on macOS/Windows. 10,000 files: edit refresh ≈ 0.85 s.

Chain: spec.md → plan.md → tasks.md → outcome.md
