# CLI parity for spec commands — the full flow without the button

## Problem

Spec commands only get their real flow when dispatched from the Frame UI:
`buildSpecCommandFile` interpolates the **current** built-in template, stages
it to `.frame/runtime/prompts/`, stages command assets, and computes launch
flags. When a user instead asks an already-running CLI session to "run
spec.implement", none of that chain fires. The agent falls back to the
project's REFERENCE.md — which describes an obsolete generation of the flow
("write exactly one file", four plan sections, no Footprint, no stages, no
modes, no reports) — or to stale prompt copies from earlier dispatches.

Observed in the field: an implement run that behaved as if implement modes
did not exist. A plan produced this way lacks `## Footprint`, which silently
breaks orchestration's collision detection. Most users drive Frame from the
CLI, so today the degraded path is the common path.

## Goal

A CLI session in any Frame project — new or existing — runs
`spec.new` / `spec.plan` / `spec.tasks` / `spec.implement` with the same
current-generation flow the button produces, self-served:

1. On project open, Frame stages the current command templates and their
   assets into a Frame-owned location in the project
   (e.g. `.frame/runtime/commands/<tool>/`), refreshing them as Frame evolves.
2. The project docs' spec section becomes a version-stamped **managed block**
   that Frame can upgrade in place on project open. The upgraded text teaches
   the agent the self-serve protocol: resolve the target spec, read the staged
   template, interpolate the placeholders, follow it exactly — never improvise
   the flow from memory.
3. Existing projects get both on the next open; new projects at init.

## Constraints

- `REFERENCE.md` / `AGENTS.md` are user-owned files: only the managed block
  may be rewritten, gated by a version stamp; every byte outside it stays
  untouched. Legacy files without markers get a one-time heading-bounded
  migration; when the section can't be located confidently, do not rewrite.
- Project template overrides (`.frame/templates/commands/<tool>/`) keep
  precedence, using the existing `loadCommandTemplate` resolution order.
- The UI dispatch path keeps its behavior; watcher-side reconcile and task
  import already work regardless of trigger and must stay that way.
- Autonomous implement mode's launch flags cannot be injected into a running
  session. Parity is bounded by this: the template's existing
  record-choice-then-request-re-dispatch behavior is the ceiling, and the
  CLI-side docs must state it rather than pretend otherwise.
- Command template text may be updated where it currently assumes Frame
  launched the session, but the UI-dispatched experience must not regress.

## Success Criteria

- When Frame opens a project, `.frame/runtime/commands/<tool>/` contains the
  four current templates plus their assets (`plan-report-template.html`,
  `build-implement-report.mjs`), rewritten only when content differs.
- When a CLI agent is asked conversationally to plan a spec, the resulting
  `plan.md` has the current five sections including `## Footprint`, and a
  `plan-report.html` exists — indistinguishable in shape from a UI-triggered
  run.
- When a CLI agent is asked conversationally to implement, the mode picker is
  shown and the choice lands in `status.json`; choosing autonomous in an
  unflagged session ends in the documented re-dispatch handoff, never in
  silent degraded execution.
- When a project initialised by an older Frame is opened, its REFERENCE.md
  spec section is upgraded to the managed block exactly once, with all user
  content outside the block byte-identical.
- A project whose docs section the user deleted or heavily rewrote is left
  alone, and the staging half still works there.

## Out of Scope

- In-session privilege escalation for the autonomous mode
- Authoring codex/gemini template content (the staging mechanism ships
  tool-agnostic; claude-code is the only populated tool today)
- Orchestration/conductor changes

## Open Questions

- **CLI entry mechanism** — docs-taught protocol only, or also generate
  native slash shims (`.claude/commands/spec.*.md`) that point at the staged
  templates? Shims make `/spec.plan` work verbatim in Claude Code but add a
  second staged surface to keep fresh, and are tool-specific.
- **Target-spec resolution** — how does the agent pick the slug from
  conversation? Candidate rule: exactly one spec in an actionable phase →
  take it silently; otherwise ask. Does this need to be deterministic in the
  docs, or left to agent judgment?
- **Staging refresh trigger** — project open only, or also a manual
  `node .frame/bin/` path for projects the app hasn't opened since updating?
- **Autonomous handoff wording** — direct the user to the Frame button only,
  or also print the exact flagged launch line so a terminal-only user can
  relaunch by hand?
