# Plan — Terminal Context Boundary — Frame's context follows Frame's terminal

## Architecture

### Resolved plan-time decisions

**Business**

- **Windows is out of scope; POSIX now.** *Asked.* Frame's wrapper mechanism is
  already POSIX-only — `.frame/bin/codex` is a bash script and
  `./.frame/bin/codex` was never a runnable command on Windows — so limiting
  `PATH` injection to POSIX shells preserves today's behaviour rather than
  regressing it. Windows needs `.cmd`/PowerShell wrappers, a different path
  separator and different exec semantics; that is its own task.
- **The boundary is stated in App Settings and in the REFERENCE template.**
  *Asked.* Two readers, two places: the user meets it in Settings beside the
  escape hatch, the agent meets it in `.frame/docs/REFERENCE.md`, which is
  already where the preamble points. Known limit: `REFERENCE.md` is written at
  init and only its spec section is managed by `docsManagedBlock`, so the line
  reaches new projects only — back-filling existing files is not in scope, and
  Settings is what covers every user immediately.
- **`src/templates/CLAUDE.md` is deleted, not rewritten.** *Silent.* No code
  path reads it — it is an orphan the overlay left behind. Rewriting it would
  produce a project-layer template nothing consumes, against
  `non-invasive-overlay`'s rule that a project layer exists only when there is
  something project-specific to say.

**Technical**

- **Every launch goes through the wrapper — including Frame's own dispatch.**
  *Asked, and it overturns a shipped decision.* `non-invasive-overlay` split
  injection per tool: flags for Claude Code, a wrapper for Codex/Gemini. That
  split cannot survive `PATH` injection: once `.frame/bin` is first on `PATH`,
  a dispatch that types `claude --append-system-prompt …` resolves to the
  wrapper and the flag is injected twice. Keeping the split would mean adding
  a bypass whose only purpose is to stop Frame colliding with itself. Unifying
  removes the second injection path instead of guarding it. `injection.type`
  survives as **data** — which flags a tool's wrapper emits — not as a
  behavioural switch. Recorded here and in `outcome.md` because reversing a
  prior spec's decision silently is what the archive rule forbids.
- **The wrapper resolves the real binary at runtime, with its own directory
  removed from `PATH`.** *Asked.* Survives a version-manager switch or a
  reinstall; an absolute path baked in at write time goes stale silently and is
  only corrected at the next project open.
- **One `--settings`, merged at dispatch.** *Asked.* When the extra flags
  carry a `--settings <path>` (the autonomous implement permissions),
  `aiToolManager` merges that JSON into the settings payload it already writes
  and drops the duplicate flag pair. `specManager` keeps its current contract;
  `.frame/bin/implement-launch.js` keeps its own single flag, since a launch
  from outside the app carries no preamble or hooks to merge with.
- **Test posture: everything testable, with the pure part extracted.**
  *Asked.* The testing record's convention is to test the pure module and skip
  its Electron-coupled wrapper (`telemetryEvents` / `telemetry`,
  `activityEvents` / `activityLog`). `PATH` composition moves into a pure
  `launchEnv.js` so it is covered; wrapper generation is already covered in
  `test/frameTemplates.test.js`. PTY spawning and IPC stay untested, as the
  record says they must.
- **Custom tools get the same treatment.** *Silent.* `getLaunchCommand`
  already defaults an unknown tool's injection to the wrapper type, so a
  user-defined tool gains a wrapper and a `PATH` entry with no extra branch.
- **The `IN-FLIGHT` flag on `pty.js` / `ptyManager.js` is stale.** *Silent.*
  `spec-context` reports both files inside `audit-q3-performance-resources`
  (phase `implementing`). That spec's `outcome.md` records T01–T10 complete
  except T10's *runtime measurement* — a `FRAME_PERF=1 npm start` pass that
  could not run while Frame was live. It edits no code. `embedded-migration`
  reached the same conclusion three days ago; no coordination needed.
