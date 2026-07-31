# Plan — Project Settings — git sharing and spec-driven become real, per-project choices

## Architecture

### Resolved plan-time decisions

- **Gear on every row (asked — business).** The project row's hover `×` becomes a
  gear on *all* rows, Frame and non-Frame alike. For a non-Frame project the
  Project Settings modal shows only the header (name, path) and "Remove from
  Frame"; the Workflow and Sharing sections are absent. Rationale: one
  affordance everywhere, and a natural home for future per-project actions.
- **Test posture: pure logic only (asked — technical).** Matches the recorded
  convention (node --test over `test/*.test.js`, pure main/shared modules,
  Electron stubbed where unavoidable). In scope: `gitSharing.js` (derivation,
  state matrix, `.frame/.gitignore` writer), `gitExclude` explicit-mode
  override, config-template changes, the new telemetry event, and the init
  options via the existing stubbed `frameProjectInit.test.js` harness. Renderer
  modal/hint stay untested — no DOM harness exists (testing record: renderer
  "Not covered").
- **Sharing hint copies the spec-driven hint pattern (asked — technical).**
  New standalone `sharingHint.js` mirroring `specDrivenHint.js`; no shared
  popover extraction. Rationale: zero risk to working, untested renderer code;
  honors the project rule against refactors riding along.
- **Mode values are `local` / `repo`, not `private` / `team` (asked — business,
  post-plan).** Stored enum, telemetry enum and state labels all use
  mechanism names; UI copy reads "Local to this machine" / "Shared in the
  repository". Rationale: "team" mislabels the solo multi-machine/backup use
  case and reads wrong in the D3 effective-mode display; "private" overpromises
  in already-private repos; `local`/`repo` matches the `.frame/.gitignore`
  "machine-local" vocabulary and git's own scope naming. A follow-up decision
  then removed team language from the product surface entirely: the discovery
  hint's button reads "Share in the repository" and its module is
  `sharingHint.js`.
- **New main module `src/main/gitSharing.js` (silent).** D5 requires
  `gitExclude` to stay ignorant of the config format and `frameProject → gitExclude`
  to stay one-way, so the sharing logic can live in neither. `gitSharing.js`
  composes `gitExclude`, does its own JSON read-modify-write of
  `.frame/config.json` (preserving unknown keys, the `detectProject` precedent),
  and is Electron-free so it tests under `node --test` like `gitExclude`.
  Dependency direction: `frameProject → gitSharing → gitExclude`.
- **`gitExclude.ensure(projectPath, mode?)` (silent, from D5).** Optional
  explicit mode: `'repo'` → never write the block, strip ours if present;
  `'local'` or absent → today's conditional logic. D3 is not weakened: a
  tracked `.frame/` removes the block regardless of a `'local'` argument.
- **IPC surface (silent).** `GET_GIT_SHARING_STATE` (invoke, `projectPath` →
  `{ isRepo, declared, tracked, effective }`) serves the modal *and* the init
  modal's "hide sharing choice when not a git repo" — it must not require
  `.frame/` to exist. `SET_GIT_SHARING` (invoke, `{ projectPath, mode }`) is the
  single write path used by both the modal toggle and the hint's "Share in the
  repository" button. `GET_SHARING_REPO_SIGNAL` (invoke, `projectPath` →
  `{ hasRemote, authorCount }`) is separate so the two `git log`-class reads run
  only when the hint evaluates, not on every state read.
- **`.frame/.gitignore` content (silent).** Signed header comment (same
  `managed by Frame` marker discipline as `gitExclude`), then the machine-local
  paths relative to `.frame/`: `runtime/`, `index/`,
  `implement-permissions.json`, `worktrees/`, `orchestration/`, `bin/`, plus
  the fsSafe crash-safety artifacts `*.bak`, `*.tmp`, `*.corrupt-*` (the
  "(+ .bak)" in the spec's table, generalized to all fsSafe suffixes so
  repo-mode projects never commit `tasks.json.bak` either). Rewrites replace only
  the signed block; unsigned user-added lines are preserved — `stripOurs`
  semantics. Written unconditionally at init (D2) and on every Frame-project
  open, which is how pre-upgrade projects gain it (acceptance 3).
