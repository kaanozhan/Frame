# Tasks — Product analytics & instrumentation

- T01 · Add `loadFailed()` to `src/main/userSettings.js` — true only when the settings load ended with an error and no data (unrecoverable); ENOENT and successful `.bak` recovery stay false
- T02 · Create `src/main/telemetryEvents.js` with pure `effectiveEnabled({value, loadFailed})`, route `telemetry.isEnabled()` through it, and cover all four load states in a new `test/telemetry.test.js` (the re-opt-in regression test)
- T03 · Add the event registry, `validateEvent(name, props)`, and `normalizeTool(id)` to `src/main/telemetryEvents.js`, with tests asserting the registry is enum-only and unknown events/props/values are dropped
- T04 · Add `track(name, props)` to `src/main/telemetry.js` gated by `isEnabled() && initialized` and registry validation; refactor `trackAppStarted()` onto it and update the module header comment
- T05 · Add `TELEMETRY_TRACK` channel to `src/shared/ipcChannels.js` and its main-process listener in `src/main/index.js` forwarding to `telemetry.track`
- T06 · Instrument main-process activation/feature events: `project_initialized` in `src/main/frameProject.js`, `spec_created` + `spec_phase_advanced` in `src/main/specManager.js` (both changed-phase write paths), `ai_tool_selected` in `src/main/aiToolManager.js`, `plugin_toggled` in `src/main/pluginsManager.js`, `orchestration_run_started` (new-session path only) in `src/main/orchestrationManager.js`
- T07 · Instrument `error_occurred` with its category enum at the handled failure sites in `src/main/aiToolManager.js`, `src/main/ptyManager.js`, `src/main/orchestrationManager.js`, `src/main/pluginsManager.js`, and the `.bak`-recovery path in `src/main/userSettings.js`
- T08 · Send renderer events over `TELEMETRY_TRACK`: `agent_run_started` (normalized tool) from `src/renderer/agentDispatch.js` dispatch paths and `orchestrator_opened` from `src/renderer/orchestrator.js`
- T09 · Update `PRIVACY.md`: enumerate every event with its properties, restate the "we do not collect" list, and document the fail-closed opt-out behavior
