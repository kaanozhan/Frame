# Outcome — Core value-prop efficacy — does Frame actually help the agent?

## T01 — Full deletion reconcile + deterministic output in update-structure.js

Added `reconcileDeletedModules()` sweeping every module against the disk in all modes (not just `--changed` off the staged diff), sorted module keys, and made `saveStructure` keep the previous `lastUpdated` when content is unchanged — a regen on an unchanged tree is byte-identical (verified by sha256). The phantom `renderer/specDetailModal` entry is gone (92→91 modules) and the dead `getDeletedFiles()` was removed. Files: `scripts/update-structure.js`, `STRUCTURE.json`. Commit `a876783`.

_Captured: 2026-07-06 · 2 file change(s)_

---

## T02 — Comment-block-aware purpose extraction

Rewrote `extractFunctionPurpose` to take the FIRST content line of the `//` run or `/* */` block ending immediately above a declaration (JSDoc `@tags` skipped), and to omit the field when no comment sits directly above — no more mid-comment fragments like `aiToolManager.loginShell`'s. Purpose coverage dropped 568→542; the 26 removed were far-away/fragment false positives, which is the intended strictness. Files: `scripts/update-structure.js`, `STRUCTURE.json`. Commit `67edfb4`.

_Captured: 2026-07-06 · 2 file change(s)_

---

## T03 — Curated intent-map.json replaces suffix-only intentIndex

Created `scripts/intent-map.json` (21 curated concepts with synonyms, migrating the hardcoded alias table and adding orchestration/specs/tasks/git-changes/crash/commands…) and reworked `generateIntentIndex`: curated entries first (missing module keys skipped), then auto-grouping only for suffix groups spanning ≥2 files. intentIndex went 68→24 real concepts; one divergence from plan wording: an unclaimed module whose stripped name collides with a curated concept is skipped rather than appended, so demo/sample files can't pollute curated groups (deep search still finds them — verified with `menu`/`workspace`). Files: `scripts/intent-map.json` (new), `scripts/update-structure.js`, `STRUCTURE.json`. Commit `35c848f`.

_Captured: 2026-07-06 · 3 file change(s)_

---

## T04 — Synonym lookup, missing-file warning, staleness banner in find-module.js

Added synonym resolution from intent-map.json between exact and partial matching (`auth`→ai-tool, `worktree`→git-branches verified), a per-result `⚠ file missing on disk` marker, and a one-line banner when `STRUCTURE.lastUpdated` predates the last commit touching src (verified by backdating). Also stopped re-loading STRUCTURE.json per result inside `printResults`. Files: `scripts/find-module.js`. Commit `1d2e7ff`.

_Captured: 2026-07-06 · 1 file change(s)_

---

## T05 — check-freshness.js staleness report + npm run freshness

Implemented five warn-only checks — phantom modules, STRUCTURE drift vs. last src commit, PROJECT_NOTES falling ≥10 commits behind, tasks stuck `in_progress` >14 days, QUICKSTART commit-age drift — with `--json` and `--strict` (exit 1) modes, plus a `freshness` npm script. First live-repo run flagged 9 findings including the audit's Jan-2026 stuck tasks (161–162 days) and QUICKSTART 174 commits behind. Files: `scripts/check-freshness.js` (new), `package.json`. Commit `49a3968`.

_Captured: 2026-07-06 · 2 file change(s)_

---

## T06 — Ship check-freshness + intent-map seed to user projects; hook wiring

Added `check-freshness.js` and `intent-map.json` to `PARSER_FILES`, wired `check-freshness.js` warn-only into `.githooks/pre-commit` after the structure update, and added both files to electron-builder's `files` list. Divergence worth knowing: the intent map is seeded as a skeleton (`_comment` only) instead of copying Frame's own curation — Frame's module keys don't exist in user projects — and it is seed-once/never-overwritten since it's per-project agent curation. Verified in a scratch project: 4 files copied, second run preserves an edited intent-map, freshness runs clean via `FRAME_PROJECT_ROOT`. Files: `src/main/structureBootstrap.js`, `.githooks/pre-commit`, `package.json`. Commit `1868f78`.

_Captured: 2026-07-06 · 4 file change(s)_

---

## T07 — AGENTS.md split: lean always-on core + reference-on-demand

Slimmed AGENTS.md 327→94 lines (~11.8KB→3.7KB, ~2.7k→~850 tokens per session): working principle, navigation + find-module/freshness usage, spec ladder, a per-file pointer table, and the orchestration summary. The maintenance ceremony (task schema/rules, notes cadence, STRUCTURE rules, quickstart rules, spec-suggestion script, full orchestration detail) moved to the new `.frame/docs/REFERENCE.md`; CLAUDE.md stays a symlink and before/after counts are recorded in the commit message per plan. Files: `AGENTS.md`, `.frame/docs/REFERENCE.md` (new). Commit `ba438a5`.

