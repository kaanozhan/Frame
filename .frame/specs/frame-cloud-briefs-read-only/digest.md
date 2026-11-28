---
keywords: frame cloud, briefs, cloud briefs, brief board, read-only, sidebar briefs, milestones, brief detail
related: frame-cloud-projects, frame-cloud-sign-in, brief-capture-and-shaping
---
Connected folders get a read-only Briefs view: a Context row under Sessions (key `cloud-briefs`), shown only while the open folder is connected (same test as `cloudProjectMark`), opening a Backlog / Active / Done board with a Show closed section and a full-page detail drawer (Description / Parts / Comments / History).
Main owns everything cloud-side: `cloudBriefs.js` (pure reads + normalizers + brief web URL), `cloudBriefsService.js` (path → `cloudProjectsService.connectedProject` → `call()`); the renderer sends only a folder path and main refuses an unconnected one before any request. Three IPC channels: `CLOUD_BRIEFS_LIST`, `CLOUD_BRIEF_GET`, `CLOUD_BRIEFS_OPEN_ON_WEB`.
Why this path: sidebar placement overturns frame-cloud-projects' "dock tab" guess (user decision 2026-09-18); a separate service instead of growing cloudProjectsService; "You" from `session.user.id` rather than an extra `auth.me`; copy helpers ported from the web's `lib/brief.ts` (`cloudBriefsCopy.js`) rather than shared.
Rules for later work:
- Network text (body, comments, titles) is escaped plain text, never `marked`; attachment links open only for http(s).
- Names stay `cloudBriefs*` / `cloud-briefs` — local briefs (brief-capture-and-shaping) own `briefs`.
- The drawer reuses `.specs-dashboard-detail*`; it covers the header, so it carries its own Refresh.
- Nav rows may carry `available()`; `refreshWorkspaceNav` hides them with inline display (a bare [hidden] loses to `display:flex`).
- The board reloads on cloud pushes only when (path, project id, list lastUpdated) changes — the hub pushes on every candidate lookup — and on window focus; both are throttled to 30 s after the panel's last load unless the folder or project changed (T11).
- Writes, polling, milestones/inbox views and member names are out of scope; writes are a later decision.
Tests cover the pure core and copy only (DOM untested, per project convention).

Chain: spec.md → plan.md → tasks.md → outcome.md
