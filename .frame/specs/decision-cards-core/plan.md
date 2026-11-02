# Plan — Decision cards core

## Architecture

### Resolved plan-time decisions

Business:

- **D1 · Which view shows cards.** The dock's Decisions tab keeps listing `PROJECT_NOTES.md` entries, unchanged, until the migration branch retires it. A new view lists only cards. A card expands to its why, keywords and files, and its story opens from it. *User: "Bu yeni Decisions paneli sadece kartları göstersin."* This replaces the spec's "Decisions view shows cards".
- **D2 · Where the new view lives** (follows from D1). It lives in the left nav, Context group, as "Decision cards". It is a center view registered like Sessions. This partly overturns `dock-panel-readonly-views` D1 ("read-only views live in the dock") for this one view. Add, undo and delete stay in step 4b. The label changes to "Decisions" once the dock tab retires. *User chose the nav over a second dock tab.*
- **D3 · Old content.** Converting this repo's spec-less notes (56 by the evidence count, not 44) and its digests into cards moves to the migration branch. The core ships the mechanism and no converted cards. The review flow is recorded for that branch: draft all, flag doubtful ones, the PR is the final gate. *User.* This removes the spec's G8/S11 from this plan.
- **D4 · A spec's cards at close.** Every closing spec writes at least one card. "Missing" means no current card has `source: spec:<slug>`. The reminder reaches only the closing session, and `done` is never blocked. *User, over an explicit "no decision" marker.*
- **D5 · Prompt-time delivery** is in the core as its last delivery step. Per prompt it sends at most 2 cards, on a strong match only, and each card at most once per session. *User.* Many spec-less decisions name no file, so this is their only reliable moment.
- **D6 · Spec cards are never delivered by a hook.** They are written, checked and listed in the view. Whether a card replaces a spec's line is decided by the final measurement (roadmap step 7). *From the spec, silent.*

Technical:

- **D7 · Writing.** Cards are written through `.frame/bin/decision.js add`. The script validates the card, assigns its id and date, and appends one line with a single `O_APPEND` write (under 4 KB). The instruction also gives the line's exact shape, so an agent whose project lacks the script can append the line by hand. *User.*
- **D8 · Finding the related card.** Before asking, the agent runs `decision.js related --files … --keywords …`. It lists current cards that share a file or a keyword, ranked; the agent picks the relevant one and names it in the question. This mirrors `/spec.new`'s catalog: the script guarantees recall, the agent provides precision. *User.*
- **D9 · Reading.** Cards are read straight from `decisions.jsonl` by a helper, `scripts/decision-cards.js`, on every use. `spec-index.js` does not change. *User.* This overturns the spec's "the spec index reads cards as a second source", for two reasons. The installed 2.8.2 app rewrites the index with its own older code (seen 2026-10-20), and `ensureFresh` watches only `.frame/specs/*`.
- **D10 · Test posture: everything testable.** This covers `scripts/`, `src/main`, `src/shared` and pure renderer models. DOM hosts stay untested because there is no harness. *User; matches the testing record's Covered line.*
- **D11 · Card id and date.** The id is `<YYYYMMDD>-<6 hex>`, the hex taken from `sha1(decision + source + date)`. The date is the UTC date of writing. `add` refuses a duplicate id. *Silent.*
- **D12 · Source forms.** A source is `spec:<slug>`, where the folder must exist. Or it is `notes:<YYYY-MM-DD> <title>`, where a `### [YYYY-MM-DD] <title>` heading must exist in `PROJECT_NOTES.md`. A source is never a line number, because `loadDecisions` keys rows by line and lines move. *Silent.*
- **D13 · How the instruction reaches existing projects.** The `PROJECT_NOTES` rules in `REFERENCE.md` and the reminders in `AGENTS.md` are user-owned and never upgraded. So the rule ships as a new managed block, `frame:managed:decision-section` v1. In `REFERENCE.md` it is a "Decision Cards" section: when to ask, the one question with the relation inside it, story plus card, the card shape and the fallback. In `AGENTS.md` it is a three-line pointer carrying the trigger. Both are appended on project open through `upgradeSpecDocs`' descriptors. The block states that it overrides the older "you can add without asking" line, which stays user-owned until step 4a. *Silent.*
- **D14 · Write-time docs.** `docs-hint` delivers "Decision Cards" when the agent writes `decisions.jsonl`. The `PROJECT_NOTES.md Rules` delivery stays as it is, because it has about 150 characters of headroom under the cap. *Silent.*
- **D15 · Merging.** `.frame/.gitattributes` gets a managed block holding `decisions.jsonl merge=union`. It is written by `gitSharing` beside `.frame/.gitignore` in repo mode; local mode writes nothing because `.frame/` is untracked. `decisions.jsonl` joins `FRAME_FILE_CLASSES.data` and `ORCH_META_FILES`. *Silent.*
- **D16 · Edit-time delivery.** In `spec-hint.js` pre-edit, the card lookup by file runs before the `no-history` return, so a file with cards and no spec history still gets them. The same session state gains `cards: []`, with a default on load. The helper is required with a guard, so an older `.frame/bin` behaves exactly as today. *Silent.*
- **D17 · Work moments.** Three moments, three routes. *Silent.*
  - `/spec.new` from Frame's button: `buildSpecCatalog` appends current spec-less cards after the specs. The CLI path delivers no catalog today, so there the prompt-time hook covers cards.
  - `/spec.plan`: `spec-context.js --file` prints the file's cards after its spec history. The template already runs it.
  - Task runs: `buildTaskPrompt(task, { cards })` lists at most 2 matching cards, matched from the task's title and description.
