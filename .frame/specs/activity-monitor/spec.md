---
keywords: activity log, observability, background work, watchers, hooks, monitoring, diagnostics, JSONL
related: audit-q3-reliability-recovery, audit-q3-performance-resources, spec-knowledge-layer, audit-q3-product-analytics, non-invasive-overlay
---

# Activity Monitor — record and surface the work Frame does on its own

## Problem

Frame does a large amount of work nobody sees. Today none of it is recorded:

- **6 fs watchers** and **5 visibility-gated pollers** fire on their own schedule.
- `reconcilePhase` rewrites spec `status.json` files without a user gesture.
- `fsSafe` silently recovers corrupt state from `.bak` and preserves the broken
  copy as `.corrupt-<ts>`.
- **~2,800 lines of scripts** live in `.frame/bin/` and run in **four host
  processes Frame cannot see**: the git pre-commit hook (`update-structure.js`,
  `check-freshness.js`), Claude Code hooks (`spec-hint.js` → `spec-index.js`),
  the orchestration command bus, and `implement-launch.js` — which runs with the
  Frame app closed entirely.

Three costs follow:

1. **Our guarantees are unfalsifiable.** `spec-hint.js` has **eleven silent
   `return` points** — six in `preEdit` (no index, no path, path outside the
   project, `.frame/` path, no history for this file, already emitted this
   session), four in `promptMode`, one in `emit` — all exiting 0 with no
   output. Nothing distinguishes *"the hook ran and deliberately stayed quiet"*
   from *"the hook never fired"* or *"the hook was never installed"*. The Spec
   Knowledge Layer's entire claim is determinism, and today it cannot be checked.
   The same is true of `pollGate`'s "hidden window ⇒ zero timer wakeups".

2. **Invisible incidents stay invisible.** During a merge, watchers read a
   conflicted `tasks.json` and `reconcilePhase` downgraded **18 specs'**
   `status.json` from `done`. There was no record of it happening and no way to
   watch it happen. The mitigation (`task-watcher-pause`) is still pending and
   will itself be unverifiable without this layer.

3. **Users cannot see what Frame writes into their repo.** Every init copies 8
   parser scripts plus `lang/` into `.frame/bin/`, installs or appends a
   pre-commit hook, and read-modify-writes `.claude/settings.json` — all silently.

`logger.js` exists and is sound (electron-log, secret redaction, 5 MB × 3
rotation) but only **11 of 33** main modules use it, against **93 `console.*`
calls** that persist nowhere. `perfMonitor.js` exists but is dev-gated and has
accumulated only 8 call sites across 3 modules since it was written — proof that
hand-sprinkled instrumentation rots.

## Goal

**Tier 1** of an activity layer: a per-project, append-only record of the work
Frame initiates on its own, written by both the app process and the
out-of-process scripts, plus a user-facing panel that reads it.

The recording filter is a single rule:

> **Record it when Frame itself is the trigger — a timer, a watcher, a hook, a
> guard, a recovery. Do not record it when the user's gesture is the trigger and
> the result is already on screen.**

Opening the spec panel is not recorded. The watcher cascade that a user's click
sets off *is* — the gesture is the root, the cascade is the invisible part.

Tier 1 covers:

- **A file-append contract, not a module.** A minimal JSONL append helper that
  both the Electron main process and the dependency-free `.frame/bin/` scripts
  can call. Best-effort, never throws, never blocks its host.
- **Event sources:** the 6 watchers, `reconcilePhase` phase changes,
  `scheduleIndexRefresh`/`ensureFresh` rebuilds, `fsSafe` corruption recovery,
  and — highest value — **`spec-hint.js`'s decision on every invocation,
  including each of the eleven quiet paths, with a reason code**.
- **Suppressions are events.** A guard that prevented work must say so: poll
  skipped because the window was hidden, `ensureFresh` no-op because the index
  was fresh, spec-hint quiet because this file was already covered this session,
  debounce collapsing N fires into 1. Without these, silence is ambiguous —
  it means either "working, nothing needed" or "dead", and the panel cannot tell
  them apart.
