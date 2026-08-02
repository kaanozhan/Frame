---
keywords: terminal context, launch injection, PATH, tool wrapper, context boundary, per-tool parity, launch flags
related: non-invasive-overlay, embedded-migration, spec-knowledge-layer, agent-dispatch, cli-spec-command-parity, implement-modes-v2
---

# Terminal Context Boundary — Frame's context follows Frame's terminal

## Problem

Since `non-invasive-overlay`, Frame plants nothing in the working tree, so an
agent learns about Frame only at **launch**: a preamble of pointers on
`--append-system-prompt` (Claude Code) or as the first message via a
`.frame/bin/<tool>` wrapper (Codex, Gemini), plus the spec-hint hooks on
`--settings`. That was the deliberate trade for a zero-touch repo, and it holds.

What does not hold is where the boundary actually falls.

**The intended boundary is the terminal; the enforced boundary is the
dispatch.** Frame's own terminal is a full shell — a user typing `claude` in it
is the most natural thing in the product, and it is exactly the case that gets
nothing. The wrapper only runs because Frame *types its path* into the lane; it
is not on `PATH`, so a hand-typed `codex` runs the real binary and the preamble
never happens. Two sessions in the same Frame window, in the same project, one
Frame-aware and one not, with nothing on screen explaining the difference.

**The rule is written nowhere.** A user whose terminal session does not know
about specs cannot tell whether that is a bug or a boundary. Deciding that
sessions started outside Frame get the tool's own defaults is defensible — but
only if it is stated, and only if sessions started *inside* Frame are on the
right side of it.

**The wrapper path has already drifted.** `.frame/bin/codex` in this repository
is dated 29 April and still injects the root `AGENTS.md` — the pre-overlay
template. Wrappers are rewritten only when Frame launches that tool, so a
project not opened with a given CLI keeps a stale script that would shadow the
real one the moment `PATH` makes it reachable. Any change here must make
staleness impossible, not unlikely.

**Debris found in the same surface**, each small and each a live inconsistency:
`frameTemplates.getCodexWrapperTemplate` and `getGenericWrapperTemplate` are
dead — nothing calls them; `src/templates/CLAUDE.md` still instructs agents to
read `STRUCTURE.json` / `PROJECT_NOTES.md` / `tasks.json` at the project root
and closes with a note about the `CLAUDE.md → AGENTS.md` symlink, neither of
which has existed since the overlay; and an autonomous implement launch passes
`--settings` twice (once from `aiToolManager` for the spec-hint hooks, once
from `specManager` for the permissions), where the last flag most likely wins
and the hooks are lost for exactly the runs that go unattended.

## Goal

Every agent session started **inside Frame** receives Frame's context — whether
Frame composed the command or the user typed it — on all three supported tools.
Sessions started outside Frame receive the tool's own defaults, and that
boundary is stated once where a user will read it.

Concretely: `.frame/bin/` joins `PATH` in the PTYs Frame spawns, every
supported tool has a current wrapper there, and the wrapper hands the real CLI
the same launch line a dispatch would.

## Constraints

- **`non-invasive-overlay`'s footprint rule stands.** Frame writes only inside
  `.frame/`. This rules out the two obvious shortcuts: a line in the user's
  shell rc, and a pointer block in `~/.claude/CLAUDE.md`. Both were considered
  and rejected — see *Out of Scope*.
- **Environment changes are scoped to Frame's own child processes.** The `PATH`
  entry lives in the PTY Frame spawns; nothing machine-wide is mutated, so
  there is nothing to undo when Frame is uninstalled.
- **A wrapper must never be able to exec itself.** With `.frame/bin` first on
  `PATH`, a wrapper that calls the CLI by name re-enters itself. The real
  binary must be resolved at write time, or resolved with `.frame/bin` removed
  from the search path.
- **A stale wrapper must not be reachable.** `cli-spec-command-parity` already
  set the pattern: stage on project open, rewrite only when content differs.
  Wrapper generation adopts it rather than staying launch-only.
