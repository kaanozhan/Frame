## T01 — Close-state helper: closed specs, close items, baseline, cache and the reminder

Added `scripts/spec-close-state.js` — closed specs read from `.frame/tasks.json`, the one-item
`CLOSE_ITEMS` list, the baseline and mtime-and-size cache in `.frame/runtime/spec-close/state.json`,
the orchestration check, per-session dedup and the one-line reminder — with 34 cases in
`test/spec-close-state.test.js`. Departed from `plan.md` in three places: a fourth quiet reason,
`git-unavailable`, for a git that will not answer (the plan had it stay quiet with no reason of its
own, and `orchestrated` would have sent a reader looking for a branch that is not there); each quiet
reason is returned once per session rather than on every call, because a spec closed before the
baseline would otherwise add an activity row to every tool call for as long as it has no digest; and
an unreadable `tasks.json` reuses the existing `no-index`, reported once per change of the file. Also
beyond the plan: a non-git project is treated as not orchestrated without asking git, a date-only
`completedAt` counts as the end of that day, and a slug that is not a plain folder name is ignored.

_Captured: 2026-10-13 · 2 file changes_

---
## T02 — Declare the `spec-close` mode, its reasons and `spec.close_checked`

Added the `spec-close` mode to `hint.injected` and `hint.quiet` through one shared `HINT_MODES`
list, four reasons to `HINT_REASONS` (`orchestrated`, `before-baseline`, `no-close-time`, and T01's
`git-unavailable`, which `plan.md` did not list), a `SPEC_CLOSE_REASON_TEXT` map where `no-index`
reads as "tasks.json could not be read", and the `spec.close_checked` event with host, slug, a
`CLOSE_VERDICTS` enum and a defect count. `PRIVACY.md` gained a "Spec close reminders" bullet in the
same commit. Files: `src/shared/activityEvents.js`, `PRIVACY.md`, `test/activityEvents.test.js`.
Followup: `spec.close_checked` shows only under the Activity panel's "All" filter until
`src/renderer/activityPanel.js` maps it to the `specs` group — that file is outside this plan.

_Captured: 2026-10-13 · 3 file changes_

---
## T03 — The close script: `spec-close.js <slug> [--json] [--strict]`

Added `scripts/spec-close.js`, which prints one spec's task count and then one line per close item —
`ok`, `missing` with the digest shape, or each named defect (`no-front-matter`, `no-keywords`,
`first-sentence-too-long`, `no-chain-line`) — exits 0 unless `--strict`, and writes only its
`spec.close_checked` row; `scripts/spec-index.js` now exports `firstSentence`, `firstParagraph` and
`DIGEST_LINE_CAP`, so the length it measures is the one a hint carries. Run over this repo's 50
digests it flags 12, all for the first sentence, the figure `spec.md` measured by hand. Beyond
`plan.md`: a spec that is not closed reports `not due` and records no row, an unknown slug is a
one-line error, and a `.frame/bin/` whose `spec-index.js` predates the exports says the length was
not checked instead of reporting `ok`. Files: `scripts/spec-close.js`, `scripts/spec-index.js`,
`scripts/spec-close-state.js` (exports `SLUG_RE`), `test/spec-close.test.js`, `test/metaPathGuard.test.js`.

_Captured: 2026-10-13 · 5 file changes_

---
## T04 — Same-turn reminder in `docs-hint.js pre-edit`

Wired `scripts/docs-hint.js` to call `spec-close-state.js`'s `reminder()` on the path that used to
return in silence — a shell or edit call that is not a meta write — behind a guarded require, emit
the line as `PreToolUse` context, and write one `hint.quiet` row per reason the helper reports and
one `hint.injected` row per reminder, all under mode `spec-close`. A meta write still delivers only
its section and does not consume the reminder, which arrives on the next call. Files:
`scripts/docs-hint.js`, `test/docs-hint.test.js` (12 new cases: Claude Code `Bash` and `Edit`, Codex
shell and `apply_patch`, each quiet reason, an unreadable `tasks.json`, a `.frame/bin/` without the
helper, the inline limit with five 120-character slugs).

