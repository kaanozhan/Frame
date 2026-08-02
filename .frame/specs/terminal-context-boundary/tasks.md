# Tasks — Terminal Context Boundary — Frame's context follows Frame's terminal

- T01 · Add pure `src/main/launchEnv.js` with `frameBinDir`, idempotent `prependFrameBin` and `supportsWrappers`, touching no filesystem and no Electron API.
- T02 · Add `test/launchEnv.test.js` covering idempotent prepending, the platform separator, an untouched `PATH` on a non-wrapper platform, and no disk access.
- T03 · Rewrite `getWrapperTemplate` in `src/shared/frameTemplates.js` to strip its own directory from `PATH` before resolving the real binary, emit `promptFlag`/`settingsFlag` from the tool's injection record, and keep the bare-exec fallback when the preamble file is missing.
- T04 · Extend `test/frameTemplates.test.js` with wrapper cases: a wrapper named after its tool does not re-enter itself, declared flags appear and undeclared ones do not, `"$@"` survives, a missing preamble yields `exec <real> "$@"`.
- T05 · Make `aiToolManager` write the wrapper, preamble and settings file for every configured tool including flag-tools behind `supportsWrappers()`, and expose `refreshLaunchAssets(projectPath)` that rewrites only when content differs.
- T06 · Call `refreshLaunchAssets` from `frameProject`'s `CHECK_IS_FRAME_PROJECT` handler beside `gitSharing.ensureOnOpen` and `instructionDiscovery.refresh`, so an older Frame's wrapper cannot survive a project open.
- T07 · Return `./.frame/bin/<id>` from `getLaunchCommand` for every tool on POSIX with a fallback to the bare command plus flags elsewhere, refreshing preamble and settings immediately before the command is composed.
- T08 · Merge a `--settings <path>` pair found in `extraFlags` into the settings payload `aiToolManager` writes and drop the duplicate pair, so an autonomous implement launch passes the flag once and the spec-hint hooks survive.
- T09 · Compose the spawn env in `src/main/pty.js` and `src/main/ptyManager.js` through `launchEnv.prependFrameBin`, scoping the `PATH` entry to Frame's own child processes.
- T10 · Add a Settings row in `index.html` and `src/renderer/settingsModal.js` stating the terminal boundary in one sentence with the `command claude` escape hatch beside it.
- T11 · Add the matching boundary line to `getReferenceTemplate` so a new project's `.frame/docs/REFERENCE.md` carries the rule for the agent.
- T12 · Delete `src/templates/CLAUDE.md` and the dead `getCodexWrapperTemplate` and `getGenericWrapperTemplate`, then grep the repository for remaining references to root meta files or a `CLAUDE.md → AGENTS.md` symlink.
