# Plan — Frame Cloud header entry and window tour

## Architecture

### Resolved plan-time decisions

Business (asked):

- **D1 · What the entry shows when signed in with a workspace.** Chosen: the
  workspace's initial and name. Rejected: always "Frame Cloud", which says
  nothing about who is signed in. The role stays in the tooltip.
- **D2 · What the entry says when signed out on an open server.** Chosen:
  "Frame Cloud". Rejected: "Sign in to Frame Cloud", a standing call in the
  header that a local-only user cannot dismiss.
- **D3 · Whether the tour is reachable once signed in.** Chosen: signed out
  only. Rejected: a "What's in Frame Cloud" link in the signed-in window,
  which reaches into the view the spec keeps out of scope.

Technical:

- **D4 · Tests (asked).** Chosen: pure logic only, the project's convention
  (testing record: pure modules covered, DOM-coupled renderer not). The entry
  rule and the tour's data and stepping are tested; the DOM hosts are walked.
- **D5 · The narrow header.** Chosen: one CSS media query at `max-width:
  760px` hides the label and the tag. The window's minimum width is 900
  (`src/main/index.js:94`), where every label fits, so the case is reached
  only through interface zoom, which shrinks the CSS viewport. Rejected:
  measuring with `ResizeObserver`, which adds script for a rare case.
- **D6 · Where the entry lives.** The rule is a new pure module,
  `src/renderer/cloudEntry.js`. The DOM binding is `bindCloudEntry` in
  `appHeader.js`, the header's own module. `index.js` only loses its
  `bindCloudBtn` block and gains one call. Rejected: keeping the binding in
  `index.js`, which sits in the stalled audit-q3-cross-platform footprint.