_Captured: 2026-10-13 · 2 file changes_

---
## T05 — Prompt-time reminder in `spec-hint.js prompt`

Split `promptMode` in `scripts/spec-hint.js` into `closeReminder`, `freshTopics` and `topicBlock`, so
the reminder is asked for before any topic path can return and goes first, whole, ahead of the
related-specs block; when the two together would pass the host's inline limit, related specs are
dropped from the end and left unmarked, so the next prompt delivers them. A prompt with related
specs and no reminder sends the same bytes as before, and stays unbounded as before. Not in
`plan.md`: when not even one related spec fits beside the reminder, the prompt path records the
existing `no-context` reason. Files: `scripts/spec-hint.js`, `test/spec-hint.test.js` (11 new cases).

_Captured: 2026-10-13 · 2 file changes_

---
## T06 — Ship the helper and the script to `.frame/bin/`

Listed `spec-close-state.js` under `HELPER_FILES` and `spec-close.js` under `ENTRY_FILES` in
`src/main/structureBootstrap.js`, with `'spec-close.js': ['spec-close-state.js']` in
`ENTRY_REQUIRES`, and added both to `build.files` in `package.json`. The two hooks get no
`ENTRY_REQUIRES` entry: they read the helper behind a guarded require and ship without it. `tasks.md`
named no test for this task; two cases went into `test/spec-close.test.js` — the staged copy runs
from `.frame/bin/`, and an installation without the helper withholds only the script.

_Captured: 2026-10-13 · 3 file changes_

---
## T07 — Digest step in the template's shared core, and the `{close_script_path}` token

Rewrote `src/templates/commands/claude-code/spec.implement.md` so the digest is a four-step item in
the shared core (write `digest.md`, run `node {close_script_path} {slug}`, fix what it names, phase
to `done`) with its shape under a new `### The digest`, named it at the phase rule, the closing
summary, the describe-your-own list and the stop condition, and removed the section at the end;
`src/main/specManager.js` and `scripts/spec-command-hint.js` each gained a `closeScriptRel` that
fills the token. Two sentences are not in `plan.md`: step 2 says the digest alone is the step when
the script is not there (an older `.frame/bin/`), and the shape section says why the first sentence
must stand alone within 280 characters. Files: the template, `src/main/specManager.js`,
`scripts/spec-command-hint.js`, `test/codexTemplates.test.js`, `test/spec-command-hint.test.js`,
`test/spec-close.test.js`.

_Captured: 2026-10-13 · 6 file changes_

---
## T08 — Frame's own reference names the close script and the reminder

Extended the `digest.md` paragraph of the Spec Knowledge Layer section in `.frame/docs/REFERENCE.md`:
why the first sentence must stand alone within 280 characters, what `scripts/spec-close.js <slug>`
reports and that it never writes the digest or sets a phase, which two hooks give the one-line
reminder and when, and the two cases that are never announced. As `plan.md` D15 decided,
`getReferenceTemplate()` is untouched, so user projects' reference still does not describe the digest.

_Captured: 2026-10-13 · 1 file change_

---
## T09 — Fixture builder and runner for the test run

Added `scripts/eval/spec-close/make-fixture.js`, which builds a throwaway git project around a
two-task dummy spec with `.frame/bin/`, the staged command files and the hooks all taken from Frame's
own code, in three kinds (`natural`, `induced-prompt`, `induced-turn`), and `run.js`, which launches
headless `claude -p` sessions over them and tabulates `spec-close.js --json`, the reminder and close
rows, cost and tool calls; `test/spec-close-fixture.test.js` drives each kind through the fixture's own
registered hook commands with no agent. Chosen where `plan.md` was silent: sessions launch with the
permission file `implement-launch.js` builds and `--permission-mode auto` (not
`--dangerously-skip-permissions`), project settings only, no MCP and no saved session, and `--n` has
no default so nothing is spent by accident. Files: the two scripts, the test,
`scripts/spec-close-state.js` (exports `STATE_VERSION`).
Followup: Frame's autonomous allowlist (`IMPLEMENT_ALLOW`) does not name `spec-close.js`, so in a real autonomous run the digest step's command is decided by auto mode's classifier rather than by a rule.

