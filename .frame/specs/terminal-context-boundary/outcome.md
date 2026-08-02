# Outcome — Terminal Context Boundary

## T01 — Add pure `src/main/launchEnv.js`

Added `src/main/launchEnv.js` with `supportsWrappers(platform)`, `frameBinDir(projectPath)` and `prependFrameBin(pathValue, projectPath, platform)`; it requires only `node:path` and `frameConstants`. `prependFrameBin` removes a later copy of the bin directory rather than returning early when it is present anywhere — an entry that is not *first* is useless, since a real `claude` earlier on `PATH` would win. Platform is a defaulted parameter so the non-POSIX branch is testable without stubbing `process.platform`. No consumer yet; T09 wires it into the PTY spawn env.

_Captured: 2026-08-01 · 1 file change_

---
## T02 — Add `test/launchEnv.test.js`

Added 12 cases: `frameBinDir` with and without a project, the POSIX gate, first-position prepending, idempotence, move-not-duplicate when the entry sits behind a real CLI, an untouched `win32` value, an absent `PATH`, and empty-segment handling. Purity is asserted twice — a source scan for forbidden requires, plus a reload through a poisoned `Module._load` that throws on `fs`/`electron` and then exercises `prependFrameBin`, so a require added later fails rather than slipping past a string match.

_Captured: 2026-08-01 · 1 file change_

---

## T03 — Recursion-safe wrapper that emits its tool's flags

Rewrote `getWrapperTemplate`: it resolves the real CLI at run time via `PATH="$(path_without_self)" command -v <tool>` and execs `"$REAL_CLI"`, builds a `frame_args` array from `promptFlag`/`settingsFlag` (settings only when that file exists), keeps the bare-exec fallback, and exits 127 with a named message when the CLI is absent. Run-time resolution over a write-time absolute path so a version-manager switch is picked up at once. Deviation from plan.md: the three existing wrapper assertions in `test/frameTemplates.test.js` encoded the old `exec codex …` shape and were updated here rather than in T04, since a task that leaves the suite red is not finished — T04 still adds the new cases. Verified end to end in a sandbox: no self-exec with the wrapper first on `PATH`, `--resume`/`-p` pass through, missing preamble and missing settings both degrade correctly.

_Captured: 2026-08-01 · 2 file changes_

---

## T04 — Wrapper cases in `test/frameTemplates.test.js`

Added six cases: declared-vs-undeclared flag emission, an assertion that the script never `exec`s the CLI by name, and four executed cases that stage a wrapper and a fake real CLI in a temp dir and run them with `.frame/bin` first on `PATH` — no self-exec, argument passthrough, missing-preamble fallback, absent settings file. The executed ones exist because success criterion 3 asks for a test that would loop if the wrapper re-entered itself; they run under a 10s `execFileSync` timeout so a regression fails rather than wedges the suite, and skip off-POSIX.

_Captured: 2026-08-01 · 1 file change_

---

## T05 — Launch assets for every tool, refreshable

`aiToolManager` gained `writeIfChanged`, `prepareLaunchAssets(projectPath, tool)` and `refreshLaunchAssets(projectPath)`: every configured tool — Claude and custom tools included — now gets a wrapper behind `launchEnv.supportsWrappers()`, a preamble file, and a settings file when it declares `settingsFlag`. Deviation from plan.md: preambles are per tool (`.frame/runtime/preamble-<id>.txt`) rather than one shared `preamble.txt`, because the text differs by tool and a hand-typed launch has no dispatch to rewrite a shared file first; settings follow the same rule and `claude-settings.json` is unchanged in name. Verified against a temp project: three wrappers at 0755, three preambles, and a second refresh rewrites nothing.

_Captured: 2026-08-01 · 1 file change_

---

## T06 — Refresh launch assets on project open

Called `aiToolManager.refreshLaunchAssets(projectPath)` from `CHECK_IS_FRAME_PROJECT`, beside `gitSharing.ensureOnOpen` and `instructionDiscovery.refresh`, gated on `isFrame` and non-fatal. Also replaced init's own codex/gemini wrapper loop with the same call — it was a second generator that knew nothing about injection records, so an initialized project and a re-opened one would have carried different wrappers until the first open. Lazy `require` at both sites, matching the existing `installSpecHintHook` pattern that keeps init's module graph flat.