- **Two buckets:** `project/<key>` for project-scoped work, `app` for what isn't
  (launch, update check, tool selection). Project key must be derived from the
  absolute path, not `path.basename` — `promptLogger` keys prompt history by
  basename today, so `~/work/api` and `~/clients/acme/api` collide.
- **A panel with two faces off one stream.** The default view shows only events
  carrying a human-readable label ("3 spec files changed, statuses reconciled";
  "spec history injected for `specManager.js`"). A detail toggle shows the raw
  records. Not two pipelines — one stream, two filters.
- **A fixed right-edge icon rail** as the panel's entry point. `#main-content`
  is already a flex row with the panels as siblings of `#terminal-container`,
  so the rail is added as the **last** flex child: it sits at the far edge and
  never moves, and panels open inboard of it. Order: terminal · panel · rail.

The rail also gives Frame's own instruments a visible home. Today Specs, Tasks,
Claude, GitHub, Prompts and Overview are reachable only through the `⋯` overflow
menu in `terminalTabBar.js` — invisible until found. The semantic split the rail
establishes: **left rail = the project's content** (projects, files, changes,
agent); **right rail = Frame's instruments**. Migrating the six existing
destinations is deliberately *not* part of this spec (see Out of Scope), but the
rail is built to host them.

## Constraints

- **`audit-q3-performance-resources` is in flight** (`implementing`) and its
  footprint already owns `perfMonitor.js`, `pollGate.js`, `specManager.js`,
  `ptyManager.js`, `fsSafe`-adjacent writers and 18 more files. Tier 1 must
  **not** absorb or restructure `perfMonitor.js`, and any edit to `pollGate.js`
  or `specManager.js` must be coordinated against that spec's open work.
  Its remaining task (T10, runtime measurement: TTI, lag-sampler silence,
  hidden-window quiet) is precisely what this layer would make observable — so
  this spec should *serve* it, not collide with it.
- **No new repo footprint.** `non-invasive-overlay` (specified) commits Frame to
  a single `.frame/` footprint and to never editing the tracked tree. The
  activity record is churny, personal, per-machine data; it must not become
  something a team that opts into committing `.frame/` would ship. Precedent:
  `promptLogger` already keeps prompt history outside the repo.
- **Local only, never transmitted.** This is not telemetry.
  `audit-q3-product-analytics` fixed a 10-event, enum-only, counts-only registry
  for what leaves the machine; nothing in this layer may reach Aptabase or any
  network path. The two are complements: telemetry says *what breaks in the
  wild*, this says *why, on this machine*.
- **Redaction is mandatory.** Every written value passes through
  `logger.redact()` (`audit-q3-reliability-recovery`). No payloads by default —
  names, durations, outcomes, counts, byte sizes only. The `promptLogger`
  plaintext-capture bug is the anti-pattern this must not repeat.
- **Never break the host.** The out-of-process writers run inside a git
  pre-commit hook and inside Claude Code hooks. A failure to write must never
  fail a commit, never block a tool call, never produce output on stdout. Same
  never-block contract `spec-hint.js` already honors.
- **Backward compatible with stale `.frame/bin/` copies.** Those scripts are
  copies refreshed only on init; a user may be running an older generation. New
  code must degrade to today's behavior when the append helper is absent.
- **Bounded.** Rotating, size-capped files and a per-source rate cap, so a
  chatty watcher cannot flood the record or the panel.
- **Within the existing perf budget.** No hot-path sync I/O, no new timers that
  survive a hidden window (`audit-q3-performance-resources` budgets: ≤ 50 ms
  block per operation, zero hidden-window timer fires). The panel's live stream
  must be coalesced and back-pressured the way PTY output already is — the
  monitor must never become the load it is meant to observe.
- **The panel never blocks the terminal.** Activity is what you watch *while* an
  agent works, so it is a side panel (resizable, non-blocking) — not a modal or
  a full-screen overlay. This makes the panel the single read surface: the
  labelled/detail toggle and source filtering live inside it, with no escape to
  a wider screen.
- **`index.html` is inside `audit-q3-performance-resources`'s in-flight
  footprint.** The rail markup lands there; the edit must be coordinated with
  that spec's open work rather than merged blind.