_Captured: 2026-10-13 · 4 file changes_

---
## T10 — Pilot: one session per kind, and the time the check adds to a hook

Ran one headless session per kind on `claude-opus-5-5`, $0.50 in total: `natural` took 11 tool
calls and $0.37 and ended with the digest `ok`, the close script run by the agent itself; `induced-prompt`
(1 tool call, $0.07) and `induced-turn` (2 tool calls, $0.07) each received the reminder and left the
digest missing, telling the user they had seen it and had not acted because it was outside the request.
Measured on a copy of this repo's 628 KB `tasks.json`, 60 runs per condition, the hook takes 29.0 ms
(median) without the helper, 30.0 ms on a cache hit (+1.0 ms, inside the 5 ms constraint) and 35.0 ms
on a miss (+6.0 ms). The pilot's first table counted no reminders because `run.js` looked for the rows
under the project path it held while the CLI hands hooks the resolved one (`/private/var` on macOS), so
`closeRows` now reads every bucket of the fixture's own activity home; the pilot was re-tabulated from
its transcripts with no new session, and `test/spec-close-fixture.test.js` gained the case.
Followup: every Claude Code prompt and tool-call row in the pilot is labelled `codex-hook` — `toolVocabulary.cliOf` reads a field Claude Code now sends as a Codex signal, which also hands `docs-hint.js` and `spec-hint.js` Codex's 20 000-character inline cap in Claude Code sessions (`spec.md` lists `cliOf` as a separate task).

_Captured: 2026-10-14 · 2 file changes_

---
## T07 — Revision: the digest rides in the last task's commit

The pilot's natural run committed its last task and then the digest in a commit of its own, because
the guided/autonomous loop committed at step 7 while the digest step sat in the closing summary after
the loop. At the user's request the template now runs the digest step before the last task's commit,
in every mode: the shared core says the digest and the phase change go into that task's commit and
never into one of their own, step 6 of the loop and step 3 of step-by-step run it, and the closing
summary only reports it. Files: `src/templates/commands/claude-code/spec.implement.md`,
`test/codexTemplates.test.js` (one case per CLI).

_Captured: 2026-10-14 · 2 file changes_

---
## T11 — The reminder goes only to the session that closed the spec

Reworked `scripts/spec-close-state.js` so a session's first hook run notes which specs are already
closed; a spec missing an item that was not among them is announced to that session once, and one
that was is recorded as `closed-earlier` and never reaches the conversation. The project baseline and
the close-time gate are gone (state file version 2, which also caches the open specs).
`src/shared/activityEvents.js` and `PRIVACY.md` now list `closed-earlier` in place of the unshipped
`before-baseline` and `no-close-time`. Departed from `plan.md` D16 in mechanism, not intent: the
session notes what was *closed* at its start rather than what was open, because a spec whose tasks are
generated and completed inside one session was open at no first look, and a spec seen open again
mid-session (a task added to it) leaves that list so its next close counts as the session's. Also
removed the backdated baseline from `scripts/eval/spec-close/make-fixture.js`, a T13 file, so the
fixtures stayed true. Files: the helper, the registry, `PRIVACY.md`, the comments in
`scripts/docs-hint.js` and `scripts/spec-hint.js`, and five test files.

_Captured: 2026-10-14 · 11 file changes_

---
## T12 — Fixes after close carry their own record

Added a "fix after the last task" paragraph to the shared core of
`src/templates/commands/claude-code/spec.implement.md`: the fix's own commit carries a `## Fix — <title>`
outcome entry, and, when the fix changes a decision the digest records, the digest corrected in place with
a `Revised <date>:` line and the close script run again; the agent asks when unsure. `scripts/spec-hint.js`
pre-edit appends one conditional sentence saying the same when the newest record for the file is a finished
spec (not for in-flight specs, not in signal mode), and `scripts/spec-index.js` reads `## Fix —` entries as
records with task `Fix`. `.frame/docs/REFERENCE.md` now states the reminder's audience and the fix rule.
Files: those four plus `test/codexTemplates.test.js`, `test/spec-hint.test.js`, `test/spec-index.test.js`.

