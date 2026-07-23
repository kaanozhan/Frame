# Plan — CLI parity for spec commands — the full flow without the button

## Architecture

### Resolved plan-time decisions

- **D1 · CLI entry mechanism (asked, business)** — **Docs-taught protocol only**, no `.claude/commands/` shims. One maintenance surface, tool-agnostic, and it honors Frame's existing stance of never writing into the user's own `.claude/` (`src/main/specManager.js:434`). The spec's observed failure is *conversational* entry ("run spec.implement"), which only a docs protocol can catch — shims would be a tool-specific shortcut layered on top, at the cost of a second staged surface.
- **D2 · Target-spec resolution (asked, business)** — **Deterministic rule in the docs**: list specs in the phase actionable for the command (`spec.plan` → `specified`, `spec.tasks` → `planned`, `spec.implement` → `tasks_generated`/`implementing`); exactly one candidate → take it silently; zero or several → present candidates and ask. An explicitly named spec always wins. Reproducible across sessions and tools.
- **D3 · Legacy migration scope (asked, technical)** — **Both REFERENCE.md and AGENTS.md.** Older Frame generations shipped the full obsolete section directly into AGENTS.md (`src/shared/frameTemplates.js:22-26` docstring), and AGENTS.md is loaded every session — it is the primary drift source. REFERENCE.md gets the full-protocol managed block; AGENTS.md gets the short pointer managed block.
- **D4 · Test posture (asked, technical)** — **Pure logic and data transforms only**, per the project's recorded convention (pure modules tested, Electron-coupled wrappers skipped). The engine and staging-plan logic are designed pure so the convention reaches them.
- **D5 · Staging refresh trigger (silent)** — **Project open (`WATCH_SPECS`) plus init/enable only; no manual bin refresh path.** A `.frame/bin/` script cannot reach Frame's packaged templates while the app is closed (they live in app.asar), so a manual refresh cannot deliver anything newer than what is already staged. The protocol text keeps `implement-launch.js`'s existing answer: "open this project in Frame once".
- **D6 · Autonomous handoff wording (silent — resolved by drift)** — The spec's open question is already answered by shipped v2 code: `spec.implement.md:61-72` prints **both** the Frame button and the exact `node .frame/bin/implement-launch.js <slug>` line. Keep it; the managed block repeats the same two-option handoff and states the ceiling (C4).
- **D7 · Version gate mechanism (silent)** — Monotonic integer stamped in the begin marker (`<!-- frame:managed:spec-section v=N -->`), compared against a `SPEC_SECTION_VERSION` constant in `frameTemplates.js`. Rewrite iff stamped < current. Preserves user tweaks inside the block between Frame releases; the spec mandates a version stamp over content-compare.
- **D8 · Code placement (silent)** — Pure block surgery in a new `src/shared/docsManagedBlock.js` (testable per convention); file staging in a new `src/main/commandStaging.js` required by both `specManager` and `frameProject` (avoids a `frameProject ↔ specManager` require cycle at init-time staging); the docs-upgrade driver in `frameProject.js`, which already owns AGENTS/REFERENCE emission.
- **D9 · Self-serve interpolation paths (silent)** — The protocol teaches interpolating `{report_template_path}` / `{report_generator_path}` to the staged `.frame/runtime/commands/<tool>/` copies (guaranteed by S1 staging) — no agent-side copying. Template resolution order taught as: project override `.frame/templates/commands/<tool>/<cmd>.md` first, then the staged runtime copy — mirroring `loadCommandTemplate` (`specManager.js:279-283`) and `implement-launch.js:112-118` (C2).
- **D10 · Tool coverage (silent)** — Staging iterates the tool directories that actually exist under packaged `src/templates/commands/` (claude-code is the only populated one today). Mechanism tool-agnostic, content claude-code-only, per Out of Scope.
- **D11 · Legacy-locate confidence gate (silent)** — A legacy section migrates only when its heading exactly matches a known shipped heading **and** its body byte-matches a known shipped generation text (both were unparameterized constants, so byte comparison is sound; whitespace-normalized). A heading match with a rewritten body means the user customized it → leave the whole file alone (S5). This repo's own customized docs are the living counterexample that heading-only matching would clobber.

### Components

