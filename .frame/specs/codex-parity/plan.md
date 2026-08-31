# Plan — Codex reaches Frame the way Claude Code does

## Architecture

### Resolved plan-time decisions

- **D1 · Scope and ordering vs `audit-q3-cross-platform` (asked, business).**
  That spec is `planned` and holds `aiToolManager.js`, `frameProject.js` and
  `frameTemplates.js` in its footprint. **This spec takes the Codex-launch
  work and goes first**; its plan loses that decision and gains a note of the
  reversal. Rejected: leaving the wrapper out (the `SessionStart` hook would
  then run beside a launch-time injection doing the same job), and waiting for
  that spec (it has no scheduled start, and Codex parity would wait on it).

- **D2 · Where the hook config is written (asked, business).** Frame writes
  `CODEX_HOME/hooks.json` **merge-safely, with a visible opt-out**, the way
  `installSpecHintHook` merges `.claude/settings.json`. Verified: hooks load
  only from there — a project-local `.codex/hooks.json` was tried and did not
  fire. This is the user's global file and is not project-scoped, which is a
  real departure from `non-invasive-overlay`'s footprint rule; it is accepted
  because the alternative reintroduces the manual step this work exists to
  remove, and because every hint script already exits silently outside a Frame
  project. Step 2 tries to reduce the cost further (see D8).

- **D3 · What replaces the `.frame/bin/codex` wrapper (asked, business).** A
  `SessionStart` hook, not in-process launch composition. **This reverses an
  asked decision recorded in `audit-q3-cross-platform`**, whose rationale was
  Windows portability — a node hook satisfies that equally, and the wrapper's
  prompt only says *"read AGENTS.md"*, leaving compliance to the agent. Same
  reasoning that moved Claude Code off launch-time injection in
  `non-invasive-overlay`.

- **D4 · Untrusted hooks (asked, business).** Frame **detects the state and
  surfaces it**, as `docsHealth` surfaces a degraded doc. Rejected: saying it
  once at setup — a Frame update changes a script's hash and un-trusts the
  hooks again, silently, which is the failure class this whole line of work
  exists to end.

- **D5 · Command template strategy (asked, technical).** Adapt
  **`spec.plan.md` first**, measure how much genuinely diverges from the
  Claude version, and let that number decide between four hand-written
  templates and one source with a tool vocabulary. The spec forbids "the
  Claude file with tool names swapped"; whether a vocabulary layer can clear
  that bar is a measurement, not a guess.

- **D6 · Test posture (asked, technical).** **Everything testable.** All four
  areas this plan touches (`scripts/`, `src/main/`, `src/shared/`,
  `src/templates/`) are already covered by the testing record, and on the
  Claude side tests caught two real defects — a truncated payload and a
  false-positive write detector.

- **D7 · One vocabulary, not four patched scripts (silent).** The hint scripts
  hardcode `'Bash'`, `'Edit'`, `'Write'`. Patching each one per tool would put
  the same mapping in four places. A single `toolVocabulary` module maps
  Frame's semantic roles — *edit*, *shell*, *search* — to each CLI's tool
  names, and the scripts ask it. One place to add the next CLI.

- **D8 · Try to gate before spawning (silent, pending measurement).** Codex's
  hook schema carries an `if` field. If it accepts a cheap shell condition,
  hooks can be skipped in non-Frame projects without paying ~40 ms of node
  startup per tool call. Step 1 establishes whether it does; if not, the
  scripts' existing early bail stands and the cost is disclosed.

### Shape

Three seams, in dependency order. **A tool vocabulary** (`src/shared/`) turns
`tool_name` into a role, so a hint script asks "is this an edit?" instead of
"is this `Edit`?". **A Codex hook installer** mirrors `installSpecHintHook`
against `CODEX_HOME/hooks.json`, plus a trust probe feeding the health notice.
**Codex command templates** under the existing `src/templates/commands/codex/`
directory, resolved by the `getCommandPrompt` path that already takes a tool
argument and today returns an error for `'codex'`.

Nothing about Claude Code's behaviour changes: the vocabulary's Claude entry
is the current hardcoded set, asserted by the existing tests.

### The measurement this plan rests on

Step 1 is not discovery for its own sake — three later steps are shaped by it,
and each has a stated fallback:

| Unknown | Shapes | If it goes the other way |
| --- | --- | --- |
| `apply_patch`'s `tool_input` shape — does it carry a path like `file_path`? | `docs-hint`'s meta-write detection | the vocabulary gains a per-tool path extractor rather than a field name |
| Codex's inline `additionalContext` ceiling | every payload size, as 2000 does for Claude | the cap and its test move to a per-tool value |
| Whether `if` can gate cheaply | D8 | keep the in-script bail, disclose the cost |
| Whether trust state is readable from disk | D4's health notice | surface at install time only, and say so |

## Files

- `src/shared/toolVocabulary.js` — **New**. Semantic roles (`edit`, `shell`,
  `search`) → per-CLI tool names, matcher strings, and a path extractor per
  edit tool. Pure, no fs.
