---
keywords: frame cloud, milestone, started milestone, milestone strip, overdue, milestone progress, board filter, briefs panel, home tracker
related: frame-cloud-briefs-read-only, frame-cloud-brief-manual-done, frame-cloud-github-tracking, frame-cloud-roles
---
Frame shows the project's started Frame Cloud milestone, read-only, in the web's words (ported from `lib/milestone.ts`, `board-milestone.tsx`).
- Core (`cloudBriefs.js`): `normalizeMilestone` keeps `goal/targetDate/targetBranch/startedAt/closedAt/briefs`; `briefs` is null unless all four counts are non-negative integers (an older server → name only), `targetDate` only as a real `YYYY-MM-DD` day. `buildMilestoneWebUrl` → `{project}/milestones/{encoded id}`, opened via `CLOUD_BRIEFS_OPEN_ON_WEB(path, { milestoneId })`.
- Rules (`cloudBriefsCopy.js`): `startedMilestone` (earliest `startedAt`, missing last), `countsWithBriefs` filters to the milestone's briefs itself and keeps the server's `closed`, progress = done / (backlog + active + done), `isOverdue` on the viewer's local day, UTC `formatTargetDate`, `milestoneSummary`, `milestoneRowFacts`.
- Briefs board: a strip between the tracking box and the columns (name → web, Overdue, Ends, Targets, bar + "N of M done") counted from `shownBriefs()`, so a held Move to Done moves it at once. "Show only this milestone" / "All briefs" (`narrowedTo`) filters columns, Closed and the count; it is panel state cleared by `hide()` and a folder change, and counts only while it names the started milestone. The tracking box reads the whole board. Cards badge only the started milestone; the detail's Milestone row shows facts + Overdue.
- Home: `homeData`'s `milestone` source reads `CLOUD_MILESTONES_LIST` (milestone.list alone) on project / cloud / availability change and on visit or focus past 30 s; every board draw hands its counts over (`setBoardMilestone`), and a hidden-panel held move re-reads on settle. The Agents widget's pill opens Briefs narrowed (`openMilestone`).
Rejected: setting a brief's milestone from Frame (D1), a select over every open milestone (D2), recording the base branch at Begin (D3), reusing `CLOUD_BRIEFS_LIST` or a new server endpoint for Home (D12).
Rules: Frame writes no milestone; viewers see none of it (Briefs needs `work`); no timers; reads and handoffs share one sequence so a late read never overwrites the board's counts.

Chain: spec.md → plan.md → tasks.md → outcome.md
