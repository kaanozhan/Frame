# Outcome — project-settings

## T01 — Explicit mode parameter on `gitExclude.ensure()`

Added an optional `mode` parameter to `ensure(projectPath, mode)` in src/main/gitExclude.js: `'repo'` joins the tracked check in the removal branch, so the block is never written and an existing one is stripped; `'local'`/absent keep the conditional logic with tracked state still overriding (D3). Extended test/gitExclude.test.js with four mode cases: repo-mode never writes, repo-mode strips an existing block, local behaves as default, local on a tracked repo still removes. No deviation from plan.md; full suite green (326 tests).

_Captured: 2026-07-30 · 2 file change(s)_

---

## T02 — `src/main/gitSharing.js`, the sharing-semantics owner

Created src/main/gitSharing.js (Electron-free): `getState` returning `{ isRepo, declared, tracked, effective }` with D3's tracked-wins rule, `resolveMode` deriving and persisting an absent mode once (D4), `setMode` as the single write path (config → ensure(mode) → gitignore, index never touched), `ensureOnOpen`, `writeFrameGitignore`, and `getRepoSignal` (remote presence + distinct authors over 200 commits). The `.frame/.gitignore` signed block uses begin/end marker comments rather than gitExclude's comment-plus-one-line form — the block is multi-line, so an explicit end marker is what keeps unsigned user lines safe; contents per plan (runtime/, index/, implement-permissions.json, worktrees/, orchestration/, bin/, *.bak, *.tmp, *.corrupt-*). Authored test/gitSharing.test.js: 24 cases over derivation, the state matrix, setMode side effects on tmp repos, gitignore idempotence/preservation, and the repo signal.

_Captured: 2026-07-30 · 2 file change(s)_

---

## T03 — Config template: dead flags out, gitSharing in, specDriven from options

`getFrameConfigTemplate(name, options)` in src/shared/frameTemplates.js: dropped `autoUpdateStructure`/`autoUpdateNotes`/`taskRecognition` (never had a reader), `settings` now holds only `gitSharing` (from `options.gitSharing`, invalid values fall back to `'local'`), and `features.specDriven` comes from `options.specDriven` (default true). The sole caller (`frameProject.js:189`) still passes one argument and gets identical-to-today defaults until T05 threads the init options through. Three new cases in test/frameTemplates.test.js.

_Captured: 2026-07-30 · 2 file change(s)_

---

## T04 — Register the `project_sharing_set` telemetry event

Added `project_sharing_set: { mode: ['local','repo'], source: ['init','settings'] }` to the registry in src/main/telemetryEvents.js and its row to PRIVACY.md's collection table (the registry rule: event and doc land in the same change). Extended test/telemetry.test.js with in-enum pass-through and out-of-enum/unknown-prop stripping. The stale privacy copy in App Settings stays untouched per the spec's non-goal.

_Captured: 2026-07-30 · 3 file change(s)_

---

## T05 — Main-process wiring: init options, open path, sharing IPC

Threaded `options: { specDriven, gitSharing }` through `initializeFrameProject → runProjectInit`: the mode drives the pre-mkdir `gitExclude.ensure(path, mode)` (repo mode never writes the block), both answers bake into the single config-template write, and `.frame/.gitignore` is written at init. `CHECK_IS_FRAME_PROJECT` now calls `gitSharing.ensureOnOpen` instead of bare `gitExclude.ensure`, which is how pre-upgrade projects gain derivation and the gitignore. Added GET_GIT_SHARING_STATE / SET_GIT_SHARING / GET_SHARING_REPO_SIGNAL invoke handlers (constants in ipcChannels.js); `project_sharing_set` fires with source `'init'` on init success and `'settings'` from SET_GIT_SHARING. Three new init-harness tests cover repo-mode init (acceptance 2), local default, and the specDriven option.

_Captured: 2026-07-30 · 4 file change(s)_

---

## T06 — Init modal options block

