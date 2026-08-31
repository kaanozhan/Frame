# Plan — Feedback from inside Frame — an issue, an idea, or an email

> **Revised during implementation (2026-08-31).** The decisions below are
> marked where they were overturned; `spec.md`'s Revision history summarises
> why and `outcome.md` records each one in full.

## Architecture

### Resolved plan-time decisions

**Business**

- **D1 · Which address does the email path use?** (spec's open question,
  deferred here by the user) → **three personal inboxes**, rejected: a
  `frame.cool` alias. *Why:* the user has no mail domain yet (`frame.cool`
  appears in `landing/index.html` but no mailbox exists behind it). The
  addresses are therefore **not** inlined at the call site: they live in one
  exported constant `FEEDBACK_RECIPIENTS` (an array), which the final
  sequencing step existed solely to fill — the user's explicit instruction to
  keep it as the last task. **Settled 2026-08-31:** `kaanozhan@`,
  `denizmrtoglu@` and `berkayilmaz11@`. Because the list holds more than one,
  every recipient on a `mailto:` draft is visible to the others and so is
  every address to every reporter — put to the user with the alternatives (a
  group alias, or staying at one address) and accepted knowingly. A `TODO`
  beside the constant marks what retires it: an address Frame owns.

- **D2 · Does the feedback type change routing, or only the text?** (spec's
  open question) → planned as **a subject prefix on every channel *and* a
  GitHub label on the `gh` path**. ~~**Overturned twice (2026-08-31).**~~ The
  label went first: GitHub ignores a `labels=` parameter from anyone without
  triage permission, so once the CLI path was removed (D3) there was nowhere
  a label could be attached, and the target repository has none to attach
  anyway. The subject prefix went with the type selector: the kind became the
  tab, each tab has exactly one destination that already says what it is, and
  nothing about the type travels inside the report at all. The answer to the
  question is now **routing, and only routing**.

**Technical**

- **D3 · What happens when the label does not exist in `kaanozhan/Frame`?**
  → planned as **retry once without `--label`**. ~~**Overturned
  (2026-08-31): the `gh` path itself was removed**,~~ taking the retry, the
  failure classifier, `src/main/feedbackManager.js` and the IPC channel with
  it. *Why:* `gh issue create` publishes the moment it is called, under
  whichever account `gh` is signed into, so the reporter never sees the
  rendered markdown, cannot fix a sentence, and cannot drag in the screenshot
  this spec had already conceded no transport could carry. Both GitHub
  channels now open a prefilled form the reporter submits. The cost, accepted:
  no labels at all, and long reports meet the 6000-character URL threshold
  that argv did not have.

- **D4 · Test posture** → **pure logic and data transforms only**, rejected:
  everything testable (would add a stubbed harness around the main-process
  `gh` caller). *Why:* it matches the project's recorded convention — pure
  modules are tested, DOM-coupled renderer surfaces are not, because no DOM
  harness exists (`.frame/PROJECT_NOTES.md` → `## Testing`). Two of the spec's
  success criteria already demand exactly this (S7, S9). Consequence for the
  design below: **every decision worth asserting is pushed out of the panel
  and out of the main-process wrapper into the one shared module.**

- **D5 · Where does the composer live?** → **`src/shared/feedbackReport.js`**,
  a module with no Electron import, required by both the renderer panel and
  the main process. Decided silently: `src/shared/activityEvents.js` is the
  same shape (pure policy, both sides, `test/activityEvents.test.js`), and the
  testing record lists `src/shared/` as covered. Anything else would either
  make the composer untestable or duplicate it across the process boundary,
  which the spec's "one composer, no exceptions" constraint forbids.

- **D6 · Panel, not modal.** Decided silently: success criterion S1 requires
  the nav row to highlight *while its surface is open*, and the highlight is
  driven by `getActiveSurface()` (`multiTerminalUI.js:548-558`), which reports
  `panel:<key>` for `PANEL_REGISTRY` entries and knows nothing about modals. A
  modal could not satisfy S1 without inventing a second surface concept.

- **D7 · Opening URLs needs no new IPC.** Decided silently: the renderer
  already calls `shell.openExternal` directly (`frameSettingsModal.js:123`,
  `terminalTabBar.js:310`). Planned to add exactly one channel for the `gh`
  child process; **with that path removed (D3) the feature adds none at all**
  and touches the main process only for the telemetry event's registry entry.