- **The user's own invocation must survive.** `--resume`, `-p`, any flag or
  positional argument passes through untouched, and an escape to the unwrapped
  CLI exists and is documented.
- **`agent-dispatch` owns launch composition.** Flag assembly changes go
  through the existing choke point; this spec adds no second place where a
  launch line is built.
- **spec-hint hooks stay Claude-only.** `spec-knowledge-layer` delivers them
  through `--settings`, which only Claude Code takes. Creating an equivalent
  for Codex or Gemini is not part of this work.
- **The preamble's content does not change.** Only who receives it changes.

## Success Criteria

1. When a user types `claude` in a Frame terminal, the session receives the
   same preamble and settings a Frame-dispatched launch would.
2. When a user types `codex` or `gemini` in a Frame terminal, the same holds
   for those tools.
3. When a wrapper runs with `.frame/bin` first on `PATH`, it execs the real
   CLI — verified by a test that would hang or loop if it re-entered itself.
4. When a project is opened, its wrappers are rewritten from the current
   templates, so a wrapper written by an older Frame can never run; opening a
   project twice rewrites nothing the second time.
5. When a user passes their own arguments (`--resume <id>`, `-p "…"`), they
   reach the real CLI unchanged and behave as they would without Frame.
6. When a user wants the unwrapped CLI, a documented escape works and is
   discoverable from the same place the boundary is stated.
7. On Windows, either the wrapper works or no wrapper is placed on `PATH` —
   Frame never shadows a working CLI with a script that cannot run.
8. When a session is started outside Frame, nothing about it changes: the
   user's shell configuration and home directory are byte-identical before and
   after Frame has run, verified by a walk-and-diff rather than a list of
   known files.
9. The boundary — Frame's terminal carries Frame's context, outside it does
   not — is stated once in a surface a user reads, not only in a spec.
10. An autonomous implement launch carries exactly one `--settings`, and the
    spec-hint hooks are active for that run.
11. No shipped template describes the pre-overlay layout: `src/templates/CLAUDE.md`
    no longer points at root meta files and no template mentions a
    `CLAUDE.md → AGENTS.md` symlink.
12. `getCodexWrapperTemplate` and `getGenericWrapperTemplate` are gone, and no
    call site references them.

## Out of Scope

- **A Frame MCP server.** The durable answer to context delivery is to stop
  pushing it and let the agent query it; that is a change of architecture, not
  of launch plumbing, and it earns its own spec. It would also make this
  spec's boundary matter less — which is the argument for doing this one first
  and cheaply.
- **Sessions started outside Frame.** Deliberately unserved. The rejected
  options are recorded here so they are not re-proposed: a pointer block in
  `~/.claude/CLAUDE.md` (static, global, survives uninstall, cannot carry
  hooks or per-project content) and a line in the user's shell rc (a write to
  a file Frame was not invited into).
- **spec-hint hook parity for Codex and Gemini.**
- **Changing what the preamble says.** Composition is `contextPreamble`'s and
  stays as `non-invasive-overlay` left it.
- **Tool-aware autonomous permission flags.** That Codex and Gemini reject
  Claude's `--permission-mode` belongs to `implement-modes-v2`.

## Open Questions

- **Windows wrappers.** Ship `.cmd`/PowerShell equivalents in this spec, or
  restrict `PATH` injection to POSIX shells now and treat Windows as a
  follow-up? The second keeps this spec small but leaves Windows users on the
  wrong side of the boundary.
- **How to fix the double `--settings`.** Either merge both payloads into a
  single settings file at dispatch time, or make each tool's injection own its
  settings so `specManager` contributes permissions without a second flag. The
  first is smaller; the second removes the class of collision.
- **What replaces `src/templates/CLAUDE.md`.** Rewrite it as a project-layer
  template for `.frame/AGENTS.md`, or delete it outright — `non-invasive-overlay`
  established that a project layer should exist only when there is something
  project-specific to say, and the global layer plus `.frame/docs/REFERENCE.md`
  already carry the conventions.
