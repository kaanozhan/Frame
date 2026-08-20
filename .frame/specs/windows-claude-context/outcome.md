# Outcome — Windows context parity for Claude Code

## T01 — Put `.frame/bin` on Windows `PATH`, and name what lives there

Dropped the `supportsWrappers` gate from `launchEnv.prependFrameBin` — the check
was about wrappers, the function is about `PATH`, and gating it is what kept the
`;` separator on line 69 unreachable. Added `wrapperFamily(platform)` (`'posix'`
| `'cmd'`) and `wrapperFileName(toolId, { platform, canPassPaths })`, which
returns `''` for a tool that earns no wrapper here; `canPassPaths` defaults to
false so Windows opts a tool in explicitly rather than by a hardcoded list.
Files: `src/main/launchEnv.js`, `test/launchEnv.test.js` (8 new tests, platform
as a parameter). No deviation from `plan.md`.

_Captured: 2026-08-20 · 2 file changes_

---

## T02 — Teach Claude's launch to pass paths instead of prose

Added `promptFileFlag: '--append-system-prompt-file'` to Claude's injection
record, made `prepareLaunchAssets` return `preambleRel`/`settingsRel` as
project-relative forward-slash paths, and moved the wrapper-less flag
composition into a new exported pure `inlineInjectionFlags(tool, assets,
platform)` that `getLaunchCommand` now calls. The file flag is preferred only
where `!supportsWrappers(platform)`, so POSIX keeps the string form and no
version-dependent flag reaches the path that works today (C3). Files:
`src/main/aiToolManager.js`, `test/aiToolLaunch.test.js` (new, 12 tests, loads
the module with `electron` stubbed since no test had needed it before). No
deviation from `plan.md`.

_Captured: 2026-08-20 · 2 file changes_

---

## T03 — Write the `.frame/bin/<id>.cmd` wrapper template

Added `getCmdWrapperTemplate(toolCommand, options)` to `frameTemplates.js`:
self-excluding `where` resolution, exit 127 when the CLI is absent,
`FRAME_NO_WRAP` and already-composed pass-throughs, a `%CD%`-upward walk to
`.frame\`, quoted paths throughout, and one `call`/bare `exit /b` tail so the
child's exit code arrives unchanged. Returns `''` for a tool with no
`promptFileFlag`. **Deviation:** the already-composed check scans `%~1` one
argument at a time in a `:frame_scan_args` subroutine instead of the plan's
substring search over `%*` — `%*` expands at parse time, so a user argument
carrying `&` or `|` would be re-parsed as syntax. Files:
`src/shared/frameTemplates.js`, `test/frameTemplates.test.js` (14 new tests,
string-only — cmd.exe is not on this machine and T10's protocol is the real
verification).

_Captured: 2026-08-20 · 2 file changes_

---

## T04 — Let `writeWrapper` choose its family and self-gate

`writeWrapper` now takes its filename and family from `launchEnv`
(`wrapperFileName` with `canPassPaths: !!injection.promptFileFlag`,
`wrapperFamily`), picks `getCmdWrapperTemplate` or `getWrapperTemplate`, skips
the `0o755` chmod for the `cmd` family, and returns `''` for a tool that earns
no wrapper; `prepareLaunchAssets` dropped its `supportsWrappers()` call and
just calls it. Verified by forcing win32 through `launchEnv` in a scratch
project: only `.frame/bin/claude.cmd` is written, and the POSIX run still
produces all three wrappers at mode 755. Also recorded, in
`wrapperLaunchCommand`, why the `.cmd` is deliberately *not* the composed
launch line. Files: `src/main/aiToolManager.js`. No deviation from `plan.md`.

_Captured: 2026-08-20 · 1 file change_

---

## T05 — Give `shellSetup` a PowerShell family

Added `INIT_FILES.powershell`, `powershell`/`pwsh` in `FAMILY_BY_SHELL`, an
exported `initFamilies(platform)`, a PowerShell quoter that doubles `'`, and a
`Write-Output ('<prefix>' + '<token>')` marker echo whose halves stay apart.
`deliveryFor` dropped its blanket win32 short-circuit for an `initFamilies`
check — Git Bash is refused for its *family*, not its name, since its
`init.sh` points at wrappers Windows never writes — and answers PowerShell
with `-ExecutionPolicy Bypass -NoExit -Command ". '<init.ps1>'; <echo>"`.
`cmd`, Git Bash and WSL now read `unsupported-shell`, which is silent by
design. Files: `src/main/shellSetup.js`, `test/shellSetup.test.js` (11 new;
the `reason: 'platform'` test is gone with the branch it covered). No
deviation from `plan.md`.

_Captured: 2026-08-20 · 2 file changes_

---

## T06 — Write `init.ps1`, and let `initFamilies` decide what gets written

Added the `powershell` branch to `getShellInitTemplate` — `$env:FRAME_BIN`,
`PATH` rebuilt with it first, one function per tool routing to
`"$env:FRAME_BIN\<id>.cmd"` with a `Get-Command -CommandType Application`
fallback that excludes functions and so cannot recurse. `writeShellInit` now
loops over `shellSetup.initFamilies()` instead of `Object.keys(INIT_FILES)`
behind a `supportsWrappers()` gate, and passes only the tool ids that have a
wrapper on this platform, so Windows gets a `claude` function and nothing for
Codex or Gemini. Files: `src/shared/frameTemplates.js`,
`src/main/aiToolManager.js`, `test/frameTemplates.test.js` (7 new). No
deviation from `plan.md`.

