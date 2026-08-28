# Outcome — Frame's own scripts stay out of the user's repo

## T01 — Reclassify `bin/` as runtime and reduce `FRAME_TRACKED_DERIVED` to `STRUCTURE.json`

Moved `'bin/'` from `FRAME_FILE_CLASSES.derived` to `FRAME_FILE_CLASSES.runtime`
in `src/shared/frameConstants.js` and cut `FRAME_TRACKED_DERIVED` down to
`['STRUCTURE.json']`. Placed `bin/` after `migration-backup/` so the runtime
directories stay grouped ahead of the file and glob entries. `npm test` is
transiently red here — `test/gitSharing.test.js:100` still asserts the
pre-reversal behaviour, which T03 inverts.

_Captured: 2026-08-28 · 1 file change_

---

## T02 — Record the T15 reversal in the tracked-derived comment

Rewrote the `FRAME_TRACKED_DERIVED` comment in `src/shared/frameConstants.js` so
it explains `STRUCTURE.json` on its own terms, then names T15 of
`non-invasive-overlay` as reversed with its three lapsed rationales and points at
this spec. Added a closing line that `copyParserScripts` still writes the scripts
into every checkout, since the comment's neighbourhood is where a reader would
otherwise conclude the scripts stopped shipping. Comment only; no behaviour.

_Captured: 2026-08-28 · 1 file change_

---

## T03 — Invert the `bin/` assertion in the gitSharing test

Flipped the `bin/` check in `test/gitSharing.test.js` to `assert.match(content,
/^bin\/$/m)`, rewrote its message to name Frame's machinery as machine-local and
renamed the test to match; the `STRUCTURE.json` assertion is byte-identical. This
closes the transient red carried since T01 — `npm test` is 450/450.

_Captured: 2026-08-28 · 1 file change_

---

## T04 — Correct the generator's doc comment

Cut `bin/` from the `FRAME_TRACKED_DERIVED` parenthetical above
`getFrameGitignoreBlock` in `src/shared/frameTemplates.js` and reflowed the
sentence across its two lines. Comment only — the generator's body already
produced the right block from T01's inputs.

_Captured: 2026-08-28 · 1 file change_

---

## T05 — Correct the Git sharing row copy

Reworded the Git sharing row's description in `index.html` to name this
project's Frame context rather than the `.frame/` folder, keeping the
`.git/info/exclude` clause and the never-edits/never-untracks sentence as they
were. Narrowed per the plan's resolved decision — no enumeration of
specs/tasks/notes, and no new promise about Frame's scripts.

_Captured: 2026-08-28 · 1 file change_

---

## T06 — Regenerate and verify this repo's own managed block

Regenerated `.frame/.gitignore` by calling `gitSharing.ensureFrameGitignore` on
this project instead of launching the IDE — `frameProject.js` reaches the file
only through `gitSharing.reconcile`, so the effect is identical. `bin/` now sits
inside the managed markers, `STRUCTURE.json` does not, the 24 tracked
`.frame/bin/` files stay tracked and an edit to one still reports ` M`. Confirmed
the accepted cost too: an untracked probe under `.frame/bin/` is invisible to
`git status --porcelain -uall`, so a new script here will need `git add -f`.

_Captured: 2026-08-28 · 1 file change_

---

## T07 — Verify a fresh `repo`-mode init

Initialized a scratch git repo through `initializeFrameProject(..., { gitSharing:
'repo' })`. `git status --porcelain -uall` shows 11 files / 24,927 bytes and no
`.frame/bin/` entry, against the spec's target of roughly 11 files / 28 KB; the
13 parsers and 5 `lang/*.js` files are all on disk, and the 169,702 bytes they
occupy stay out of the commit. Verification only — no files changed.

_Captured: 2026-08-28 · 0 file changes_

---

## T08 — Verify a fresh `local`-mode init is unchanged

Compared a `local`-mode init from a detached worktree at the pre-spec commit
(4e47811) against one from the current tree: `.git/info/exclude` is byte-identical
at 354 bytes and both scratch repos report an empty `git status --porcelain
-uall`. The before-side first needed `node_modules` symlinked into the worktree —
without it `require('electron')` failed inside the sharing path and the run
skipped the exclude block entirely, which would have read as a false pass.
Verification only — no files changed.

_Captured: 2026-08-28 · 0 file changes_

---

## T09 — Verify the worktree pre-commit fallback

Added a linked worktree to the T07 scratch repo; with `bin/` ignored it came up
without any `.frame/bin/`. Committing a new JS file there ran the shared
pre-commit hook, which resolved `update-structure.js` through the main worktree
via `--git-common-dir` and wrote that checkout's own `.frame/STRUCTURE.json`
(2 modules, staged into the commit) while the main worktree's copy stayed at 1.
The fallback the spec relied on is now the normal path, and it works.
Verification only — no files changed.

_Captured: 2026-08-28 · 0 file changes_

---