**1. Current-generation docs content** (`src/shared/frameTemplates.js`)
- `SPEC_SECTION_VERSION` — integer, bumped whenever managed-block content changes.
- Managed-block markers: `<!-- frame:managed:spec-section v=N -->` … `<!-- /frame:managed:spec-section -->` (HTML comments — invisible in rendered markdown).
- New full-protocol section (replaces `SPEC_DRIVEN_SECTION` as the REFERENCE.md payload). Teaches, for a CLI session asked conversationally to run `spec.new`/`spec.plan`/`spec.tasks`/`spec.implement`:
  1. Resolve the target spec by the D2 deterministic rule.
  2. Resolve the template: `.frame/templates/commands/<tool>/<cmd>.md` override first, else `.frame/runtime/commands/<tool>/<cmd>.md` staged copy. If neither exists: say "open this project in Frame once so it stages the templates" and stop — **never improvise the flow from memory**.
  3. Interpolate the placeholders (table per command: `{project_path}`, `{slug}`, `{title}`, `{description}`, `{report_template_path}`, `{report_generator_path}` → staged runtime paths per D9).
  4. Follow the interpolated template exactly, including its `status.json` updates.
  5. Autonomous ceiling (C4): a running session cannot acquire launch flags; the implement template's record-choice-then-hand-off behavior is the documented boundary.
- Updated `SPEC_DRIVEN_CORE_SECTION` (AGENTS.md short pointer): keeps the ladder + REFERENCE.md pointer, adds one line — spec commands are never run from memory; the protocol lives in REFERENCE.md.
- `getReferenceTemplate` / `getAgentsTemplate` / the `enableSpecDriven` append path emit these sections **wrapped in markers, stamped current** (G3: new projects are born managed).
- Known legacy texts (the current `SPEC_DRIVEN_SECTION` and `SPEC_DRIVEN_CORE_SECTION` bodies with their shipped headings) exported as migration matchers for D11.

**2. Managed-block engine** (`src/shared/docsManagedBlock.js` — New, pure, no fs)
- `findBlock(text)` → `{ start, end, version }` or null (parse markers + stamp).
- `upgradeDoc(text, { body, version, legacyMatchers })` → new full-file text, or `null` for no change. Logic: markers present & stamped ≥ current → null; markers present & stamped < current → replace block body in place; no markers → try one-time legacy migration: locate a heading-bounded section whose heading + body pass the D11 gate, replace exactly that span with the marked block; no confident match → null. Every byte outside the replaced span is preserved verbatim (C1/S4).

**3. Command staging** (`src/main/commandStaging.js` — New)
- `resolveStagingPlan(projectPath, tool, existsFn)` — pure: returns `[{src, dst}]` for the four templates + `plan-report-template.html` + `build-implement-report.mjs` into `.frame/runtime/commands/<tool>/`, plus `implement-launch.js` into `.frame/bin/`, resolving each source override-first (C2).
- `stageCommandFiles(projectPath)` — executes the plan for every available tool dir via write-if-changed (the existing `copyIfChanged` semantics move here from `specManager.js:384-402`), chmods the bin helper. Absorbs and retires `stageImplementCommandFiles` (`specManager.js:409-426`) — same paths, superset of files, so the v2 slice's behavior is preserved.

**4. Docs upgrade driver** (`src/main/frameProject.js`)
- `upgradeSpecDocs(projectPath)` — for `.frame/docs/REFERENCE.md` (full-protocol block) and `AGENTS.md` (pointer block): read if present, run the engine, write back only when it returns text. Skips files that don't exist; never creates them. Only runs when the project has `.frame/` (non-Frame projects untouched).

**5. Wiring**
- `WATCH_SPECS` handler (`specManager.js:1109-1118`): replace the `stageImplementCommandFiles` call with `commandStaging.stageCommandFiles` + `frameProject.upgradeSpecDocs` (both wrapped in the existing try/catch — staging failures never break watching). This is the "project open" trigger (G1, G3-existing), fired on every project switch (`src/renderer/index.js:179`).
- `buildSpecCommandFile` (`specManager.js:558-580`): the implement branch calls the generalized `stageCommandFiles` instead of `stageImplementCommandFiles`; everything else — prompt file, `stageCommandAssets`, launch flags, instruction — unchanged (C3).
- Init (`frameProject.js runProjectInit`) and `enableSpecDriven`: emit marked docs (component 1) and call `stageCommandFiles` (G3-new).

### UI path unchanged (C3)

