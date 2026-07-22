# Plan — Spec Knowledge Layer — specs as durable agent + human memory

## Architecture

### Resolved plan-time decisions

- **Default injection mode — full content** (asked, business). Edit-time
  injection carries the compact history records themselves (budgeted,
  overflow-to-pointer), not just a signal line. Signal-only mode is still
  implemented behind `FRAME_SPEC_HINT_MODE=signal` (env read by the hook
  script) so dogfooding can compare; the shipped default maximizes the
  "agent cannot miss it" guarantee the user asked for.
- **Frame UI file-history panel — follow-on spec** (asked, business). v1
  stays main-process + scripts + templates; no renderer work. The index on
  disk is the contract a later UI spec builds on.
- **Hygiene + backfill in this spec** (asked, business). Inventory cleanup
  is the first task and digest/front-matter backfill for existing `done`
  specs is a late task — the layer ships working on a clean, populated
  archive, not an empty mechanism.
- **Digest authored in `spec.implement`'s final-task turn** (asked,
  technical). Evidence pass found no `spec.done` command exists — `done` is
  auto-derived when all spec tasks complete (`derivePhase`,
  `src/main/specManager.js:216`). So the digest step is added to
  `spec.implement.md` (and `WORKER.md` for orchestrated runs): when the task
  being completed is the spec's last pending task, write `digest.md` in the
  same turn, while outcome context is freshest. No new command, no new UI.
- **Index is gitignored + lazily rebuilt** (asked, technical).
  `.frame/index/` joins `.gitignore`. The builder exposes
  `ensureFresh(projectPath)` — rebuild when the index is missing or older
  than the newest source artifact (status.json/spec/plan/outcome/digest
  mtimes). Frame calls it on spec phase transitions; the CLI and the
  spec.new catalog embed call it on demand; the hook script only ever
  *reads* (missing index → silent). This avoids the tracked-generated-file
  conflict trap the engineering findings documented for STRUCTURE.json.
- **Hook registered in project `.claude/settings.json`** (asked, technical).
  Tracked, project-level: every teammate and every orchestration worktree
  gets the hook deterministically, no per-machine setup. Frame's own repo
  gets the file directly (dogfooding); user projects get a **merge-safe**
  write at init (read-modify-write preserving existing keys; on unparseable
  JSON, skip and surface manual instructions), gated on
  `ai_tool: claude-code`.
- **Spec relationship fields live in spec.md front-matter** (silent). A
  fenced front-matter block (`keywords:`, `related:`, `supersedes:`) at the
  top of spec.md, written at authoring time by the updated `spec.new`
  template. `digest.md` repeats them for `done` specs (and is the only
  place backfill adds them for legacy specs — legacy spec.md files are not
  rewritten). The index reads declared fields first, lexical extraction is
  fallback only.
