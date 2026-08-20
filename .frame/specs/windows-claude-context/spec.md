# Windows context parity for Claude Code

## Problem

Since `non-invasive-overlay`, Frame plants no file in the working tree, so an
agent learns about Frame at **launch** rather than by reading something at the
repository root. `terminal-context-boundary` then made the wrapper in
`.frame/bin` the single route for that, and `terminal-session-setup` made the
route survive a shell that reorders `PATH`.

Every one of those mechanisms is gated off on Windows.
`launchEnv.supportsWrappers()` returns false for `win32` and
`shellSetup.deliveryFor()` answers `{ mode: 'none', reason: 'platform' }`
before it ever looks at which shell the lane is running.

What that costs, for Claude Code specifically:

- **A launch Frame composes** falls to the inline branch
  (`aiToolManager.js:860-864`), which appends `--append-system-prompt <preamble>`
  and `--settings <path>` to a line that is then **typed into the PTY**
  (`terminalManager.js:734-737`, `data: command + '\r'`). The preamble is 993
  bytes over 9 lines and contains 6 backticks. A POSIX shell accepts a
  multi-line quoted string as continuation, which is why this path worked on
  macOS; `cmd.exe` has no such continuation and submits at the first newline,
  and PowerShell treats a backtick inside a double-quoted string as its escape
  character. Either way `--settings` sits at the end of the line and is the
  first thing lost.
- **Losing `--settings` costs the spec archive.** That file registers the
  `UserPromptSubmit` and `PreToolUse` hooks that run
  `node .frame/bin/spec-hint.js`, which is how a session learns which earlier
  specs touched the topic and the file being edited. A Windows session loses
  not just "Frame exists" but the project's recorded memory.
- **A hand-typed `claude`** gets nothing at all, silently: no `PATH` entry, no
  wrapper, no shell function.

Before this branch, none of this was true on Windows. Init planted a root
`CLAUDE.md` — a real copy rather than a symlink, since symlinks need Developer
Mode — and Claude Code read it natively with no flags and no quoting. The
overlay removed that delivery without putting the replacement within reach of
the platform.

### Two findings that make this much smaller than it looks

**The payload is already written on Windows.** `prepareLaunchAssets`
(`aiToolManager.js:716-732`) gates only its last line on `supportsWrappers()`:

    if (preamble) writeRuntimeFile(projectPath, preambleFileName(tool.id), preamble);
    if (tool.injection && tool.injection.settingsFlag) {
      settingsPath = writeToolSettings(projectPath, tool, extraSettings);
    }
    const wrapperPath = launchEnv.supportsWrappers() ? writeWrapper(...) : '';

So on Windows today, opening a Frame project already writes a correct
`.frame/runtime/preamble-claude.txt` and a correct
`.frame/runtime/claude-settings.json`. Preamble composition, the global layer,
the spec-driven flag and the hook registration are all platform-neutral and all
working. What is missing is not a mechanism — it is a **carrier**.

**Claude Code can take the preamble as a file.** `--append-system-prompt-file`
accepts a path where `--append-system-prompt` takes a string. Verified against
the installed CLI: a bad path reports `Append system prompt file not found`,
and a real file's contents reach the session (a codeword planted in the file
came back in the reply). It is not listed as its own row in `--help` — it
appears only inside the `--bare` option's description — so it is documented but
low-profile.

That flag removes the entire problem rather than working around it. Both
arguments become plain paths, the typed line becomes single-line, and every
hazard in this spec's first section — newlines, backticks, quote nesting —
stops existing. It also means the carrier does **not** need to embed a
993-byte string, which is what would otherwise have forced a Node trampoline
between the shell and an interactive CLI.

## Goal

A Claude Code session on Windows knows exactly what one on macOS or Linux
knows, and nothing that a shell has to parse is ever typed into the terminal.

