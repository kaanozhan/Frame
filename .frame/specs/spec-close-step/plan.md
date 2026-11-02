# Plan — Spec Close Step

## Architecture

### Resolved plan-time decisions

Business

- **D1 · Which closed specs the reminder follows (asked).** *Superseded by
  D16 (2026-10-14).* Every spec closed
  after the base first runs in a project, with no expiry: it is announced once
  per session until its digest exists. Specs closed before that moment are
  never announced. Rejected: a rolling 14-day window — quieter, but a skipped
  digest ages out in silence, which is the failure this spec exists to end.
- **D2 · Verifying Codex (asked).** Unit fixtures in Codex's payload shapes.
  The outcome states in so many words that no end-to-end Codex session was
  run. Rejected: a manual Codex session as a closing condition — this machine
  has no `codex` binary and no `~/.codex/hooks.json`, so the spec would wait
  on an install that is not part of its work.
- **D3 · A test run with dummy specs (requested by the user).** Headless
  Claude Code sessions (`claude -p`), one per throwaway project, several at a
  time. Two kinds: *natural* (implement a two-task dummy spec end to end) and
  *induced* (the project starts with every task completed and no digest).
  A pilot of three sessions comes first; its measured cost is reported and
  the user picks N before the main run. Rejected: this session's subagents —
  across 26 past subagent transcripts 18 received a PreToolUse hook and none a
  UserPromptSubmit hook, and parallel subagents would share one `tasks.json`.

Technical

- **D4 · Recognising an orchestrated spec (asked).** A spec is orchestrated
  when `.frame/worktrees/<slug>` exists or git has a ref under
  `refs/heads/frame/<slug>/`. Those branches are also what Frame rehydrates
  orchestration from after a restart (`gitBranchesManager.js:457`). Git is
  asked only when a candidate exists; if git fails, the hook stays quiet.
  Accepted cost: a spec whose branches are never deleted is never announced.
  Rejected: a state record written by Frame — new main-process code, and
  stale whenever the app is closed.
- **D5 · Exit code of the close script (asked).** Always 0; the verdict is in
  the output. `--strict` exits 1 on any defect, as `check-freshness.js` does.
  Rejected: non-zero by default — autonomous mode's "the check fails and your
  fix does not make it pass → stop" could halt a run over a long sentence.
- **D6 · Test posture (asked).** Everything testable: the helper, the script,
  both hooks in both CLIs' payload shapes, the registry, the template and its
  token, the fixture builder.
- **D7 · Where the same-turn reminder lives (silent).** `docs-hint.js
  pre-edit`. It is the only script registered on both shell and edit calls in
  both CLIs (`frameTemplates.js:1012`, `:1085`), so no registration changes.
  It speaks only on the path that returns silently today (`docs-hint.js:343`);
  a call that delivers a meta-file section delivers only that, and the
  reminder waits for the next call.
- **D8 · Prompt-time reminder (silent).** `spec-hint.js promptMode`, computed
  before the early returns at `:268`–`:303`. The reminder goes first. If
  reminder plus topic lines would pass the host's inline limit, topic lines
  are dropped from the end and are not marked as seen, so they return later.
- **D9 · Baseline and cache (silent).** *The baseline is superseded by D16;
  the cache stays and also lists the open specs.* `.frame/runtime/spec-close/state.json`
  holds the baseline timestamp, written on first run, and the closed-spec list
  keyed by `tasks.json` mtime and size. `runtime/` is in Frame's managed
  `.gitignore` block. A spec's close time is its latest `completedAt`, falling
  back to `status.json`'s `last_phase_at`; with neither, it is skipped.
- **D10 · Session dedup (silent).** The helper owns it:
  `.frame/runtime/spec-close/sessions/<session>.json`, cleaned after 7 days
  like spec-hint's state. A payload without `session_id` is keyed by calendar
  day, so a host that sends none still gets at most one reminder a day.