_Captured: 2026-08-01 · 1 file change_

---

## T07 — Dispatch through the wrapper

`getLaunchCommand` returns `./.frame/bin/<id>` and contributes no flags of its own on POSIX, falling back to the bare command plus inline flags elsewhere; `wrapperLaunchCommand()` is the single place that choice is made and falls back the moment the file is absent. Beyond the task as written, `CHECK_AI_TOOL_AVAILABLE` had to move to the same helper — it, not `getLaunchCommand`, composes the line `agentDispatch` types — and `claude` gained `fallbackCommand: 'claude'` so the probe still asks whether the real CLI is installed rather than stopping at the wrapper it will now always find. Verified: all three tools compose `./.frame/bin/<id>` with a dispatch's extra flags appended.

_Captured: 2026-08-01 · 1 file change_

---

## T08 — One `--settings`

`getLaunchCommand` now pulls `--settings <value>` pairs out of `extraFlags` and merges each payload into the file it writes for the tool (`takeSettingsFlags`, `mergeSettings`, `readSettingsSource` — path or inline JSON), leaving `--permission-mode auto` to ride along. An autonomous implement launch therefore passes the flag once and keeps the spec-hint hooks. Merging at the write point keeps hooks Claude-only for free, since only a tool declaring `settingsFlag` reaches it; arrays concatenate so two hook lists are both kept; an unreadable payload merges nothing and logs rather than failing the launch. A later launch without extra flags rewrites the file back to hooks-only, so permissions never outlive their run.

_Captured: 2026-08-01 · 1 file change_

---

## T09 — `PATH` injection into Frame's terminals

Composed the spawn env in `src/main/pty.js` and `src/main/ptyManager.js` through `launchEnv.prependFrameBin`, scoped to the child process. Checked against a real `zsh -i -l`, since rc files run after the env is set: on this machine nvm's rc prepends its own bin so `.frame/bin` no longer leads, yet `claude` and `codex` still resolve to the wrapper because no rc-prepended directory holds those names. That is the honest limit of an env-scoped entry. Followup: an opt-in shell integration (a `ZDOTDIR` pointing inside `.frame/`) is the only way to win the ordering outright, and it deserves its own spec.

_Captured: 2026-08-01 · 2 file changes_

---

## T10 — The boundary, stated, with a working escape

Added a "Terminal" section to Settings stating the rule and the escape hatch, hidden off-POSIX by `settingsModal.js` because the statement is false where Frame writes no wrappers. Divergence from plan.md: the planned escape `command claude` does not work — `command` bypasses functions and aliases, not a `PATH` lookup, so it resolves to the wrapper as well (verified by running it). The wrapper now honours `FRAME_NO_WRAP=1` and execs the real CLI bare; that is what Settings documents, and a new executed test covers it.

_Captured: 2026-08-01 · 4 file changes_

---

## T11 — The boundary in `REFERENCE.md`

Added a "Where Frame's context reaches" section to `getReferenceTemplate`, stating the rule for the agent and naming `FRAME_NO_WRAP=1` as the way out. Written for the reader who arrives with no context: it says plainly that a session which knew nothing about Frame is on the far side of a boundary rather than looking at a bug. Note against plan.md's stated limit — the same template backs the global layer (`globalLayer` calls it with `'Frame'`), so this reaches existing installs when the global layer is next written, not only new projects.

_Captured: 2026-08-01 · 1 file change_

---

## T12 — Delete what the overlay left behind

Deleted `src/templates/CLAUDE.md`, `getCodexWrapperTemplate` and `getGenericWrapperTemplate` plus their stale header comments, and removed the project `AGENTS.md` template's closing note promising a `CLAUDE.md → AGENTS.md` symlink — the last shipped template describing the pre-overlay layout, which survived because the existing negative assertion covered only the global copy. Added a test over the project copy too. Also untracked this repository's own `.frame/bin/codex` (the 29-April wrapper the spec named) and regenerated all three wrappers: `.frame/.gitignore` already declares `bin/` machine-local, so a tracked wrapper was both stale and against the repo's own rule.

_Captured: 2026-08-01 · 4 file changes_

---
