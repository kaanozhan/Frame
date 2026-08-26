# Plan — The upgrade path delivers what its prose promises

## Architecture

### Resolved plan-time decisions

**Business**

- **Missing `.frame/docs/REFERENCE.md` — create or ask?** → *Create when absent;
  ask only when it exists without the protocol.* The spec's S1 said "ask", decided
  before the evidence pass found that `ensureSpecDrivenArtifacts` already guards
  creation with `if (!fs.existsSync(referencePath))` — a user's own reference doc is
  never overwritten — and that `audit-q3-core-value-efficacy` T08 recorded this exact
  delivery intent ("so pre-split projects get it when enabling specs"). Creating a
  file that is absent completes T08 rather than overriding the user. **This overturns
  the spec's S1 wording deliberately**, with the user's decision at the gate.
- **A doc that exists but carries no protocol — append or ask?** → *Split by
  sub-state.* No spec section at all → append the managed block (nothing to
  conflict with, existing prose untouched). A spec section Frame cannot match →
  write nothing, ask. The second case is where a second protocol beside the user's
  own would recreate the 2026-07-23 shadowing bug; it is the only case that gets a
  prompt.

**Technical**

- **Where the prompt lives** → *A new module in `specDrivenHint.js`'s shape.*
  `healthNotice.js` is a passive one-liner with no action button and a dismissal that
  only removes a DOM node. `specDrivenHint.js` already solves both — anchored quiet
  popover, remedy offered in place, "don't show again" persisted per project through
  `IPC.SET_USER_SETTING`. Copying the proven pattern beats widening `healthNotice`'s
  contract for its three existing callers, and beats merging two unrelated triggers
  into one module.
- **Migration's meta-path prose repair** → *Dropped from this spec — the premise
  behind the original decision was wrong.* The gate chose "make the navigation
  prose a managed block" on the strength of one measurement: all seven
  `AGENTS_LINE_EDITS` targets miss on a genuine v2.4.0 AGENTS.md. The
  measurement holds; the reason assumed for it did not. Verified afterwards:
  every one of the seven **hits** the post-split (v2.5.0/v2.6.0) generation
  they were written for, so that population was never broken. They miss on
  pre-split documents because `## Project Navigation` and the pointer table do
  not exist there at all — that generation is an entirely different document,
  carrying the whole maintenance ceremony inline. A managed block over
  navigation prose is therefore unnecessary for one population and impossible
  for the other. What pre-split projects actually have is a wholesale
  previous-generation AGENTS.md (13 root-relative meta mentions across
  `## Task Management`, `## PROJECT_NOTES.md Rules`, `## STRUCTURE.json Rules`,
  `## General Rules`), which is a different question from the one this spec
  asks and belongs in its own spec, diagnosed first.
- **Test posture** → *Everything the infrastructure can reach.* The record covers
  `src/main/`, `src/shared/`, `scripts/`; `src/renderer/` has no harness (jsdom,
  playwright, @testing-library, puppeteer all re-verified absent today). Decisive
  point: this bug lives in a branch that never ran, so pure unit tests over
  `docsManagedBlock` would not have caught it — the project already drives
  `frameProject` end-to-end over temp directories (`layoutMigration.test.js`,
  `specDrivenToggle.test.js`) and that is the level this needs.
- **Where `.frame/bin/codex` gets re-ensured** *(silent)* → *`frameProject.js`, not
  `structureBootstrap.PARSER_FILES`.* The wrapper is already written by
  `runProjectInit` in `frameProject.js`; extracting it there keeps
  `structureBootstrap.js` — which sits in in-flight `audit-q3-performance-resources`'
  footprint — out of this spec entirely.
- **Engine shape for a second block** *(silent)* → *Parameterize by block name,
  keep the current exports bound to `spec-section`.* `docsManagedBlock` hardcodes
  `BLOCK_NAME`; a name parameter with the existing exports as a bound default leaves
  every current call site and all 11 existing tests untouched.
- **In-flight collision** *(silent)* → *Proceed and declare it.*
  `audit-q3-performance-resources` (implementing) and `audit-q3-cross-platform`
  (planned, untouched since 2026-07-20) both list `src/main/frameProject.js`;
  cross-platform also lists `src/shared/frameTemplates.js` and
  `src/renderer/index.js`. `frameProject.js` is the file that owns this bug — it
  cannot be planned around. The footprint below declares it so the conductor
  serializes rather than merges blind.

### The invariant

One property, checked on every project open:

> spec-driven enabled ⇒ an agent reading Frame's always-on prose can reach the
> current spec flow — or the user has been told it cannot.

Three collaborating pieces:

1. **`docsHealth` (pure)** — given the doc texts and an existence predicate,
   returns `{ missingPaths, unmatchedSections }`: every `` `.frame/…` `` path Frame's
   own prose names that is not on disk, and every doc carrying a Frame-shaped
   section no matcher recognized. No fs, no Electron — the same shape as
   `docsManagedBlock`.
2. **The repair pass** — `upgradeSpecDocs` ordered so the pointer's target exists
   before the pointer is written, with an append branch for docs that have no
   section at all.
3. **The prompt** — `docsHealthHint`, raised only from what `docsHealth` reports.

### Ordering, and why it is the fix

Today `upgradeSpecDocs` iterates `[REFERENCE.md, AGENTS.md]` and skips a missing
file with `continue`, while still rewriting AGENTS.md into a pointer at it. The
repair is: ensure the target first (through `ensureSpecDrivenArtifacts`, which is
idempotent and already exists), then upgrade the pointer. Nothing else about the
sequence changes.

### Where new branches may live

`upgradeDoc`'s control flow is the safety argument, so the new code is confined to
the one arm that returns `null` after every matcher has failed:

