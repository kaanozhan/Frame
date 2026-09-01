---
keywords: report staging, runtime assets, template drift, plan report, implement report, in-app viewer, report auto-open, command staging
related: spec-reports-one-shell-two-themes-in-app, deep-spec-plan, cli-spec-command-parity, implement-modes-v2, frame-bin-out-of-repo
---

# Report staging and opening — one staged copy, opened in Frame

## Problem

Frame's report pipeline leaks at both ends: the file the agent *reads* and the
window the result *lands in*.

**Two staged copies, one of them stale.** The same two assets —
`plan-report-template.html` and `build-implement-report.mjs` — are staged into
two directories by two mechanisms. `commandStaging.stageCommandFiles()`
(`src/main/commandStaging.js:119`) writes them to
`.frame/runtime/commands/<tool>/` on project open, init/enable and implement
dispatch. `specManager.stageCommandAsset()` (`src/main/specManager.js:567-586`)
writes them to `.frame/runtime/assets/` on every spec dispatch. They drift the
moment one trigger fires and the other does not. In this repo, today:

```
.frame/runtime/assets/plan-report-template.html                291 lines  (pre-shell, dark-only)
.frame/runtime/commands/claude-code/plan-report-template.html  440 lines  (current, two-theme shell)
```

and `{report_template_path}` (`specManager.js:523`) points at the 291-line one,
so `/spec.plan` builds its report from a template the in-app viewer classifies
as pre-shell. Frame's own documentation already names the *other* path
(`src/shared/frameTemplates.js:238-239`). `implement-launch.js:166-176` copies
`commands/` → `assets/` before running the generator, a bridge that hides the
split rather than closing it.

*How the split happened*, from the history: `stageCommandAsset` and
`{report_template_path}` came first, in `deep-spec-plan` T02 (`1403cec`,
2026-07-16), staging into `.frame/runtime/assets/` per dispatch. Six days later
`cli-spec-command-parity` introduced the generalized stager (T04, `bd06ea4`)
carrying the same two files in its `COMMAND_ASSET_FILES`, and T05 (`5fc8ed8`)
"routed all staging through commandStaging" — but it only removed
`stageImplementCommandFiles`. `stageCommandAsset` was left standing, read as a
separate concern (asset staging) rather than as the thing being superseded. The
same day, the docs work's T02 (`5f1e5d5`) wrote the placeholder table pointing
at `.frame/runtime/commands/<tool>/` for both paths. The documentation moved to
the new location; the substitution stayed on the old one, and they have
disagreed since.

**The report opens outside the app.** `spec-reports-one-shell-two-themes-in-app`
moved the **View Report** buttons from `shell.openPath` into an in-app viewer
(`src/renderer/reportSection.js`) so a report renders inside the window, in the
user's theme. The agent never got the same treatment: `spec.implement.md:305-320`
tells it to run the generator with `--open`, which shells out to `open` /
`xdg-open` (`build-implement-report.mjs:591`) and drops the report in the system
browser — exactly the behaviour that spec set out to remove. `/spec.plan` is the
mirror failure: it writes `plan-report.html` and opens nothing at all. So the
report the agent just produced either lands outside the window the user is
working in, or lands nowhere.

## Goal

1. **One staged copy.** `.frame/runtime/commands/<tool>/` is the only place
   Frame stages report assets, and every consumer — `specManager`'s
   interpolation, `scripts/spec-command-hint.js`, `implement-launch.js` — reads
   from there. `.frame/runtime/assets/` is written by nothing and gone from
   disk.
2. **The report opens where the user is.** When Frame is hosting the session,
   the report the agent generates opens as a Frame report tab, the same surface
   the **View Report** buttons already use. A terminal-launched run with no
   Frame window keeps today's browser fallback.

Done means: a `/spec.plan` and a `/spec.implement` run in an open Frame window
read the same current template the repo ships, and their reports appear in the
app without a browser window opening.

## Constraints

- **Staging must stay outside `app.asar`** — the CLI cannot read it, which is
  why assets stage per dispatch at all (`deep-spec-plan`).
  `.frame/runtime/commands/<tool>/` already satisfies this; only the location
  changes, not the reason.
- **This deliberately reverses a recorded constraint.**
  `spec-reports-one-shell-two-themes-in-app` names `.frame/runtime/assets/` as
  the staging location a shared shell must survive. That location is what this
  spec retires; the constraint's underlying requirement (the asset reaches the
  CLI on every dispatch) is preserved, not dropped.
- **Project overrides keep precedence and keep their freshness.**
  `.frame/templates/commands/<tool>/` wins via `loadCommandTemplate`'s existing
  resolution order (`cli-spec-command-parity`), and an override edited between
  project opens must still reach the next dispatch — the per-dispatch freshness
  `stageCommandAsset` provided cannot be lost when it is deleted.
