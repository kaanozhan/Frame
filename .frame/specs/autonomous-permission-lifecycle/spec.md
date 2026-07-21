# Autonomous permissions as a managed lifecycle — no re-dispatch, no leakage

## Problem

The autonomous implement mode's permissions travel only on the launch line
(`--settings` + `--permission-mode auto`), which is read once at CLI start.
Choosing autonomous in a session launched without them therefore dead-ends in
"re-dispatch please" — and the re-dispatch modal's "Continue" option injects
into the same unflagged session, so the picker asks again and the loop
repeats. Meanwhile Claude Code's actual capabilities (verified against
current docs) make this ceremony unnecessary: permission **rules** in
`.claude/settings.local.json` hot-reload into running sessions, and the
permission **mode** can be switched in-session by the user (Shift+Tab /
`/permissions`) — though never by the model, and `auto` mode appears in the
cycle only for eligible accounts.

The naive fix — writing Frame's rules straight into `settings.local.json` —
would be worse than the bug: allow rules are mode-independent and
repo-scoped (worktrees included), so a parked blanket `Edit` rule would
silence prompts in every future session, step-by-step runs included.

## Goal

Autonomous permissions become a managed, reversible grant with a consent
line, instead of a launch-time gamble:

1. **Frame-launched sessions keep `--settings`** — session-scoped by nature,
   zero leakage. The launch-hint mechanism stays.
2. **Mid-session upgrade replaces re-dispatch:** when the user picks
   autonomous in an unflagged session, Frame writes its rule set into
   `.claude/settings.local.json` (hot-reloaded live), the agent tells the
   user in one line what was written and asks them to switch mode
   (Shift+Tab → `auto`, or `acceptEdits` when `auto` is unavailable), then
   continues in the same session. No relaunch, no context loss, no second
   picker.
3. **Every grant is removed:** on the run's busy→idle transition (the
   SPEC_AGENT_ACTIVITY signal) Frame deletes exactly the rules it added,
   preserving the user's own accumulated grants. A sweep on project open
   clears leftovers from crashed runs.
4. **Consent is explicit:** the mode picker's autonomous entry says that
   choosing it writes permissions into `.claude/settings.local.json` for the
   duration of the run.

## Constraints

- `settings.local.json` is Claude Code's file, shared with the user's own
  "don't ask again" grants: Frame merges and removes only its own rules,
  tracked by manifest — never by rewriting the file wholesale.
- The model cannot change the permission mode; the design must route that
  single gesture through the user and must not pretend otherwise.
- `auto` mode eligibility varies by account; the flow needs the
  `acceptEdits` fallback path spelled out (edits covered by the mode, Bash
  by the written rules).
- While an upgraded run is live, other lanes in the same repo share the
  grant (file is repo-scoped, worktrees resolve to it). This exposure
  window must be documented; if any lane-level mitigation exists, it is
  optional hardening, not a blocker.
- The existing UI dispatch path and the implement template's recorded-mode
  contract (`status.json.implement_mode`) stay authoritative.
- Works identically when the session was started conversationally from the
  CLI (no launch flags possible) — this spec is the enabler for autonomous
  in the cli-spec-command-parity flow.

## Success Criteria

- Picking autonomous in an unflagged session leads to: one consent/status
  line, one user mode-switch gesture, then work continues in the same
  session — never "re-dispatch", never a repeated picker.
- After the run ends (agent turn idle), `.claude/settings.local.json`
  contains none of Frame's rules, and rules the user had before are
  byte-identical.
- Killing Frame mid-run then reopening the project removes the leftover
  Frame rules on open.
- A step-by-step run started after an autonomous run completes gets its
  normal permission prompts.
- A Frame-launched autonomous session (hint matched) behaves exactly as
  today — flags on the launch line, no settings.local.json writes at all.

## Out of Scope

- Moving the mode picker into Frame's UI before launch (Option B — decide
  alongside cli-spec-command-parity)
- The mode-aware re-dispatch modal and `{launched_mode}` template
  placeholder (Option C — hotfix-sized, tracked separately)
- Narrowing or redesigning the IMPLEMENT_ALLOW/DENY rule sets themselves
- Any change to conductor/orchestration permission handling

## Open Questions

- **Rule set in the upgrade path** — if the user lands on `acceptEdits`
  rather than `auto`, edits are covered by the mode itself: should the
  hot-patched rule set then drop `Edit`/`Read` and write only the Bash
  rules, shrinking the leakage surface during the run?
- **Grant manifest location** — where does Frame record "these rules are
  mine to remove": `.frame/runtime/` manifest file, or derive by comparing
  against `buildImplementPermissions` output at removal time?
- **Removal trigger granularity** — busy→idle fires per turn; a
  step-by-step-paced autonomous variant could idle between tasks. Is
  "remove on idle, rewrite on next autonomous dispatch" acceptable churn,
  or should removal wait for phase change / explicit end?
- **Consent depth** — is the picker line enough, or does the first-ever
  grant per project deserve a one-time confirmation before writing?
