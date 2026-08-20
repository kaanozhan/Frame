# Orientation eval — re-pin the suite and point the bare arm at `.frame/`

## Problem

`scripts/eval/` is Frame's only instrument for turning the core claim
("Frame keeps an agent oriented, so it edits the right file, searches
less, and succeeds first-try") into a number. It does not run at all
today, and two separate kinds of rot are responsible.

**The pinned commit no longer exists.** `tasks.json` pins the suite to
`ccbd47d7abee12d0922433d490b7196bfc1cbb16`, and that object is not in
the repository:

```
$ git cat-file -t ccbd47d7abee12d0922433d490b7196bfc1cbb16
fatal: git cat-file: could not get object info
```

`run-eval.js:113` opens every worktree with `git worktree add --detach
${SUITE.pinnedCommit}`, so the harness dies on its first step in every
arm of every task. This is not an isolated loss: the four commits
`audit-q3-core-value-efficacy`'s `outcome.md` records for T10/T11/T12
(`e466f22`, `04edee0`, `d1ee3c9`, `31607aa`) are all gone too. The
project squash-merges PRs, so any sha recorded from a feature branch
stops existing when that branch lands. A bare sha is therefore not a
durable pin, and re-pinning to another bare sha only resets the clock.

**The overlay migration moved everything the bare arm deletes.** The
`bare` arm is defined by a hand-maintained list of root paths
(`run-eval.js:35-44`): `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`,
`STRUCTURE.json`, `PROJECT_NOTES.md`, `tasks.json`,
`scripts/find-module.js`, `.frame/docs/REFERENCE.md`. Since the
`non-invasive-overlay` and `embedded-migration` specs, everything Frame
plants in a working tree lives under `.frame/`, and `CLAUDE.md` is not
produced at all any more — migration removes the symlink.

Right now this is latent rather than active: the pinned commit predates
the migration, so on *that* tree the root paths were correct. It becomes
active the moment the suite is re-pinned, which is exactly what fixing
the first problem requires. The two cannot be sequenced apart, and the
failure mode if they are is silent: a bare arm that deletes nothing
makes both arms identical, and the eval reports a delta of zero as
though it had measured one.

Two smaller instances of the same drift:

- `score.js:23` — `META_FILES` excludes `STRUCTURE.json`, `tasks.json`,
  `PROJECT_NOTES.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` from the
  "wrong-file edits" metric, on the correct reasoning that regenerating
  a meta file alongside a change is legitimate. Under the overlay these
  are `.frame/` paths, so a run that regenerates `.frame/STRUCTURE.json`
  now scores as having edited a wrong file.
- `tasks.json:63` — the `structure-skip-tests` task's `successCheck`
  reads `STRUCTURE.json` from the root after running the parser. On a
  post-migration tree the parser writes `.frame/STRUCTURE.json` and the
  check reads a file that is not there, failing a task the agent
  actually completed.

What survives intact: all ten tasks' `expectedFiles` still exist in the
tree today, so the suite's targets are re-usable and this is a repair,
not a rewrite.

## Goal

The eval runs again, and the thing that rotted cannot rot the same way
twice.

1. **A durable pin.** Re-pin to a commit that is reachable from `main`
   and will stay reachable — an annotated tag created for this purpose,
   rather than a bare sha from a branch that squash-merges away. Record
   in the README why the pin is a tag.

2. **The bare arm is defined by the overlay, not by a list.** Frame
   plants exactly one directory, so the arm becomes `rm -rf .frame/`
   plus whatever this repository additionally exposes because it *is*
   Frame (`scripts/find-module.js` is Frame's source for the copy that
   ships to `.frame/bin/`). A definition that cannot drift as files are
   added is the point; a shorter list is the side effect.

3. **The two derived drifts follow the same layout.** `score.js`'s
   `META_FILES` and the `structure-skip-tests` `successCheck` name the
   paths the parser actually writes.

4. **A credible baseline is finally recorded.** The README has held
   "Baseline — pending" since the 2026-07-06 pilot, with the reason
   stated: single run per cell, haiku, 2 paired wins on n=10, sign test
   p≈0.25. The two followups it names have never been built — `--reps N`
   in the runner and per-task paired wins/losses with a sign test in the
   scorer. Build both, run 3-5 repeats per cell on the default model,
   and write the numbers into the README.

## Constraints

- The instrument's design is not up for revision here. Concept-named
  prompts, the three deliberately file-named `scripts/*` controls,
  deterministic `successCheck`s, and no LLM judging are what make the
  measurement mean anything — this spec repairs the harness around
  them.
- Re-verify every task against the new pin before trusting a number. A
  `successCheck` that passes for the wrong reason is worse than one
  that fails, because it is invisible.
- `results/` stays gitignored. Only the README's summary is versioned.
- The bare arm keeps committing its stripping inside the worktree with
  `--no-verify` (`run-eval.js:123`), so captured diffs stay exactly the
  agent's work and this repo's pre-commit hook never runs against a
  half-stripped tree.
- Do not record a baseline that the method does not support. If the
  repeats do not produce a defensible number, the README says so and
  stays pending — the 2026-07-06 decision not to publish a weak pilot
  was correct and stands.

## Success Criteria

- `node scripts/eval/run-eval.js --task <id> --arm bare` completes end
  to end: the worktree opens at the pin, `.frame/` is gone inside it,
  the agent runs, and transcript, diff, and verdict are captured.
- In a `frame` arm worktree, `.frame/` is present and untouched.
- Every one of the ten tasks passes its `successCheck` when the change
  it describes is made by hand at the new pin — checked once, per task,
  before any agent runs.
- A run that regenerates `.frame/STRUCTURE.json` alongside its real edit
  scores zero wrong-file edits.
- `--reps N` runs N repeats per cell, and `score.js` reports per-task
  paired wins/losses with a sign test.
- The README carries either real baseline numbers with their method, or
  an explicit statement of why the repeats did not support one.

## Out of Scope

- Changing what the suite measures, adding tasks, or replacing the
  metrics.
- Making the eval a product surface — it stays an internal instrument,
  invisible to users, with no UI and no Frame integration.
- Evaluating AI tools against each other. `FRAME_EVAL_AGENT` already
  makes the binary pluggable; using it that way is a different question
  from "does Frame's context help".
- Any automatic re-pinning, CI scheduling, or regression gating on the
  eval.

## Open Questions

- **What exactly does `bare` remove in *this* repository?** `rm -rf
  .frame/` is the clean definition for a normal project, but Frame's own
  repo also carries `scripts/find-module.js`, `scripts/spec-context.js`
  and friends as the source for what ships to `.frame/bin/`. Deleting
  them makes the arm honest; leaving them means the bare arm still has
  Frame's lookup tools. Note that three tasks deliberately target
  `scripts/*` files, so the removal must be surgical rather than
  directory-wide.
- **Which commit gets the tag?** The current `main` at repair time is
  the obvious choice, but the ten `expectedFiles` should be reviewed
  first — a target that has been heavily rewritten since the suite was
  written may no longer make the task it encodes meaningful.
- **Does the pin need the eval's own files excluded?** The worktree is
  opened at the pin, which means it carries that commit's
  `scripts/eval/` too, while the runner executes from the working
  checkout. Whether that split matters in practice was never written
  down.
- **Is `PROJECT_NOTES.md` still a fair thing to strip?** It is now
  `.frame/PROJECT_NOTES.md` and 82KB. Its size relative to the other
  artifacts may dominate the arm difference for reasons that have
  nothing to do with orientation.
- **Default model for the baseline** — the README says "not haiku", but
  a baseline is only comparable to future runs on the same model, so
  the choice should be recorded as part of the number.