- `src/shared/frameTemplates.js` — **Modified**. Add `CODEX_HINT_HOOKS` (the
  `hooks.json` shape); delete `getCodexWrapperTemplate` and its export.
- `src/main/frameProject.js` — **Modified**. `installCodexHintHook` /
  `removeCodexHintHook` against `CODEX_HOME/hooks.json`, merge-safe and
  idempotent; `codexHookTrustState()` for the notice.
- `src/main/aiToolManager.js` — **Modified**. Codex `command` becomes
  `'codex'`; drop the wrapper from the tool definition.
- `src/renderer/healthNotice.js` — **Modified**. Surface untrusted Codex
  hooks alongside the existing doc-health findings.
- `src/shared/activityEvents.js` — **Modified**. `HOSTS` gains `codex-hook`;
  a `hooks.untrusted` suppression so the silent state is on the record.
- `scripts/module-hint.js` — **Modified**. Ask the vocabulary instead of
  testing `'Bash'`/`'Grep'`/`'Glob'`.
- `scripts/docs-hint.js` — **Modified**. Same, plus the vocabulary's path
  extractor for the edit tool.
- `scripts/spec-hint.js` — **Modified**. Same for its pre-edit path.
- `scripts/spec-command-hint.js` — **Modified**. Resolve the template
  directory from the running CLI rather than assuming `claude-code`.
- `src/templates/commands/codex/spec.plan.md` — **New**. The plan flow in
  Codex's terms; the measurement subject for D5.
- `src/templates/commands/codex/spec.new.md` — **New**.
- `src/templates/commands/codex/spec.tasks.md` — **New**.
- `src/templates/commands/codex/spec.implement.md` — **New**.
- `.frame/bin/codex` — **Deleted**, with its template.
- `test/toolVocabulary.test.js` — **New**. Role mapping per CLI; Claude's
  entry equals today's hardcoded behaviour.
- `test/codexHookInstall.test.js` — **New**. Merge-safety against an existing
  `hooks.json`, idempotent re-install, clean removal, and the trust probe.
- `test/codexTemplates.test.js` — **New**. `getCommandPrompt` returns a prompt
  for all four commands with `'codex'`; placeholders all resolve.
- `test/spec-command-hint.test.js` — **Modified**. The drift guard runs for
  Codex too, against `src/templates/commands/codex/`.
- `test/module-hint.test.js`, `test/docs-hint.test.js`, `test/spec-hint.test.js`
  — **Modified**. Each gains its Codex tool-name cases.
- `test/frameProjectInit.test.js` — **Modified**. Codex hook entries in the
  init assertions.

## Footprint

- src/shared/toolVocabulary.js
- src/shared/frameTemplates.js
- src/shared/activityEvents.js
- src/main/frameProject.js
- src/main/aiToolManager.js
- src/renderer/healthNotice.js
- scripts/module-hint.js
- scripts/docs-hint.js
- scripts/spec-hint.js
- scripts/spec-command-hint.js
- src/templates/commands/codex/**
- test/toolVocabulary.test.js
- test/codexHookInstall.test.js
- test/codexTemplates.test.js
- test/spec-command-hint.test.js
- test/module-hint.test.js
- test/docs-hint.test.js
- test/spec-hint.test.js
- test/frameProjectInit.test.js

## Dependencies

None. The hint scripts stay dependency-free plain node, as they must to ship
into `.frame/bin/`.

## Sequencing

1. **Measure Codex's hook environment.** Drive a real Codex session against a
   scratch `CODEX_HOME`: capture `apply_patch`'s `tool_input`, find the
   `additionalContext` inline ceiling by emitting numbered markers, test
   whether `if` gates without spawning, and check whether trust state is
   readable from disk. Record the findings in the spec folder. Every later
   step reads from this.
2. **`toolVocabulary.js` + tests.** Roles, per-CLI names, matcher strings,
   path extractor. Claude's entry asserted equal to today's behaviour.
3. **Move the four hint scripts onto the vocabulary.** No behaviour change for
   Claude — the existing suites must pass untouched — and Codex tool names
   start resolving. Each script's suite gains its Codex cases.
4. **Codex hook install/remove + tests.** `CODEX_HINT_HOOKS`,
   `installCodexHintHook`, merge-safe against an existing user `hooks.json`,
   idempotent, removable, with the opt-out D2 promised.
5. **Untrusted-hook detection and notice.** The probe from step 1, the
   `hooks.untrusted` record, and the health-notice surface.
6. **Adapt `spec.plan.md` for Codex and measure the divergence.** Report what
   fraction is genuinely tool-specific; settle D5 on that number.
7. **The remaining three templates**, by whichever strategy step 6 settled.
   `test/codexTemplates.test.js` covers all four.
8. **Retire the wrapper.** `aiToolManager` command → `'codex'`, delete
   `getCodexWrapperTemplate` and `.frame/bin/codex`, and let the `SessionStart`
   hook carry AGENTS.md and the REFERENCE sections.
9. **Update `audit-q3-cross-platform`.** Remove its Codex-launch decision from
   its plan and record the reversal there, naming this spec — so the archive
   does not hold two contradictory asked decisions.
