# Tasks — Frame's own scripts stay out of the user's repo

- T01 · Move `'bin/'` out of `FRAME_FILE_CLASSES.derived` into `FRAME_FILE_CLASSES.runtime` in `src/shared/frameConstants.js` and reduce `FRAME_TRACKED_DERIVED` to `['STRUCTURE.json']`.
- T02 · Rewrite the tracked-derived comment in `src/shared/frameConstants.js` to name T15 of `non-invasive-overlay` as reversed and record why both of its rationales lapsed — no released build ships the tracking, the "clone without Frame" user does not exist while Frame ships only as the IDE, and both worktree paths already assume `bin/` may be absent.
- T03 · Invert the `bin/` assertion in `test/gitSharing.test.js` to `assert.match(content, /^bin\/$/m)`, rewrite its message to name Frame's machinery as machine-local, rename the test to match, and leave the `STRUCTURE.json` assertion untouched.
- T04 · Update the doc comment above `getFrameGitignoreBlock` in `src/shared/frameTemplates.js` so its parenthetical names `STRUCTURE.json` alone instead of "STRUCTURE.json and bin/"; leave the function body unchanged.
- T05 · Replace the Git sharing row's description paragraph in `index.html` with the wording that names this project's Frame context rather than the `.frame/` folder, keeping the "never edits your tracked `.gitignore`, never untracks files" sentence.
- T06 · Regenerate Frame's own `.frame/.gitignore` by opening this project in Frame, confirm `bin/` is inside the managed markers while `STRUCTURE.json` is not, that the 24 tracked `.frame/bin/` files stay tracked and still report edits in `git status`, then commit the regenerated file.
- T07 · Verify a fresh `repo`-mode init in a scratch git repo: `git status --porcelain -uall` lists no `.frame/bin/` entry while `.frame/bin/` holds all 13 parser scripts plus `lang/*.js` on disk.
- T08 · Verify a fresh `local`-mode init leaves the `.git/info/exclude` block and its contents byte-identical to today.
- T09 · Verify that a pre-commit run in a linked worktree without its own `.frame/bin/` resolves the parser through the main worktree via the `--git-common-dir` fallback and writes that checkout's `STRUCTURE.json`.
