# Deep /spec.plan — decision gate, convergence loop, plan report

## Problem

Frame's built-in `/spec.plan` is a one-shot prompt: read `spec.md`, write
`plan.md`. It works, but it has three structural weaknesses:

- Plans inherit **stale spec claims** — nothing forces the agent to verify
  that the files/symbols the spec cites still exist before planning on top
  of them.
- Open forks survive into the plan as prose ("X vs Y — decide at
  implementation time"), so decisions leak into `/spec.implement`, where the
  user is least involved.
- The terse `.frame` plan format can't carry the *reasoning* — why this
  architecture, what was rejected, what the risks are. That story is lost.

A richer flow was prototyped as a personal Claude Code skill in another
project (evidence pass → user decision gate → self-critique convergence loop
→ plan + self-contained HTML report) and produced clearly better plans; both
the author and the project owner were satisfied with the results. This spec
builds a **generalized** version of that flow into Frame as the built-in
default. The prototype skill is the reference for intent, not a literal
source: project-specific content is dropped and the plan format is aligned
to Frame's (which includes `## Footprint`).

## Goal

### 1. New default `spec.plan` prompt template (deep flow)

Rewrite `src/templates/commands/claude-code/spec.plan.md` so the dispatched
planning run performs, in order:

1. **Evidence pass** — read `spec.md` + `status.json` fully; verify every
   file/symbol/behavior the spec cites against the current codebase
   (record claim → verified `file:line`, note drift); build a coverage
   checklist (every Goal / Constraint / Success Criterion gets an ID).
2. **Decision gate, before any plan text** — resolve open forks *with the
   user* via `AskUserQuestion`, in two sequential stages: **business**
   (scope, user-facing behavior, UX semantics) first, then **technical**
   (implementation forks where more than one approach is defensible).
   Each question offers 1–2 real alternatives with one-line trade-offs,
   recommendation first. Seeded by the spec's `## Open Questions` section
   when present, plus forks surfaced by the evidence pass. Answers can spawn
   follow-up questions (causally linked to a specific answer, never
   fishing); a stage stops when a round spawns nothing new, hard-capped at
   3 rounds per stage.
3. **Convergence loop** — draft the plan internally, self-critique against a
   checklist (format, coverage-ID mapping, decisions embedded, paths/symbols
   real, task-derivability, no TBDs), revise; max 4 iterations, then surface
   what still fails instead of silently shipping. Keep a one-line log per
   iteration.
4. **Write artifacts** — `plan.md` in Frame's strict format (see
   Constraints), with a "Resolved plan-time decisions" subsection under
   `## Architecture` recording each gate decision + rationale; update
   `status.json` → `planned`.
5. **Plan report** — write a self-contained HTML report **inside the spec
   folder** (`.frame/specs/<slug>/`), carrying what the strict plan format
   cannot: what & why, architecture walkthrough with per-flow diagrams,
   decision story (business/technical cards with chosen vs rejected
   panels), risks & edge matrix, coverage matrix mapping every spec item to
   the plan section that owns it, verified-claims table, convergence log.

### 2. Report visual template shipped and staged

Frame ships a canonical HTML visual template (inline CSS, component palette
for flow diagrams / decision cards / coverage tables) next to the command
templates. The prototype skill's existing `template.html` is the starting
point (already seeded in place at
`src/templates/commands/claude-code/plan-report-template.html`, to be
restyled during implementation); it is restyled to Frame's design system using the **dark theme
palette** (`src/renderer/styles/variables.css`: warm neutrals, amber accent,
DM Sans / JetBrains Mono) so reports look native to Frame — dark-only, no
`prefers-color-scheme` switching. Its hardcoded flow-copy (the `docs/reports/`
head comment, "produced by /spec-plan") is updated to the Frame flow
(spec-folder path, `/spec.plan`). Because packaged app assets live inside `app.asar` and are not
readable by the terminal CLI, `buildSpecCommandFile` stages the asset into
`.frame/runtime/` alongside the staged prompt and interpolates its path into
the prompt. The existing per-project override mechanism
(`.frame/templates/...`) applies to this asset too.

### 3. "View Plan Report" button in the spec detail view

When the report HTML exists for a spec, the spec detail page (plan area)
shows a **View Plan Report** button that opens the report. Button is hidden
when the file doesn't exist. `getSpec` (or equivalent) exposes the report's
existence/path to the renderer.

