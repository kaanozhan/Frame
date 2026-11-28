---
keywords: frame cloud, briefs, new brief, create brief, cloud write, brief.create, attachments, ai links
related: frame-cloud-briefs-read-only, frame-cloud-projects, frame-cloud-sign-in
---
Connected folders can create a Frame Cloud brief from Frame. A New brief button in the Briefs header and empty state opens a form in the existing drawer (`drawerMode: 'new'`). The form ports the web's New brief: a Work/Proposal switch, title, description, Work-only priority, and AI conversations & links.
One IPC call, `CLOUD_BRIEF_CREATE` (path, request), handles everything. Main resolves the slug and re-validates with `buildCreateInput` + `normalizeLinks`; a bad field or link refuses before any request. `createWithLinks(call, …)` sends `brief.create` (`source: 'desk'`), then `brief.addAttachment` per link in order, and stops at the first failure → `{ ok, number, attachmentError }`. No brief id reaches the renderer.
This overturns the read-only rule of frame-cloud-briefs-read-only, but only for brief.create and its own addAttachment calls. Every other brief/milestone write, including adding a link to an existing brief, stays out.
Rejected alternatives:
- Creating and attaching as separate renderer calls: the renderer would hold a brief id.
- Mapping server codes in a new error layer: the existing `call()` reasons (`badRequest`, `notFound`, …) are enough, and the copy maps them.
- A confirm dialog on discard: Back/Esc drop the form silently, and are ignored while a create runs.
After a create, the drawer closes and the board reloads. If a link failed, a dismissible notice shows above the columns and the detail does not open. This differs from the web.
Pure modules are tested: cloudBriefs.js (create core), cloudBriefsDraft.js (linkService port, draft, validation, request) and cloudBriefsCopy.js. The DOM (cloudBriefsForm.js, the panel wiring, the CSS) has no harness and was not exercised in the app during implementation.
Rules for future work: keep new writes behind main-side validation that refuses before the first request, and keep ids in main.

Chain: spec.md → plan.md → tasks.md → outcome.md
