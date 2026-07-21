# Outcome — Implement modes

## T01 — Inject Frame's own runtime into dispatched terminals

Added `FRAME_NODE: process.execPath` to the PTY environment in
`createTerminal` (`src/main/ptyManager.js`), set on the base env just before
`extraEnv` spreads in, so every terminal gets it — not only orchestration
lanes. The comment states the call shape (`ELECTRON_RUN_AS_NODE=1
"$FRAME_NODE" script.mjs`) and why the quotes are required, since the packaged
macOS path contains spaces. No deviation from plan.md (D6).

_Captured: 2026-07-21 · 1 file change_

---

## T02 — Generate `.frame/implement-permissions.json`

Added `resolveVerificationCommand` / `buildImplementPermissions` /
`writeImplementPermissions` to `src/main/specManager.js`, exported for the
dispatch path and for tests; the verification command is read from
`.frame/config.json` `project.commands` in the order test → lint → build, and
its absence yields a file without a check rather than an invented one (T11).
Two deviations from plan.md, both from verifying the CLI docs: the allowlist
uses a bare `Edit` because file permission checks only ever match `Edit()` and
`Read()` rules — a `Write()` rule is accepted and then never consulted — and
the plan's claim that `--settings` *adds* to the user's own rules is wrong for
same-key collisions (it takes precedence over every settings file), so the
user's own `permissions.allow` may be superseded for the dispatched session;
deny still wins at any scope, so the safety argument for D4/D9 is unaffected.
Generation only — wiring the call into dispatch belongs to T06.

Followup: `--permission-mode auto` requires an eligible account, org
enablement and Opus/Sonnet 4.6+ — T03 needs a fallback when the flag is
rejected.

_Captured: 2026-07-21 · 1 file change_

---

## T03 — Carry launch flags through the dispatch

`composeLaunchCommand` in `src/main/aiToolManager.js` appends flags to the
resolved CLI and owns the quoting; the availability probe still runs on the
bare command, and all three success returns in `CHECK_AI_TOOL_AVAILABLE` now
go through one `ok()` helper so the composition happens in a single place.
`specManager` resolves the launch hint (`status.json` `implement_mode`, else
`.frame/config.json` `implement.defaultMode`, else none) and
`buildSpecCommandFile` returns `launchFlags` — `--settings <path>
--permission-mode auto` for an autonomous hint on `spec.implement`, empty
otherwise — which `agentDispatch` passes through both dispatch paths without
interpreting. Deviation from the T02 note: writing the permission file is
called from here rather than T06, because `--settings <path>` cannot be passed
for a file that does not exist yet; T06 keeps the report-asset staging.

Flags only take effect on the branch that starts the CLI — continuing in a
lane with a live agent keeps that session's flags, which is exactly the
mismatch D10 resolves with one re-dispatch. Also added
`.frame/implement-permissions.json` to `.gitignore`; it is regenerated on
every autonomous dispatch, like the other `.frame/runtime` artifacts.

_Captured: 2026-07-21 · 4 file changes_

---

## T03 (polish) — Fall back when the CLI refuses the flags

Closed the followup above rather than leaving it open. `--permission-mode
auto` needs an eligible account, an enabled org and Opus/Sonnet 4.6+, and the
CLI documents no way to probe any of that from outside — so the flags are
best-effort: if a flagged launch never reaches its input box and no agent
process is in the foreground, `agentDispatch` relaunches once with the bare
command (`bareCommand`, new on the availability result). A slow CLI is
already detected by process name, which is what keeps this from double-
launching.

The fallback states the limit instead of asking about it, per the user's
direction: a toast to the UI, and a note appended to the prompt telling the
agent to say so in one line, continue step by step, and mention the
describe-your-own option once. Cost is a second 15s readiness wait on a
genuinely dead launch.

_Captured: 2026-07-21 · 2 file changes_

---

## T04 — Report generator

Wrote `src/templates/commands/claude-code/build-implement-report.mjs`: pure
render functions (`renderReport`, `renderTask`, `renderDiff`, `diffLineClass`,
`escapeHtml`, `renderVerification`) above the git/filesystem half, all
exported so T05 can cover the transform with neither. Diffs come from
`git show --format= --no-color <hash> -- . :(exclude)...`; an unknown hash
logs and yields an empty diff rather than killing the report, which is what an
entry written before its commit lands looks like. The `report-data.json` shape
is documented in the file header as the contract the prompt template must
write to.

Extended the plan's exclusion list from `.frame/` to also drop `tasks.json`
and `STRUCTURE.json` — verified against real commits from this session, where
the pre-commit hook's regenerated module map otherwise dominated the diff.
`PROJECT_NOTES.md` and `AGENTS.md` stay visible: they are hand-written, so a
change there is a real one. Confirmed the generator runs under Frame's bundled
runtime (`ELECTRON_RUN_AS_NODE=1` → Node 18.18.2), which is D6's whole premise.

Styling checked value-by-value against `src/renderer/styles/variables.css`
rather than eyeballed from the plan-report template: the error colour was a
made-up `#d47a7a` (system is `#d47878`), and diff rows were using the semantic
success/error pair when the design system ships dedicated GitHub-style diff
colours — the same ones `diff-viewer.css` applies to the app's own diffs. A
changed line is not a status, so it should not borrow the status palette.

On the user's direction the whole layout — not just the diff — was rebuilt on
the design system: variable *names* copied from `variables.css` too, so drift
shows up as a one-line diff, plus the dashboard's gradient header bar, card
head strips and the spacing/radius scales. An audit script confirmed 28 shared
variables with zero value differences. The user chose to keep the markup
inside the generator rather than adding a second staged template asset, so
T06 stages one file.

_Captured: 2026-07-21 · 1 file change_

---

## T05 — Cover the pure transform

`test/implementReport.test.js`, 21 cases over `escapeHtml`, `diffLineClass`,
`renderDiff`, `renderVerification`, `renderTask` and `renderReport` — no git,
no filesystem, which is what the split in T04 exists to allow. CommonJS with a
dynamic `import()` in a `before` hook, since `npm test` globs `test/*.test.js`
and the generator is ESM.

The cases worth naming: `+++`/`---` must classify as file headers rather than
additions and deletions; a missing check must read as "not verified" and never
as a pass; malformed `report-data.json` must still produce a readable page,
because the report is never load-bearing; and `renderReport` must be
byte-identical across two calls with equal input, which fails the moment a
clock creeps into the transform.

Mutation-checked rather than assumed: removing the file-header guard and
making a missing check pass turned 3 tests red, then the file was restored.
Full suite 105 passing.

_Captured: 2026-07-21 · 1 file change_

---

## T06 — Stage assets per command

Replaced the hardcoded `if (command === 'spec.plan')` with a `COMMAND_ASSETS`
map and `stageCommandAssets(projectPath, command, aiTool)`;
`stageReportTemplateAsset` became `stageCommandAsset(projectPath, aiTool,
file)`, same override → packaged-fallback resolution as before. `spec.plan`
stages the plan template, `spec.implement` the report generator, every other
command stages nothing. Also added `{report_generator_path}` alongside
`{report_template_path}` as an interpolation variable, so T10's prompt has a
path to invoke.

Verified rather than assumed: each command stages exactly its own assets, the
staged generator is byte-identical to its source, a project-local override
under `.frame/templates/commands/claude-code/` wins and stops winning when
removed, and the staged copy runs from `.frame/runtime/assets/` under Frame's
bundled Node — the whole dispatch path end to end.

_Captured: 2026-07-21 · 1 file change_

_Captured: 2026-07-21 · 1 file change_

---
