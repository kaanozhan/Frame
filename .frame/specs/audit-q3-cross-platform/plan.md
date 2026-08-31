# Plan — Cross-platform correctness (Windows & Linux)

## Architecture

### Resolved plan-time decisions

- **Secret storage — keep the file-based approach** (asked, business). The
  spec's biggest open question had already drifted closed: `claudeUsageManager.js`
  now reads the macOS Keychain asynchronously (`execFile`, darwin-gated) and
  falls back to Claude Code's own `~/.claude/.credentials.json` on every OS,
  with an explicit degraded widget payload when neither source exists. User
  confirmed: no OS-keyring layer (`keytar`/`@napi-rs/keyring`), no new native
  dep in the rebuild matrix. This spec only verifies the shipped behavior.
- **CI matrix — descoped** (asked, business). User will build manually on a
  Windows machine and has no reliable access to separate Windows/Linux
  hardware; no per-PR or nightly 3-OS build/smoke pipeline is added. The
  existing `ci.yml` (node --test on ubuntu+macos) stays as-is.
- **Release pipeline — descoped** (asked, business). No automated publishing
  of Windows/Linux installers. Signing was already out of scope.
- **Build config — add it anyway** (asked, business). `dist:win` / `dist:linux`
  scripts and `build.win` (nsis) / `build.linux` (AppImage + deb) electron-builder
  targets are added so a manual `npm run dist:win` on the user's Windows machine
  works. Validation of the produced binaries is manual.
- **Linux watcher — chokidar, Linux-only** (asked, technical). A
  `watchRecursive()` abstraction in `fsSafe.js` keeps native
  `fs.watch(..., { recursive: true })` on darwin/win32 (zero macOS change,
  constraint C4) and uses `chokidar` only when `process.platform === 'linux'`,
  where Electron 28's Node 18.18 throws `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM`.
  chokidar v4 is pure JS (single dep: readdirp) so it does not grow the native
  rebuild matrix. Rejected: stat-polling (latency + CPU on big repos) and
  manual per-subdir watchers (unbounded/fragile for the whole worktree).
- ~~**Codex wrapper — in-process injection, retire the bash script**~~
  **(asked, technical — REVERSED and DONE by `codex-parity`, 2026-08-31.)**
  The wrapper is gone, and this plan's half of that is already shipped: the
  `command: './.frame/bin/codex'` entry is now `command: 'codex'`,
  `getCodexWrapperTemplate` and the wrapper generation are deleted, and
  existing `.frame/bin/codex` files are left on disk unused — exactly as this
  decision intended.
  
  What was reversed is only the **replacement**. This decision put the
  AGENTS.md prompt back at launch time, composed in-process as
  `codex "<prompt>"`. `codex-parity` delivers the rules through a
  `SessionStart` hook instead, on the same grounds `non-invasive-overlay`
  used against launch-time injection for Claude Code: a prompt saying "go read
  AGENTS.md" leaves compliance to the agent, where a hook does not. The
  Windows rationale survives either way — a node hook needs no PowerShell port
  — and was the only argument this decision rested on that the hook does not
  also satisfy. Verified live: a Codex session in a project with no wrapper
  answered a passphrase that exists only inside `.frame/docs/REFERENCE.md`.
  
  **For whoever implements this spec:** step 5 below is done except for its
  Windows-specific parts; do not re-add `GET_AI_TOOL_START_COMMAND` or the
  in-process prompt composition. Three paths are consequently **over-declared**
  in `## Footprint` — `src/shared/ipcChannels.js`,
  `src/renderer/aiToolSelector.js` and `src/renderer/agentDispatch.js` were
  listed only to carry that channel. They are left in deliberately: an
  over-wide footprint costs a false collision, an under-wide one hides a real
  one. Narrow it when this spec is picked up and its remaining scope is
  known.
- **Overview LOC/file counts — in-JS traversal** (silent). Replace
  `find | wc` with an async `fs.promises.readdir(..., { recursive: true })`
  walk (available since Node 18.17, so safe on Electron 28) that filters
  `*.js` and sums newline counts. Works on all OSes and non-git layouts;
  same async, non-blocking shape as today.
