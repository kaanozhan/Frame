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
