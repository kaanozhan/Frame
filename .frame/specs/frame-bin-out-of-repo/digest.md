---
keywords: .frame/bin, git tracking, gitignore, sharing mode, repo footprint, file classes, FRAME_TRACKED_DERIVED, parser scripts
related: non-invasive-overlay, migration-consent-scope, settings-by-scope
supersedes: non-invasive-overlay
---
`.frame/bin/` is no longer tracked by git. `'bin/'` moved from
`FRAME_FILE_CLASSES.derived` to `.runtime` and `FRAME_TRACKED_DERIVED` shrank to
`['STRUCTURE.json']`, so the managed `.frame/.gitignore` block now covers Frame's
own scripts. Nothing in the generator changed — it already builds the block as
`runtime ∪ (derived − FRAME_TRACKED_DERIVED)`.

This reverses T15 of `non-invasive-overlay`, restoring the class D6 of that spec
originally assigned. T15's rationales lapsed: no released build ships the
tracking (`git tag --contains a8c1c8c` empty, v2.6.0 predates it), the
clone-without-Frame user does not exist while Frame ships only as the IDE, and
both worktree paths already fall back to an absolute `bin/` path. Rejected:
keeping the tracking and adding a migration (nothing to migrate), and moving
`STRUCTURE.json` into `data` to delete the list (out of scope).

Result: a fresh `repo`-mode install commits 11 files / 24.9 KB instead of 31 /
197.6 KB; `local` mode is byte-identical; the linked-worktree `--git-common-dir`
fallback is now the normal path and was verified end to end.

Rules established: `copyParserScripts` still writes every script into every
checkout on open — only git's view changed. Frame's own repo keeps its 24
`.frame/bin/` files tracked deliberately, so a **new** script added there needs
`git add -f`. The Git sharing setting governs the project's Frame context, not
the `.frame/` folder.

Chain: spec.md → plan.md → tasks.md → outcome.md
