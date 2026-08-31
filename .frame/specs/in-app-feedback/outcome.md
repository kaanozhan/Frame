# Outcome — Feedback from inside Frame — an issue or an email

## T01 — The composer's core: types, recipients, validation, diagnostics and compose()

Wrote `src/shared/feedbackReport.js` with `FEEDBACK_TYPES` (each carrying its default GitHub label per D2), `FEEDBACK_RECIPIENTS` (the temporary single address D1 settled on, T11 replaces it), `typeById`, `validate`, `diagnosticsLines` and `compose` — no Electron import. `diagnosticsLines()` returns the same array the panel will render and `compose()` appends, so the preview and the body cannot drift; `compose()` normalises CRLF before building anything, so two channels can't differ by invisible bytes. `test/feedbackReport.test.js` asserts the body by exact equality rather than by matching expected substrings — only equality catches a fourth line joining the three. No deviation from plan.md.

_Captured: 2026-08-30 · 2 file change(s)_

---

## T02 — The three transports, and the one oversize rule

Added `mailtoUrl()`, `issueUrl()`, `ghIssueArgs()`, `URL_LIMITS` (email 1800, github_browser 6000 per D8), `deliveryFor()` and `githubLabelsFor()` to `src/shared/feedbackReport.js`. Deviation from plan.md: the fixed `kaanozhan/Frame` target lives here as `FEEDBACK_REPO` rather than in `feedbackManager.js` — `ghIssueArgs()` and `issueUrl()` both need it, and two constants would be two repositories waiting to diverge; `feedbackManager` will take it through `ghIssueArgs()`. The builders omit an empty `body` param so the oversize path yields a genuinely subject-only URL, and the tests read each transport back apart (URL parsed, argv indexed) with a URL-hostile body rather than trusting the builders.

_Captured: 2026-08-30 · 2 file change(s)_

---

## T03 — Reading `gh`'s failures well enough to retry the right one

