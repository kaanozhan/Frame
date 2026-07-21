# Plan — Implement modes — selectable and user-definable spec.implement flows

## Architecture

### Resolved plan-time decisions

- **D1 · The mode is asked at every dispatch, before any work** (asked, then
  revised) — `spec.implement` reads spec, plan and tasks, then always shows
  the picker and waits before editing anything. A saved default does not
  silence the question; it moves that option to the top marked `(default)`,
  so confirming it is a single keypress.
  **First decided as "ask once per spec and persist"; revised on the user's
  direction.** Always-asking makes switching modes free — run the first tasks
  step by step, then hand the rest to the autonomous mode — and default-first
  ordering keeps the cost at one keystroke. What survives from the original
  decision is the *before any work* half: a task executed before the answer
  obeys no mode — uncommitted, absent from the report — and a rich run would
  then need retroactive repair.

- **D2 · The rich mode commits per task without asking** (asked) — code,
  outcome entry, report data and state files in one atomic commit, then an
  amend to fold in the hash. *Rationale:* "ask almost nothing" is the mode's
  reason to exist. A confirmation between tasks turns it back into the
  step-by-step mode. Nothing is pushed, so a bad commit is cheap to undo.

- **D3 · Test posture: pure logic and data transforms only** (asked, via the
  new posture gate) — the report generator's `report-data.json → HTML`
  transform gets a test; the prompt template, the git-facing code and the asset
  staging do not. *Rationale:* the testing record's **Covered** line states the
  convention — test the pure module, skip the Electron-coupled wrapper. This
  spec is the first to ship executable code rather than only prompts, so
  "nothing to test" no longer applies.

- **D4 · Permissions: `auto` mode plus a denylist Frame owns** (asked, then
  revised) — Frame generates `.frame/implement-permissions.json` and passes it
  at dispatch with `--settings`, together with `--permission-mode auto`.
  *Rationale:* verified against the CLI — `--settings <file-or-json>` takes an
  arbitrary path and loads *additional* settings, so the file lives under
  `.frame/` and `.claude/` is never written (C2 holds) and the user's own
  settings are not overridden.
  **First decided as `dontAsk` and reversed on review.** `dontAsk` silently
  denies everything outside the allowlist with no way to ask — so any
  unanticipated but harmless command (`mkdir`, `mv`, `git status`, a formatter)
  stalls the loop, and an exhaustive allowlist cannot be written in advance.
  `auto` gives the behaviour the mode actually needs: allow/deny rules resolve
  first exactly as in every mode (so the push denial keeps its teeth),
  unlisted harmless operations are approved by the background classifier,
  genuinely dangerous ones (force push, `curl | bash`, history destruction)
  are blocked, and after 3 consecutive or 20 total blocks the session **pauses
  and prompts the user** — ask-when-it-matters instead of deny-and-stall.
  A rule-based configuration is also the only thing that works at all here: an
  interactive `Edit`/`Write` approval lasts only for the session and is never
  persisted, while only `Bash` approvals are written to
  `.claude/settings.local.json`.

- **D5 · A described flow lives in its own file** (asked) —
  `.frame/implement-flow.md` holds the text; `.frame/config.json` references it
  by name. *Rationale:* a description runs to paragraphs, config files are read
  whole, and a multi-paragraph JSON string is unreadable and painful to edit by
  hand.

- **D6 · Frame supplies the Node runtime** (asked) — Frame injects its own
  executable into the dispatched terminal's environment and the prompt invokes
  the generator through it, never through a bare `node`. *Rationale:* verified
  — `ELECTRON_RUN_AS_NODE=1` on Frame's own binary runs as Node 18.18.2, so the
  runtime is already present and depending on the user's `PATH` is a
  self-inflicted failure. Frame is the tool; providing the runtime it needs is
  its job. `orchestrationManager.js:87` (`envForLane`) and `ptyManager.js:217`
  are the established path for handing a terminal an environment.