1. **The composed launch passes paths, not prose.** Claude's injection config
   gains a file-taking prompt flag, and the inline branch prefers it: the
   typed line becomes
   `claude --append-system-prompt-file <path> --settings <path>`.
   This alone satisfies most of the acceptance bar, is a small change, and is
   fully unit-testable with `platform` as a parameter — no Windows machine
   required to write or test it.

   It is also **shell-agnostic**, which is what keeps the rest of this spec
   small. The line depends on no wrapper, no `PATH` entry and no shell
   feature — only on a CLI being on `PATH` and two files existing. Written as
   project-relative paths with forward slashes, it is a line every shell in
   Frame's Windows list can run: `cmd`, `powershell`, `pwsh` and Git Bash
   alike. Windows file APIs accept forward slashes in arguments, and a
   relative path sidesteps both the `\` escaping that would break it in a
   POSIX shell and any question about spaces in the project path.
2. **A `.cmd` wrapper covers the hand-typed launch**, for the shells that
   resolve one. `.frame/bin/claude.cmd` resolves the real CLI with its own
   directory removed from the lookup, then runs it with the same two path
   flags. `.cmd` rather than `.ps1` because only `.cmd` is in the default
   `PATHEXT`, which is what makes a bare `claude` resolve to it. Because it
   passes paths, it stays plain batch — no Node process between the shell and
   an interactive CLI, and so no question about whether the terminal survives
   the hop.

   `PATHEXT` is a Windows-shell mechanism: `cmd`, `powershell` and `pwsh` use
   it, Git Bash does not — bash looks for an exact filename and would not find
   `claude.cmd` from a bare `claude`. Git Bash therefore gets goal 1 and not
   goal 2, which is a real and stated limit rather than an oversight.
3. **The `PATH` entry is ungated.** `launchEnv.prependFrameBin` already carries
   the `;` separator (`launchEnv.js:69`); it is reached only after a platform
   check that is about wrappers, not about `PATH`.
4. **A shell that reorders `PATH` does not win.** The reason
   `terminal-session-setup` exists — `.frame/bin` pushed to sixth place by a
   version manager — has a direct Windows analogue in nvm-windows. A PowerShell
   init script sourced at spawn via `-NoExit -Command`, defining one function
   per tool, closes it the same way and lets the lane report `installed`
   instead of `unsupported`.
5. **A test protocol is a deliverable.** Nobody on this side of the work has a
   Windows machine; verification is a handoff. The spec is not closed by code
   passing CI but by a written, step-by-step protocol a teammate can run and
   report against, with the expected output stated for each step.

## Constraints

- **One injection route, not two.** `terminal-context-boundary` removed the
  second route rather than guarding it. Where a wrapper exists, Frame
  contributes no flags of its own; the file flag is what the wrapper passes,
  not a parallel path around it.
- **A wrapper that cannot run is worse than no wrapper.** `launchEnv.js:18-20`
  states it. The `.cmd` must pass through transparently when the real CLI is
  not found, and must propagate the child's exit code.
- **The file flag is lower-profile than the string flag.** It does not have its
  own `--help` row, so an older Claude Code may reject it as unknown and fail
  the launch outright. Windows may depend on it — the alternative there is
  already broken — but the POSIX path must not be made to depend on it in the
  same change.
- `FRAME_NO_WRAP=1` stays the escape hatch, honoured in the `.cmd` as it is in
  the POSIX wrapper, and honoured nowhere else.
- Nothing is written outside `.frame/`; `test/frameProjectInit.test.js` is the
  standing check and must hold on Windows.
- Generation stays on **project open**, write-if-changed, per tool.
- Logic is testable without Windows: platform, `PATH` and paths are parameters,
  not `process` reads — the shape `launchEnv` and `shellSetup` already use.
- No change to what the preamble says or how it is composed.

## Success Criteria

- On Windows, a Claude session Frame starts receives the preamble **byte for
  byte** — all 9 lines, all 6 backticks — with nothing typed into the PTY
  containing a newline.
- The same session receives `--settings`, and the spec-hint hooks fire: a
  prompt produces the spec-context block, and an edit to a file with spec
  history produces the file-history block.
- A hand-typed `claude` in a Frame lane on Windows gets both of the above.
- With the real `claude` absent from `PATH`, the `.cmd` exits with a clear
  message and shadows nothing; with `FRAME_NO_WRAP=1`, it starts the real CLI
  with no Frame arguments.
- The child's exit code reaches the shell unchanged.
- A lane on a Windows shell Frame can set up reports `installed`, not
  `unsupported`, so `laneContext.whenReady` stops paying the fallback delay.
- `npm test` passes on `windows-latest` in CI.
- The test protocol exists, was run by someone on Windows, and its result is
  recorded in `outcome.md` — including which Claude Code version was used,
  since the file flag's availability is version-dependent.

## Out of Scope

- **Codex and Gemini.** Both declare `INJECTION_WRAPPER` and both currently get
  nothing on Windows. That is a real gap and is deliberately deferred: Claude
  parity is the acceptance bar. The design should not block them later — and
  the file-flag finding does not transfer, since neither has an equivalent
  flag — but no work is done for them here.
- **Rewriting the POSIX wrapper to use the file flag.** It would be simpler
  there too, and it would remove a `$(cat …)` expansion. It also works today,
  and changing it in the same breath as adding a platform would put a
  version-dependent flag on the path that currently has no such dependency.
  Worth its own follow-up.
- **WSL.** It stays in the shell list (`ptyManager.js:311-315`) and keeps
  opening lanes exactly as it does now; this spec simply does not promise it
  context, and a WSL lane that ends up without any is an accepted outcome.
  The reason is that WSL is not a shell but a second machine: the project's
  Windows path is `/mnt/c/…` there, the execute bit on a DrvFs mount is
  usually not honoured, `node` is a separate Linux install, and the `claude`
  that starts is a different binary with its own config and auth. Frame's
  model — one machine, one filesystem, one toolchain — does not hold across
  that boundary, and goal 2's `.cmd` would be exactly the unrunnable script
  `launchEnv.js:18-20` warns about. Worth recording for whoever picks it up:
  the supported way to use Frame with WSL is to run Frame *inside* WSL, where
  `process.platform` is `linux` and every mechanism in this spec already
  works untouched.
- **A hand-typed `claude` in Git Bash.** Covered by goal 1 when Frame composes
  the launch, not covered when the user types it, for the `PATHEXT` reason
  above. Closing it would mean writing the extensionless POSIX wrapper on
  Windows as well and choosing a carrier per lane shell — which also drags
  `prependFrameBin`'s separator from the platform to the shell, since Git Bash
  uses `:`. That is a coherent follow-up and not this spec's bar.
- Changing the preamble's content, the global layer, or the spec-driven flag.
- `cmd.exe` function-equivalent behaviour. `cmd` has no functions and `doskey`
  macros are too fragile; `cmd` gets the `PATH` entry and `PATHEXT` resolution,
  nothing more.
- Windows packaging and release artifacts. `package.json` builds `mac` only
  while the README advertises three platforms; that contradiction is real but
  it is release engineering, not this spec.

## Open Questions

- **Which Claude Code version introduced `--append-system-prompt-file`?** The
  whole design leans on it. If it is recent, Frame needs a fallback for older
  installs — and the honest fallback on Windows may be "launch without context
  and say so", since the string form does not survive the shell there anyway.
- **Does the `.cmd` survive a space in the project path?** `%~dp0` quoting is
  the classic failure, and Frame projects live under `Documents` as often as
  not. Goal 1 sidesteps it by staying relative; goal 2 cannot, since the
  wrapper has to locate the project from wherever it was invoked. Needs a real
  test, not reasoning.
- **Which lanes should report `unsupported`, and should the user see it?**
  `shellSetup` currently answers `none` for all of Windows. After this spec it
  should answer for the shells goal 4 sets up and keep answering `none` for
  the rest — but `unsupported` is silent on the lane card today (only `failed`
  shows), so a WSL lane with no context looks identical to a working one. That
  may be right, or it may be the one place this spec should surface a limit.
- **How does the `.cmd` find the real `claude` without finding itself?**
  `where.exe` searches `PATH`, which now leads with `.frame\bin`. The POSIX
  wrapper strips its own directory and re-runs the lookup; batch needs the
  equivalent, and it is the fiddliest part of an otherwise plain file.
- **PowerShell 5.1 vs pwsh 7.** They differ in profile handling and `-Command`
  parsing. Which are targeted, and must the init script work in both?
