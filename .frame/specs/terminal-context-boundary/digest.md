---
keywords: terminal context, launch injection, PATH, tool wrapper, context boundary, per-tool parity, launch flags
related: non-invasive-overlay, spec-knowledge-layer, cli-spec-command-parity, implement-modes-v2
---
Frame's context now follows Frame's terminal: `.frame/bin` goes first on the
`PATH` of every PTY Frame spawns (`launchEnv.prependFrameBin`), and each tool
has a wrapper there that resolves the real CLI with its own directory stripped
from `PATH` and hands it Frame's preamble plus, for Claude, `--settings`.

Why this path: **one injection route, not two.** `non-invasive-overlay`'s split
(flags for Claude, wrapper for Codex/Gemini) cannot survive `PATH` injection —
a dispatch typing `claude --append-system-prompt …` would resolve to the
wrapper and inject twice. Unifying removed the second route instead of guarding
it; `injection` survives as *data the wrapper reads*. Rejected: a shell-rc line
and a `~/.claude/CLAUDE.md` block (both write outside `.frame/`); baking an
absolute CLI path into the wrapper (goes stale on a version-manager switch).

Rules established:
- Generation happens on **project open**, write-if-changed — never launch-only,
  which is how a 29-April wrapper survived in this repo.
- Runtime files are **per tool** (`preamble-<id>.txt`, `<id>-settings.json`);
  the preamble's text differs by tool and a hand-typed launch rewrites nothing.
- A dispatch types the **relative** wrapper path, so Frame's flags and the
  wrapper's can never both apply. `getLaunchCommand` and the availability probe
  compose it from the same helper.
- A caller's `--settings` is **merged** into Frame's settings file, never passed
  a second time (the autonomous run's hooks used to be lost this way).
- The escape hatch is **`FRAME_NO_WRAP=1 <tool>`**. Plan.md's `command claude`
  does not work — `command` bypasses functions and aliases, not `PATH`.
- Known limit: rc files run after the spawn env, so an rc that prepends the
  directory holding the CLI shadows the wrapper. Winning that ordering needs an
  opt-in shell integration — its own spec. Windows: no wrappers, no injection.

Chain: spec.md → plan.md → tasks.md → outcome.md
