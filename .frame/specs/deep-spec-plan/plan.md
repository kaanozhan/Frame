# Plan — Deep /spec.plan — decision gate, convergence loop, plan report

## Architecture

### Resolved plan-time decisions

- **Report opening** → system default browser via Electron `shell.openPath`,
  called directly from the renderer (precedent: `settingsModal.js` already
  uses `require('electron').shell`; `main/menu.js:274` uses `shell.openPath`).
  No new IPC channel — matches the spec's "no new dispatch mechanics" bias
  and its own recommendation. In-app `BrowserWindow` viewer stays a follow-up
  spec.
- **Report filename** → `plan-report.html`. Unambiguous next to `plan.md`
  (a file literally named `plan.html` would read as "the plan, rendered"),
  and greppable. Used everywhere: `specManager` constant, prompt template,
  renderer existence check.
- **Gate/loop guardrails** → keep the prototype's numbers: max 3 follow-up
  rounds per gate stage, max 4 convergence iterations. They were validated
  in practice and the caps are safety rails, not tuning knobs; loosening
  them without evidence just risks longer runs.
- **Report typography** → local-first font stack
  (`'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif`, mono:
  `'JetBrains Mono', 'SF Mono', Consolas, monospace` — mirrors
  `variables.css`). No data-URI font embed: +~100 KB per report for a
  cosmetic gain, and the fallback stack is already coherent.
- **Staged asset location** → `.frame/runtime/assets/plan-report-template.html`.
  Sibling of `runtime/prompts/` rather than inside it, so the prompts dir
  stays homogeneous (`<slug>__<command>.md` files only) and the orch-bus
  pattern (`runtime/orch-bus/`) of one subdir per concern is followed.

### Deep prompt flow (template content, not app code)

The new `spec.plan.md` template scripts the dispatched agent through five
ordered stages. All flow logic lives in prose inside the template — Frame's
app code doesn't orchestrate the stages:

1. **Evidence pass** — read `spec.md` + `status.json` fully; for every
   file/symbol/behavior the spec cites, verify against the working tree and
   record `claim → file:line` (or mark drift). Assign an ID to every Goal,
   Constraint, and Success Criterion (G1…, C1…, S1…) to form the coverage
   checklist used later.
2. **Decision gate** — before writing any plan text, resolve open forks with
   the user via the natively available `AskUserQuestion` tool, in two
   sequential stages: business first, then technical. Inputs: the spec's
   `## Open Questions` section (if present) plus forks surfaced by the
   evidence pass. Each question: 1–2 real alternatives, one-line trade-offs,
   recommendation listed first. Follow-ups must be causally linked to a
   specific prior answer; a stage ends when a round spawns nothing new,
   hard cap 3 rounds per stage. Forks with an obvious single defensible
   answer are decided silently and recorded, not asked.
