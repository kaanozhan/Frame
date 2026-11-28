---
keywords: frame cloud, github tracking, pull request, pr state, review state, tracking off, implemented, briefs panel
related: frame-cloud-brief-done, frame-cloud-brief-manual-done, frame-cloud-brief-start, frame-cloud-briefs-read-only
---
Frame's Briefs view shows what FrameCloud brief-github-tracking adds, in the web's words (ported from `lib/brief.ts`, `brief-parts.tsx`, `project-header.tsx`).
- Core (`cloudBriefs.js`): `mergeTracking` is `ready | needs_github | off`; parts carry `prNumber/prState/prBase/prReview/prUrl` (http(s)-only URL); `mergeTrackingOf` (needs_github → off → ready) moved in from the service; `buildSettingsWebUrl` → `{project}/settings#github`, opened via `CLOUD_BRIEFS_OPEN_ON_WEB(path, 'settings')`.
- Rows (`partStatus`, tracking-aware): dropped → merged → a live lane on an unfinished record (D1; rejected "PR always wins", it hides the lane after Changes requested) → PR rows only while `ready` (off-target "Merged into <base>, not <target>", "PR #N · Open/In review/Approved/Changes requested", tone `review`) keeping the record's Run (D7) → the record → the cloud's `completionSha` "Implemented" → branch rows. Only PR rows add `pr: { number, url, kind, base }`.
- "PR #N" is an `open-pr` button opening the server's URL via `shell.openExternal` after `isWebUrl`; plain text without one. Frame never builds a GitHub URL.
- Summary: ready "N of M merged · in review · changes requested · implemented" then Frame's in progress / other branch / dropped; not ready "N of M implemented" (a merge counts). Active cards show `partAttention` (the web's K2 line).
- Not `ready` (off and needs_github alike, D5): no PR rows, no Ready for Done (`=== 'ready'`), Move to Done needs no reason, and the board shows the web's box (`trackingWarning`) with Open on web → Settings (D4, overturning brief-done D2's line).
- History: `part-merged` reads the web's sentence as an observation with no actor (D19, overturning manual-done D8).
Rejected: Refresh from GitHub in Frame (D2: no `brief.refresh`, no IPC); the permission-pending badge (D3).
Rules: a PR is a pointer, only `mergedAt` counts; copy stays verbatim with the web; summary/attention read partStatus results so they never contradict the rows.

Chain: spec.md → plan.md → tasks.md → outcome.md