- **D18 · What "behaves as today" means** (Constraint C1). With no `decisions.jsonl`, every hint, catalog, task prompt, `spec-context` output and view is byte-identical to today's, and tests pin this. The new instruction block is the feature's entry point and is the one intended difference. The `cards` close item is "not due" when no `decision.js` exists in `.frame/bin/` or `scripts/`. *Silent; resolves the clash between D4 and C1.*

### Card

One JSON object per line in `.frame/decisions.jsonl`:

```json
{"id":"20261014-3fa9c1","date":"2026-10-14","decision":"A missing digest never blocks done; done stays derived from task state.","why":"The index treats a non-done spec as in flight, and old specs would walk back. The close step reminds instead of blocking.","keywords":["spec close","digest","done"],"files":["scripts/spec-close-state.js","scripts/spec-close.js"],"source":"spec:spec-close-step","supersedes":null,"extends":null}
```

**Validation by `add`:**

| Field | Rule |
|---|---|
| `decision` | One sentence, at most 280 characters |
| `why` | At most 3 sentences |
| `keywords` | 1–8 |
| `files` | Project-relative paths, missing ones warned |
| `source` | Must resolve (D12) |
| `supersedes`, `extends` | Must name existing ids, and a card cannot both supersede and extend |

**Rules of the file:**
- Cards are never rewritten in place.
- A card is current unless a later card supersedes it.
- A spec card is one whose source starts with `spec:` (D6).

### Components

- **`scripts/decision-cards.js`** is the helper, with no dependencies.
  - It reads the file, validates and parses each card, and drops superseded cards.
  - It matches by file or by token bag. The tokenizer and the rare/common weights are copied from `spec-hint.js`; a card matches at score 3 or more.
  - It renders the delivery and catalog lines.
  - It is required with a guard by `spec-hint.js`, `spec-context.js`, `spec-close-state.js` and `spec-close.js`.
  - It is required directly by `decision.js`, `projectInsights.js` and `specManager.js`.
- **`scripts/decision.js`** is the CLI, with three commands:
  - `add` takes JSON as an argument or on stdin. It exits 0 on write and 1 on refusal, naming each defect.
  - `related --files a,b --keywords x,y`.
  - `list`.
  - Every command takes `--json`.
- **Delivery (spec-hint):**
  - Pre-edit block: `Recorded decisions for <rel>:`. With 1–2 cards it prints full lines; with 3 or more, compact lines plus `node <cli> list`.
  - Prompt block: `Recorded decisions that may apply:`. It holds at most 2 cards and is trimmed first when the payload passes `inlineBudget()`.
  - New hint modes: `decision-edit` and `decision-prompt`.