3. **Convergence loop** — draft `plan.md` internally; self-critique against
   a fixed checklist (exact five-section format, every coverage ID mapped to
   an owning plan section, every gate decision embedded, all paths/symbols
   verified real, tasks derivable from Sequencing, zero TBD/"decide
   later"/unresolved "vs"); revise and repeat, max 4 iterations; keep a
   one-line log per iteration. If items still fail after 4, say so in the
   final message instead of silently shipping.
4. **Write artifacts** — `plan.md` in Frame's exact five-section format
   (the section guidance from the current template is carried over
   verbatim, including the Footprint rules), plus a
   `### Resolved plan-time decisions` subsection under `## Architecture`
   recording each gate decision and rationale; update `status.json` →
   `planned` (existing wording kept).
5. **Plan report** — read the staged visual template at
   `{report_template_path}` (interpolated), fill its `{{…}}` tokens, and
   write `.frame/specs/{slug}/plan-report.html`: what & why, architecture
   walkthrough with per-flow diagrams (`.flowblock`/`.fd` component
   palette), decision cards grouped business/technical with chosen vs
   rejected panels, risks & edge matrix, coverage matrix (every G/C/S ID →
   owning plan section), verified-claims table, convergence log. Overwrites
   on re-plan.

The end artifacts and lifecycle are unchanged (`plan.md` + `status.json`
phase `planned`), so `derivePhase`, the specs watcher, tasks sync,
`parseFootprintMarkdown`, and orchestration need no changes.

### Report template asset + staging

- Canonical asset: `src/templates/commands/claude-code/plan-report-template.html`
  — the prototype is already seeded at this exact path and is restyled **in
  place** to Frame's dark palette from `src/renderer/styles/variables.css`
  (`--bg-deep #0f0f10`, cards `#1a1a1c`, text `#e8e6e3`/`#a09b94`, amber
  accent `#d4a574`, borders `rgba(255,255,255,0.08)`, success `#7cb382`,
  warning `#e0a458`), dark-only — no `prefers-color-scheme` switching.
  Head comment rewritten for the Frame flow: copy target is
  `.frame/specs/<slug>/plan-report.html`, produced by `/spec.plan`; the
  component-palette documentation and `{{…}}` token scheme are kept.
  Fully self-contained: inline CSS, no external assets, no scripts.
- Staging: packaged app assets live inside `app.asar` and are unreadable by
  the terminal CLI, so `buildSpecCommandFile` — the only path Frame's UI
  uses to dispatch (`agentDispatch.js:304`) — additionally stages the asset
  when `command === 'spec.plan'`: resolve override-first
  (`.frame/templates/commands/claude-code/plan-report-template.html`, same
  precedence as `loadCommandTemplate`), read via `fs` (asar-transparent in
  the main process), write to
  `<project>/.frame/runtime/assets/plan-report-template.html`, overwriting
  each dispatch so override edits are picked up.
- Interpolation: `getCommandPrompt` gains one var,
  `report_template_path: '.frame/runtime/assets/plan-report-template.html'`
  (project-relative, like the staged-prompt `relPath`), consumed by the new
  `spec.plan.md` template. The existing `{(\w+)}` interpolator handles it;
  unknown tokens in other templates stay untouched as today.

### "View Plan Report" button

- `getSpec` adds one field to its payload: `planReportPath` — the absolute
  path to `<specDir>/plan-report.html` when the file exists, else `null`.
  A `PLAN_REPORT_FILE = 'plan-report.html'` constant sits next to
  `PLAN_FILE`.
- Both spec detail surfaces consume it in their Plan tab body (`specPanel.js`
  `renderTabBody('plan')` and `specsDashboard.js` equivalent): when
  `planReportPath` is set, render a small **View Plan Report** button above
  the rendered plan markdown; hidden otherwise. Click →
  `require('electron').shell.openPath(planReportPath)`.
- No freshness plumbing needed: the report is written under
  `.frame/specs/<slug>/`, which the existing recursive specs watcher already
  covers — the debounced `SPEC_DATA` push triggers `reloadDetail()`, which
  re-invokes `GET_SPEC` and picks up the new field.
- Button styling reuses the existing `.btn .btn-secondary` classes; the
  small wrapper row (spacing above the markdown) goes in
  `styles/components/panels.css`, where all `spec-detail` styles live.

### `spec.new` Open Questions

`spec.new.md` gains guidance after the five standard sections: append
`## Open Questions` **only when** the description leaves genuinely
unresolved forks needing a developer/business decision — each entry names
the fork and 1–2 candidate options; no forks → no section, never invent
questions. The five required headings and the rest of the template are
unchanged, so nothing downstream (which only keys off `spec.md` existence)
is affected.

## Files

- `src/templates/commands/claude-code/spec.plan.md` — **Modified** — full rewrite: evidence pass → decision gate → convergence loop → plan.md → plan-report.html.
- `src/templates/commands/claude-code/spec.new.md` — **Modified** — add conditional `## Open Questions` authoring guidance.
- `src/templates/commands/claude-code/plan-report-template.html` — **New** — shipped canonical report asset; prototype already seeded here, restyled in place to Frame dark.
- `src/main/specManager.js` — **Modified** — `PLAN_REPORT_FILE` constant; `planReportPath` in `getSpec`; asset staging in `buildSpecCommandFile`; `report_template_path` interpolation var.
- `src/renderer/specPanel.js` — **Modified** — View Plan Report button in the detail Plan tab.
- `src/renderer/specsDashboard.js` — **Modified** — same button in the dashboard's detail Plan tab.
- `src/renderer/styles/components/panels.css` — **Modified** — wrapper row styling for the report button.

## Footprint

- src/templates/commands/claude-code/spec.plan.md
- src/templates/commands/claude-code/spec.new.md
- src/templates/commands/claude-code/plan-report-template.html
- src/main/specManager.js
- src/renderer/specPanel.js
- src/renderer/specsDashboard.js
- src/renderer/styles/components/panels.css

## Dependencies

None.

## Sequencing

1. **specManager: report path exposure** — add `PLAN_REPORT_FILE`, extend
   `getSpec` with `planReportPath` (absolute path or `null`). Shippable
   alone: payload consumers ignore unknown fields.
2. **specManager: asset staging + interpolation** — add the
   `report_template_path` var to `getCommandPrompt`; in
   `buildSpecCommandFile`, for `spec.plan`, stage the report template
   (override-first) into `.frame/runtime/assets/`. Missing default asset
   logs and continues (prompt build must not fail).
3. **Report visual template** — restyle the seeded
   `plan-report-template.html` in place: apply the dark Frame palette and
   font stacks, rewrite the head comment's flow copy to the spec-folder path
   and `/spec.plan`, strip any origin-project content. Verify it opens
   standalone in a browser.
4. **Deep `spec.plan.md` rewrite** — implement the five-stage prompt (
   evidence pass, two-stage decision gate with caps, convergence loop with
   checklist and iteration log, strict five-section `plan.md` with
   "Resolved plan-time decisions", report generation from
   `{report_template_path}` to `plan-report.html`, `status.json` →
   `planned`). Carry over the existing Footprint section guidance verbatim.
5. **`spec.new.md` Open Questions** — add the conditional section guidance.
6. **View Plan Report button** — render the button from `planReportPath` in
   `specPanel.js` and `specsDashboard.js` Plan tabs, wire
   `shell.openPath`, add the `panels.css` wrapper styles.
7. **End-to-end pass** — run `/spec.plan` on a `specified` spec in a dev
   build: gate questions appear before plan text, `plan.md` parses via
   `getSpecFootprint`, phase flips to `planned`, `plan-report.html` opens
   standalone, button appears/hides correctly.