- **Nothing is written outside `.frame/`.** *Silent, inherited.* The `PATH`
  entry lives in the environment of a process Frame spawns, so there is
  nothing on disk to undo — which is what makes this approach available where
  a shell-rc line or a `~/.claude/CLAUDE.md` block was not.

### Key components

`src/main/launchEnv.js` is the new pure module — paths and strings in, strings
out, no Electron and no filesystem:

- `frameBinDir(projectPath)` → absolute `.frame/bin` for a project.
- `prependFrameBin(pathValue, projectPath)` → the `PATH` with that directory
  first. Idempotent: a value that already starts with it is returned
  unchanged, so a re-spawned PTY never accumulates duplicates. Returns the
  input untouched on a platform where Frame writes no wrappers.
- `supportsWrappers()` → the POSIX gate, in one place rather than a
  `process.platform` check at each call site.

The wrapper template gains the two behaviours the unification needs. It
resolves the real binary with its own directory stripped from `PATH` — the
recursion guard, and the reason the script can be named after the tool it
wraps — and it emits the tool's own flags from data rather than only a prompt
flag, so Claude's `--append-system-prompt` and `--settings` are produced the
same way Codex's positional prompt is. Its existing behaviour is kept: a
missing preamble file means `exec <real> "$@"`, so a half-written `.frame/`
degrades to the bare CLI instead of breaking the terminal.

`aiToolManager` becomes the single place that prepares a launch: it writes the
preamble file, the settings file and the wrapper for every configured tool,
and `getLaunchCommand` returns the wrapper's path instead of composing flags.
On a platform without wrappers it falls back to today's behaviour — the bare
command plus flags — so the Windows decision needs no second code path
elsewhere.

Refresh moves to project open, beside `gitSharing.ensureOnOpen` and
`instructionDiscovery.refresh` in the `CHECK_IS_FRAME_PROJECT` handler, and
writes only when content differs — the pattern `cli-spec-command-parity`
established for staged commands. This is what makes a stale wrapper
unreachable: the 29 April `.frame/bin/codex` in this repository exists
precisely because generation was launch-only.

### Data shapes

```js
// AI_TOOLS[id].injection — unchanged in shape, now read by the generator
{ type: 'flag' | 'wrapper',
  promptFlag?: '--append-system-prompt',   // emitted by the wrapper
  settingsFlag?: '--settings' }            // emitted by the wrapper

// getLaunchCommand(projectPath, toolId, extraFlags) → unchanged contract
{ command, launchFlags, resolvedCommand, injection }
//   command: './.frame/bin/<id>'  (POSIX)  |  tool.command  (elsewhere)
```

## Files

**New**

- `src/main/launchEnv.js` — pure: Frame's bin directory, `PATH` composition,
  the platform gate.
- `test/launchEnv.test.js` — its suite: idempotence, separator handling,
  untouched value on a non-wrapper platform, no filesystem access.

**Modified**

- `src/shared/frameTemplates.js` — wrapper template: strip-own-dir exec, flag
  emission from the injection record, bare fallback preserved. Dead
  `getCodexWrapperTemplate` and `getGenericWrapperTemplate` removed. A line
  stating the boundary added to `getReferenceTemplate`.
- `src/main/aiToolManager.js` — write wrappers for every tool including
  flag-tools; `refreshLaunchAssets(projectPath)` for the project-open path;
  `getLaunchCommand` returns the wrapper path on POSIX; merge a `--settings`
  pair found in `extraFlags` into the settings payload.
- `src/main/frameProject.js` — call `refreshLaunchAssets` on project open.
- `src/main/pty.js` — `PATH` through `launchEnv.prependFrameBin` in the spawn
  env.
- `src/main/ptyManager.js` — the same, beside `FRAME_NODE`.
- `index.html` — the Settings row's markup.
- `src/renderer/settingsModal.js` — the boundary statement and the escape
  hatch text.
- `test/frameTemplates.test.js` — wrapper cases: no self-exec, flags emitted
  per injection record, arguments passed through, bare fallback.