- **D11 · What the activity log records (silent).** *Refined by D21: each
  quiet reason once per session.* A row only when a
  candidate exists — a closed spec with a missing item. The no-candidate path
  stays unrecorded, as `docs-hint.js` leaves non-meta calls today; a row per
  shell call would bury the log.
- **D12 · The digest shape lives in two places (silent).** The template keeps
  it, because an agent that never runs the script must still know what to
  write (the additive constraint). The script repeats it for a session that
  never saw the template. A test fails when the two differ.
- **D13 · How the template names the script (silent).** A `{close_script_path}`
  token, filled by both renderers, as `{report_generator_path}` is:
  `.frame/bin/spec-close.js` when it exists in the project, else
  `scripts/spec-close.js` when that exists, else the first.
- **D14 · In-flight collisions (silent).** `audit-q3-cross-platform` and
  `audit-q3-performance-resources` list `specManager.js`, `package.json` and
  `structureBootstrap.js` and have sat at `implementing` since 2026-08-26.
  The edits here are one token and three list entries; they proceed.
- **D15 · Left alone (silent).** `WORKER.md` and `CONDUCTOR.md` (the worker's
  digest step already exists), `getReferenceTemplate()` (user projects'
  reference does not describe the digest today), `derivePhase`, every hook
  registration.

### Revision — 2026-10-14, after the pilot

What the pilot (T10) showed, one session per kind:

- `natural` passed — the template's digest step ran and the agent ran the
  close script itself — but the digest landed in a commit of its own, after the
  last task's: the loop committed at its step 7 and the digest step sat in the
  closing summary.
- Both induced sessions received the reminder and left the digest missing.
  Each told the user it had seen the line and not acted, because the request
  was something else. In `induced-prompt` the session had not closed the spec
  at all: under D1 every session in the project hears about it, including
  unrelated ones, every day until the digest exists.
- Hooks fired as designed; the first table's zero reminders was a runner bug
  (fixed in T10).

Decisions (all asked):

- **D16 · Who hears the reminder.** Only the session that closed the spec. At
  a session's first hook run the helper notes which specs are still open; a
  spec that was open then and is closed now, with an item missing, is this
  session's own unfinished work and is announced to it — at the next tool call
  or the next prompt, once. A spec already closed when the session started is
  never announced in a conversation; `spec-close.js` still shows it. Accepted
  cost: if the closing session ignores the line, no later conversation repeats
  it; and two sessions working in one checkout at once may both count a close
  as theirs. Rejected: D1's every-session reminder — it reaches conversations
  the spec has nothing to do with.
- **D17 · The digest rides in the last task's commit.** The template runs the
  digest step before the last task is committed, in every mode, and the
  closing summary only reports it. Done in the T07 revision (`2284c1e`).
  Rejected: a digest commit of its own; and a pre-commit check of "the commit
  that closes a spec" — it ties Frame to how a project uses git, and a project
  in local sharing mode commits no `.frame/` file for it to see.
- **D18 · A fix after the last task carries its own record.** A bug found while
  testing, or a small correction to the plan, is part of the spec's work. Its
  commit carries an outcome entry; when it changes something the digest
  records, the same commit revises the digest — the rule updated in place and
  a `Revised <YYYY-MM-DD>: <what changed, why>` line before the `Chain:` line,
  so the original story stays. Whether a fix changes a decision is the fixing
  agent's call; unsure, it asks the user. Larger rework stays a new task, or a
  new spec with `supersedes:`. Rejected: regenerating the digest on every
  related commit — no check can tell which commits belong to a spec (files are
  shared) or whether a change alters a decision; and a new spec task for every
  small fix — too heavy for what it records.
- **D19 · Where the fix rule reaches the agent.** At two moments, both already
  hooked: (1) the implement template's shared core, for a fix asked in the
  session that implemented the spec; (2) `spec-hint.js pre-edit`, when the
  newest record for the file about to be edited is a finished spec — the
  history it already shows gains one sentence on how a fix records itself.
  `.frame/docs/REFERENCE.md` documents it. Rejected: the always-on core
  (AGENTS.md) — every project's every session would carry a rule that matters
  only at one moment.