_Captured: 2026-08-20 · 3 file changes_

---

## T07 — Make a rejected flag cost the context, not the session

Widened `agentDispatch`'s bare relaunch to fire on the composed flag set
rather than the caller's own `launchFlags`, and branched the notice: dropped
permission flags keep the guided-mode wording, a dispatch that came up bare
with no caller flags now says Frame's context could not be attached.
`flagsDropped` still tracks only caller flags, so the prompt note and the
autonomous-lane pin behave as before. This is the recorded answer to the
spec's first open question — without it, a stale CLI would go from losing its
context to losing its session. Files: `src/renderer/agentDispatch.js`. No test:
`src/renderer/` has no DOM harness, which `plan.md` records as the convention.

_Captured: 2026-08-20 · 1 file change_

---

## T08 — Give `npm test` a Node launcher

Added `scripts/run-tests.js`: sets `FRAME_ACTIVITY_HOME`, lists
`test/*.test.js` itself so the `test/fixtures/` exclusion is a rule rather
than a property of the shell, spawns `node --test` and forwards the child's
exit code (a signal counts as failure). `package.json`'s `test` script points
at it, and an optional substring argument runs a subset. Confirmed a red test
file makes it exit 1 and an unmatched filter exits 1. Files:
`scripts/run-tests.js` (new), `package.json`. No deviation from `plan.md`;
the recorded footprint collision with `audit-q3-performance-resources` still
holds — this touches only the `test` script line.

_Captured: 2026-08-20 · 2 file changes_

---

## T09 — Give the suite a Windows leg

Added `windows-latest` to the CI matrix and audited every test that shells
out: the only `bash`/`sh`/`zsh` calls in the suite are the four helper call
sites in `test/frameTemplates.test.js`, and all of them already sit inside
tests carrying `{ skip: !POSIX }` — no new guards were needed. **The leg is
not verified green:** confirming that needs a push, and this loop never
pushes. Two residual Windows risks were found and deliberately not guessed
at: `fs.symlinkSync` in `test/embeddedMigration.test.js` (a file symlink needs
a privilege on Windows) and line endings (the repo has no `.gitattributes`, so
a CRLF checkout could break content comparisons). Files:
`.github/workflows/ci.yml`.

Followup: add `.gitattributes` with `* text=auto eol=lf`, and decide whether
the legacy-symlink migration tests should carry `{ skip: !POSIX }` — Frame
never planted a symlink on Windows, so guarding them would be semantic, not a
workaround. Both are outside this plan's Files list.

_Captured: 2026-08-20 · 1 file change_

---

## T10 — Write the Windows verification handoff

Added `test-protocol.md`: ten numbered steps, each with the exact command and
the exact expected output — the composed launch's single line and byte-for-byte
preamble, both spec-hint hook blocks, a hand-typed `claude` in cmd and
PowerShell (including the nvm-windows race `init.ps1` exists for), the lane
states, `where`-shadowing and the 127 case, `FRAME_NO_WRAP` and an exit-code
round trip, a path with a space and one with an apostrophe, and the older-CLI
bare relaunch. It states plainly that a hand-typed launch has no bare-retry and
that Group Policy defeats `-ExecutionPolicy Bypass` (lane reports `failed`, by
design), and names Git Bash and WSL as out of scope so their absence is not
filed as a bug. Step 1's counts were checked against the real preamble — first
line verbatim, 9 lines, 6 backticks — and the local CLI is 2.1.237. Files:
`.frame/specs/windows-claude-context/test-protocol.md`.

_Captured: 2026-08-20 · 1 file change_

---

## T11 — Closed with the Windows run unrecorded

**No Windows machine ran `test-protocol.md`.** This task asked for a
teammate's result and was closed by decision instead, so there is no per-step
table here — an invented one would be worse than none, because the next reader
would trust it. The only version fact on file is the one the design was
verified against on macOS: Claude Code **2.1.237**, where
`--append-system-prompt-file` exists and a bad path reports `Append system
prompt file not found`.

What that leaves: every decision in this spec is asserted from pure modules
with `platform` as a parameter (577 tests, three legs configured), and not one
line of the Windows behaviour — the `.cmd`, `init.ps1`, the composed launch
line, `PATHEXT` resolution, exit-code propagation — has been exercised on
Windows. The protocol is written and ready; running it is still the thing that
would turn this from designed to verified.

Followup: run `test-protocol.md` on Windows and append the result here.
Followup (from T09): the `windows-latest` CI leg has never executed — it needs
a push — and two known risks sit under it, `fs.symlinkSync` in
`test/embeddedMigration.test.js` and the missing `.gitattributes`.

_Captured: 2026-08-20 · 0 file changes_

---

## Post-close fix — `test/aiToolLaunch.test.js` crashed on CI

The first CI run after the branch was pushed failed on **all three** legs,
which is the tell: the cause was environmental, not the Windows code. T02's
new test file stubbed `electron` by name, but `aiToolManager` also pulls in
`@aptabase/electron/main` at module scope through `telemetry`, and CI runs no
`npm ci` — so the file threw `MODULE_NOT_FOUND`, `node --test` exited
non-zero, and every leg went red. It passed locally only because
`node_modules` was there.

Reproduced without touching the tree, by making any resolution into
`node_modules` throw the way it does on CI, then fixed generically: the stub
now intercepts every non-builtin, non-relative request for the duration of the
load rather than naming dependencies one at a time — naming them is what broke,
since the list grows with the require graph. Under the simulation the full
suite is 577/577.

_Captured: 2026-08-20 · 1 file change_

---
