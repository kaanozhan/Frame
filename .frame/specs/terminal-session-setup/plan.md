# Plan — Terminal Session Setup — the lane Frame opens is a lane Frame set up

## Architecture

### Resolved plan-time decisions

**Business (asked at the gate)**

- **Does the readiness primitive land here or separately?** → **Here.** The
  setup marker is proof the shell is processing input, so it replaces the
  fixed delays in the four start flows (`_startAgentIn` 800/50 ms,
  `startAiSession` 1000 ms, `multiTerminalUI.sendCommand` 300 ms). Rationale:
  criterion 12 is a success criterion of *this* spec, and the marker is the
  only signal that makes it satisfiable; splitting it would ship a primitive
  with no consumer and leave the criterion unmet by construction. Cost
  accepted: this spec touches `agentDispatch.js`, `index.js` and
  `multiTerminalUI.js`.
- **Is the lane indicator always visible, or only on failure?** →
  **Only on failure.** A lane card is unchanged when setup worked; the
  failure row appears only when context could not be installed. Rationale:
  the state is the same on virtually every lane, and a permanent chip that
  always reads the same trains the eye to ignore the one time it doesn't.
- **Is the off switch global or per project?** → **There is no off switch.**
  The user overturned the fork: this is product behaviour, not a preference.
  Consequence, recorded explicitly: **success criterion 10 is dropped** — no
  code path in this plan restores `terminal-context-boundary`'s behaviour by
  setting. `FRAME_NO_WRAP=1` (C4) remains the escape hatch for a single run,
  and a shell where setup cannot be delivered still degrades to exactly the
  `PATH`-only behaviour the previous spec shipped.

**Technical (asked at the gate)**

- **What happens to keystrokes typed during the invisible setup window?** →
  **Held and flushed.** `writeToTerminal` queues input while a terminal's
  setup is pending and writes the queue through, in order, the moment setup
  resolves. Rationale: the window is well under a second on a warm shell, and
  passing input through would echo it into a buffer that is about to be
  discarded — the user would watch their own typing vanish.
- **Should this spec's work ship with tests?** → **Pure logic only.** The new
  pure modules (`shellSetup.js`, the init template) get `test/*.test.js`
  coverage in the project's existing style; the PTY wiring and the lane UI
  stay untested, as their neighbours are. Rationale: matches the recorded
  convention — target the pure module, skip its Electron-coupled wrapper —
  and `src/renderer/` has no DOM harness at all.

**Technical (decided silently)**

