# Plan — Frame Cloud briefs, create

## Architecture

### Resolved plan-time decisions

**Business**

- **`source` value** → `desk`. The user decided this on 2026-09-19.
  FrameCloud's `brief-board` plan gives `desk` to the Board surface, where a
  person fills in a form. `terminal` and `context` stay free for later capture
  from a terminal or an agent.
- **AI conversations & links on create** → in scope. The user decided. Links
  are sent as `brief.addAttachment` calls, one after another, after
  `brief.create` succeeds, in the same IPC call.
- **After create** → the drawer closes onto the board. The user decided. If a
  link failed, the board shows a notice that can be dismissed, and the detail
  does not open.
- **Unsaved form on Back / Esc** → discarded, silently (decided without
  asking). The web's sheet remounts a fresh form on every opening, and the
  spec says each opening starts empty. A confirm dialog would add a modal
  that neither surface has.
- **The empty state's copy** → changed, silently. "Briefs are written on the
  web and show up here" is no longer true. It now says nothing is proposed or
  decided yet, and offers New brief next to Open on web.

**Technical**

- **Test posture** → pure logic only. The user chose it, and it matches the
  testing record: `node --test` covers pure modules, and there is no DOM
  harness. Tests go with the step that adds the code.
- **Where server refusals become sentences** → through the existing `reason`
  vocabulary, silently. `cloudProjectsService.call()` reduces every failure to
  `classifyLinkError`'s reasons (`badRequest`, `notFound`, `network`,
  `unauthorized`, `noWorkspace`, `other`). The refusals a create can really
  meet fit into those reasons:
  - `PROJECT_NOT_FOUND` becomes `notFound`, and a 400 / `BAD_REQUEST`
    becomes `badRequest`.
  - `NOT_WORK`, `MILESTONE_*` and `ASSIGNEE_NOT_FOUND` cannot happen: Frame
    sends no milestone or assignee, and main strips priority from a proposal.

  `call()` stays unchanged, and the copy maps reasons to the web's sentences.
- **Where the create flow lives** → a pure `createWithLinks(call, …)` in
  `cloudBriefs.js`, with `call` injected, silently. That keeps "stop at the
  first failed link" and "no attachment after a failed create" testable with a
  fake. The service only resolves the project and wires in the real `call`.
- **Link validation in two places** → the renderer's `linkService` port names
  the service and refuses a non-`http(s)` paste. Main runs its own
  `new URL` + protocol + title check before `brief.create`. Decided silently,
  by constraint C5: main does not trust the renderer. The main check is five
  lines, so no shared module is created for it.
- **Where the form's code lives** → two new renderer modules, silently.
  `cloudBriefsPanel.js` is already 559 lines and owns the board and the
  detail.
  - `cloudBriefsDraft.js` is pure (no DOM, no Electron): the `linkService`
    port, the empty draft, validation, and the request shape. It is tested.
  - `cloudBriefsForm.js` holds the DOM: rendering the form into a container,
    its events and the IPC call.
- **One drawer, two modes** → silently. The existing
  `#cloud-briefs-detail` aside shows either a brief (`mode: 'detail'`) or the
  form (`mode: 'new'`). The Specs drawer slide, Back and Esc are reused. The
  drawer's Refresh button hides in `new` mode.
- **While Creating…** → silently. Back and Esc do nothing, and submit is
  disabled. `hide()` (a project switch, sign-out or disconnect) still closes
  the drawer. A result that lands after that is dropped, and the board
  reloads the next time it is shown.
- **Body length** → capped at `BRIEF_TEXT_MAX` (10 000), silently. The
  textarea has a `maxlength`, and main refuses more. This is the server's
  limit, and the spec's "lengths" covers it.
- **In-flight footprints** → noted, not asked. `audit-q3-cross-platform`
  (planned) lists `src/shared/ipcChannels.js`, and
  `audit-q3-performance-resources` (implementing) lists `index.html`. This
  plan only adds one line to the cloud block of `ipcChannels.js` and edits
  inside `#cloud-briefs-panel`, so the merge is additive.

### Flow