The UI dispatch chain (`BUILD_SPEC_COMMAND_FILE` → prompt file → instruction → launch flags) is untouched; watcher-side reconcile and task import (`specManager.js:1060-1076`) key off files appearing in `.frame/specs/<slug>/` and are trigger-agnostic already — a CLI-authored `plan.md`/`tasks.md` flows through the same `pushSpecData` → `reconcilePhase` → `syncTasksFromMarkdown` path with no changes.

## Files

- `src/shared/docsManagedBlock.js` — **New** — pure managed-block engine: marker parse, version gate, in-place block replacement, D11 legacy locate.
- `src/shared/frameTemplates.js` — **Modified** — `SPEC_SECTION_VERSION`, marker wrappers, new full-protocol section, updated core pointer section, legacy matchers, marked emission in `getReferenceTemplate`/`getAgentsTemplate`.
- `src/main/commandStaging.js` — **New** — pure staging-plan resolution + write-if-changed executor for templates/assets/helper.
- `src/main/specManager.js` — **Modified** — `WATCH_SPECS` and implement-dispatch wiring to `commandStaging` + `upgradeSpecDocs`; `stageImplementCommandFiles`/`copyIfChanged` retired into `commandStaging`.
- `src/main/frameProject.js` — **Modified** — `upgradeSpecDocs` driver; init/`enableSpecDriven` emit marked sections and stage command files.
- `src/templates/commands/claude-code/spec.new.md` — **Modified** — C5 audit: wording that assumes a Frame-launched session made entry-agnostic.
- `src/templates/commands/claude-code/spec.plan.md` — **Modified** — same C5 audit.
- `src/templates/commands/claude-code/spec.tasks.md` — **Modified** — same C5 audit.
- `src/templates/commands/claude-code/spec.implement.md` — **Modified** — same C5 audit (conversational entry/handoff already correct per D6; expected minimal).
- `test/docsManagedBlock.test.js` — **New** — engine tests: version gating, in-place replacement byte-identity outside the block, D11 confidence gate (shipped body migrates once; customized body untouched), template round-trip (emitted docs parse at current version).
- `test/commandStaging.test.js` — **New** — pure staging-plan tests: override-first source resolution, full file set per tool, bin helper destination.

## Footprint

- src/shared/docsManagedBlock.js
- src/shared/frameTemplates.js
- src/main/commandStaging.js
- src/main/specManager.js
- src/main/frameProject.js
- src/templates/commands/claude-code/spec.new.md
- src/templates/commands/claude-code/spec.plan.md
- src/templates/commands/claude-code/spec.tasks.md
- src/templates/commands/claude-code/spec.implement.md
- test/docsManagedBlock.test.js
- test/commandStaging.test.js

## Dependencies

None.

## Sequencing

1. **Managed-block engine.** Write `src/shared/docsManagedBlock.js` (findBlock, upgradeDoc, D11 legacy locate) with `test/docsManagedBlock.test.js` covering: stamped-current no-op, stamped-older in-place upgrade with byte-identical surroundings, no-markers + shipped-body one-time migration, no-markers + customized-body left alone, malformed markers left alone.
2. **Current-generation docs content.** In `frameTemplates.js`: `SPEC_SECTION_VERSION`, marker wrappers, the full self-serve protocol section (D2 rule, D9 paths, placeholder table, C4 ceiling with the D6 handoff), the updated core pointer section, legacy matchers; wire marked emission into `getReferenceTemplate`/`getAgentsTemplate`/`enableSpecDriven` append. Extend `test/docsManagedBlock.test.js` with round-trip assertions (freshly emitted docs parse at current version; legacy matchers match the previous shipped bodies).
3. **Generalized staging.** Write `src/main/commandStaging.js` (pure `resolveStagingPlan` + executor); rewire `specManager.js` (`WATCH_SPECS`, implement dispatch) and `frameProject.js` (init, `enableSpecDriven`) to it; delete `stageImplementCommandFiles` and move `copyIfChanged`. Add `test/commandStaging.test.js` for the pure resolution logic.
4. **Docs upgrade on open.** Add `upgradeSpecDocs` to `frameProject.js` and call it from the `WATCH_SPECS` handler beside staging: version-gated rewrite plus the one-time legacy migration for REFERENCE.md and AGENTS.md, writes only on change.
5. **Template text audit (C5).** Sweep the four command templates for phrasing that assumes Frame launched the session (modal references, "the dispatch", report-button phrasing); make entry-agnostic without changing any stage, mode, or output contract — the UI-dispatched run must read identically in behavior.
