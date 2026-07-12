# Core value-prop efficacy — does Frame actually help the agent?

> Audit-sourced findings spec (Q3 2026 deep-dive review). The most fundamental question, captured — recorded via the `audit-q3` study.

## Problem

Frame's entire thesis is that durable, structured context (AGENTS.md, STRUCTURE.json + intentIndex, PROJECT_NOTES.md, tasks.json) keeps an AI agent oriented so it doesn't re-learn the codebase every session and spends "zero time searching." Reading the actual mechanisms, the thesis is **partly delivered, partly thin, and — critically — entirely unmeasured.** Where each mechanism lands:

**AGENTS.md — earns a partial keep, but is bloated and generic.** The file (`/Users/kaanozhan/ClaudeCodeIDE/AGENTS.md`) is 328 lines / ~2.5k tokens that ride in *every* context window. Only ~20 lines are actual orientation for *this* codebase (the "read STRUCTURE/NOTES/tasks" pointer + find-module usage). The rest is process ceremony about maintaining Frame's own docs: the full tasks.json field schema, note-taking cadence, completion-signal heuristics, STRUCTURE.json format examples. It is essentially identical to the shipped template (`src/templates/CLAUDE.md`), so it tells an agent almost nothing project-specific. It is well-organized and tool-agnostic (good), but it pays a per-session token toll for content that is 85% meta-process, not orientation. It does not fully earn its place; it should be split (lean always-on core vs. reference-on-demand).

**STRUCTURE.json + intentIndex + find-module.js — marginal over grep, and demonstrably stale.** intentIndex (68 keys over 88 modules) is *not semantic*: `generateIntentIndex()` in `scripts/update-structure.js` derives intent names purely by stripping filename suffixes (`Manager`, `Panel`, `UI`…) plus a ~30-entry hardcoded alias table (lines 517-545). So `github` → `githubManager` works only because the file is literally named that — a plain `ls src/**/*github*` finds the same thing. Many keys are thin single-file intents (`menu`, `server`, `state`, `platform`). The regex parser also emits garbage "purpose" strings: e.g. `main/aiToolManager.loginShell.purpose` = *"doesn't source the zsh configs where PATH (claude/codex/gemini) usually lives"* — a mid-comment fragment grabbed as a function purpose. And `architectureNotes` — the one field a regex *cannot* generate and the only place genuine architectural insight would live — is **empty/absent** in the live file. Worst: **a live stale entry.** `src/renderer/specDetailModal.js` no longer exists on disk (87 js files on disk vs 88 modules listed), yet it remains in `modules` *and* in intentIndex under `spec-detail-modal` — so `find-module.js spec-detail-modal` confidently points an agent at a file that isn't there. This is the exact failure the tool is meant to prevent.

**Freshness — the mechanisms are only as good as their currency, and currency is leaking.** STRUCTURE.json (`lastUpdated: 2026-06-24`) tracks only `src/**/*.js`, only on commit, via the pre-commit hook; deletions are reconciled only in `--changed` mode off the staged diff, which is how the deleted `specDetailModal` slipped through. PROJECT_NOTES.md stops at `2026-06-15` despite substantial subsequent work (pitch, demos, orchestration polish) — decisions made since are unrecorded. QUICKSTART.md was last touched 2026-02-05 (~5 months). tasks.json holds 166 tasks with **7 stuck `in_progress`**, several dated Jan 2026 (`task-s3`, `task-s4`, `task-sysprompt`) — 5+ months "in progress." Stale `in_progress` and phantom files don't just fail to help; they actively **mislead** the agent about what's active and where code lives — worse than no context.

**Injection — reliable for Claude, a nudge for Codex, unenforced for Gemini, and STRUCTURE/NOTES never injected at all.** Claude reads `CLAUDE.md` (a symlink → AGENTS.md) natively — reliable. Codex goes through `.frame/bin/codex`, which `exec codex "Please read AGENTS.md…"` as a one-shot first-turn *request* — not a guarantee, not re-injected, dependent on the model choosing to comply. Gemini's command is a bare `gemini` with no injection (relies on Gemini's own file loading, if any). And crucially, **STRUCTURE.json / PROJECT_NOTES.md / tasks.json are never injected** — AGENTS.md merely *instructs* the agent to read them. Whether it does is unverified and, across tools, unlikely to be uniform.

