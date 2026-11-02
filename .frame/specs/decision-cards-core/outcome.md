# Outcome — Decision cards core

## T01 — Card reader, store path and meta guard

Added `scripts/decision-cards.js`, which reads `.frame/decisions.jsonl` line by line: a torn or invalid line is skipped and reported by line number, an identical repeated id is dropped silently and a conflicting one reported, superseded cards leave the current set, and cards match by file or by spec-hint's token weights at score ≥ 3, rendered as full, compact or catalog lines. Validation is shape only; whether a source resolves and whether named ids exist is left to `decision.js add`, which has the project on disk. Added `frameStore.decisionsPath()` as a flat join with no legacy root fallback, `FRAME_FILES.DECISIONS`, `decisions.jsonl` in the data class and `ORCH_META_FILES`, and a `metaPathGuard` check that fails on a card-file join outside frameStore and pins the helper's literal. Beyond the plan, the helper also exports `relatedCards` (shared file weighs 3, plus the word score) for T02, and a card's word bag is its keywords, decision and file basenames, not its why.

_Captured: 2026-10-23 · 6 file change(s)_

---
## T02 — The decision.js writer and lookup CLI

Added `scripts/decision.js` with `add` (assigns the UTC date and the D11 id, checks D12 sources, refuses an unknown relation id, a repeated id or a line of 4 KB or more, warns on a missing file, and appends with one write on an O_APPEND descriptor, adding a newline first after a torn last line), `related` and `list`, all with `--json`. Registered `decision.added` (action: source kind, slug, relation) and `decision.rejected` (suppression: defect count) in `activityEvents.js` and `PRIVACY.md`, shipped both scripts through `structureBootstrap` and `build.files`, and allowed `Bash(node .frame/bin/decision.js *)` in both allow lists. Beyond the plan: `supersedes`/`extends` must name a *current* card (the refusal names the card that superseded it), `relatedCards` ranks shared files before word score, the helper gained `notesPath`/`findNotesEntry` so the writer and the T08 view resolve a notes source the same way, `FRAME_DECISION_DATE` pins the date for tests, and `decision.js` joined the spec-path mirrors in `metaPathGuard`.

_Captured: 2026-10-23 · 13 file change(s)_

---
## T03 — Union merge for the card file

`gitSharing.setMode` now calls a new `ensureFrameGitattributes`, which writes a managed `decisions.jsonl merge=union` block into `.frame/.gitattributes` in repo mode with the same marker surgery as the `.gitignore` block; the file name, markers and block live in `frameTemplates.js`. Local mode writes nothing and also leaves a block written earlier in place, because removing it would be a write in a mode meant not to touch the file. `test/gitSharing.test.js` covers the block, user lines surviving, local mode, a real two-branch merge with no conflict, and the same merge conflicting without the block.

_Captured: 2026-10-23 · 3 file change(s)_

---
## T04 — The decision-section instruction block