_Captured: 2026-07-06 · 2 file change(s)_

---

## T08 — Mirror the split in shipped templates + init/upgrade paths

Slimmed `getAgentsTemplate()` to a 63-line core, added `getReferenceTemplate()` (232 lines), and made `frameProject.js` write `.frame/docs/REFERENCE.md` on fresh init AND in `ensureSpecDrivenArtifacts` (so pre-split projects get it when enabling specs). Divergence: enabling spec-driven now appends the new short `SPEC_DRIVEN_CORE_SECTION` (pointer into the reference) instead of the full section, keeping upgraded AGENTS.md files lean too; static `src/templates/CLAUDE.md` synced (135 Turkish lines → 73-line English lean core). Verified via scratch-project init + enableSpecDriven; 31/31 tests pass. Files: `src/shared/frameTemplates.js`, `src/main/frameProject.js`, `src/templates/CLAUDE.md`. Commit `0651a55`.

_Captured: 2026-07-06 · 4 file change(s)_

---

## T09 — Seed architectureNotes; preserve-or-omit across regens

Seeded five hand-written notes the regex parser could never produce — manager/panel IPC pattern, esbuild renderer bundle, orchestration command bus, meta-file watcher self-write debouncing, dual-homed scripts/↔.frame/bin contract — and made `saveStructure` preserve the field verbatim when present and delete it when `{}` (both verified across regens). Meta-file change made directly per user instruction, outside an orchestrator worker lane as plan.md's scope note requires. Files: `scripts/update-structure.js`, `STRUCTURE.json`. Commit `ccbd47d`.

_Captured: 2026-07-06 · 2 file change(s)_

---

## T10 — Fixed orientation-eval task suite (pinned commit)

Wrote `scripts/eval/tasks.json`: 10 tasks pinned to `ccbd47d`, each with a concept-naming prompt (finding the right file is what's measured), `expectedFiles`, and a deterministic shell `successCheck`; three `scripts/*` tasks name their file deliberately as controls. Divergence caught during design: the planned find-module task was replaced with a check-freshness one because the bare arm deletes `find-module.js`, making that task impossible in one arm. `scripts/eval/results/` gitignored (the user's unrelated local .gitignore lines were kept out of the commit). Files: `scripts/eval/tasks.json` (new), `.gitignore`. Commit `e466f22`.

_Captured: 2026-07-06 · 2 file change(s)_

---

## T11 — run-eval.js: worktree-per-run A/B harness

Built the runner: ephemeral detached worktree per task×arm at the pinned commit; the bare arm strips AGENTS/CLAUDE/GEMINI.md, STRUCTURE.json, PROJECT_NOTES.md, tasks.json, find-module.js and REFERENCE.md, then commits the stripping (`--no-verify`) so captured diffs contain only the agent's work — a bug the first smoke run exposed and fixed. Headless `claude -p … --output-format stream-json` with per-run timeout, agent binary/flags pluggable via `FRAME_EVAL_AGENT[_ARGS]`; captures transcript, diff (before the successCheck, which may mutate the tree), and the check verdict; worktrees always removed. Smoke-tested one task in both arms (haiku): both passed, clean 1-file diffs. Files: `scripts/eval/run-eval.js` (new). Commit `04edee0`.

_Captured: 2026-07-06 · 1 file change(s)_

---

## T12 — Deterministic scorer + pilot run (baseline withheld)

Built `score.js` (no LLM judging: first-try success, wrong-file edits excluding meta files, searches-before-first-edit, tool calls/turns/duration/tokens; table + `--json`) and ran the full pilot (10 tasks × 2 arms, haiku, pinned `ccbd47d`), which validated the instrument — deltas appeared only in concept-named tasks, not the file-named controls — and hardened the runner mid-run (diffs now taken against the starting sha, since one agent committed its own work). Divergence from plan: per user decision the pilot numbers were NOT recorded as the baseline (single run/cell, 2 paired wins on n=10, sign test p≈0.25, one anomalous cell); README documents the method and what a credible baseline needs (3–5 repeats, default model, paired sign test). Followup: add a `--reps N` mode to run-eval.js and a paired sign test to score.js, then record the first real baseline. Files: `scripts/eval/score.js` (new), `scripts/eval/README.md` (new), `scripts/eval/run-eval.js`. Commits `d1ee3c9`, `31607aa`.

_Captured: 2026-07-06 · 4 file change(s)_

---