- **D7 · Staging extends to `spec.implement`** (silent) —
  `buildSpecCommandFile` currently stages the report asset only for
  `spec.plan` (`specManager.js:344`). *Rationale:* mechanical consequence of
  shipping a second staged asset; the spec did not anticipate it.

- **D8 · Runtime fallback order** (silent) — injected runtime → `node` on
  `PATH` → skip the report, say so once, keep `report-data.json` so a later run
  can produce it. *Rationale:* with D6 the first branch is the normal path;
  the rest covers a terminal Frame did not dispatch. The work — code, commit,
  outcome entry — never depends on the report.

- **D9 · "Never push" becomes a deny rule** (silent) — `Bash(git push *)` in
  the denylist. *Rationale:* deny is evaluated first and cannot be overridden
  at a lower scope, so C7 stops being a request in prose and becomes
  mechanically impossible. The same applies to history rewrites beyond the
  mode's own `--amend`.

- **D10 · Launch flags come from a hint; an upgrade costs one re-dispatch**
  (asked) — Frame cannot know the picker's answer at launch time, so it
  launches with the flags matching this spec's **last choice**
  (`status.json`), else the project default, else none. If the user then
  picks a mode needing *more* autonomy than the session was launched with —
  autonomous, in a session launched bare — the agent records the choice and
  asks for one re-dispatch instead of running a mode whose promise it cannot
  keep: an autonomous run without the flags would hit a permission prompt on
  every edit, the exact thing the mode exists to avoid. Picking a *less*
  autonomous mode than the flags allow is harmless and proceeds — step-by-
  step's control point is the agent's own per-task question, not the
  permission layer.

### The three modes

Three modes; the picker shows three or four entries depending on whether a
custom flow has been saved. Each entry is described by what the user gets
rather than by name:

| Mode | Loop | Commits | Verifies | Report |
| --- | --- | --- | --- | --- |
| **Step by step** | user turns it | on request | no | no |
| **Autonomous + report** | agent turns it | per task, atomic | yes | yes |
| **Describe your own** | as described | as described | as described | as described |

The picker must state, for the autonomous mode, that it produces an HTML report
openable as each task completes, showing that task's real diff, a what-changed /
why-changed summary and its test result. Naming a mode is not describing it.

### The picker

Shown at **every** dispatch (D1). Composition:

- **A · Step by step** and **B · Autonomous + report** are always present.
- **C** is the project's saved custom flow, when one exists, shown by name.
- The last entry is always **describe your own** — lettered C when no flow is
  saved, D when one is.
- A saved default moves to the top and is marked `(default)`; confirming it is
  a single keypress.

After a choice, `status.json` `implement_mode` records it — not as "the
resolved mode, never ask again" but as **the last choice**, which the next
dispatch uses as its launch hint (D10). When no project default exists yet,
the run offers once to save the chosen mode as the default; on yes it goes to
`.frame/config.json`, and for a described flow the text goes to
`.frame/implement-flow.md` (D5). The offer never repeats once a default
exists — changing it later is an explicit ask or a config edit.

The step-by-step cost is accepted knowingly: one dispatch per task means one
picker per task. Default-first makes that a single Enter, and it buys free
mode-switching mid-spec — start step by step, hand the rest to the autonomous
mode once trust is earned.

`implement_mode` is additive: `validateSpecStatus` (`specManager.js:91`) checks
required fields only, and every `writeStatus` call spreads the existing object
(`:239`, `:479`, `:612`), so unknown keys survive untouched.

### The shared core

Every mode, including a described one, obeys these. A described flow may change
the loop, the commit policy, the verification and the reporting — it may not
drop the accounting, which is what separates it from the existing template
override that replaces everything.

- Task selection: lowest-numbered `pending` task whose `source` is
  `spec:<slug>:T<n>`.
- Scope authority: `plan.md`'s **Files** and **Sequencing**.
- Task state: `in_progress` on start, `completed` + `completedAt` on finish.
- Spec phase: `implementing` at the start, `done` when nothing remains.
- One `outcome.md` entry per completed task, in the existing format.
- Never push; never touch `main`.

### Permissions

