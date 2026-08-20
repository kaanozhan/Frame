---
keywords: windows, claude code, launch context injection, cmd wrapper, powershell init, PATHEXT, preamble delivery
related: terminal-context-boundary, terminal-session-setup, non-invasive-overlay
---
Gave Windows the Claude Code context every POSIX lane already had. The payload
was never the problem — `prepareLaunchAssets` already wrote a correct preamble
and settings file there; only the **carrier** was missing.

Why this path won: `--append-system-prompt-file` takes a path where
`--append-system-prompt` takes 993 bytes of prose over 9 lines with 6
backticks. Passing paths makes the typed line single-line and quote-free, so
every Windows shell runs it. Rejected: typing the string form (cmd submits at
the first newline, PowerShell eats backticks); a Node trampoline (needed only
if the wrapper had to embed prose); routing the composed line through the
wrapper (no path spelling every Windows shell accepts).

Rules established. `launchEnv` answers every platform question — nobody reads
`process.platform`. A tool earns a Windows wrapper by declaring
`promptFileFlag`, not by being on a list. The file flag is used only where
`!supportsWrappers(platform)`: it has no `--help` row, so POSIX must not
depend on it. One injection route — the `.cmd` defers when the flag is already
on the line. Exit codes propagate goto-shaped, never via `%ERRORLEVEL%`.
`unsupported` stays silent (cmd, Git Bash, WSL); only `failed` gets a row.

**Unverified: no Windows machine has run any of it, and the `windows-latest`
CI leg has never executed.** `test-protocol.md` is the handoff.

Chain: spec.md → plan.md → tasks.md → outcome.md