Added `GH_FAILURE_PATTERNS` and `classifyGhFailure(stderr)` to `src/shared/feedbackReport.js`, returning `label_missing`, `not_authenticated`, `no_network` or `failed` — never null, so the panel's ladder always has a rung to land on. `label_missing` is matched first: a failed run can name both the label and the API, and it is the only code that changes Frame's behaviour (D3's single label-less retry). Tests cover the stderr shapes `gh` actually emits for each class, plus the negative case that nothing generic is mistaken for a label problem. No deviation from plan.md.

_Captured: 2026-08-30 · 2 file change(s)_

---

## T04 — The panel's shell: markup, registry entry, styles

Added `#feedback-panel` to `index.html` beside `#activity-panel`, the `feedback` entry to `PANEL_REGISTRY` (`multiTerminalUI.js:43`), and `src/renderer/styles/components/feedback.css` with its `main.css` `@import`. Deviation: `src/renderer/feedbackPanel.js` was created here rather than in T06, holding only the container contract (`show`/`hide`/`.visible` + close button) — esbuild resolves `PANEL_REGISTRY`'s lazy `require()` statically, so registering a panel whose module does not exist breaks `npm run build`; T06 still writes the form, which is what its task text describes. The panel is 440px rather than Activity's 380px because a description field in a 380px column reads as a comment box.

_Captured: 2026-08-30 · 5 file change(s)_

---

## T05 — The Feedback row, next to Activity

Added one row to the `frame` group in `WORKSPACE_NAV_GROUPS` (`src/renderer/projectListUI.js:301`) in the shape every other row uses, with `surfaces: ['panel:feedback']`. No nav mechanics touched: the highlight loops already iterate `WORKSPACE_NAV_ITEMS` and `WORKSPACE_NAV_GROUPS`, so S1 — including the collapsed-header highlight — is satisfied by data alone. No deviation from plan.md.

_Captured: 2026-08-30 · 1 file change(s)_

---

## T06 — The form: three fields, the diagnostics preview, a draft that survives

Filled in `src/renderer/feedbackPanel.js`: type buttons, title, description, the diagnostics block rendered straight from `diagnosticsLines()`, per-field error nodes, and the draft in module state so a failed send is survivable (D9). Picking a type re-renders instead of swapping a class — the type is one of the three diagnostics, so changing it must change what the preview promises. `submit()` validates, then calls `compose()` once before the channel is known, and hands the pair to an empty `deliver()` seam that T07 fills, so `submit()` never grows a per-channel branch. Escapes through `htmlUtils.escapeHtml` only.

_Captured: 2026-08-30 · 1 file change(s)_

---

## T07 — Email and browser, both through the same delivery rule

Filled `deliver()` in `src/renderer/feedbackPanel.js`: `deliveryFor()` decides, `clipboard.writeText()` carries the body when the URL would be oversize, `shell.openExternal()` opens the `mailto:` draft or the prefilled new-issue page, and the draft is cleared only after the open succeeds. Email is reported as handed off ("send it from there"), never as sent (S5). A failed clipboard write aborts before opening anything — a short URL with nothing on the clipboard is precisely the empty compose window the oversize rule exists to prevent. The GitHub button's channel id is `github_browser`, matching `URL_LIMITS` and the telemetry enum T10 will register. No deviation from plan.md.

_Captured: 2026-08-30 · 1 file change(s)_

---

## T08 — The `gh` wrapper, and the one retry that saves a report

Added `FEEDBACK_CREATE_ISSUE` to `src/shared/ipcChannels.js` and wrote `src/main/feedbackManager.js`: `execFile('gh', ghIssueArgs(…))` with a 20s timeout, one label-less retry when `classifyGhFailure` returns `label_missing` (D3), and a result object for every outcome — it never throws. `ENOENT` is answered before classification, because a machine without `gh` is the browser path rather than a failure. Registered in `src/main/index.js` beside `githubManager.setupIPC`. Per T02's note the fixed repo comes from `ghIssueArgs()` rather than a second constant here.

_Captured: 2026-08-30 · 3 file change(s)_

---

## T09 — The GitHub ladder: `gh` first, the prefilled page after

The **File an issue** button now routes through `fileOnGitHub()` in `src/renderer/feedbackPanel.js`: invoke `FEEDBACK_CREATE_ISSUE`, and on success open the created issue, toast, clear the draft. `gh_missing` falls through to `deliver('github_browser', …)` in silence — it is absent from `GH_FAILURE_MESSAGES` on purpose, because a machine without `gh` is the ordinary case, not a failure (S3). Every other reason is named through `notify.error` before the same browser page opens, draft intact (S4). Added a `sending` guard: `gh issue create` is the one slow channel and a second click would file the report twice.

_Captured: 2026-08-30 · 1 file change(s)_

---

## T10 — One event, one enum, documented in the same change

Registered `feedback_submitted: { channel: ['github_cli', 'github_browser', 'email'] }` in `src/main/telemetryEvents.js`, added its `PRIVACY.md` row in the same commit (C9), and fired it from `feedbackPanel.js` on each successful delivery with the channel that actually carried the report — `github_cli` from the direct path, `github_browser` and `email` from `deliver()`, whose channel ids already are the enum values. Verified directly that `validateEvent('feedback_submitted', { channel: 'carrier_pigeon', title: 'secret' })` returns `{}`. The send is wrapped in try/catch so telemetry can never break a delivery.

_Captured: 2026-08-30 · 3 file change(s)_

---

## Follow-up — the `gh` path removed, and why that overturns T08/T09

The GitHub channel now always opens the prefilled new-issue page; `gh issue create` is gone, and with it `src/main/feedbackManager.js`, the `FEEDBACK_CREATE_ISSUE` channel, `ghIssueArgs()`, `classifyGhFailure()`, `githubLabelsFor()` and the panel's ladder. This reverses `plan.md` Sequencing step 3 and the ladder decision at `spec.md:57` deliberately: `gh` publishes the moment it is called, under whichever account it is signed into, so the reporter never sees the rendered markdown, cannot fix a sentence, and — the decisive one — cannot attach the screenshot that `spec.md:124` already conceded the CLI path could not carry.

Two costs accepted rather than solved. Labels can no longer be attached at all: the repository has none today, and GitHub silently drops a `labels=` URL parameter from anyone without triage permission, so D2's subject prefix is now the only triage signal — which is why `githubLabel` left `FEEDBACK_TYPES` instead of moving to the URL. And long reports meet the 6000-character threshold that `gh`'s argv did not have, falling to the clipboard path (S6) more often than before. The telemetry enum lost `github_cli` in `telemetryEvents.js` and `PRIVACY.md` together, as C9 requires.

What survived untouched is the invariant the spec was built on: one `compose()`, transports that may only encode, and a preview that shows what the body will carry.

_Captured: 2026-08-31 · 9 file change(s)_

---

## Follow-up — the body shaped for the reader it now has

With GitHub's form as the only issue path, the body is read rendered rather than as argv, so `compose()` now emits markdown: `### Environment` and a `- ` bullet per diagnostic, in place of the bare `---` rule and three loose lines that GitHub collapsed into a run-on paragraph. `DIAGNOSTICS_SEPARATOR` became `DIAGNOSTICS_HEADING`. Still one body for both channels — a mail reader sees the literal `###` and `-`, which is the price of the invariant that the form can preview what it sends before a channel is chosen.

`diagnosticsLines()` lost its third line: the feedback type is already the subject's prefix on every channel, and a diagnostics block that repeats the subject teaches the reader to skim it. That drops the panel's `diagnostics()` down to two values, retires the reason the type buttons re-rendered (they still do — the buttons are drawn from `draft`), and moves the note under the form to "the two lines above" (S9). Bold labels were considered and rejected: the list already separates the values, and `**` is noise in a plain-text draft.

_Captured: 2026-08-31 · 3 file change(s)_

---

## Follow-up — two types with their own prompts, and a validator both tabs can use

`FEEDBACK_TYPES` is now `bug` and `feature` only, each carrying a `placeholders: { title, description }` pair, and `validate(draft, { requireType })` accepts a typeless draft when the caller asks. This is the shared half of a scope revision: the panel splits into an **Issue** tab and a **Reach us** tab, and the tab — not the reporter — decides the channel. `other` left the list because Reach us replaces it; what remains is exactly what belongs in a public tracker.

The placeholders are data here rather than a branch in the panel because they are the difference between the two types: a bug is narrated, a feature request is argued, and asking both "what happened instead?" gets one of them wrong.

`compose()` needed no change at all. It already emitted a prefix-less subject for a draft with no type, and the diagnostics stopped reading the type in the previous change — so both tabs share one composer and both carry the Environment section, including Reach us (the user reversed an earlier decision to strip it there, and that reversal is what kept this function untouched). The panel still holds its own hardcoded placeholder strings until the next task wires these in.

_Captured: 2026-08-31 · 2 file change(s)_

---

## Follow-up — Issue and Reach us, and the choice the reporter no longer makes

The panel is now two tabs in `githubPanel`'s established shape (`.feedback-tabs`, a `--bg-tertiary` strip under the header with a 2px underline on the active one, matching `.github-tabs` in `panels.css`). **Issue** keeps the type buttons — now reading their placeholders from `FEEDBACK_TYPES`, so picking Bug or Feature request changes what both fields ask for — and files through `issueUrl`. **Reach us** drops the type entirely, labels its fields Subject and Message, and leaves through `mailto:`. The one send button says what it will do, and its note says why the Issue path opens a page: screenshots and edits belong to the reporter, on GitHub, before they submit.

This retires the two-buttons-on-one-form design of T07/T09. Offering both channels asked the reporter a question they cannot answer — they know what they have, not which transport suits it — while the tab split asks one they can, and splits by visibility at the same time: an issue is public and signed with their own GitHub account, a mail is not. That second point is what makes assuming a GitHub account on the Issue tab defensible, since Reach us is there for everyone else.

Two drafts live in module state and each is cleared only by its own successful delivery, so moving between tabs loses neither. Both tabs carry the same Environment block: the tab chooses the channel, never what the body may say (S8 unchanged). Telemetry needed nothing — `channel` is still `github_browser` or `email`, only now the tab decides it rather than a button.

Verified with `npm test` (512) and `npm run build`; the rendering itself is untested, as D4 records — there is still no DOM harness in this repo.

_Captured: 2026-08-31 · 3 file change(s)_

---

## T11 — The real recipients, and the note about the day they change

`FEEDBACK_RECIPIENTS` now holds the three people who actually read Frame's feedback, replacing the placeholder single entry. D1's condition is met explicitly rather than by omission: `mailto:` puts all three in the draft's `To:` field, so every reporter who opens the Reach us tab reads all three addresses and each recipient sees the others — put to the user with the alternatives (a group alias, or staying at one address) and accepted knowingly.

A `TODO` sits with the list naming what retires it: an address Frame owns, a `frame.cool` mailbox or a group alias. It is worth the comment because the fix really is one line — `mailtoUrl()` reads the list, no call site names an address, and no other part of the flow knows who the recipients are.

This was the spec's last pending task, and the one that always had to wait on information the plan could not supply.

_Captured: 2026-08-31 · 3 file change(s)_

---

## Follow-up — three kinds, three destinations, and an idea that is not a defect

The panel is now Bug · Feature idea · Reach us, and the kind decides everything: `FEEDBACK_TYPES` grew into one table holding each kind's channel, field labels, placeholders, button label, note, and whether it attaches diagnostics. The type selector is gone — the tab is the kind — and the tab strip is rendered from that table rather than written into `index.html`, so a tab cannot exist in the markup and be unknown to the composer.

A feature idea now opens a prefilled discussion (`discussions/new?category=ideas&title=&body=`, GitHub's documented prefill parameters) instead of an issue. A proposal is not a defect: in a tracker it becomes an unassigned task that reads as a rejection when closed, while a discussion can be argued, upvoted, and converted into an issue by GitHub the day the work is committed to. It attaches no diagnostics, so `compose(draft)` without diagnostics now yields the description alone — no Environment section, not an empty one and not one full of `unknown`. The prerequisite is real and confirmed with the user: Discussions is enabled on `kaanozhan/Frame`, and were it off the URL would 404 where Frame could not see it.

Two things retired with the type selector. The `[Bug]` subject prefix, because every kind now has exactly one destination that already says what it is — which took the last type logic out of `compose()`. And `validate()`'s type check, since no draft carries a kind to be wrong about. `URL_LIMITS` renamed `github_browser` to `github_issue` and gained `github_discussion`; `deliveryFor()` picks its builder from a table and returns a null URL for a channel it does not know, so an unrouted kind cannot open a mystery window. The telemetry enum and its `PRIVACY.md` row moved together, as C9 requires.

Committed as one change rather than two: the module renames the channel the panel routes on, so splitting them would have left a commit whose renderer opened nothing.

_Captured: 2026-08-31 · 6 file change(s)_

---