### 4. `spec.new` gains a conditional `## Open Questions` section

Update `src/templates/commands/claude-code/spec.new.md`: after the five
standard sections, the spec author adds `## Open Questions` **only when the
description genuinely leaves unresolved forks that need a developer or
business decision** — each entry names the fork and 1–2 candidate options.
No forks → no section (never invent questions to fill it). This section is
the decision gate's primary input.

## Constraints

- `plan.md` keeps Frame's exact five-section format — `## Architecture`,
  `## Files`, `## Footprint`, `## Dependencies`, `## Sequencing`.
  `## Footprint` is non-negotiable: `parseFootprintMarkdown` and the
  orchestration conflict guard depend on it. (The prototype skill had four
  sections — the built-in version must not drop Footprint.)
- End artifacts and lifecycle unchanged: `plan.md` + `status.json` phase
  `planned`. `derivePhase`, the specs watcher, tasks sync, and orchestration
  need no changes to keep working.
- Zero-touch: every new file lives under `.frame/` — no writes to `docs/`,
  `.claude/`, or other user-repo locations.
- The report HTML is fully self-contained: inline CSS, no external assets,
  no build step; opens standalone in a browser.
- Template override precedence is preserved: a project's
  `.frame/templates/commands/claude-code/spec.plan.md` (and the report
  template asset) still win over Frame defaults.
- Shipped templates contain no project-specific content (no paths,
  migration conventions, or stack assumptions from the prototype's origin
  project).
- The interactive gate runs inside the normal dispatched terminal session —
  no new IPC or dispatch mechanics for questions; `AskUserQuestion` is
  available to the agent natively.
- `codex` / `gemini` template directories are untouched (they are empty
  today; this stays Claude Code-only).

## Success Criteria

- When the user clicks **Run /spec.plan** on a `specified` spec, the agent
  verifies spec claims against the codebase and asks business → technical
  questions with a recommended option first, *before* writing any plan
  text.
- The produced `plan.md` contains all five sections; `getSpecFootprint`
  returns the Files entries; the spec's phase flips to `planned` via the
  normal watcher/reconcile path.
- No "TBD" / "decide later" / unresolved "vs" survives in `plan.md`; every
  gate decision appears under "Resolved plan-time decisions" with its
  rationale.
- The report HTML exists in the spec folder after a planning run, opens
  standalone in a browser, and contains the decision story and the coverage
  matrix.
- The spec detail page shows **View Plan Report** only when the report file
  exists; clicking it opens the report.
- Prompt staging works in a packaged build: the agent can read the staged
  report template from `.frame/runtime/` (nothing is read from inside
  `app.asar`).
- A spec generated by the new `spec.new` template includes
  `## Open Questions` when the description leaves real forks open, and
  omits the section entirely when it doesn't.

## Out of Scope

- Rendering the report *inside* Frame (in-app webview / panel tab) — v1
  only opens the file; an embedded viewer can be a follow-up spec.
- Deep versions of `/spec.new`, `/spec.tasks`, `/spec.implement` (beyond
  the conditional Open Questions addition to `spec.new`).
- `codex` / `gemini` template variants of the deep flow.
- Report versioning or history on re-plan — the report is overwritten.
- Conductor/orchestration awareness of plan reports.
- Migrating existing specs' plans to the new format or backfilling reports.

## Open Questions

- **How the report opens from the panel:** system default browser via
  `shell.openPath` (simplest, keeps v1 small) vs an in-app `BrowserWindow`
  (keeps the user inside Frame). Recommendation: system browser for v1.
- **Report filename inside the spec folder:** `plan-report.html` vs
  `plan.html`. Affects the renderer's existence check and the prompt
  template; pick one at plan time and use it everywhere.
- **Gate/loop guardrail tuning:** the prototype caps follow-up questioning
  at 3 rounds per stage and the convergence loop at 4 iterations. Keep
  as-is for Frame's general audience, or loosen/tighten?
- **Report typography:** the report is self-contained (no external assets),
  so DM Sans can't be fetched from a CDN. Use a local-first font stack
  (`'DM Sans', -apple-system, …` — renders as DM Sans only where installed)
  or embed the font as a data URI (+~100 KB per report)?

RESOLVED at spec time:
- Report theme → **dark-only**, Frame's dark palette (decided 2026-07-16).
