---
keywords: implement modes, mode picker, autonomous mode, step by step, implementation report, launch flags, permission denylist, FRAME_NODE
related: implement-modes-v2, test-aware-planning
---
Made `/spec.implement` offer three flows over one shared accounting core (step by step, autonomous + report, describe your own), with autonomy carried on the launch line (`--settings` + `--permission-mode auto`) and `git push` denied by a permission rule, not by prose.

- Shared core binds every mode, a described one included: task selection by `spec:<slug>:T<n>`, `plan.md` Files/Sequencing as scope authority, task state, phase, one `outcome.md` entry per task, never push or touch `main`. A description may change the loop, commits, verification and reporting, never the accounting; that is what separates it from the template override.
- Picker at every dispatch, before any edit: revised at plan time from the spec's ask-once-per-spec (plan.md replaces S2/S3 with S2′/S3′) so switching modes mid-spec is free; a saved default goes first, marked `(default)`. `status.json` `implement_mode` is the last choice and the next launch's hint; picking autonomous in a session launched bare records it and asks for one re-dispatch. No structured-question tool → numbered list and a hard stop.
- Step by step: what-changed / why-changed close-out plus exactly one question; Continue stays in the session without re-asking, Stop leaves the change uncommitted.
- Permissions: Frame writes `.frame/implement-permissions.json` (gitignored), never `.claude/`. Rejected `dontAsk` (stalls on any unlisted harmless command). Found at T02: a `Write()` rule is never consulted (bare `Edit` instead), and `--settings` outranks every settings file, so the user's own allows can be superseded for that session while deny still wins. A launch that refuses the flags is relaunched once bare and the run says it continues step by step.
- Runtime: `FRAME_NODE=process.execPath` in every PTY, invoked as `ELECTRON_RUN_AS_NODE=1 "$FRAME_NODE"` (Node 18.18.2), never a bare `node`.
- Report is generated, never written: the agent appends `report-data.json`; `build-implement-report.mjs` pulls each commit's real diff by hash (excluding `.frame/`, `tasks.json`, `STRUCTURE.json`) into a self-contained `implement-report.html` on Frame's design-system variables. Per task one atomic commit, then the hash filled in and `--amend --no-edit`. Asset staging became a per-command `COMMAND_ASSETS` map.
- Verification: `project.commands` test → lint → build, the same order the allowlist uses; none → `"status": "none"`, shown as not verified, never an invented command. Saved custom flow: `.frame/implement-flow.md` referenced by `implement.flowFile`.
- Result: 12 tasks; `test/implementReport.test.js` 21 cases over the pure transform (mutation-checked), suite 105 passing; template, git and dispatch code untested per the plan's posture.
- Superseded in part by `implement-modes-v2`: the choice moved before the session, the re-dispatch seam is gone, and `implement-flow.md` became a Claude Code skill. The core, report, permission file and `FRAME_NODE` still stand.

Chain: spec.md → plan.md → tasks.md → outcome.md
