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
  exists to end. **Technique settled by T01:** trust state is not readable —
  no `hooks.state` file, nothing in `config.toml`, no hook or trust table in
  `state_5.sqlite`. Detection is therefore **behavioural**: the hook writes a
  heartbeat to the activity log, and Frame reports the untrusted state when
  hooks are installed but no heartbeat has appeared. Schema-independent, and
  it does not couple Frame to Codex internals.

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

- **D8 · Gating before spawn — resolved to the fallback (silent).** Codex's
  hook schema carries an `if` field, but T01 ran it as `"if": "test -d
  .frame"` both with and without `.frame/` present and **the hook executed
  both times** — the condition, in that form, is ignored. The scripts' existing
  early bail stands, and the ~40 ms of node startup per tool call in non-Frame
  projects is a cost to disclose rather than one designed away.

### Shape

Three seams, in dependency order. **A tool vocabulary** (`src/shared/`) turns
`tool_name` into a role, so a hint script asks "is this an edit?" instead of
"is this `Edit`?". T01 shrank its job: Codex names its shell tool `Bash` too,
so *shell* and *search* are identical across both CLIs and the vocabulary's
real content is the **edit** role — the tool names plus the path extractor
that reads `file_path` for Claude Code and parses the patch envelope for
Codex. **A Codex hook installer** mirrors `installSpecHintHook`
against `CODEX_HOME/hooks.json`, plus a trust probe feeding the health notice.
**Codex command templates** under the existing `src/templates/commands/codex/`
directory, resolved by the `getCommandPrompt` path that already takes a tool
argument and today returns an error for `'codex'`.

Nothing about Claude Code's behaviour changes: the vocabulary's Claude entry
is the current hardcoded set, asserted by the existing tests.

### The measurement this plan rested on — resolved by T01

Measured against Codex CLI 0.149.1; evidence in `measurements.md`. Two results
contradicted this plan and are folded in throughout:

| Unknown | Measured | Effect |
| --- | --- | --- |
| `apply_patch`'s `tool_input` shape | no path field — a `*** Begin Patch / *** Add File: …` envelope inside `command` | per-tool **path extractor**, as the fallback anticipated |
| The shell tool's name | **`Bash`**, with `tool_input.command` — identical to Claude Code | `module-hint`'s search path and `docs-hint`'s Bash detection port **unchanged**; the vocabulary shrinks to the edit role |
| Codex's inline ceiling | **≥ 20 000 characters, nothing truncated** (Claude's is exactly 2 000) | the cap becomes **per tool**; section slicing stays a Claude-only constraint |
| Whether `if` can gate cheaply | it does not | see D8 |
| Whether trust state is readable | it is not | see D4 |

## Files

- `scripts/toolVocabulary.js` — **New**. Semantic roles (`edit`, `shell`,
  `search`) → per-CLI tool names, matcher strings, and a path extractor per
  edit tool (`tool_input.file_path` for Claude Code; the `*** Add|Update|Delete
  File:` envelope for Codex). Also the per-tool inline ceiling — 2 000 for
  Claude Code, 20 000 for Codex. Pure, no fs. **In `scripts/`, not
  `src/shared/`** (T03): the hint scripts are copied into `.frame/bin/` and
  cannot reach the app tree from there, so it follows `redact.js`'s pattern —
  a sibling require for the shipped scripts, `../../scripts/…` for the app —
  and ships through `PARSER_FILES`.
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

- scripts/toolVocabulary.js
- src/main/structureBootstrap.js
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

1. ~~**Measure Codex's hook environment.**~~ **Done — `measurements.md`.**
   `apply_patch` carries a patch envelope rather than a path; the shell tool is
   named `Bash`; the inline ceiling is ≥ 20 000 characters; `if` does not gate;
   trust state is not readable. Steps 2, 3 and 5 read from this.
2. **`toolVocabulary.js` + tests.** Roles, per-CLI names, matcher strings,
   the edit path extractor, and the per-tool inline ceiling. Claude's entry
   asserted equal to today's behaviour. Smaller than first planned: T01 found
   *shell* and *search* identical across both CLIs.
3. **Move the four hint scripts onto the vocabulary.** No behaviour change for
   Claude — the existing suites must pass untouched — and Codex tool names
   start resolving. Each script's suite gains its Codex cases.
4. **Codex hook install/remove + tests.** `CODEX_HINT_HOOKS`,
   `installCodexHintHook`, merge-safe against an existing user `hooks.json`,
   idempotent, removable, with the opt-out D2 promised.
5. **Untrusted-hook detection and notice.** A heartbeat written by the hook,
   the `hooks.untrusted` record when hooks are installed but no heartbeat has
   appeared, and the health-notice surface. Behavioural rather than reading
   Codex state — see D4.
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