- **Delivery per shell family.** zsh/bash/sh receive a typed
  `. "<init.sh>"` line (no post-startup flag exists for them that does not
  reroute the user's own startup files, which C1 forbids); fish receives
  `-C 'source <init.fish>'` at spawn. `nu`, `pwsh` and `cmd` receive
  **nothing** and report state `unsupported` — Windows has no `.cmd` shims to
  point at (C6) and nushell's function/`PATH` model does not match either
  generated file. Not a failure, so no failure UI.
- **The marker must not appear in the line that carries it.** In typed mode
  the tty echoes the command before running it, so a naive scan would match
  the echo and declare success before the shell had done anything. The
  delivered line prints the marker from two adjacent quoted fragments
  (`'__frame_ready_''<token>'`), which both shells concatenate at run time —
  so the literal token exists only in real output.
- **Verification lives in the main process.** Suppression has to happen
  before the renderer sees a byte, and `ptyManager` already owns the output
  pipeline (coalescing, backpressure) that the buffer has to sit in front of.
- **`src/main/pty.js` is not touched.** It is the legacy single-PTY path;
  `terminal.startTerminal()` is a no-op and every renderer flow creates lanes
  through `ptyManager`. Adding a second setup implementation to a path
  nothing spawns would be untested code by construction.
- **The init file is a launch asset.** It is written by
  `aiToolManager.refreshLaunchAssets`, beside the wrappers and preambles, so
  it is regenerated on project open and before every composed launch, and a
  newly configured custom tool gets its function without a restart.

### How setup reaches the shell

`.frame/bin` first on `PATH` is retained untouched as the base layer (C3) —
it is what reaches subshells, where functions do not. On top of it, every lane
Frame opens in a Frame project loads one generated file:

```
.frame/runtime/shell/init.sh      # zsh, bash, sh — POSIX
.frame/runtime/shell/init.fish    # fish
```

Each file does two things and nothing else:

1. Move `.frame/bin` to the front of `PATH` — *after* the user's rc files have
   run, which is the reordering `terminal-context-boundary` could not win.
2. Define one shell function per configured tool (`claude`, `codex`,
   `gemini`, and any custom tool in the registry), each delegating to
   `"$FRAME_BIN/<id>"` with the user's arguments, falling back to
   `command <id> "$@"` when the wrapper file is missing.

A function is resolved before any `PATH` search, so the ordering question
disappears. The function is a *router*, not a second injection point: it
delegates to `.frame/bin/<id>`, which stays the only thing that composes the
preamble (C2) and the only thing that honours `FRAME_NO_WRAP=1` (C4) — so the
escape hatch works identically through the function and through `PATH`.

Nothing is written outside `.frame/runtime/shell/`; no rc file, no `ZDOTDIR`,
no registry (C1, S11).

### Delivery, verification, failure

`shellSetup.deliveryFor(shellPath, platform)` returns one of three shapes:

```js
{ mode: 'flag', args: ['-C', "source '<abs>/.frame/runtime/shell/init.fish'; …"] }
{ mode: 'type', line: ` . '<abs>/.frame/runtime/shell/init.sh' && printf '%s\\n' '__frame_ready_''<token>'` }
{ mode: 'none' }
```

`ptyManager.createTerminal` resolves it once, gated on
`launchEnv.supportsWrappers()` and on the lane's project actually being a
Frame project (`.frame/` present) — otherwise `mode: 'none'`, nothing is sent
and no function or variable is defined (S9).

While a terminal's setup is `pending`:

- **Output is buffered, not forwarded** — it never enters the coalescing
  pipeline, so the user's first prompt is the one that follows setup (S3).
  The buffer is capped; past the cap the terminal is treated as a timeout.
- **Input is buffered too** — `writeToTerminal` queues and flushes in order
  once setup resolves.
- **The marker resolves it.** On seeing the token, everything up to and
  including that line is dropped, the remainder enters the normal pipeline,
  and the state becomes `installed`.
- **On timeout** (`SETUP_TIMEOUT_MS`), the buffer is flushed verbatim — the
  terminal is never left blank — and the line is typed once more with a fresh
  token (S4). A second timeout ends in `failed`: buffer flushed, input
  flushed, working terminal, no context (C6, fail open).

State is pushed to the renderer on every resolution as
`IPC.TERMINAL_CONTEXT_STATE` → `{ terminalId, state, ready }`, where `state`
is `installed | failed | unsupported` and `ready` is true only for
`installed`.

### What the renderer does with the state

`src/renderer/laneContext.js` is the single consumer: it caches state per
terminal, drops entries on `TERMINAL_DESTROYED`, and exposes
`whenReady(terminalId, fallbackMs)` — resolving immediately once the lane is
`installed`, and after `fallbackMs` otherwise, which is exactly the delay each
call site uses today. That is what replaces the fixed waits (S12): a lane that
confirms setup starts its agent as soon as the shell answered; a lane that
cannot (unsupported shell, failed setup) behaves precisely as it does now.

On `failed`, the lane card grows one row: the statement that context could not
be installed, a **Start agent** button that goes through
`agentDispatch`'s existing `_startAgentIn` (exported as `startAgentInLane` —
this spec adds no second way to launch an agent, C5), and the one-line manual
command the user can paste into the lane themselves.

## Files

**New**

- `src/main/shellSetup.js` — pure: shell family from a shell path, the
  delivery shape per family, marker minting, and the "what survives the
  marker" split used by the buffer.
- `test/shellSetup.test.js` — cases for the above, including the invariant
  that the delivered line never contains the literal marker.
- `src/renderer/laneContext.js` — per-lane context state cache plus
  `whenReady(terminalId, fallbackMs)`.

**Modified**

- `src/shared/frameTemplates.js` — `getShellInitTemplate({ family, binDir,
  toolIds })`: the generated init file for POSIX and fish.
- `test/frameTemplates.test.js` — init-template cases beside the existing
  wrapper ones.
- `src/main/aiToolManager.js` — write `.frame/runtime/shell/init.*` through
  the existing `writeIfChanged`, called from `refreshLaunchAssets`.
- `src/main/ptyManager.js` — deliver setup at/after spawn, buffer output and
  input while pending, verify by marker, timeout + one retry, emit state.
- `src/shared/ipcChannels.js` — `TERMINAL_CONTEXT_STATE`.
- `src/renderer/agentDispatch.js` — export `startAgentInLane`; `_startAgentIn`
  awaits `laneContext.whenReady` instead of `setTimeout`.