- **D7 · The tooltip.** `tooltip.attach` fixes its text when attached
  (frame-cloud-projects' deviation note). The entry keeps today's answer: a
  changed tooltip replaces the button with a clone and attaches a fresh one.
  Rejected: changing `tooltip.js`, a module every surface shares.
- **D8 · The tour's shape.** Step data and stepping are a new pure module,
  `src/renderer/cloudTour.js`. `cloudWelcome.js` stays the DOM host with the
  same `render(root)` entry, so `cloudHub.init` keeps its call.
- **D9 · The examples' styles.** The examples get their own `.cloud-tour-*`
  rules. Rejected: reusing the Briefs panel's classes. The Active example
  lists a brief's parts, which the real card does not, and sharing classes
  would tie the tour to the panel's layout.
- **D10 · The pricing guard for tour strings.** The existing guards forbid the
  word "plan". The tour's subject is planning ("Plan the work where the code
  is."), so its guard drops `plan` and adds `pricing`, `paid`, `upgrade` and
  `free`. The entry's strings keep the full guard.
- **D11 · The step is not remembered.** `cloudHub.onOpen` resets the tour to
  step one. Rejected: persisting the step, which the spec's criteria exclude.
- **D12 · No arrow keys.** The email field sits beside the tour and uses the
  arrows. Back, Next and the dots are buttons in tab order.
- **D13 · The early-access "in flight" flag is stale.** `spec-context` marks
  frame-cloud-early-access as `tasks_generated` over `cloudHub.js`,
  `cloudEarlyAccess.js`, `cloud-hub.css` and `index.html`. That spec has an
  `outcome.md` and was merged; only its `status.json` lags. It is treated as
  closed, and this plan does not repair it.
- **D14 · The entry during sign-in steps.** `inviteOnly` and `waitlistEmail`
  reach the renderer in every state but `signedIn`
  (`cloudSession.js:258`), so `requestingCode`, `awaitingApproval`,
  `registering` and `failed` read exactly as `signedOut` does.
- **D15 · A long workspace name.** The label is capped at `24ch` with an
  ellipsis; the tooltip carries the full name.
- **D16 · PRIVACY.md.** Only the phrase that locates the window changes ("the
  cloud icon at the foot of the sidebar"). The wider privacy pass is separate.
- **D17 · A click toggles the window**, as the rail button did
  (`cloudHub.toggle`).
- **D18 · Focus survives a rebind.** If the entry has focus when it is
  replaced, the clone takes it.
- **D19 · No drag region.** Frame uses the native title bar (no
  `titleBarStyle`, no `app-region` rule), so the entry needs no exemption.

### The entry

`cloudEntry.entryFor(session)` maps the session the renderer already has
(`cloudHub.session()`) to what the header draws. It returns `null` for
`unavailable` and otherwise:

```
{ kind: 'cloud' | 'workspace', label, tag, initial, tooltip, call }
```

| Session | kind | label | tag | call |
| --- | --- | --- | --- | --- |
| not `signedIn`, `inviteOnly !== true` | cloud | Frame Cloud | null | false |
| not `signedIn`, `inviteOnly === true`, no `waitlistEmail` | cloud | Join Frame Cloud waitlist | Early access | true |
| not `signedIn`, `inviteOnly === true`, `waitlistEmail` | cloud | Frame Cloud | On the list | false |
| `signedIn`, no `workspace.slug` | cloud | Frame Cloud | No workspace | false |
| `signedIn`, `workspace.slug` | workspace | the workspace's name | null | false |

- `initial` is the name's first character, upper-cased, read by code point.
- `tooltip` is the full state: "Frame Cloud", "Frame Cloud · Early access ·
  Join the waitlist", "Frame Cloud · Early access · You're on the list",
  "Frame Cloud · No workspace", or "Frame Cloud · `<name>` · `<Role>`".
- Words come from their owners: the three early-access strings are new keys
  in `cloudEarlyAccess.COPY`; "No workspace" is
  `cloudNoWorkspace.workspaceRow(null).value`; the name and role line are
  `cloudRoles.workspaceName` and `cloudRoles.workspaceLine`.

The markup is static in `index.html`, inside `.app-header-left` after the
brand: a hidden `button#cloud-entry` holding a separator, the cloud icon, an
initial box, a label and a tag. `appHeader.bindCloudEntry(cloudHub)` paints it
from `entryFor` on every `onSession` push with `textContent`, sets
`aria-label` to the tooltip, toggles `hidden` and `data-kind`, adds
`.cloud-entry-call` for the waitlist call, and rebinds the tooltip
(`placement: 'bottom'`) when its text changes. No badge, no dot.

Styles are a new block in `app-header.css`: transparent at rest, hover and
focus from tokens, the call one step brighter (`--text-primary`), the tag a
neutral outlined pill, the initial box on `--accent-subtle`. The media query
of D5 hides the label, the tag and the initial box and shows the cloud icon.

### The tour

`cloudTour.js` holds `EYEBROW`, `TRUST`, `STEPS` and the stepping rules.

```
STEPS[i] = { id, name, title, lede, example }
example  = { kind: 'features', items: [{ title, text }] }
         | { kind: 'board', milestone, columns: [{ name, cards: [{ number, kind, title, foot, tone, parts? }] }] }
         | { kind: 'lane', chip, lines: [{ who, text }], record: { title, text }, action }
         | { kind: 'parts', chip, rows: [{ label, status, tone }], note?, action? }
```

- Steps: `overview` (features), `board` (board), `discuss` (lane), `shape`
  (parts, with a note), `track` (parts, with an action). Copy is the
  mockup's, alternative D.
- `tone` is one of `ok | review | active | muted`; the host maps it to a
  class, and the class to tokens.
- `next(i)`, `back(i)`, `clamp(i)`, `canNext(i)`, `canBack(i)`, `counter(i)`
  ("2 of 5 · Board") and `strings()` (every string, for the guards).

`cloudWelcome.js` builds the skeleton once in `render(root)`: eyebrow with the
counter, title, lede, a stage, the nav row (dots, Back, Next) and the trust
line. `show(i)` repaints the title, lede, counter, stage and the buttons'
`disabled` and `aria-current`. `reset()` shows step one. Back, Next and the
dots are created once and never replaced, so focus stays on them; when Next
becomes disabled under focus, focus moves to Back.

The tour only ever touches `#cloud-pitch`. The sign-in card is a sibling
(`aside.cloud-signin`), so its pane, its typed email and its focus cannot be
disturbed, and `.cloud-modal` keeps its fixed height
(`cloud-hub.css:21`). The stage takes the free height, so the nav row does not
move between steps.

`cloudHub.onOpen` calls `cloudWelcome.reset()`. `renderSession` already hides
`#cloud-welcome` outside `WELCOME_STATES`, so a sign-in replaces the tour as
today.

## Files

- `src/renderer/cloudEntry.js` — **New.** Pure: `entryFor(session)`.
- `src/renderer/cloudTour.js` — **New.** Pure: the tour's copy, steps and stepping.
- `test/cloudEntry.test.js` — **New.** Every session state, the initial, the tooltip, the full pricing guard.
- `test/cloudTour.test.js` — **New.** Step shape, stepping, the dropped claims, the tour's pricing guard.
- `src/renderer/cloudEarlyAccess.js` — **Modified.** Three `COPY` keys: the waitlist call, "Early access", "On the list".
- `src/renderer/cloudWelcome.js` — **Modified.** From a static list to the tour's DOM host (`render`, `show`, `reset`).
- `src/renderer/cloudHub.js` — **Modified.** `onOpen` resets the tour; header comment.
- `src/renderer/appHeader.js` — **Modified.** `bindCloudEntry(cloudHub)`.
- `src/renderer/index.js` — **Modified.** Drops `bindCloudBtn`; calls `appHeader.bindCloudEntry` after `cloudHub.init`.
- `index.html` — **Modified.** Adds `#cloud-entry` to the header; removes `#cloud-btn` from the rail.
- `src/renderer/styles/components/app-header.css` — **Modified.** The entry's styles and the narrow rule.
- `src/renderer/styles/components/cloud-hub.css` — **Modified.** Removes `.cloud-feats` / `.cloud-feat*`; adds `.cloud-tour-*`.
- `PRIVACY.md` — **Modified.** Where the Frame Cloud window is opened from.

## Footprint

- src/renderer/cloudEntry.js
- src/renderer/cloudTour.js
- test/cloudEntry.test.js
- test/cloudTour.test.js
- src/renderer/cloudEarlyAccess.js
- src/renderer/cloudWelcome.js
- src/renderer/cloudHub.js
- src/renderer/appHeader.js
- src/renderer/index.js
- index.html
- src/renderer/styles/components/app-header.css
- src/renderer/styles/components/cloud-hub.css
- PRIVACY.md

## Dependencies

None

## Sequencing

1. **The entry rule.** Add the three keys to `cloudEarlyAccess.COPY`. Write
   `src/renderer/cloudEntry.js` (`entryFor`) and `test/cloudEntry.test.js`:
   one case per row of the table, `unavailable` and a missing session as
   `null`, the sign-in steps reading as signed out, a workspace without a
   known role, a non-ASCII name's initial, and the full pricing guard over
   every label, tag and tooltip.
2. **The entry in the header.** Add `#cloud-entry` to `index.html` and its
   styles to `app-header.css`, including the narrow rule. Add
   `bindCloudEntry` to `appHeader.js`. In `index.js`, replace the
   `bindCloudBtn` block with the call, placed after `cloudHub.init`.
3. **The rail.** Remove `#cloud-btn` from `index.html` and correct the
   rail-foot comments in `index.js` and `cloudHub.js`.
4. **The tour's data.** Write `src/renderer/cloudTour.js` with the five steps,
   the trust line and the stepping rules, and `test/cloudTour.test.js`: five
   steps with unique ids and a known example kind each, `next`/`back`
   clamping, `canNext`/`canBack` at both ends, `counter`, no string matching
   "live session", "specs on the web" or "every machine", and the tour's
   pricing guard.
5. **The tour in the window.** Rewrite `cloudWelcome.js` as the host
   (`render`, `show`, `reset`) with one builder per example kind. Replace the
   `.cloud-feat*` rules in `cloud-hub.css` with `.cloud-tour-*`. Call
   `cloudWelcome.reset()` from `cloudHub.onOpen`.
6. **PRIVACY.md.** Change the phrase that says where the window opens from.
7. **Walk it** in the running app and record the walk in `outcome.md`: no
   server address; signed out on an open server; invite-only before and after
   joining, across a restart, and "Use another address"; signed in with and
   without a workspace; the sidebar hidden; interface zoom until the label
   drops; every tour step by Next, Back and dots with an email typed in the
   card; reopening the window; a light theme.