- **D8 · URL length thresholds.** Decided silently, as named constants with
  their reasoning in the module: `email` **1800** characters (Windows'
  `ShellExecute` truncates around 2048, the tightest handler of the three
  platforms) and the GitHub forms **6000** characters (the front end rejects
  over-long query strings around the 8 KB request-line ceiling; an issue form
  and a discussion form are the same front end, so `github_issue` and
  `github_discussion` share the number). Both are the full encoded URL, not
  the body alone, and both sit below their real limit on purpose: the failure
  mode they prevent — a window that opens empty — is invisible to Frame, so
  the numbers must be conservative rather than exact.

- **D9 · Draft lifetime.** Decided silently: the panel keeps its draft in
  module state while the app runs and clears it only after a delivery
  succeeds. This is what makes S4's "the draft is not lost" true for free —
  closing the panel after a failed `gh` call and reopening it finds the text
  still there.

### The shape

Three tabs, one composer, three thin transports, and **one table that joins
them**. The composer is the only code that ever builds a subject or a body;
the transports receive that finished pair and turn it into a URL.

```
feedbackPanel (renderer, DOM)
    │  the active tab  +  { title, description }
    │  +  { appVersion, os }  only if that kind attaches them
    ▼
src/shared/feedbackReport.js  ── the one composer, no Electron import
    FEEDBACK_TYPES             → per kind: label, channel, attachesDiagnostics,
                                 fields, placeholders, action, note
    validate(draft)            → { ok, errors }
    diagnosticsLines(diag)     → the exact lines the form shows AND the body carries
    compose(draft, diag?)      → { subject, body }          ← the only body builder
    issueUrl(subject, body)      → github.com/…/issues/new?title=&body=
    discussionUrl(subject, body) → github.com/…/discussions/new?category=ideas&…
    mailtoUrl(subject, body)     → mailto:…?subject=&body=
    deliveryFor(channel, …)    → { url, mode: 'url' | 'clipboard' }
    │
    ├─ Bug          → shell.openExternal(issueUrl(…))
    ├─ Feature idea → shell.openExternal(discussionUrl(…))
    └─ Reach us     → shell.openExternal(mailtoUrl(…))
```

Three properties fall out of this arrangement, and each maps to a spec
constraint:

- **The kind decides everything** (C4). One row of `FEEDBACK_TYPES` holds the
  tab's label, its prompts, its channel and whether it attaches diagnostics.
  The panel renders that table; it does not branch on it, and a tab cannot
  exist in the markup and be unknown to the composer because the tab strip is
  rendered from the same table.
- **A transport cannot drift** (C5). `issueUrl`, `discussionUrl` and
  `mailtoUrl` all take `subject` and `body` as opaque strings and only encode
  them. None concatenates, re-orders or appends. The byte-identity in S8 is not
  a convention the transports agree to honour — it is the only thing they are
  able to do.
- **The form shows what it sends** (C6, C7). `diagnosticsLines()` produces the
  preview block in the panel *and* the Environment section of the body, from
  the same call. The two cannot disagree, because they are the same array —
  and for a kind that attaches nothing, neither exists.

### Diagnostics, exactly

Two values, no more (C7, S10): Frame's version
(`require('../../package.json').version`, the path `frameSettingsModal.js:94`
already uses) and the OS (`process.platform` + `os.release()`). No project
path, no project name, no remote, no file contents — nothing the panel does
not literally display above the send button.

The feedback type was a third line and is not one any more: the kind is the
tab, which the destination already announces, and a diagnostics block that
repeats the subject teaches the reader to skim it. `compose()` takes the
diagnostics as an **optional** argument, which is the whole mechanism behind a
kind that attaches nothing — with none there is no Environment section at all,
not an empty one and not one full of `unknown`. Feature idea is that kind: an
idea does not depend on the machine it occurred on.

### Why there is no `gh` path

The plan built one (D3, Sequencing step 3) and it was removed the same day it
landed. `gh issue create` publishes at once, under whichever account `gh` is
signed into: the reporter sees the issue only after it exists, cannot fix a
sentence, and cannot attach a screenshot — the one thing this spec had already
conceded no transport could carry, and the one thing a browser form does
carry. Both GitHub channels therefore open a prefilled page, and
`src/main/feedbackManager.js`, `FEEDBACK_CREATE_ISSUE`, `ghIssueArgs()` and
`classifyGhFailure()` are all gone.

