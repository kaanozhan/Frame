# Outcome — Product analytics & instrumentation

## T01 — Add `loadFailed()` to `src/main/userSettings.js`

Added a module-level `failed` flag set in `load()`: true only when `readJsonWithRecovery` returned no data AND an error (unrecoverable corruption or read failure) — ENOENT and successful `.bak` recovery stay false. Exported `loadFailed()` for telemetry's fail-closed gate (T02). One addition beyond the task title, per the recorded D2 decision: a successful `set()` write clears the flag, since the on-disk file then matches the cache again. Files touched: `src/main/userSettings.js`.

_Captured: 2026-07-19 · 1 file change(s)_

---

## T02 — Create `telemetryEvents.js` with `effectiveEnabled`, route `isEnabled()` through it

Created the pure policy module `src/main/telemetryEvents.js` (no Electron imports) with `effectiveEnabled({value, loadFailed})` and rewired `telemetry.isEnabled()` to consult it plus `userSettings.loadFailed()`. Added `test/telemetry.test.js` covering all four load states — the fail-closed cases are the re-opt-in regression test S2 demands. Files touched: `src/main/telemetryEvents.js` (new), `src/main/telemetry.js`, `test/telemetry.test.js` (new).

_Captured: 2026-07-19 · 3 file change(s)_

---

## T03 — Event registry, `validateEvent`, `normalizeTool`

Added the `EVENTS` registry (10 events, enum-only props), `validateEvent(name, props)` (null for unregistered events; strips unknown keys and out-of-enum values), and `normalizeTool` (built-ins pass, `claude-code`→`claude`, everything else →`custom`) to `telemetryEvents.js`. One refinement over plan.md: `validateEvent` normalizes `tool` props itself, so raw ids from any call site — including the renderer over IPC — can never pass through. Tests assert the registry is mechanically enum-only. Files touched: `src/main/telemetryEvents.js`, `test/telemetry.test.js`.

_Captured: 2026-07-19 · 2 file change(s)_

---

## T04 — `track(name, props)` in telemetry.js

Added `track()` gated by `isEnabled() && initialized` and registry validation; `trackAppStarted()` is now a one-line wrapper over it. Empty validated props are passed as `undefined` to keep the existing `trackEvent('app_started')` wire shape. Rewrote the module header — it promised "a single app_started event", which is no longer true — to point at the registry and PRIVACY.md. Files touched: `src/main/telemetry.js`.

_Captured: 2026-07-19 · 1 file change(s)_

---

## T05 — `TELEMETRY_TRACK` IPC channel

Added the channel constant next to `TELEMETRY_SET_ENABLED` in `src/shared/ipcChannels.js` and a fire-and-forget `ipcMain.on` listener in `src/main/index.js` forwarding to `telemetry.track` — validation stays in `track()`, so the renderer cannot bypass the allowlist. Files touched: `src/shared/ipcChannels.js`, `src/main/index.js`.

_Captured: 2026-07-19 · 2 file change(s)_

---

## T06 — Main-process activation/feature instrumentation

Wired `track()` into the five managers: `project_initialized` on the `INITIALIZE_FRAME_PROJECT` success path (`frameProject.js`), `spec_created` in `createSpec` and `spec_phase_advanced` in both changed-phase write paths (`specManager.js` — `updateSpecStatus` fires only when `phaseChanged`, `reconcilePhase` only when the derived phase differs, so one transition = one event), `ai_tool_selected` in `setActiveTool` (`aiToolManager.js`), `plugin_toggled` on successful settings write (`pluginsManager.js`), and `orchestration_run_started` on the new-session path only — reattach does not fire (`orchestrationManager.js`). Files touched: 5.

_Captured: 2026-07-19 · 5 file change(s)_

---

## T07 — `error_occurred` instrumentation

Added category-only error events: CLI probe failures mapped via a `PROBE_FAILURE_CATEGORIES` table at the two unavailable-return sites in the `CHECK_AI_TOOL_AVAILABLE` handler (`aiToolManager.js`), `terminal_create_failed` in the `TERMINAL_CREATE` catch (`ptyManager.js`), `orch_worktree_failed` / `orch_merge_failed` / `orch_worker_failed` at their existing relay sites (`orchestrationManager.js`), `plugin_marketplace_failed` at all three `marketplaceFailure` set sites (`pluginsManager.js`), and `settings_corrupt_recovered` on `.bak` recovery in `userSettings.js` — the latter via a deferred lazy require because telemetry requires userSettings (circular otherwise). Files touched: 5.

_Captured: 2026-07-19 · 5 file change(s)_

---

## T08 — Renderer events over `TELEMETRY_TRACK`

`agent_run_started` fires in `agentDispatch.js` where a CLI actually launches: in `dispatch()` after the agent-ready signal (covers `dispatchSpecCommand`, which routes through it), and in `_startAgentIn` (sidebar start). Injecting a prompt into an already-running agent deliberately does not fire. `orchestrator_opened` fires in `orchestrator.js open()` after the project guard. Raw tool ids are sent; main normalizes to the enum. Files touched: `src/renderer/agentDispatch.js`, `src/renderer/orchestrator.js`.

_Captured: 2026-07-19 · 2 file change(s)_

---

## T09 — PRIVACY.md disclosure

Replaced the "single anonymous event" section with the full 10-event table (fixed property values spelled out per event), noted that the registry is enforced in code and additions land in the doc first, and documented the fail-closed durable opt-out under "How to opt out". The "What we do not collect" list was already accurate and stands unchanged. Files touched: `PRIVACY.md`.

_Captured: 2026-07-19 · 1 file change(s)_

---