_Captured: 2026-10-14 · 7 file changes_

---
## T13 — The test run, redefined: five kinds and a pass rule each

`scripts/eval/spec-close/make-fixture.js` now builds `natural`, `closing-turn`, `earlier-close`, `fix-bug`
(a finished spec with a planted missing comma) and `fix-decision` (a finished spec whose digest records the
`stranger` rule the prompt overturns); it builds the spec index as Frame keeps it and dates the base commit
before the tasks closed, so finished files are not flagged stale. `scripts/eval/spec-close/run.js` reads facts
off each fixture (close verdict, Fix entry, digest changed or revised, digest committed beside code, `npm test`,
the greeting's behaviour) and `judge` turns them into a pass per kind; `test/spec-close-fixture.test.js` drives
every kind with no agent and checks each rule both ways. Beyond `plan.md`: the reminder line now tells the
session it closed the spec and to finish it — the ownership wording proposed with D16 but missed in T11, without
which `closing-turn` would measure the pilot's informational line again (`scripts/spec-close-state.js` and four test files).

_Captured: 2026-10-14 · 8 file changes_

---
## T14 — Second pilot: one session per kind

Ran by the user, one `claude-opus-5-5` session per kind, $0.74 in total: `natural` passed (14 tool calls,
$0.40; digest `ok` inside T02's commit, close script run by the agent) and `earlier-close` passed (no reminder,
digest untouched); `closing-turn` failed because auto mode's permission classifier blocked
`node .frame/bin/spec-close.js` after the reminder sent the agent to run it — the agent took the line as its
own work this time, unlike the first pilot; `fix-bug` and `fix-decision` fixed the code correctly (tests pass)
but wrote no Fix entry, because both edited through `sed -i` in the shell, so `spec-hint.js pre-edit` (registered
on Edit and Write only) never fired, while the prompt-time hint naming the finished spec did. In `fix-decision`
the agent noticed unprompted that the digest now contradicted the code and asked the user whether to revise it.
Followup: Frame's autonomous allowlist (`IMPLEMENT_ALLOW` in `specManager.js` and `implement-launch.js`) needs `spec-close.js`; and the fix rule needs a channel that does not depend on which edit tool runs — the prompt-time hint for a finished spec is the one that fired.

_Captured: 2026-10-14 · 0 file changes_

---
## T15 — The close script in Frame's autonomous allowlist

Added `Bash(node .frame/bin/spec-close.js *)` to `IMPLEMENT_ALLOW` in `src/main/specManager.js` and in the
shipped `src/templates/bin/implement-launch.js`, so the digest step's command is allowed by a rule instead of
by auto mode's classifier, which allowed it in one pilot session and blocked it in the next. Only the shipped
path is allowed, not `scripts/spec-close.js`, which would match any project's own script of that name.
`test/implementLaunch.test.js` now asserts the rule and that the app and the launcher build the same permission
file — the two copies had no test holding them together before.

_Captured: 2026-10-14 · 3 file changes_

---
## T16 — The fix rule at the prompt

`scripts/spec-hint.js` prompt mode now ends its related-specs block with the fix sentence when the specs it
sends include finished ones, naming only those (one path when one, "the outcome.md of the spec it touches"
when several); `fixInstruction` takes the subject — "this request" at the prompt, "this edit" at an edit — and
the pre-edit wording is unchanged. The sentence sits inside the block D8's budget rule measures, so a spec
dropped for room is not named either. Also brought `.frame/docs/REFERENCE.md` in line (both channels, and that
the edit-time one covers the edit tool only). Files: `scripts/spec-hint.js`, `test/spec-hint.test.js`, REFERENCE.md.

_Captured: 2026-10-14 · 3 file changes_

---
## T17 — Third pilot: four kinds pass; closing-turn's single turn cannot reach the reminder

Ran by the user, one `claude-opus-5-5` session per kind, $0.75 in total: `natural` (12 tool calls, digest
`ok` in the last task's commit, close script run), `earlier-close` (silent), `fix-bug` (a `## Fix —` entry
committed with the code, the agent stating no digest decision changed) and `fix-decision` (a Fix entry, the
digest's rule corrected in place with a `Revised 2026-10-14:` line, all in one commit) passed. `closing-turn`
failed without a fault in the product: the agent ran the closing script and `git status` as one shell call,
so the only PreToolUse ran before the task closed, the turn ended, and a single-prompt headless session has no
next prompt to carry the reminder — the path the product uses for exactly this case.
Followup: give `closing-turn` a second turn (resume the same session with a short follow-up prompt), so it measures the next-prompt path.

_Captured: 2026-10-14 · 0 file changes_

---
## T18 — A second turn for closing-turn

`scripts/eval/spec-close/run.js` now resumes a `closing-turn` session with "Thanks." (`FOLLOW_UP`), keeping only
that kind's session on disk because `--resume` needs it and resuming keeps the id the helper keys on;
`parseTranscript` adds cost, turns and time across the two streams and keeps the first session id, and the dry run
prints both launch lines. `test/spec-close-fixture.test.js` covers the launch lines, the summed transcripts, and —
with no agent — the third pilot's shape: the closing call is the turn's last, and the resumed prompt carries the
reminder. Followup: two-turn sessions leave their transcripts under `~/.claude/projects/`, one folder per fixture path.

_Captured: 2026-10-14 · 2 file changes_

---
## T19 — Main run: 130 headless sessions

Ran by the user on `claude-opus-5-5`, $21.48 in total, in two commands (`natural` 10, every other kind 30).
Every kind passed in full but `closing-turn`, where all 30 sessions received the reminder, 26 wrote the digest
and ran the close script, and 4 relayed it and asked the user first, because the request had been only to run
two commands — none treated the second turn's "Thanks." as consent. Codex was verified by payload fixtures only;
no end-to-end Codex session was run.

| kind | sessions | pass | digest ok | reminder fired | ran the close script | Fix entry | digest revised | median tool calls | cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| natural | 10 | 10 | 10 | 0 | 10 | 0 | 0 | 11.5 | $3.82 |
| closing-turn | 30 | 26 | 26 | 30 | 26 | 0 | 0 | 7 | $7.94 |
| earlier-close | 30 | 30 | 0 | 0 | 0 | 0 | 0 | 1 | $1.83 |
| fix-bug | 30 | 30 | 30 | 0 | 0 | 30 | 0 | 4 | $3.64 |
| fix-decision | 30 | 30 | 30 | 0 | 0 | 30 | 30 | 4 | $4.25 |

Followup: the prompt-time fix sentence rides every topic match on a finished spec, false positives included — seen on this repo's own prompts during the run; narrowing it is open.
Followup: the 30 two-turn sessions left their transcripts under `~/.claude/projects/`, one folder per fixture path.

_Captured: 2026-10-14 · 0 file changes_

---
## Fix — The fixture's `npm test` ignores the outer test runner

CI on Node 20.19 failed `fix-bug` in `test/spec-close-fixture.test.js`: "the planted bug fails the tests" got a
pass. `inspect` in `scripts/eval/spec-close/run.js` ran the fixture's `npm test` with the inherited
`NODE_TEST_CONTEXT`, which `node --test` sets on every test file it runs; the fixture's own runner then took
itself for a child reporting to a parent and exited 0 on a failing test. Node 20.5.1, where the suite was run
locally, exits 1 either way, so it never showed. `inspect` now drops the variable for that call only. A
headless run from the shell never had it, so the main run's numbers stand. Within the recorded decisions; the
digest is unchanged.
Followup: the fixture's `node --test test/` is a directory argument, which Node 21 and later read as a module
path, so `fix-bug` and `fix-decision` fail on those versions; CI runs Node 20.

_Captured: 2026-10-15 · 2 file changes_

---
