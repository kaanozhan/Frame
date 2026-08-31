# Tasks — Feedback from inside Frame — an issue, an idea, or an email

> **Left as executed.** T01–T11 are what the implement loop actually ran.
> Four of them were later reversed on purpose — T02 and T03 (the `gh` argv and
> its failure classifier), T08 and T09 (the `gh` wrapper and its ladder) — and
> T01's three diagnostic lines are now two. See `spec.md`'s Revision history
> and the follow-up entries in `outcome.md`; the texts below are not edited,
> because they are the record of what was done, not of what stands.

- T01 · Create `src/shared/feedbackReport.js` with `FEEDBACK_TYPES`, `FEEDBACK_RECIPIENTS`, `validate()`, `diagnosticsLines()` and `compose()` — no Electron import — and cover it in `test/feedbackReport.test.js`: an empty title or description fails validation, and the body is the user's text plus exactly the three shown diagnostic lines (Frame version, OS, type) and nothing else.
- T02 · Add the transport builders `mailtoUrl()`, `issueUrl()`, `ghIssueArgs()` plus `URL_LIMITS` and `deliveryFor()` to `src/shared/feedbackReport.js`, with tests asserting all three carry a byte-identical subject and body and that a body past a channel's threshold returns `mode: 'clipboard'` with a subject-only URL.
- T03 · Add `classifyGhFailure(stderr)` to `src/shared/feedbackReport.js`, with a test proving a missing label is recognised distinctly from an authentication, network or generic failure.
- T04 · Add the `#feedback-panel` markup to `index.html` beside `#activity-panel`, register `feedback` in `PANEL_REGISTRY` in `src/renderer/multiTerminalUI.js`, and add `src/renderer/styles/components/feedback.css` with its `@import` in `main.css`.
- T05 · Add the Feedback row to the `frame` group in `WORKSPACE_NAV_GROUPS` (`src/renderer/projectListUI.js`) with `surfaces: ['panel:feedback']`, changing no nav mechanics.
- T06 · Write `src/renderer/feedbackPanel.js` — type, title and description fields, the diagnostics preview rendered from `diagnosticsLines()`, inline validation messages, the draft held in module state, and the `show()`/`hide()`/`.visible` contract `#activity-panel` uses — escaping through `htmlUtils.escapeHtml` and reporting through `notify.js` only.
- T07 · Wire the email and browser transports in the panel through `deliveryFor()` and `shell.openExternal`: report email as handed off rather than sent, write the body to the clipboard and say so when the URL is oversize, and clear the draft only after a delivery succeeds.
- T08 · Add `FEEDBACK_CREATE_ISSUE` to `src/shared/ipcChannels.js` and write `src/main/feedbackManager.js` — `execFile('gh', ghIssueArgs(…))` against the fixed `kaanozhan/Frame` target, one label-less retry when `classifyGhFailure` returns `label_missing`, a result object for every outcome — registered in `src/main/index.js`.
- T09 · Have the panel try `gh` first for the GitHub channel and walk the ladder: open the created issue on success, fall silently to the prefilled browser page when `gh` is absent, and on any other failure name it through `notify.error` before opening that same page with the draft intact.
- T10 · Register `feedback_submitted` with its `channel` enum in `src/main/telemetryEvents.js`, fire it from the panel on each successful delivery with the channel that carried the report, and add the matching row to `PRIVACY.md` in the same change.
- T11 · Replace `FEEDBACK_RECIPIENTS`' temporary single entry with the final address list, confirming mutual recipient visibility on a `mailto:` draft is acceptable if it holds more than one.
