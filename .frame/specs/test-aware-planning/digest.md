---
keywords: test posture, testing record, spec.plan, test infrastructure detection, PROJECT_NOTES Testing section, footprint, authoring vs verification
related: implement-modes, deep-spec-tasks, audit-q3-generic-any-project
---
Taught `/spec.plan` to plan tests only where a project can run them: a dated `## Testing` record in `PROJECT_NOTES.md` (read first, detected when missing) gates one three-option posture question, and in-scope tests become ordinary Files, Footprint and Sequencing entries.

- Only `src/templates/commands/claude-code/spec.plan.md` changed (132 → 315 lines, commits 0de0241…ef2c752, one per task); no code. No outcome.md was written; the commit bodies carry the actuals.
- Why a record: the spec asked how to detect test infrastructure without hardcoding runners. The gate's answer made the probe non-authoritative: facts recorded once, read on later runs, corrected by the user. Rejected: re-detecting on every run.
- Detection uses two signals for two questions: `project.commands.test` is the invocation, and the filesystem (always scanned) is the convention and the coverage. When the probe cannot tell, it asks once and then looks for what the answer implies; an unverified answer is never recorded.
- Three states: *None detected*, *runner present, nothing written yet* (Go/Rust, where `detect-project.js` sets `commands.test` unconditionally), and populated. The gate keys on the record, never on the config field; folding "no tests" into "no infrastructure" was rejected because it suppresses the question exactly where it matters.
- The record is trusted as dated and re-verified only when the work touches a "Not covered" area. It is written without asking, rewritten in full beside `## Tech Stack` (never in Session Notes) and named in one line of the closing message. With no `PROJECT_NOTES.md`, the probe detects, skips the write and never creates the file (T06, added by the `/spec.tasks` report pass).
- Posture options: pure logic and data transforms only, everything testable, none this time. A binary ask was rejected, and the spec's "success criteria only" candidate was dropped. The option matching the record's Covered line leads. The question is skipped on *None detected* or when the runnable kinds cannot reach the spec's work (no DOM harness here), and it sits inside the existing 3-round technical stage.
- In-scope tests: listed in `## Files` marked **New**, with the same paths in `## Footprint` so the conflict guard sees them, and authoring folded into the step that produces the covered code. A trailing "write the tests" step is refused. "None this time" leaves no test prose in the plan.
- Rules: writing new tests is planned work; running existing checks is implement-time and never a task; implementation never widens the posture on its own. The posture is not stored in `status.json` (no reader), and no dedup rule is needed against `deep-spec-tasks`.
- Result: 9/9 tasks done 2026-07-20. This repo's first `## Testing` record landed with the plan (e10bd1c) and has since been rewritten in place by later `/spec.plan` runs; `implement-modes` D3 was the first plan to take its posture from the gate.

Chain: spec.md → plan.md → tasks.md → outcome.md
