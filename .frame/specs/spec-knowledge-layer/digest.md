---
keywords: spec history, knowledge layer, index, digest, hooks, injection, spec-context, memory
related: deep-spec-plan, audit-q3-deterministic-graph-hints, audit-q3-core-value-efficacy
---
Made the spec archive a delivered memory, not advisory text: a derived,
gitignored index (`.frame/index/spec-index.json`, built by `spec-index.js`
from Footprints + outcome actuals + front-matter, git for renames/stale
flags only) feeds `spec-context.js` (topic + --file queries) and
`spec-hint.js` — Claude Code hooks that inject file history at Edit/Write
(moment of intent; Grep/Read rejected as bloat) and topic matches at prompt
submit, once per file/topic per session, never blocking, never breaking,
~20ms. Specs now declare keywords/related/supersedes at birth (spec.new
catalog step); plans read footprint history as evidence; workers start
preloaded; digests are written when the last task completes. Rejected:
tracked index (STRUCTURE.json conflict trap), embeddings (no gain at this
scale), a /spec.done command (done is derived — digest rides the last
implement turn). Rule: respect recorded decisions or overturn explicitly.

Chain: spec.md → plan.md → tasks.md → outcome.md
