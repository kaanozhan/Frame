---
keywords: spec close, digest, close step, digest check, reminder hook, decision cards, determinism
related: spec-knowledge-layer, codex-parity, activity-monitor, agent-orchestration, implement-modes-v2
---

# Spec Close Step

## Problem

A spec's digest is its agent-facing memory: every hint carries its first
sentence, and the decision-memory work will ask for decision cards at the
same moment the digest is written. That moment exists only as prose.

- **Writing depends on one instruction.** The digest step is a conditional
  section at line 413 of a 445-line implement template, after the last mode.
  Since it shipped (2026-08-26), 69 of 73 specs closed across four projects
  have a digest. Three of the four misses ran the full flow, every outcome
  entry written, and still skipped it.
- **Nothing notices a miss.** `done` is derived from task state alone; no code
  looks for the digest, so a miss stays until someone counts.
- **Nothing checks the shape.** Hints deliver the first sentence, capped at 280
  characters; 12 of 50 measured digests overflow and are cut mid-thought.
- **The closing moment is invisible to hooks.** Agents close tasks through
  shell scripts: of 1602 edit-tool calls recorded in four projects, none
  targeted `.frame/tasks.json`. A trigger on "the agent edits tasks.json"
  never fires.

## Goal

A close step for specs, built from parts that do not depend on the card
format, so cards join it later instead of replacing it.

1. **Close state** — a dependency-free helper that reads disk and returns, per
   spec, the close items still missing. A spec is *closed* when it has at
   least one spec task in `tasks.json` and all of them are completed. Today
   there is one item: `digest` (`.frame/specs/<slug>/digest.md` is absent).
   The item list is the extension point.
2. **Close script** — `node .frame/bin/spec-close.js <slug>` reports the
   missing items for one spec and checks an existing digest: front-matter
   present, first sentence within 280 characters, chain line present. It names
   each defect. It never sets a phase.
3. **Callers** — the implement template states the digest in its shared core,
   as a numbered step that ends by running the close script, and at every
   place it says the phase goes to `done`; the section at the end is removed.
   The hooks that already run (`docs-hint.js pre-edit` before shell and edit
   calls, `spec-hint.js prompt`) emit a one-line reminder naming the command
   when a spec closed in the current session has missing items — never in a
   session that did not close it. The digest rides in the last task's commit,
   never in one of its own.
4. **Record** — every reminder, every reason for staying quiet and every
   script verdict lands in the activity log.
5. **Fixes after close** — a fix to a closed spec's work (a bug found while
   testing, a small correction to the plan) carries its own record in its own
   commit: an outcome entry, and a revised digest when the fix changes a
   decision the digest records. The agent making the fix is told so at the
   moment it is about to change a finished spec's file.

## Constraints

- **`done` stays derived.** `derivePhase` is untouched; no `/spec.done`
  command (rejected in `spec-knowledge-layer`); the digest still rides the
  last implement turn. A missing digest never blocks or rewinds a phase — a
  spec held at `implementing` loses its file history in the index and raises
  false in-flight warnings.
- **Additive.** The agent keeps writing `digest.md` directly. An agent that
  skips the script leaves exactly today's behaviour.
- **Hook contract** (`spec-knowledge-layer`): never block, never break — any
  failure is exit 0 and silence; a wrong hint is worse than none.
- **No new hook event or registration**, for either CLI. Codex hooks are
  global and trust-gated (`codex-parity` D2, D4).
- **Claude Code's 2000-character inline limit** holds for every hook output,
  including a reminder combined with what the hook already delivers.
- **Detection reads disk state**, never the content of an edit or a patch.
- **One template source** for every CLI (`codex-parity` D5).
- **Orchestration** (`agent-orchestration`): workers never touch meta files,
  and a worker's digest lives on `frame/<slug>/integration` until promotion.
  No reminder may ask for a second digest for such a spec.
- **Activity log rules** (`activity-monitor`): modes and reasons are declared
  in `src/shared/activityEvents.js`, fields are enums, counts or paths, and
  `PRIVACY.md` changes in the same commit.
- **Shipping.** Scripts stay dependency-free and reach `.frame/bin/` through
  `structureBootstrap`; a project whose `.frame/bin/` predates the helper
  behaves as it does today.
- **Latency.** The check adds at most 5 ms to a hook run when `tasks.json` has
  not changed since the last check (uncached it measured 11 ms on a 617 KB
  file, against a 44 ms hook process).

## Success Criteria

- When a session completes a spec's last task and its digest is absent, then
  that session's next shell or edit tool call, in Claude Code or Codex,
  receives the one-line reminder.
- When that turn ends without another tool call, then the session's next user
  prompt carries the reminder — with or without a topic match, inside the limit.
- When a spec has been announced in a session, then it is not announced again
  in that session.
- When the digest exists, then no reminder appears in any mode.
- When the spec is run by an orchestration worker, or closed before the
  session started, then no reminder appears in that session.
- When a spec is implemented through the template in any mode, then the
  digest and the phase change are in the last task's commit and no commit
  carries the digest alone.
- When an agent is about to edit a file whose newest spec record is a finished
  spec, then the history it is shown says how a fix records itself.
- When a fix changes a decision the digest records, then the fix's commit
  carries an outcome entry and the revised digest; when it is a bug fix within
  the decisions, then it carries an outcome entry and the digest is unchanged.
- When `spec-close.js <slug>` meets an overlong first sentence, missing
  front-matter or a missing chain line, then it names that defect; when the
  digest is well-formed, it says so in one line.
- When `.frame/bin/` lacks the helper, or `tasks.json` is unreadable, then
  both hooks behave as today and the quiet reason is recorded where a record
  is possible.
- When a reminder fires or is withheld, then the activity log holds a row with
  its mode and reason.
- When the implement template is rendered for any CLI, then the digest step
  sits in the shared core and at each `done` statement, and the old end
  section is gone.
- When the full test suite runs, then it passes, and the added hook time is
  within the latency constraint.

## Out of Scope

- Decision cards: schema, file, writing, the approval question, the conductor
  writing them (decision-memory roadmap steps 2 and 5).
- Digest as a condition of `done`; a Stop hook; Frame typing into an agent's
  terminal when a spec closes.
- A script that generates the digest text (no model call from Frame).
- Pointing the prompt-time hint at `digest.md` (separate task).
- Writing the nine missing digests (separate task).
- The CLI label in the activity log, `toolVocabulary.cliOf` (separate task,
  needed to read reminder records per CLI).
- A marker in Frame's UI for a done spec without a digest.
- Hooks for Gemini.

## Open Questions

- **Recognising an orchestrated spec from a hook.**
  - `.frame/worktrees/<slug>` or a `frame/<slug>/…` ref exists in the git dir.
  - Skip any spec whose tasks were closed while an orchestration session was
    active, read from Frame's own state.
- **The window for "recently closed".**
  - 14 days from the last task's `completedAt`.
  - A fixed cut-off date shipped with the script.
- **Exit code of the close script on a malformed digest.**
  - Always 0; the output carries the verdict.
  - Non-zero, so the agent's shell result shows a failure.
- **Verifying Codex.**
  - Unit fixtures with Codex payloads only.
  - Fixtures plus one manual Codex session on a fixture project, recorded in
    the outcome.