- **Spec close:**
  - `CLOSE_ITEMS` gains `{ id: 'cards', label: 'decision cards' }`.
  - `ITEM_CHECKS.cards` reads the spec's cards through the helper rather than a file in the spec folder.
  - The digest-specific wording in `activityEvents.js` and `PRIVACY.md` becomes "close items".
  - `spec.implement.md` gains a numbered step: write at least one card with `node {decision_script_path} add`, in the same commit as the digest. It also gains a `### The cards` section after `### The digest`, and a fix bullet: a fix that overturns a recorded decision writes a superseding card.
- **View:**
  - `LOAD_DECISION_CARDS` returns `{ cards, notes }` from `projectInsights.js`. The notes are today's entries, used to show a notes card's story inline.
  - The pure `cardsModel.js` builds the rows: newest first, search over decision, why, keywords and files, and the source label.
  - `decisionCardsPanel.js` renders them. A spec source opens through `specSection.open(slug)`; a notes source expands its `PROJECT_NOTES.md` entry in place.

## Files

- `scripts/decision-cards.js` — **New** — card parse, validation, current set, matching, rendering
- `scripts/decision.js` — **New** — `add` / `related` / `list` CLI for agents
- `scripts/spec-hint.js` — **Modified** — card delivery at edit and prompt time, `cards` session state
- `scripts/spec-context.js` — **Modified** — `--file` prints the file's cards
- `scripts/spec-close-state.js` — **Modified** — `cards` close item, wording
- `scripts/spec-close.js` — **Modified** — `ITEM_CHECKS.cards` with its own reader
- `scripts/docs-hint.js` — **Modified** — `decisions.jsonl` → "Decision Cards" section
- `scripts/spec-command-hint.js` — **Modified** — `{decision_script_path}` token, in step with specManager
- `src/main/frameStore.js` — **Modified** — `decisionsPath()`
- `src/shared/frameConstants.js` — **Modified** — `FRAME_FILES.DECISIONS`, data class, `ORCH_META_FILES`
- `src/main/gitSharing.js` — **Modified** — `.frame/.gitattributes` managed block in repo mode
- `src/shared/frameTemplates.js` — **Modified** — decision block text for REFERENCE and AGENTS, gitattributes block
- `src/shared/docsManagedBlock.js` — **Modified** — `DECISION_BLOCK_NAME`
- `src/main/frameProject.js` — **Modified** — decision-block descriptors in `upgradeSpecDocs`
- `src/main/specManager.js` — **Modified** — catalog cards, `{decision_script_path}`, `IMPLEMENT_ALLOW`
- `src/templates/bin/implement-launch.js` — **Modified** — allow `decision.js`
- `src/templates/commands/claude-code/spec.implement.md` — **Modified** — card step, `### The cards`, fix bullet
- `src/templates/commands/claude-code/spec.new.md` — **Modified** — one line: cards follow the specs in the catalog
- `src/main/structureBootstrap.js` — **Modified** — ship `decision.js` and `decision-cards.js`
- `package.json` — **Modified** — `build.files`
- `src/shared/activityEvents.js` — **Modified** — `decision.added`, `decision.rejected`, new hint modes, close wording
- `PRIVACY.md` — **Modified** — decision events bullet, close wording
- `src/shared/ipcChannels.js` — **Modified** — `LOAD_DECISION_CARDS`
- `src/main/projectInsights.js` — **Modified** — `loadDecisionCards` handler
- `src/renderer/decisions/cardsModel.js` — **New** — pure row model for the cards view
- `src/renderer/decisionCardsPanel.js` — **New** — DOM host for the cards view
- `src/renderer/styles/components/decision-cards.css` — **New** — view styles
- `src/renderer/styles/main.css` — **Modified** — import
- `src/renderer/projectListUI.js` — **Modified** — Context nav item "Decision cards"
- `src/renderer/multiTerminalUI.js` — **Modified** — `PANEL_REGISTRY.decisionCards`
- `index.html` — **Modified** — `#decision-cards-panel` container
- `src/renderer/paletteSources.js` — **Modified** — "Go to Decision cards"
- `src/renderer/index.js` — **Modified** — `decisionCards.open` command
- `src/renderer/tasks/runPrompt.js` — **Modified** — `opts.cards` in `buildTaskPrompt`
- `src/renderer/tasksPanel.js` — **Modified** — fill `opts.cards` on run
- `test/decisionCards.test.js` — **New** — helper: parse, validation, supersede, match, render, no-file
- `test/decision.test.js` — **New** — CLI add, related, list, refusals, append atomicity
- `test/decisionCardsModel.test.js` — **New** — view rows, search, source labels
- `test/spec-context.test.js` — **New** — `--file` with and without cards
- `test/spec-hint.test.js` — **Modified** — edit and prompt cards, budget, dedup, Codex, no-card identity
- `test/spec-close-state.test.js` — **Modified** — `cards` item, not-due without tooling
- `test/spec-close.test.js` — **Modified** — card checks, template shape drift
- `test/docs-hint.test.js` — **Modified** — `decisions.jsonl` section, cap
- `test/specDocsUpgrade.test.js` — **Modified** — decision block appended and upgraded
- `test/docsManagedBlock.test.js` — **Modified** — second block name
- `test/gitSharing.test.js` — **Modified** — gitattributes block, repo vs local, real merge without conflict
- `test/frameStore.test.js` — **Modified** — `decisionsPath`
- `test/metaPathGuard.test.js` — **Modified** — `decisions.jsonl` literal guard and mirror
- `test/taskRunPrompt.test.js` — **Modified** — cards in the task prompt
- `test/implementLaunch.test.js` — **Modified** — `decision.js` allow rule in both copies
- `test/structureBootstrap.test.js` — **Modified** — new entry and helper staged
- `test/activityEvents.test.js` — **Modified** — new events and modes
- `test/spec-command-hint.test.js` — **Modified** — token drift
- `test/codexTemplates.test.js` — **Modified** — token rendering for Codex

