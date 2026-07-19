/**
 * Telemetry events — pure policy module
 *
 * Every decision telemetry makes without touching Electron lives here so it
 * can be unit-tested under `node --test`: the effective enabled/fail-closed
 * decision, and (as of the event-registry work) the allowlist of events and
 * property values that may ever leave the machine.
 */

/**
 * The registry: every event Frame may ever send, with every allowed property
 * and every allowed value. Properties are enums only — no free-form strings,
 * so nothing sourced from user data (paths, names, prompts, messages) can
 * pass through. Adding an event or a value here REQUIRES a matching
 * PRIVACY.md update in the same change.
 */
const EVENTS = {
  app_started: {},
  project_initialized: {},
  spec_created: {},
  spec_phase_advanced: {
    phase: ['draft', 'specified', 'planned', 'tasks_generated', 'implementing', 'done'],
  },
  agent_run_started: { tool: ['claude', 'codex', 'gemini', 'custom'] },
  orchestrator_opened: {},
  orchestration_run_started: {},
  plugin_toggled: { action: ['enabled', 'disabled'] },
  ai_tool_selected: { tool: ['claude', 'codex', 'gemini', 'custom'] },
  error_occurred: {
    category: [
      'agent_cli_not_found',
      'agent_cli_timeout',
      'agent_spawn_error',
      'terminal_create_failed',
      'orch_worktree_failed',
      'orch_merge_failed',
      'orch_worker_failed',
      'plugin_marketplace_failed',
      'settings_corrupt_recovered',
    ],
  },
};

const BUILTIN_TOOLS = ['claude', 'codex', 'gemini'];
// Spec/orchestration code identifies Claude as 'claude-code'; the dashboard
// enum uses the tool manager's 'claude'.
const TOOL_ALIASES = { 'claude-code': 'claude' };

/**
 * Collapse a tool id to the fixed dashboard enum. User-defined custom tool
 * ids are user content and must never be sent — anything that isn't a
 * built-in id (after aliasing) reads as 'custom'.
 */
function normalizeTool(id) {
  if (typeof id !== 'string') return 'custom';
  const mapped = TOOL_ALIASES[id] || id;
  return BUILTIN_TOOLS.includes(mapped) ? mapped : 'custom';
}

/**
 * Validate an (event, props) pair against the registry.
 *
 * Returns null for an unregistered event (caller must drop it), otherwise
 * the subset of props that are registered for the event and carry an allowed
 * enum value — unknown keys and out-of-enum values are silently stripped.
 * `tool` props are normalized before the enum check so raw ids from call
 * sites (including the renderer) can never pass through.
 */
function validateEvent(name, props) {
  const schema = EVENTS[name];
  if (!schema) return null;
  const out = {};
  for (const key of Object.keys(schema)) {
    let value = props ? props[key] : undefined;
    if (value === undefined) continue;
    if (key === 'tool') value = normalizeTool(value);
    if (schema[key].includes(value)) out[key] = value;
  }
  return out;
}

/**
 * Effective telemetry state from the persisted setting plus settings-load
 * health. Default ON when the setting was never touched (opt-out semantics),
 * but a failed settings load fails CLOSED: we can no longer know whether the
 * user opted out, so we must assume they did.
 *
 * @param {{ value: any, loadFailed: boolean }} state
 *   value      — userSettings.get('telemetryEnabled') (null when never set)
 *   loadFailed — userSettings.loadFailed()
 * @returns {boolean}
 */
function effectiveEnabled({ value, loadFailed }) {
  if (loadFailed) return false;
  return value !== false;
}

module.exports = { EVENTS, normalizeTool, validateEvent, effectiveEnabled };
