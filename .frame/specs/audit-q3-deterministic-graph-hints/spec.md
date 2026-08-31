# Deterministic graph/intent hints via Claude Code hooks

> Follow-on to `codebase-graph-onboarding`, filed into the `audit-q3` series
> (2026-07-17 session). Captured and discussed, not yet planned.

## Problem

Frame now has two orientation tools an agent should reach for before cold
grep: `find-module.js` (intent index) and `graph-query.js` (code graph, built
at onboarding). Both are wired the same way today: **advisory text** in
AGENTS.md / QUICKSTART.md ("before manual grep/glob, run…"). Nothing enforces
it — whether the agent actually consults them depends on it reading and
honoring the instruction, every session, every time.

That gap was called out explicitly when `codebase-graph-onboarding` shipped:
the unproven hypothesis is *"the agent will actually use the graph."* An
instruction is not a mechanism. A session was found where the intended
"trigger find-module before grep" behavior existed only as CLAUDE.md guidance
— no hook exists anywhere in the repo or user settings (checked
`.claude/settings.local.json`, `~/.claude/settings.json`, `.githooks/`).

Decision from the 2026-07-17 discussion: the team is effectively 100% Claude
Code, so tool-agnosticism is no reason to leave the strongest mechanism
unused. Claude Code's **PreToolUse hook** system can make the orientation
step *deterministic*: every `Grep`/`Glob` call gets graph/intent context
injected by the harness, whether or not the agent remembered the guidance.

## Goal

When an agent greps in a Frame project (Frame's own repo or any onboarded
project with `ai_tool: claude-code`), a PreToolUse hook runs a fast local
script that:

1. Extracts the search pattern from the hook's stdin JSON (`Grep`/`Glob`
   tool input).
2. Looks it up in `.frame/graph/graph.json` (symbols → `where`, files →
   `imports`/`affects`) and the intent index (`find-module` concepts).
3. On a hit, returns `additionalContext` so the agent sees the graph/intent
   answer alongside its grep results — deterministic, zero reliance on the
   agent's memory of AGENTS.md.
4. On no hit (or no graph), stays completely silent.

## Constraints (hard lines from the discussion)

- **Never block.** The hook must not return a blocking decision; grep always
  runs. Hints are additive context, not gatekeeping — a wrong or stale hint
  must never prevent the agent from searching.
- **Speed budget.** The hook fires on *every* Grep/Glob call. Target ~50 ms
  including node startup: read pre-parsed JSON artifacts only — never load
  tree-sitter, never rebuild anything. If the budget can't be met, hint less.
- **Never break.** Any failure (missing graph, corrupt JSON, bad stdin) →
  exit 0 with empty output. A hook error must never surface as a tool error.
- **Merge, don't clobber.** Installing the hook edits `.claude/settings.json`
  in the user's project — existing settings content must be preserved
  (same philosophy as structureBootstrap's pre-commit hook install: detect,
  append idempotently, or surface manual instructions).
- **Dependency-free script.** `graph-hint.js` ships to user projects'
  `.frame/bin/` and runs with plain node — no node_modules.
- Claude Code only: installed when `ai_tool` is `claude-code`; other tools
  keep the advisory layer, no hook.

## In scope

- `scripts/graph-hint.js` — stdin PreToolUse JSON → combined graph + intent
  hint as `additionalContext`; silent no-op otherwise. Ships via
  `PARSER_FILES` like its siblings.
- Hook entry in Frame's own repo `.claude/settings.json` (immediate
  dogfooding).
- Init-time installation for user projects (merge-safe settings write,
  gated on `ai_tool: claude-code`), plus installation on already-initialized
  projects via re-init.
- Tests: fake-stdin hint output, no-graph silence, corrupt-input exit 0,
  settings-merge safety.
- Eval: a hooked vs. unhooked comparison run in `scripts/eval/` to measure
  whether hints change agent behavior (closes the "will the agent actually
  use it" hypothesis with data).

## Out of scope

- Blocking/redirecting grep calls (explicitly rejected — see Constraints).
- Hooks for tools other than Grep/Glob (Read/Edit hints are a separate idea).
- Support for non-Claude-Code agents' hook systems.
- Any change to how/when the graph itself is built.

## Success criteria

- In Frame's repo, a Grep for a known symbol (e.g. `createWindow`) visibly
  receives graph context in the same turn, with no agent instruction needed.
- A freshly onboarded `ai_tool: claude-code` project gets the hook installed
  without touching any pre-existing `.claude/settings.json` content.
- Hook overhead stays within the speed budget on a 10k-file graph.
- A project with no graph behaves exactly as today (silent, zero errors).
- Eval comparison shows hooked sessions consult graph/intent data more than
  unhooked ones (directional evidence is enough; this is the hypothesis
  test).

## Open questions for /spec.plan

- Hint shape: raw `graph-query` output vs. a compact one-liner ("createWindow
  → src/main/index.js:64; 3 importers") — token cost vs. usefulness.
- Should Glob patterns get intent-index hints only (symbols rarely appear in
  glob patterns)?
- Settings write location: project `.claude/settings.json` vs.
  `.claude/settings.local.json` (checked-in vs. local-only) for user
  projects.
- Does the existing eval harness support hook-enabled runs, or does it need
  a flag added?
