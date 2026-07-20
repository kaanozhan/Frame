# Tasks — Test-aware planning — detect test infrastructure, decide posture, plan the tests

- T01 · Define the `## Testing` record's shape in `src/templates/commands/claude-code/spec.plan.md` and have Stage 1 read it from `PROJECT_NOTES.md` first, skipping detection when it is present and not contradicted by the planned work
- T02 · Add detection for when the record is missing: `project.commands.test` for the invocation and the filesystem for location, naming and which source areas existing tests exercise, with the filesystem side always running and no runner, library or directory name hardcoded
- T03 · Add the three record states to `spec.plan.md` — *None detected*, *runner present but nothing written yet*, and populated — and gate the posture question on the record rather than on the config field, so a toolchain that ships its runner is not read as having no test infrastructure
- T04 · Add the ask-then-look fallback: when detection cannot settle whether a kind of test is runnable, ask the user once and then look for what the answer implies rather than trusting the answer alone
- T05 · Add the write-back to `spec.plan.md`: record the finding in `PROJECT_NOTES.md` beside `## Tech Stack` and never in `## Session Notes`, dated, written without asking, named in one line of the closing message, including the D4 refresh rule
- T06 · Handle a project with no `PROJECT_NOTES.md`: detect fresh, skip the write, and never create the file on the project's behalf
- T07 · Add the posture question to Stage 2's technical stage — three options with the recommendation first, asked only when the record shows infrastructure runnable for this spec's kind of work, inside the existing round cap
- T08 · Add the carrying rules to Stage 4: planned test files listed in `## Files` marked **New**, their paths in `## Footprint`, and authoring attached in `## Sequencing` to the step that produces the code it covers
- T09 · Add the authoring-versus-verification line to `spec.plan.md`, stating that writing new test code is planned work while running the project's existing checks is an implement-time step