- **Telemetry `source` values (silent, from D8).** `'init'` fires from the
  init handler; every later change — modal toggle *and* hint button — goes
  through `SET_GIT_SHARING` and reports `'settings'`. The registry rule
  requires a matching PRIVACY.md update in the same change
  (`telemetryEvents.js:14-15`), so PRIVACY.md is in this plan's footprint.
  This is additive event documentation — the stale privacy *copy* in App
  Settings stays untouched (spec non-goal).
- **D4 derivation only inside a git repo (silent).** In a non-repo folder
  there is no mode to derive; `settings.gitSharing` stays absent and the state
  reports `isRepo: false` (matrix's "toggle disabled" row). Derivation +
  persist happens on first state resolution of a Frame project in a repo.
- **`specDrivenHint` re-anchors to the project gear (silent).** App Settings
  loses the Workflow section, so the hint's anchor (`sidebar-settings-btn`)
  and its "Settings → Workflow" copy both go stale. The hint keeps its exact
  behaviour (flag write via `SET_SPEC_DRIVEN`, dismissal, refresh — acceptance
  7) but anchors to the active project row's gear and its copy points at
  Project Settings. While either hint is showing, the anchored gear gets a
  class that forces it visible (it is hover-revealed otherwise, and a popover
  cannot point at nothing).
- **In-flight footprint collision, declared (silent).** `audit-q3-performance-resources`
  (implementing) holds `src/main/frameProject.js` and `index.html` in its
  footprint. This plan declares both honestly; the orchestrator's collision
  detection will serialize the two specs. No content conflict is expected —
  that spec's changes there are perf-instrumentation-shaped.

### Data shapes

- `.frame/config.json` gains `settings.gitSharing: "local" | "repo"` (D1).
  New-project template `settings` block contains *only* `gitSharing` — the
  three dead flags leave the template (G6); existing configs are never
  rewritten to drop them (non-goal).
- Sharing state object (main → renderer):
  `{ isRepo: boolean, declared: 'local'|'repo'|null, tracked: boolean, effective: 'local'|'repo'|null }`.
  `effective` implements D3: `tracked → 'repo'` regardless of `declared`;
  the S4 warning renders exactly when `declared === 'local' && tracked`.
- Init IPC payload (`INITIALIZE_FRAME_PROJECT`) gains
  `options: { specDriven: boolean, gitSharing: 'local'|'repo' }`; the main
  handler threads it into `runProjectInit`, which (a) passes the mode to the
  pre-mkdir `gitExclude.ensure` call and (b) bakes both answers into the
  config template — written once, never written-then-rewritten (D5).
- Sharing-hint signal (D7, all local):
  `hasRemote` = `git remote` output non-empty; `authorCount` = distinct
  author emails over `git log -n 200 --format=%ae`. Hint shows iff
  `hasRemote && authorCount > 1 && effective === 'local' && !dismissed`.
  Dismissal lives in user settings keyed by project path
  (`sharingHintDismissed`), the `specDrivenHint.markDismissed` precedent.

### Key components

- `src/main/gitSharing.js` — the one owner of sharing semantics:
  `getState(projectPath)`, `resolveMode(projectPath)` (D4 derive-once-persist),
  `setMode(projectPath, mode)` (config write → `gitExclude.ensure(path, mode)`
  → `.frame/.gitignore` rewrite; never touches the index — C1/C2),
  `ensureOnOpen(projectPath)` (resolve + ensure + gitignore, replaces the bare
  `gitExclude.ensure` in the open path), `writeFrameGitignore(projectPath)`,
  `getRepoSignal(projectPath)`.
- `src/renderer/projectSettingsModal.js` — modal per the spec's four sections;
  spec-driven toggle logic moves here verbatim from `settingsModal.js`
  (including snap-back on failure, `markDismissed` on disable,
  `specDrivenHint.refresh()`); Git Sharing section renders from
  `GET_GIT_SHARING_STATE` per the behaviour matrix, S4 warning with
  copy-command button; Remove reuses `projectListUI.confirmRemoveProject`
  (newly exported).
- `src/renderer/sharingHint.js` — `specDrivenHint` pattern pointed at the D7
  condition, anchored to the active row's gear; "Share in the repository" calls
  `SET_GIT_SHARING` (the same path as the modal — S11).

## Files

- **New** `src/main/gitSharing.js` — sharing state: derive/persist/read, mode
  transitions, `.frame/.gitignore` writer, repo signal. Electron-free.
- **New** `src/renderer/projectSettingsModal.js` — Project Settings modal
  (Workflow / Sharing / Remove), opened from the row gear and the hints.
- **New** `src/renderer/sharingHint.js` — repo-mode discovery popover.
- **New** `src/renderer/styles/components/project-settings-modal.css` — modal
  styles (follows `settings-modal.css` vocabulary).
- **New** `src/renderer/styles/components/sharing-hint.css` — hint styles
  (mirrors `spec-driven-hint.css`).
- **New** `test/gitSharing.test.js` — D4 derivation, state matrix rows,
  `setMode` side effects on tmp git repos, gitignore writer idempotence and
  unsigned-line preservation, repo signal parsing.
- **Modified** `src/main/gitExclude.js` — optional explicit `mode` parameter on
  `ensure()` (D5/D3).
- **Modified** `src/main/frameProject.js` — init options threading, pre-mkdir
  ensure with mode, `.frame/.gitignore` at init, `ensureOnOpen` in
  `CHECK_IS_FRAME_PROJECT`, new IPC handlers, `project_sharing_set` tracking.
- **Modified** `src/shared/frameTemplates.js` — `getFrameConfigTemplate(name, options)`:
  dead flags out, `settings.gitSharing` in, `features.specDriven` from option.
- **Modified** `src/shared/ipcChannels.js` — `GET_GIT_SHARING_STATE`,
  `SET_GIT_SHARING`, `GET_SHARING_REPO_SIGNAL`.
- **Modified** `src/main/telemetryEvents.js` — register `project_sharing_set`
  `{ mode: ['local','repo'], source: ['init','settings'] }`.
- **Modified** `PRIVACY.md` — document the new event (registry rule).
- **Modified** `index.html` — init-modal options block; Project Settings modal
  markup; App Settings Workflow section deleted.
- **Modified** `src/renderer/projectListUI.js` — `×` → gear on every row
  (opens Project Settings); export `confirmRemoveProject`.
- **Modified** `src/renderer/settingsModal.js` — spec-driven wiring removed.
- **Modified** `src/renderer/specDrivenHint.js` — anchor to active row gear,
  copy points at Project Settings; behaviour otherwise identical.
- **Modified** `src/renderer/state.js` — init confirm reads the two options and
  sends them in the payload.
- **Modified** `src/renderer/index.js` — init `projectSettingsModal` and
  `sharingHint`.
- **Modified** `src/renderer/styles/main.css` — import the two new component
  stylesheets.
- **Modified** `test/gitExclude.test.js` — explicit-mode cases: `'repo'` never
  writes / strips existing; `'local'` + tracked still removes (D3).
- **Modified** `test/frameTemplates.test.js` — template has `gitSharing`, no
  dead flags; `specDriven` follows the option.
- **Modified** `test/frameProjectInit.test.js` — init with
  `{ gitSharing: 'repo' }` on a tmp repo: config says repo, no exclude block
  ever written, `.frame/.gitignore` present (acceptance 2), via the existing
  Electron-stub harness.
- **Modified** `test/telemetry.test.js` — `project_sharing_set` passes
  `validateEvent` in-enum and is stripped/rejected out-of-enum (S12).

## Footprint

- src/main/gitSharing.js
- src/main/gitExclude.js
- src/main/frameProject.js
- src/main/telemetryEvents.js
- src/shared/frameTemplates.js
- src/shared/ipcChannels.js
- src/renderer/projectSettingsModal.js
- src/renderer/sharingHint.js
- src/renderer/projectListUI.js
- src/renderer/settingsModal.js
- src/renderer/specDrivenHint.js
- src/renderer/state.js
- src/renderer/index.js
- src/renderer/styles/main.css
- src/renderer/styles/components/project-settings-modal.css
- src/renderer/styles/components/sharing-hint.css
- index.html
- PRIVACY.md
- test/gitSharing.test.js
- test/gitExclude.test.js
- test/frameTemplates.test.js
- test/frameProjectInit.test.js
- test/telemetry.test.js

## Dependencies

None.

## Sequencing

1. **Sharing core (main, pure).** Add the optional `mode` parameter to
   `gitExclude.ensure()`; create `src/main/gitSharing.js` with `getState`,
   `resolveMode` (D4), `setMode`, `ensureOnOpen`, `writeFrameGitignore`
   (signed block, unsigned lines preserved), `getRepoSignal`. Author
   `test/gitSharing.test.js` and the new `test/gitExclude.test.js` cases with
   this step.
2. **Template + telemetry registry.** `getFrameConfigTemplate(name, options)`:
   remove `autoUpdateStructure` / `autoUpdateNotes` / `taskRecognition`, add
   `settings.gitSharing`, take `features.specDriven` from the option (default
   true). Register `project_sharing_set` in `telemetryEvents.js` and document
   it in PRIVACY.md. Extend `test/frameTemplates.test.js` and
   `test/telemetry.test.js` with this step.
3. **Main-process wiring.** `INITIALIZE_FRAME_PROJECT` accepts `options`;
   `runProjectInit` passes the mode to the pre-mkdir ensure, bakes both
   options into the template write, and writes `.frame/.gitignore`;
   `CHECK_IS_FRAME_PROJECT` calls `gitSharing.ensureOnOpen` instead of bare
   `gitExclude.ensure`; add `GET_GIT_SHARING_STATE`, `SET_GIT_SHARING`
   (fires `project_sharing_set` with `source: 'settings'`),
   `GET_SHARING_REPO_SIGNAL` handlers; init success fires the event with
   `source: 'init'`. Extend `test/frameProjectInit.test.js` (repo-mode init:
   acceptance 2) with this step.
4. **Init modal options.** Options block in `index.html`'s
   `initialize-frame-modal` (Spec-Driven checkbox default on; Git Sharing
   choice default Local, hidden when `GET_GIT_SHARING_STATE.isRepo` is
   false); `state.js` reads both and sends them in the payload.
5. **Project Settings modal + gear.** Modal markup in `index.html`,
   `projectSettingsModal.js`, `project-settings-modal.css` (+ `main.css`
   import); `projectListUI.js` replaces `×` with a gear on every row and
   exports `confirmRemoveProject`; non-Frame projects get header + Remove
   only; the Sharing section renders the full state matrix including the S4 warning
   with copy button and the disabled non-repo state; `index.js` wires init.
6. **App Settings slimdown + spec-driven relocation.** Delete the Workflow
   section from `index.html`'s settings modal and its wiring from
   `settingsModal.js`; the same toggle semantics now live in the Project
   Settings Workflow section; `specDrivenHint.js` re-anchors to the active
   row's gear (forced visible while shown) with copy pointing at Project
   Settings.
7. **Sharing hint.** `sharingHint.js` + `sharing-hint.css` (+ `main.css`
   import, `index.js` init): evaluate on project change via
   `GET_GIT_SHARING_STATE` + `GET_SHARING_REPO_SIGNAL`, dismissal in user
   settings keyed by project path, "Share in the repository" through
   `SET_GIT_SHARING` — the same write path as the modal toggle.