## Success Criteria

- When `spec-hint.js` is invoked and injects history, then the record contains
  one entry naming the file and the number of prior specs surfaced.
- When `spec-hint.js` is invoked and returns without injecting, then the record
  contains one entry with the specific reason code — and the eleven quiet paths
  are distinguishable from one another and from "never invoked".
- When any of the 6 watchers fires, then the record names the watcher, the
  change count, and what it triggered.
- When `reconcilePhase` changes a spec's phase without a user gesture, then the
  record names the slug, the old phase, and the new phase.
- When `fsSafe` recovers a corrupt state file from `.bak`, then the record names
  the file and the recovery outcome.
- When a guard suppresses work (hidden-window poll skip, fresh-index no-op,
  session-dedup quiet, debounce collapse), then a suppression entry is written
  naming the guard — so the panel never leaves the user reading ambiguous silence.
- When the git pre-commit hook runs `update-structure.js` or
  `check-freshness.js`, then entries appear in the record even though Frame's
  process was never involved.
- When events were written while the Frame app was closed, then opening the app
  surfaces them in the panel.
- When two projects share a directory basename, then their records stay separate.
- When the panel is opened with no filter, then only labelled events are listed;
  when the detail toggle is on, then the raw stream is listed.
- When the right rail is present, then it stays at the far edge and does not
  shift horizontally as panels open or close.
- When the activity panel is open, then the terminal remains visible and usable,
  and events appear in it while an agent is running.
- When the activity writer fails for any reason (unwritable path, full disk,
  malformed input), then the host continues unaffected: the commit succeeds, the
  tool call proceeds, the app does not surface an error.
- When a record file reaches its size cap, then it rotates and the oldest
  generation is dropped, with total on-disk size bounded.
- When telemetry is disabled or enabled, then this layer's behavior is unchanged
  (they share no state and no transport).

## Out of Scope

- **Tier 2** — repo-mutation records (parser copies, pre-commit install,
  `.claude/settings.json` writes, `commandStaging`) and `.frame/bin/` script
  version-drift detection.
- **Tier 3** — orchestration bus detail, PTY spawn/exit and backpressure,
  per-poller cadence detail, IPC-level tracing for user-initiated calls.
- **Migrating the `⋯` overflow menu's six destinations** (Specs, Tasks, Claude,
  GitHub, Prompts, Overview) into the new rail. The menu is already a
  data-driven `{ label, icon, action, key }` array, so the move is cheap — but
  it touches five panel modules at once and belongs in its own spec. This spec
  ships the rail with Activity as its only item.
- **A deep-dive dashboard / full-history overlay for activity.** The panel is the
  single read surface in Tier 1; a second layer earns its place once enough
  history accumulates to make the panel feel narrow, not before.
- **Agent access** to the activity record.
- Absorbing or replacing `perfMonitor.js`, `logger.js`, or the telemetry registry.
- `scripts/eval/` — a development measurement harness, not production behavior.
- Fixing `promptLogger`'s basename-collision keying (separate task).
- Any remote shipping, aggregation, or dashboard of this data.

## Open Questions

1. **Where does the record live?**
   (a) User-scoped `~/.frame/activity/<project-key>/` — no repo footprint,
   matches the `promptLogger` precedent, survives the `non-invasive-overlay`
   rules unconditionally. (b) In-repo `.frame/runtime/activity/` — already
   gitignored and already the home of `spec-hint`'s session state, so the
   out-of-process scripts reach it with no path resolution work, but it becomes
   repo content the moment a team opts into committing `.frame/`.

2. **Retention bound.** Size-capped rotation (e.g. 2 MB × 2 generations per
   bucket) versus a time window (e.g. 7 days, matching `spec-hint`'s existing
   session-state cleanup).

3. **Which events earn a human-readable label.** Roughly 20–25 of the Tier 1
   sources plausibly deserve one; the rest stay detail-only. The set needs to be
   decided explicitly rather than emerging per call site, or it will drift the
   way `perfMonitor`'s call sites did.
