# Outcome — spec-status-repair

Shipped 2026-08-26 for issue #122. 9 new tests (330 total, 0 fail) and live
verification in the running app.

## A — repaired instead of dropped

`repairSpecStatus(status, folderName)` fills only what the folder itself
answers, and only when absent: `slug` ← folder name, `generated_task_ids` ←
`[]`. `listSpecs` repairs before validating and persists the result once
through `writeStatus` (write-if-changed, marks `lastSelfWriteAt`, so the
watcher does not re-fire and later passes write nothing).

`updateSpecStatus` repairs too — the same validator lives there, so before
this a conductor-created spec could not have its phase advanced either.

**An existing slug is never overwritten.** Folder and slug disagreeing is a
rename, and rewriting it would cut every `source: spec:<slug>:T##` link in
tasks.json. There is a test whose only job is to keep that true.

Live: a conductor-shaped `status.json` (title + phase + timestamps) appeared
in the panel immediately, and the file on disk gained exactly
`"slug": "issue-122-repro-conductor"` and `"generated_task_ids": []`.

## B — what cannot be derived is shown, not swallowed

`listSpecs` no longer `continue`s past a spec folder. Anything still invalid
after repair is listed as `{ slug: <folder>, malformed: <reason>, phase: null }`
and logged. Malformed entries sort **first** — a spec needing a human should
not be buried under 45 healthy cards — and are inert: no phase badge, no
progress bar, no click-through, no agent dispatch. The card shows the
validator's reason and the path to the file.

Directories carrying none of `status.json` / `spec.md` / `plan.md` /
`tasks.md` / `outcome.md` are still skipped: a backup folder is not a spec.

Live: `issue-122-repro-nostatus` → "status.json **is missing or unreadable**",
`issue-122-repro-notitle` → "status.json **missing title**", both with their
path, both non-clickable, no page errors.

**Found by the live check:** `specPanel.renderSpecRow` threw
`Cannot read properties of null (reading 'replace')` on a phase-less entry —
the legacy side panel still renders on every SPEC_DATA push. Guarded.

## C — the shape is written down

`src/templates/commands/claude-code/spec.new.md` and
`src/templates/orchestration/CONDUCTOR.md` now carry the required
`status.json` fields, marked required vs optional, with a note that Frame
repairs slug/generated_task_ids and lists anything else as "needs attention".
Edited in `src/templates/` — `.frame/runtime/` is a staged copy Frame
rewrites, so editing that would have been overwritten on the next launch.

## What did not change

Specs that were valid before are listed exactly as before, and their
`status.json` is not written (a test asserts the mtime is untouched).

## Noted while verifying

`reconcilePhase` already repairs an invalid `phase` from the files on disk
(the "not-a-phase" repro healed to `specified` before validation). So in
practice the malformed path is for a missing title or an unreadable file —
narrower than the issue implies, and worth knowing.