- **In-flight awareness ships in both channels** (silent). Specs in
  `implementing`/`planned` phase contribute warning-only entries (from their
  plan Footprint) — surfaced by the Edit-hook ("this file is in the
  footprint of in-flight spec X") and by the spec.plan evidence step.
- **Exclusion mechanics** (silent). Hygiene deletes the `test-orch-1..4`
  probe folders outright and adds `"superseded_by": "<slug>"` to
  `structure-non-standard-layouts/status.json`; the index and catalog skip
  any spec whose status carries `superseded_by`. Stale phases
  (`deep-spec-plan`, `agentlar-iin-roller-…`) are corrected to their real
  state.
- **Dedup state in `.frame/runtime/spec-hint/<session_id>.json`** (silent).
  Already-gitignored directory; opportunistic cleanup deletes state files
  older than 7 days on hook start.
- **All injected text is English** (silent) — consistent with every shipped
  template and the docs rule.

### Components and data flow

```
spec artifacts (spec.md front-matter, plan Footprint, outcome "Files
touched:", digest.md, status.json)  +  git enrichment ((slug) commit tags,
--follow renames, post-close-change stale flags)
        │  scripts/spec-index.js  (lib + CLI, ensureFresh)
        ▼
.frame/index/spec-index.json   { topics: {…}, files: {…} }   [gitignored]
        │                         │
        │ read-only               │ read-only
        ▼                         ▼
scripts/spec-hint.js          scripts/spec-context.js
(PreToolUse Edit/Write +      (topic mode, --file mode;
 UserPromptSubmit hooks)       calls ensureFresh itself)
        ▲                         ▲
.claude/settings.json         agent / templates / humans
```

- **Index shape.** `topics`: slug → `{title, phase, keywords[], related[],
  supersedes, digestLine, paths}`. `files`: posix path → array (never a
  single record) of `{slug, task, line (what/why one-liner), result, date,
  phase, flags: {current, stale, laterSpecs, inflight, movedTo}, deep}`
  sorted oldest→newest; the newest full record is marked `current`.
- **Primary vs enrichment sources.** Footprint + outcome are primary — the
  index survives squash merges. Git supplies renames
  (`git log --follow --diff-filter=R`), the moved-to links for deleted
  paths, and stale flags (file commits after the spec's `last_phase_at`).
- **Hook behavior (spec-hint.js).** Edit/Write PreToolUse: resolve the
  target path → files view → if unseen this session, emit
  `additionalContext`: 1–2 entries → full compact records; 3+ → one line
  per spec + pointer to `spec-context.js --file` (every spec always
  present; overflow drops depth, never entries), plus the in-flight warning
  and the user-enlightenment instruction ("if this history affects your
  work, relay it to the user in 1–2 sentences; otherwise stay silent").
  UserPromptSubmit: tokenize the prompt (ascii-fold, stopwords, synonym map
  reusing `scripts/intent-map.json` conventions), score against `topics`,
  cap at top 3 matches over threshold. Any failure anywhere → exit 0,
  empty output; target ≤50 ms by reading pre-built JSON only.
- **Catalog embed (spec.new).** `getCommandPrompt` gains a `{spec_catalog}`
  var: one line per non-excluded spec (slug · title · phase · keywords),
  built via `ensureFresh`. At ~30 specs the full catalog is embedded —
  recall 100%, semantic matching done by the authoring agent; lexical
  scoring is the scale path, not the v1 hot path.
- **Worker preload.** `buildWorkerPrompt`
  (`src/main/orchestrationManager.js:143`) appends a "File history for your
  footprint" section (files-view lines for each Footprint path) to the
  staged worker prompt.
- **Digest.** `digest.md`: front-matter (`keywords/related/supersedes`) +
  ≤15-line body — what was done, why this path (rejected alternatives),
  result, rules established — + chain pointers. Written by
  spec.implement/WORKER final-task step; by the backfill task for legacy
  `done` specs.

## Files

- **New** `scripts/spec-index.js` — index builder: lib (`build`,
  `ensureFresh`) + CLI; phase filter, rename tracking, stale/supersede
  flags, posix keys.
- **New** `scripts/spec-context.js` — query CLI: `<keyword>` topic mode,
  `--file <path>` chronological history mode; compact output + deep-read
  pointers.
- **New** `scripts/spec-hint.js` — hook entry for PreToolUse (Edit/Write)
  and UserPromptSubmit; dedup, budget, modes, never-break contract.
- **New** `.claude/settings.json` — hook registration for Frame's own repo
  (dogfood).
- **New** `test/spec-index.test.js` — builder fixtures: multi-spec file,
  rename, squash-survival, phase filter, superseded exclusion.
- **New** `test/spec-hint.test.js` — fake-stdin injection output, dedup,
  overflow, corrupt-index/no-index silence, settings-merge safety.
- **Modified** `src/main/specManager.js` — debounced `ensureFresh` on phase
  transitions (inside existing self-write-guard discipline); `{spec_catalog}`
  var for spec.new dispatch.
- **Modified** `src/main/orchestrationManager.js` — footprint history
  preload in `buildWorkerPrompt`.
- **Modified** `src/main/structureBootstrap.js` — `PARSER_FILES` += the
  three new scripts.
- **Modified** `src/main/frameProject.js` — init-time merge-safe hook
  install into the user project's `.claude/settings.json`, gated on
  `ai_tool: claude-code`.
- **Modified** `src/templates/commands/claude-code/spec.new.md` —
  front-matter fields + catalog-evaluation step (prior decisions shape
  Constraints / Out of Scope / Open Questions).
- **Modified** `src/templates/commands/claude-code/spec.plan.md` — Stage 1
  gains the footprint-history evidence step (`spec-context.js --file` per
  candidate footprint file + in-flight intersection note).
- **Modified** `src/templates/commands/claude-code/spec.implement.md` —
  final-task digest step.
- **Modified** `src/templates/orchestration/WORKER.md` — same final-task
  digest rule for orchestrated runs.
- **Modified** `scripts/eval/run-eval.js` — hooks-enabled run flag for the
  injected-vs-not comparison.
- **Modified** `.gitignore` — add `.frame/index/`.

(Meta files — AGENTS.md advisory lines, `.frame/docs/REFERENCE.md` section,
`.frame/specs/**` digests/backfill, tasks.json — are part of the work but
excluded from Files/Footprint per Frame rules.)

## Footprint

- scripts/spec-index.js
- scripts/spec-context.js
- scripts/spec-hint.js
- scripts/eval/run-eval.js
- src/main/specManager.js
- src/main/orchestrationManager.js
- src/main/structureBootstrap.js
- src/main/frameProject.js
- src/templates/commands/claude-code/spec.new.md
- src/templates/commands/claude-code/spec.plan.md
- src/templates/commands/claude-code/spec.implement.md
- src/templates/orchestration/WORKER.md
- .claude/settings.json
- .gitignore
- test/spec-index.test.js
- test/spec-hint.test.js

## Dependencies

None — hard constraint: all three scripts are dependency-free plain node,
shipped to user projects via the existing `PARSER_FILES` channel.

## Sequencing

1. **Inventory hygiene.** Delete `test-orch-1..4` spec folders; add
   `superseded_by` to `structure-non-standard-layouts/status.json`; correct
   stale phases (`deep-spec-plan` → done, `agentlar-iin-roller-…` → its real
   state). The index derives from a truthful archive from day one.
2. **`scripts/spec-index.js`.** Builder lib + CLI with `ensureFresh`;
   topics + files views, declared-fields-first extraction, git enrichment
   (renames, stale flags, `(slug)` tags), phase filter, posix keys;
   `.gitignore` entry; `test/spec-index.test.js` fixtures.
3. **`scripts/spec-context.js`.** Topic and `--file` modes over
   `ensureFresh`; chronological output, newest-marked-current, deep-read
   pointers.
4. **`scripts/spec-hint.js`.** Edit/Write mode (session dedup + cleanup,
   full-content default with `FRAME_SPEC_HINT_MODE=signal`, budget with
   overflow-to-pointer, in-flight warnings, enlightenment instruction) and
   UserPromptSubmit mode (stopwords, threshold, top-3 cap);
   `test/spec-hint.test.js` covering the never-break contract.
5. **Hook registration + shipping.** `.claude/settings.json` in Frame's
   repo; merge-safe init install for user projects in `frameProject.js`
   (gated `ai_tool: claude-code`); `PARSER_FILES` += the three scripts.
6. **specManager wiring.** Debounced `ensureFresh` on phase transitions
   (respecting existing watcher self-write guards); `{spec_catalog}` var
   embedded into spec.new dispatch.
7. **Template updates.** spec.new (front-matter + catalog evaluation),
   spec.plan (footprint-history evidence step), spec.implement + WORKER.md
   (final-task digest step).
8. **Worker preload.** Footprint history section in `buildWorkerPrompt`.
9. **Backfill.** Author `digest.md` (front-matter included) for existing
   `done` specs; regenerate the index; verify every storied file resolves.
10. **Docs.** AGENTS.md advisory lines (fallback for non-Claude CLIs) +
    "Spec Knowledge Layer" section in `.frame/docs/REFERENCE.md`.
11. **Eval.** Hooks-enabled flag in `scripts/eval/run-eval.js`; run the
    injected vs. non-injected comparison; record directional results in the
    spec folder.
12. **End-to-end dogfood.** Fresh session: edit a storied file → history +
    user relay appear; `spec.new` on a scratch idea → fields filled, content
    shaped by catalog; project without index → byte-identical silence;
    hook overhead within budget.