Added the options block below the init modal's no-write note in index.html: Spec-Driven checkbox (default on) and the Git Sharing radio pair ("Local to this machine" / "Shared in the repository", default local), the sharing group hidden until GET_GIT_SHARING_STATE reports `isRepo: true`. `state.js` resets both options on every open and reads them into `options` on confirm, sent in the INITIALIZE_FRAME_PROJECT payload. Divergence from plan.md: the block's styles went into `src/renderer/styles/components/panels.css` (not in the plan's Files list) because that file already owns every `init-modal-*` rule.

_Captured: 2026-07-30 · 3 file change(s)_

---

## T07 — Project Settings modal + the row gear

Built the modal (markup in index.html reusing the settings-modal class vocabulary, logic in new projectSettingsModal.js, styles in new project-settings-modal.css imported from main.css): header with name/path, Sharing section rendering the full state matrix from GET_GIT_SHARING_STATE (toggle disabled with "Not a git repository" outside a repo; S4 warning with a copyable `git rm -r --cached .frame` when local is declared but `.frame/` is tracked; snap-back on failed writes through SET_GIT_SHARING), and Remove reusing the newly exported `projectListUI.confirmRemoveProject`. The row `×` became a lucide Settings gear on every row (non-Frame projects get header + Remove only); a hidden Workflow section placeholder awaits T08. Gear/modal require each other lazily to avoid a module cycle; `.hint-anchored` (forces the hover-revealed gear visible) ships in the CSS for T08's re-anchoring.

_Captured: 2026-07-30 · 6 file change(s)_

---

## T08 — App Settings slimdown, spec-driven relocation, hint re-anchor

Deleted the Workflow section from App Settings (index.html) and all its wiring from settingsModal.js (element refs, change listener, `syncSpecDrivenToggle`, `setSpecDrivenNote`, the state/specDrivenHint imports); the toggle now lives in Project Settings' Workflow section with the semantics moved verbatim — snap-back on failure, `markDismissed` on disable, `specDrivenHint.refresh()` — operating on the modal's project rather than the active one. Re-anchored specDrivenHint.js from `sidebar-settings-btn` to the active row's gear via a `getAnchor()` query, adding `.hint-anchored` to force the hover-revealed gear visible while the popover shows, copy now pointing at Project Settings → Workflow. App Settings retains only Privacy & Analytics and About.

_Captured: 2026-07-30 · 4 file change(s)_

---

## T09 — Sharing hint

Built sharingHint.js on the specDrivenHint pattern (plus sharing-hint.css mirroring spec-driven-hint.css, main.css import, index.js init): evaluated on project change, showing only when GET_GIT_SHARING_STATE reports effective `local` in a repo AND GET_SHARING_REPO_SIGNAL reports a remote plus >1 distinct author, with the cheap state gate checked before the git-log-class signal reads. "Share in the repository" writes through SET_GIT_SHARING — the same path as the modal toggle — and dismissal persists in user settings under `sharingHintDismissed` keyed by project path. Beyond plan: the hint yields when the spec-driven hint is already showing on the same gear, since two popovers on one anchor is noise.

_Captured: 2026-07-30 · 4 file change(s)_

---

## Follow-up — both hints became unanchored bottom-left notices

Post-spec change on the user's call: neither hint anchors to anything now; both are fixed notices in the window's bottom-left corner, where the spec-driven one effectively sat before T08 (it pointed at the sidebar's Settings button). Dropped `getAnchor`, `position()`, the resize listeners and the `.hint-anchored` rule; the anchor-existence gate in `evaluate()` went with them, which also closes the race where a hint could silently never appear because the project list hadn't rendered its gear yet. The gear itself is unchanged and still hover-revealed; the "one notice at a time" yield remains, now because both claim the same corner.

_Captured: 2026-07-31 · 5 file change(s)_

---

## Follow-up — T09 reverted: the sharing hint is gone

Post-spec removal on the user's call, overturning T09 deliberately rather than
letting it rot. The reasoning is an asymmetry between the two notices: the
spec-driven hint reports a **broken state** (flag off → the AI's specs never
reach the Specs panel; the user cannot deduce this), while the sharing hint
advertised a **working choice** — local mode is valid and nothing malfunctions
in it. Against that thin justification stood three costs: the trigger guessed
team intent from git log (`hasRemote && authorCount > 1` over 200 commits), so
rebased history, bot committers and other people's clones all fired it; its
primary button performed an outward-facing change (`.frame/` into everyone's
`git status`, from a corner popover, one click); and it needed a yield rule
against the other notice, which is the tell that the second popover was one
too many. The discovery gap it targeted stays covered on both ends — the init
modal asks both questions (T06) and Project Settings → Sharing states the mode
in words. `getRepoSignal` went with it: its only consumer was this hint, and
dead code with passing tests reads as live code. The Sharing feature itself,
its modal section, `getState`/`resolveMode`/`setMode`/`writeFrameGitignore`
and the `project_sharing_set` telemetry are all untouched. Files touched:
`src/renderer/sharingHint.js` (deleted),
`src/renderer/styles/components/sharing-hint.css` (deleted),
`src/renderer/index.js`, `src/renderer/styles/main.css`,
`src/shared/ipcChannels.js`, `src/main/frameProject.js`,
`src/main/gitSharing.js`, `test/gitSharing.test.js`, `STRUCTURE.json`.

_Captured: 2026-07-31 · 9 file change(s)_

---

## Follow-up — the spec-driven hint stops nagging

Two behaviour fixes on the surviving notice, both from watching it in use.
It now steps aside while Project Settings is open (`suspend()`/`resume()`,
called from the modal's `open`/`close`): the notice's whole message is "the
switch is in Project Settings", so with that modal open it has nothing to say
— and it sits below modal z-indexes, so left alone it rendered *behind* the
overlay. That also settles a race where a hint scheduled moments before the
gear was clicked appeared under the open modal, which read as "Frame shows
this when you enter Settings". Second, `render()` now adds the project to
`sessionSuppressed`, so the notice is said at most once per project per
session: leaving a project and coming back is navigation, not a request to
hear it again. The persisted "Don't show again" list is unchanged and remains
the only forever-silence. Files touched: `src/renderer/specDrivenHint.js`,
`src/renderer/projectSettingsModal.js`.

_Captured: 2026-07-31 · 2 file change(s)_