**THE MEASUREMENT GAP (the core problem).** There is **no evidence layer anywhere.** Nothing measures whether a Frame-oriented agent actually edits the right file more often, searches less, or succeeds on the first try. There is a `telemetry` module, but it does not measure orientation benefit. Every headline claim — "stays oriented," "zero time searching," "doesn't re-learn the architecture" — is **asserted, never demonstrated.** Without a metric, we cannot distinguish "Frame helps" from "Frame adds 2.5k tokens of ceremony and a sometimes-wrong file index." This is the single most important gap in the whole product: the value prop has no proof.

## Goal

Two tracks, in tension-aware balance. **(1) Tighten the mechanisms** so the context is lean, accurate, deterministic, and fresh: slim AGENTS.md to a lean always-on core; make STRUCTURE.json/intentIndex a real concept→file map that regenerates deterministically and reconciles deletions; kill garbage "purpose" extraction; add freshness/staleness signals. **(2) Build an evidence layer** that actually demonstrates the benefit — a repeatable way to measure whether an oriented agent outperforms an unoriented one on concrete tasks — so the core claim stops being an assertion and becomes a measured result.

## Constraints

- **Files stay canonical** — the source of truth is plain, git-versioned files in the repo (tool-agnostic, greppable, readable without Frame); keep it that way. This does *not* preclude a server-side retrieval/index layer over the corpus for team scale — an index makes the files *usable as context at scale*, it does not replace them as the canonical store.
- **Keep AGENTS.md tool-agnostic** — it must serve Claude, Codex, Gemini, and future CLIs; no Claude-only assumptions.
- **Agent-written files must stay simple** — STRUCTURE.json, tasks.json, PROJECT_NOTES.md are read and written by agents; formats must remain trivially machine- and human-editable.
- **Don't over-engineer** — the eval/evidence layer is a measurement instrument for the team, not a shipped product surface; keep it lightweight and repeatable.

## Success criteria

- AGENTS.md is **lean and current**: an always-on core (orientation + working principles) that is materially shorter, with maintenance/schema reference moved out of the per-session window; measurably fewer tokens with no loss of project-specific guidance.
- STRUCTURE.json + intentIndex are **accurate, deterministic, and fresh**: no phantom modules (deleted files reconciled every regen, not just `--changed`); intentIndex maps real concepts to files (not pure suffix-stripping); no garbage "purpose" fragments; stable output across regenerations; a populated (or honestly omitted) `architectureNotes`.
- A **credible way to measure the orientation benefit** exists — e.g. a small fixed task suite run with vs. without Frame context, scoring wrong-file edits, search/tool calls, and first-try success — producing a repeatable number, not a vibe.
- **Staleness is detected and surfaced**: STRUCTURE/PROJECT_NOTES/tasks carry freshness signals (age, drift vs. git, stuck `in_progress`) and warn when context is likely to mislead.

## Out of scope

- Building a full benchmarking product or public leaderboard — the eval is an internal instrument, not a feature.
- Changing Frame's core philosophy (files-as-canonical-source, human-in-the-loop, spec-driven flow) — this audit sharpens the premise, it does not replace it. (A server-side index/retrieval layer *over* the canonical files is a compatible future direction, not a philosophy change.)

## Open questions for /spec.plan

- How do we measure efficacy *credibly* and cheaply? A fixed local task suite (fixed repo snapshot, scripted tasks, deterministic scoring of wrong-file edits / tool-call count / first-try pass) vs. lightweight opt-in telemetry from real sessions — which gives a defensible signal without heavy infra?
- What is the right freshness-enforcement approach? Regenerate STRUCTURE on every commit (all files, full reconcile) vs. a CI staleness gate vs. runtime warnings when a referenced file is missing or a note/task is N days stale — and where does each belong so it helps without becoming nagware?
