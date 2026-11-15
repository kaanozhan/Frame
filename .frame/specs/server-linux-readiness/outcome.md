
## T01 — Hint hooks find Node on a server

Added `hintCommand(script, mode)` to `src/shared/frameTemplates.js`, exported for tests. All six Claude Code hint hooks in `SPEC_HINT_HOOKS` now use it: `node` on PATH, else `$FRAME_NODE` with `ELECTRON_RUN_AS_NODE=1`, else exit 0, and still exit 0 without `.frame/bin/<script>`. The six previous `exec node` strings were appended to `LEGACY_SPEC_HINT_COMMANDS`, so `frameProject.installSpecHintHook`'s existing upgrade replaces them on project open; `frameProject.js` itself is unchanged, as planned. Codex hooks are untouched. Tests in `test/hintHooks.test.js` run each command through a real `/bin/sh` with a PATH that has only `sh` (plus `node` in one case). Deviation: `test/frameProjectInit.test.js`, which is not in the plan, pinned the previous command shape by regex; it now pins the new shape and keeps its backreference (the file the guard tests is the file it execs). Running that file on its own fails 16 tests on the previous commit too; it passes in `npm test`.

_Captured: 2026-11-15 · 3 file change(s)_

---