What the fixed repository constant (C2) protects is unchanged: `FEEDBACK_REPO`
lives in the shared module because both GitHub URL builders read it, so the
issue path and the discussion path cannot end up pointing at different
repositories. `githubManager` is left alone precisely because it is
project-scoped (`setProjectPath`), and putting Frame's own repository into it
would blur that.

**Prerequisite.** The discussion URL depends on Discussions being enabled on
`kaanozhan/Frame` with the default `ideas` category — confirmed with the user
on 2026-08-31. If it were off the URL would 404, and Frame cannot see that,
which is the same class of invisible failure the URL thresholds guard against.

### Oversize handling (S7)

One rule, all three channels, in one function. `deliveryFor()` builds the full
URL; if it exceeds the channel's threshold (D8) it returns `mode: 'clipboard'`
and a URL carrying only the subject. The panel then writes the body to the
clipboard (`clipboard.writeText`, as `fileTreeUI.js:458` does), opens the
short URL and says so through `notify.info`. The user never meets an empty
compose window with no explanation.

### Where it plugs in

The Frame nav group's mechanics are untouched (C10): one more entry in the
`frame` group's `items` array, with the same `{ view, icon, label, open,
surfaces }` shape every other row has, `surfaces: ['panel:feedback']`, and one
more entry in `PANEL_REGISTRY`. Nothing about grouping, collapse state
(`frame-nav-groups`) or the collapsed-header highlight needs to change — both
loops that drive the highlight already iterate `WORKSPACE_NAV_ITEMS` and
`WORKSPACE_NAV_GROUPS` (`projectListUI.js:419-433`), so S1 is satisfied by
adding data, not code.

The panel element follows `#activity-panel`'s contract exactly: hidden by
default, `.visible` toggled by the module's own `show()`/`hide()`, a `×` that
calls `hide()` — which is what `_renderPanelView`'s MutationObserver watches to
route back to the terminals view (`multiTerminalUI.js:453-462`). `.panel-inline`
(`panels.css:5417`) already normalises width and transform for the inline host.

### Telemetry (C9, S11)

One event, added to the registry and to `PRIVACY.md` in the same change:

```js
feedback_submitted: { channel: ['github_issue', 'github_discussion', 'email'] }
```

Enum-only, like every other entry. The renderer fires it with
`ipcRenderer.send(IPC.TELEMETRY_TRACK, …)` — the path `orchestrator.js:98`
uses — and `validateEvent()` (`telemetryEvents.js:72-83`) drops anything not
in the enum, so no title, description or diagnostic value can leak through
even by accident.

## Files

**New**

- `src/shared/feedbackReport.js` — the one composer: the kinds table,
  recipients, validation, `compose()`, the three transport builders and the
  oversize decision. No Electron import.
- `src/renderer/feedbackPanel.js` — the surface: the tab strip rendered from
  `FEEDBACK_TYPES`, one draft per kind, the diagnostics preview where a kind
  attaches one, and the send. Uses `notify.js` and `htmlUtils.escapeHtml` only.
- `src/renderer/styles/components/feedback.css` — the panel's styles, built on
  `activity.css`'s panel contract, with the tab strip following
  `githubPanel`'s `.github-tabs` shape.
- `test/feedbackReport.test.js` — the composer's tests (see Sequencing).

**Modified**

- `index.html` — `<div id="feedback-panel">` markup, next to `#activity-panel`,
  with an empty tab strip the renderer fills.
- `src/renderer/multiTerminalUI.js` — one `PANEL_REGISTRY` entry.
- `src/renderer/projectListUI.js` — one row in the `frame` nav group.
- `src/renderer/styles/main.css` — one `@import`.
- `src/main/telemetryEvents.js` — the `feedback_submitted` event.
- `PRIVACY.md` — the matching row in the event table.

*(`src/shared/ipcChannels.js` and `src/main/index.js` were modified for the
`gh` path and restored when it was removed — the feature adds no IPC.)*

## Footprint

