# UX & error-feedback hardening

> Audit-sourced findings spec (Q3 2026 deep-dive review). Captured, not yet planned — recorded via the `audit-q3` study.

## Problem

The dominant theme across the renderer is **silent failure**: operations that fail
leave the user with no signal at all — no toast, no inline message, at best a
`console.error` the user never sees. When something goes wrong, the user usually
does not find out.

**1. Silent terminal / Frame creation failures.** Every "create a lane (Frame)"
call-site treats a falsy return from `manager.createTerminal(...)` as a no-op
instead of an error:
- `src/renderer/laneBoard.js:301-308` — `_createLane` awaits `createTerminal`, then `if (id) this.onEnterLane(id)`. Falsy `id` → nothing happens, no message.
- `src/renderer/terminalTabBar.js:463-467` — `if (id && this.onLaneCreated) this.onLaneCreated(id)`. Same silent drop.
- `src/renderer/multiTerminalUI.js:339-342` — `createTerminalForCurrentProject().then((id) => { if (id) this.enterLane(id); })`. No `else`.
- `src/renderer/multiTerminalUI.js:425-429` — `_newLaneInCell`: `if (!newId) return;`. Silently returns.
The user clicks "New Frame", nothing appears, and there is no explanation.

**2. Task write failures discarded.** `src/renderer/tasksPanel.js:89-93` — the
`TASK_UPDATED` IPC handler only acts when `success` is truthy (`if (success) { /* data sent separately */ }`).
A failed create/update/delete (`success:false`) falls through to an empty branch.
The panel *has* a `showToast` (`src/renderer/tasksPanel.js:386`) but it is never
wired into this failure path, so a write that silently fails to `tasks.json`
looks identical to success.

**3. Confirmation modals confirm on Enter regardless of focus (destructive).**
- `src/renderer/taskConfirmModal.js:43-48` — the keydown handler fires `confirm()` (delete) on *any* Enter while the modal is visible. The inline comment claims "Enter triggers Delete (matches the focused button)", but focus is ignored: a user who Tabs to **Cancel** and presses Enter still **deletes the task**.
- `src/renderer/taskRunModal.js:64-71` — same pattern for the run modal: Enter always calls `confirm()` (launches a Frame / runs the task), except when typing in the branch-name field. Cancel-focused Enter still runs.
This inverts the safe default for irreversible actions ("will be removed permanently. This action can't be undone.").

**4. No shared notification layer — copy-paste sprawl.** There is no central
toast/notify module. Three private, divergent `showToast` implementations exist
(`src/renderer/tasksPanel.js:386`, `src/renderer/githubPanel.js:411`,
`src/renderer/pluginsPanel.js:409`), plus `_showToast` in
`src/renderer/agentDispatch.js:586`. Because the toast lives *inside* individual
panels, most modules (terminal board, spec surfaces, command palette) have no
way to surface an error at all and fall back to `console.error`. Additionally
**15+ duplicate `escapeHtml` copies** exist across the renderer
(`overviewPanel.js:331`, `githubPanel.js:455`, `pluginsPanel.js:458`,
`taskRunModal.js:193`, `cheatSheet.js:129`, `specSection.js:478`,
`laneDetailRail.js:59`, `taskSection.js:274`, `commandPalette.js:148`,
`specsDashboard.js:569`, `specPanel.js:845`, `tasksPanel.js:659`,
`welcomeOverlay.js:215`, `laneRail.js:44`, `structureMap.js:1210`), and the
tasksPanel toast interpolates its `message` into `innerHTML` **unescaped**
(`src/renderer/tasksPanel.js:398`).

**5. Loading / boot has no failure surface.** `src/renderer/appLoader.js:33-35`
hides the splash after a 10s `FAILSAFE_MS` if `WORKSPACE_DATA` never arrives —
but silently. If the main process failed to load workspace state, the user is
dropped into a blank/empty app with zero explanation of what went wrong. (Prior
audits noted the same shape in git-status mislabeling and the gh-CLI "Loading"
spinner that never times out.)

**6. Discoverability vs. cognitive-model churn.** The command palette
(`src/renderer/commandPalette.js`) and cheat sheet (`src/renderer/cheatSheet.js`)
are solid and stay in sync via `commandRegistry`, and empty states are mostly
well-written ("No agents running — pick an agent and hit Start."). But the
**naming model has churned repeatedly** — PROJECT_NOTES documents Lane → Frame →
Mainframe → Home (`PROJECT_NOTES.md:724,740,750,776`). The UI now says
"Frame"/"Home" while the code, module names, DOM ids, and this spec's own
evidence still say "lane" (`laneBoard.js`, `laneRail.js`, `btn-lane-home`,
`_createLane`). "Frame" is knowingly overloaded (the app, a unit "frame", and
`.frame/`). This split vocabulary is a latent onboarding/support hazard.