- `src/renderer/multiTerminalUI.js` — initialise `laneContext`; the
  create-then-send path awaits `whenReady` instead of its 300 ms wait.
- `src/renderer/index.js` — `startAiSession` awaits `whenReady` instead of its
  1000 ms wait.
- `src/renderer/laneBoard.js` — the failure row on a lane card (statement,
  Start agent button, manual command) and its live update.
- `src/renderer/styles/components/lane-board.css` — styling for that row.

## Footprint

- src/main/shellSetup.js
- src/main/aiToolManager.js
- src/main/ptyManager.js
- src/shared/frameTemplates.js
- src/shared/ipcChannels.js
- src/renderer/laneContext.js
- src/renderer/agentDispatch.js
- src/renderer/multiTerminalUI.js
- src/renderer/index.js
- src/renderer/laneBoard.js
- src/renderer/styles/components/lane-board.css
- test/shellSetup.test.js
- test/frameTemplates.test.js

## Dependencies

None.

## Sequencing

1. **`src/main/shellSetup.js` — the pure delivery table.** Shell family from a
   shell path (zsh/bash/sh → `posix`, fish → `fish`, everything else → none),
   `deliveryFor(shellPath, platform, projectPath)` returning
   `flag` / `type` / `none`, marker minting per terminal and attempt, and the
   split that says what part of a buffered chunk survives the marker. No fs,
   no Electron — `launchEnv.js` is the shape to copy. Ships with
   `test/shellSetup.test.js`: family resolution including unknown shells, the
   `win32` and non-Frame-project gates, marker uniqueness across attempts, the
   post-marker remainder, and the invariant that the delivered line never
   contains the literal marker.
2. **`getShellInitTemplate` in `src/shared/frameTemplates.js`.** The POSIX and
   fish init files: move `.frame/bin` to the front of `PATH`, then one
   function per tool id delegating to `"$FRAME_BIN/<id>"` with a
   `command <id>` fallback. Ships with cases in
   `test/frameTemplates.test.js`: a function per declared tool, delegation to
   the wrapper path (never a bare re-exec of the tool name, which would
   recurse), `PATH` moved rather than duplicated, and both files generated for
   a tool list that includes a custom tool.
3. **Write the init files.** `aiToolManager` gains the writer, called from
   `refreshLaunchAssets` behind `launchEnv.supportsWrappers()` and the
   existing `.frame/` check, using `writeIfChanged` so a project open does not
   touch mtimes. After this step the files exist and a user can source one by
   hand; nothing sends them yet.
4. **Deliver setup at spawn.** `ptyManager.createTerminal` resolves the
   delivery shape, appends `args` for fish or writes the line for POSIX
   shells, and records per-terminal setup state. No suppression yet: setup is
   visible in the terminal, and the functions work. A resolution failure at
   any point leaves the spawn exactly as it is today.
5. **Make it invisible and verified.** Buffer output while pending (capped),
   queue input in `writeToTerminal`, resolve on the marker by dropping
   everything through it, flush and retry once on timeout, `failed` on the
   second, flush both buffers on every exit path. Emit
   `TERMINAL_CONTEXT_STATE` (new channel in `src/shared/ipcChannels.js`) for
   every resolution, including the immediate `unsupported`.
6. **`src/renderer/laneContext.js`.** State cache keyed by terminal id,
   cleared on `TERMINAL_DESTROYED`, `onChange` subscription in the style of
   `laneStatus`, and `whenReady(terminalId, fallbackMs)`. Initialised from
   `multiTerminalUI._setup()` beside `laneStatus.init` and
   `agentDispatch.init`. No consumer yet.
7. **The failure surface.** `agentDispatch` exports `startAgentInLane`;
   `laneBoard` renders the failure row on a `failed` lane — statement, Start
   agent button wired to that export, the manual one-liner — updating live
   through the existing per-card status refresh, with styling in
   `lane-board.css`. Cards for `installed` and `unsupported` lanes are
   unchanged.
8. **Retire the fixed delays.** `_startAgentIn`, `startAiSession` and
   `multiTerminalUI.sendCommand`'s create-then-send path await
   `laneContext.whenReady(id, <their current delay>)`. Each keeps its present
   number as the fallback, so an unsupported or failed lane behaves exactly as
   it does today and only a confirmed lane gets faster.
