# Plan — spec-status-repair

## Approach

**Repair (A).** A new `repairSpecStatus(status, folderName)` fills only what
is derivable and only when absent: `slug` ← folder name,
`generated_task_ids` ← `[]`. It returns the repaired object plus the list of
fields it filled, so the caller can log and persist. `listSpecs` calls it
before validating; when fields were filled it writes the file back through
the existing `writeStatus` (write-if-changed, marks `lastSelfWriteAt`, so
the watcher does not re-fire and a second pass is a no-op).

`updateSpecStatus` runs the same repair before merging, so a phase advance
on a never-repaired spec works instead of failing validation.

**Surface (B).** `listSpecs` stops using `continue` for a spec folder that
holds spec files. Anything still invalid after repair is pushed as
`{ slug: <folder>, malformed: <reason>, title: <status.title or folder> }`
with safe zeros for counts. Folders holding none of `status.json`, `spec.md`,
`plan.md`, `tasks.md` remain skipped — they are not specs. Every malformed
entry is logged with its reason.

The specs dashboard and the sidebar spec section render such an entry as a
card marked "needs attention" with the reason, and skip the interactions
that assume a working spec (phase actions, agent dispatch, task counts). The
detail view shows the reason and the file path rather than an empty chain.

**Document (C).** The required shape goes into `src/templates/commands/
claude-code/spec.new.md` (the template that creates a spec) and
`src/templates/orchestration/CONDUCTOR.md`, since the conductor writes spec
folders directly. `.frame/runtime/` is a staged copy Frame rewrites — editing
it would be overwritten, so it is not touched by hand.

## Footprint

- src/main/specManager.js
- src/renderer/specsDashboard.js
- src/renderer/specSection.js
- src/renderer/styles/components/panels.css
- src/templates/commands/claude-code/spec.new.md
- src/templates/orchestration/CONDUCTOR.md
- test/specStatusRepair.test.js (new)
