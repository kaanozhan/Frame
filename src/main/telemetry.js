/**
 * Telemetry
 *
 * Anonymous usage events via Aptabase. Default opt-out: telemetry runs
 * unless the user disables it from Settings, and fails closed when the
 * settings file is unreadable. Every event must be declared in the
 * registry in telemetryEvents.js — event names plus low-cardinality enum
 * props only. No file paths, no project names, no code, no free-form
 * strings, no personally identifying information. The full event list is
 * documented in PRIVACY.md; keep the two in sync.
 *
 * The Aptabase app key below is a public identifier (not a secret). It
 * has write-only permissions and cannot read the dashboard or delete
 * data. Same model as Google Analytics tracking IDs.
 */

const aptabase = require('@aptabase/electron/main');
const userSettings = require('./userSettings');
const telemetryEvents = require('./telemetryEvents');

const APTABASE_APP_KEY = 'A-EU-5590504973';
const ENABLED_KEY = 'telemetryEnabled';

let initialized = false;

/**
 * Initialize Aptabase. MUST be called before app.whenReady() because the
 * SDK uses protocol.registerSchemesAsPrivileged internally.
 *
 * We always initialize (regardless of opt-out state) because the call has
 * no network side-effects on its own — events only go out when trackEvent
 * runs, and that path is gated by isEnabled(). Initializing eagerly avoids
 * the chicken-and-egg with userSettings (which loads after app.whenReady).
 */
function init() {
  if (initialized) return;
  try {
    aptabase.initialize(APTABASE_APP_KEY);
    initialized = true;
  } catch (err) {
    console.error('Telemetry: Aptabase init failed', err);
  }
}

/**
 * Send a registered anonymous event. No-op if disabled or not initialized.
 * The (name, props) pair is validated against the registry in
 * telemetryEvents.js — unregistered events are dropped entirely, unknown
 * props and out-of-enum values are stripped — so no call site (main or
 * renderer via IPC) can ship content past the allowlist.
 */
function track(name, props) {
  if (!isEnabled() || !initialized) return;
  const validated = telemetryEvents.validateEvent(name, props);
  if (validated === null) return;
  try {
    aptabase.trackEvent(name, Object.keys(validated).length ? validated : undefined);
  } catch (err) {
    console.error('Telemetry: trackEvent failed', err);
  }
}

/**
 * Anonymous event marking this launch.
 */
function trackAppStarted() {
  track('app_started');
}

/**
 * Toggle telemetry from Settings. Persists the new state. Aptabase is
 * already initialized on boot; flipping this flag just gates trackEvent.
 */
function setEnabled(enabled) {
  const value = enabled === true;
  userSettings.set(ENABLED_KEY, value);
  return value;
}

/**
 * Effective enabled state. Default ON when the setting has never been
 * touched (opt-out semantics) — but fails CLOSED when the settings file
 * could not be loaded at all, so corruption can never silently re-enable
 * telemetry for a user who opted out.
 */
function isEnabled() {
  return telemetryEvents.effectiveEnabled({
    value: userSettings.get(ENABLED_KEY),
    loadFailed: userSettings.loadFailed(),
  });
}

module.exports = { init, track, trackAppStarted, setEnabled, isEnabled };
