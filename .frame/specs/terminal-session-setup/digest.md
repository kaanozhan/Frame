---
keywords: terminal session setup, shell init, context delivery, lane readiness, shell functions, verification, fallback
related: terminal-context-boundary, non-invasive-overlay, agent-dispatch, lane-orchestrator
---

Every lane Frame opens in a Frame project now sources a generated init file
(`.frame/runtime/shell/init.sh` / `init.fish`, written by `aiToolManager` as a
launch asset) that moves `.frame/bin` to the front of an exported `PATH` *after*
the user's rc files have run and defines one function per tool, each routing to
`"$FRAME_BIN/<id>"`. A function beats any `PATH` search, so nvm/Homebrew
reordering — which had pushed `.frame/bin` to sixth place and silently cost
`codex` and `gemini` their context — stops mattering.

Rejected: a line in `~/.zshrc`, and VS Code's `ZDOTDIR` wrapping — both reroute
configuration that belongs to the user. Rejected: an off switch — this is
product behaviour, which drops the spec's success criterion 10; `FRAME_NO_WRAP=1`
remains the per-run escape hatch, honoured by the wrapper the functions delegate
to.

Delivery is per family: fish takes `-C` at spawn, zsh/bash/sh take a typed line
whose marker is printed from two adjacent quoted fragments so the tty's echo of
the line can never be mistaken for the shell having run it. `ptyManager` buffers
output and queues input while setup is pending, matches the marker against the
**accumulated** buffer (a PTY splits it across reads), flushes verbatim and
retypes once on a 4s timeout, and ends in `failed` on the second — fish gets no
retry, having taken its setup as a spawn flag. State reaches the renderer on
`TERMINAL_CONTEXT_STATE`, whose payload also carries the per-family manual
one-liner (an addition to the plan, since only the main process knows the shell).

Rules established: nothing is written outside `.frame/`; the wrapper stays the
only injection point and the only place `FRAME_NO_WRAP` is honoured; a failed
setup leaves a working terminal; only `failed` lanes show anything on their
card; and every "wait for the shell" delay is now
`laneContext.whenReady(id, <the site's old number>)` — proof first, the old
guess as fallback.

Chain: spec.md → plan.md → tasks.md → outcome.md