- **The UI dispatch path must not regress** (`cli-spec-command-parity`).
- **Reports stay single self-contained HTML files** — inline CSS, no external
  assets, no scripts — and the generator stays Node 18 + stdlib, pure above
  `main()` (`deep-spec-plan`, `spec-reports-one-shell-two-themes-in-app`).
- **The viewer's rules hold**: never add `allow-scripts` to `.rpt-frame`; a
  report tab is keyed on `(projectPath, slug, kind)` and is not reused per type;
  a background re-read passes `notify=false`
  (`spec-reports-one-shell-two-themes-in-app`).
- **`--open` stays the fallback for terminal-launched autonomous runs**, where
  there is no Frame window to open a tab in (`implement-modes-v2`,
  `spec.implement.md:305-320`). Opening is best-effort and a failure never
  affects the run.
- **No second spec watcher.** `specManager` already watches `.frame/specs/`
  recursively and pushes `SPEC_DATA`; `reportSection` already re-reads on it
  behind an `mtimeMs` gate. Whatever drives auto-open builds on that.
- **The conductor runs several specs in parallel** in worktrees
  (`agent-orchestration`). Auto-open must not turn N parallel runs into N tabs
  appearing over the user's work.

## Success Criteria

- When any spec command is dispatched, then `{report_template_path}` and
  `{report_generator_path}` both resolve under `.frame/runtime/commands/<tool>/`,
  matching the placeholder table in `src/shared/frameTemplates.js:238-239`.
- When `/spec.plan`, `/spec.implement` and the `spec-command-hint` hook each
  hand an agent a report asset, then it is the same file, byte-identical to
  `src/templates/commands/<tool>/`.
- When a user edits `.frame/templates/commands/<tool>/plan-report-template.html`
  and dispatches a spec command without reopening the project, then the agent
  reads the edited file.
- When the app has run any staging path, then nothing has written
  `.frame/runtime/assets/`, and the directory no longer exists in this project.
- When `/spec.implement` runs its first (empty) report generation in a session
  Frame launched, then the report opens as a Frame report tab and no
  system-browser window opens.
- When `/spec.plan` finishes writing `plan-report.html` in a session Frame
  launched, then the plan report reaches the user the same way, rather than not
  opening at all.
- When the same run is launched from a terminal with no Frame window, then the
  report still opens in the system browser exactly as it does today, and a box
  with no opener still completes the run unaffected.
- When the autonomous mode regenerates `implement-report.html` after each task,
  then the already-open report updates in place and no additional tab appears.
- When `npm test` runs, then `test/implementLaunch.test.js` and
  `test/commandStaging.test.js` are updated to the single location and the suite
  is green.

## Out of Scope

- Report content, shell, palette and the in-app viewer's rendering
  (`spec-reports-one-shell-two-themes-in-app`).
- The **View Report** buttons on the three spec surfaces — they already open
  in-app and are unchanged.
- `/spec.plan`'s decision gate and `/spec.implement`'s mode selection
  (`deep-spec-plan`, `implement-modes-v2`).
- Regenerating reports already on disk that were built from the stale template,
  including `.frame/specs/in-app-feedback/plan-report.html` — a task, not this
  spec.
- A general-purpose agent→app command channel beyond what auto-open needs
  (`agent-dispatch`, `agent-orchestration` own the app→agent direction).
- Report export, print styles or sharing.

## Open Questions

1. **How the app learns a report is ready.**
   - Reuse the existing recursive `.frame/specs/` watcher and its `SPEC_DATA`
     push: the report file appearing *is* the signal. No new channel, but
     "the file changed" and "the agent wants you to look at it" are not the
     same event — every regeneration during an implement run fires it too.
   - Have the agent call a new `.frame/bin` command explicitly, adding an
     agent→app direction to the existing command bus: precise intent, at the
     cost of a channel to maintain and a step the agent can skip.
2. **What suppresses the browser open.**
   - The generator itself: skip `openInBrowser` when Frame's environment
     marker is present (`$FRAME_NODE` is already set only in a session Frame
     launched). One place, but it puts host-awareness in a pure-ish script.
   - The command template: stop passing `--open` when Frame hosts the session,
     leaving the generator dumb and the decision in the prompt Frame
     interpolates.
3. **Whether auto-open takes the foreground.**
   - Open in the background — the chip appears in the top bar, the current view
     is untouched. Safer for the conductor's parallel runs and for a user
     mid-edit.
   - Bring it to the front, matching what clicking **View Report** does.
4. **Whether the plan report auto-opens at all, or only the implement report.**
   The two differ in kind: a plan report is finished the moment it is written,
   while an implement report opens empty and fills over minutes. Auto-open may
   be right for one and noise for the other.
