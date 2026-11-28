---
keywords: frame cloud, brief done, merged part, part branch, completion commit, recordBranch, recordCompletion, dropped part
related: frame-cloud-brief-start, frame-cloud-briefs-read-only, frame-cloud-brief-shape
---
Frame's half of FrameCloud's brief-done. Begin sends the part's branch and base commit (`brief.recordBranch`) when HEAD gives a valid SHA, without waiting; a Briefs read resends a branch the cloud lacks.
After every Briefs list or get, `cloudDoneService.report` (single-flight per folder, deferred so the read answers first) reads each part's record at its branch tip with `git show`, with no checkout and from whatever branch is open, and sends `brief.recordCompletion` with the tip when the record is finished there and the tip is new over the stored SHA.
No queue and no watcher: a failed send is resent by the next read, and a send that lands pushes `CLOUD_BRIEFS_CHANGED` so the panel reloads. Decisions live in the pure `cloudDone.js`; git reads in `gitBranchesManager.js` (`branchTipSha`, `showFileAt` with a 32 MB buffer, `commitExists`, `isAncestor`).
Rows read the cloud: "Dropped · reason", "Merged into <target>" only while `mergedBase` is the current target, "On <branch>" on every machine. A local finish reads "Implemented"; rejected "Ready for PR" (no PR data yet) and "Done locally" (keeps Done for non-merges). The summary counts "N of M merged · K dropped", and a folder with no GitHub installation shows a notice with "Open on web".
Rules: Frame only points (branch, SHA) and the cloud alone decides merged; final refusals (PART_DROPPED, PART_MERGED, NOT_STARTED, ALREADY_DONE, ALREADY_CLOSED) are logged, never retried; unit tests cover the pure logic only.
Known gaps: a `gitSharing: local` project never commits `tasks.json`, so its parts never send a completion; Done shows only on a read after the server's one-minute merge-check window.
Walked by the developer against local FrameCloud on 2026-11-07. Direction since then ("Active ve Done Akışı", 2026-11-07): Done becomes a person's move; merge, PR and review stay as part states inside Active.

Chain: spec.md → plan.md → tasks.md → outcome.md
