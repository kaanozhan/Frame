---
keywords: codex, hooks, hook trust, CODEX_HOME, command templates, apply_patch, tool matchers, AGENTS.md delivery, wrapper retirement
related: spec-knowledge-layer, cli-spec-command-parity, non-invasive-overlay, audit-q3-cross-platform, spec-docs-delivery-invariant
---

# Codex reaches Frame the way Claude Code does

## Problem

Frame's context now reaches a Claude Code session by mechanism: four hooks
deliver the project rules at session start, a meta file's rules as it is
written, the module map alongside a search, and a spec command's current flow
when one is asked for. Measured here, hook-delivered context arrives ~100% of
the time and prose-delivered context 1–44%.

None of it reaches Codex, and Codex starts from further back:
`src/templates/commands/codex/` is **empty**, so `getCommandPrompt(…,
'spec.plan', 'codex')` returns `no codex template for spec.plan` — spec-driven
work from Codex has no flow at all, not a degraded one. AGENTS.md reaches it
only through `.frame/bin/codex`, the launch-time injection
`non-invasive-overlay` rejected for Claude Code. Codex is a first-class tool in
`aiToolManager`; a user who picks it gets Frame's UI and almost none of Frame's
context.

## Goal

A Codex session receives the same four deliveries a Claude Code session does,
and runs `spec.new` / `spec.plan` / `spec.tasks` / `spec.implement` end to end
— including `spec.plan`'s decision gate. `.frame/bin/codex` is retired rather
than extended.

Ground verified against Codex CLI 0.149.1: all eleven hook events exist
(`UserPromptSubmit`, `SessionStart`, `PreToolUse`, … ), the stdin payload uses
Claude's field names, the stdout contract is the same
`hookSpecificOutput.additionalContext`, hooks load from `CODEX_HOME/hooks.json`
(a project-local `.codex/hooks.json` did not fire), and an untrusted hook does
not run and says nothing.

## Constraints

- **Matchers must be remapped.** Codex has `apply_patch`, `shell`,
  `exec_command`, `local_shell`, `write_file`; there is no `Grep`/`Glob` —
  search goes through `shell`, which `module-hint.js` already parses.
- **Hook trust belongs to Codex.** Granted in its TUI, persisted as a
  `trusted_hash`, no CLI command, and Frame must not forge it.
- **`non-invasive-overlay`'s footprint rule.** Frame writes under `.frame/` or
  the one pointer file; `CODEX_HOME/hooks.json` is the user's own global file.
- **`spec-knowledge-layer`'s hook contract is unchanged**: never block, never
  break, exit 0 with empty output, record every quiet path.
- **Measure Codex's inline ceiling before trusting any payload size.** Claude's
  is exactly 2000 characters; Codex's is unknown.
- **A command template is the flow, not a description of it.** Per
  `cli-spec-command-parity` it is followed exactly, so the Codex versions must
  be real adaptations, not the Claude files with tool names swapped.

## Success Criteria

- A Codex session start receives the conversation-level rules, untruncated.
- A Codex write to `.frame/tasks.json` receives that file's REFERENCE section
  first.
- A Codex search for a known concept receives the module map answer.
- `spec.plan` from Codex stages the interpolated template and reaches the
  decision gate, asking the user about business forks.
- `getCommandPrompt` returns a prompt, not an error, for all four commands
  with `'codex'`.
- Every hook is silent and exit 0 in a project with no `.frame/`.
- An untrusted hook degrades to today's behaviour, and Frame says somewhere
  visible that Codex hooks need trusting.
- `.frame/bin/codex` is no longer how AGENTS.md reaches Codex.

## Out of Scope

- Removing Gemini.
- `audit-q3-deterministic-graph-hints` (the graph variant of the search hint).
- The rest of `audit-q3-cross-platform` beyond the Codex-launch decision below.
- Changing Claude Code's hook behaviour.

## Open Questions

**1. Where Frame writes Codex's hook config.** Hooks load from the global
`CODEX_HOME/hooks.json`; the project-local file did not fire. The hint scripts
already exit silently outside a Frame project, so global registration is
behaviourally safe — but it is the user's file and affects every project.
  - *(a)* Write it merge-safely, as `installSpecHintHook` does for
    `.claude/settings.json`.
  - *(b)* Don't write it; document the entries, accepting a manual step.

**2. What replaces the `.frame/bin/codex` wrapper.** Both this spec and
`audit-q3-cross-platform` (`planned`) want it gone and disagree on the
replacement. That spec records an **asked** decision — compose `codex
"<prompt>"` in-process, so nothing needs porting to PowerShell. This spec's
premise is a `SessionStart` hook, matching Claude Code; a node hook is equally
portable, so the Windows rationale may hold either way. Reversing a recorded,
user-asked decision has to be explicit.

**3. What Frame does about untrusted hooks.** They silently do nothing until
trusted, and a Frame update that changes a script un-trusts them again.
  - *(a)* Detect and surface it, the way `docsHealth` surfaces a degraded doc.
  - *(b)* State it once at setup and accept silent degradation after.
