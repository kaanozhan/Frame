# Windows test protocol — Claude Code context parity

Nobody who wrote this spec has a Windows machine. Everything in it was
asserted from pure modules with `platform` as a parameter, which proves the
*decisions* and nothing about the *machine*. This file is the handoff: run it
on Windows, record what you see, and the spec closes.

**You need:** Windows 10 or 11, Frame built from this branch, Claude Code
installed and logged in, and a Frame project. Claude Code
**2.1.237** was the version the design was verified against;
`--append-system-prompt-file` is documented only inside `--bare`'s help text,
so an older install may not have it. Step 0 checks.

**Report back with:** your Windows version, your PowerShell version, your
Claude Code version, and a pass/fail line per step. Anything that fails, paste
what you actually saw. Write the result into `outcome.md` under **T11** — the
spec is not closed until it is written down.

Two things this protocol deliberately does not test, because the spec does not
promise them: a hand-typed `claude` in **Git Bash** (bash looks for an exact
filename, so `PATHEXT` never brings it to `claude.cmd`), and **WSL** in any
form (it is a second machine, not a shell — run Frame *inside* WSL if you want
Frame there).

---

## 0 · Preconditions

Open **cmd.exe** anywhere.

```
claude --version
where claude
```

**Expect:** a version at or above 2.1.237, and a `where` hit that is *not*
inside any `.frame\bin`. If the version is older, stop and say so — steps 2–7
will not mean what they say, and step 9 becomes the interesting one.

Then, in a Frame project folder, confirm the assets exist:

```
dir .frame\runtime\preamble-claude.txt .frame\runtime\claude-settings.json
dir .frame\bin
dir .frame\runtime\shell
```

**Expect:** both runtime files present; `.frame\bin` contains **`claude.cmd`**
and nothing for codex or gemini; `.frame\runtime\shell` contains **`init.ps1`**
and nothing else. If `claude.cmd` is missing, open the project in Frame once —
these are written on project open.

---

## 1 · The composed launch carries the preamble whole

In Frame, open the project and dispatch an agent into a lane (any lane, any
shell).

**Expect, in the lane:** the typed line is exactly one line and contains no
quotes, no backticks and no prose:

```
claude --append-system-prompt-file .frame/runtime/preamble-claude.txt --settings .frame/runtime/claude-settings.json
```

**Fail if:** the line wraps, the terminal shows a `>` continuation prompt, or
any part of the preamble text appears in the terminal.

Then ask the agent:

> Repeat the first line of your appended system prompt verbatim, then tell me
> how many lines it has and how many backtick characters.

**Expect:** the first line is `Frame context for this session. These files are
not loaded for you — read them before you start:` (or whatever the current
preamble opens with — compare against the file), **9 lines**, **6 backticks**.
Byte-for-byte delivery is the whole point of step 1; a truncated preamble
means the file flag is not doing what this spec assumes.

---

## 2 · The settings file arrives, and the hooks fire

Same session as step 1.

**2a — the prompt hook.** Type any prompt mentioning a topic with spec
history, e.g.:

> what did we decide about the terminal context boundary?

**Expect:** before the model's answer, a `UserPromptSubmit` context block
naming related specs (`terminal-context-boundary`, and a path under
`.frame/specs/`). That block is `node .frame/bin/spec-hint.js` firing, which
only happens if `--settings` survived.

**2b — the edit hook.** Ask the agent to open a file that has spec history:

> read src/main/launchEnv.js

**Expect:** a `PreToolUse` block naming which specs changed that file and why.

**Fail if:** either block is absent. That is the exact failure this spec
exists to fix — `--settings` sat at the end of the line and was the first
thing a shell ate.

---

## 3 · A hand-typed `claude` in cmd.exe

Open a Frame lane on **cmd**. From the project root:

```
echo %PATH%
```

**Expect:** the first entry is `<project>\.frame\bin`.

```
claude
```

**Expect:** Claude Code starts *with* Frame's context. Verify the same way as
step 1 (ask it to repeat the first line of its appended system prompt). This
is `PATHEXT` resolving the bare name to `claude.cmd`.

**Also check** it did not double up: ask the agent whether it sees the Frame
preamble **once** or twice. Once. The wrapper defers when Frame's flag is
already on the line, so the two routes can never stack.

---

## 4 · A hand-typed `claude` in PowerShell

Open a Frame lane on **PowerShell** (or **pwsh**).

```
$env:FRAME_BIN
Get-Command claude
```

**Expect:** `FRAME_BIN` is the project's `.frame\bin`, and `Get-Command claude`
reports **CommandType `Function`** — not Application. The function is what wins
even when a version manager reordered `PATH` after Frame set it.

