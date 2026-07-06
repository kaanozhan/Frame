# Orientation Eval — does Frame's context actually help the agent?

An internal measurement instrument (not a product surface). It turns the
core claim — *"Frame keeps an agent oriented, so it edits the right file,
searches less, and succeeds first-try"* — from an assertion into a number.

## Method

Fixed local task suite, A/B by context only:

- **Suite** — `tasks.json`: 10 tasks against this repo pinned to a recorded
  commit. Prompts name *concepts* ("the Claude usage polling", "the GitHub
  issues panel"), not files — finding the right file is the thing being
  measured. Each task declares `expectedFiles` and a deterministic shell
  `successCheck`. Three `scripts/*` tasks name their target file in the
  prompt, deliberately: they isolate execution quality from orientation.
- **Arms** — `frame`: the worktree as-is (AGENTS.md, STRUCTURE.json,
  PROJECT_NOTES.md, tasks.json, find-module.js all present). `bare`: those
  files removed, stripping committed inside the worktree so agent diffs
  stay clean. Same task, same commit, same model — only the context differs.
- **Runner** — `run-eval.js`: ephemeral `git worktree` per task×arm,
  headless agent (`claude -p … --output-format stream-json`, binary/flags
  configurable via `FRAME_EVAL_AGENT` / `FRAME_EVAL_AGENT_ARGS`), per-run
  timeout, captures `transcript.jsonl`, `diff.patch` (before the
  successCheck runs), and the check verdict; worktrees always removed.
- **Scorer** — `score.js`: deterministic, no LLM judging.
  - **first-try success** — successCheck passed, no timeout
  - **wrong-file edits** — changed files ∉ expectedFiles (meta files like
    STRUCTURE.json excluded: regenerating them alongside a change is
    legitimate)
  - **search effort** — Grep/Glob/grep-ish-Bash tool calls before the first
    Edit/Write
  - turns, tool calls, duration, output tokens

## How to run

```bash
node scripts/eval/run-eval.js                          # full suite, both arms
node scripts/eval/run-eval.js --task <id> --arm bare   # one cell
node scripts/eval/score.js scripts/eval/results/<run>  # summary table (--json for machine use)
```

`results/` is gitignored — transcripts are bulky. Only this README's
summary is versioned.

## How to interpret

The frame−bare delta *is* the measured orientation benefit. Look at
wrong-file edits and search-before-first-edit first — they are the direct
"stays oriented" signals; first-try success is the outcome signal but also
absorbs model-capability noise. Single runs are noisy: model responses are
not deterministic, so treat small deltas (±1 task) as noise and re-run
before concluding. The suite must be re-pinned (new `pinnedCommit`, checks
re-verified) whenever the referenced code moves materially.

## Baseline — 2026-07-06

- **Pinned commit:** `ccbd47d7abee12d0922433d490b7196bfc1cbb16`
- **Model:** claude haiku (`--model haiku`), 300s timeout — chosen for a
  cheap, repeatable first number; re-run with the default model for a
  stronger-signal baseline.

| metric                        | bare       | frame      |
| ----------------------------- | ---------- | ---------- |
| first-try success             | 7/10 (70%) | 9/10 (90%) |
| tasks w/ wrong-file edits     | 2          | 1          |
| total wrong-file edits        | 2          | 1          |
| avg searches before 1st edit  | 3.9        | 1.0        |
| avg tool calls                | 11.5       | 7.7        |
| avg turns                     | 27.0       | 20.7       |
| avg duration (s)              | 40         | 41         |
| total output tokens           | 24,307     | 30,504     |

**Reading it:** the oriented agent searched ~4× less before its first edit
(1.0 vs 3.9), used fewer tool calls and turns, and succeeded first-try on 2
more tasks (90% vs 70%). The bare arm's failures are orientation-shaped:
`menu-freshness-item [bare]` invented a root-level `main.js` that doesn't
exist in this codebase, and `github-empty-state [bare]` gave up without
editing anything. `cmd-github-toggle` failed in **both** arms (the model
wired the command in `src/renderer/index.js` instead of
`commandRegistry.js`) — a model-capability limit, not a context effect,
which is exactly the kind of noise the A/B design cancels out. Frame's
higher output-token total is the cost side of the trade: it reads context
up front and spends fewer actions after.

**Known caveats:** single run per cell (haiku, non-deterministic — treat
±1 task as noise); grep-based success checks measure "did the named change
land", not code quality; agents that commit inside the worktree are handled
(diff is taken against the starting sha), discovered via this run.
