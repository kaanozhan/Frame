# Plan — Test-aware planning — detect test infrastructure, decide posture, plan the tests

## Architecture

### Resolved plan-time decisions

- **D1 · Posture options** (asked) — three: *everything testable*, *pure logic
  and data transforms only*, *none this time*. *Rationale:* the middle option
  is not invented — it is the convention this repo already follows.
  `test/telemetry.test.js` states it outright: "targets the pure policy module
  (`telemetryEvents.js`); the Electron side of `telemetry.js` is a thin wrapper
  over it." A binary ask cannot express the case that is actually true here.

- **D2 · The question is scoped to what the project can run** (asked) — the
  probe distinguishes test *kinds*, and the gate never asks for tests the
  project has no way to execute. *Rationale:* this repo has eight unit-test
  files and no DOM/UI harness (`jsdom`, `playwright`, `@testing-library`,
  `puppeteer` all absent). Asking "should this ship with tests?" about a
  `src/renderer/` change would produce a plan whose test task cannot be run.

- **D3 · Testing facts are cached in `PROJECT_NOTES.md`** (asked) — a standing
  `## Testing` section records the runner, the location and naming convention,
  which areas are covered, which are not, and CI. Absence is recorded
  explicitly as **None detected**, so "never looked" and "looked, found
  nothing" are distinguishable. The probe reads this first and only scans when
  it is missing; when scanning cannot settle the question it asks the user,
  then scans for what the answer implies and records the result.
  *Rationale:* this converts a per-run detection cost into a fact recorded
  once, which is what durable context is for. It also removes the need for the
  probe to be authoritative — a heuristic that only has to be good enough to
  propose, with the user as the fallback, needs no hardcoded harness list and
  so does not strain C3.

- **D4 · Refresh policy** (asked) — the record carries its date and is trusted
  as written. It is re-verified only when the planned work touches an area the
  record says is *not* covered. *Rationale:* that is the one case where a stale
  record changes the outcome — it would suppress tests that are now possible.
  Everywhere else re-scanning buys nothing and gives back the cost D3 saved.

