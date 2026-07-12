# Plan — Core value-prop efficacy — does Frame actually help the agent?

## Architecture

Two tracks, per the spec: **tighten the mechanisms** (lean, accurate, fresh
context) and **build an evidence layer** (a repeatable measurement of the
orientation benefit). All changes stay inside the existing shapes — plain
git-versioned files as the canonical store, `scripts/` for repo tooling,
`src/shared/frameTemplates.js` as the single source for what new Frame
projects get.

### 1. AGENTS.md split — lean always-on core + reference-on-demand

- **Always-on core** (`AGENTS.md`, target ≤ ~100 lines): project navigation
  (read STRUCTURE.json / PROJECT_NOTES.md / tasks.json), `find-module.js`
  usage, the Core Working Principle, the spec-driven ladder, and the
  orchestration summary. Everything an agent needs *every* session.
- **Reference-on-demand** (`.frame/docs/REFERENCE.md`, new): the maintenance
  ceremony that today makes up ~85% of AGENTS.md — the full tasks.json field
  schema and content rules, PROJECT_NOTES cadence/format, STRUCTURE.json
  format examples, QUICKSTART rules, completion-signal heuristics. The core
  links to it with per-file pointers ("before writing tasks.json, read the
  Task section of `.frame/docs/REFERENCE.md`") so agents load it only when
  they are about to write a meta file. Stays tool-agnostic — no Claude-only
  assumptions.
- The shipped template mirrors the split: `getAgentsTemplate()` in
  `src/shared/frameTemplates.js` is slimmed the same way, a new
  `getReferenceTemplate()` provides the reference doc, and
  `src/main/frameProject.js` writes `.frame/docs/REFERENCE.md` during project
  init (both fresh-init and spec-driven upgrade paths). The static copy at
  `src/templates/CLAUDE.md` is kept in sync.

### 2. STRUCTURE.json generation — accurate, deterministic, honest

All in `scripts/update-structure.js`:

- **Full reconcile every run.** After processing, sweep `structure.modules`
  and delete any entry whose `file` no longer exists on disk (~90 `fs.existsSync`
  calls — cheap). This runs in *all* modes, so `--changed` no longer depends
  on the staged diff to catch deletions. Fixes the phantom
  `renderer/specDetailModal` class of bug permanently.
- **Kill garbage purpose extraction.** Rewrite `extractFunctionPurpose()` to
  identify the *enclosing comment block* above the function (walk up to the
  block start, then take the block's first content line) instead of grabbing
  the nearest comment-looking line — which is how mid-comment fragments like
  the `aiToolManager.loginShell` garbage got captured. A `//` comment counts
  only if it sits on the line immediately above the declaration. When no
  clean purpose is found, omit the field rather than emit a fragment.
- **Deterministic output.** Sort `modules` keys alphabetically before save;
  only bump `lastUpdated` when module/ipc/intent content actually changed
  (compare serialized content, ignoring `lastUpdated` itself). Repeated runs
  on an unchanged tree produce a byte-identical file.
- **intentIndex becomes a curated concept map, not suffix-stripping.** The
  hardcoded alias table (lines 517–545) moves to a new agent-editable data
  file, `scripts/intent-map.json`: `{ "<concept>": { "modules": [...],
  "synonyms": [...] } }`. Generation = curated entries first, then
  auto-grouping only for suffix groups that span **≥ 2 files** (multi-file
  groups like `github` are where the index beats `ls`; thin single-file
  intents like `menu`/`state` are dropped — `find-module.js`'s existing deep
  search over module keys/descriptions still finds them, so nothing is lost).
  Synonyms let `find-module.js auth` hit `ai-tool`, giving real
  concept→file mapping beyond filename echoes.
- **architectureNotes honestly handled.** Preserve the field verbatim across
  regens when present; omit the key entirely when empty (never emit an empty
  object that looks populated). Seed the live STRUCTURE.json with a few real
  notes (e.g. the manager/panel IPC pattern, esbuild renderer bundle,
  orchestration command bus) as a one-time manual edit.

### 3. Freshness — detect and surface staleness

- New `scripts/check-freshness.js` (CLI, same style as `find-module.js`,
  honors `FRAME_PROJECT_ROOT`). Checks, each emitting a one-line warning:
  - **Phantom modules** — STRUCTURE.json entries whose file is missing on disk.
  - **STRUCTURE drift** — `lastUpdated` older than the last commit touching
    `src/**/*.js` (via `git log -1 --format=%cs -- src`).
  - **Notes staleness** — last `### [YYYY-MM-DD]` heading in PROJECT_NOTES.md
    vs. commit activity since (warn when N+ commits have landed after it).
  - **Stuck tasks** — tasks.json entries `in_progress` for more than 14 days
    (from `updatedAt`).
  - **QUICKSTART staleness** — QUICKSTART.md's last git-commit date vs. commit
    activity since (same N+-commits heuristic as notes; warn-only).
  Modes: default human-readable warn-only (always exit 0), `--json` for
  machine use, `--strict` to exit 1 on findings (usable as a CI gate later —
  not wired into CI by this spec).
- **Surfacing** (help, not nagware): `find-module.js` prints a `⚠ file
  missing on disk — run npm run structure` marker next to any result whose
  file doesn't exist, plus a single staleness banner when STRUCTURE drift is
  detected; the pre-commit hook runs `check-freshness.js` in warn-only mode
  after the structure update (informational, never blocks the commit).
- **Shipping**: add `check-freshness.js` to `PARSER_FILES` in
  `src/main/structureBootstrap.js` so user projects get it in `.frame/bin/`,
  and add a `"freshness"` npm script for this repo.

### 4. Evidence layer — orientation eval harness (internal instrument)

Answering the spec's open question: a **fixed local task suite** over
opt-in telemetry — deterministic, cheap, zero privacy surface, and a
defensible A/B (same task, same repo snapshot, only the context differs).
Lives under `scripts/eval/` (repo tooling, not shipped product surface).

- **`scripts/eval/tasks.json`** — ~10 fixed tasks against Frame's own repo
  pinned to a recorded commit hash. Each task: `id`, `prompt` (e.g. "add a
  keyboard shortcut that toggles the GitHub panel"), `expectedFiles` (the
  files a correct change touches), `successCheck` (a shell command run in the
  worktree — grep for the expected change, or a targeted `node` assertion).
- **`scripts/eval/run-eval.js`** — for each task × arm (`frame` / `bare`):
  create an ephemeral `git worktree` at the pinned commit; in the `bare` arm
  delete AGENTS.md, CLAUDE.md, STRUCTURE.json, PROJECT_NOTES.md, tasks.json
  and `scripts/find-module.js`; run the agent headless
  (`claude -p <prompt> --output-format stream-json`, binary and flags
  configurable so other CLIs can slot in) with a per-task timeout; save the
  transcript JSON and the resulting `git diff` under `scripts/eval/results/`;
  remove the worktree.
- **`scripts/eval/score.js`** — deterministic scoring from transcript + diff,
  no LLM judging: **wrong-file-edit rate** (edited files ∉ `expectedFiles`),
  **search effort** (count of Grep/Glob/`grep`-in-Bash tool calls before the
  first edit), **first-try success** (`successCheck` pass on the produced
  diff), plus turns and token totals from the transcript. Emits a per-arm
  summary table — the repeatable number the value prop currently lacks.
- **`scripts/eval/README.md`** — method, how to run, how to interpret; the
  pinned commit and the first baseline numbers get recorded here.
- `scripts/eval/results/` is gitignored (transcripts are bulky); only the
  README summary is versioned.

## Files

- `scripts/update-structure.js` — **Modified** — full deletion reconcile in all modes, comment-block-aware purpose extraction, deterministic sort/idempotent save, intentIndex from `intent-map.json` + ≥2-file grouping, architectureNotes preserve-or-omit.
- `scripts/intent-map.json` — **New** — curated, agent-editable concept→modules map with synonyms (replaces the hardcoded alias table).
- `scripts/find-module.js` — **Modified** — missing-file warning per result, STRUCTURE staleness banner, synonym-aware lookup.
- `scripts/check-freshness.js` — **New** — phantom/drift/notes/stuck-task staleness report (`--json`, `--strict`).
- `.githooks/pre-commit` — **Modified** — run `check-freshness.js` warn-only after the structure update.
- `src/main/structureBootstrap.js` — **Modified** — add `check-freshness.js` (and `intent-map.json` seed) to the files copied into user projects' `.frame/bin/`.
- `src/shared/frameTemplates.js` — **Modified** — slim `getAgentsTemplate()` to the lean core; add `getReferenceTemplate()`.
- `src/main/frameProject.js` — **Modified** — write `.frame/docs/REFERENCE.md` during init/upgrade.
- `src/templates/CLAUDE.md` — **Modified** — sync the static template copy with the lean core.
- `AGENTS.md` — **Modified** (meta file) — slimmed to the lean always-on core.
- `.frame/docs/REFERENCE.md` — **New** — the moved-out maintenance/schema reference for this repo.
- `scripts/eval/tasks.json` — **New** — fixed eval task suite (pinned commit, expected files, success checks).
- `scripts/eval/run-eval.js` — **New** — worktree-per-run A/B harness (frame vs. bare context).
- `scripts/eval/score.js` — **New** — deterministic scoring: wrong-file edits, search effort, first-try success.
- `scripts/eval/README.md` — **New** — method + baseline results.
- `package.json` — **Modified** — add `"freshness"` npm script.
- `.gitignore` — **Modified** — ignore `scripts/eval/results/`.
- `STRUCTURE.json` — **Modified** (meta file) — regenerated: phantoms removed, garbage purposes gone, architectureNotes seeded.

## Scope notes

- **Injection is out of scope.** The spec's Problem section diagnoses the
  injection gap (Codex one-shot nudge, Gemini bare launch, STRUCTURE/NOTES
  never injected), but the Goal and success criteria define only the two
  tracks above. Fixing injection is a separate spec — not forgotten here.
- **Meta-file steps need a non-worker lane.** `AGENTS.md` (step 6) and
  `STRUCTURE.json` (step 8) are meta files: orchestrator workers must never
  touch them and they are excluded from the Footprint below. Those two steps
  run as manual/conductor commits (or the whole spec runs outside the
  orchestrator); the rest is worker-safe.

## Footprint

- scripts/update-structure.js
- scripts/intent-map.json
- scripts/find-module.js
- scripts/check-freshness.js
- scripts/eval/**
- .githooks/pre-commit
- src/main/structureBootstrap.js
- src/shared/frameTemplates.js
- src/main/frameProject.js
- src/templates/CLAUDE.md
- .frame/docs/REFERENCE.md
- package.json
- .gitignore

## Dependencies

None. The eval harness shells out to the locally installed agent CLI
(`claude`) and `git`; scoring is plain Node with no new packages.

## Sequencing

1. **Reconcile + determinism in `update-structure.js`** — delete modules
   whose files are missing (all modes), sort module keys, skip the
   `lastUpdated` bump when content is unchanged. Run `npm run structure` and
   confirm the phantom `renderer/specDetailModal` disappears and a second run
   is byte-identical.
2. **Fix purpose extraction** — comment-block-aware `extractFunctionPurpose`;
   regenerate and spot-check that `main/aiToolManager.loginShell` no longer
   carries the mid-comment fragment.
3. **intentIndex rework** — add `scripts/intent-map.json` (migrating the
   existing alias table, plus synonyms), generate curated + ≥2-file groups
   only, and teach `find-module.js` synonym lookup. Verify
   `find-module.js github`, a synonym query, and a dropped single-file intent
   (deep-search fallback) all resolve.
4. **Missing-file warning in `find-module.js`** — per-result existence check
   with the ⚠ marker and the staleness banner.
5. **`check-freshness.js`** — implement the five checks (phantoms, STRUCTURE
   drift, notes, stuck tasks, QUICKSTART) with `--json` /
   `--strict`; add the `"freshness"` npm script; wire warn-only into
   `.githooks/pre-commit`; add it to `PARSER_FILES` in
   `structureBootstrap.js`. Verify it flags the stuck Jan-2026
   `in_progress` tasks and the PROJECT_NOTES gap on the live repo.
6. **AGENTS.md split** — write `.frame/docs/REFERENCE.md`, slim `AGENTS.md`
   to the lean core with per-file pointers into the reference; record the
   before/after line and approximate token counts in the commit message
   (success criterion: materially shorter, no lost project-specific guidance).
   *Meta-file step — manual/conductor commit, not an orchestrator worker.*
7. **Template split** — mirror step 6 in `frameTemplates.js`
   (`getAgentsTemplate` + new `getReferenceTemplate`), write the reference
   doc from `frameProject.js` on init/upgrade, sync `src/templates/CLAUDE.md`.
   Initialize a scratch project to verify the new layout.
8. **Seed `architectureNotes`** — add 3–5 real notes to the live
   STRUCTURE.json and confirm they survive a regen.
   *Meta-file step — manual/conductor commit, not an orchestrator worker.*
9. **Eval suite definition** — `scripts/eval/tasks.json` with ~10 tasks,
   expected files, and success checks against a pinned commit; gitignore
   `scripts/eval/results/`.
10. **Eval runner** — `scripts/eval/run-eval.js` (worktree per task×arm,
    bare-arm context stripping, headless agent invocation, transcript + diff
    capture). Smoke-test with a single task in both arms.
11. **Eval scorer + baseline** — `scripts/eval/score.js`, then run the full
    suite in both arms and record the first baseline numbers and method in
    `scripts/eval/README.md` — turning "Frame helps" from an assertion into
    a measured result.