Frame writes `.frame/implement-permissions.json` and passes it at dispatch:

```
--settings <path> --permission-mode auto
```

The **denylist carries the safety load**: pushing, and history rewrites other
than the mode's own amend. Deny rules are evaluated first in every mode and
cannot be overridden at a lower scope — and they are genuinely needed, since
auto mode's classifier otherwise permits pushing to the working repository by
default.

The allowlist covers the known hot path — file edits and writes, the git
plumbing for staging, committing, reading a hash and reading a diff, and the
project's own verification command from `.frame/config.json`
`project.commands` — so those resolve as rules without a classifier pass.
Anything unanticipated but harmless (a `mkdir`, a rename, a formatter) is
approved by the classifier rather than stalling the run; anything genuinely
dangerous is blocked; and repeated blocks (3 consecutive / 20 total) pause the
run and put a real question to the user.

Nothing is written to `.claude/`, so C2 holds. Because `--settings` *adds*
rather than replaces, a user's own rules stay in force, and a deny at any scope
still wins.

### The implementation report

Frame ships a generator, staged into `.frame/runtime/assets/` on dispatch
exactly as the plan-report template is today (`stageReportTemplateAsset`,
`specManager.js:314`) — packaged assets live inside `app.asar` and a terminal
CLI cannot read them.

The agent writes only `report-data.json` in the spec folder. The generator
reads it, pulls each commit's real unified diff from git by hash, and emits
`implement-report.html`, self-contained. Diffs are never transcribed by the
agent — that is the one place a hallucination would silently corrupt the
artifact, and the reason the report is generated rather than written.

Per-commit diffs exclude `.frame/` and the report's own files, so the report
shows implementation and not its own bookkeeping.

Per task the rich mode: implement → verify → append report entry with an empty
hash → append the outcome entry → mark completed → **one atomic commit** →
read the short hash, fill it in, regenerate, `git commit --amend --no-edit`.
Amend is safe precisely because nothing is pushed.

The generator must run on **Node 18** — Frame's bundled runtime is 18.18.2 even
though the repo's own CI uses Node 20.

### Scope note — this plan extends the spec

`spec.md` C1 says the machinery lives in the prompt template plus
`status.json` / `.frame/config.json`, with no IPC or renderer work. Two gate
decisions cross that line, both at dispatch rather than in the UI:

- **D4** — permission configuration is a launch-time concern. It cannot be set
  from inside a running session, so a prompt-only design cannot deliver the
  autonomy the mode is for.
- **D6** — the runtime must be handed to the terminal by whatever launches it.

No renderer, modal or IPC work is added; the change is confined to how the
command is dispatched. The spec's intent — that mode *selection* stays in the
prompt and out of the UI — is preserved.

