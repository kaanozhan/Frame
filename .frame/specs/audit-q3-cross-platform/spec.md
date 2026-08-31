# Cross-platform correctness (Windows & Linux)

> Audit-sourced findings spec (Q3 2026 deep-dive review). Captured, not yet planned — recorded via the `audit-q3` study.

## Problem

Frame is developed and shipped macOS-first (`package.json` only defines `dist`,
`dist:mac`, `dist:mac:unsigned` and a `build.mac` DMG target — no Windows or
Linux target exists, yet the site advertises them). Under a Windows/Linux lens
the app has correctness bugs that range from *silent feature death* to *shipped
binaries that cannot exist*. Grouped by platform:

### Linux (highest severity — silent feature death)

- **Recursive `fs.watch` throws on Linux under Electron 28.** Electron 28 bundles
  Node **18.18**, and recursive `fs.watch` was only added for Linux in Node
  **20.5**. The code assumes otherwise:
  - `src/main/specManager.js:660-662` comment literally claims "Supported on
    macOS, Windows, and Linux (Node ≥ 20.5). Electron 28 ships with a Node
    version that supports this" — this is **false for Electron 28 / Node 18**.
  - `src/main/specManager.js:676` `fs.watch(root, { recursive: true }, …)` throws
    `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM` on Linux; caught at line 681-683 and
    swallowed. Result: the **Specs panel never live-updates on Linux** — new
    specs / phase transitions don't appear until manual reload.
  - `src/main/gitStatusManager.js:74-84` (worktree watcher) and `:94-98` (.git
    watcher) both pass `{ recursive: true }` and swallow the throw at :82-84 /
    :100-102 → **git status decorations and auto-refresh silently stop working
    on Linux** (no gutter/file-tree decorations after edits/commits).
  - Same pattern warned about in prior audits; both managers degrade to "no
    watcher" rather than falling back to a poller or `chokidar`.

### Windows

- **Secret storage is macOS-only** (also breaks Linux). `src/main/claudeUsageManager.js:28-55`
  `getOAuthToken()` shells out to the macOS Keychain via
  `execSync('security find-generic-password -s "Claude Code-credentials" -w …')`.
  On Windows/Linux `security` does not exist → `execSync` throws → caught at
  :50-54 → always returns `null` → **the Claude usage widget is permanently
  "No OAuth token found" on Windows and Linux.** No `wincred` / `libsecret` /
  Credential-Manager equivalent, and the `2>/dev/null` suffix is itself a POSIX
  shell redirection that isn't valid in `cmd`.

- **`.frame/bin/codex` wrapper is a bash script** (`#!/usr/bin/env bash`, injects
  `AGENTS.md`) that cannot execute in `cmd.exe`/PowerShell. Worse, the
  availability pre-flight in `src/main/aiToolManager.js:212-221` uses
  `fs.accessSync(target, fs.constants.X_OK)` — on **win32 `X_OK` is a no-op**
  (the execute bit is not modeled), so a path-like wrapper is reported
  "available" and then fails when the shell tries to run a bash script. Fallback
  probing at :291-296 doesn't rescue the wrapper-launch case.

- **`escapePathForShell` trailing-backslash bug.** `src/renderer/terminalManager.js:72-81`:
  on Windows a path ending in `\` that gets wrapped in double quotes produces
  `"C:\dir\"` — the trailing `\"` escapes the closing quote in Windows argument
  parsing, corrupting the following token. Only quotes are escaped; a terminal
  `\` before the closing `"` is not doubled.

- **Symlink → copy fallback for CLAUDE.md/GEMINI.md is fragile.**
  `src/main/frameProject.js:84-98`: on `EPERM`/`EPROTO` (Windows without
  Developer Mode, or SMB/exFAT) it `copyFileSync(targetPath, linkPath)`. It only
  handles `EPERM`/`EPROTO` (SMB/exFAT frequently surface `EACCES`, which falls to
  the `else` branch and just errors), and copying instead of linking means the
  `CLAUDE.md`/`AGENTS.md` pair silently drift out of sync after the first edit.

### Shared / Unix-only shell-outs (break on Windows, some on any non-dev layout)

- **`find | wc` line/file counting is POSIX-only.** `src/main/overviewManager.js:218`
  `exec('find "…" -name "*.js" -exec cat {} \\; | wc -l …')` and `:242`
  `exec('find … | wc -l')` have no `find`/`wc` on stock Windows → both resolve to
  `0`. The Overview dashboard silently shows **0 lines of code / 0 files on
  Windows**.

- **`git blame` uses a POSIX pipeline.** `src/main/overviewManager.js:389`
  `git blame … 2>/dev/null | grep "^author " | sort | uniq -c | sort -rn | head -5`
  relies on `2>/dev/null`, `grep`, `sort`, `uniq`, `head` — none present in
  `cmd`/PowerShell → blame summary empty on Windows. (Other git calls — `git log`,
  `git rev-list`, `git branch --show-current`, `git shortlog` — are portable.)

- **`ps -o tpgid=` foreground-command detection is Unix-only** (correctly
  guarded). `src/main/ptyManager.js:34-51` returns `null` on win32 and
  `src/renderer/laneStatus.js:175` sets `FOREGROUND_RELIABLE = platform !== 'win32'`
  — so on Windows the orchestrator's "what is this lane running" is degraded to
  the bare process name (acceptable, but a parity gap for lane idle/soft-done
  heuristics).

