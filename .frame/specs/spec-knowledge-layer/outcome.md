# Outcome — Spec Knowledge Layer

## T01 — Inventory hygiene pass

Deleted the four `test-orch-1..4` probe spec folders (untracked, no git surgery
needed) and purged their tasks from `tasks.json` — including an orphan
`spec:test-orch-5:T01` task whose spec folder never existed. Added
`"superseded_by": "audit-q3-generic-any-project"` to
`structure-non-standard-layouts/status.json`. Corrected `deep-spec-plan`:
its T08 was `in_progress` in tasks.json despite the merged commit (6502321),
so T08 → completed and phase → `done`. Deviation from plan: `agentlar-iin-roller-…`
was left at `implementing` — verification showed that IS its real state
(T01 shipped, T02–T05 pending), so the index will correctly treat it as
in-flight rather than done.

_Captured: 2026-07-22 · 4 folders deleted, 3 files changed_

---
## T02 — Index builder (`scripts/spec-index.js`)

Built the dependency-free builder lib+CLI: topics + files views, front-matter
parsed declared-first (spec.md then digest.md), plan `## Footprint` as intent
and outcome `Files touched:` backticked paths as actuals, phase filter
(done→full, in-flight→warning, specified→topics-only, `superseded_by`→skip),
posix keys, and single-call git enrichment (rename chains via
`log -M --diff-filter=R`, stale flags via one `log --name-only` since the
oldest close — never per-file). `ensureFresh` rebuilds on mtime staleness
only. Deviation from plan: footprint parsing is imperative line-walking, not
regex — the multiline-`$` regex approach truncated at the first bullet in
testing. `.frame/index/` gitignored. 9 tests green incl. a real-git rename
fixture; real-archive smoke: 24 specs → 121 storied files, perf spec
correctly surfaces as in-flight. Files touched: `scripts/spec-index.js`
(new), `test/spec-index.test.js` (new), `.gitignore`.

_Captured: 2026-07-22 · 3 file change(s)_

---
## T03 — Query CLI (`scripts/spec-context.js`)

Added the reader CLI over `ensureFresh`: topic mode (ascii-folded
Turkish/English tokenization scored against slug+title+keywords+footprint
basenames, top-8), `--file` mode (absolute/relative accepted, chronological
records with human flag text — current/stale/later-specs/IN-FLIGHT/moved —
plus deduped deep-read pointers), and a `--list` catalog mode reusing
`catalogLines`. Real-archive smoke: tasksManager.js correctly shows
reliability history + perf in-flight warning. Files touched:
`scripts/spec-context.js` (new).

_Captured: 2026-07-22 · 1 file change(s)_

---
## T04 — Hook script (`scripts/spec-hint.js`), pre-edit mode

Wrote the PreToolUse entry: stdin JSON → posix-normalized files-view lookup →
`additionalContext` with chronological records, STALE/IN-FLIGHT warnings and
the user-relay instruction; session dedup (once per file) in
`.frame/runtime/spec-hint/<session_id>.json` with 7-day opportunistic
cleanup; `FRAME_SPEC_HINT_MODE=signal` one-liner mode; budget = full records
≤2 entries, one-line-per-spec + pointer at 3+ (entries never dropped).
Read-only by contract — the hook never rebuilds the index; `.frame/` targets
and out-of-project paths are skipped. Whole main wrapped in try/catch →
exit 0. Deviation from plan: the `prompt` (UserPromptSubmit) mode landed in
this task too — the df-weighted scoring shares the tokenizer and state file,
splitting it made no sense; T05 keeps the test suite. Smoke: 21ms end-to-end
(budget 50ms), dedup silent, corrupt stdin silent. Files touched:
`scripts/spec-hint.js` (new).

_Captured: 2026-07-22 · 1 file change(s)_

---
## T05 — Hook test suite (`test/spec-hint.test.js`)

Covered both hook modes as child processes with real stdin (the way the
harness runs them): full-record injection + relay text, 3+-spec overflow
keeping every spec, signal mode, absolute-path resolution, per-session dedup
with fresh-session re-injection, and the never-break set (no index, corrupt
index, corrupt stdin, missing fields, unknown mode, .frame/ and
out-of-project targets — all exit 0 silent). Prompt mode asserted on a mixed
Turkish/English prompt with rare-keyword scoring and generic-only silence.
Also pinned the T06 settings-merge contract (foreign keys preserved,
idempotent re-install) at the JSON level. 9 tests; full suite green.
Files touched: `test/spec-hint.test.js` (new).

_Captured: 2026-07-22 · 1 file change(s)_

---
## T06 — Hook registration + shipping channel

