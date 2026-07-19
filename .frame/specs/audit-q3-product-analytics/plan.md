# Plan — Product analytics & instrumentation

## Architecture

### Resolved plan-time decisions

- **Activation measurement (asked)** — Plain events only; no explicit `first_*` milestone events. Activation is read as Aptabase's unique-users-per-event (e.g. unique users firing `spec_created`). Rationale: simplest set, no persistent local "first done" flags to maintain; approximate funnel precision is acceptable for the founder's questions.
- **Fail-closed behavior (asked)** — Silent fail-closed. When `user-settings.json` is unreadable *and* its `.bak` cannot recover it, telemetry treats the session as opted-out: no events sent, no UI shown. A genuinely fresh install (ENOENT — file never existed) keeps default-on opt-out semantics. Rationale: private-by-default with zero nag; a user who never opted out loses at most one session of data.
- **PII guard (asked)** — Runtime event registry. A declarative allowlist (event name → allowed props → allowed enum values) lives in a pure module; `track()` silently drops unregistered events, props, and out-of-enum values. A unit test asserts the registry contains only enum-typed props (no free-form strings). Rationale: mechanical enforcement — a future contributor cannot ship a content-bearing property past the registry.
- **Renderer-originated events (asked)** — New `TELEMETRY_TRACK` IPC channel. Renderer sends `(eventName, props)`; the main process validates against the same registry before anything reaches Aptabase, so the renderer cannot bypass the allowlist. Rationale: captures renderer-only signals (`orchestrator_opened`, `agent_run_started`) at their true source.
- **Vendor (silent)** — Stay on Aptabase. Constraint says prefer extending it absent a concrete reason to switch; every founder question in the spec (feature usage, activation, common errors) is answerable from event counts + unique-user counts, which Aptabase provides. PostHog's funnels/identity features exceed the spec's out-of-scope line (no per-user tracking).
- **API shape (silent)** — Extend `src/main/telemetry.js` with `track(name, props)` gated by `isEnabled() && initialized`, exactly as the spec's constraint suggests; `trackAppStarted()` becomes a thin wrapper over it.
- **Tool-id cardinality (silent)** — The `tool` prop is the fixed enum `claude | codex | gemini | custom`. User-defined custom tool ids are user content and must never be sent; a `normalizeTool()` helper maps anything outside the built-in ids (including spec-side `claude-code` → `claude`) into the enum. Same reasoning drops plugin identity from `plugin_toggled` (marketplace plugin ids are arbitrary third-party strings): only `action: enabled|disabled` is sent.
- **Error taxonomy (silent)** — One `error_occurred` event with a fixed `category` enum derived from failure paths the code already handles: `agent_cli_not_found`, `agent_cli_timeout`, `agent_spawn_error`, `terminal_create_failed`, `orch_worktree_failed`, `orch_merge_failed`, `orch_worker_failed`, `plugin_marketplace_failed`, `settings_corrupt_recovered`. Counts and categories only — never messages, stacks, paths, or content.
- **Testability (silent)** — `telemetry.js` requires `@aptabase/electron` and `userSettings` (which requires `electron`), so it cannot load under `node --test`. The registry, prop validation, tool normalization, and the enabled/fail-closed decision function are extracted into a pure module (`src/main/telemetryEvents.js`) with no Electron imports, matching how `fsSafe`/`logger` are tested today.

### Event set (the registry)

| Event | Props (all enum) | Fired from |
| --- | --- | --- |
| `app_started` | — | existing, `src/main/index.js` boot |
| `project_initialized` | — | main, Frame init IPC success path |
| `spec_created` | — | main, `specManager.createSpec` |
| `spec_phase_advanced` | `phase: draft\|specified\|planned\|tasks_generated\|implementing\|done` | main, both phase-write paths in `specManager` |
| `agent_run_started` | `tool: claude\|codex\|gemini\|custom` | renderer `agentDispatch`, via IPC |
| `orchestrator_opened` | — | renderer `orchestrator.open()`, via IPC |
| `orchestration_run_started` | — | main, `startOrchestration` new-session path only (not reattach) |
| `plugin_toggled` | `action: enabled\|disabled` | main, `pluginsManager.togglePlugin` |
| `ai_tool_selected` | `tool: claude\|codex\|gemini\|custom` | main, `aiToolManager.setActiveTool` |
| `error_occurred` | `category:` (enum above) | main, the nine handled failure sites |

### Fail-closed opt-out

`userSettings.load()` already reads through `fsSafe.readJsonWithRecovery`. The three outcomes map to telemetry state:

- **ENOENT** (`data:null, error:null`) — fresh install; default-on stands.
- **Corrupt, `.bak` recovered** (`source:'bak'`) — settings are the last good copy; trust them (an explicit opt-out is in the recovered data).
- **Unrecoverable** (`data:null, error` set) — `userSettings.loadFailed()` returns `true`; `telemetry.isEnabled()` returns `false` for the whole session. This closes the remaining re-opt-in path (`cache = data || {}` resetting to `{}` while `isEnabled()` reads `null !== false`).

The decision is implemented as a pure function `effectiveEnabled({ value, loadFailed })` in `telemetryEvents.js` so all four cases are unit-testable: `(null, ok) → true`, `(false, ok) → false`, `(true, ok) → true`, `(anything, failed) → false`.

### Data flow