- **D5 · The record is written without asking** (asked) — detections and the
  user's answers are both written directly; the closing message names what was
  recorded in one line. *Rationale:* `REFERENCE.md` already grants this ("You
  can add without asking the user (for important decisions)"), and a
  confirmation prompt on every planning run is noise.

- **D6 · Where the section lives** (silent) — in the standing topical part of
  `PROJECT_NOTES.md`, beside `## Tech Stack`; **not** in `## Session Notes`.
  *Rationale:* the file already separates the two. Lines 1–396 are standing
  reference sections updated in place; `## Session Notes` (line 397 onward) is
  a dated append-only log. A cache that gets rewritten belongs in the former.

- **D7 · The posture is not recorded in `status.json`** (silent) — `plan.md`
  carries it under "Resolved plan-time decisions" and the tasks carry the work.
  *Rationale:* nothing reads such a field today. `implement-modes` is a
  separate, unimplemented spec; adding a field with no reader is speculative.

- **D8 · No dedup rule is needed against `deep-spec-tasks`** (silent) — the
  spec flagged that a test task could arrive twice, once from `## Sequencing`
  and once from the report's coverage matrix. *Rationale:* G3 requires test
  authoring to be folded into the step that produces the code it covers, so no
  standalone test task exists to be duplicated. The coverage ID resolves to a
  task that already carries the test work.

- **D9 · This spec's own work ships without tests** (silent) — the change is a
  prompt template; there is no pure logic to unit test. *Rationale:* applying
  D1 to this spec honestly yields "none this time". Recorded because the
  alternative — planning a test for a markdown file — is the exact failure mode
  D2 exists to prevent.

### The testing record

A standing section in `PROJECT_NOTES.md`, rewritten in place whenever the probe
learns something new:

```markdown
## Testing

- **Runner:** <invocation> → <what it actually executes>
- **Location & naming:** <where tests live, how they are named>
- **Covered:** <source areas exercised by existing tests>
- **Not covered:** <areas with no test path, and why>
- **CI:** <workflow, or None>
- _Recorded <ISO date> by /spec.plan_
```

**Three states, not two.** "No tests" and "no way to run tests" are different
findings and the record must keep them apart:

```markdown
## Testing

**None detected** — no test runner, no test files.
- _Recorded <ISO date> by /spec.plan_
```

```markdown
## Testing

- **Runner:** `go test ./...` — toolchain built-in
- **Covered:** none yet — no `_test.go` files
- _Recorded <ISO date> by /spec.plan_
```

The second is **not** "no infrastructure". Some toolchains ship the runner:
`detect-project.js` sets `commands.test` unconditionally for Rust (`:197`) and
Go (`:219`) because `cargo test` / `go test ./...` work whether or not a single
test exists. JavaScript, Python and Ruby are conditional on evidence — a
non-placeholder `scripts.test` (`:125-127`), pytest in the manifest
(`:177-179`), a `Rakefile` (`:232`) — so there, no signal really does mean
someone must choose and install a runner first.

C2 therefore gates on the **record**, not on the config field: *None detected*
suppresses the question; *runner present, nothing written yet* does not — tests
are one file away, and that is exactly the case worth asking about. No
language-specific rule is needed in the template; the record is expressive
enough to carry the distinction, and after the first run the probe reads these
lines rather than re-deriving them.

The record answers two different questions that must not be collapsed:
`project.commands.test` in `.frame/config.json` gives the **invocation**
(`npm test` here — an indirection, not the runner), while the filesystem gives
the **convention** (where tests live, how they are named, what they touch).
`detect-project.js:125-127` only populates `commands.test` when a real,
non-placeholder script exists, so a non-null value is declared intent rather
than a guess — but it still cannot tell you whether any test file exists.

### Probe flow (Stage 1)

1. Read `PROJECT_NOTES.md`'s `## Testing` section. If present and the planned
   work does not touch an area it marks uncovered, use it and scan nothing.
2. If absent, detect: `project.commands.test` for the invocation, the
   filesystem for location, naming, and which source areas existing tests
   exercise.
3. If detection cannot settle whether a given kind of test is runnable, ask the
   user once, then look for what the answer implies.
4. Write the section. Record "None detected" when that is the finding.

The finding enters the evidence table like any other Stage 1 claim.

### Gate question (Stage 2, technical stage)

Asked only when the record shows runnable infrastructure **for the kind of work
this spec contains**. One question, three options (D1), inside the existing
3-round cap — it does not get its own stage. No infrastructure, or none of the
runnable kind, means no question and no test work.

### Carrying the decision (Stage 4)

When tests are in scope they stop being prose and become planned artifacts:
each test file listed in `## Files` marked **New** where it is, its path in
`## Footprint`, and the authoring attached in `## Sequencing` to the step that
produces the code it covers — never deferred to a trailing "write the tests"
step. `audit-q3-generic-any-project` already demonstrates the shape
(`plan.md:228-231` in Files, the same four paths in Footprint, authoring folded
into T01/T05/T12).

### Authoring is planned; verification is not

Writing new test code is work and belongs in `tasks.md`. Running the project's
existing checks after a change is an implementation-time step and belongs to
the implement flow. The template says so explicitly, so a planning run does not
emit "run `npm test`" as a task, and an implementation run does not invent test
files believing the plan forgot them.

### Scope note — this plan extends the spec

`spec.md` scoped the work to detection, the gate question, and the plan
structure. The `PROJECT_NOTES.md` record (D3–D6) is new: it was decided at the
gate, after the spec was written, and no Goal in `spec.md` covers it.

It also softens a constraint. C1 says `spec.plan.md` is the only file this spec
changes — true of the repo diff, which remains one template. But the command
now **writes to `PROJECT_NOTES.md` at run time**, outside `.frame/`. That file
is a Frame meta file, so it is Frame's to write and `REFERENCE.md` grants the
permission; it is nonetheless a side effect no other spec command has today,
and it is shared state that the conductor reconciles after merges. Worth
knowing before this ships.

One mechanical consequence: `PROJECT_NOTES.md` is in `ORCH_META_FILES`
(`frameConstants.js:51`) and `parseFootprintMarkdown` filters by basename, so
it can never appear in a Footprint. Nothing to fix — it is written at run time
in the user's project, not changed by this spec — but it means the
orchestration conflict guard is structurally blind to it.

## Files

- `src/templates/commands/claude-code/spec.plan.md` — **Modified** — Stage 1
  gains the testing probe and the record; Stage 2 gains the posture question;
  Stage 4 gains the rules that carry tests into Files, Footprint and
  Sequencing, and the authoring-versus-verification line.

## Footprint

- src/templates/commands/claude-code/spec.plan.md

## Dependencies

None.

## Sequencing

1. **Add the testing record's shape and read path to Stage 1.** Define the
   `## Testing` section format, including the explicit **None detected** state,
   and have the probe read it first and skip scanning when it is present and
   not contradicted by the planned work.

2. **Add detection for when the record is missing.** `project.commands.test`
   for the invocation, the filesystem for location, naming, and which source
   areas existing tests exercise — stated as two signals answering two
   questions, with no runner, library or directory name hardcoded. The
   filesystem side always runs; it is not a fallback for a missing config
   value, and it is what makes the record language-independent.

3. **Add the three record states.** *None detected*, *runner present but
   nothing written yet*, and a populated record — with C2 gating on the record
   rather than on the config field, so a toolchain that ships its runner is not
   mistaken for a project without test infrastructure.

4. **Add the ask-then-look fallback.** When detection cannot settle whether a
   kind of test is runnable, ask the user once, then look for what the answer
   implies rather than trusting the answer alone.

5. **Add the write-back.** Record the finding in `PROJECT_NOTES.md` beside
   `## Tech Stack`, never in `## Session Notes`; date it; write without asking;
   name what was recorded in one line of the closing message. Include the
   refresh rule from D4.

6. **Add the posture question to Stage 2's technical stage.** Three options,
   recommendation first, asked only when the record shows infrastructure
   runnable for this spec's kind of work, inside the existing round cap.

7. **Add the carrying rules to Stage 4.** Test files in `## Files` marked
   **New**, their paths in `## Footprint`, authoring attached in
   `## Sequencing` to the step producing the code it covers.

8. **Add the authoring-versus-verification line.** State that authoring is
   planned work and running existing checks is an implement-time step, so
   neither side invents the other's job.
