# Outcome — Frame Cloud briefs, create

## T01 — Create in the pure core

Added `LIMITS`, `buildCreateInput`, `normalizeLinks`, `createBrief`, `addAttachment` and `createWithLinks` to `src/main/cloud/cloudBriefs.js`, and rewrote its header to "reads, and creates". `buildCreateInput` drops priority from a proposal, fills `medium` for Work when priority is absent, and refuses an unknown one. `createWithLinks` treats a created brief with no id or number as a failure (`other`). Covered in `test/cloudBriefs.test.js` (14 tests).

_Captured: 2026-09-19 · 2 file change(s)_

---

## T02 — Service and channel

Added `CLOUD_BRIEF_CREATE` to `src/shared/ipcChannels.js`, and `create(folderPath, request)` with its handler to `src/main/cloud/cloudBriefsService.js`. An unconnected path returns `notConnected`, and a bad field or link returns `badRequest` with `field`, both before any request. Otherwise the service runs `createWithLinks` through `cloudProjectsService.call` and rebuilds the result without the brief id. The plan lists no service test; this was checked once with stubbed modules, not committed.

_Captured: 2026-09-19 · 2 file change(s)_

---

## T03 — Pure draft module

Added `src/renderer/cloudBriefsDraft.js`: a rule-for-rule port of the web's `linkService`, plus `emptyDraft`, `addLink` (returns null on a non-`http(s)` text), `validateDraft` (`{ ok, titleError, untitledKeys }`) and `toRequest`. The draft also holds `nextKey` for row keys, which the plan's shape did not list. Tests are in `test/cloudBriefsDraft.test.js`.

_Captured: 2026-09-19 · 2 file change(s)_

---

## T04 — Copy

Added the New brief copy to `src/renderer/cloudBriefsCopy.js`: the form's title and description, the links title, hint and invalid-link sentences, the two validation sentences, `submitLabel`, `createErrorMessage` and `attachmentNotice`. The header now says creating is the one write. `attachmentNotice` reads `notFound` as "This brief does not exist." rather than the project sentence, because an attachment is refused on the brief. The empty-state copy stays in the panel, for T06. Tests are in `test/cloudBriefsCopy.test.js`.

_Captured: 2026-09-19 · 2 file change(s)_

---

## T05 — Form module

Added `src/renderer/cloudBriefsForm.js` (`open`, `close`, `isPending`). It draws the form once per opening, patches it in place, and wires events on the form element so reopening never stacks listeners. The priority field is a native `<select>`, not the web's custom Select; no plain-key global shortcut exists that could steal its keys. A non-`http(s)` paste into an empty links field is taken over, so the text stays and the invalid sentence shows. The create result is dropped when the form was closed while pending (numbered openings).

_Captured: 2026-09-19 · 1 file change(s)_

---

## T06 — Entry points and the drawer's form mode

Added the `#cloud-briefs-new` header button in `index.html`, and New brief in the empty state, whose copy now reads "Nothing in this project is proposed or decided yet." In `src/renderer/cloudBriefsPanel.js`, added `drawerMode`, `openNewBrief()`, `closeDrawer()` (replacing `closeDetail()`), and `leaveDrawer()` for Back and Esc, which ignores them while a create runs. The drawer's Refresh hides in `new` mode, and `onDetailClick` ignores the form's clicks. `leaveDrawer()` was not named in the plan; it keeps the pending guard off the folder-change and `hide()` paths.

_Captured: 2026-09-19 · 2 file change(s)_

---

## T07 — Finished create

Added `onBriefCreated` to `src/renderer/cloudBriefsPanel.js`: it closes the drawer, sets the notice (`copy.attachmentNotice`) when a link failed, and reloads the board. `renderBoard` draws the notice above the columns with a Dismiss button. The notice clears on dismiss, a change of folder or `hide()`, and a later clean create replaces it. It shows only with a loaded board, not over a load error.

_Captured: 2026-09-19 · 1 file change(s)_

---

## T08 — Styles

Styled the form, the kind switch, the link rows, the field and form errors, and the primary submit (disabled and pending) in `src/renderer/styles/components/cloud-briefs.css`. Also styled the board notice, the empty-state actions and focus rings. Only existing theme variables are used; the notice uses `--warning` / `--warning-ink` so it reads in the light scheme too. The kind switch keeps real radio inputs, visually hidden, with focus and checked state drawn through `:has()`. Not checked visually in the running app.

_Captured: 2026-09-19 · 1 file change(s)_

---