Created Frame's own `.claude/settings.json` (PreToolUse Edit|Write +
UserPromptSubmit → `scripts/spec-hint.js`) — and it went live mid-task: the
hook fired on this task's own frameProject.js edit, correctly surfacing the
file's history including the in-flight cross-platform footprint overlap.
Added `installSpecHintHook` to `src/main/frameProject.js`: gated on active
tool id `claude` (lazy-required aiToolManager to keep init's module graph
flat), read-modify-write preserving all existing keys, signature-matched
append so re-init is idempotent, unparseable JSON → no write + manual-install
summary. User-project commands point at `.frame/bin/spec-hint.js`; the three
scripts ship via `PARSER_FILES` in `src/main/structureBootstrap.js`. Files
touched: `.claude/settings.json` (new), `src/main/frameProject.js`,
`src/main/structureBootstrap.js`.

_Captured: 2026-07-22 · 3 file change(s)_

---
## T07 — specManager wiring (index refresh + catalog embed)

`writeStatus` now schedules a debounced (2s, unref'd) `ensureFresh` after
every real status write — riding the existing write-if-changed guard, so
reconcile no-ops never trigger it; the refresh itself no-ops when the index
is fresh (perf-spec discipline preserved). `getCommandPrompt` gains
`spec_catalog`, filled only for `spec.new`: sync read of the warm index via
`catalogLines` (getCommandPrompt is a sync IPC path — kept sync by design),
falling back to a bare slug/title/phase listing on a cold index while the
scheduled refresh warms it. Also truncated catalog titles at 90 chars in
`catalogLines` — the agentlar spec's paragraph-length title was bloating the
embed. Files touched: `src/main/specManager.js`, `scripts/spec-index.js`.

_Captured: 2026-07-22 · 2 file change(s)_

---
## T08 — Flow template updates

`spec.new.md`: embedded `{spec_catalog}` with a relatedness-evaluation step
(agent = precision, catalog = recall) that routes findings into
Constraints/Out of Scope/Open Questions, plus the front-matter contract
(`keywords:/related:/supersedes:`) ahead of the existing five sections —
deep-spec-plan's conditional Open Questions guidance untouched. `spec.plan.md`:
Stage 1 gains step 4, footprint history via `spec-context.js --file` with
explicit IN-FLIGHT/STALE handling rules (prior decisions respected or
overturned in Stage 2, never silently contradicted; skip silently if no
index). `spec.implement.md`: last-pending-task turn now writes
`.frame/specs/{slug}/digest.md` (front-matter + ≤15 lines from outcome
actuals + chain pointer). `WORKER.md`: same digest rule as done-step 1
(explicitly scoped as in-worktree, not a meta file) with renumbered
completion steps. Files touched: all four templates.

_Captured: 2026-07-22 · 4 file change(s)_

---
## T09 — Worker footprint-history preload

`buildWorkerPrompt` now appends a "File history for your footprint" section:
sync read of the warm index, per-footprint-file chronological entries with
STALE / IN-FLIGHT marks and a respect-or-surface-to-conductor instruction;
the worker's own in-flight entry is filtered out as noise. Any failure →
empty section (prompt unchanged from today). Verified against the real
index: cross-platform's 17-file footprint resolves prior history for 12.
Files touched: `src/main/orchestrationManager.js`.

_Captured: 2026-07-22 · 1 file change(s)_

---
## T10 — Digest backfill for done specs

Authored `digest.md` (front-matter keywords/related + ≤15-line distillation
+ chain pointer) for all 12 done specs, written from outcome actuals and
PROJECT_NOTES decision records — rejected alternatives and standing rules
included (e.g. agent-approval ≠ ready, no-user-tracking constraint, fsSafe
mandatory rule). `audit-q3-generic-any-project` declares
`supersedes: structure-non-standard-layouts` in front-matter, matching the
status-level marker from T01. deep-spec-plan (no outcome.md exists) cites
its commit range + PROJECT_NOTES entry in the chain line instead.
Regenerated the index: topic and footprint-level records now carry digest
lines; verified via spec-context on tasksManager.js, `telemetry` and
`worktree` queries. Files touched: 12 × `.frame/specs/<slug>/digest.md`
(new; spec-folder artifacts, outside Footprint by convention).

_Captured: 2026-07-22 · 12 file change(s)_

---
## T11 — Documentation (advisory layer + reference)

Added the "Spec history" advisory block (spec-context commands + read-the-
chain rule) next to find-module in Frame's own AGENTS.md and in the LIVE
user-project template — which the hook's STALE warning correctly revealed to
be `getAgentsTemplate()` in `src/shared/frameTemplates.js`, not
`src/templates/CLAUDE.md` (core-value-efficacy T08 moved it; the md file has
zero code references — dead copy, edited for consistency, deletion
candidate). Wrote the "Spec Knowledge Layer" section in
`.frame/docs/REFERENCE.md`: index contract + views + flags, digest rules,
hook behavior + modes, worker no-regenerate rule, respect-or-overturn rule.
Note: `frameTemplates.js` is also in in-flight cross-platform's footprint
(Codex wrapper work) — additive doc block, but merge order matters. Files
touched: `AGENTS.md`, `.frame/docs/REFERENCE.md`,
`src/shared/frameTemplates.js`, `src/templates/CLAUDE.md`.

_Captured: 2026-07-22 · 4 file change(s)_

---