| state | today | after |
| --- | --- | --- |
| block at current version | `return null` | unchanged |
| block stamped older | replace in place | unchanged |
| marker fragment, no block | `return null` | unchanged |
| legacy matcher hits | replace in place | unchanged |
| nothing matched | `return null` | `onAbsent: 'append'` → append, else unchanged |

Append fires only when `findBlock` is null **and** no matcher hit **and**
`docsHealth` reports no Frame-shaped section — so a doc with a customized section
still falls through to `null`, and is reported instead.

### Scope, narrowed after the evidence

This plan shipped with a navigation-block step that the evidence pass should
have killed before the gate — see the revised D4. Steps 5 and 6 are gone and
`frameTemplates.js`, `layoutMigration.js` and their test are out of the
footprint. What remains is one coherent claim: the upgrade path ensures what
its prose names, appends where nothing conflicts, asks where something might,
and never fails silently. The pre-split AGENTS.md question is real and is left
for a spec that diagnoses it first.

## Files

- `src/shared/docsManagedBlock.js` — **Modified** — parameterize by block name;
  add `appendBlock` and `upgradeDoc`'s `onAbsent` option.
- `src/shared/docsHealth.js` — **New** — pure report: missing named paths and
  unmatched Frame-shaped sections.
- `src/shared/activityEvents.js` — **Modified** — register `docs.repaired` and
  `docs.degraded`.
- `src/shared/ipcChannels.js` — **Modified** — doc-health report and remedy channels.
- `src/main/frameProject.js` — **Modified** — call `ensureSpecDrivenArtifacts` on
  open when spec-driven is on; extract and call `ensureCodexWrapper`; reorder and
  extend `upgradeSpecDocs`; expose the doc-health report over IPC.
- `src/main/specManager.js` — **Modified** — the project-open handler calls
  `ensureProjectArtifacts` between command staging and `upgradeSpecDocs`, so
  target-before-pointer is one synchronous block rather than two racing IPC
  messages. *Added to scope during T04, with the user's approval: the plan named
  the project-open path but listed only `frameProject.js`, and the ordering the
  fix depends on lives in this handler.*
- `src/renderer/docsHealthHint.js` — **New** — the quiet popover, per-project
  dismissal, remedy actions.
- `src/renderer/index.js` — **Modified** — init the new hint module.
- `test/docsManagedBlock.test.js` — **Modified** — named blocks, append branch,
  and that a doc with a customized section is still left alone.
- `test/docsHealth.test.js` — **New** — the pure report over crafted doc texts.
- `test/specDocsUpgrade.test.js` — **New** — end-to-end over temp projects: the
  pre-split state, the customized state, and byte-identity for a healthy project.

## Footprint

- src/shared/docsManagedBlock.js
- src/shared/docsHealth.js
- src/shared/activityEvents.js
- src/shared/ipcChannels.js
- src/main/frameProject.js
- src/main/specManager.js
- src/renderer/docsHealthHint.js
- src/renderer/index.js
- test/docsManagedBlock.test.js
- test/docsHealth.test.js
- test/specDocsUpgrade.test.js

## Dependencies

None. Tests run on Node's built-in runner, already in use; the CI workflow
deliberately installs nothing, so no test may reach `node_modules`.

## Sequencing

1. **Named blocks in the engine.** Parameterize `docsManagedBlock` by block name
   with the current exports bound to `spec-section`; add `appendBlock` (footer-aware
   insertion, mirroring `ensureSpecDrivenArtifacts`) and `upgradeDoc`'s `onAbsent`
   option. Extend `test/docsManagedBlock.test.js` for named blocks, the append
   branch, and no-append-when-a-section-exists. Existing 11 tests must pass unchanged.
2. **The pure health report.** Add `src/shared/docsHealth.js` and
   `test/docsHealth.test.js`: missing `` `.frame/…` `` paths named in prose, and
   Frame-shaped-but-unmatched sections, over injected doc texts and an existence
   predicate.
3. **Repair the ordering.** In `upgradeSpecDocs`, ensure the target before the
   pointer and wire the append branch, gated on the health report. Add
   `test/specDocsUpgrade.test.js` covering the pre-split project (stale mini-flow
   gone **and** deep flow reachable), the customized-section project (nothing
   written), and a current-version project (both docs byte-identical).
4. **Re-ensure the artifacts on open.** Call `ensureSpecDrivenArtifacts` from the
   project-open path when `features.specDriven` is true; extract `ensureCodexWrapper`
   from `runProjectInit` and call it there too. Extend the step-3 test: an upgraded
   project gains `.frame/docs/REFERENCE.md`, `.frame/specs/.gitkeep` and
   `.frame/bin/codex`. Cover the **already-damaged** starting state explicitly —
   a pre-split project that has already been opened once under v2.5.0+, so its
   AGENTS.md carries the marker-wrapped pointer while the target is still
   missing. This is the most common state in the field today, and it is repaired
   entirely by this step rather than by step 3: the pointer is already correct and
   already stamped current, so `upgradeSpecDocs` leaves both docs alone and the
   fix comes from the target appearing. The test must assert that both docs are
   byte-identical across the open and the deep flow is nonetheless reachable.
5. **Record what happened.** Register `docs.repaired` and `docs.degraded` in
   `activityEvents.js` with their label functions, and record them from the open
   path. Assert the registry shape in `test/activityEvents.test.js`.
6. **Raise the prompt.** Add `src/renderer/docsHealthHint.js` in `specDrivenHint`'s
   shape — quiet popover, remedy actions for the ask-cases, per-project "don't show
   again" through `SET_USER_SETTING` — plus its IPC channels and the init call in
   `src/renderer/index.js`. No tests: `src/renderer/` has no harness, per the record.