## Footprint

- scripts/decision-cards.js
- scripts/decision.js
- scripts/spec-hint.js
- scripts/spec-context.js
- scripts/spec-close-state.js
- scripts/spec-close.js
- scripts/docs-hint.js
- scripts/spec-command-hint.js
- src/main/frameStore.js
- src/shared/frameConstants.js
- src/main/gitSharing.js
- src/shared/frameTemplates.js
- src/shared/docsManagedBlock.js
- src/main/frameProject.js
- src/main/specManager.js
- src/templates/bin/implement-launch.js
- src/templates/commands/claude-code/spec.implement.md
- src/templates/commands/claude-code/spec.new.md
- src/main/structureBootstrap.js
- package.json
- src/shared/activityEvents.js
- PRIVACY.md
- src/shared/ipcChannels.js
- src/main/projectInsights.js
- src/renderer/decisions/cardsModel.js
- src/renderer/decisionCardsPanel.js
- src/renderer/styles/components/decision-cards.css
- src/renderer/styles/main.css
- src/renderer/projectListUI.js
- src/renderer/multiTerminalUI.js
- index.html
- src/renderer/paletteSources.js
- src/renderer/index.js
- src/renderer/tasks/runPrompt.js
- src/renderer/tasksPanel.js
- test/decisionCards.test.js
- test/decision.test.js
- test/decisionCardsModel.test.js
- test/spec-context.test.js
- test/spec-hint.test.js
- test/spec-close-state.test.js
- test/spec-close.test.js
- test/docs-hint.test.js
- test/specDocsUpgrade.test.js
- test/docsManagedBlock.test.js
- test/gitSharing.test.js
- test/frameStore.test.js
- test/metaPathGuard.test.js
- test/taskRunPrompt.test.js
- test/implementLaunch.test.js
- test/structureBootstrap.test.js
- test/activityEvents.test.js
- test/spec-command-hint.test.js
- test/codexTemplates.test.js

## Dependencies

None.

## Sequencing