The plan also **supersedes two success criteria**, on the user's explicit
direction (D1 revision). S2 ("a second dispatch on the same spec does not
re-ask") and S3's "a different spec in the same project then runs without
being asked" both encode the ask-once design that was replaced with
ask-always, default first. Their verifiable readings become: **S2′** — a
second dispatch shows the picker with the recorded choice on top, confirmable
in one keypress; **S3′** — once a default is saved, every spec's picker leads
with it, and the save offer never repeats. `spec.md` is left as written; this
paragraph is the record of the change.

### Plan-added success criteria

`spec.md`'s S1–S9 predate D4 and D6, so none of them says anything about
permissions, prompting, or the runtime — which leaves roughly a quarter of this
plan (steps 1–3) claimed by no criterion and therefore unverifiable. The plan
adds three, marked **P** to keep them distinguishable from the spec's own:

- **P1** — the autonomous mode implements a multi-task spec end to end without
  a permission prompt between steps. *Proof:* run it and count the
  interruptions; the target is zero.
- **P2** — an attempted push is refused by rule rather than by the agent
  declining. *Proof:* have a run try `git push` and confirm the denial comes
  from the permission layer, not from the prompt's instruction.
- **P3** — the report is produced on a machine with no `node` on `PATH`.
  *Proof:* run with `PATH` stripped of Node and confirm the report still
  generates through the injected runtime.

P2 matters beyond bookkeeping: it is the difference between C7 being requested
and C7 being enforced, and only a test that actually attempts the push can tell
those apart.

## Files

- `src/templates/commands/claude-code/spec.implement.md` — **Modified** —
  rewritten around mode resolution, the three modes, and the shared core.
- `src/templates/commands/claude-code/build-implement-report.mjs` — **New** —
  report generator: `report-data.json` + git → self-contained HTML. Node 18.
- `test/implementReport.test.js` — **New** — covers the pure
  `report-data.json → HTML` transform (D3).
- `src/main/specManager.js` — **Modified** — stage the generator for
  `spec.implement` as well as the plan-report asset for `spec.plan` (`:344`);
  write and expose `.frame/implement-permissions.json`.
- `src/renderer/agentDispatch.js` — **Modified** — pass `--settings` and
  `--permission-mode` when dispatching a spec whose resolved mode is
  autonomous.
- `src/main/aiToolManager.js` — **Modified** — allow a dispatch to extend the
  tool's launch command with flags.
- `src/main/ptyManager.js` — **Modified** — inject Frame's own runtime path
  into the dispatched terminal's environment.

## Footprint

- src/templates/commands/claude-code/spec.implement.md
- src/templates/commands/claude-code/build-implement-report.mjs
- test/implementReport.test.js
- src/main/specManager.js
- src/renderer/agentDispatch.js
- src/main/aiToolManager.js
- src/main/ptyManager.js

## Dependencies

None. The generator uses Node built-ins and shells out to `git`; the test uses
`node --test`, already wired as `npm test`.

## Sequencing

1. **Inject Frame's runtime into dispatched terminals.** Expose Frame's own
   executable as an environment variable on the PTY, alongside the existing
   orchestration variables, so a dispatched command can invoke Node without
   depending on the user's `PATH` (D6).

2. **Generate and stage the permission file.** Write
   `.frame/implement-permissions.json` from the mode's needs and the project's
   own verification command, with the denylist that makes pushing impossible
   (D9). Nothing under `.claude/`.

3. **Let a dispatch carry launch flags.** Extend the AI-tool launch path so a
   dispatch can append flags, then pass `--settings` and
   `--permission-mode auto` when the **launch hint** — this spec's last
   choice, else the project default — is autonomous (D4, D10).

4. **Write the report generator.** `report-data.json` + per-commit `git show`
   with the exclusion pathspec → one self-contained HTML file. Node 18, no
   dependencies, pure transform separated from the git and filesystem calls so
   it can be tested.

5. **Cover the transform.** `test/implementReport.test.js` over the pure
   `report-data.json → HTML` path, with no git and no filesystem (D3).

6. **Stage the generator on `spec.implement` dispatch.** Generalise the staging
   at `specManager.js:344` so it is driven by the command rather than hardcoded
   to `spec.plan` (D7).

7. **Add the picker to the prompt.** Shown at every dispatch: the two built-in
   modes, the saved flow as C when one exists, describe-your-own last, a saved
   default moved to the top and marked; the choice written to `status.json` as
   the last choice; the one-time offer to save a default; and the upgrade seam
   — record the choice and request one re-dispatch when the picked mode needs
   flags the session was not launched with (D10) — including the CLI-agnostic
   asking rule and the hard stop-and-wait when no structured-question tool
   exists.

8. **Add the shared core to the prompt.** Task selection, scope authority, task
   state, phase, `outcome.md`, never push — stated as binding on every mode
   including a described one.

9. **Add the step-by-step mode.** Today's behaviour plus a what-changed /
   why-changed close-out per task and exactly one question: commit and
   continue, or stop.

10. **Add the autonomous mode.** The per-task loop through verification, the
    atomic commit, and the amend that folds in the real hash; narrow stop
    conditions; the runtime fallback order (D8).

11. **Add the described-flow mode.** Gather the description, run it over the
    shared core, and offer to save it to `.frame/implement-flow.md` referenced
    from `.frame/config.json` (D5).