```
claude
```

**Expect:** starts with context, exactly as step 3.

**The nvm-windows case, if you have it installed:** run `nvm use <some
version>` in that lane first, then `claude` again. Still context. That is the
entire reason `init.ps1` exists — `PATH` alone loses this race.

---

## 5 · The lane reports `installed` on PowerShell, and nothing on cmd

**Expect:** a PowerShell lane opens with **nothing typed into it** (setup rides
in as spawn arguments) and does not sit in a fallback delay. A `cmd` lane shows
**no setup row at all** — `unsupported` is silent by design: the lane works, it
simply has no PowerShell function. A Git Bash lane and a WSL lane are also
silent. **Only `failed` gets a row**, which is what a PowerShell lane whose
init could not be sourced will correctly show — see step 8.

---

## 6 · Shadowing: the wrapper must not find itself

In cmd, from the project root:

```
where claude
```

**Expect:** two or more hits, with `<project>\.frame\bin\claude.cmd` **first**
and the real CLI after it. The wrapper resolves the real one by skipping every
hit whose directory is its own — if that broke, step 3 would have hung rather
than started, so a working step 3 is already most of this.

Now the not-installed case. In a scratch folder outside any Frame project,
temporarily put a `claude.cmd` copy on a `PATH` that has no real `claude`:

```
set PATH=C:\path\to\a\frame\project\.frame\bin
claude
echo %ERRORLEVEL%
```

**Expect:** `Frame: claude was not found on PATH.` on **stderr**, and exit code
**127**. It must not hang, and it must not shadow anything.

---

## 7 · `FRAME_NO_WRAP` and the exit code

In cmd, in the project:

```
set FRAME_NO_WRAP=1
claude --version
echo %ERRORLEVEL%
set FRAME_NO_WRAP=
```

**Expect:** the version prints, **no** Frame context is attached, and the exit
code is **0** — the real CLI's own code, arriving unchanged.

Now a non-zero round trip:

```
claude --frame-bogus-flag-xyz
echo %ERRORLEVEL%
```

**Expect:** the CLI's own "unknown option" error, and a **non-zero** exit code
that matches what the same command produces when run without Frame (compare
with `FRAME_NO_WRAP=1`). This is the one that catches a `%ERRORLEVEL%` read
from the wrong side of a parenthesised block.

---

## 8 · A project path with a space, and one with an apostrophe

Move or copy a Frame project to a path containing a space — `C:\Users\<you>\
Documents\my frame project` is the realistic case, since Frame projects live
under Documents as often as not. Open it in Frame, then repeat **step 3** and
**step 4** there.

**Expect:** both work. `%~dp0` and every path the `.cmd` builds are quoted, and
`init.ps1` quotes `FRAME_BIN` as a PowerShell literal.

If you can, repeat with an apostrophe in the path (`o'brien`). PowerShell
escapes a quote by doubling it, which is a different rule from the POSIX one
and worth one real test.

**Group Policy note:** if your machine enforces an execution policy through
Group Policy, `-ExecutionPolicy Bypass` will not lift it, the marker never
arrives, and the PowerShell lane reports **`failed`** with a paste-able
command (`. .frame/runtime/shell/init.ps1`). That is the designed path, not a
bug — record it if you see it, and note that step 4 will then fail while
step 1 still passes.

---

## 9 · An older Claude Code loses its context, not its session

Only meaningful if you can install a Claude Code old enough to reject
`--append-system-prompt-file` (or simulate it — any flag the CLI does not know
produces the same hard failure).

Dispatch an agent from Frame.

**Expect:** the first line fails, Frame relaunches the CLI **bare**, the agent
comes up working, and a notice says Frame's context could not be attached and
suggests updating the CLI. **Fail if** the lane is left with no agent at all —
that would be worse than the problem this spec set out to fix.

---

## What to write down

Copy this into `outcome.md` under a **T11** heading and fill it in:

```
Windows <10|11 build>, PowerShell <version>, Claude Code <version>
0 preconditions      pass/fail  <notes>
1 composed launch    pass/fail  <lines, backticks>
2 settings + hooks   pass/fail  <both blocks?>
3 cmd hand-typed     pass/fail  <once, not twice?>
4 powershell         pass/fail  <Get-Command type; nvm case>
5 lane states        pass/fail  <installed / silent / failed>
6 shadowing + 127    pass/fail
7 FRAME_NO_WRAP+code pass/fail  <both codes>
8 space / apostrophe pass/fail  <the path you used>
9 older CLI          pass/fail/not-run
```
