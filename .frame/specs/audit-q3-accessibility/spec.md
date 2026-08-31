# Accessibility (a11y) baseline

> Audit-sourced findings spec (Q3 2026 deep-dive review). Captured, not yet planned — recorded via the `audit-q3` study. Formalizes the pending task-prod-a11y.

## Problem

Frame's renderer was built mouse-first and command-palette-first, with a11y as
an afterthought. A code-level review of `index.html` and `src/renderer/` surfaced
concrete gaps across every WCAG category:

**Keyboard reachability — most of the chrome is out of the Tab order.**
`index.html` uses `tabindex="-1"` **41 times**, including on primary controls:
the entire sidebar activity rail (`index.html:96,101,106,111` — Projects/Files/
Changes/Agent), the project switcher (`:123`), `#project-add-btn` (`:158`),
`#btn-refresh-tree`, `#sidebar-agent-launch`, `#btn-start-ai`, `#history-close`,
`#tasks-close`, `#specs-dashboard-close`, etc. These are only reachable by mouse
or the command palette (`commandRegistry.js` / `commandPalette.js`) — there is no
native Tab traversal of the UI. Only two surfaces implement keyboard nav at all
(roving `tabIndex=0`): `fileTreeUI.js:80` and `projectListUI.js:145`. Lane cards
(`laneBoard.js`), dashboards (`tasksDashboard.js`, `specsDashboard.js`), and most
panels have no Arrow/Enter/Space key model.

**Focus management — no trapping, no restore, no focus-trap utility exists.**
A repo-wide search for `focusTrap`/`trapFocus`/`firstFocusable` returns nothing.
Modals only push focus to their first control on open via `requestAnimationFrame`
(`taskRunModal.js:80,165`, `taskConfirmModal.js:79`, `openProjectModal.js:73`) but
Tab can walk straight out of the dialog into the page behind it, and focus is
**never restored** to the triggering element on close. Escape handling is spread
across ~15+ independent `document`-level `keydown` listeners
(`taskConfirmModal.js:35`, `taskRunModal.js:57`, `settingsModal.js:68`,
`taskInfoModal.js:29`, `diffViewer.js:43`, `welcomeOverlay.js:125`, `state.js:249,325`,
`tasksDashboard.js:101`, `specsDashboard.js:72`, `structureMap.js:108`,
`openProjectModal.js:163`, plus the capture-phase menu handler in `index.js:379`).
Because most are bubble/`document` phase and each only self-checks a `visible`
class, a single Esc press can close several stacked overlays at once instead of
just the topmost.

**ARIA — near-zero, concentrated in a few banners.** Only ~54 `aria-*`/`role`
occurrences exist in the entire renderer, most on the telemetry/sample banners
and sidebar rail (`index.html:15,28,95`). Of **107 `<button>`s in `index.html`,
95 have no `aria-label`** — icon-only controls announce as empty or as raw glyphs
(`#history-close ✕` `:` , `#tasks-close ✕`, `#specs-dashboard-close &#x2715;`,
`#btn-refresh-tree`, `#sidebar-agent-launch`) relying purely on a `title` tooltip,
which screen readers do not reliably read. `aria-expanded` is maintained on the
project switcher but not on most other toggles/menus.

**Semantic HTML — heavy div-soup.** Interactive rows (lane cards, session items,
dashboard cards) are `<div>`s with click handlers rather than `<button>`/`<a>`,
so they carry no implicit role, focusability, or key handling.

**Screen-reader viability of the terminal — a11y mode is OFF.** The xterm
instance (`terminalManager.js:316-324`) is constructed without
`screenReaderMode: true`, so the terminal — the app's primary surface — exposes
nothing to assistive tech.

**Color contrast — unverified, low-contrast tokens present.** The theme system
(`styles/variables.css`, `[data-theme="dark"]`/`[data-theme="light"]`) defines
muted tokens likely below WCAG AA 4.5:1 for body text: dark `--text-tertiary
#6b6660` / `--text-muted #4a4642` on `--bg-primary #151516`; light `--text-muted
#b0aba5` on `#f7f5f2`. No contrast has been formally measured.

