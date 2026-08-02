---
keywords: terminal session setup, shell init, context delivery, lane readiness, shell functions, verification, fallback
related: terminal-context-boundary, non-invasive-overlay, agent-dispatch, lane-orchestrator
---

# Terminal Session Setup — the lane Frame opens is a lane Frame set up

## Problem

`terminal-context-boundary` put `.frame/bin` first on the `PATH` of every PTY
Frame spawns, so a hand-typed `claude` would resolve to Frame's wrapper. It
works, but only until the user's shell disagrees: rc files run **after** Frame
sets that environment, and nvm, Homebrew, pyenv and friends all prepend their
own directory. Measured on a developer machine: `.frame/bin` ends up sixth,
behind `~/.nvm/versions/node/v20.5.1/bin` — and the standard install path for
Codex and Gemini (`npm i -g`) puts those binaries in exactly that directory.
Claude survives only because it happens to live in `~/.local/bin`.

So the guarantee is conditional on where the user installed their CLI, and it
fails **silently**: the CLI starts, the agent simply doesn't know the project.
That is the same failure `terminal-context-boundary` set out to fix — a user
unable to tell a boundary from a bug — reintroduced one layer down.

Starting agents from Frame's own buttons is unaffected (those type
`./.frame/bin/<tool>`, a relative path, no `PATH` lookup). But typing the CLI
in a terminal is normal developer behaviour and Frame should not require a
button for it.

## Goal

A session Frame opens is a session Frame has set up: when the shell is ready,
Frame loads a generated init file from `.frame/runtime/shell/` that defines a
shell function per tool and prepends `.frame/bin` to `PATH`. A shell function
is resolved before any `PATH` search, so the ordering question disappears
entirely.

Setup is invisible, verified, and — when verification fails — replaced by a
one-click guaranteed path, so the session's context state is never unknown.

## Constraints

- **Frame configures the session it creates; it never changes the user's
  persistent configuration.** This is `non-invasive-overlay`'s "Frame writes
  only inside `.frame/`" applied to the terminal. It rules out a line in
  `~/.zshrc` and any registry write, and it rules out `ZDOTDIR`-style
  wrapping of the user's startup files: not because those write anything, but
  because they reroute a mechanism that belongs to the user.
- **The wrapper stays the injection point.** This spec fixes *which binary
  runs*; `terminal-context-boundary`'s wrapper is still what hands the CLI the
  preamble. The preamble's content does not change.
- **`.frame/bin` on `PATH` stays** as the base layer — it is what reaches
  subshells, where functions do not.
- **`FRAME_NO_WRAP=1` remains the single escape hatch.** `command <tool>`
  bypasses functions but not `PATH`, so it is not one.
- **`agent-dispatch` owns launch composition.** The failure-path button calls
  the existing `_startAgentIn`; this spec adds no second way to start an agent.
- **Fail open.** A setup that errors, times out, or is refused must leave the
  user with a working terminal. Losing context is acceptable; losing the
  terminal is not.
- **Windows is blocked, not deferred by choice.** `.frame/bin/<tool>.cmd`
  shims do not exist yet, so Windows shells have nothing to point at.

## Success Criteria

1. When a user types `claude`, `codex` or `gemini` in a zsh or bash lane, the
   tool resolves through Frame's wrapper no matter how the user's rc files
   reorder `PATH`.
2. When the shell offers a post-startup flag (fish `-C`, pwsh `-NoExit
   -Command`, cmd `/K`), setup arrives through that flag and nothing is typed
   into the terminal.
3. When setup is delivered by typing (zsh, bash), none of it is rendered: the
   user sees a clean first prompt.
4. When setup does not confirm within the timeout, the buffered output is
   flushed so the terminal is never left blank, and one retry is attempted.
5. When the retry also fails, the lane states that context could not be
   installed and offers a one-click start that goes through `_startAgentIn`,
   plus the one-line manual command.
6. When a lane's context state changes, its lane card reflects it — installed
   or not installed.
7. When a subshell is started inside a lane, the wrapper is still reachable
   through the inherited `PATH`.
8. When `FRAME_NO_WRAP=1` is set, the real CLI runs with no Frame context, by
   both the function path and the `PATH` path.
9. When the folder is not a Frame project, nothing is sent and no function or
   variable is defined.
10. When the feature is switched off in settings, behaviour is exactly what
    `terminal-context-boundary` shipped.
11. When the user's home directory is walked and diffed before and after Frame
    has run, it is byte-identical.
12. When an agent is started by any existing flow (dispatch, lane Start, new
    Frame, `startAiSession`), it still works, and no longer depends on a fixed
    delay to decide the shell is ready.

## Out of Scope

- **Windows wrappers (`.cmd` shims).** Tracked separately; without them
  Windows Codex and Gemini receive no context at all, from any path.
- **tmux, ssh and other sessions Frame did not spawn.** The manual one-liner
  and the lane's Start button cover them.
- **Terminal UX features** — command decorations, cwd detection, sticky
  scroll. That is what VS Code's shell integration buys with its
  startup-file wrapping; this spec buys none of it and pays none of its cost.
- **Changing the preamble's content.**
- **Sessions started outside Frame.**

## Open Questions

- **Does the readiness primitive land here or separately?** The setup marker
  is proof the shell is processing input, which would replace the fixed
  50/800/1000 ms delays in the four existing start flows (criterion 12).
  Doing it here keeps the two changes in one place; doing it separately keeps
  this spec from touching `agentDispatch` and `index.js`.
- **Is the lane indicator always visible, or only on failure?** Always-on
  states the boundary continuously (the point of the previous spec); on-failure
  keeps the lane cards quiet.
- **Is the off switch global or per project?** Global matches the App Settings
  row the previous spec added; per project matches `gitSharing`'s precedent
  that terminal behaviour can differ per repository.