```
renderer: New brief → drawer (mode 'new') → cloudBriefsForm
  validateDraft (cloudBriefsDraft) ─ fails → field messages, nothing sent
  ok → ipcRenderer.invoke(CLOUD_BRIEF_CREATE, folderPath, request)
main: cloudBriefsService.create(folderPath, request)
  connectedProject(folderPath) ─ null → { ok:false, reason:'notConnected' }
  core.buildCreateInput + core.normalizeLinks ─ bad → { ok:false, reason:'badRequest', field }
  core.createWithLinks(cloudProjectsService.call, { input, links })
    call(createBrief)       ─ fails → { ok:false, reason }           (no attachment sent)
    for each link: call(addAttachment) ─ first failure → stop
    → { ok:true, number, attachmentError: reason | null }
renderer: ok → close drawer, load() board, notice if attachmentError
          !ok → form stays, error sentence (unauthorized: nothing, the session push hides the panel)
```

### Data shapes

- **Request (renderer → main):** `{ kind, title, body, priority, links: [{ title, url }] }`.
  Plain strings. Main ignores every other field.
- **`brief.create` input (main → server):**
  `{ projectSlug, kind, title, source: 'desk', body?, priority? }`.
  - `title` is trimmed and 1–200 characters.
  - `body` is trimmed, left out when empty, and at most 10 000 characters.
  - `priority` is sent only for `work`, one of `high | medium | low`,
    defaulting to `medium`.
- **`brief.addAttachment` input:** `{ id, title, url }`. `title` is trimmed
  and 1–200 characters, and `url` is `http:` / `https:`.
- **Result (main → renderer):**
  `{ ok: true, number, attachmentError: null | reason }` or
  `{ ok: false, reason, field? }`. No brief id crosses to the renderer.
- **Draft (renderer only):**
  `{ kind, title, body, priority, links: [{ key, title, url, service }], showErrors, pending, error }`.

### Copy

These additions go into `cloudBriefsCopy.js`, from the web's
`new-brief-dialog.tsx`, `ai-links.tsx` and `lib/brief.ts`:
- **Form text:** the form's title and description ("New brief" / "A
  proposal to think over, or work you have decided on.").
- **Links:** `AI_LINKS_TITLE`, `AI_LINKS_HINT`, and the invalid-link line
  ("That is not a full link. It should start with https://.").
- **Validation:** "Give the brief a title." and "Each link needs a title."
- **Submit:** `submitLabel(kind, pending)`.
- **Errors:** `createErrorMessage(reason)` and
  `attachmentNotice(number, reason)`. `badRequest` reads "Check the title,
  description and links, then try again." The web's "Check the highlighted
  field" would point at nothing here.

## Files

- `src/main/cloud/cloudBriefs.js` — **Modified**. Adds `LIMITS`,
  `buildCreateInput`, `normalizeLinks`, `createBrief` (POST `brief.create`,
  normalized through `normalizeBrief`), `addAttachment` (POST
  `brief.addAttachment`) and `createWithLinks(call, { input, links })`. The
  header comment changes from read-only to "reads, and creates".
- `src/main/cloud/cloudBriefsService.js` — **Modified**. Adds
  `create(folderPath, request)` and its `ipcMain.handle`. The header comment
  names the one write.
- `src/shared/ipcChannels.js` — **Modified**. Adds `CLOUD_BRIEF_CREATE`.
- `src/renderer/cloudBriefsDraft.js` — **New**. Pure. Holds the
  `linkService` port (Claude artifact/chat, ChatGPT, Gemini, Figma, GitHub,
  otherwise the host), `emptyDraft`, `addLink`, `validateDraft` and
  `toRequest`.
- `src/renderer/cloudBriefsForm.js` — **New**. The form's DOM:
  - `open(container, { onCreated })`, `close()` and `isPending()`.
  - Renders the kind switch, title, description, priority and the links
    field with its rows.
  - Handles paste, Enter and Add, and submits through `CLOUD_BRIEF_CREATE`.
- `src/renderer/cloudBriefsCopy.js` — **Modified**. Adds the copy listed
  above. The header comment drops "read-only".
- `src/renderer/cloudBriefsPanel.js` — **Modified**:
  - The New brief button and the empty-state button.
  - The drawer's `mode` (`detail` / `new`), with `closeDrawer` replacing
    `closeDetail` at its call sites.
  - The board notice (render and dismiss). `onCreated` reloads the board.
  - Refresh and focus reloads skip the drawer in `new` mode.
  - The header comment changes.
