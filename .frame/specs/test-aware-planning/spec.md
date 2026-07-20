# Test-aware planning — detect test infrastructure, decide posture, plan the tests

## Problem

Whether a spec's work ships with tests is currently decided by whichever agent
happens to be planning, at the moment it writes `plan.md`. Sometimes it does
the right thing: `audit-q3-generic-any-project/plan.md` lists
`test/detectProject.test.js`, `test/langExtractors.test.js`,
`test/projectAgnostic.test.js`, and `test/fixtures/**` under `## Files` marked
**New**, carries all four into `## Footprint`, and folds the authoring into
T01 / T05 / T12. `audit-q3-product-analytics` does the same for
`test/telemetry.test.js`. Other specs with equally testable work plan nothing.

The mechanism already exists. What is missing is that anything *makes* the
planning run consider it. Two consequences:

- **Untracked work does not get done.** Test authoring that isn't in `tasks.md`
  isn't counted, isn't sequenced, and isn't visible to the user or to a worker.
- **Unplanned test files break orchestration.** `## Footprint` feeds the
  conflict guard (`parseFootprintMarkdown` → `getSpecFootprint` in
  `src/main/specManager.js`). A worker that invents `test/foo.test.js` at
  implementation time writes outside its declared footprint, and the
  conductor's pre-merge drift check flags it. Planning tests is what makes
  writing them safe.

The inverse failure matters just as much: a project with no test setup must not
have tests pushed onto it. Detection has to gate the whole thing.

## Goal

### 1. Detect the project's testing structure (evidence pass)

`spec.plan`'s Stage 1 evidence pass gains a testing-infrastructure probe. It
establishes, as verified evidence rather than assumption:

- whether a test runner is configured — `.frame/config.json`
  `project.commands.test` is the primary signal (this repo: `node --test test/`),
  with the project's manifest scripts as corroboration;
- where tests live and what they look like — the existing test files' location
  and naming convention, so planned tests match them rather than inventing a
  parallel structure;
- whether CI runs them.

The finding is recorded like any other Stage 1 claim: signal → verified
`file:line`, or "no test infrastructure detected".

### 2. Ask posture at the decision gate — only when infrastructure exists

When the probe finds test infrastructure, Stage 2's **technical** stage asks
one question: how much of this spec's work should ship with tests. Real
options with trade-offs, recommendation first — the same shape as every other
gate question. The answer is recorded in `## Architecture`'s
`### Resolved plan-time decisions` with its rationale, like every other gate
decision.

When the probe finds **no** test infrastructure, the question is never asked,
no test work is planned, and the plan says nothing about testing. Frame does
not introduce a testing practice to a project that hasn't chosen one.

### 3. Carry the decision into the plan's structure

When the gate decides tests are in scope, they stop being prose and become
planned artifacts:

- `## Files` — each new or modified test file listed, marked **New** where it
  is, exactly as `audit-q3-generic-any-project` does today.
- `## Footprint` — those paths included, so the conflict guard and the drift
  check both know about them.
- `## Sequencing` — test authoring attached to the step that produces the code
  it covers, not deferred to a trailing "write tests" step. A step's work is
  not done until its tests are.

### 4. Test work reaches `tasks.md`