**Deleted**

- `src/templates/CLAUDE.md` — orphaned by the overlay; describes a layout that
  no longer exists and a symlink Frame no longer plants.

## Footprint

- src/main/launchEnv.js
- src/main/aiToolManager.js
- src/main/frameProject.js
- src/main/pty.js
- src/main/ptyManager.js
- src/shared/frameTemplates.js
- src/renderer/settingsModal.js
- src/templates/CLAUDE.md
- index.html
- test/launchEnv.test.js
- test/frameTemplates.test.js

## Dependencies

None. `launchEnv.js` uses `node:path` and `process.platform`; the wrapper is
bash, generated as a string; the suite runs on `node --test`, already the
project's runner.

## Sequencing

1. **The pure launch environment.** New `src/main/launchEnv.js` with
   `frameBinDir`, `prependFrameBin` and `supportsWrappers`, plus
   `test/launchEnv.test.js`: prepending is idempotent, the platform separator
   is respected, a non-wrapper platform returns the value untouched, and
   nothing touches disk. Nothing consumes it yet. *(C2, G3, S8)*

2. **A recursion-safe wrapper that emits its tool's flags.**
   `getWrapperTemplate` strips its own directory from `PATH` before resolving
   the real binary, emits `promptFlag`/`settingsFlag` when the injection
   record declares them, and keeps the bare-exec fallback. Cases in
   `test/frameTemplates.test.js`: a wrapper named after its tool does not
   re-enter itself, declared flags appear and undeclared ones do not, `"$@"`
   survives, a missing preamble file yields `exec <real> "$@"`. *(C3, C5, S3,
   S5)*

3. **Generate wrappers for every tool, refresh on project open.**
   `aiToolManager` writes the wrapper, preamble and settings file for each
   configured tool — flag-tools included — behind `supportsWrappers()`, and
   exposes `refreshLaunchAssets(projectPath)`; `frameProject`'s
   `CHECK_IS_FRAME_PROJECT` handler calls it, rewriting only when content
   differs. A wrapper written by an older Frame can no longer survive a
   project open. *(C4, G3, S4, S7)*

4. **Dispatch through the wrapper.** `getLaunchCommand` returns
   `./.frame/bin/<id>` for every tool on POSIX and falls back to the bare
   command plus flags elsewhere; the preamble and settings files are refreshed
   immediately before the command is composed, so a dispatched launch is never
   staler than an inline one was. Ordered **before** `PATH` injection on
   purpose: the dispatched command is a relative path, so there is never a
   window in which Frame's own flags and the wrapper's flags are both applied.
   *(G1, C6, C8, S7)*

5. **One `--settings`.** When `extraFlags` carries a `--settings <path>` pair,
   merge that file's JSON into the settings payload and drop the pair, so an
   autonomous implement launch passes the flag exactly once and the spec-hint
   hooks survive the run. Hooks stay Claude-only: the merge happens where the
   settings file is written, which only a tool declaring `settingsFlag`
   reaches. *(C7, S10)*

6. **`PATH` injection into Frame's terminals.** `pty.js` and `ptyManager.js`
   compose their spawn env through `launchEnv.prependFrameBin`. From here a
   hand-typed `claude`, `codex` or `gemini` inside Frame resolves to the same
   wrapper a dispatch uses. *(G1, G3, S1, S2, S8)*

7. **State the boundary.** A Settings row: the rule in one sentence, the
   escape hatch (`command claude` runs the unwrapped CLI) beside it; and the
   matching line in `getReferenceTemplate` so a new project's
   `.frame/docs/REFERENCE.md` carries it for the agent. *(G2, S6, S9)*

8. **Remove what the overlay left behind.** Delete `src/templates/CLAUDE.md`,
   `getCodexWrapperTemplate` and `getGenericWrapperTemplate`, and verify no
   call site or template still describes root meta files or a `CLAUDE.md`
   symlink. *(S11, S12)*