**7. Dead/parked affordances left in the DOM.** `index.html:57-68`
(`#parked-project-actions`, `hidden`) keeps the "Start Claude Code" and
"Initialize as Frame Project" buttons wired but unreachable ("kept in the DOM …
until they get a new home"). The init-frame flow and `ai.startSession` command
have no surfaced entry point, so a documented capability is effectively
undiscoverable.

## Goal

Establish a single, consistent error/feedback discipline in the renderer:

1. **One shared notification module** (e.g. `renderer/notify.js`) exposing
   `notify.error/success/info(message)` — mounted on `document.body`, HTML-safe,
   used by every module. Replace the three `showToast` copies + `agentDispatch`
   `_showToast`.
2. **An error-surfacing standard**: every awaited IPC/`createTerminal` call that
   can fail must route the failure to `notify.error(...)`, never a bare
   `console.error` or empty branch. Wire the four terminal-create sites and the
   `TASK_UPDATED` `success:false` path.
3. **Fix the destructive-confirm defaults**: Enter must respect the focused
   button (or default to the *safe* action), so Cancel-focused Enter cancels.
4. **Boot/loading failure surface**: when `appLoader` failsafe fires without
   data, show a "couldn't load workspace" state instead of a silent blank app.
5. **Consolidate `escapeHtml`** into one shared helper and escape the tasksPanel
   toast message.
6. **Reconcile the vocabulary** (decide: finish the lane→frame rename in code, or
   document the internal/UI split) and give the parked project-actions a real
   home or remove them.

## Constraints

- **Renderer modules are CommonJS with `nodeIntegration`** (`require('electron')`
  in each file); the shared notify/escape helpers must follow the same
  `module.exports` pattern and be `require`-able without a bundler step.
- **Consolidate, don't fork**: there are already 15+ `escapeHtml` and 3–4
  `showToast` copies — the fix is to unify existing behavior (body-mounted toast,
  4000ms for errors / 2000ms otherwise per `tasksPanel.js:412`), not add a 5th
  variant.
- Follow Frame's "only do what the user asks" principle — this is hardening, not
  a redesign; keep existing IPC channels and data flows intact.
- The naming reconciliation must respect the deliberate decision to keep "lane"
  in internal code names (`PROJECT_NOTES.md:744`) — pick a rule and apply it
  consistently rather than half-renaming.

## Success criteria

- Creating a Frame when the backend returns falsy shows a visible error toast at
  all four call-sites (`laneBoard.js:301`, `terminalTabBar.js:463`,
  `multiTerminalUI.js:339,425`).
- A failed `tasks.json` write (`success:false` on `TASK_UPDATED`) produces a
  visible error toast; success is unchanged.
- In both confirm modals, pressing Enter while **Cancel** is focused cancels (or
  Enter defaults to the non-destructive action); the destructive path requires an
  explicit Confirm/Delete activation.
- Exactly one `notify` module and one `escapeHtml` helper are `require`d across
  the renderer; no toast interpolates unescaped user text.
- If `WORKSPACE_DATA` never arrives, the user sees an explanatory failure state,
  not a blank app.
- Grep shows no remaining bare `console.error`-only failure handling on
  user-triggered create/write actions in the audited files.

## Out of scope

- Visual redesign / restyling of toasts, modals, or the Home board beyond what a
  shared component requires.
- Security findings (unescaped-HTML/XSS surface, IPC trust) — tracked separately
  in `.frame/FINDINGS-2026-07-02.md`; only the incidental `escapeHtml`
  consolidation overlaps here.
- The larger Lane-as-work-context model deferred in `PROJECT_NOTES.md:731`.
- Orchestration/worktree conductor flows.

## Open questions for /spec.plan

- Should Enter in the confirm modals **cancel** (safe default) or **respect the
  focused button**? The latter is more standard but requires managing initial
  focus on Cancel.
- New module name and location: `renderer/notify.js` vs folding into an existing
  utility; where should the shared `escapeHtml` live?
- Naming reconciliation scope: finish the lane→frame rename in code/DOM ids
  (larger, riskier diff) or just document the intentional internal/UI split and
  stop there?
- Parked `#parked-project-actions` buttons — do they get a real home (which
  surface?) or get removed along with `ai.startSession` wiring?
- For the boot-failure state, does the main process already emit a distinguishable
  error signal, or does the renderer only have the timeout to infer failure?