**Reduced motion — not respected anywhere.** A repo-wide search for
`prefers-reduced-motion` returns **0 matches**, against **~279 animation/
transition/keyframe declarations** in `styles/`, plus spinners and the D3
`forceSimulation` in `structureMap.js:393` (continuous physics animation) and its
zoom/drag. Vestibular users get no relief.

**Text scaling / zoom — unverified** across the fixed-height rails, terminal grid,
and modal layouts.

## Goal

Establish a pragmatic, WCAG-2.1-AA-leaning a11y baseline for the renderer:
(1) make the whole UI keyboard-operable — everything reachable and actionable via
Tab/Shift-Tab/Arrow/Enter/Space/Esc, not just the command palette; (2) add a
single shared focus-trap + focus-restore utility and route all modals/overlays
through it, with one coordinated Esc-stack (topmost-only) handler; (3) give every
icon-only control an accessible name (`aria-label`) and correct roles/`aria-*`
state; (4) enable xterm's built-in `screenReaderMode`; (5) audit and fix theme
contrast to AA; (6) honor `prefers-reduced-motion` across CSS transitions,
spinners, and the D3 simulation.

## Constraints

- Runs in Electron/Chromium — modern ARIA, `:focus-visible`, and
  `prefers-reduced-motion`/`prefers-color-scheme` media queries are all available;
  no legacy-browser compromises needed.
- xterm.js ships its own a11y layer (`screenReaderMode`); prefer enabling/tuning
  it over reimplementing terminal semantics.
- Must work within the existing token-based theme system
  (`styles/variables.css` `[data-theme]`) — contrast fixes adjust tokens, not a
  rewrite; keep both dark and light themes AA-compliant.
- Preserve the command-palette-first workflow and existing keybindings; a11y
  additions must not fight `commandRegistry.js` or terminal key passthrough
  (`terminalManager.js:418`).

## Success criteria

- Every interactive control is reachable and operable by keyboard alone; no
  functional control left at `tabindex="-1"`; lane cards, dashboards, panels, and
  menus have a defined Tab/Arrow/Enter/Space/Esc model.
- A shared focus-trap utility traps Tab within any open modal/overlay
  (`settingsModal`, `taskRunModal`, `taskConfirmModal`, `openProjectModal`,
  `welcomeOverlay`, dashboards) and **restores focus** to the trigger on close;
  Esc closes only the topmost overlay via one coordinated handler.
- All icon-only buttons expose an accessible name; toggles/menus expose correct
  `role` and live `aria-expanded`/`aria-pressed` state; interactive rows use
  semantic elements or proper `role`+`tabindex`+key handlers.
- xterm runs with `screenReaderMode: true`.
- Dark and light theme text/UI colors meet WCAG AA (4.5:1 body, 3:1 large/UI),
  verified with an automated contrast check.
- `@media (prefers-reduced-motion: reduce)` disables/reduces non-essential CSS
  animation and transitions, spinners degrade gracefully, and the D3
  `forceSimulation` settles/stops (or is skipped) under reduced motion.
- An automated a11y check (e.g. axe) runs against key screens with no critical
  violations.

## Out of scope

- Formal, certified WCAG 2.1 AA conformance / third-party audit sign-off.
- Internationalization / RTL / localization (separate spec).
- Full accessibility of the marketing site (`landing/`, `docs/`).
- Deep terminal-content semantics beyond enabling xterm's built-in a11y mode.

## Open questions for /spec.plan

- Which WCAG level and version do we commit to as the bar — AA 2.1 target vs.
  "AA where practical" for the terminal-heavy surfaces?
- Automated tooling: adopt `@axe-core/*` (and jest-axe / Playwright-axe) in CI,
  or run manual audits (Lighthouse, VoiceOver/NVDA passes) only?
- Keyboard model: extend the roving-tabindex pattern already in
  `fileTreeUI.js`/`projectListUI.js` app-wide, or introduce native Tab order by
  removing the blanket `tabindex="-1"` — and how do we reconcile that with the
  command-palette-first design and terminal focus stealing?
- Do we build one internal focus-trap/overlay-stack manager, or pull a small
  dependency (e.g. focus-trap)?
- Contrast: fix by nudging existing theme tokens, or add a dedicated
  high-contrast theme variant?
- Does enabling xterm `screenReaderMode` carry a measurable performance cost on
  large scrollback that we need to gate?
