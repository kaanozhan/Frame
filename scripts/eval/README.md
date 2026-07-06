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

## Baseline — pending

No baseline numbers are recorded yet, deliberately. A pilot run
(2026-07-06, 10 tasks × 2 arms, **single run per cell, haiku**, pinned
`ccbd47d`) validated the instrument end-to-end — worktrees, stripping,
capture, scoring all work, and the deltas appeared exactly where the
design predicts (in concept-named tasks, not in the file-named `scripts/*`
controls) — but a single non-deterministic run per cell is too weak to
publish as *the* number: the success-rate delta was 2 paired wins on
n=10 (sign test p≈0.25), and one bare-arm cell looked like an agent
anomaly (0 tool calls, 8s) rather than a context effect.

**What a credible baseline needs** (then record it here):
- 3–5 repeats per cell, default model (not haiku)
- report per-task paired wins/losses with a sign test, not just arm means
- re-check the anomalous cells before counting them

The pilot's methodological catches are already folded into the harness:
diffs are taken against the starting sha (agents that self-commit in the
worktree no longer hide their changes), and grep-based success checks
measure "did the named change land", not code quality.
