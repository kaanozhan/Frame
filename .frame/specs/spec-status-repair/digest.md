---
keywords: spec panel, status.json, slug, malformed spec, conductor, orchestration, issue 122
related: agent-orchestration, spec-knowledge-layer, audit-q3-ux-error-feedback
---
Issue #122: the spec panel hid every spec whose status.json lacked `slug` —
including five written by Frame's own conductor agent, which the task watcher
and spec-index accepted at the same time. `listSpecs` now repairs what the
folder answers (`slug` ← folder name, `generated_task_ids` ← `[]`, persisted
once) and never overwrites an existing slug, since folder/slug disagreement
is a rename and rewriting it would cut `source: spec:<slug>:T##` links.
Deriving the slug alone was not enough — `generated_task_ids` is the
validator's other required field, so the spec would have stayed hidden.
Anything still invalid is listed as a malformed entry with the validator's
reason, sorted first and inert, instead of `continue`-ing silently; folders
with no spec artifact stay ignored. The required shape is documented in
spec.new.md and CONDUCTOR.md (in src/templates, not the staged copy).
`specPanel.renderSpecRow` needed a phase-null guard, found by live check.

Chain: spec.md → plan.md → tasks.md → outcome.md
