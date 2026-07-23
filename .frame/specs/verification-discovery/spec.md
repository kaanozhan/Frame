# Verification discovery — candidate checks and end-state verification for unconfigured projects

## Problem

In a project whose `.frame/config.json` carries no usable check under
`project.commands`, the autonomous implement mode correctly runs *without
verification* — every task ships with `"status": "none"` and the report
stamps each one **not verified**. The rule behind that is sound ("never
invent a command"), but the way out of it is invisible and manual:

- Detection is a **one-shot snapshot at init** (`frameProject.js` →
  `scripts/detect-project.js`). A project that gains a test setup later, or
  had one the detector missed, keeps `commands.test: null` forever. Nothing
  re-detects, and no UI hints that hand-editing `.frame/config.json` is the
  fix — the only mention is one line in the run's closing summary.
- The detector **never emits a `lint` key** in any language branch, even
  though `resolveVerificationCommand` (`specManager.js`) falls back
  `test → lint → build`. A lint-only project can never be auto-verified.
- **Pre-commit hooks are invisible as a signal.** If the project's own hook
  runs a real check, every autonomous commit already passes it — de-facto
  verification that the report never records. Conversely, hook *presence*
  proves nothing: Frame installs its own bookkeeping hook in every project,
  and many hooks only format or run `lint-staged` on changed files.

The net effect: for an existing project without configured commands,
"not verified" is a dead end rather than a step toward a configured check.

## Goal

"Not verified" becomes a one-run-lag self-configuration loop, with the user
holding every decision:

1. **Richer candidate discovery.** `detect-project.js` learns to (a) emit a
   `lint` command when the project has one (e.g. `scripts.lint` in
   package.json, equivalents per language), and (b) parse the project's own
   pre-commit hook (`.husky/pre-commit`, `.git/hooks/pre-commit`,
   lefthook config) for real check commands — as **candidates**, clearly
   separated from configured commands. Frame's own bookkeeping hook line is
   excluded from parsing.
2. **The run itself does not change.** With no configured check, the
   autonomous loop still implements, commits, and records
   `"status": "none"` per task. No command is invented or run mid-loop, and
   the permission surface is not widened silently.
3. **The closing summary becomes the negotiation point.** When the task
   loop ends with unverified tasks, the agent — in the same closing summary
   that already states "no configured check" — lists the discovered
   candidates and offers to run one **on the final tree**, now, with the
   user present to approve. One offer, not an interrogation.
4. **End-state verification is recorded honestly.** An approved check that
   passes on the final tree is written into `report-data.json` as a
   **distinct category** (e.g. `"scope": "end-state"`), and the report
   renders it as its own pill ("end-state pass" + command) — never as a
   per-task `pass`, which stays reserved for checks that ran at
   commit time. Per-task pills stay "not verified"; the report header gains
   the end-state result.
5. **The approval persists.** The command the user approved is written to
   `project.commands` in `.frame/config.json` (visible, stated in the
   summary), so the *next* autonomous run verifies per task from the start.

## Constraints

- "Never invent a command" holds everywhere: candidates are surfaced, never
  executed without the user's in-conversation approval, and never written
  to config without it.
- Per-task `pass` semantics are inviolable: a check that ran once at the
  end must not retroactively flip task pills to `pass`. The report may not
  show a verification that did not happen at that point.
- Hook parsing is heuristic → its output is candidate-grade only.
  Formatting-only hooks (prettier, lint-staged doing writes) must not be
  offered as verification candidates.
- Running the approved check happens interactively after the loop, so the
  normal permission prompt flow covers it — no changes to
  IMPLEMENT_ALLOW/DENY or to `implement-permissions.json`.
- `.frame/config.json` is a git-tracked file: it is written only on
  explicit approval, and the write is announced (which key, which value).
- `report-data.json` shape changes must stay backward-compatible with
  `build-implement-report.mjs`'s contract — old data files (no end-state
  block) must still render.
- Per-commit replay (checking out each task commit to verify it
  individually) is explicitly rejected: too expensive, and intermediate
  commits are not promised to be green in isolation.

## Success Criteria

- In a project with no configured check but a detectable candidate (test
  script added after init, lint script, or a hook running a real check),
  the autonomous run completes exactly as today, and the closing summary
  names the candidates and offers the end-state run.
- Approving the offer: the check runs on the final tree, the report shows
  an end-state result distinct from per-task pills, and
  `project.commands` now carries the approved command.
- The next autonomous run in that project verifies per task with no
  further setup.
- Declining the offer changes nothing: no config write, no check run,
  report as today.
- A project whose only hook is Frame's bookkeeping hook (or a
  formatting-only hook) yields no candidates — the summary states plainly
  that none were found.
- A pre-existing `report-data.json` without the end-state block still
  renders through the generator unchanged.

## Out of Scope

- Dispatch-time or launch-time silent re-detection that writes
  `.frame/config.json` without the user in the loop (discussed and
  rejected: silent permission widening + dirty tracked file on open).
- Any change to the IMPLEMENT_ALLOW/DENY permission sets or the
  `implement-permissions.json` mechanism.
- Per-commit replay verification of individual task commits.
- Treating hook success during commits as recorded per-task verification
  (opaque hook content; revisit only if hooks become introspectable).
- UI work beyond the report rendering (e.g. a Frame settings screen for
  `project.commands`) — tracked separately if wanted.

## Open Questions

- **Candidate discovery execution point** — extend `detect-project.js` and
  have the template call it read-only at closing time, or let the agent
  inspect package.json/hooks inline per the template's instructions?
  A script keeps the heuristics testable; inline keeps the detector
  untouched.
- **`report-data.json` shape** — top-level `"endState": { command, status,
  detail }` block vs. a synthetic entry in `tasks`? Top-level seems
  cleaner; the generator's header already aggregates.
- **Config write timing** — write `project.commands` immediately on
  approval, or only after the end-state check actually passes? (A failing
  approved command may still be worth persisting — it is configured intent
  — but that changes the next run's stop behavior.)
- **Multiple candidates** — offer only the best one by `test → lint →
  build` precedence, or list all and let the user pick?
- **lint-staged nuance** — a hook running `lint-staged` with check-only
  linters is partial verification (changed files only). Candidate with a
  caveat, or excluded entirely?