- **Blame summary — keep `git blame --line-porcelain`, parse in JS** (silent).
  The git call itself is portable; only the `2>/dev/null | grep | sort |
  uniq -c | sort -rn | head -5` tail is POSIX. JS aggregates `author ` lines
  and takes the top 5. Same 5s timeout and cwd.
- **`escapePathForShell` — extract to `src/shared/shellEscape.js`** (silent).
  The function moves out of `terminalManager.js` into a shared module taking
  an explicit platform parameter, fixing the Windows trailing-backslash bug
  (double every backslash run that precedes a `"` or the closing quote;
  escape quotes by backslash-doubling per Windows argv rules). Shared modules
  are the repo's existing pattern (`src/shared/frameTemplates.js`,
  `ipcChannels.js`) and it makes the per-OS behavior unit-testable under
  `node --test` (renderer modules can't load there — they require electron).
- **Symlink fallback — widen error codes + re-sync copies** (silent).
  `createSymlinkSafe` treats `EACCES` and `ENOSYS` like `EPERM`/`EPROTO`
  (SMB/exFAT/hardened-Windows cases the spec cites), and a small
  `resyncCopiedLink()` pass at project open re-copies `AGENTS.md` →
  `CLAUDE.md` when the link is a plain file whose content drifted — the
  cheapest honest answer to "copies silently diverge" without a watcher.
- **Shell defaults** (silent). Unix default shell becomes
  `$SHELL || (darwin ? '/bin/zsh' : '/bin/bash')`; the Unix shell list is
  filtered by `fs.existsSync`; Windows Git Bash detection adds
  `%LOCALAPPDATA%\Programs\Git` and a `where git.exe` → `../../bin/bash.exe`
  derivation to cover winget/scoop/user installs.
- **win32 availability check** (silent). For path-like commands on win32,
  `fs.constants.X_OK` is a no-op, so the check becomes: file exists (`F_OK`)
  **and** has a Windows-executable extension (from `PATHEXT`, default
  `.exe/.cmd/.bat/.ps1`). Unix keeps `X_OK`. Extensionless files (like a bash
  wrapper) are correctly reported unavailable on Windows.
- **node-pty rebuild** (silent). Already handled by the existing
  `postinstall: electron-rebuild` — a manual `npm install` + `npm run dist:win`
  on real Windows rebuilds against Electron's ABI. No extra tooling.

### macOS regression guard (C4 — hard requirement)

Nothing in this spec may change observable behavior on macOS. Steps are
split by macOS exposure:

- **Zero macOS code-path change (platform-gated):** watcher split (darwin
  keeps the exact `safeWatch(root, { recursive: true })` call), win32 probe
  fix (`X_OK` untouched on Unix), shell defaults (darwin keeps
  `$SHELL || /bin/zsh`; Git Bash logic is inside the win32 branch),
  packaging config (additive only), secrets step (verification only).
- **Shared code paths that also run on macOS — each with a guard:**
  1. ~~*Codex launch (step 5)*~~ — no longer applies. `codex-parity` retired
     the wrapper and delivers the rules through a `SessionStart` hook, so
     there is no launch-time prompt left to guard. Verified live on macOS
     there rather than here.
  2. *Overview stats (step 2):* guard = compare in-JS LOC/file/blame output
     against the current `find|wc`/pipeline output on this repo on macOS —
     numbers must match before the exec calls are deleted.
  3. *Shell escaping (step 3):* the POSIX branch moves verbatim (same
     regex, character-for-character); guard = `test/shellEscape.test.js`
     locks current macOS outputs as golden cases.
- Every step lands separately (Sequencing is already one-step-shippable),
  so any macOS regression bisects to a single small diff.

### Key components

- **`fsSafe.watchRecursive(target, opts, listener, onError)`** — the one new
  abstraction. On darwin/win32 it delegates to the existing `safeWatch` with
  `{ recursive: true }`; on Linux it creates a `chokidar` watcher
  (`ignoreInitial: true`, `ignored` from `opts`) and adapts chokidar's
  `(event, absolutePath)` callbacks to the `(eventType, filename)` shape the
  three call sites already expect, with `filename` made relative to `target`
  (this is what `gitStatusManager`'s `isGitInternalPath(filename)` filter
  needs). Returned object exposes `close()` like an `FSWatcher`. Call sites:
  `specManager.startWatching` (specs root), `gitStatusManager.startWatching`
  (worktree + `.git` dir). The false "Node ≥ 20.5" comment block in
  `specManager.js:745-747` is corrected as part of the migration.
- ~~**Start-command resolution moves to the main process.**~~ **Dropped —
  see the reversal above.** This paragraph existed to carry the AGENTS.md
  prompt to a Codex launch; `codex-parity` delivers those rules through a
  `SessionStart` hook, so there is no prompt to compose and no reason for
  `GET_AI_TOOL_START_COMMAND`, the async `aiToolSelector.getStartCommand()`,
  or changes at the renderer's two launch sites. Nothing else in this spec
  needed them.
- **Overview stats** stay inside `overviewManager.js` — the `exec(find…)`
  callbacks at `:218`/`:242` become an async walk helper; the blame pipeline
  at `:389` becomes `execFile('git', ['blame', '--line-porcelain', '--', file])`
  plus a small pure aggregation function.

## Files

- `package.json` — **Modified**: add `chokidar` dep; add `dist:win` /
  `dist:linux` scripts; add `build.win` (nsis) / `build.linux`
  (AppImage, deb) targets.
- `src/main/fsSafe.js` — **Modified**: add `watchRecursive()` (native
  recursive on darwin/win32, chokidar on linux) + export.
- `src/main/specManager.js` — **Modified**: specs-root watcher →
  `fsSafe.watchRecursive`; fix the false Node-version comment.
- `src/main/gitStatusManager.js` — **Modified**: worktree + `.git` watchers →
  `fsSafe.watchRecursive`.
- `src/main/overviewManager.js` — **Modified**: in-JS LOC/file counts;
  JS-parsed `git blame --line-porcelain` top-authors summary.
- `src/main/aiToolManager.js` — ~~**Modified**: codex `command` → `'codex'`~~
  **done by `codex-parity`**
  (drop wrapper + its path-like fallback special-case at `:347-358`);
  `getStartCommand(projectPath)` with AGENTS.md prompt injection + IPC
  handler; win32 path-like availability = `F_OK` + `PATHEXT` extension check.
- `src/main/frameProject.js` — ~~**Modified**: stop writing `.frame/bin/codex`~~
  **done by `codex-parity`**
  at init (`:344-348`); `createSymlinkSafe` handles `EACCES`/`ENOSYS`;
  `resyncCopiedLink()` re-copy pass at project open.
- `src/main/ptyManager.js` — **Modified**: Linux default shell `/bin/bash`;
  existence-filtered Unix shell list; broader Git Bash detection.
- `src/shared/frameTemplates.js` — ~~**Modified**: remove
  `getCodexWrapperTemplate` + its export.~~ **done by `codex-parity`**
- ~~`src/shared/ipcChannels.js` — **Modified**: add `GET_AI_TOOL_START_COMMAND`.~~
  **Not needed**: the hook replaced the launch-time prompt this channel existed to carry.
- `src/shared/shellEscape.js` — **New**: `escapePathForShell(path, platform)`
  with the Windows trailing-backslash/argv fix; used by the renderer.
- `src/renderer/terminalManager.js` — **Modified**: drop the local
  `escapePathForShell` (`:74-83`), import from `src/shared/shellEscape.js`.
- ~~`src/renderer/aiToolSelector.js` — **Modified**: `getStartCommand()`
  resolves via the new IPC channel (async).~~ **Dropped with the channel.**
- ~~`src/renderer/agentDispatch.js` — **Modified**: await the async start
  command at the two launch points.~~ **Dropped with the channel.**
- `src/renderer/index.js` — **Modified**: await the async start command at
  the new-terminal launch point (`:724`).
- `test/shellEscape.test.js` — **New**: per-platform escaping cases incl.
  trailing backslash, embedded quotes, plain paths.
- `test/watchRecursive.test.js` — **New**: API-shape + native-path behavior
  of `fsSafe.watchRecursive` on the host OS (create/close, event delivery,
  relative filename normalization).

## Footprint

- package.json
- src/main/fsSafe.js
- src/main/specManager.js
- src/main/gitStatusManager.js
- src/main/overviewManager.js
- src/main/aiToolManager.js
- src/main/frameProject.js
- src/main/ptyManager.js
- src/shared/frameTemplates.js
- src/shared/ipcChannels.js
- src/shared/shellEscape.js
- src/renderer/terminalManager.js
- src/renderer/aiToolSelector.js
- src/renderer/agentDispatch.js
- src/renderer/index.js
- test/shellEscape.test.js
- test/watchRecursive.test.js

## Dependencies

- `chokidar` (^4) — Linux-only recursive file watching under Electron 28 /
  Node 18.18, where native recursive `fs.watch` throws; pure JS, so it adds
  nothing to the native rebuild matrix.

## Sequencing

1. **Watcher abstraction.** Add `chokidar` to `package.json`; implement
   `fsSafe.watchRecursive()` with the darwin/win32-native vs linux-chokidar
   split and relative-filename normalization; add
   `test/watchRecursive.test.js`. Migrate `specManager.startWatching` and
   both `gitStatusManager` watchers to it; correct the stale
   "Node ≥ 20.5" comment. *(Owns: G1, G3, C1, C4, S1.)*
2. **Overview stats in-JS.** Replace the two `find | wc` execs in
   `overviewManager.js` with the async readdir-recursive walk; replace the
   blame pipeline with `execFile` + JS aggregation. *(Owns: G4, S4.)*
3. **Shell escaping.** Create `src/shared/shellEscape.js` with the fixed
   Windows quoting (backslash-run doubling before quotes/closing quote) and
   the existing POSIX branch; switch `terminalManager.js` to it; add
   `test/shellEscape.test.js`. *(Owns: G6, S5-escape.)*
4. **Symlink fallback.** Extend `createSymlinkSafe` to `EACCES`/`ENOSYS`;
   add `resyncCopiedLink()` and call it at project open so copied
   `CLAUDE.md` files are re-synced from `AGENTS.md`. *(Owns: S5-symlink.)*
5. ~~**In-process codex injection.**~~ **Superseded — see the reversal in
   Architecture.** `codex-parity` retired the wrapper on 2026-08-31: codex
   config is `command: 'codex'`, the wrapper generation and
   `getCodexWrapperTemplate` are deleted, and the rules reach a Codex session
   through a `SessionStart` hook rather than a launch-time prompt. Do **not**
   add `GET_AI_TOOL_START_COMMAND` or the in-process composition — there is no
   prompt left to compose. What remains of this step for this spec is only the
   win32 side, which step 6 already owns. *(Owned G5, S3-wrapper — now met.)*
6. **win32 availability check.** In `aiToolManager.isCommandAvailable`,
   path-like commands on win32 use `F_OK` + `PATHEXT`-extension check
   instead of `X_OK`. *(Owns: S3-probe.)*
7. **Shell defaults.** `ptyManager.getDefaultShell` → `$SHELL ||`
   platform-appropriate default (`/bin/bash` on Linux); filter the Unix
   shell list by existence; extend Git Bash probing
   (`%LOCALAPPDATA%\Programs\Git`, `where git.exe` derivation). *(Owns: G1-shells.)*
8. **Packaging config.** Add `dist:win` / `dist:linux` scripts and
   `build.win` / `build.linux` electron-builder targets to `package.json`.
   Validation is manual on the user's Windows machine (`npm install` runs
   the existing `postinstall: electron-rebuild` for node-pty). *(Owns:
   G7-reduced, C2, S6-reduced — CI and publishing descoped by decision.)*
9. **Secret-storage verification.** No behavior change (decision: keep the
   shipped file-based fallback). Re-verify on the final branch that
   `getOAuthToken()` order is keychain(darwin) → credentials file → explicit
   degraded payload, and that no `security`/`2>/dev/null` shell-out remains
   outside the darwin gate. *(Owns: G2, C3, S2.)*