- src/shared/feedbackReport.js
- src/renderer/feedbackPanel.js
- src/renderer/styles/components/feedback.css
- test/feedbackReport.test.js
- index.html
- src/renderer/multiTerminalUI.js
- src/renderer/projectListUI.js
- src/renderer/styles/main.css
- src/main/telemetryEvents.js
- PRIVACY.md

> Collision note: `audit-q3-performance-resources` is still in phase
> `implementing` and claims `index.html` and `src/main/index.js` in its
> footprint (last touched 2026-08-26). The overlaps here are additive and in
> different regions of both files — a `<div>` beside `#activity-panel`, and
> one `setupIPC` line — but the orchestrator will flag them, so schedule these
> two specs apart rather than in parallel.

## Dependencies

None, and no new IPC either. The email channel deliberately adds no package
and no outbound call (C1); every channel is a URL handed to
`shell.openExternal`. One external prerequisite that is not code: Discussions
enabled on `kaanozhan/Frame`.

## Sequencing

> **What actually happened.** Steps 1–4 were executed as written (T01–T10),
> then revised in place on 2026-08-31: the `gh` path of step 3 was removed,
> the body became markdown, the panel split into three tabs, and a feature
> idea moved to Discussions. `outcome.md` carries an entry per change; the
> steps below are left as they were planned, because they are what the task
> list executed.

1. **The composer, with its tests.** Write `src/shared/feedbackReport.js`:
   `FEEDBACK_TYPES` (id, label, GitHub label), `FEEDBACK_RECIPIENTS`,
   `URL_LIMITS`, `validate()`, `diagnosticsLines()`, `compose()`,
   `mailtoUrl()`, `issueUrl()`, `ghIssueArgs()`, `deliveryFor()`,
   `classifyGhFailure()`. Write `test/feedbackReport.test.js` in the same
   step, asserting: the subject and body are byte-identical across all three
   transport builders (S7); the body is exactly the user's text plus the three
   diagnostic lines the form shows, and nothing else (S9); an empty title or
   an empty description fails validation (S8); a body past a channel's
   threshold returns `mode: 'clipboard'` with a subject-only URL (S6); and
   `classifyGhFailure` recognises a missing label distinctly from an auth or
   network failure (D3). Nothing else in the repo changes yet — the module is
   complete and proven before anything consumes it.

2. **The surface, delivering through the two URL channels.** Add the
   `#feedback-panel` markup to `index.html`, write
   `src/renderer/feedbackPanel.js` (form, live diagnostics preview from
   `diagnosticsLines()`, inline validation messages, two send buttons), add
   the `feedback` entry to `PANEL_REGISTRY`, add the Feedback row to the
   `frame` nav group, and add `feedback.css` with its `main.css` import. Wire
   **both URL transports**: email via `mailtoUrl()` and GitHub via
   `issueUrl()`, each through `shell.openExternal`, each routed through
   `deliveryFor()` so the oversize rule applies from the first working
   version. Email reports as handed off, never as sent (S5). At the end of
   this step feedback works end to end without any main-process change, on a
   machine with no `gh` at all — which is the state of the developer's own
   machine today.

3. **The direct `gh` path.** Add `FEEDBACK_CREATE_ISSUE` to `ipcChannels.js`,
   write `src/main/feedbackManager.js` (fixed repo constant, `execFile('gh',
   ghIssueArgs(…))`, the single label-less retry when `classifyGhFailure`
   returns `label_missing`, a result object for every outcome), register it in
   `src/main/index.js`, and have the panel try it first for the GitHub
   channel — opening the created issue on success, falling to step 2's browser
   URL on every failure, with a toast only when something actually went wrong
   (S2, S3, S4).

4. **Telemetry, declared and documented together.** Add `feedback_submitted`
   with its `channel` enum to `src/main/telemetryEvents.js`, fire it from the
   panel on each successful delivery with the channel that actually carried
   the report, and add the matching row to `PRIVACY.md` in the same change
   (C9, S10).

5. **The real recipient list.** Replace `FEEDBACK_RECIPIENTS`'s temporary
   single entry with the addresses the user supplies, and — if it ends up
   holding more than one — confirm that mutual visibility on a `mailto:` draft
   is acceptable before shipping it. This step is deliberately last and
   deliberately separate: it is the one thing in this plan that waits on
   information the user does not have yet (D1).