Because tests are in `## Files` and `## Sequencing`, `spec.tasks` derives them
like any other work — folded into the task that produces the code, in the
style already used by `audit-q3-generic-any-project` T01 ("… with
`test/detectProject.test.js`"). No separate mechanism, no test-only task
category.

### 5. Draw the line against implement-time verification

Planned test **authoring** and implement-time **verification** are different
things and must not collapse into each other:

- Authoring — writing new test code — is planned work, in `tasks.md`.
- Verification — running the project's existing checks after a change — is an
  implementation-time step and belongs to the implement flow.

The plan template says so explicitly, so a planning run does not emit "run
`npm test`" as a task, and an implementation run does not invent test files
because it thinks the plan forgot them.

## Constraints

- **`src/templates/commands/claude-code/spec.plan.md` is the only file this
  spec changes.** No code, no other template. It is in no other spec's
  footprint, so this work is parallel-safe with `deep-spec-tasks` and
  `implement-modes`.
- **Detection gates everything.** No detected infrastructure → no gate
  question, no test entries in Files/Footprint/Sequencing, no test tasks.
- **No framework assumptions.** The template names no runner, no assertion
  library, no directory convention. Everything comes from what the probe found
  in the project. Nothing from this repo's own `node --test` setup leaks into
  the shipped template.
- **Plan format unchanged** — the same five sections. Test entries are ordinary
  entries in `## Files`, `## Footprint`, and `## Sequencing`; no new section,
  no new heading. `parseFootprintMarkdown` must keep working untouched.
- **The gate stays bounded.** This adds at most one question to the technical
  stage, inside the existing 3-round cap. It does not get its own stage.
- **Existing lifecycle unchanged** — `plan.md` + `status.json` phase `planned`;
  `spec.tasks`, the watcher, tasks sync, and orchestration need no changes.
- Template override precedence preserved; `codex` / `gemini` untouched.

## Success Criteria

- Planning a spec in a project **with** test infrastructure surfaces the
  detected runner and test-file convention as Stage 1 evidence, and asks
  exactly one technical gate question about test posture.
- Planning a spec in a project **without** test infrastructure asks nothing
  about tests and produces a plan containing no test work.
- When the gate puts tests in scope, every planned test file appears in both
  `## Files` and `## Footprint`, and `getSpecFootprint` returns them.
- The posture decision appears under `### Resolved plan-time decisions` with
  its rationale.
- `spec.tasks` run on such a plan produces tasks that carry the test work
  alongside the code it covers — no standalone "write the tests" task at the
  end.
- No plan emits running an existing test command as a task.
- Planned test files match the project's existing location and naming
  convention rather than a new one.
- A plan produced for a spec with no testable surface (docs, templates, config)
  contains no test work even when infrastructure exists — the gate's answer can
  legitimately be "none".

## Out of Scope

- Setting up test infrastructure in a project that has none — Frame detects,
  it does not install runners or scaffold a suite.
- Enforcing coverage thresholds or any quality bar on planned tests.
- Changing `spec.tasks` or `spec.implement` — they inherit the effect through
  the plan. (`deep-spec-tasks` and `implement-modes` are separate specs.)
- Running tests during planning.
- Backfilling test plans into already-planned specs.
- CI configuration authoring beyond noting whether CI runs the suite.
- `codex` / `gemini` variants.

## Open Questions

- **What the posture options actually are.** Candidates: everything gets tests
  / only pure logic and data transforms / only the spec's stated success
  criteria / none this time. Too many options makes the gate tedious; too few
  makes it useless. The set needs to be decided at plan time and stated in the
  template.
- **How the probe judges "test infrastructure exists" when signals conflict** —
  e.g. `project.commands.test` is present because `detect-project` guessed
  `npm test`, but the project has no test files. Trust the config, trust the
  filesystem, or require both?
- **Whether UI-level tests are in scope of the question at all.** This repo has
  unit tests but no renderer/UI test harness. Asking "should this ship with
  tests" about a renderer change in a project with only unit-test
  infrastructure may produce plans that can't be executed. Should the probe
  distinguish test *kinds* and scope the question to what the project can
  actually run?
- **Interaction with `deep-spec-tasks`' cross-check.** If the plan report's
  coverage matrix maps a success criterion to a test, and the tasks pass
  reconciles against it, a test task could be created twice — once from
  `## Sequencing`, once from the report. The dedup rule needs stating in
  whichever spec lands second.
- **Whether the posture decision should also be recorded in `status.json`** so
  the implement flow can read it, or whether `plan.md` alone is enough.

RESOLVED at spec time:
- Test **authoring** is planned; test **verification** is an implement-time
  step. They are distinct and the template says so (decided 2026-07-20).
- Detection gates the gate: no infrastructure → no question, no test work
  (decided 2026-07-20).
- Tests ride in the existing `## Files` / `## Footprint` / `## Sequencing`
  sections — no new plan section and no test-only task category
  (decided 2026-07-20).