- **Shell discovery assumptions.** `src/main/ptyManager.js:53-64` default shell
  is `pwsh.exe`/`powershell.exe` on Windows and `$SHELL || /bin/zsh` on Unix —
  `/bin/zsh` is a poor Linux default (many distros only have `/bin/bash`).
  `getAvailableShells` (:70-147) hard-codes `/bin/zsh|bash|sh` on Unix; fine, but
  Windows Git Bash detection only probes two `Program Files` paths (:90-93) and
  misses winget/scoop/user installs.

- **`node-pty` is a native module** (`package.json:42`, `node-pty ^1.0.0`) that
  must be rebuilt per-OS/per-arch against Electron's ABI. With no
  `dist:win`/`dist:linux` there is no CI producing (or even proving buildable)
  Windows/Linux artifacts, so the native rebuild has never been validated on
  those targets.

### Lower severity / cosmetic

- **Menu accelerators are consistent** (`src/main/menu.js` uses `CmdOrCtrl+…`
  and guards the app menu with `process.platform === 'darwin'` at :70) and the
  renderer's `src/renderer/platform.js` maps symbols per-OS — these are correct.
  Noted only to scope them *out* of the bug list.
- No `Notification` / `Tray` usage found, so no tray/notification portability
  work is needed at this time.

## Goal

Reach **functional parity on Windows and Linux** with macOS: replace macOS-only
or POSIX-only mechanisms with per-OS abstractions, prove the app actually builds
and runs on all three OSes in CI, and **ship Windows + Linux binaries** to match
what the site advertises. Concretely: a cross-platform secret-storage layer, a
watcher abstraction that works on Node 18/Linux, in-process (JS) replacements for
`find|wc`/`git blame` pipelines, a Windows-runnable tool wrapper, and correct
per-OS path/shell escaping.

## Constraints

- **Electron 28 → Node 18.18**: recursive `fs.watch` is unavailable on Linux;
  any watcher fix must not assume Node ≥ 20.5. Either bump Electron (large,
  separate) or add a Linux fallback (poller / `chokidar` / per-subdir watchers).
- **Native modules**: `node-pty` must be rebuilt against each target's Electron
  ABI (`electron-rebuild`/`@electron/rebuild`); CI runners must build on real
  Windows and Linux images, not cross-compile.
- **Keychain differences**: macOS `security` CLI, Windows Credential Manager
  (`wincred`), Linux Secret Service / libsecret (may be absent on headless/CI).
  A cross-platform lib (e.g. `keytar`/`@napi-rs/keyring`/Electron `safeStorage`)
  is itself native and adds to the rebuild matrix; needs a plaintext/degraded
  fallback path.
- Must not regress the current macOS behavior, which several call sites depend
  on (usage widget, interactive-login-shell CLI detection).

## Success criteria

- **Watchers work on Linux**: spec panel live-updates and git-status decorations
  refresh on Linux under the shipped Electron/Node version (recursive watch
  replaced by a supported mechanism or documented poller fallback).
- **Secret storage is cross-platform**: the Claude usage token is read on macOS,
  Windows, and Linux (or the widget degrades explicitly, not silently, where no
  keyring exists) — no `security`/`2>/dev/null` shell-out on non-macOS.
- **AI-tool wrapper works on Windows**: `codex`-style wrappers launch in
  `cmd`/PowerShell (a `.cmd`/`.ps1` companion or in-process injection), and the
  availability check no longer trusts `X_OK` on win32.
- **Overview stats are correct on Windows**: LOC + file counts and blame summary
  computed without `find`/`wc`/`grep`/`sort` (in-JS traversal or portable git).
- **Path/shell handling verified per-OS**: `escapePathForShell` handles trailing
  backslashes on Windows; symlink-vs-copy fallback covers `EACCES` and keeps the
  AGENTS/CLAUDE pair in sync.
- **Win + Linux builds produced in CI**: `dist:win` (nsis/portable) and
  `dist:linux` (AppImage/deb) scripts + `build.win`/`build.linux` targets exist,
  and a CI matrix (macOS/Windows/Linux) builds, rebuilds `node-pty`, and runs a
  smoke test on each.

## Out of scope

- Mobile and web/browser mode (tracked separately).
- Deep shell integrations beyond launch/escape correctness (e.g. Nushell/Fish
  first-class UX, WSL passthrough polish).
- Bumping Electron/Node as a feature in its own right (only considered as one
  option for the watcher fix).
- Code signing / notarization for Windows & Linux distribution (packaging policy,
  separate from correctness).

## Open questions for /spec.plan

- Which secret-storage approach is cross-platform *and* survives the native
  rebuild matrix: Electron `safeStorage` (no external native dep, but ties
  encryption to the OS user), `keytar`/`@napi-rs/keyring`, or reading the CLI's
  own credential file directly per-OS?
- Watcher fix: bump Electron to a Node ≥ 20.5 base, or add a Linux-specific
  fallback (chokidar vs. `fs.watchFile` poller vs. manual per-subdirectory
  non-recursive watchers)? What debounce/perf trade-off is acceptable on large
  repos?
- Test/CI matrix approach: full GitHub Actions matrix (mac/win/linux) building +
  smoke-testing every PR, or nightly? How to run an Electron app headlessly on CI
  Windows/Linux (xvfb, `--headless`) for a launch smoke test?
- For the codex-style wrapper: ship parallel `.cmd`/`.ps1` wrappers, or move the
  AGENTS.md injection in-process (spawn the real CLI with the prompt) and retire
  the shell script entirely?
- Windows/Linux without a system keyring (CI, headless, minimal distros): what is
  the acceptable degraded behavior for the usage widget?