1. **Card core.**
   - Add `scripts/decision-cards.js`: parse, validate, current set, supersede chain, file and token matching, line rendering, `catalogLines`.
   - Add `frameStore.decisionsPath()` and `FRAME_FILES.DECISIONS`, and add `decisions.jsonl` to the data class and `ORCH_META_FILES`.
   - Extend `metaPathGuard` with a `decisions.jsonl` literal guard and a mirror for the helper.
   - Tests: `test/decisionCards.test.js` (including a missing file and malformed lines), `test/frameStore.test.js`, `test/metaPathGuard.test.js`.
2. **Writer.**
   - Add `scripts/decision.js` with `add` (validation, D11 id, D12 source check, one `O_APPEND` line), `related` and `list`.
   - Register `decision.added` and `decision.rejected` in `activityEvents.js` and `PRIVACY.md`.
   - Ship both scripts: `ENTRY_FILES`, `HELPER_FILES`, `ENTRY_REQUIRES`, `build.files`.
   - Allow `Bash(node .frame/bin/decision.js *)` in `IMPLEMENT_ALLOW` and `implement-launch.js`.
   - Tests: `test/decision.test.js`, `test/activityEvents.test.js`, `test/structureBootstrap.test.js`, `test/implementLaunch.test.js`.
3. **Merging.**
   - `gitSharing` writes the `.frame/.gitattributes` managed block in repo mode, and the block template lives in `frameTemplates.js`.
   - Tests: `test/gitSharing.test.js`, covering the block, local mode writing nothing, and two branches that each append a card merging without a conflict.
4. **Instructions.**
   - Add the `frame:managed:decision-section` block: `DECISION_BLOCK_NAME`, the REFERENCE "Decision Cards" section and the AGENTS pointer in `frameTemplates.js`, and the descriptors in `frameProject.upgradeSpecDocs`.
   - `docs-hint` delivers the section on writes to `decisions.jsonl`.
   - Tests: `test/specDocsUpgrade.test.js`, `test/docsManagedBlock.test.js`, `test/docs-hint.test.js` (cap included).
5. **Spec close.**
   - Add the `cards` close item and `ITEM_CHECKS.cards` (D4, D18), and generalise the close wording.
   - `spec.implement.md` gains the card step, `### The cards` and the fix bullet.
   - Add the `{decision_script_path}` token in `specManager.getCommandPrompt` and `spec-command-hint.buildPrompt`.
   - Tests: `test/spec-close-state.test.js`, `test/spec-close.test.js`, `test/spec-command-hint.test.js`, `test/codexTemplates.test.js`.
6. **Edit-time delivery.**
   - `spec-hint` pre-edit delivers a file's spec-less cards (D16) with `cards` dedup and the `decision-edit` mode. It covers the Codex `apply_patch` path and leaves spec cards out.
   - `spec-context --file` prints the file's cards, which covers `/spec.plan`.
   - Tests: `test/spec-hint.test.js`, `test/spec-context.test.js`, both with byte-identical output when there is no card file.
7. **Work moments.**
   - `buildSpecCatalog` appends spec-less cards, and `spec.new.md` gains its line.
   - `buildTaskPrompt` takes `opts.cards`, and `tasksPanel` fills it from the matched cards.
   - Tests: `test/taskRunPrompt.test.js`, and `catalogLines` in `test/decisionCards.test.js`.
8. **Decision cards view.**
   - Add the `LOAD_DECISION_CARDS` channel and handler, the pure `cardsModel.js`, `decisionCardsPanel.js` and its CSS.
   - Wire the Context nav item, `PANEL_REGISTRY` entry, `index.html` container, palette entry and `decisionCards.open` command.
   - The dock Decisions tab is untouched.
   - Tests: `test/decisionCardsModel.test.js`.
9. **Prompt-time delivery.**
   - `spec-hint` prompt mode delivers at most 2 strongly matching spec-less cards, once per session, under `inlineBudget()` (D5), with the `decision-prompt` mode. Cards are trimmed before topics and the close reminder.
   - Tests: `test/spec-hint.test.js` for threshold, cap, dedup, budget trimming, a Codex payload, and identity when there is no card file.
