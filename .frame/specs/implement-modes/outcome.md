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