Renderer call sites → `ipcRenderer.send(IPC.TELEMETRY_TRACK, name, props)` → main listener in `index.js` → `telemetry.track(name, props)`. Main call sites call `telemetry.track()` directly. `track()` gates on `isEnabled() && initialized`, validates `(name, props)` against the registry (dropping anything unknown), then calls `aptabase.trackEvent(name, validatedProps)`.

## Files

- `src/main/telemetryEvents.js` — **New** — pure module: event registry, `validateEvent(name, props)`, `normalizeTool(id)`, `effectiveEnabled({value, loadFailed})`. No Electron imports.
- `src/main/telemetry.js` — **Modified** — add `track(name, props)`; `isEnabled()` consults `userSettings.loadFailed()` via `effectiveEnabled`; `trackAppStarted()` delegates to `track`; update the header comment (it currently promises a single event).
- `src/main/userSettings.js` — **Modified** — record load health in `load()`; export `loadFailed()`.
- `src/shared/ipcChannels.js` — **Modified** — add `TELEMETRY_TRACK` next to `TELEMETRY_SET_ENABLED`.
- `src/main/index.js` — **Modified** — `ipcMain.on(IPC.TELEMETRY_TRACK, …)` listener next to the existing `TELEMETRY_SET_ENABLED` handler.
- `src/main/frameProject.js` — **Modified** — `track('project_initialized')` on the `INITIALIZE_FRAME_PROJECT` success path.
- `src/main/specManager.js` — **Modified** — `track('spec_created')` in `createSpec`; `track('spec_phase_advanced', {phase})` where `updateSpecStatus` and `reconcilePhase` write a changed phase.
- `src/main/aiToolManager.js` — **Modified** — `track('ai_tool_selected', {tool})` in `setActiveTool`; `error_occurred` categories from the `CHECK_AI_TOOL_AVAILABLE` not-found/timeout/spawn-error results.
- `src/main/ptyManager.js` — **Modified** — `error_occurred {category: terminal_create_failed}` in the `TERMINAL_CREATE` catch.
- `src/main/orchestrationManager.js` — **Modified** — `track('orchestration_run_started')` in new-session `startOrchestration`; `error_occurred` for worktree-failed, merge-failed, worker-failed paths.
- `src/main/pluginsManager.js` — **Modified** — `track('plugin_toggled', {action})` in `togglePlugin`; `error_occurred {category: plugin_marketplace_failed}` where marketplace refresh classifies a git failure.
- `src/renderer/agentDispatch.js` — **Modified** — send `agent_run_started` (normalized tool) after successful dispatch/start.
- `src/renderer/orchestrator.js` — **Modified** — send `orchestrator_opened` in `open()`.
- `test/telemetry.test.js` — **New** — registry is enum-only (no free-form props); unknown events/props/values are dropped; `normalizeTool` collapses unknown ids to `custom`; `effectiveEnabled` covers all four load states (the re-opt-in regression test).
- `PRIVACY.md` — **Modified** — replace "a single anonymous event" wording; enumerate every event and its properties; restate the "we do not collect" list; document fail-closed behavior.

## Footprint

- src/main/telemetryEvents.js
- src/main/telemetry.js
- src/main/userSettings.js
- src/shared/ipcChannels.js
- src/main/index.js
- src/main/frameProject.js
- src/main/specManager.js
- src/main/aiToolManager.js
- src/main/ptyManager.js
- src/main/orchestrationManager.js
- src/main/pluginsManager.js
- src/renderer/agentDispatch.js
- src/renderer/orchestrator.js
- test/telemetry.test.js
- PRIVACY.md

## Dependencies

None — `@aptabase/electron` is already in `package.json`, and tests use the existing `node --test` runner.

## Sequencing

1. **Fail-closed opt-out** — add `loadFailed()` to `userSettings.js`; create `telemetryEvents.js` with `effectiveEnabled`; wire `telemetry.isEnabled()` through it; add the four-state regression test in `test/telemetry.test.js`. Ships alone as the privacy fix.
2. **Event registry + `track()`** — add the full registry, `validateEvent`, `normalizeTool` to `telemetryEvents.js`; add `track(name, props)` to `telemetry.js` (gated, validated); refactor `trackAppStarted` onto it; update the module header comment; extend the test file with registry/validation/normalization assertions.
3. **`TELEMETRY_TRACK` IPC channel** — add the channel constant to `ipcChannels.js` and the main-process listener in `index.js` that forwards to `telemetry.track` (validation already lives in `track`).
4. **Main-process feature/activation instrumentation** — `project_initialized` (`frameProject.js`), `spec_created` + `spec_phase_advanced` (`specManager.js`), `ai_tool_selected` (`aiToolManager.js`), `plugin_toggled` (`pluginsManager.js`), `orchestration_run_started` (`orchestrationManager.js`).
5. **Error instrumentation** — `error_occurred` calls at the nine categorized sites in `aiToolManager.js`, `ptyManager.js`, `orchestrationManager.js`, `pluginsManager.js`, plus `settings_corrupt_recovered` where `userSettings.load()` restores from `.bak`.
6. **Renderer instrumentation** — `agent_run_started` in `agentDispatch.js` (dispatch success, default-agent start, spec-command dispatch) and `orchestrator_opened` in `orchestrator.js`, both via `TELEMETRY_TRACK`.
7. **PRIVACY.md disclosure** — enumerate the full event table with properties, restate the never-collected list, document fail-closed; lands with (not after) the instrumentation steps in the same change set.