- `index.html` — **Modified**. Adds a `#cloud-briefs-new` button to the
  Briefs header actions, and updates the panel's comment.
- `src/renderer/styles/components/cloud-briefs.css` — **Modified**. Styles
  for the form (fields, kind switch, link rows, field errors, primary button)
  and for the board notice.
- `test/cloudBriefs.test.js` — **Modified**:
  - `buildCreateInput`: Work vs Proposal, empty body, trimming, limits.
  - `normalizeLinks`: non-http, empty title.
  - `createBrief` / `addAttachment` POST shapes.
  - `createWithLinks`: a failed create sends no link, links go in order, and
    the flow stops at the first failure.
- `test/cloudBriefsDraft.test.js` — **New**. `linkService` naming and
  refusal, `validateDraft` (whitespace title, untitled link) and `toRequest`
  (priority only for Work, link order).
- `test/cloudBriefsCopy.test.js` — **Modified**. `createErrorMessage`,
  `attachmentNotice` and `submitLabel`.

## Footprint

- src/main/cloud/cloudBriefs.js
- src/main/cloud/cloudBriefsService.js
- src/shared/ipcChannels.js
- src/renderer/cloudBriefsDraft.js
- src/renderer/cloudBriefsForm.js
- src/renderer/cloudBriefsCopy.js
- src/renderer/cloudBriefsPanel.js
- index.html
- src/renderer/styles/components/cloud-briefs.css
- test/cloudBriefs.test.js
- test/cloudBriefsDraft.test.js
- test/cloudBriefsCopy.test.js

## Dependencies

None.

## Sequencing

1. **Core create in main.** In `cloudBriefs.js`, add `LIMITS`,
   `buildCreateInput`, `normalizeLinks`, `createBrief`, `addAttachment` and
   `createWithLinks`, with their tests in `test/cloudBriefs.test.js`.
2. **Service and channel.** Add `CLOUD_BRIEF_CREATE` to `ipcChannels.js`,
   and `cloudBriefsService.create` with its handler:
   - an unconnected path returns `notConnected` without a request;
   - a bad request or a bad link returns `badRequest` before `brief.create`;
   - otherwise it calls `createWithLinks` with `cloudProjectsService.call`.
3. **Pure draft module.** Add `cloudBriefsDraft.js` (the `linkService` port,
   `emptyDraft`, `addLink`, `validateDraft`, `toRequest`) with
   `test/cloudBriefsDraft.test.js`.
4. **Copy.** Add the form, links, validation, submit-label and error copy to
   `cloudBriefsCopy.js`, with its tests in `test/cloudBriefsCopy.test.js`.
5. **Form module.** Add `cloudBriefsForm.js`:
   - It renders the form into a given container.
   - Kind switch: the explanation follows the chosen kind, and priority shows
     only for Work.
   - The title is focused on open, and inputs stay reachable by keyboard.
   - The links field adds on paste, Enter or Add. Rows have an editable title
     and a remove button, and a non-http paste is refused and kept.
   - Submit validates, then sends `CLOUD_BRIEF_CREATE` with the open folder's
     path, shows Creating…, and blocks a second submit.
   - On `ok` it calls `onCreated({ number, attachmentError })`. On failure it
     keeps the fields and shows the error sentence, and shows nothing for
     `unauthorized`.
6. **Panel wiring and markup.** In `cloudBriefsPanel.js` and `index.html`:
   - The `#cloud-briefs-new` header button, and New brief in the empty state
     with the new copy.
   - The drawer `mode`: `openNewBrief()` fills the drawer through
     `cloudBriefsForm.open` and hides the drawer Refresh. `closeDrawer()`
     serves both modes.
   - Back and Esc are ignored while `cloudBriefsForm.isPending()`.
   - `refresh`, `onCloudChange` and the focus reload do not touch the drawer
     in `new` mode. A change of folder and `hide()` still close it.
   - `onCreated` closes the drawer, runs `load()`, and sets the notice when
     `attachmentError` is set. The notice is drawn above the columns, has a
     dismiss action, and clears on a change of folder or `hide()`.
7. **Styles.** In `cloud-briefs.css`, style the form (the fields, the
   two-way kind switch, link rows, field errors, the primary submit and its
   disabled/pending state) and the board notice. Use the existing theme
   variables, in both themes.