Added `frame:managed:decision-section` v1: a REFERENCE "Decision Cards (decisions.jsonl)" section (when to ask, one question naming the card from `decision.js related`, story plus `decision.js add`, the card's fields, the hand-append fallback, precedence over "You can add without asking the user") and a heading plus three-line AGENTS pointer, appended on open by `upgradeSpecDocs` after each document's spec section, the pointer only once REFERENCE carries the block. Beyond the plan: the decision blocks are classified separately and kept out of the docs-health report, so the UI popover stays about the spec section and a hand-written "Decision Cards" section is left alone without one; the prose never names `.frame/decisions.jsonl` as a path, because docsHealth reports every named `.frame/` path that is missing; new projects get the block on first open rather than in the init templates; and `docs-hint` delivers only the "On a yes" and "The card" subsections on a hand write (1428 characters). Existing upgrade tests now compare documents with the decision block stripped, and the "current" fixtures carry both blocks.

Followup: the docs-health popover cannot report an unmatched "Decision Cards" section; it is left alone silently.

_Captured: 2026-10-23 · 7 file change(s)_

---
## T05 — Cards as a close item

`spec-close-state.js` gained the `cards` item (missing while no current card has `source: spec:<slug>`), owed only when `decision.js` exists in `.frame/bin/` or `scripts/`. `spec-close.js` gained `ITEM_CHECKS.cards`, whose own reader names the card-file lines it skipped that belong to the spec, and a `cardShape` the template's new `### The cards` section repeats character for character; the template's close step now records the cards before running the check, and a fix that overturns a card writes a superseding one. Also added `{decision_script_path}` to both prompt builders and made the close wording in `activityEvents.js` and `PRIVACY.md` say "close items". Beyond the plan: when cards are not owed, the item is left out of `spec-close.js`'s report entirely, so such a project's output is byte-identical; card presence is memoized per card-file state because the reminder checks every closed spec on every hook call; older closed specs in a project with `decision.js` now count as missing cards, which only adds one `closed-earlier` quiet row per session; and, with the user's approval, the eval fixture's `fix-*` specs carry a card and `test/spec-close-fixture.test.js` writes one through `decision.js` next to its digest.

Followup: the fix-decision eval does not yet check for a superseding card.

_Captured: 2026-10-23 · 13 file change(s)_

---
## T06 — Cards at edit time and in spec-context

`spec-hint.js` pre-edit now looks up the file's current spec-less cards before the `no-history` return, sends the spec history unchanged and then a "Recorded decisions for <rel>" block, remembers shown card ids in the session state's new `cards` list, and records a `decision-edit` injection with a card count (`activityEvents.js` gained the mode and a `cards` field). Cards are what gives way under `inlineBudget()`: one line per card before any card is dropped, and a dropped card stays unmarked for a later edit; signal mode sends one pointer line, and a Codex `apply_patch` gets the same block. `spec-context.js --file` prints the file's spec-less cards after its history. Beyond the plan: a project with no index still returns `no-index` before cards are looked at, and `test/spec-hint.test.js` and the new `test/spec-context.test.js` pin no-card output byte-for-byte against the scripts at `8ce2aa8`, the commit before this spec.

_Captured: 2026-10-23 · 6 file change(s)_

---
## T07 — Cards in the /spec.new catalog and in task runs

`specManager.buildSpecCatalog` appends the current spec-less cards as `- card <id> · decision · keywords` lines after the specs, and `spec.new.md` gained one sentence saying how to weigh them; with no card file the catalog is unchanged. `buildTaskPrompt` takes `opts.cards` and adds at most two as one sentence after the task's own text, keeping the prompt on one line, and `tasksPanel.runTaskWithOptions` fills them through a never-failing lookup. Diverged from the sequencing: `LOAD_DECISION_CARDS` and its `projectInsights.loadDecisionCards` handler (returning `{ exists, cards, notes, malformed }`) landed here rather than in T08, with an `opts.match` that returns `matches` (at most two strong spec-less cards with their story pointer), because the renderer reads no files and the task run needed the cards now; the main process reads the file through `frameStore.decisionsPath()`.

_Captured: 2026-10-23 · 9 file change(s)_

---
## T08 — The Decision cards view

Added the "Decision cards" Context view: the pure `src/renderer/decisions/cardsModel.js` builds rows newest first, searches every word across decision, why, keywords and files, labels each source, and marks a notes source whose heading is gone as "story not found". `decisionCardsPanel.js` renders it with `decision-cards.css`; a card expands to its why, id, relation, keywords and files, a spec story opens through `specSection.open`, and a notes story expands its PROJECT_NOTES.md entry in place. Wired the Context nav row, `PANEL_REGISTRY.decisionCards`, the `index.html` container, the palette's "Go to Decision cards" and a `decisionCards.open` command that toggles the view like Sessions; the dock Decisions tab is untouched. The channel and handler had already landed in T07, and the view lists only current cards; the DOM host has no test harness (D10) and was not checked in a running app.

_Captured: 2026-10-23 · 10 file change(s)_

---
## T09 — Cards at prompt time

`spec-hint.js` prompt mode now sends at most two current spec-less cards that score 3 or more against the prompt (document frequency over every current card), skipping any card the session was already shown at edit or prompt time, and records a `decision-prompt` injection (`activityEvents.js` gained the mode). A prompt with no matching card takes the old path unchanged; with cards, `promptWithCards` sends the close reminder and related specs exactly as before and fits the cards into what is left under `inlineBudget()`, in full or one line each, leaving a card that does not fit unmarked for a later prompt. The pre-edit card block now shares the fitting code (`fitCards`, `cardLines`), and `test/spec-hint.test.js` pins threshold, cap, dedup across modes, both trimming paths, a Codex payload and byte-identical no-card prompts against `8ce2aa8`.

_Captured: 2026-10-23 · 3 file change(s)_

---
## Fix — Spec-flow decisions are not asked about, except how the project tests

Found in the manual test tour (E1): during `/spec.new` the agent wrote two choices into the spec (an empty name gives "Goodbye, there!", tests run with `node --test`) and then offered to record them as notes cards as well, because the decision section's exception named only implement. A yes would have recorded each choice twice, and the notes card would have reached agents by hook, against D6. The exception now covers the whole spec flow (`spec.new`, `spec.plan`, `spec.tasks`, `spec.implement`), with one exception of its own, set by the user: how the project tests (choosing or changing its test runner or test convention) belongs to the project, not the spec. In a new project with no testing record the spec cannot know whether the project tests at all, so that choice is still asked about like a chat decision and gets a `PROJECT_NOTES.md` story and a spec-less card that reaches later work; the per-spec test posture `/spec.plan` asks about stays in the spec. `DECISION_SECTION_VERSION` went from 1 to 2 so a project holding the v1 block gets the new text on open, and `test/specDocsUpgrade.test.js` pins both sentences.

_Captured: 2026-10-24 · 2 file changes_

---
## Fix — The cards view is "Decisions", the dock tab "Project Notes"

Found in the manual test tour (A5, G9): two surfaces carried the Decisions name, the cards view under Context (labelled "Decision cards") and the dock tab that lists `PROJECT_NOTES.md` entries. The user decided that Decisions now means the cards, without waiting for the dock tab to retire as D2 planned. The Context row, the view's heading, the palette's "Go to Decisions" and "Toggle Decisions", and the Activity rows ("Decision recorded…", "Decision refused…") now say Decisions. The dock tab, its heading and empty state, its status-bar icon, the View menu item, "Toggle Project Notes" and the guide's panel page and sketches now say Project Notes. What the dock tab lists is unchanged (D1), and the internal ids (`decisionCards`, `dock.decisions`, the `decisions` tab key) stay, so saved dock layouts and shortcuts carry over. At the user's choice no card was written, so card 20261023-7674f0 still calls the dock tab "Decisions".

_Captured: 2026-10-24 · 12 file changes_

---
