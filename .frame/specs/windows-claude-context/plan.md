# Plan — Windows context parity for Claude Code

## Architecture

### Resolved plan-time decisions

**Business (asked at the gate)**

- **Should a Windows lane Frame cannot set up say so?** → **Stay silent.**
  `unsupported` keeps meaning "nothing was sent, nothing is shown", exactly as
  it does on macOS for `nu`. After this spec that state belongs to `cmd.exe`,
  Git Bash and WSL on Windows. Rationale: the lane works, it simply has no
  Frame context; a permanently-present row that always reads the same trains
  the eye to ignore the one time it matters, and the alternative buys renderer
  work in the one area the testing record lists as uncovered. `failed` remains
  the only state with a lane-card row — which is what a PowerShell lane whose
  init could not be sourced will correctly report.
- **What happens when an older Claude Code rejects `--append-system-prompt-file`?**
  → **Auto-retry bare, with a notice.** `agentDispatch` already relaunches a
  flagged dispatch without flags when the first line never reaches ready; the
  gate is simply narrower than it needs to be (`launchFlags`, the caller's own
  extras, rather than the composed set that carries Frame's injection).
  Widening it makes "launch without context and say so" the automatic answer
  on every platform. Rationale: an unknown option is a hard failure — verified,
  `error: unknown option '--frame-bogus-flag-xyz'` — so without this a stale
  Windows install would go from *broken context* to *broken launch*, which is
  strictly worse than what this spec set out to fix.

**Technical (asked at the gate)**

- **What carries the composed launch on Windows?** → **The bare CLI name plus
  two project-relative path flags.** The typed line is
  `claude --append-system-prompt-file .frame/runtime/preamble-claude.txt --settings .frame/runtime/claude-settings.json`.
  Rationale: it is the only single line every shell in Frame's Windows list
  runs — a wrapper path cannot be, since `./.frame/bin/claude.cmd` reads as a
  switch to `cmd.exe` and `.\.frame\bin\claude.cmd` has its backslashes eaten
  by Git Bash. It also holds when the `.cmd` was never written, which is what
  keeps goal 1 independent of goal 2. The rejected alternative — routing
  through the wrapper per shell — would have to thread the lane's shell into
  `getLaunchCommand` and would still leave Git Bash with no answer.
- **How does PowerShell receive its init?** →
  **`-ExecutionPolicy Bypass -NoExit -Command ". '<init.ps1>'; <marker>"` at
  spawn.** Rationale: Windows client machines default to a `Restricted`
  execution policy that blocks dot-sourcing an unsigned local `.ps1`, and the
  flag lifts it for this one process without touching anything machine-wide —
  the same bargain `launchEnv` already makes for `PATH`. Keeping the init in a
  real file (rather than inlining the definitions into `-Command`) preserves
  the shape the POSIX and fish lanes already use and leaves the user something
  to read and paste by hand. Where Group Policy overrides the flag the marker
  never arrives and the lane reports `failed` — the designed path, not a new
  failure mode.
- **Should this spec's work ship with tests?** → **Pure logic and data
  transforms only.** `launchEnv`'s wrapper naming, `shellSetup`'s Windows
  delivery table, the two new templates and the inline flag composition all
  take `platform` as a parameter, so they assert Windows behaviour from a Mac.
  The PTY wiring and the one-line `agentDispatch` change stay untested.
  Rationale: this is the convention the testing record describes (target the
  pure module, skip its Electron-coupled wrapper) and the answer
  `terminal-session-setup` gave for the same area; `src/renderer/` still has
  no DOM harness — verified, no `jsdom`/`playwright`/`@testing-library`/
  `puppeteer` in `devDependencies`.

**Technical (decided silently)**

- **A tool earns a Windows wrapper by having a file-taking prompt flag.**
  `writeWrapper` emits `.frame/bin/<id>.cmd` only when the tool's injection
  record carries `promptFileFlag`. That is the rule rather than a hardcoded
  "claude only" list, because the flag is precisely what lets the batch file
  stay plain: it passes paths, never the 993-byte preamble. Codex and Gemini
  have no equivalent, get no `.cmd`, and behave on Windows exactly as they do
  today — the spec's Out of Scope, expressed as a condition instead of a
  special case.
- **The `.cmd` defers when Frame's flag is already present.** One injection
  route (C1) survives the gate decision above: with `.frame/bin` first on
  `PATH`, the composed line resolves through the wrapper, so the wrapper
  checks its own arguments for `--append-system-prompt-file` and, finding it,
  executes the real CLI with `%*` untouched. Whoever composed first owns the
  injection; the two can never stack.
- **Exit-code propagation is `goto`-shaped, not `%ERRORLEVEL%`-shaped.**
  `cmd.exe` expands variables when it parses a parenthesised block, so
  `exit /b %ERRORLEVEL%` inside an `if (…)` would report the code from before
  the `call`. Every pass-through jumps to one label that ends in a bare
  `exit /b`, which leaves the child's code untouched (S5).
- **`ptyManager` needs no change for goal 4.** `createTerminal` already
  appends a `mode: 'flag'` delivery's `args` to `shellArgs`
  (`ptyManager.js:441-444`), and the Windows branch leaves `shellArgs` empty,
  so a PowerShell delivery lands as spawn arguments with nothing typed. Flag
  mode also has no retry by construction (`onSetupTimeout` returns `failed`
  for anything that is not `type`) — correct here for the same reason it is
  correct for fish.
- **`npm test` gets a Node launcher.** `FRAME_ACTIVITY_HOME=… node --test test/*.test.js`
  is a POSIX-only invocation: `cmd.exe` sets no inline environment variable
  and does not expand the glob, and Node 20 does not expand it either. CI
  deliberately runs no `npm ci`, so a `cross-env`-style dependency is not
  available. `scripts/run-tests.js` sets the variable, lists `test/*.test.js`
  itself — making the `fixtures/` exclusion explicit rather than a property of
  the shell — and forwards the child's exit code.
- **Footprint collision, recorded.** `package.json` sits in the footprint of
  `audit-q3-performance-resources` (phase `implementing`, T10 in progress,
  last touched 2026-07-19). This spec changes one line of it — the `test`
  script. Run the two sequentially rather than in parallel worktrees; nothing
  else in that spec's footprint is touched here.

### How the pieces fit

Nothing in the injection *mechanism* changes. The preamble is composed,
written and named exactly as it is today, on every platform — Windows already
produces a correct `.frame/runtime/preamble-claude.txt` and a correct
`.frame/runtime/claude-settings.json`, because `prepareLaunchAssets` gates only
its wrapper line on the platform. What this plan adds is a **carrier** for
those two files on Windows, in three independent layers:

1. **The composed launch** (`getLaunchCommand`). On a platform with no POSIX
   wrappers, the inline branch prefers `promptFileFlag` over `promptFlag` and
   passes both values as project-relative, forward-slash paths. A single-line,
   quote-free, backtick-free command that every Windows shell accepts.
2. **The `PATH` entry** (`launchEnv.prependFrameBin`). Loses its platform gate;
   the `;` separator it already carried finally gets used.
3. **The shell's own resolution.** `.frame/bin/claude.cmd` catches a
   hand-typed `claude` through `PATHEXT` (cmd, powershell, pwsh — not Git
   Bash, which looks for an exact filename), and `.frame/runtime/shell/init.ps1`
   defines a `claude` function that wins even when a version manager has
   reordered `PATH` behind Frame's back.

`launchEnv` keeps being the single place that answers platform questions.
`supportsWrappers(platform)` keeps its current meaning — *does this platform
get a POSIX wrapper for every tool* — and two siblings join it:
`wrapperFamily(platform)` (`'posix'` | `'cmd'`) and
`wrapperFileName(toolId, { platform, canPassPaths })`, which returns `''` for a
tool that cannot be wrapped here. Every caller keeps asking `launchEnv` instead
of reading `process.platform` for itself.

`shellSetup` gains a third family the same way it gained `fish`: an entry in
`INIT_FILES` (`powershell: 'init.ps1'`), two entries in `FAMILY_BY_SHELL`
(`powershell`, `pwsh`), and a new `initFamilies(platform)` that says which
families are deliverable where. `deliveryFor` loses its blanket
`platform === 'win32'` short-circuit and instead rejects a family that is not
deliverable on this platform — which is what keeps `bash.exe` (family `posix`)
from being handed an `init.sh` full of functions pointing at wrappers Windows
does not have, and keeps `init.ps1` from ever being offered to a Mac.

### The typed line, before and after

    # Windows today — 993 bytes over 9 lines, 6 backticks, typed into the PTY
    claude --append-system-prompt 'Frame context for this session…
    …' --settings /Users/…/.frame/runtime/claude-settings.json

    # Windows after this plan — one line, two paths, nothing to parse
    claude --append-system-prompt-file .frame/runtime/preamble-claude.txt --settings .frame/runtime/claude-settings.json

    # macOS and Linux — unchanged, still the wrapper, still the string flag
    ./.frame/bin/claude

## Files

- `src/main/launchEnv.js` — **Modified.** Ungate `prependFrameBin`; add
  `wrapperFamily(platform)` and `wrapperFileName(toolId, options)`.
- `src/main/aiToolManager.js` — **Modified.** Claude's injection record gains
  `promptFileFlag`; `writeWrapper` picks family, name and template and
  self-gates; `prepareLaunchAssets` returns project-relative asset paths; a new
  exported pure `inlineInjectionFlags(tool, assets, platform)` composes the
  wrapper-less branch; `writeShellInit` writes per-platform families.
- `src/main/shellSetup.js` — **Modified.** `powershell` family: `INIT_FILES`,
  `FAMILY_BY_SHELL`, `initFamilies(platform)`, a PowerShell quoter and marker
  echo, and the spawn-flag delivery; `deliveryFor` drops its win32
  short-circuit.
- `src/shared/frameTemplates.js` — **Modified.** New
  `getCmdWrapperTemplate(toolCommand, options)`; `getShellInitTemplate` grows a
  `powershell` branch.
- `src/renderer/agentDispatch.js` — **Modified.** Retry-bare fires on the
  composed flag set, and its notice distinguishes dropped permission flags from
  dropped Frame context.
- `scripts/run-tests.js` — **New.** Cross-platform test launcher: sets
  `FRAME_ACTIVITY_HOME`, lists `test/*.test.js` (never `test/fixtures/`), runs
  `node --test`, forwards the exit code.
- `package.json` — **Modified.** `test` script points at the launcher.
- `.github/workflows/ci.yml` — **Modified.** `windows-latest` joins the matrix.
- `test/launchEnv.test.js` — **Modified.** `PATH` prepending on win32 with `;`;
  `wrapperFamily` and `wrapperFileName` across platforms and both
  `canPassPaths` values.
- `test/shellSetup.test.js` — **Modified.** PowerShell family resolution and
  delivery; `cmd`, Git Bash and WSL answer `none` on win32; `posix`/`fish` are
  refused on win32 and `powershell` on darwin; the marker still never appears
  literally in what is delivered.
- `test/frameTemplates.test.js` — **Modified.** `getCmdWrapperTemplate`: self-
  exclusion in the `where` loop, the `FRAME_NO_WRAP` branch, the
  already-composed pass-through, the not-found message and exit code 127, and
  no `%ERRORLEVEL%` inside a parenthesised block. Plus the `powershell` init
  template: `FRAME_BIN` first on `PATH`, one function per tool, and a fallback
  that resolves `-CommandType Application` so it cannot recurse.
- `test/aiToolLaunch.test.js` — **New.** `inlineInjectionFlags` with `platform`
  as a parameter: `win32` yields the file flag and two relative paths, `darwin`
  yields the string flag and the preamble text, and a tool with no
  `promptFileFlag` yields the string form on both.
- `.frame/specs/windows-claude-context/test-protocol.md` — **New.** The
  step-by-step Windows verification handoff, with expected output per step.

## Footprint

- src/main/launchEnv.js
- src/main/aiToolManager.js
- src/main/shellSetup.js
- src/shared/frameTemplates.js
- src/renderer/agentDispatch.js
- scripts/run-tests.js
- package.json
- .github/workflows/ci.yml
- test/launchEnv.test.js
- test/shellSetup.test.js
- test/frameTemplates.test.js
- test/aiToolLaunch.test.js
- .frame/specs/windows-claude-context/test-protocol.md

## Dependencies

None. CI deliberately runs without `npm ci`, so every part of this plan is
repo-local Node and generated text.

## Sequencing

1. **Put `.frame/bin` on Windows `PATH`, and name what lives there.**
   `launchEnv.prependFrameBin` drops its `supportsWrappers` gate — the check
   was always about wrappers, never about `PATH`, and the `;` separator on
   line 69 has been waiting for this. Add `wrapperFamily(platform)` and
   `wrapperFileName(toolId, { platform, canPassPaths })`, the two facts every
   later step asks for instead of reading `process.platform`.
   `test/launchEnv.test.js` covers both new functions and the win32 prepend.

2. **Teach Claude's launch to pass paths instead of prose.** Add
   `promptFileFlag: '--append-system-prompt-file'` to the tool's injection
   record. `prepareLaunchAssets` returns `preambleRel` and `settingsRel`
   alongside the absolute paths it already returns. A new exported pure
   `inlineInjectionFlags(tool, assets, platform)` composes the wrapper-less
   branch: the file flag with relative paths where `!supportsWrappers(platform)`,
   the existing string flag and absolute settings path everywhere else — which
   is how the POSIX path stays free of a version-dependent flag (C3).
   `getLaunchCommand` calls it in place of its inline `flags.push` pair.
   `test/aiToolLaunch.test.js` asserts both platforms and the no-`promptFileFlag`
   case. Shippable on its own: this is most of the acceptance bar, and it needs
   no wrapper, no `PATH` entry and no shell feature.

3. **Write `.frame/bin/claude.cmd`.** `getCmdWrapperTemplate` generates batch
   that: resolves the real CLI with `for /f … in ('where <tool>')`, skipping any
   hit whose `%%~dpI` equals `%~dp0`; exits 127 with
   `Frame: <tool> was not found on PATH.` when nothing remains; passes through
   untouched under `FRAME_NO_WRAP` (C4) and when its own arguments already
   carry `promptFileFlag` (C1); walks up from `%CD%` to the directory holding
   `.frame\` and passes `--append-system-prompt-file` plus, when the file
   exists, `--settings`, both quoted absolute paths so a space in the project
   path is safe. Every branch reaches one `call`/`exit /b` pass-through label so
   the child's code arrives unchanged (S5). `writeWrapper` chooses template and
   filename through `launchEnv`, returns `''` for a tool with no
   `promptFileFlag`, and skips the `0o755` chmod for the `cmd` family;
   `prepareLaunchAssets` drops its own `supportsWrappers()` call and lets
   `writeWrapper` self-gate, so generation stays on project open, write-if-
   changed, per tool (C6). Assertions land in `test/frameTemplates.test.js`.

4. **Make a PowerShell lane a lane Frame set up.** `shellSetup` gains
   `INIT_FILES.powershell = 'init.ps1'`, `powershell`/`pwsh` in
   `FAMILY_BY_SHELL`, `initFamilies(platform)`, a PowerShell single-quoter
   (doubling `'`) and a `Write-Output ('<prefix>' + '<token>')` marker echo that
   keeps the two halves non-adjacent. `deliveryFor` loses its win32
   short-circuit and instead returns `unsupported-shell` for a family
   `initFamilies` does not list, then answers PowerShell with
   `{ mode: 'flag', args: ['-ExecutionPolicy', 'Bypass', '-NoExit', '-Command', … ] }`.
   `getShellInitTemplate` grows the `powershell` branch: `$env:FRAME_BIN`,
   `PATH` rebuilt with `FRAME_BIN` first, and one function per tool delegating
   to `"$env:FRAME_BIN\<id>.cmd"` with a `Get-Command -CommandType Application`
   fallback that cannot recurse into itself. `writeShellInit` replaces its
   `supportsWrappers()` gate with `initFamilies()` and passes only the tool ids
   that have a wrapper here. `ptyManager` is untouched. Tests split across
   `test/shellSetup.test.js` and `test/frameTemplates.test.js`.

5. **Make a rejected flag cost the context, not the session.** In
   `agentDispatch`, gate the bare relaunch on the composed flag set rather than
   the caller's own `launchFlags`, and branch the notice: dropped permission
   flags keep today's guided-mode wording, a dispatch that came up bare with no
   caller flags says Frame's context could not be attached. This is the
   recorded answer to the spec's first open question and the reason a stale
   Claude Code on Windows still gets a working agent.

6. **Give the suite a Windows leg.** Add `scripts/run-tests.js`, point
   `package.json`'s `test` script at it, add `windows-latest` to the CI matrix,
   and put `{ skip: !POSIX }` on the tests that still shell out to `bash`,
   `sh` or `zsh` — the guard `test/frameTemplates.test.js` already established
   for its executed wrappers. Green on all three legs is S7.

7. **Write the handoff.** `test-protocol.md`: numbered steps a teammate on
   Windows runs, each with the exact command and the exact expected output —
   the preamble arriving whole in a Frame-composed lane, the spec-context and
   file-history hook blocks firing, a hand-typed `claude` in cmd and in
   PowerShell, the `where`-shadowing and `FRAME_NO_WRAP` cases, an exit code
   round-trip, the lane reporting `installed` on PowerShell and nothing at all
   on cmd, and a project path containing a space. It records the Claude Code
   version used, because the file flag's availability is version-dependent
   (verified present in 2.1.237). The result lands in `outcome.md`; the spec is
   not closed until it does.