- **D20 · Fix entries in outcome.md.** `## Fix — <title>`, the usual 2–4
  sentence body with the files touched, and the `_Captured:` line.
  `spec-index.js` reads them as records (task `Fix`), so a fixed file's
  history shows the fix.
- **D21 · Quiet reasons.** `closed-earlier` (the spec closed before this
  session started) replaces `before-baseline` and `no-close-time`, which never
  shipped; the baseline goes. Each quiet reason is recorded once per session,
  as T01 already does.
- **D22 · The test run, redefined.** Kinds and what passes:
  `natural` — the digest is `ok` and is in the last task's commit;
  `closing-turn` (was `induced-turn`) — the reminder reaches the session that
  closed the task and the digest ends `ok`;
  `earlier-close` (was `induced-prompt`) — no reminder, digest untouched;
  `fix-bug` — a finished spec, a reported bug: a `## Fix` entry, digest
  unchanged and still `ok`;
  `fix-decision` — a finished spec, a requested change that contradicts a
  rule in its digest: a `## Fix` entry and a digest with a `Revised` line,
  still `ok`. Sessions are started by the user: the permission layer refuses
  them to the agent, as it did for the pilot.

### Revision — 2026-10-14, after the second pilot

The second pilot (T14) passed `natural` (the digest inside T02's commit) and
`earlier-close` (silent), and failed three kinds on two causes:

- `closing-turn`: the session took the reminder as its own work and ran the
  close script, and auto mode's permission classifier blocked it — the same
  command it had allowed in `natural`.
- `fix-bug`, `fix-decision`: both fixed the code correctly through `sed -i` in
  the shell, so `spec-hint.js pre-edit` (Edit and Write only) never ran and
  the fix rule never reached them; the prompt-time hint naming the finished
  spec did run in both.

Decisions (asked):

- **D23 · The close script is in Frame's autonomous allowlist.**
  `Bash(node .frame/bin/spec-close.js *)` joins `IMPLEMENT_ALLOW` in both
  copies — `src/main/specManager.js` and the shipped
  `src/templates/bin/implement-launch.js` — and a test pins the two copies
  equal. A step the template requires must not depend on a classifier's mood.
  Only the shipped path: `scripts/spec-close.js` exists in Frame's own
  repository alone, and allowing it everywhere would allow a project's own
  script of that name.
- **D24 · The fix rule also rides the prompt-time hint.** When
  `spec-hint.js prompt` names a finished spec among its related specs, the
  payload gains the fix sentence for those specs. A fix request is a prompt
  before it is an edit, and this channel does not depend on which tool makes
  the edit. The edit-time sentence stays. The added sentence counts toward
  D8's budget like the topic lines it accompanies.

### Revision — 2026-10-14, after the third pilot

Four kinds passed. `closing-turn` could not: its agent ran the closing script
and `git status` as one shell call, so the only PreToolUse ran before the task
closed and the turn ended there. The product covers that case at the
session's next prompt, which a single-prompt headless session never sends.

- **D25 · `closing-turn` has two turns (asked).** The session is resumed with
  a neutral "Thanks." — not a question that would steer it toward the work —
  and passes when the digest is `ok` after the second turn. Only this kind
  keeps its session on disk, since `--resume` needs it.
- **D26 · N for the main run (asked).** `natural` 10 — it passed all three
  pilots and costs four times the others; every other kind 30.

Not this spec: Claude Code's prompt and tool-call rows are labelled
`codex-hook` because `toolVocabulary.cliOf` reads a field Claude Code now
sends as a Codex signal, which also hands both hooks Codex's inline cap in
Claude Code sessions (`spec.md` lists `cliOf` as a separate task).

### Components

```
tasks.json + specs/<slug>/digest.md        (disk — the only input)
        │
        ▼
scripts/spec-close-state.js                helper, no dependencies
  closedSpecs(root)      → [{ slug, closedAt }]      all spec tasks completed
  CLOSE_ITEMS            → [{ id: 'digest', missing(root, slug) }]
  pending(root, now)     → closed · something missing · not orchestrated
  reminder(root, session, now) → { line, slugs } | { quiet: reason } | null
                           announces only specs open at the session's first look (D16)
        │                         │
        ▼                         ▼
scripts/spec-close.js      scripts/docs-hint.js pre-edit   (next shell/edit call)
  one spec, by slug        scripts/spec-hint.js prompt     (next user prompt)
```

- **Close items are a list.** Each has an `id` and a `missing()` test. Today
  there is one. A card item is added to the list; nothing around it changes.
- **Reminder line.** One line, at most three slugs and a count for the rest:
  `Spec "<slug>" has every task completed but no digest — run: node
  <path>/spec-close.js <slug>`. The path is resolved from the hook's own
  directory, as `spec-hint.js:77` resolves the context CLI.
- **Close script.** `spec-close.js <slug> [--json] [--strict]` prints the task
  count, then one line per close item: `ok`, `missing` with the shape to
  write, or the named defect. Digest defects: no front-matter block, no
  `keywords:` line, first sentence over `DIGEST_LINE_CAP` (280), no `Chain:`
  line. It prints paths, never file bodies. It writes nothing but its
  activity row.
- **Quiet reasons** added to the registry: `orchestrated`, `before-baseline`,
  `no-close-time`. `session-dedup` already exists. New mode `spec-close` on
  `hint.injected` and `hint.quiet`. New event `spec.close_checked` with host
  `cli`, the slug, a verdict enum (`ok`, `missing`, `malformed`) and a defect
  count.
- **Template.** The shared core gains "The digest, when the spec's last task
  closes": write `digest.md` in the shape under a new `### The digest`, run
  `{close_script_path} {slug}`, fix what it names, then the phase goes to
  `done`. The phase rule, the closing summary, the stop condition and the
  describe-your-own list each name the step. The section at the end goes.

### The test run

- **Fixture.** A script builds a throwaway git repository under the system
  temp directory: `.frame/` with one spec (spec, plan, tasks, status with
  `implement_mode: autonomous`), `tasks.json` with its two tasks, `.frame/bin/`
  from `structureBootstrap.copyParserScripts`, staged command files from
  `commandStaging`, and `.claude/settings.json` holding `SPEC_HINT_HOOKS`.
  No remote, no MCP, its own `FRAME_ACTIVITY_HOME`.
- **Three kinds.** *Natural*: both tasks pending; the prompt is
  `/spec.implement <slug>`. *Induced, prompt path*: tasks completed, outcome
  written, no digest, baseline backdated; the prompt is an unrelated one-line
  request. *Induced, same-turn path*: one task pending; the prompt asks the
  agent to run a supplied script that closes it, then one more command.
- **What is read off each run.** `spec-close.js --json` on the fixture, the
  reminder and close rows in the fixture's activity file, and cost and tool
  calls from the session's stream output. Each session carries
  `--max-budget-usd`.
- **What it can show.** 10 passes of 10 bound the miss rate under roughly one
  in four; 30 of 30 under one in ten. The natural kind is a smoke test — it
  cannot separate today's 95% from 100% at this size.

## Files

- `scripts/spec-close-state.js` — **New.** Close state, close items, baseline,
  cache, orchestration check, session dedup, the reminder line.
- `scripts/spec-close.js` — **New.** The close script.
- `scripts/spec-index.js` — **Modified.** Export `firstSentence`,
  `firstParagraph` and `DIGEST_LINE_CAP` for the digest check; read
  `## Fix —` outcome entries as records (D20).
- `scripts/docs-hint.js` — **Modified.** Same-turn reminder on the non-meta
  path.
- `scripts/spec-hint.js` — **Modified.** Prompt-time reminder, with the budget
  rule of D8; the fix sentence in the pre-edit history of a finished spec's
  file (D19) and beside a finished spec in the prompt-time hint (D24).
- `scripts/spec-command-hint.js` — **Modified.** Fill `{close_script_path}`.
- `src/main/specManager.js` — **Modified.** Fill `{close_script_path}`; the
  close script in `IMPLEMENT_ALLOW` (D23).
- `src/templates/bin/implement-launch.js` — **Modified.** The close script in
  its copy of `IMPLEMENT_ALLOW` (D23).
- `test/implementLaunch.test.js` — **Modified.** The two allowlists stay equal.
- `src/templates/commands/claude-code/spec.implement.md` — **Modified.** The
  digest step in the shared core and at each `done` statement; end section
  removed.
- `src/main/structureBootstrap.js` — **Modified.** Ship the helper and the
  script to `.frame/bin/`.
- `package.json` — **Modified.** Both scripts in `build.files`.
- `src/shared/activityEvents.js` — **Modified.** Mode, reasons and the
  `spec.close_checked` event.
- `PRIVACY.md` — **Modified.** The registry change.
- `scripts/eval/spec-close/make-fixture.js` — **New.** Builds one fixture of a
  given kind.
- `scripts/eval/spec-close/run.js` — **New.** Launches sessions over fixtures,
  several at a time, and tabulates the results.
- `test/spec-close-state.test.js` — **New.** The helper.
- `test/spec-close.test.js` — **New.** The script, and the template/script
  shape mirror.
- `test/spec-close-fixture.test.js` — **New.** Each fixture kind, driven by
  piped hook payloads with no agent.
- `test/docs-hint.test.js` — **Modified.** Reminder cases, both CLIs.
- `test/spec-hint.test.js` — **Modified.** Reminder cases and the budget rule.
- `test/spec-command-hint.test.js` — **Modified.** The token.
- `test/codexTemplates.test.js` — **Modified.** The token and the digest step
  in the rendered template, per CLI.
- `test/activityEvents.test.js` — **Modified.** The new mode, reasons, event.
- `test/spec-index.test.js` — **Modified.** `## Fix —` entries become records.
- `test/metaPathGuard.test.js` — **Modified.** The two scripts join
  `.frame/specs`; they enter the mirror list.
- `.frame/docs/REFERENCE.md` — **Modified.** The digest paragraph names the
  close script and the reminder.

## Footprint

- scripts/spec-close-state.js
- scripts/spec-close.js
- scripts/spec-index.js
- scripts/docs-hint.js
- scripts/spec-hint.js
- scripts/spec-command-hint.js
- scripts/eval/spec-close/**
- src/main/specManager.js
- src/main/structureBootstrap.js
- src/shared/activityEvents.js
- src/templates/commands/claude-code/spec.implement.md
- package.json
- PRIVACY.md
- test/spec-close-state.test.js
- test/spec-close.test.js
- test/spec-close-fixture.test.js
- test/docs-hint.test.js
- test/spec-hint.test.js
- test/spec-command-hint.test.js
- test/codexTemplates.test.js
- test/activityEvents.test.js
- test/metaPathGuard.test.js
- test/spec-index.test.js
- .frame/docs/REFERENCE.md
- src/templates/bin/implement-launch.js
- test/implementLaunch.test.js

## Dependencies

None.

## Sequencing

1. **Close state helper.** Add `scripts/spec-close-state.js` with
   `closedSpecs`, `CLOSE_ITEMS`, the baseline, the mtime cache, the
   orchestration check, session dedup and `reminder`. Cover it in
   `test/spec-close-state.test.js`: closed and not closed, digest present,
   before the baseline, orchestrated by folder and by ref, no close time,
   unreadable `tasks.json`, a cache hit that does not re-read `tasks.json`,
   dedup with and without a session id.
2. **Registry.** Add the `spec-close` mode, the three reasons and
   `spec.close_checked` to `src/shared/activityEvents.js`; update `PRIVACY.md`
   in the same commit; extend `test/activityEvents.test.js`.
3. **Close script.** Export the sentence helpers from `scripts/spec-index.js`;
   add `scripts/spec-close.js` with the verdict lines, `--json`, `--strict`
   and its activity row. Cover it in `test/spec-close.test.js` — each defect by
   name, the well-formed line, a missing digest printing the shape. Add both
   new scripts to the mirror list in `test/metaPathGuard.test.js`.
4. **Same-turn reminder.** In `scripts/docs-hint.js`, call the helper on the
   non-meta path behind a guarded require. Extend `test/docs-hint.test.js`:
   Claude Code `Bash` and `Edit`, Codex shell and `apply_patch`, a meta write
   that keeps today's payload and carries no reminder, a `.frame/bin/` without
   the helper, each quiet reason recorded.
5. **Prompt-time reminder.** In `scripts/spec-hint.js`, compute the reminder
   before the early returns and compose it with the topic lines under the
   budget rule. Extend `test/spec-hint.test.js`: reminder alone, with topics,
   over the limit, already announced by step 4 in the same session.
6. **Shipping.** List the helper under `HELPER_FILES` and the script under
   `ENTRY_FILES` with its `ENTRY_REQUIRES` entry in
   `src/main/structureBootstrap.js`; add both to `build.files` in
   `package.json`.
7. **Template and token.** Rewrite the digest step into the shared core of
   `spec.implement.md`, name it at the phase rule, the closing summary, the
   stop condition and the describe-your-own list, and remove the end section.
   Fill `{close_script_path}` in `src/main/specManager.js` and
   `scripts/spec-command-hint.js`. Extend `test/codexTemplates.test.js` and
   `test/spec-command-hint.test.js`; add the shape mirror to
   `test/spec-close.test.js`.
8. **Frame's own reference.** Extend the digest paragraph in
   `.frame/docs/REFERENCE.md` with the close script and the reminder.
9. **Fixture builder and runner.** Add `scripts/eval/spec-close/make-fixture.js`
   and `run.js`. Cover the three fixture kinds in
   `test/spec-close-fixture.test.js` by piping hook payloads through the
   fixture's own `.frame/bin/` — the reminder appears where it should and is
   absent once a digest is written.
10. **Pilot.** One session of each kind. Record cost, tool calls and results
    in the outcome, together with the measured hook time with and without the
    cache. **Stop and report to the user**; the main run does not start
    without their N.
11. **The reminder goes to the session that closed the spec (D16, D21).** In
    the helper, note the open specs at a session's first hook run, announce
    only a spec open then and closed now, record `closed-earlier` otherwise,
    drop the baseline; update the registry and `PRIVACY.md` in the same
    commit; update the helper, hook, registry and fixture tests.
12. **Fixes after close (D18–D20).** The fix paragraph in the template's
    shared core; the fix sentence in `spec-hint.js` pre-edit for a finished
    spec's file; `## Fix —` entries read by `spec-index.js`; the reminder and
    the fix rule in `.frame/docs/REFERENCE.md`. Tests for each.
13. **The test run, redefined (D22).** The five kinds in `make-fixture.js`,
    their pass rules in `run.js`, each kind driven with no agent in
    `test/spec-close-fixture.test.js`.
14. **Second pilot.** One session per kind, started by the user. Record the
    results; **stop and report**.
15. **The close script in the allowlist (D23).** Both copies of
    `IMPLEMENT_ALLOW`, and a test that keeps them equal.
16. **The fix rule at the prompt (D24).** The sentence beside a finished spec
    in `spec-hint.js prompt`, within D8's budget; tests.
17. **Third pilot.** One session per kind, started by the user. Record the
    results; **stop and report**; the user picks N.
18. **A second turn for `closing-turn` (D25).** In `run.js`, resume the
    session with "Thanks." and read both turns; tests for the launch lines and
    for the next-prompt path with no agent.
19. **Main run (D26).** `natural` 10, every other kind 30, started by the
    user. Record the table in the outcome, and state there that Codex was
    verified by fixtures only.
